import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditResourceType, BranchStatus, QueueStatus, Prisma } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { ListBranchesDto } from './dto/list-branches.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateQueueConfigurationDto } from './dto/update-queue-configuration.dto';
import { CreateBranchHolidayDto } from './dto/create-branch-holiday.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async getOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async updateOrganization(
    organizationId: string,
    dto: UpdateOrganizationDto,
    auditContext?: AuditContext,
  ) {
    try {
      const organization = await this.prisma.organization.update({
        where: { id: organizationId },
        data: dto,
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (auditContext) {
        await this.audit.record({
          ...auditContext,
          organizationId,
          branchId: null,
          action: AuditAction.ORGANIZATION_UPDATED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organization.id,
          metadata: { name: organization.name, slug: organization.slug, status: organization.status, changedFields: Object.keys(dto) },
        });
      }
      return organization;
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Organization not found');
    }
  }

  async createBranch(organizationId: string, dto: CreateBranchDto, auditContext?: AuditContext) {
    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        await this.entitlements.lockOrganization(organizationId, tx);
        const currentCount = await tx.branch.count({ where: { organizationId } });
        await this.entitlements.enforceLimit(organizationId, 'maxBranches', currentCount, 1, tx);

        return tx.branch.create({
          data: { ...dto, organizationId },
          select: this.branchSelect,
        });
      });
      if (auditContext) {
        await this.audit.record({
          ...auditContext,
          organizationId,
          branchId: branch.id,
          action: AuditAction.BRANCH_CREATED,
          resourceType: AuditResourceType.BRANCH,
          resourceId: branch.id,
          metadata: { name: branch.name, code: branch.code, status: branch.status },
        });
      }
      return branch;
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Branch could not be created');
    }
  }

  async listBranches(organizationId: string, query: ListBranchesDto) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where: { organizationId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: this.branchSelect,
      }),
      this.prisma.branch.count({ where: { organizationId } }),
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

  async getBranch(organizationId: string, branchId: string) {
    if (!isUUID(branchId)) {
      throw new NotFoundException('Branch not found');
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId },
      select: this.branchSelect,
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async updateBranch(
    organizationId: string,
    branchId: string,
    dto: UpdateBranchDto,
    auditContext?: AuditContext,
  ) {
    await this.getBranch(organizationId, branchId);

    try {
      const branch = await this.prisma.branch.update({
        where: { id: branchId },
        data: dto,
        select: this.branchSelect,
      });
      if (auditContext) {
        await this.audit.record({
          ...auditContext,
          organizationId,
          branchId,
          action: AuditAction.BRANCH_UPDATED,
          resourceType: AuditResourceType.BRANCH,
          resourceId: branch.id,
          metadata: { name: branch.name, code: branch.code, status: branch.status, changedFields: Object.keys(dto) },
        });
      }
      return branch;
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Branch could not be updated');
    }
  }

  async setBranchStatus(
    organizationId: string,
    branchId: string,
    status: BranchStatus,
    auditContext?: AuditContext,
  ) {
    await this.getBranch(organizationId, branchId);

    const branch = await this.prisma.branch.update({
      where: { id: branchId },
      data: { status },
      select: this.branchSelect,
    });
    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId,
        branchId,
        action: status === BranchStatus.ACTIVE ? AuditAction.BRANCH_ACTIVATED : AuditAction.BRANCH_DEACTIVATED,
        resourceType: AuditResourceType.BRANCH,
        resourceId: branch.id,
        metadata: { name: branch.name, code: branch.code, status: branch.status },
      });
    }
    return branch;
  }
  async setBranchQueueStatus(
    organizationId: string,
    branchId: string,
    queueStatus: QueueStatus,
    auditContext?: AuditContext,
  ) {
    await this.getBranch(organizationId, branchId);

    const branch = await this.prisma.branch.update({
      where: { id: branchId },
      data: { queueStatus },
      select: this.branchSelect,
    });

    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId,
        branchId,
        action: queueStatus === QueueStatus.PAUSED ? AuditAction.QUEUE_PAUSED : AuditAction.QUEUE_RESUMED,
        resourceType: AuditResourceType.BRANCH,
        resourceId: branch.id,
        metadata: { name: branch.name, code: branch.code, status: branch.status, queueStatus: branch.queueStatus },
      });
    }
    return branch;
  }

  async getQueueConfiguration(organizationId: string, branchId: string) {
    await this.getBranch(organizationId, branchId);
    let config = await this.prisma.queueConfiguration.findUnique({ where: { branchId } });
    if (!config) {
      config = await this.prisma.queueConfiguration.create({ data: { branchId } });
    }
    return config;
  }

  async updateQueueConfiguration(organizationId: string, branchId: string, dto: UpdateQueueConfigurationDto, auditContext?: AuditContext) {
    await this.getBranch(organizationId, branchId);
    const config = await this.prisma.queueConfiguration.upsert({
      where: { branchId },
      create: { ...dto, branchId },
      update: dto,
    });
    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId,
        branchId,
        action: AuditAction.QUEUE_CONFIGURATION_UPDATED,
        resourceType: AuditResourceType.QUEUE_CONFIGURATION,
        resourceId: config.id,
        metadata: { changedFields: Object.keys(dto) },
      });
    }
    return config;
  }

  async getHolidays(organizationId: string, branchId: string) {
    await this.getBranch(organizationId, branchId);
    return this.prisma.branchHoliday.findMany({ where: { branchId }, orderBy: { date: 'asc' } });
  }

  async addHoliday(organizationId: string, branchId: string, dto: CreateBranchHolidayDto, auditContext?: AuditContext) {
    await this.getBranch(organizationId, branchId);
    try {
      const date = new Date(dto.date);
      const holiday = await this.prisma.branchHoliday.create({ data: { branchId, date, description: dto.description ?? null } });
      if (auditContext) {
        await this.audit.record({ ...auditContext, organizationId, branchId, action: AuditAction.BRANCH_SETTINGS_UPDATED, resourceType: AuditResourceType.BRANCH, resourceId: branchId, metadata: { action: 'HOLIDAY_ADDED', date: dto.date } });
      }
      return holiday;
    } catch (e: unknown) {
      this.handlePrismaError(e, 'Failed to add holiday');
    }
  }

  async removeHoliday(organizationId: string, branchId: string, dateStr: string, auditContext?: AuditContext) {
    await this.getBranch(organizationId, branchId);
    const date = new Date(dateStr);
    const result = await this.prisma.branchHoliday.deleteMany({ where: { branchId, date } });
    if (result.count === 0) throw new NotFoundException('Holiday not found');
    if (auditContext) {
        await this.audit.record({ ...auditContext, organizationId, branchId, action: AuditAction.BRANCH_SETTINGS_UPDATED, resourceType: AuditResourceType.BRANCH, resourceId: branchId, metadata: { action: 'HOLIDAY_REMOVED', date: dateStr } });
    }
    return { success: true };
  }

  private readonly branchSelect = {
    id: true,
    organizationId: true,
    name: true,
    code: true,
    status: true,
    queueStatus: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.BranchSelect;

  private handlePrismaError(error: unknown, notFoundMessage: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('A resource with the same identifier already exists');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException(notFoundMessage);
      }
    }

    throw error;
  }
}
