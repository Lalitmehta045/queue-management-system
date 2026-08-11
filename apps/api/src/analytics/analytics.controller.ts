import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeatureGuard } from '../entitlements/feature.guard';
import { RequireFeature } from '../entitlements/feature.decorator';
import { FEATURES } from '../entitlements/features';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsService } from './analytics.service';
import { Throttle } from '@nestjs/throttler';

@Controller('branches/:branchId/analytics')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, FeatureGuard)
@RequireFeature(FEATURES.ANALYTICS)
@Throttle({ default: { limit: 1000, ttl: 60000 } })
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  getSummary(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getSummary(this.requireTenant(tenant), branchId, query);
  }

  @Get('services')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  getServicePerformance(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getServicePerformance(this.requireTenant(tenant), branchId, query);
  }

  @Get('counters')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  getCounterPerformance(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getCounterPerformance(this.requireTenant(tenant), branchId, query);
  }

  @Get('trends')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  getDailyTrend(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getDailyTrend(this.requireTenant(tenant), branchId, query);
  }

  @Get('appointments')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  getAppointmentSummary(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getAppointmentSummary(this.requireTenant(tenant), branchId, query);
  }

  @Get('export')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  async exportCsv(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: AnalyticsQueryDto & { type?: string },
    @Res() res: Response,
  ) {
    const type = query.type === 'counters' || query.type === 'trends' ? query.type : 'services';
    const csv = await this.analyticsService.exportCsv(this.requireTenant(tenant), branchId, query, type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=analytics-${type}.csv`);
    res.send(csv);
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
