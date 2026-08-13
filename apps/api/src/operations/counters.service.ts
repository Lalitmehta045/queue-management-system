import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResourceType, CounterStatus, MembershipStatus, Prisma, Role } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { CreateCounterDto } from './dto/create-counter.dto';
import { ListResourcesDto } from './dto/list-resources.dto';
import { UpdateCounterDto } from './dto/update-counter.dto';
import { QueueAllocationService } from '../queue-calling/queue-allocation.service';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

@Injectable()
export class CountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly queueAllocation: QueueAllocationService,
  ) {}

  async create(tenant: Tenant, branchId: string, dto: CreateCounterDto, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    try {
      const counter = await this.prisma.$transaction(async (tx) => {
        await this.entitlements.lockOrganization(tenant.organizationId, tx);
        const currentCount = await tx.counter.count({ where: { branch: { organizationId: tenant.organizationId } } });
        await this.entitlements.enforceLimit(tenant.organizationId, 'maxCounters', currentCount, 1, tx);

        return tx.counter.create({
          data: { branchId, name: dto.name.trim(), code: dto.code.trim() },
          select: this.counterSelect,
        });
      });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: AuditAction.COUNTER_CREATED, resourceType: AuditResourceType.COUNTER, resourceId: counter.id, metadata: { name: counter.name, code: counter.code, status: counter.status } });
      return counter;
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Counter could not be created');
    }
  }

  async list(tenant: Tenant, branchId: string, query: ListResourcesDto) {
    await this.authorizeBranch(tenant, branchId);
    const where = { branchId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.counter.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: this.counterSelect,
      }),
      this.prisma.counter.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async listAssigned(tenant: Tenant, userId: string, branchId: string) {
    await this.authorizeBranch(tenant, branchId);
    return this.prisma.counter.findMany({
      where: {
        branchId,
        status: CounterStatus.ACTIVE,
        assignments: { some: { userId, user: { memberships: { some: { userId, organizationId: tenant.organizationId, branchId, role: Role.COUNTER_OPERATOR, status: MembershipStatus.ACTIVE } } } } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: this.counterSelect,
    });
  }

  async get(tenant: Tenant, branchId: string, counterId: string) {
    await this.authorizeBranch(tenant, branchId);
    const counter = await this.findCounter(tenant.organizationId, branchId, counterId);
    if (!counter) throw new NotFoundException('Counter not found');
    return counter;
  }

  async update(tenant: Tenant, branchId: string, counterId: string, dto: UpdateCounterDto, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    await this.get(tenant, branchId, counterId);
    try {
      const counter = await this.prisma.counter.update({
        where: { id: counterId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.code === undefined ? {} : { code: dto.code.trim() }),
        },
        select: this.counterSelect,
      });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: AuditAction.COUNTER_UPDATED, resourceType: AuditResourceType.COUNTER, resourceId: counter.id, metadata: { name: counter.name, code: counter.code, status: counter.status, changedFields: Object.keys(dto) } });
      return counter;
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Counter could not be updated');
    }
  }

  async setStatus(tenant: Tenant, branchId: string, counterId: string, status: CounterStatus, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    await this.get(tenant, branchId, counterId);
    const counter = await this.prisma.$transaction(async (tx) => {
      const c = await tx.counter.update({ where: { id: counterId }, data: { status }, select: this.counterSelect });
      await this.queueAllocation.rebalanceWaitingTokens(tx, branchId);
      return c;
    });
    if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: status === CounterStatus.ACTIVE ? AuditAction.COUNTER_ACTIVATED : AuditAction.COUNTER_DEACTIVATED, resourceType: AuditResourceType.COUNTER, resourceId: counter.id, metadata: { name: counter.name, code: counter.code, status: counter.status } });
    return counter;
  }

  async assign(tenant: Tenant, branchId: string, counterId: string, userId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const counter = await this.get(tenant, branchId, counterId);
    if (counter.status !== CounterStatus.ACTIVE) throw new ConflictException('Inactive counters cannot have operators assigned');
    if (!isUUID(userId)) throw new NotFoundException('User not found');

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        organizationId: tenant.organizationId,
        branchId,
        status: MembershipStatus.ACTIVE,
        role: Role.COUNTER_OPERATOR,
      },
      select: { userId: true },
    });
    if (!membership) throw new ForbiddenException('User is not an eligible operator for this branch');

    const existingAssignment = await this.prisma.counterAssignment.findFirst({
      where: { userId, counter: { branchId, branch: { organizationId: tenant.organizationId } } },
      select: { id: true },
    });
    if (existingAssignment) throw new ConflictException('Operator is already assigned to a counter in this branch');

    try {
      const assignment = await this.prisma.counterAssignment.create({
        data: { counterId, userId },
        select: this.assignmentSelect,
      });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: AuditAction.OPERATOR_ASSIGNED, resourceType: AuditResourceType.OPERATOR_ASSIGNMENT, resourceId: assignment.id, metadata: { counterId, operatorUserId: userId } });
      return assignment;
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Operator assignment could not be created');
    }
  }

  async listOperators(tenant: Tenant, branchId: string, counterId: string) {
    await this.authorizeBranch(tenant, branchId);
    await this.get(tenant, branchId, counterId);
    const assignments = await this.prisma.counterAssignment.findMany({
      where: { counterId, counter: { branchId, branch: { organizationId: tenant.organizationId } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
            memberships: {
              where: { organizationId: tenant.organizationId, branchId, status: MembershipStatus.ACTIVE },
              select: { role: true, status: true },
              take: 1,
            },
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });
    return assignments.map(({ user, ...assignment }) => ({
      ...assignment,
      user: { ...user, role: user.memberships[0]?.role ?? null, status: user.memberships[0]?.status ?? null },
    }));
  }

  async listEligibleOperators(tenant: Tenant, branchId: string) {
    await this.authorizeBranch(tenant, branchId);
    return this.prisma.user.findMany({
      where: {
        memberships: {
          some: {
            organizationId: tenant.organizationId,
            branchId,
            status: MembershipStatus.ACTIVE,
            role: Role.COUNTER_OPERATOR,
          },
        },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true, email: true },
    });
  }

  async unassign(tenant: Tenant, branchId: string, counterId: string, userId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    await this.get(tenant, branchId, counterId);
    const assignment = await this.prisma.counterAssignment.findFirst({ where: { counterId, userId }, select: { id: true } });
    const result = await this.prisma.counterAssignment.deleteMany({ where: { counterId, userId } });
    if (result.count === 0) throw new NotFoundException('Operator assignment not found');
    if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: AuditAction.OPERATOR_UNASSIGNED, resourceType: AuditResourceType.OPERATOR_ASSIGNMENT, resourceId: assignment?.id ?? null, metadata: { counterId, operatorUserId: userId } });
    return { success: true };
  }

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) {
      throw new ForbiddenException('You do not have access to this branch');
    }
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private async findCounter(organizationId: string, branchId: string, counterId: string) {
    if (!isUUID(counterId)) return null;
    return this.prisma.counter.findFirst({
      where: { id: counterId, branchId, branch: { organizationId } },
      select: this.counterSelect,
    });
  }

  private readonly counterSelect = {
    id: true,
    branchId: true,
    name: true,
    code: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.CounterSelect;

  private readonly assignmentSelect = {
    id: true,
    counterId: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.CounterAssignmentSelect;

  private handlePrismaError(error: unknown, notFoundMessage: string): never { console.error('PRISMA ERROR IN COUNTERS:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('A resource with the same identifier already exists');
      if (error.code === 'P2025') throw new NotFoundException(notFoundMessage);
    }
    throw error;
  }
}
