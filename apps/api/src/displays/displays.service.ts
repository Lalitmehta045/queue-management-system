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
import { getBusinessDate } from '../utils/date.util';


type Tenant = NonNullable<AuthenticatedRequest['tenant']>;
type PublicToken = { tokenLabel: string; counter: string; tokenType: string; status: TokenStatus; service?: string; department?: string; recalled: boolean; recallCount: number; calledAt: string | null };

@Injectable()
export class DisplaysService {
  private readonly requestWindows = new Map<string, { startedAt: number; count: number }>();
  private lastRateLimitCleanup = 0;
  private readonly displaySelect = { id: true, branchId: true, publicId: true, name: true, logoUrl: true, active: true, createdAt: true, updatedAt: true } satisfies Prisma.DisplaySelect;

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

          return tx.display.create({ data: { branchId, name: dto.name.trim(), publicId: this.generatePublicId(), ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }) }, select: this.displaySelect });
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
      return await this.prisma.display.update({ where: { id: displayId }, data: { ...(dto.name !== undefined && { name: dto.name.trim() }), ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }) }, select: this.displaySelect });
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
      
      // Send a padding event to force reverse proxies (Nginx, Cloudflare) to flush their buffers
      subscriber.next({ type: 'PADDING', data: 'x'.repeat(4096) });

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
    const display = await this.prisma.display.findFirst({ where: { publicId, active: true, branch: { status: 'ACTIVE' } }, select: { id: true, name: true, logoUrl: true, branchId: true } });
    if (!display) throw new NotFoundException('Display not found');
    return display;
  }

  private async buildPublicSnapshot(display: { name: string; logoUrl: string | null; branchId: string }) {
    // Fetch the branch's active business date for session filtering
    const branch = await this.prisma.branch.findUnique({
      where: { id: display.branchId },
      include: { organization: { select: { timezone: true } } },
    });
    const businessDateFilter: Prisma.TokenWhereInput = branch ? { businessDate: getBusinessDate(branch.organization.timezone) } : {};

    const currentTokens = await this.prisma.token.findMany({
      where: { ...businessDateFilter, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, counterId: { not: null }, queueEntry: { service: { department: { branchId: display.branchId } } } },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: this.publicTokenSelect,
    });
    const current = currentTokens[0] ? this.toPublicToken(currentTokens[0]) : null;
    const recentRows = await this.prisma.token.findMany({
      where: { ...businessDateFilter, calledAt: { not: null }, queueEntry: { service: { department: { branchId: display.branchId } } } },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      take: 8,
      select: this.publicTokenSelect,
    });
    const recent = recentRows.filter((token) => token.id !== currentRowsId(currentTokens)).slice(0, 5).map((token) => this.toPublicToken(token));
    const waitingTotal = await this.prisma.token.count({ where: { ...businessDateFilter, status: TokenStatus.WAITING, queueEntry: { status: 'WAITING', service: { department: { branchId: display.branchId } } } } });

        const branchCounters = await this.prisma.counter.findMany({
      where: {
        branchId: display.branchId,
        status: CounterStatus.ACTIVE,
      },
      select: { id: true, name: true, code: true, tokenType: true, status: true },
      orderBy: { name: 'asc' },
    });
    
    const activeCountersTokens = await this.prisma.token.findMany({
      where: { ...businessDateFilter, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, counterId: { not: null }, queueEntry: { service: { department: { branchId: display.branchId } } } },
      orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      select: this.publicTokenSelect,
    });
    
    const countersRaw = await Promise.all(branchCounters.map(async (counter) => {
      const nowToken = activeCountersTokens.find((t) => t.counterId === counter.id);
      
      const counterWaitingTokens = await this.prisma.token.findMany({
        where: { ...businessDateFilter, status: TokenStatus.WAITING, counterId: counter.id },
        orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { sequenceNumber: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: this.publicTokenSelect,
      });

      return { counter, nowToken, counterWaitingTokens };
    }));

    if (process.env.NODE_ENV !== 'production') {
      const seenTokenIds = new Map<string, string>();
      for (const c of countersRaw) {
        for (const t of c.counterWaitingTokens) {
          if (seenTokenIds.has(t.id)) {
            console.error(`DUPLICATE TOKEN IN PUBLIC SNAPSHOT\ntokenId: ${t.id}\ntokenLabel: ${t.displayNumber}\ncounters: ${seenTokenIds.get(t.id)}, ${c.counter.code}`);
          }
          seenTokenIds.set(t.id, c.counter.code);
        }
      }
    }

    const counters = countersRaw.map(({ counter, nowToken, counterWaitingTokens }) => {
      const nextToken = counterWaitingTokens.length > 0 ? this.toPublicToken(counterWaitingTokens[0]!) : null;
      
      const waitingTokensFiltered = counterWaitingTokens
        .slice(1)
        .map((t) => this.toPublicToken(t));

      return {
        id: counter.id,
        name: counter.name,
        code: counter.code,
        counter: counter.name ?? counter.code ?? 'Counter',
          tokenType: counter.tokenType,
        now: nowToken ? this.toPublicToken(nowToken) : null,
        next: nextToken,
        waitingTokens: waitingTokensFiltered,
      };
    });

    return { display: { name: display.name, logoUrl: display.logoUrl }, current, recent, waitingSummary: { total: waitingTotal }, counters, updatedAt: new Date().toISOString() };
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
    return { tokenLabel: token.displayNumber, counter: token.counter?.name ?? token.counter?.code ?? 'Counter', tokenType: token.type, status: token.status, recalled: token.recalledAt !== null, recallCount: token.recallCount, calledAt: token.calledAt?.toISOString() ?? null };
  }

    private readonly publicTokenSelect = {
    id: true,
    displayNumber: true,
    type: true,
    status: true,
    calledAt: true,
    recalledAt: true,
    recallCount: true,
    counterId: true,
    issuedAt: true,
    createdAt: true,
    sequenceNumber: true,
    counter: { select: { name: true, code: true } },
    queueEntry: { select: { priorityWeight: true, service: { select: { name: true, department: { select: { name: true } } } } } },
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
  type: string;
  status: TokenStatus;
  calledAt: Date | null;
  recalledAt: Date | null;
  recallCount: number;
  counterId: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  sequenceNumber: number;
  counter: { name: string; code: string } | null;
  queueEntry?: { priorityWeight: number; service: { name: string; department: { name: string } } } | null;
};

function currentRowsId(current: Array<{ id: string }>) {
  return current[0]?.id;
}
