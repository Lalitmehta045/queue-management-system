import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeatureGuard } from '../entitlements/feature.guard';
import { RequireFeature } from '../entitlements/feature.decorator';
import { FEATURES } from '../entitlements/features';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsService } from './notifications.service';
import { TicketPrintService } from './ticket-print.service';

@Controller('branches/:branchId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class NotificationsController {
  constructor(
    private readonly settingsService: NotificationSettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly ticketPrintService: TicketPrintService,
  ) {}

  @Get('notification-settings')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  @UseGuards(FeatureGuard)
  @RequireFeature(FEATURES.NOTIFICATIONS)
  getSettings(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string) {
    return this.settingsService.get(this.requireTenant(tenant), branchId);
  }

  @Patch('notification-settings')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  @UseGuards(FeatureGuard)
  @RequireFeature(FEATURES.NOTIFICATIONS)
  updateSettings(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.settingsService.update(this.requireTenant(tenant), branchId, dto);
  }

  @Get('notifications')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  @UseGuards(FeatureGuard)
  @RequireFeature(FEATURES.NOTIFICATIONS)
  list(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationsService.list(this.requireTenant(tenant), branchId, query);
  }

  @Get('notifications/health')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  @UseGuards(FeatureGuard)
  @RequireFeature(FEATURES.NOTIFICATIONS)
  getProviderHealth() {
    return this.notificationsService.getProviderHealth();
  }

  @Post('tokens/:tokenId/print')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  @UseGuards(FeatureGuard)
  @RequireFeature(FEATURES.THERMAL_PRINTING)
  print(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Param('branchId') branchId: string,
    @Param('tokenId') tokenId: string,
  ) {
    return this.ticketPrintService.getPrintTicket(this.requireTenant(tenant), user.userId, branchId, tokenId);
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
