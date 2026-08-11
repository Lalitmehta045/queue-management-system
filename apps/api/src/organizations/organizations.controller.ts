import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { BranchStatus, QueueStatus, Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getAuditContext } from '../audit/audit-context';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateBranchDto } from './dto/create-branch.dto';
import { ListBranchesDto } from './dto/list-branches.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateQueueConfigurationDto } from './dto/update-queue-configuration.dto';
import { CreateBranchHolidayDto } from './dto/create-branch-holiday.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations/current')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  getCurrentOrganization(@CurrentTenant() tenant: AuthenticatedRequest['tenant']) {
    return this.organizationsService.getOrganization(this.organizationId(tenant));
  }

  @Patch()
  @Roles(Role.ORG_ADMIN)
  updateCurrentOrganization(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateOrganizationDto,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.updateOrganization(requiredTenant.organizationId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Post('branches')
  @Roles(Role.ORG_ADMIN)
  createBranch(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateBranchDto,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.createBranch(requiredTenant.organizationId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get('branches')
  listBranches(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Query() query: ListBranchesDto,
  ) {
    return this.organizationsService.listBranches(this.organizationId(tenant), query);
  }

  @Get('branches/:branchId')
  getBranch(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
  ) {
    return this.organizationsService.getBranch(this.organizationId(tenant), branchId);
  }

  @Patch('branches/:branchId')
  @Roles(Role.ORG_ADMIN)
  updateBranch(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.updateBranch(requiredTenant.organizationId, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Post('branches/:branchId/activate')
  @Roles(Role.ORG_ADMIN)
  activateBranch(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.setBranchStatus(
      requiredTenant.organizationId,
      branchId,
      BranchStatus.ACTIVE,
      getAuditContext(requiredTenant, user, request),
    );
  }

  @Post('branches/:branchId/deactivate')
  @Roles(Role.ORG_ADMIN)
  deactivateBranch(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.setBranchStatus(
      requiredTenant.organizationId,
      branchId,
      BranchStatus.INACTIVE,
      getAuditContext(requiredTenant, user, request),
    );
  }

  @Post('branches/:branchId/queue-pause')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  pauseQueue(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.setBranchQueueStatus(
      requiredTenant.organizationId,
      branchId,
      QueueStatus.PAUSED,
      getAuditContext(requiredTenant, user, request),
    );
  }

  @Post('branches/:branchId/queue-resume')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  resumeQueue(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.setBranchQueueStatus(
      requiredTenant.organizationId,
      branchId,
      QueueStatus.OPEN,
      getAuditContext(requiredTenant, user, request),
    );
  }

  @Get('branches/:branchId/queue-config')
  getQueueConfiguration(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.getQueueConfiguration(requiredTenant.organizationId, branchId);
  }

  @Patch('branches/:branchId/queue-config')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  updateQueueConfiguration(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateQueueConfigurationDto,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.updateQueueConfiguration(requiredTenant.organizationId, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get('branches/:branchId/holidays')
  getHolidays(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @Param('branchId') branchId: string,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.getHolidays(requiredTenant.organizationId, branchId);
  }

  @Post('branches/:branchId/holidays')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  addHoliday(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
    @Body() dto: CreateBranchHolidayDto,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.addHoliday(requiredTenant.organizationId, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Delete('branches/:branchId/holidays/:date')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  removeHoliday(
    @CurrentTenant() tenant: AuthenticatedRequest['tenant'],
    @CurrentUser() user: { userId: string },
    @Req() request: AuthenticatedRequest,
    @Param('branchId') branchId: string,
    @Param('date') date: string,
  ) {
    const requiredTenant = this.requireTenant(tenant);
    return this.organizationsService.removeHoliday(requiredTenant.organizationId, branchId, date, getAuditContext(requiredTenant, user, request));
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    return tenant;
  }

  private organizationId(tenant: AuthenticatedRequest['tenant']): string {
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    return tenant.organizationId;
  }
}
