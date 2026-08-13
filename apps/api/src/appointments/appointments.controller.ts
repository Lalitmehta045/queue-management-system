import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { getAuditContext } from '../audit/audit-context';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeatureGuard } from '../entitlements/feature.guard';
import { RequireFeature } from '../entitlements/feature.decorator';
import { FEATURES } from '../entitlements/features';
import { AppointmentsService } from './appointments.service';
import { Throttle } from '@nestjs/throttler';

import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Controller('branches/:branchId/appointments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, FeatureGuard)
@RequireFeature(FEATURES.APPOINTMENTS)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: CreateAppointmentDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.appointmentsService.create(requiredTenant, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get('availability')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  availability(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Query('serviceId') serviceId: string, @Query('date') date: string) {
    return this.appointmentsService.availability(this.requireTenant(tenant), branchId, serviceId, date);
  }

  @Post(':appointmentId/check-in')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  checkIn(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('appointmentId') appointmentId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.appointmentsService.checkIn(requiredTenant, branchId, appointmentId, getAuditContext(requiredTenant, user, request));
  }

  @Post(':appointmentId/confirm')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  confirm(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('appointmentId') appointmentId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.appointmentsService.confirm(requiredTenant, branchId, appointmentId, getAuditContext(requiredTenant, user, request));
  }

  @Post(':appointmentId/cancel')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  cancel(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('appointmentId') appointmentId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.appointmentsService.cancel(requiredTenant, branchId, appointmentId, getAuditContext(requiredTenant, user, request));
  }

  @Post(':appointmentId/no-show')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  noShow(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('appointmentId') appointmentId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.appointmentsService.noShow(requiredTenant, branchId, appointmentId, getAuditContext(requiredTenant, user, request));
  }

  @Get(':appointmentId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  get(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('appointmentId') appointmentId: string) {
    return this.appointmentsService.get(this.requireTenant(tenant), branchId, appointmentId);
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
