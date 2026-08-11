import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { getAuditContext } from '../audit/audit-context';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateQueueEntryDto } from './dto/create-queue-entry.dto';
import { ListQueueEntriesDto } from './dto/list-queue-entries.dto';
import { QueueEntriesService } from './queue-entries.service';
import { Throttle } from '@nestjs/throttler';

@Controller('branches/:branchId/queue-entries')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class QueueEntriesController {
  constructor(private readonly queueEntriesService: QueueEntriesService) {}

  @Post()
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: CreateQueueEntryDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueEntriesService.create(requiredTenant, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Query() query: ListQueueEntriesDto) {
    return this.queueEntriesService.list(this.requireTenant(tenant), branchId, query);
  }

  @Get(':queueEntryId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  get(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('queueEntryId') queueEntryId: string) {
    return this.queueEntriesService.get(this.requireTenant(tenant), branchId, queueEntryId);
  }

  @Post(':queueEntryId/cancel')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  cancel(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('queueEntryId') queueEntryId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueEntriesService.cancel(requiredTenant, branchId, queueEntryId, getAuditContext(requiredTenant, user, request));
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
