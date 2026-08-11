import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FeatureGuard } from '../entitlements/feature.guard';
import { RequireFeature } from '../entitlements/feature.decorator';
import { FEATURES } from '../entitlements/features';
import { CreateDisplayDto } from './dto/create-display.dto';
import { UpdateDisplayDto } from './dto/update-display.dto';
import { DisplaysService } from './displays.service';

@Controller('branches/:branchId/displays')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, FeatureGuard)
@Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.BRANCH_ADMIN)
@RequireFeature(FEATURES.PUBLIC_DISPLAY)
export class DisplaysController {
  constructor(private readonly displaysService: DisplaysService) {}

  @Post()
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Body() dto: CreateDisplayDto) {
    return this.displaysService.create(this.requireTenant(tenant), branchId, dto);
  }

  @Get()
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string) {
    return this.displaysService.list(this.requireTenant(tenant), branchId);
  }

  @Patch(':displayId')
  update(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('displayId') displayId: string, @Body() dto: UpdateDisplayDto) {
    return this.displaysService.update(this.requireTenant(tenant), branchId, displayId, dto);
  }

  @Post(':displayId/activate')
  activate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('displayId') displayId: string) {
    return this.displaysService.setActive(this.requireTenant(tenant), branchId, displayId, true);
  }

  @Post(':displayId/deactivate')
  deactivate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('displayId') displayId: string) {
    return this.displaysService.setActive(this.requireTenant(tenant), branchId, displayId, false);
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
