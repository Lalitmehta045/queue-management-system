import { Controller, Post, Get, Patch, Body, Param, Req, UseGuards, Sse, ForbiddenException, UnauthorizedException, HttpCode, HttpStatus, ParseUUIDPipe, MessageEvent } from '@nestjs/common';
import { PrintersService } from './printers.service';
import { FeatureGuard } from '../entitlements/feature.guard';
import { RequireFeature } from '../entitlements/feature.decorator';
import { FEATURES } from '../entitlements/features';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty, IsEnum, IsOptional, MaxLength } from 'class-validator';

export interface TenantContext {
  organizationId: string;
  membershipId: string;
  role: Role;
  branchId: string | null;
}

export class CreatePrinterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

export class PairPrinterDto {
  @IsString()
  @IsNotEmpty()
  pairingCode!: string;
}

export class UpdatePrinterHealthDto {
  @IsEnum(['ONLINE', 'OFFLINE', 'ERROR'])
  status!: 'ONLINE' | 'OFFLINE' | 'ERROR';

  @IsString()
  @IsOptional()
  lastError?: string;
}

export class UpdatePrintJobDto {
  @IsEnum(['CLAIMED', 'PRINTED', 'FAILED'])
  status!: 'CLAIMED' | 'PRINTED' | 'FAILED';

  @IsString()
  @IsOptional()
  lastError?: string;
}

@Controller()
export class PrintersController {
  constructor(private readonly printersService: PrintersService) {}

  // 1. Admin route: Create printer
  @Post('branches/:branchId/printers')
  @UseGuards(JwtAuthGuard, TenantGuard, FeatureGuard)
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  @RequireFeature(FEATURES.THERMAL_PRINTING)
  async createPrinter(
    @CurrentTenant() tenant: TenantContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: CreatePrinterDto,
    @CurrentUser() user: { userId: string }
  ) {
    if (tenant.branchId && tenant.branchId !== branchId) throw new ForbiddenException();
    return this.printersService.createPrinter(tenant.organizationId, branchId, dto.name, user.userId);
  }

  // 2. Admin route: List printers
  @Get('branches/:branchId/printers')
  @UseGuards(JwtAuthGuard, TenantGuard, FeatureGuard)
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST)
  @RequireFeature(FEATURES.THERMAL_PRINTING)
  async listPrinters(
    @CurrentTenant() tenant: TenantContext,
    @Param('branchId', ParseUUIDPipe) branchId: string
  ) {
    if (tenant.branchId && tenant.branchId !== branchId) throw new ForbiddenException();
    return this.printersService.listPrinters(branchId);
  }

  // 3. Admin route: Print Token Ticket
  @Post('branches/:branchId/printers/:printerId/print-token/:tokenId')
  @UseGuards(JwtAuthGuard, TenantGuard, FeatureGuard)
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.BRANCH_ADMIN, Role.RECEPTIONIST, Role.COUNTER_OPERATOR)
  @RequireFeature(FEATURES.THERMAL_PRINTING)
  async printTokenTicket(
    @CurrentTenant() tenant: TenantContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @Body('idempotencyKey') idempotencyKey?: string
  ) {
    if (tenant.branchId && tenant.branchId !== branchId) throw new ForbiddenException();
    return this.printersService.createTokenPrintJob(branchId, printerId, tokenId, idempotencyKey);
  }

  // 4. Bridge route: Pair
  @Post('printers/pair')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async pairPrinter(@Body() dto: PairPrinterDto) {
    return this.printersService.pairPrinter(dto.pairingCode);
  }

  // 5. Bridge route: Get pending jobs (fallback for polling if SSE disconnects)
  @Get('printers/:printerId/jobs')
  async getPendingJobs(
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Req() req: Request
  ) {
    const secret = req.headers['x-printer-secret'] as string;
    if (!secret) throw new UnauthorizedException('Missing printer secret');
    return this.printersService.getPendingJobs(printerId, secret);
  }

  // 6. Bridge route: SSE Stream of new jobs
  @Sse('printers/:printerId/stream')
  streamJobs(
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Req() req: Request
  ): Observable<MessageEvent> {
    const secret = req.headers['x-printer-secret'] as string;
    if (!secret) throw new UnauthorizedException('Missing printer secret');
    return this.printersService.streamJobs(printerId, secret);
  }

  // 7. Bridge route: Update job status
  @Patch('printers/:printerId/jobs/:jobId')
  @HttpCode(HttpStatus.OK)
  async updateJobStatus(
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: UpdatePrintJobDto,
    @Req() req: Request
  ) {
    const secret = req.headers['x-printer-secret'] as string;
    if (!secret) throw new UnauthorizedException('Missing printer secret');
    return this.printersService.updateJobStatus(printerId, secret, jobId, dto);
  }

  // 8. Admin route: Get Printer Bridge Health
  @Get('branches/:branchId/printers/:printerId/health')
  @UseGuards(JwtAuthGuard, TenantGuard, FeatureGuard)
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.BRANCH_ADMIN)
  @RequireFeature(FEATURES.THERMAL_PRINTING)
  async getPrinterBridgeHealth(
    @CurrentTenant() tenant: TenantContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('printerId', ParseUUIDPipe) printerId: string
  ) {
    if (tenant.branchId && tenant.branchId !== branchId) throw new ForbiddenException();
    return this.printersService.getPrinterBridgeHealth(branchId, printerId);
  }

  // 9. Bridge route: Health check / Status update
  @Patch('printers/:printerId/health')
  @HttpCode(HttpStatus.OK)
  async updateHealth(
    @Param('printerId', ParseUUIDPipe) printerId: string,
    @Body() dto: UpdatePrinterHealthDto,
    @Req() req: Request
  ) {
    const secret = req.headers['x-printer-secret'] as string;
    if (!secret) throw new UnauthorizedException('Missing printer secret');
    return this.printersService.updateHealth(printerId, secret, dto);
  }
}
