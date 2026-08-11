import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CounterStatus, Role } from '@prisma/client';
import { getAuditContext } from '../audit/audit-context';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssignOperatorDto } from './dto/assign-operator.dto';
import { CreateCounterDto } from './dto/create-counter.dto';
import { ListResourcesDto } from './dto/list-resources.dto';
import { UpdateCounterDto } from './dto/update-counter.dto';
import { CountersService } from './counters.service';

@Controller('branches/:branchId/counters')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class CountersController {
  constructor(private readonly countersService: CountersService) {}

  @Post()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: CreateCounterDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.countersService.create(requiredTenant, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Query() query: ListResourcesDto) {
    return this.countersService.list(this.requireTenant(tenant), branchId, query);
  }

  @Get('assigned')
  @Roles(Role.COUNTER_OPERATOR)
  assigned(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Param('branchId') branchId: string) {
    return this.countersService.listAssigned(this.requireTenant(tenant), user.userId, branchId);
  }

  @Get(':counterId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  get(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    return this.countersService.get(this.requireTenant(tenant), branchId, counterId);
  }

  @Patch(':counterId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  update(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string, @Body() dto: UpdateCounterDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.countersService.update(requiredTenant, branchId, counterId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Post(':counterId/activate')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  activate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.countersService.setStatus(requiredTenant, branchId, counterId, CounterStatus.ACTIVE, getAuditContext(requiredTenant, user, request));
  }

  @Post(':counterId/deactivate')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  deactivate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.countersService.setStatus(requiredTenant, branchId, counterId, CounterStatus.INACTIVE, getAuditContext(requiredTenant, user, request));
  }

  @Post(':counterId/operators')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  assign(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string, @Body() dto: AssignOperatorDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.countersService.assign(requiredTenant, branchId, counterId, dto.userId, getAuditContext(requiredTenant, user, request));
  }

  @Get(':counterId/operators')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  operators(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    return this.countersService.listOperators(this.requireTenant(tenant), branchId, counterId);
  }

  @Delete(':counterId/operators/:userId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  unassign(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string, @Param('userId') userId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.countersService.unassign(requiredTenant, branchId, counterId, userId, getAuditContext(requiredTenant, user, request));
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
