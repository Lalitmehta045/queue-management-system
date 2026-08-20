import { ConflictException, ForbiddenException, Injectable, NotFoundException, MessageEvent } from '@nestjs/common';
import { AuditAction, AuditResourceType, CounterStatus, MembershipStatus, Prisma, QueueEntryStatus, Role, TokenStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import { Observable } from 'rxjs';
import { AuditContext, AuditService } from '../audit/audit.service';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { DisplayEventsService } from '../displays/display-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { getBusinessDate } from '../utils/date.util';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;
type AuthorizedCounter = { id: string; branchId: string; status: CounterStatus; tokenType: import('@prisma/client').TokenType };
type TokenAuditRow = {
  id: string;
  displayNumber: string;
  status: TokenStatus;
  queueEntryId: string;
  recallCount: number;
  counter: { id: string; name: string; code: string } | null;
};

@Injectable()
export class QueueCallingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly displayEvents: DisplayEventsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async callNext(tenant: Tenant, userId: string, branchId: string, counterId: string, auditContext?: AuditContext) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    const businessDate = await this.getActiveBusinessDate(branchId);
    const token = await this.prisma.$transaction(async (tx) => {
      const lockedCounters = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM "Counter" c
        INNER JOIN "Branch" b ON c."branchId" = b.id
        WHERE c.id = ${counter.id}::uuid
          AND c."branchId" = ${branchId}::uuid
          AND b."organizationId" = ${tenant.organizationId}::uuid
        FOR UPDATE
      `;
      if (!lockedCounters.length) throw new NotFoundException('Counter not found or not eligible for locking');

      await this.ensureCounterAvailable(tx, tenant.organizationId, branchId, counter.id);
      
      const starvationThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
      let candidates = await tx.token.findMany({
        where: { ...this.waitingScope(tenant.organizationId, branchId, counter.id, businessDate, counter.tokenType), issuedAt: { lt: starvationThreshold } },
        orderBy: [{ sequenceNumber: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 5,
        select: { id: true },
      });

      if (candidates.length === 0) {
        candidates = await tx.token.findMany({
          where: this.waitingScope(tenant.organizationId, branchId, counter.id, businessDate, counter.tokenType),
          orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { sequenceNumber: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 20,
          select: { id: true },
        });
      }

      for (const candidate of candidates) {
        const claimed = await tx.token.updateMany({
          where: { id: candidate.id, status: TokenStatus.WAITING, counterId: counter.id },
          data: { status: TokenStatus.CALLED, operatorId: userId, calledAt: new Date() },
        });
        if (claimed.count === 1) return this.findCurrentInTransaction(tx, tenant.organizationId, branchId, counter.id);
      }
      throw new ConflictException('No waiting token is available');
    }).catch((error: unknown) => this.handleConcurrencyError(error));
    this.displayEvents.publish(counter.branchId, 'TOKEN_CALLED');
    if (token) void this.notifications.onTokenCalled(counter.branchId, token.id).catch(() => undefined);
    if (token && auditContext) await this.auditToken(auditContext, tenant.organizationId, counter.branchId, AuditAction.TOKEN_CALLED, token, userId);
    return token;
  }

  async callSpecific(tenant: Tenant, userId: string, branchId: string, counterId: string, tokenId: string, auditContext?: AuditContext) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    if (!isUUID(tokenId)) throw new NotFoundException('Token not found');
    const scopedToken = await this.prisma.token.findFirst({ where: { id: tokenId, queueEntry: { service: { department: { branchId, branch: { organizationId: tenant.organizationId } } } } }, select: { id: true, type: true } });
    if (!scopedToken) throw new NotFoundException('Token not found');
    if (scopedToken.type !== counter.tokenType) throw new ConflictException(`Cannot call a ${scopedToken.type} token on a ${counter.tokenType} counter`);
    try {
      const token = await this.prisma.$transaction(async (tx) => {
        const lockedCounters = await tx.$queryRaw<{ id: string }[]>`
          SELECT c.id FROM "Counter" c
          INNER JOIN "Branch" b ON c."branchId" = b.id
          WHERE c.id = ${counter.id}::uuid
            AND c."branchId" = ${branchId}::uuid
            AND b."organizationId" = ${tenant.organizationId}::uuid
          FOR UPDATE
        `;
        if (!lockedCounters.length) throw new NotFoundException('Counter not found or not eligible for locking');

        await this.ensureCounterAvailable(tx, tenant.organizationId, branchId, counter.id);
        const businessDate = await this.getActiveBusinessDate(branchId);
        const claimed = await tx.token.updateMany({
          where: { id: tokenId, ...this.waitingScope(tenant.organizationId, branchId, counter.id, businessDate, counter.tokenType) },
          data: { status: TokenStatus.CALLED, operatorId: userId, calledAt: new Date() },
        });
        if (claimed.count !== 1) throw new ConflictException('Token is not available for calling');
        return this.findCurrentInTransaction(tx, tenant.organizationId, branchId, counter.id);
      });
      this.displayEvents.publish(counter.branchId, 'TOKEN_CALLED');
      if (token) void this.notifications.onTokenCalled(counter.branchId, token.id).catch(() => undefined);
      if (token && auditContext) await this.auditToken(auditContext, tenant.organizationId, counter.branchId, AuditAction.TOKEN_CALLED, token, userId);
      return token;
    } catch (error: unknown) {
      this.handleConcurrencyError(error);
    }
  }

  async current(tenant: Tenant, userId: string, branchId: string, counterId: string) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    return this.findCurrent(tenant.organizationId, branchId, counter.id);
  }

  async waiting(tenant: Tenant, userId: string, branchId: string, counterId: string) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    const businessDate = await this.getActiveBusinessDate(branchId);
    const data = await this.prisma.token.findMany({
      where: this.waitingScope(tenant.organizationId, counter.branchId, counter.id, businessDate, counter.tokenType),
      orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { sequenceNumber: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: this.tokenSelect,
    });
    return { data, meta: { total: data.length, counterId: counter.id, branchId: counter.branchId } };
  }

  streamEvents(tenant: Tenant, branchId: string) {
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) throw new ForbiddenException('You do not have access to this branch');
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      const unsubscribe = this.displayEvents.subscribe(branchId, (eventType) => {
        if (!closed) subscriber.next({ data: JSON.stringify({ eventType }) });
      });
      const heartbeat = setInterval(() => {
        if (!closed) subscriber.next({ type: 'KEEPALIVE', data: { updatedAt: new Date().toISOString() } });
      }, 25_000);
      const boundedLifecycle = setTimeout(() => {
        if (!closed) subscriber.complete();
      }, 12 * 60 * 60 * 1000);
      return () => {
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(boundedLifecycle);
        unsubscribe();
      };
    });
  }

  async recall(tenant: Tenant, userId: string, branchId: string, counterId: string, auditContext?: AuditContext) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    const current = await this.findCurrent(tenant.organizationId, branchId, counter.id);
    if (!current) throw new ConflictException('Counter has no active token');
    const updated = await this.prisma.token.updateMany({ where: { id: current.id, counterId: counter.id, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] } }, data: { recalledAt: new Date(), recallCount: { increment: 1 } } });
    if (updated.count !== 1) throw new ConflictException('Token is no longer active');
    const token = await this.current(tenant, userId, branchId, counter.id);
    this.displayEvents.publish(counter.branchId, 'TOKEN_RECALLED');
    void this.notifications.onTokenRecalled(counter.branchId, current.id).catch(() => undefined);
    if (token && auditContext) await this.auditToken(auditContext, tenant.organizationId, counter.branchId, AuditAction.TOKEN_RECALLED, token, userId);
    return token;
  }

  async skip(tenant: Tenant, userId: string, branchId: string, counterId: string, auditContext?: AuditContext) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    const current = await this.findCurrent(tenant.organizationId, branchId, counter.id);
    if (!current) throw new ConflictException('Counter has no active token');
    const updated = await this.prisma.token.updateMany({ where: { id: current.id, counterId: counter.id, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] } }, data: { status: TokenStatus.SKIPPED, skippedAt: new Date() } });
    if (updated.count !== 1) throw new ConflictException('Token is no longer active');
    const token = await this.getScopedToken(tenant.organizationId, branchId, current.id);
    this.displayEvents.publish(counter.branchId, 'TOKEN_SKIPPED');
    if (token && auditContext) await this.auditToken(auditContext, tenant.organizationId, counter.branchId, AuditAction.TOKEN_SKIPPED, token, userId);
    return token;
  }

  async complete(tenant: Tenant, userId: string, branchId: string, counterId: string, auditContext?: AuditContext) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    const current = await this.findCurrent(tenant.organizationId, branchId, counter.id);
    if (!current) throw new ConflictException('Counter has no active token');
    const updated = await this.prisma.token.updateMany({ where: { id: current.id, counterId: counter.id, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] } }, data: { status: TokenStatus.COMPLETED, completedAt: new Date() } });
    if (updated.count !== 1) throw new ConflictException('Token is no longer active');
    const token = await this.getScopedToken(tenant.organizationId, branchId, current.id);
    this.displayEvents.publish(counter.branchId, 'TOKEN_COMPLETED');
    void this.notifications.onTokenCompleted(counter.branchId, current.id).catch(() => undefined);
    if (token && auditContext) await this.auditToken(auditContext, tenant.organizationId, counter.branchId, AuditAction.TOKEN_COMPLETED, token, userId);
    return token;
  }

  async skippedTokens(tenant: Tenant, userId: string, branchId: string, counterId: string) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    const businessDate = await this.getActiveBusinessDate(branchId);
    const data = await this.prisma.token.findMany({
      where: {
        status: TokenStatus.SKIPPED,
        counterId: counter.id,
        type: counter.tokenType,
        ...(businessDate ? { businessDate } : {}),
        queueEntry: { service: { department: { branchId: counter.branchId, branch: { organizationId: tenant.organizationId } } } },
      },
      orderBy: [{ skippedAt: 'desc' }, { id: 'asc' }],
      select: this.tokenSelect,
    });
    return { data, meta: { total: data.length, counterId: counter.id, branchId: counter.branchId } };
  }

  async recallSkippedToken(tenant: Tenant, userId: string, branchId: string, counterId: string, tokenId: string, auditContext?: AuditContext) {
    const counter = await this.authorizeCounter(tenant, userId, branchId, counterId);
    if (!isUUID(tokenId)) throw new NotFoundException('Token not found');

    const scopedToken = await this.prisma.token.findFirst({
      where: {
        id: tokenId,
        counterId: counter.id,
        queueEntry: { service: { department: { branchId: counter.branchId, branch: { organizationId: tenant.organizationId } } } },
      },
      select: { id: true, status: true, type: true },
    });
    if (!scopedToken) throw new NotFoundException('Token not found');
    if (scopedToken.status !== TokenStatus.SKIPPED) throw new ConflictException('Token is not in SKIPPED status');
    if (scopedToken.type !== counter.tokenType) throw new ConflictException(`Cannot recall a ${scopedToken.type} token to a ${counter.tokenType} counter`);

    const updated = await this.prisma.token.updateMany({
      where: { id: tokenId, counterId: counter.id, status: TokenStatus.SKIPPED },
      data: { status: TokenStatus.WAITING, skippedAt: null },
    });
    if (updated.count !== 1) throw new ConflictException('Token state has changed; please refresh and try again');

    const token = await this.getScopedToken(tenant.organizationId, counter.branchId, tokenId);
    this.displayEvents.publish(counter.branchId, 'TOKEN_RECALL_SKIPPED');
    if (token && auditContext) await this.auditToken(auditContext, tenant.organizationId, counter.branchId, AuditAction.TOKEN_RECALLED, token, userId);
    return token;
  }

  private async auditToken(auditContext: AuditContext, organizationId: string, branchId: string, action: AuditAction, token: TokenAuditRow, userId: string) {
    await this.audit.record({
      ...auditContext,
      organizationId,
      branchId,
      action,
      resourceType: AuditResourceType.TOKEN,
      resourceId: token.id,
      metadata: {
        queueEntryId: token.queueEntryId,
        displayNumber: token.displayNumber,
        status: token.status,
        counterId: token.counter?.id,
        counterName: token.counter?.name ?? token.counter?.code,
        operatorUserId: userId,
        recallCount: token.recallCount,
      },
    });
  }

  private async authorizeCounter(tenant: Tenant, userId: string, branchId: string, counterId: string): Promise<AuthorizedCounter> {
    if (!isUUID(branchId) || !isUUID(counterId)) throw new NotFoundException('Counter not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) throw new ForbiddenException('You do not have access to this branch');
    const counter = await this.prisma.counter.findFirst({ where: { id: counterId, branchId, branch: { organizationId: tenant.organizationId } }, select: { id: true, branchId: true, status: true, tokenType: true } });
    if (!counter) throw new NotFoundException('Counter not found');
    if (counter.status !== CounterStatus.ACTIVE) throw new ConflictException('Counter is inactive');
    if (tenant.role === Role.COUNTER_OPERATOR) {
      const assignment = await this.prisma.counterAssignment.findFirst({ where: { counterId, userId, counter: { branchId, branch: { organizationId: tenant.organizationId } }, user: { memberships: { some: { userId, organizationId: tenant.organizationId, branchId, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } } } }, select: { id: true } });
      if (!assignment) throw new ForbiddenException('Operator is not assigned to this counter');
    }
    return counter;
  }

  private async ensureCounterAvailable(tx: Prisma.TransactionClient, organizationId: string, branchId: string, counterId: string) {
    const current = await tx.token.findFirst({ where: { counterId, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, queueEntry: { service: { department: { branchId, branch: { organizationId } } } } }, select: { id: true } });
    if (current) throw new ConflictException('Counter already has an active token');
  }

  private waitingScope(organizationId: string, branchId: string, counterId?: string, businessDate?: Date | null, tokenType?: string): Prisma.TokenWhereInput {
    const scope: Prisma.TokenWhereInput = {
      status: TokenStatus.WAITING,
      queueEntry: {
        status: QueueEntryStatus.WAITING,
        service: { department: { branchId, branch: { organizationId } } },
      },
    };
    if (tokenType) {
      scope.type = tokenType as any;
    }
    if (counterId) {
      scope.counterId = counterId;
    }
    if (businessDate) {
      scope.businessDate = businessDate;
    }
    return scope;
  }

  private async getActiveBusinessDate(branchId: string): Promise<Date | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      include: { organization: { select: { timezone: true } } },
    });
    if (!branch) return null;
    return getBusinessDate(branch.organization.timezone);
  }

  private async findCurrent(organizationId: string, branchId: string, counterId: string) {
    return this.prisma.token.findFirst({ where: { counterId, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, queueEntry: { service: { department: { branchId, branch: { organizationId } } } } }, select: this.tokenSelect });
  }

  private findCurrentInTransaction(tx: Prisma.TransactionClient, organizationId: string, branchId: string, counterId: string) {
    return tx.token.findFirst({ where: { counterId, status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] }, queueEntry: { service: { department: { branchId, branch: { organizationId } } } } }, select: this.tokenSelect });
  }

  private getScopedToken(organizationId: string, branchId: string, tokenId: string) {
    return this.prisma.token.findFirst({ where: { id: tokenId, queueEntry: { service: { department: { branchId, branch: { organizationId } } } } }, select: this.tokenSelect });
  }

  private handleConcurrencyError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Counter already has an active token');
    throw error;
  }

  private readonly tokenSelect = {
    id: true,
    displayNumber: true,
    sequenceNumber: true,
    status: true,
    calledAt: true,
    servingAt: true,
    completedAt: true,
    skippedAt: true,
    recalledAt: true,
    recallCount: true,
    queueEntryId: true,
    counter: { select: { id: true, name: true, code: true } },
    operator: { select: { id: true, displayName: true } },
    queueEntry: { select: { priority: true, priorityWeight: true, patient: { select: { patientNumber: true, firstName: true, lastName: true } }, service: { select: { name: true, department: { select: { name: true } } } } } },
  } satisfies Prisma.TokenSelect;
}
