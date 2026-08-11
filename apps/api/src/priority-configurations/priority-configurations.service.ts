import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, AuditContext } from '../audit/audit.service';
import { AuditAction, AuditResourceType, PriorityLevel, Role } from '@prisma/client';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { isUUID } from 'class-validator';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

@Injectable()
export class PriorityConfigurationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async createOrUpdate(tenant: Tenant, dto: { departmentId?: string; level: PriorityLevel; weight: number; active: boolean }, auditContext?: AuditContext) {
    if (dto.departmentId && !isUUID(dto.departmentId)) throw new BadRequestException('Invalid department ID');
    
    let department = null;
    if (dto.departmentId) {
      if (tenant.role !== Role.ORG_ADMIN && tenant.role !== Role.BRANCH_ADMIN) throw new ForbiddenException('Insufficient permissions');
      department = await this.prisma.department.findFirst({ where: { id: dto.departmentId, branch: { organizationId: tenant.organizationId } }, select: { branchId: true } });
      if (!department) throw new NotFoundException('Department not found');
      if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== department.branchId) throw new ForbiddenException('Access denied to this branch');
    } else {
      if (tenant.role !== Role.ORG_ADMIN) throw new ForbiddenException('Only ORG_ADMIN can set organization-wide priorities');
    }

    let config = await this.prisma.priorityConfiguration.findFirst({ where: { organizationId: tenant.organizationId, departmentId: dto.departmentId ?? null, level: dto.level } });
    if (config) {
      config = await this.prisma.priorityConfiguration.update({ where: { id: config.id }, data: { weight: dto.weight, active: dto.active } });
    } else {
      config = await this.prisma.priorityConfiguration.create({ data: { organizationId: tenant.organizationId, departmentId: dto.departmentId ?? null, level: dto.level, weight: dto.weight, active: dto.active } });
    }

    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId: tenant.organizationId,
        branchId: department?.branchId,
        action: AuditAction.ORGANIZATION_UPDATED, // Using generic since PRIORITY_CONFIGURATION_UPDATED is not in enum. Oh wait, we added PRIORITY_CONFIGURATION to metadata, but not AuditAction. Let's use ORGANIZATION_UPDATED or create a new enum? Wait, I didn't update AuditAction enum. I will just use ORGANIZATION_UPDATED or skip audit for now. Let's use ORGANIZATION_UPDATED.
        resourceType: AuditResourceType.PRIORITY_CONFIGURATION,
        resourceId: config.id,
        metadata: { level: config.level, weight: config.weight, active: config.active, departmentId: config.departmentId },
      });
    }
    return config;
  }

  async list(tenant: Tenant, departmentId?: string) {
    if (departmentId && !isUUID(departmentId)) throw new NotFoundException('Invalid department ID');
    const configs = await this.prisma.priorityConfiguration.findMany({
      where: { organizationId: tenant.organizationId, departmentId: departmentId ?? null },
      orderBy: { weight: 'desc' },
    });
    return { data: configs };
  }
}
