import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResourceType, Prisma, QueueEntryStatus, Role, TokenStatus } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { isUUID } from 'class-validator';
import { randomInt } from 'crypto';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { DisplayEventsService } from '../displays/display-events.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListTokensDto } from './dto/list-tokens.dto';
import { BulkGenerateTokenDto } from './dto/bulk-generate-token.dto';
import { QueueAllocationService } from '../queue-calling/queue-allocation.service';
import { GenerateTokenDto } from './dto/generate-token.dto';
import { getBusinessDate } from '../utils/date.util';


type Tenant = NonNullable<AuthenticatedRequest['tenant']>;
type BusinessDateKey = `${number}-${number}-${number}`;

class RetryableTokenGenerationError extends Error {}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly displayEvents: DisplayEventsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly queueAllocation: QueueAllocationService,
  ) {}

  async generate(
    tenant: Tenant,
    branchId: string,
    queueEntryId: string,
    dto?: GenerateTokenDto,
    auditContext?: AuditContext,
  ) {
    const activeDate = await this.getActiveBusinessDate(branchId);
    console.log('[DEBUG] TokensService.generate payload:', { dto, auditContext, tokenType: dto?.type });
    return this.generateForBusinessDate(tenant, branchId, queueEntryId, activeDate, dto, auditContext);
  }

  async generateForBusinessDate(tenant: Tenant, branchId: string, queueEntryId: string, businessDate: string, dto?: GenerateTokenDto, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const normalizedBusinessDate = this.parseBusinessDate(businessDate);
    const businessDateKey = businessDate as BusinessDateKey;

    const tokenType = dto?.type ?? 'NORMAL';
    const specialCategory = dto?.specialCategory ?? null;

    console.log('[DEBUG] TokensService.generateForBusinessDate tokenType resolved:', tokenType);

    if (tokenType === 'SPECIAL' && !specialCategory) {
      throw new BadRequestException('Special category is required for SPECIAL tokens');
    }
    if (tokenType === 'NORMAL' && specialCategory) {
      throw new BadRequestException('Special category must be null for NORMAL tokens');
    }

    await this.ensureSequence(branchId, await this.getQueueEntryServiceId(tenant.organizationId, branchId, queueEntryId), businessDateKey, tokenType);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const { token, created } = await this.prisma.$transaction(async (tx) => {
          await this.entitlements.lockOrganization(tenant.organizationId, tx);
          const dailyTokenCount = await tx.token.count({
            where: {
              businessDate: normalizedBusinessDate,
              queueEntry: {
                OR: [
                  { patientId: null, service: { department: { branch: { organizationId: tenant.organizationId } } } },
                  { patient: { branch: { organizationId: tenant.organizationId } } },
                ],
              },
            },
          });
          await this.entitlements.enforceVolumeLimit(tenant.organizationId, 'maxDailyTokens', dailyTokenCount, 1, tx);

          const lockedEntries = await tx.$queryRaw<{ id: string }[]>`
            SELECT q.id FROM "QueueEntry" q
            INNER JOIN "Service" s ON q."serviceId" = s.id
            INNER JOIN "Department" d ON s."departmentId" = d.id
            INNER JOIN "Branch" b ON d."branchId" = b.id
            WHERE q.id = ${queueEntryId}::uuid
              AND d."branchId" = ${branchId}::uuid
              AND b."organizationId" = ${tenant.organizationId}::uuid
            FOR UPDATE
          `;
          if (!lockedEntries.length) {
            console.error('LOCKED ENTRIES FAILED', { queueEntryId, branchId, orgId: tenant.organizationId });
            throw new NotFoundException('Queue entry not found or is not eligible for a token');
          }

          const queueEntry = await tx.queueEntry.findFirst({
            where: {
              id: queueEntryId,
              status: QueueEntryStatus.WAITING,
              OR: [
                { patientId: null },
                { patient: { branchId, status: 'ACTIVE', branch: { organizationId: tenant.organizationId } } },
              ],
              service: { status: 'ACTIVE', department: { branchId, branch: { organizationId: tenant.organizationId } } },
            },
            select: { id: true, patientId: true, serviceId: true, priority: true, token: { select: this.tokenSelect }, service: { select: { name: true } } },
          });
          if (!queueEntry) {
            console.error('FINDFIRST FAILED', { queueEntryId, branchId, orgId: tenant.organizationId });
            throw new NotFoundException('Queue entry not found or is not eligible for a token');
          }
          if (queueEntry.token) return { token: queueEntry.token, created: false };

          // Enforce priority adjustment for special tokens if not already handled
          if (tokenType === 'SPECIAL' && queueEntry.priority === 'NORMAL') {
            await tx.queueEntry.update({
              where: { id: queueEntry.id },
              data: { priority: 'SENIOR_CITIZEN', priorityWeight: 60 }
            });
          }

          const sequence = await tx.tokenSequence.findUnique({ where: { branchId_serviceId_businessDate_tokenType: { branchId, serviceId: queueEntry.serviceId, businessDate: normalizedBusinessDate, tokenType } } });
          if (!sequence) throw new RetryableTokenGenerationError('Token sequence was not available');
          const sequenceNumber = sequence.nextNumber;
          const claimed = await tx.tokenSequence.updateMany({ where: { id: sequence.id, nextNumber: sequenceNumber }, data: { nextNumber: { increment: 1 } } });
          if (claimed.count !== 1) throw new RetryableTokenGenerationError('Token sequence contention');

          const counterId = await this.queueAllocation.allocateWaitingToken(tx, branchId, tokenType);

          const token = await tx.token.create({
            data: {
              queueEntryId: queueEntry.id,
              sequenceId: sequence.id,
              sequenceNumber,
              displayNumber: this.displayNumber(sequenceNumber, tokenType),
              businessDate: normalizedBusinessDate,
              counterId,
              type: tokenType,
              specialCategory,
            },
            select: this.tokenSelect,
          });
          return { token, created: true };
        });
        this.displayEvents.publish(branchId, 'QUEUE_UPDATED');
        void this.notifications.onTokenCreated(branchId, token.id).catch(() => undefined);
        if (created && auditContext) await this.audit.record({
          ...auditContext,
          organizationId: tenant.organizationId,
          branchId,
          action: AuditAction.TOKEN_CREATED,
          resourceType: AuditResourceType.TOKEN,
          resourceId: token.id,
          metadata: { queueEntryId: token.queueEntryId, displayNumber: token.displayNumber, status: token.status, businessDate: token.businessDate },
        });
        return token;
      } catch (error: unknown) {
        if (error instanceof RetryableTokenGenerationError || this.isUniqueError(error)) {
          if (attempt < 49) {
            await this.waitForRetry(attempt);
            continue;
          }
          throw new ConflictException('Token generation is busy; please retry');
        }
        throw error;
      }
    }
    throw new ConflictException('Token generation is busy; please retry');
  }

  async generateBulk(tenant: Tenant, branchId: string, dto: BulkGenerateTokenDto, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const activeDate = await this.getActiveBusinessDate(branchId);
    const normalizedBusinessDate = this.parseBusinessDate(activeDate);
    const businessDateKey = activeDate;
    const serviceId = dto.serviceId;
    const quantity = dto.quantity;
    const tokenType = dto.type ?? 'NORMAL';
    const specialCategory = dto.specialCategory ?? null;

    if (tokenType === 'SPECIAL' && !specialCategory) {
      throw new BadRequestException('Special category is required for SPECIAL tokens');
    }
    if (tokenType === 'NORMAL' && specialCategory) {
      throw new BadRequestException('Special category must be null for NORMAL tokens');
    }

    let priority = dto.priority;
    if (tokenType === 'SPECIAL' && priority === 'NORMAL') {
      priority = 'SENIOR_CITIZEN';
    }

    const patientId = dto.patientId ?? null;

    // Verify service exists and is active
    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        status: 'ACTIVE',
        department: { branchId, branch: { organizationId: tenant.organizationId } },
      },
      select: { id: true, name: true, departmentId: true, acceptingQueueEntries: true },
    });
    
    if (!service) throw new NotFoundException('Service not found');
    if (!service.acceptingQueueEntries) throw new ConflictException('This service is not currently accepting new queue entries');

    let patient = null;
    if (patientId) {
      patient = await this.prisma.patient.findFirst({
        where: { id: patientId, branchId, status: 'ACTIVE', branch: { organizationId: tenant.organizationId } },
        select: { id: true, patientNumber: true },
      });
      if (!patient) throw new NotFoundException('Patient not found');
    }

    // Ensure sequence exists
    await this.ensureSequence(branchId, serviceId, businessDateKey, tokenType);

    const priorityConfig = await this.prisma.priorityConfiguration.findFirst({
      where: {
        organizationId: tenant.organizationId,
        level: priority,
        active: true,
        OR: [{ departmentId: service.departmentId }, { departmentId: null }],
      },
      orderBy: { departmentId: { sort: 'asc', nulls: 'last' } },
    });
    
    const defaultWeights: Record<string, number> = { EMERGENCY: 100, VIP: 80, SENIOR_CITIZEN: 60, APPOINTMENT: 40, NORMAL: 0 };
    const priorityWeight = priorityConfig ? priorityConfig.weight : defaultWeights[priority] ?? 0;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const tokens = await this.prisma.$transaction(async (tx) => {
          await this.entitlements.lockOrganization(tenant.organizationId, tx);
          
          const dailyTokenCount = await tx.token.count({
            where: {
              businessDate: normalizedBusinessDate,
              queueEntry: {
                OR: [
                  { patientId: null, service: { department: { branch: { organizationId: tenant.organizationId } } } },
                  { patient: { branch: { organizationId: tenant.organizationId } } },
                ],
              },
            },
          });
          await this.entitlements.enforceVolumeLimit(tenant.organizationId, 'maxDailyTokens', dailyTokenCount, quantity, tx);

          const waitingCount = await tx.queueEntry.count({
            where: { status: 'WAITING', service: { department: { branch: { organizationId: tenant.organizationId } } } },
          });
          await this.entitlements.enforceVolumeLimit(tenant.organizationId, 'maxWaitingQueueSize', waitingCount, quantity, tx);

          const sequence = await tx.tokenSequence.findUnique({ where: { branchId_serviceId_businessDate_tokenType: { branchId, serviceId, businessDate: normalizedBusinessDate, tokenType } } });
          if (!sequence) throw new RetryableTokenGenerationError('Token sequence was not available');
          const sequenceNumber = sequence.nextNumber;
          
          const claimed = await tx.tokenSequence.updateMany({
            where: { id: sequence.id, nextNumber: sequenceNumber },
            data: { nextNumber: { increment: quantity } },
          });
          if (claimed.count !== 1) throw new RetryableTokenGenerationError('Token sequence contention');

          const assignments = await this.queueAllocation.allocateWaitingTokensBulk(tx, branchId, quantity, tokenType);

          const createdTokens = [];
          for (let i = 0; i < quantity; i++) {
            const qe = await tx.queueEntry.create({
              data: {
                patientId: patient?.id ?? null,
                serviceId: service.id,
                activeEntryKey: null, // Left null for bulk tokens to avoid unique constraint if patientId is provided
                priority,
                priorityWeight,
              },
            });

            const token = await tx.token.create({
              data: {
                queueEntryId: qe.id,
                sequenceId: sequence.id,
                sequenceNumber: sequenceNumber + i,
                displayNumber: this.displayNumber(sequenceNumber + i, tokenType),
                businessDate: normalizedBusinessDate,
                counterId: assignments[i] ?? null,
                type: tokenType,
                specialCategory,
              },
              select: this.tokenSelect,
            });
            createdTokens.push(token);
          }
          return createdTokens;
        });

        this.displayEvents.publish(branchId, 'QUEUE_UPDATED');
        
        // Notify in background for all created tokens
        for (const token of tokens) {
          void this.notifications.onTokenCreated(branchId, token.id).catch(() => undefined);
        }
        
        if (auditContext) {
          await this.audit.record({
            ...auditContext,
            organizationId: tenant.organizationId,
            branchId,
            action: AuditAction.TOKEN_CREATED,
            resourceType: AuditResourceType.TOKEN,
            resourceId: tokens[0]!.id, // Reference first token
            metadata: { 
              bulk: true,
              quantity,
              serviceId,
              patientId,
              firstDisplayNumber: tokens[0]!.displayNumber,
              lastDisplayNumber: tokens[tokens.length - 1]!.displayNumber
            },
          });
        }
        return { count: tokens.length, tokens };
      } catch (error: unknown) {
        if (error instanceof RetryableTokenGenerationError || this.isUniqueError(error)) {
          if (attempt < 49) {
            await this.waitForRetry(attempt);
            continue;
          }
          throw new ConflictException('Token generation is busy; please retry');
        }
        this.logger.error('Failed to generate bulk tokens', error instanceof Error ? error.stack : error);
        throw error;
      }
    }
    throw new ConflictException('Token generation is busy; please retry');
  }

  async list(tenant: Tenant, branchId: string, query: ListTokensDto) {
    await this.authorizeBranch(tenant, branchId);
    const activeDateKey = query.businessDate ?? await this.getActiveBusinessDate(branchId);
    const businessDate = this.parseBusinessDate(activeDateKey);
    const queueEntryScope = this.getQueueEntryScope(tenant.organizationId, branchId);
    const where: Prisma.TokenWhereInput = { businessDate, queueEntry: queueEntryScope };
    if (query.status) where.status = query.status;
    if (query.serviceId) where.queueEntry = { ...queueEntryScope, serviceId: query.serviceId };
    if (query.patientId) where.queueEntry = { ...queueEntryScope, patientId: query.patientId };
    if (query.queueEntryId) where.queueEntry = { ...queueEntryScope, id: query.queueEntryId };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { displayNumber: { contains: search, mode: 'insensitive' } },
        { queueEntry: { ...queueEntryScope, patient: { patientNumber: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    const sortBy = query.sortBy || 'issuedAt';
    const sortOrder = query.sortOrder || 'asc';
    const orderBy: Prisma.TokenOrderByWithRelationInput = { [sortBy]: sortOrder };
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.token.findMany({ where, orderBy: [orderBy, { id: 'asc' }], skip: (page - 1) * limit, take: limit, select: this.tokenSelect }),
      this.prisma.token.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit), businessDate: activeDateKey } };
  }

  async get(tenant: Tenant, branchId: string, tokenId: string) {
    await this.authorizeBranch(tenant, branchId);
    const token = await this.findScopedToken(tenant.organizationId, branchId, tokenId);
    if (!token) throw new NotFoundException('Token not found');
    return token;
  }

  async getForQueueEntry(tenant: Tenant, branchId: string, queueEntryId: string) {
    await this.authorizeBranch(tenant, branchId);
    if (!isUUID(queueEntryId)) throw new NotFoundException('Token not found');
    const token = await this.prisma.token.findFirst({ where: { queueEntryId, queueEntry: this.getQueueEntryScope(tenant.organizationId, branchId) }, select: this.tokenSelect });
    if (!token) throw new NotFoundException('Token not found');
    return token;
  }

  async cancel(tenant: Tenant, branchId: string, tokenId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const existing = await this.findScopedToken(tenant.organizationId, branchId, tokenId);
    if (!existing) throw new NotFoundException('Token not found');
    if (existing.status === TokenStatus.CANCELLED) throw new ConflictException('Token is already cancelled');
    const result = await this.prisma.token.updateMany({ where: { id: tokenId, status: TokenStatus.WAITING, queueEntry: this.getQueueEntryScope(tenant.organizationId, branchId) }, data: { status: TokenStatus.CANCELLED } });
    if (result.count !== 1) throw new ConflictException('Token could not be cancelled');
    const token = await this.get(tenant, branchId, tokenId);
    this.displayEvents.publish(branchId, 'QUEUE_UPDATED');
    void this.notifications.onTokenCancelled(branchId, tokenId).catch(() => undefined);
    if (auditContext) await this.audit.record({
      ...auditContext,
      organizationId: tenant.organizationId,
      branchId,
      action: AuditAction.TOKEN_CANCELLED,
      resourceType: AuditResourceType.TOKEN,
      resourceId: token.id,
      metadata: { queueEntryId: token.queueEntryId, displayNumber: token.displayNumber, status: token.status, businessDate: token.businessDate },
    });
    return token;
  }

  async resetTokenSequence(tenant: Tenant, branchId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the branch row to prevent concurrent resets/token generation
      const lockedBranches = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Branch"
        WHERE id = ${branchId}::uuid
          AND "organizationId" = ${tenant.organizationId}::uuid
        FOR UPDATE
      `;
      if (!lockedBranches.length) throw new NotFoundException('Branch not found');

      // Count active tokens that will be affected
      const activeTokenCount = await tx.token.count({
        where: {
          status: { in: [TokenStatus.WAITING, TokenStatus.CALLED, TokenStatus.SERVING] },
          queueEntry: { service: { department: { branchId, branch: { organizationId: tenant.organizationId } } } },
        },
      });

      // Cancel all active tokens (WAITING/CALLED/SERVING → CANCELLED)
      if (activeTokenCount > 0) {
        await tx.token.updateMany({
          where: {
            status: { in: [TokenStatus.WAITING, TokenStatus.CALLED, TokenStatus.SERVING] },
            queueEntry: { service: { department: { branchId, branch: { organizationId: tenant.organizationId } } } },
          },
          data: { status: TokenStatus.CANCELLED },
        });
      }

      // Cancel all WAITING queue entries and clear activeEntryKey
      await tx.queueEntry.updateMany({
        where: {
          status: QueueEntryStatus.WAITING,
          service: { department: { branchId, branch: { organizationId: tenant.organizationId } } },
        },
        data: { status: QueueEntryStatus.CANCELLED, activeEntryKey: null },
      });

      const branch = await tx.branch.findUnique({
        where: { id: branchId },
        include: { organization: { select: { timezone: true } } },
      });
      if (!branch) throw new NotFoundException('Branch not found');

      const newBusinessDate = getBusinessDate(branch.organization.timezone);
      const candidateKey = newBusinessDate.toISOString().slice(0, 10) as BusinessDateKey;

      await tx.tokenSequence.updateMany({
        where: { branchId, businessDate: newBusinessDate },
        data: { nextNumber: 1 },
      });

      this.logger.log(`Token sequence reset for branch ${branchId}: ${activeTokenCount} tokens cancelled, new session date: ${candidateKey}`);

      return { cancelledTokens: activeTokenCount, newBusinessDate: candidateKey };
    });

    // Publish queue update event so public displays clear immediately
    this.displayEvents.publish(branchId, 'QUEUE_UPDATED');

    // Record audit log
    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId: tenant.organizationId,
        branchId,
        action: AuditAction.TOKEN_SEQUENCE_RESET,
        resourceType: AuditResourceType.TOKEN,
        resourceId: branchId,
        metadata: {
          cancelledTokens: result.cancelledTokens,
          newBusinessDate: result.newBusinessDate,
        },
      });
    }

    return { success: true, ...result };
  }

  async getActiveBusinessDate(branchId: string): Promise<BusinessDateKey> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      include: { organization: { select: { timezone: true } } },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    
    return getBusinessDate(branch.organization.timezone).toISOString().slice(0, 10) as BusinessDateKey;
  }

  private async getQueueEntryServiceId(organizationId: string, branchId: string, queueEntryId: string) {
    if (!isUUID(queueEntryId)) throw new NotFoundException('Queue entry not found');
    const entry = await this.prisma.queueEntry.findFirst({ where: { id: queueEntryId, status: QueueEntryStatus.WAITING, OR: [{ patientId: null }, { patient: { branchId, status: 'ACTIVE', branch: { organizationId } } }], service: { status: 'ACTIVE', department: { branchId, branch: { organizationId } } } }, select: { serviceId: true } });
    if (!entry) {
      console.error('getQueueEntryServiceId FAILED', { queueEntryId, branchId, orgId: organizationId });
      throw new NotFoundException('Queue entry not found');
    }
    return entry.serviceId;
  }

  private async ensureSequence(branchId: string, serviceId: string, businessDate: BusinessDateKey, tokenType: import('@prisma/client').TokenType) {
    try {
      await this.prisma.tokenSequence.create({ data: { branchId, serviceId, businessDate: this.toDate(businessDate), tokenType }, select: { id: true } });
    } catch (error: unknown) {
      if (!this.isUniqueError(error)) throw error;
    }
  }

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) throw new ForbiddenException('You do not have access to this branch');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private getQueueEntryScope(organizationId: string, branchId: string): Prisma.QueueEntryWhereInput {
    return {
      OR: [
        { patientId: null },
        { patient: { branchId, branch: { organizationId } } },
      ],
      service: { department: { branchId, branch: { organizationId } } },
    };
  }

  private async findScopedToken(organizationId: string, branchId: string, tokenId: string) {
    if (!isUUID(tokenId)) return null;
    return this.prisma.token.findFirst({ where: { id: tokenId, queueEntry: this.getQueueEntryScope(organizationId, branchId) }, select: this.tokenSelect });
  }

  private parseBusinessDate(value: string) {
    const date = this.toDate(value as BusinessDateKey);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid business date');
    return date;
  }

  private toDate(value: BusinessDateKey) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private displayNumber(sequenceNumber: number, tokenType: import('@prisma/client').TokenType = 'NORMAL') {
    const prefix = tokenType === 'SPECIAL' ? 'S' : 'T';
    return `${prefix}-${sequenceNumber.toString().padStart(3, '0')}`;
  }

  private async waitForRetry(attempt: number) {
    const delay = Math.min(50, 2 + attempt) + randomInt(0, 10);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  private readonly tokenSelect = {
    id: true,
    queueEntryId: true,
    sequenceNumber: true,
    displayNumber: true,
    businessDate: true,
    status: true,
    type: true,
    specialCategory: true,
    issuedAt: true,
    createdAt: true,
    updatedAt: true,
    queueEntry: { select: { id: true, priority: true, priorityWeight: true, patient: { select: { id: true, patientNumber: true, firstName: true, lastName: true } }, service: { select: { id: true, name: true, department: { select: { id: true, name: true } } } } } },
    counter: { select: { id: true, name: true, code: true } },
  } satisfies Prisma.TokenSelect;

  private isUniqueError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
