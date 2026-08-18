import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { getAuditContext } from '../audit/audit-context';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GenerateTokenDto } from './dto/generate-token.dto';
import { BulkGenerateTokenDto } from './dto/bulk-generate-token.dto';
import { ListTokensDto } from './dto/list-tokens.dto';
import { TokensService } from './tokens.service';

@Controller('branches/:branchId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Post('queue-entries/:queueEntryId/token')
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  generate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('queueEntryId') queueEntryId: string, @Body() dto: GenerateTokenDto) {
    void dto;
    const requiredTenant = this.requireTenant(tenant);
    return this.tokensService.generate(requiredTenant, branchId, queueEntryId, getAuditContext(requiredTenant, user, request));
  }

  @Post('tokens/bulk')
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  generateBulk(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: BulkGenerateTokenDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.tokensService.generateBulk(requiredTenant, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get('queue-entries/:queueEntryId/token')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  getForQueueEntry(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('queueEntryId') queueEntryId: string) {
    return this.tokensService.getForQueueEntry(this.requireTenant(tenant), branchId, queueEntryId);
  }

  @Get('tokens')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Query() query: ListTokensDto) {
    return this.tokensService.list(this.requireTenant(tenant), branchId, query);
  }

  @Get('tokens/:tokenId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  get(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('tokenId') tokenId: string) {
    return this.tokensService.get(this.requireTenant(tenant), branchId, tokenId);
  }

  @Post('tokens/:tokenId/cancel')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  cancel(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('tokenId') tokenId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.tokensService.cancel(requiredTenant, branchId, tokenId, getAuditContext(requiredTenant, user, request));
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
