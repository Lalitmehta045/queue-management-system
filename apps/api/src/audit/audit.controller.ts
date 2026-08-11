import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeatureGuard } from '../entitlements/feature.guard';
import { RequireFeature } from '../entitlements/feature.decorator';
import { FEATURES } from '../entitlements/features';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

@Controller('branches/:branchId/audit-logs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, FeatureGuard)
@RequireFeature(FEATURES.AUDIT_LOGS)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  list(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: ListAuditLogsDto,
  ) {
    return this.auditService.list(this.requireTenant(tenant), branchId, query);
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
