import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResourceType, Prisma, PriorityLevel, QueueEntryStatus, Role } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { DisplayEventsService } from '../displays/display-events.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQueueEntryDto } from './dto/create-queue-entry.dto';
import { ListQueueEntriesDto } from './dto/list-queue-entries.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

@Injectable()
export class QueueEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly displayEvents: DisplayEventsService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(tenant: Tenant, branchId: string, dto: CreateQueueEntryDto, auditContext?: AuditContext) {
    const branch = await this.authorizeBranch(tenant, branchId);
    if (branch.queueStatus === 'PAUSED') {
      throw new ConflictException('Queue is currently paused for this branch');
    }
    const [patient, service] = await Promise.all([
      dto.patientId ? this.prisma.patient.findFirst({
        where: { id: dto.patientId, branchId, status: 'ACTIVE', branch: { organizationId: tenant.organizationId } },
        select: { id: true, patientNumber: true },
      }) : Promise.resolve(null),
      this.prisma.service.findFirst({
        where: { id: dto.serviceId, status: 'ACTIVE', department: { branchId, branch: { organizationId: tenant.organizationId } } },
        select: { id: true, name: true, departmentId: true, acceptingQueueEntries: true },
      }),
    ]);
    if (dto.patientId && !patient) throw new NotFoundException('Patient not found');
    if (!service) throw new NotFoundException('Service not found');
    if (!service.acceptingQueueEntries) {
      throw new ConflictException('This service is not currently accepting new queue entries');
    }

    try {
      const entryPriority = dto.priority ?? PriorityLevel.NORMAL;
      const priorityConfig = await this.prisma.priorityConfiguration.findFirst({
        where: {
          organizationId: tenant.organizationId,
          level: entryPriority,
          active: true,
          OR: [{ departmentId: service.departmentId }, { departmentId: null }],
        },
        orderBy: { departmentId: { sort: 'asc', nulls: 'last' } }, // Prioritize department config over org config
      });
      const defaultWeights: Record<PriorityLevel, number> = { [PriorityLevel.EMERGENCY]: 100, [PriorityLevel.VIP]: 80, [PriorityLevel.SENIOR_CITIZEN]: 60, [PriorityLevel.APPOINTMENT]: 40, [PriorityLevel.NORMAL]: 0 };
      const priorityWeight = priorityConfig ? priorityConfig.weight : defaultWeights[entryPriority];

      const entry = await this.prisma.$transaction(async (tx) => {
        await this.entitlements.lockOrganization(tenant.organizationId, tx);
        const waitingCount = await tx.queueEntry.count({
          where: { status: 'WAITING', service: { department: { branch: { organizationId: tenant.organizationId } } } },
        });
        await this.entitlements.enforceVolumeLimit(tenant.organizationId, 'maxWaitingQueueSize', waitingCount, 1, tx);

        return tx.queueEntry.create({
          data: { patientId: patient?.id ?? null, serviceId: service.id, activeEntryKey: patient ? `${patient.id}:${service.id}` : null, priority: entryPriority, priorityWeight },
          select: this.queueEntrySelect,
        });
      });
      if (auditContext) await this.audit.record({
        ...auditContext,
        organizationId: tenant.organizationId,
        branchId,
        action: AuditAction.QUEUE_ENTRY_CREATED,
        resourceType: AuditResourceType.QUEUE_ENTRY,
        resourceId: entry.id,
        metadata: { patientId: entry.patientId, patientNumber: patient?.patientNumber, serviceId: entry.serviceId, serviceName: service.name, status: entry.status },
      });
      return entry;
    } catch (error: unknown) {
      if (this.isUniqueError(error)) throw new ConflictException('Patient already has a waiting entry for this service');
      throw error;
    }
  }

  async list(tenant: Tenant, branchId: string, query: ListQueueEntriesDto) {
    await this.authorizeBranch(tenant, branchId);
    const serviceScope: Prisma.ServiceWhereInput = { department: { branchId, branch: { organizationId: tenant.organizationId } } };
    const where: Prisma.QueueEntryWhereInput = { service: serviceScope };
    if (query.status) where.status = query.status;
    if (query.patientId) where.patientId = query.patientId;
    if (query.serviceId) where.serviceId = query.serviceId;
    if (query.search?.trim()) {
      where.patient = { OR: [
        { patientNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { firstName: { contains: query.search.trim(), mode: 'insensitive' } },
        { lastName: { contains: query.search.trim(), mode: 'insensitive' } },
      ] };
    }
    const orderBy: Prisma.QueueEntryOrderByWithRelationInput = { [query.sortBy]: query.sortOrder };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.queueEntry.findMany({ where, orderBy: [orderBy, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit, select: this.queueEntrySelect }),
      this.prisma.queueEntry.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async get(tenant: Tenant, branchId: string, queueEntryId: string) {
    await this.authorizeBranch(tenant, branchId);
    const entry = await this.findScopedEntry(tenant.organizationId, branchId, queueEntryId);
    if (!entry) throw new NotFoundException('Queue entry not found');
    return entry;
  }

  async cancel(tenant: Tenant, branchId: string, queueEntryId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const existing = await this.findScopedEntry(tenant.organizationId, branchId, queueEntryId);
    if (!existing) throw new NotFoundException('Queue entry not found');
    if (existing.status === QueueEntryStatus.CANCELLED) throw new ConflictException('Queue entry is already cancelled');
    const result = await this.prisma.queueEntry.updateMany({
      where: {
        id: queueEntryId,
        status: QueueEntryStatus.WAITING,
        service: { department: { branchId, branch: { organizationId: tenant.organizationId } } },
      },
      data: { status: QueueEntryStatus.CANCELLED, activeEntryKey: null },
    });
    if (result.count === 0) throw new ConflictException('Queue entry could not be cancelled');
    const entry = await this.get(tenant, branchId, queueEntryId);
    this.displayEvents.publish(branchId, 'QUEUE_UPDATED');
    if (auditContext) await this.audit.record({
      ...auditContext,
      organizationId: tenant.organizationId,
      branchId,
      action: AuditAction.QUEUE_ENTRY_CANCELLED,
      resourceType: AuditResourceType.QUEUE_ENTRY,
      resourceId: entry.id,
      metadata: { patientId: entry.patientId, patientNumber: entry.patient?.patientNumber, serviceId: entry.serviceId, serviceName: entry.service.name, status: entry.status },
    });
    return entry;
  }
  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) throw new ForbiddenException('You do not have access to this branch');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true, queueStatus: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private async findScopedEntry(organizationId: string, branchId: string, queueEntryId: string) {
    if (!isUUID(queueEntryId)) return null;
    return this.prisma.queueEntry.findFirst({
      where: { id: queueEntryId, service: { department: { branchId, branch: { organizationId } } } },
      select: this.queueEntrySelect,
    });
  }

  private readonly queueEntrySelect = {
    id: true,
    patientId: true,
    serviceId: true,
    status: true,
    priority: true,
    priorityWeight: true,
    createdAt: true,
    updatedAt: true,
    patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } },
    service: { select: { id: true, name: true, department: { select: { id: true, name: true } } } },
    token: { select: { id: true, displayNumber: true, status: true } },
  } satisfies Prisma.QueueEntrySelect;

  private isUniqueError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
