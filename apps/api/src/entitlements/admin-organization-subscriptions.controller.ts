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
import { AssignOrganizationSubscriptionDto } from './dto/assign-organization-subscription.dto';
import { UpdateOrganizationSubscriptionDto } from './dto/update-organization-subscription.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

/**
 * SUPER_ADMIN-only management of a specific organization's subscription.
 * The target organization is taken from the URL path (never from the client
 * body); the caller's tenant context is only used for authentication + audit.
 */
@Controller('admin/organizations/:organizationId/subscription')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminOrganizationSubscriptionsController {
  constructor(private readonly adminService: AdminEntitlementsService) {}

  @Get()
  get(@Param('organizationId') organizationId: string) {
    return this.adminService.getOrganizationSubscription(organizationId);
  }

  @Post()
  assign(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() dto: AssignOrganizationSubscriptionDto,
  ) {
    return this.adminService.assignOrganizationSubscription(
      organizationId,
      dto,
      getAuditContext(tenant, user, request),
    );
  }

  @Patch()
  update(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateOrganizationSubscriptionDto,
  ) {
    return this.adminService.updateOrganizationSubscription(
      organizationId,
      dto,
      getAuditContext(tenant, user, request),
    );
  }
}
