import { Controller, Get, Param, Post, Req, Res, UseGuards, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { getAuditContext } from '../audit/audit-context';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { QueueCallingService } from './queue-calling.service';

@Controller('branches/:branchId/counters/:counterId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.COUNTER_OPERATOR)
export class QueueCallingController {
  constructor(private readonly queueCallingService: QueueCallingService) {}

  @Post('call-next')
  callNext(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueCallingService.callNext(requiredTenant, user.userId, branchId, counterId, getAuditContext(requiredTenant, user, request));
  }

  @Post('tokens/:tokenId/call')
  callSpecific(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string, @Param('tokenId') tokenId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueCallingService.callSpecific(requiredTenant, user.userId, branchId, counterId, tokenId, getAuditContext(requiredTenant, user, request));
  }

  @Get('current')
  async current(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Param('branchId') branchId: string, @Param('counterId') counterId: string, @Res() response: Response) {
    const current = await this.queueCallingService.current(this.requireTenant(tenant), user.userId, branchId, counterId);
    return response.status(200).json(current);
  }

  @Get('waiting')
  waiting(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    return this.queueCallingService.waiting(this.requireTenant(tenant), user.userId, branchId, counterId);
  }

  @Sse('events')
  streamEvents(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string): Observable<MessageEvent> {
    return this.queueCallingService.streamEvents(this.requireTenant(tenant), branchId);
  }

  @Post('current/recall')
  recall(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueCallingService.recall(requiredTenant, user.userId, branchId, counterId, getAuditContext(requiredTenant, user, request));
  }

  @Get('skipped')
  skippedTokens(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    return this.queueCallingService.skippedTokens(this.requireTenant(tenant), user.userId, branchId, counterId);
  }

  @Post('tokens/:tokenId/recall')
  recallSkippedToken(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string, @Param('tokenId') tokenId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueCallingService.recallSkippedToken(requiredTenant, user.userId, branchId, counterId, tokenId, getAuditContext(requiredTenant, user, request));
  }

  @Post('current/skip')
  skip(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueCallingService.skip(requiredTenant, user.userId, branchId, counterId, getAuditContext(requiredTenant, user, request));
  }

  @Post('current/complete')
  complete(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('counterId') counterId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.queueCallingService.complete(requiredTenant, user.userId, branchId, counterId, getAuditContext(requiredTenant, user, request));
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
