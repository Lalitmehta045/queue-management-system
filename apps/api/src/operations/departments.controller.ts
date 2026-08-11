import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DepartmentStatus, Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { getAuditContext } from '../audit/audit-context';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListResourcesDto } from './dto/list-resources.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { OperationsService } from './operations.service';

@Controller('branches/:branchId/departments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class DepartmentsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Post()
  @Roles(Role.ORG_ADMIN)
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: CreateDepartmentDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.createDepartment(requiredTenant.organizationId, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get()
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Query() query: ListResourcesDto) {
    return this.operationsService.listDepartments(this.organizationId(tenant), branchId, query);
  }

  @Get(':departmentId')
  get(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('departmentId') departmentId: string) {
    return this.operationsService.getDepartment(this.organizationId(tenant), branchId, departmentId);
  }

  @Patch(':departmentId')
  @Roles(Role.ORG_ADMIN)
  update(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('departmentId') departmentId: string, @Body() dto: UpdateDepartmentDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.updateDepartment(requiredTenant.organizationId, branchId, departmentId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Post(':departmentId/activate')
  @Roles(Role.ORG_ADMIN)
  activate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('departmentId') departmentId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.setDepartmentStatus(requiredTenant.organizationId, branchId, departmentId, DepartmentStatus.ACTIVE, getAuditContext(requiredTenant, user, request));
  }

  @Post(':departmentId/deactivate')
  @Roles(Role.ORG_ADMIN)
  deactivate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('departmentId') departmentId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.setDepartmentStatus(requiredTenant.organizationId, branchId, departmentId, DepartmentStatus.INACTIVE, getAuditContext(requiredTenant, user, request));
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }

  private organizationId(tenant: AuthenticatedRequest['tenant']): string {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant.organizationId;
  }
}
