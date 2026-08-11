import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role, ServiceStatus } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { getAuditContext } from '../audit/audit-context';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListResourcesDto } from './dto/list-resources.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { OperationsService } from './operations.service';

@Controller('departments/:departmentId/services')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ServicesController {
  constructor(private readonly operationsService: OperationsService) {}

  @Post()
  @Roles(Role.ORG_ADMIN)
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('departmentId') departmentId: string, @Body() dto: CreateServiceDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.createService(requiredTenant.organizationId, departmentId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get()
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('departmentId') departmentId: string, @Query() query: ListResourcesDto) {
    return this.operationsService.listServices(this.organizationId(tenant), departmentId, query);
  }

  @Get(':serviceId')
  get(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('departmentId') departmentId: string, @Param('serviceId') serviceId: string) {
    return this.operationsService.getService(this.organizationId(tenant), departmentId, serviceId);
  }

  @Patch(':serviceId')
  @Roles(Role.ORG_ADMIN)
  update(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('departmentId') departmentId: string, @Param('serviceId') serviceId: string, @Body() dto: UpdateServiceDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.updateService(requiredTenant.organizationId, departmentId, serviceId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Post(':serviceId/activate')
  @Roles(Role.ORG_ADMIN)
  activate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('departmentId') departmentId: string, @Param('serviceId') serviceId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.setServiceStatus(requiredTenant.organizationId, departmentId, serviceId, ServiceStatus.ACTIVE, getAuditContext(requiredTenant, user, request));
  }

  @Post(':serviceId/deactivate')
  @Roles(Role.ORG_ADMIN)
  deactivate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('departmentId') departmentId: string, @Param('serviceId') serviceId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.operationsService.setServiceStatus(requiredTenant.organizationId, departmentId, serviceId, ServiceStatus.INACTIVE, getAuditContext(requiredTenant, user, request));
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
