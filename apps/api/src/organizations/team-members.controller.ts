import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MembershipStatus, Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';
import { TeamMembersService } from './team-members.service';

@Controller('organizations/current/team-members')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(Role.ORG_ADMIN)
export class TeamMembersController {
  constructor(private readonly teamMembersService: TeamMembersService) {}

  @Get()
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant']) {
    return this.teamMembersService.list(this.organizationId(tenant));
  }

  @Post()
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Body() dto: CreateTeamMemberDto) {
    return this.teamMembersService.create(this.organizationId(tenant), dto);
  }

  @Patch(':membershipId')
  update(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('membershipId') membershipId: string, @Body() dto: UpdateTeamMemberDto) {
    return this.teamMembersService.update(this.organizationId(tenant), membershipId, dto);
  }

  @Post(':membershipId/activate')
  activate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('membershipId') membershipId: string) {
    return this.teamMembersService.setStatus(this.organizationId(tenant), membershipId, MembershipStatus.ACTIVE);
  }

  @Post(':membershipId/deactivate')
  deactivate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('membershipId') membershipId: string) {
    return this.teamMembersService.setStatus(this.organizationId(tenant), membershipId, MembershipStatus.SUSPENDED);
  }

  private organizationId(tenant: AuthenticatedRequest['tenant']): string {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant.organizationId;
  }
}
