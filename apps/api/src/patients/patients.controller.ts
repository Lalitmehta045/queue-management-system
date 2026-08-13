import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PatientStatus, Role } from '@prisma/client';
import { getAuditContext } from '../audit/audit-context';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreatePatientDto } from './dto/create-patient.dto';
import { ListPatientsDto } from './dto/list-patients.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientsService } from './patients.service';

@Controller('branches/:branchId/patients')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  create(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Body() dto: CreatePatientDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.patientsService.create(requiredTenant, branchId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Get()
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  list(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Query() query: ListPatientsDto) {
    return this.patientsService.list(this.requireTenant(tenant), branchId, query);
  }

  @Get(':patientId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  get(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @Param('branchId') branchId: string, @Param('patientId') patientId: string) {
    return this.patientsService.get(this.requireTenant(tenant), branchId, patientId);
  }

  @Patch(':patientId')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  update(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('patientId') patientId: string, @Body() dto: UpdatePatientDto) {
    const requiredTenant = this.requireTenant(tenant);
    return this.patientsService.update(requiredTenant, branchId, patientId, dto, getAuditContext(requiredTenant, user, request));
  }

  @Post(':patientId/activate')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  activate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('patientId') patientId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.patientsService.setStatus(requiredTenant, branchId, patientId, PatientStatus.ACTIVE, getAuditContext(requiredTenant, user, request));
  }

  @Post(':patientId/deactivate')
  @Roles(Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  deactivate(@CurrentTenant() tenant: AuthenticatedRequest['tenant'], @CurrentUser() user: { userId: string }, @Req() request: AuthenticatedRequest, @Param('branchId') branchId: string, @Param('patientId') patientId: string) {
    const requiredTenant = this.requireTenant(tenant);
    return this.patientsService.setStatus(requiredTenant, branchId, patientId, PatientStatus.INACTIVE, getAuditContext(requiredTenant, user, request));
  }

  private requireTenant(tenant: AuthenticatedRequest['tenant']) {
    if (!tenant) throw new Error('Tenant context is required');
    return tenant;
  }
}
