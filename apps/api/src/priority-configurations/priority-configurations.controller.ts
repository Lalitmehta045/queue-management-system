import { Body, Controller, Get, Post, Query, UseGuards, Req } from '@nestjs/common';
import { PriorityConfigurationsService } from './priority-configurations.service';
import { SetPriorityConfigurationDto } from './dto/set-priority-configuration.dto';
import { TenantGuard, AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Role } from '@prisma/client';
import { FeatureGuard } from '../entitlements/feature.guard';
import { RequireFeature } from '../entitlements/feature.decorator';
import { FEATURES } from '../entitlements/features';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

@Controller('priority-configurations')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PriorityConfigurationsController {
  constructor(private readonly service: PriorityConfigurationsService) {}

  @Get()
  async list(@CurrentTenant() tenant: Tenant, @Query('departmentId') departmentId?: string) {
    return this.service.list(tenant, departmentId);
  }

  @Post()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  @UseGuards(FeatureGuard)
  @RequireFeature(FEATURES.PRIORITY_QUEUE)
  async createOrUpdate(
    @CurrentTenant() tenant: Tenant,
    @Body() dto: SetPriorityConfigurationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const auditContext = {
      organizationId: tenant.organizationId,
      actorUserId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.service.createOrUpdate(tenant, dto, auditContext);
  }
}
