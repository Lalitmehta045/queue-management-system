import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, MessageEvent, NotFoundException } from '@nestjs/common';
import { Prisma, Role, TokenStatus, CounterStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { isUUID } from 'class-validator';
import { Observable } from 'rxjs';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { DisplayEventsService } from './display-events.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { CreateDisplayDto } from './dto/create-display.dto';
import { UpdateDisplayDto } from './dto/update-display.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;
type PublicToken = { tokenLabel: string; counter: string; status: TokenStatus; service?: string; department?: string; recalled: boolean; recallCount: number; calledAt: string | null };

@Injectable()
export class DisplaysService {
  private readonly requestWindows = new Map<string, { startedAt: number; count: number }>();
  private lastRateLimitCleanup = 0;
  private readonly displaySelect = { id: true, branchId: true, publicId: true, name: true, active: true, createdAt: true, updatedAt: true } satisfies Prisma.DisplaySelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly displayEvents: DisplayEventsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(tenant: Tenant, branchId: string, dto: CreateDisplayDto) {
    await this.authorizeBranch(tenant, branchId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.entitlements.lockOrganization(tenant.organizationId, tx);
          const currentCount = await tx.display.count({ where: { branch: { organizationId: tenant.organizationId } } });
          await this.entitlements.enforceLimit(tenant.organizationId, 'maxDisplays', currentCount, 1, tx);

          return tx.display.create({ data: { branchId, name: dto.name.trim(), publicId: this.generatePublicId() }, select: this.displaySelect });
        });
      } catch (error: unknown) {
        if (this.isUniqueError(error) && attempt < 2) continue;
        this.handlePrismaError(error, 'Display could not be created');
      }
    }
    throw new ConflictException('Display could not be created');
  }

  async list(tenant: Tenant, branchId: string) {
    await this.authorizeBranch(tenant, branchId);
    const displays = await this.prisma.display.findMany({ where: { branchId }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: this.displaySelect });
    return displays.map((display) => ({ ...display, publicPath: `/display/${display.publicId}` }));
  }

  async update(tenant: Tenant, branchId: string, displayId: string, dto: UpdateDisplayDto) {
    await this.authorizeBranch(tenant, branchId);
    await this.getScopedDisplay(tenant.organizationId, branchId, displayId);
    try {
      return await this.prisma.display.update({ where: { id: displayId }, data: dto.name === undefined ? {} : { name: dto.name.trim() }, select: this.displaySelect });
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Display could not be updated');
    }
  }

  async setActive(tenant: Tenant, branchId: string, displayId: string, active: boolean) {
    await this.authorizeBranch(tenant, branchId);
    await this.getScopedDisplay(tenant.organizationId, branchId, displayId);
    return this.prisma.display.update({ where: { id: displayId }, data: { active }, select: this.displaySelect });
  }

  async getPublicSnapshot(publicId: string, clientKey: string | undefined) {
    this.checkRateLimit(`snapshot:${publicId}`, clientKey ?? 'unknown', 120);
    const display = await this.resolveActiveDisplay(publicId);
    return this.buildPublicSnapshot(display);
  }

  private readonly activeSubscriptions = new Map<string, number>();

  async streamPublicEvents(publicId: string, clientKey: string | undefined) {
    this.checkRateLimit(`events:${publicId}`, clientKey ?? 'unknown', 20);
    const display = await this.resolveActiveDisplay(publicId);
    
    // Prevent unbounded subscriber growth per display
    const currentSubs = this.activeSubscriptions.get(publicId) || 0;
    if (currentSubs >= 10) {
      throw new HttpException('Too many active connections for this display', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.activeSubscriptions.set(publicId, currentSubs + 1);

    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      const sendSnapshot = (eventType: string) => {
        void this.buildPublicSnapshot(display)
          .then((snapshot) => {
            if (!closed) subscriber.next({ type: eventType, data: snapshot });
          })
          .catch((error: unknown) => {
            if (!closed) subscriber.error(error);
          });
      };
      sendSnapshot('QUEUE_UPDATED');
      const unsubscribe = this.displayEvents.subscribe(display.branchId, sendSnapshot);
      const heartbeat = setInterval(() => {
        if (!closed) subscriber.next({ type: 'KEEPALIVE', data: { updatedAt: new Date().toISOString() } });
      }, 25_000);

      // Force bounded lifecycle to prevent stale load balancer connections
      const boundedLifecycle = setTimeout(() => {
        if (!closed) subscriber.complete();
      }, 12 * 60 * 60 * 1000); // 12 hours

      return () => {
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(boundedLifecycle);
        unsubscribe();
        const subs = this.activeSubscriptions.get(publicId) || 1;
        this.activeSubscriptions.set(publicId, Math.max(0, subs - 1));
      };
    });
  }

  private async resolveActiveDisplay(publicId: string) {
    const display = await this.prisma.display.findFirst({ where: { publicId, active: true, branch: { status: 'ACTIVE' } }, select: { id: true, name: true, branchId: true } });
    if (!display) throw new NotFoundException('Display not found');
    return display;
  }

  private async buildPublicSnapshot(display: { name: string; branchId: string }) {
    const currentTokens = await this.prisma.token.findMany({
      where: { status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, counterId: { not: null }, queueEntry: { patient: { branchId: display.branchId }, service: { department: { branchId: display.branchId } } } },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: this.publicTokenSelect,
    });
    const current = currentTokens[0] ? this.toPublicToken(currentTokens[0]) : null;
    const recentRows = await this.prisma.token.findMany({
      where: { calledAt: { not: null }, queueEntry: { patient: { branchId: display.branchId }, service: { department: { branchId: display.branchId } } } },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      take: 8,
      select: this.publicTokenSelect,
    });
    const recent = recentRows.filter((token) => token.id !== currentRowsId(currentTokens)).slice(0, 5).map((token) => this.toPublicToken(token));
    const waitingTotal = await this.prisma.token.count({ where: { status: TokenStatus.WAITING, queueEntry: { status: 'WAITING', patient: { branchId: display.branchId }, service: { department: { branchId: display.branchId } } } } });

    const branchCounters = await this.prisma.counter.findMany({
      where: { branchId: display.branchId, status: CounterStatus.ACTIVE },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    
    const activeCountersTokens = await this.prisma.token.findMany({
      where: { status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, counterId: { not: null }, queueEntry: { patient: { branchId: display.branchId }, service: { department: { branchId: display.branchId } } } },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      select: this.publicTokenSelect,
    });
    
    const waitingTokens = await this.prisma.token.findMany({
      where: { status: TokenStatus.WAITING, counterId: null, queueEntry: { status: 'WAITING', patient: { branchId: display.branchId }, service: { department: { branchId: display.branchId } } } },
      orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { businessDate: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }],
      take: branchCounters.length,
      select: this.publicTokenSelect,
    });

    const sortedForNext = [...branchCounters].sort((a, b) => {
      const aIdle = !activeCountersTokens.some(t => t.counter?.name === a.name && t.counter?.code === a.code);
      const bIdle = !activeCountersTokens.some(t => t.counter?.name === b.name && t.counter?.code === b.code);
      if (aIdle && !bIdle) return -1;
      if (!aIdle && bIdle) return 1;
      return (a.name ?? a.code ?? '').localeCompare(b.name ?? b.code ?? '');
    });

    const nextTokenMap = new Map<string, PublicToken>();
    sortedForNext.forEach((c, i) => {
      if (waitingTokens[i]) {
        nextTokenMap.set(c.id, this.toPublicToken(waitingTokens[i]));
      }
    });

    const counters = branchCounters.map((counter) => {
      const nowToken = activeCountersTokens.find((t) => t.counter?.name === counter.name && t.counter?.code === counter.code);
      return {
        counter: counter.name ?? counter.code ?? 'Counter',
        now: nowToken ? this.toPublicToken(nowToken) : null,
        next: nextTokenMap.get(counter.id) || null,
      };
    });

    return { display: { name: display.name }, current, recent, waitingSummary: { total: waitingTotal }, counters, updatedAt: new Date().toISOString() };
  }

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) throw new ForbiddenException('You do not have access to this branch');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private async getScopedDisplay(organizationId: string, branchId: string, displayId: string) {
    if (!isUUID(displayId)) throw new NotFoundException('Display not found');
    const display = await this.prisma.display.findFirst({ where: { id: displayId, branchId, branch: { organizationId } }, select: this.displaySelect });
    if (!display) throw new NotFoundException('Display not found');
    return display;
  }

  private checkRateLimit(publicId: string, clientKey: string, maxRequestsPerMinute: number) {
    const now = Date.now();
    if (now - this.lastRateLimitCleanup > 60_000) {
      for (const [windowKey, window] of this.requestWindows) {
        if (now - window.startedAt >= 60_000) this.requestWindows.delete(windowKey);
      }
      this.lastRateLimitCleanup = now;
    }
    const key = `${publicId}:${clientKey}`;
    const current = this.requestWindows.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.requestWindows.set(key, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= maxRequestsPerMinute) throw new HttpException('Display is temporarily rate limited', HttpStatus.TOO_MANY_REQUESTS);
    current.count += 1;
  }

  private generatePublicId() {
    return randomBytes(24).toString('hex');
  }

  private toPublicToken(token: PublicTokenRow): PublicToken {
    return { tokenLabel: token.displayNumber, counter: token.counter?.name ?? token.counter?.code ?? 'Counter', status: token.status, recalled: token.recalledAt !== null, recallCount: token.recallCount, calledAt: token.calledAt?.toISOString() ?? null };
  }

  private readonly publicTokenSelect = {
    id: true,
    displayNumber: true,
    status: true,
    calledAt: true,
    recalledAt: true,
    recallCount: true,
    counter: { select: { name: true, code: true } },
  } satisfies Prisma.TokenSelect;

  private isUniqueError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private handlePrismaError(error: unknown, notFoundMessage: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('A resource with the same identifier already exists');
      if (error.code === 'P2025') throw new NotFoundException(notFoundMessage);
    }
    throw error;
  }
}

type PublicTokenRow = {
  id: string;
  displayNumber: string;
  status: TokenStatus;
  calledAt: Date | null;
  recalledAt: Date | null;
  recallCount: number;
  counter: { name: string; code: string } | null;
};

function currentRowsId(current: Array<{ id: string }>) {
  return current[0]?.id;
}
