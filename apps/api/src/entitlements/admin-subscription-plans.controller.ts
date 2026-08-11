import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { getAuditContext } from '../audit/audit-context';
import { AdminEntitlementsService } from './admin-entitlements.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

/**
 * SUPER_ADMIN-only SaaS administration for subscription plans.
 * ORG_ADMIN / BRANCH_ADMIN / COUNTER_OPERATOR / RECEPTIONIST receive 403.
 */
@Controller('admin/subscription-plans')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSubscriptionPlansController {
  constructor(private readonly adminService: AdminEntitlementsService) {}

  @Get()
  list() {
    return this.adminService.listPlans();
  }

  @Post()
  create(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSubscriptionPlanDto,
  ) {
    return this.adminService.createPlan(dto, getAuditContext(tenant, user, request));
  }

  @Get(':id')
  get(@Param('id') planId: string) {
    return this.adminService.getPlan(planId);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('id') planId: string,
    @Body() dto: UpdateSubscriptionPlanDto,
  ) {
    return this.adminService.updatePlan(planId, dto, getAuditContext(tenant, user, request));
  }

  @Patch(':id/activate')
  activate(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('id') planId: string,
  ) {
    return this.adminService.setPlanActive(planId, true, getAuditContext(tenant, user, request));
  }

  @Patch(':id/deactivate')
  deactivate(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('id') planId: string,
  ) {
    return this.adminService.setPlanActive(planId, false, getAuditContext(tenant, user, request));
  }
}
