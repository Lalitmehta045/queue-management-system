import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { EntitlementsService } from './entitlements.service';

@Controller('organizations/current/subscription')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get()
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async getSubscription(@CurrentTenant() tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    return this.entitlementsService.getSubscriptionDetails(tenant.organizationId);
  }
}
