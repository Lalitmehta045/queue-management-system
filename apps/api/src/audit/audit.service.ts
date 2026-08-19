import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResourceType, Prisma, Role } from '@prisma/client';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;
type JsonRecord = Record<string, Prisma.JsonValue>;

export type AuditContext = {
  organizationId: string;
  branchId?: string | null | undefined;
  actorUserId?: string | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export type AuditRecordInput = AuditContext & {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERN = /(password|token|secret|otp|authorization|cookie|session|hash|phone|email|firstName|lastName|notes)/i;

const METADATA_ALLOWLIST: Record<AuditResourceType, readonly string[]> = {
  AUTH: ['reason', 'knownUser', 'membershipCount'],
  ORGANIZATION: ['name', 'slug', 'status', 'changedFields'],
  BRANCH: ['name', 'code', 'status', 'changedFields'],
  DEPARTMENT: ['name', 'status', 'changedFields'],
  SERVICE: ['name', 'status', 'durationMinutes', 'changedFields'],
  COUNTER: ['name', 'code', 'status', 'changedFields'],
  OPERATOR_ASSIGNMENT: ['counterId', 'operatorUserId'],
  PATIENT: ['patientNumber', 'status', 'changedFields'],
  QUEUE_ENTRY: ['patientId', 'patientNumber', 'serviceId', 'serviceName', 'status'],
  TOKEN: ['queueEntryId', 'displayNumber', 'status', 'counterId', 'counterName', 'operatorUserId', 'recallCount', 'businessDate', 'cancelledTokens', 'newBusinessDate', 'bulk', 'quantity', 'serviceId', 'patientId', 'firstDisplayNumber', 'lastDisplayNumber'],
  APPOINTMENT: ['patientId', 'serviceId', 'appointmentDate', 'startAt', 'status', 'changedFields'],
  NOTIFICATION_SETTING: ['changedFields'],
  DISPLAY: ['name', 'active', 'changedFields'],
  PRIORITY_CONFIGURATION: ['level', 'weight', 'active', 'departmentId', 'changedFields'],
  PRINTER: ['branchId'],
  PRINT_JOB: ['printerId', 'tokenId'],
  SUBSCRIPTION_PLAN: ['name', 'code', 'description', 'monthlyPrice', 'yearlyPrice', 'active', 'limits', 'features', 'changedFields'],
  ORGANIZATION_SUBSCRIPTION: ['planId', 'status', 'startsAt', 'endsAt', 'trialEndsAt', 'changedFields'],
  QUEUE_CONFIGURATION: ['changedFields'],
  MEMBERSHIP: ['membershipId', 'changedFields'],
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          branchId: input.branchId ?? null,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          metadata: this.sanitizeMetadata(input.resourceType, input.metadata ?? {}),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        select: { id: true },
      });
    } catch (error: unknown) {
      this.logger.warn(`Audit write failed for ${input.action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async recordForActiveMemberships(
    userId: string,
    action: AuditAction,
    metadata: Record<string, unknown>,
    context: { actorUserId?: string | null; ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<void> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { organizationId: true, branchId: true },
    });
    for (const membership of memberships) {
      await this.record({
        organizationId: membership.organizationId,
        branchId: membership.branchId,
        actorUserId: context.actorUserId ?? null,
        action,
        resourceType: AuditResourceType.AUTH,
        resourceId: userId,
        metadata: { ...metadata, membershipCount: memberships.length },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  }

  async list(tenant: Tenant, branchId: string, query: ListAuditLogsDto) {
    await this.authorizeBranch(tenant, branchId);
    const where: Prisma.AuditLogWhereInput = {
      organizationId: tenant.organizationId,
      branchId,
    };
    if (query.action) where.action = query.action;
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(`${query.startDate}T00:00:00.000Z`);
      if (query.endDate) where.createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: this.auditSelect,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  sanitizeMetadata(resourceType: AuditResourceType, metadata: Record<string, unknown>): JsonRecord {
    const allowed = new Set(METADATA_ALLOWLIST[resourceType]);
    const sanitized: JsonRecord = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (!allowed.has(key) || SENSITIVE_KEY_PATTERN.test(key)) continue;
      const safeValue = this.toJsonValue(value);
      if (safeValue !== undefined) sanitized[key] = safeValue;
    }
    return sanitized;
  }

  private toJsonValue(value: unknown): Prisma.JsonValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      const values = value
        .map((item) => this.toJsonValue(item))
        .filter((item): item is Prisma.JsonValue => item !== undefined);
      return values;
    }
    return undefined;
  }

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) {
      throw new ForbiddenException('You do not have access to this branch');
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private readonly auditSelect = {
    id: true,
    organizationId: true,
    branchId: true,
    actorUserId: true,
    action: true,
    resourceType: true,
    resourceId: true,
    metadata: true,
    createdAt: true,
    actorUser: { select: { id: true, displayName: true } },
    branch: { select: { id: true, name: true, code: true } },
  } satisfies Prisma.AuditLogSelect;
}
