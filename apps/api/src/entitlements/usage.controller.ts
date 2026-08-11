import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { EntitlementsService } from './entitlements.service';

@Controller('organizations/current/usage')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class UsageController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get()
  async getUsage(@CurrentTenant() tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    return this.entitlementsService.getUsage(tenant.organizationId);
  }
}
