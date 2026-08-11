import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CountersService } from './counters.service';

@Controller('branches/:branchId/operators')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class OperatorsController {
  constructor(private readonly countersService: CountersService) {}

  @Get()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string) {
    if (!tenant) throw new Error('Tenant context is required');
    return this.countersService.listEligibleOperators(tenant, branchId);
  }
}