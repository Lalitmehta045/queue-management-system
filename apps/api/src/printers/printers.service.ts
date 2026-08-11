/* eslint-disable */
import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException, MessageEvent } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes, createHash } from 'crypto';
import { AuditAction, AuditResourceType, PrintJobStatus, PrinterStatus, Role, Prisma } from '@prisma/client';
import { Observable, Subject, filter, map } from 'rxjs';
import { TicketPrintService } from '../notifications/ticket-print.service';

interface PrintJobEvent {
  printerId: string;
  jobId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class PrintersService {
  private readonly jobSubject = new Subject<PrintJobEvent>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketPrintService: TicketPrintService
  ) {}

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  async createPrinter(organizationId: string, branchId: string, name: string, actorUserId: string) {
    const pairingCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit PIN
    const pairingCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    
    const printer = await this.prisma.printer.create({
      data: {
        branchId,
        name,
        pairingCode,
        pairingCodeExpiresAt,
        status: PrinterStatus.OFFLINE
      }
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        branchId,
        actorUserId,
        action: AuditAction.PRINTER_CREATED,
        resourceType: AuditResourceType.PRINTER,
        resourceId: printer.id,
        metadata: { name }
      }
    });

    return { id: printer.id, name: printer.name, pairingCode };
  }

  async listPrinters(branchId: string) {
    return this.prisma.printer.findMany({
      where: { branchId },
      select: { id: true, name: true, status: true, lastSeen: true, lastError: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getPrinterBridgeHealth(branchId: string, printerId: string) {
    const printer = await this.prisma.printer.findUnique({
      where: { id: printerId, branchId },
      select: { id: true, name: true, status: true, lastSeen: true, secretHash: true }
    });
    if (!printer) throw new NotFoundException('Printer not found');

    const pendingJobs = await this.prisma.printJob.count({
      where: { printerId, status: PrintJobStatus.PENDING, expiresAt: { gt: new Date() } }
    });

    const lastSuccess = await this.prisma.printJob.findFirst({
      where: { printerId, status: PrintJobStatus.PRINTED },
      orderBy: { printedAt: 'desc' },
      select: { printedAt: true }
    });

    const lastFailed = await this.prisma.printJob.findFirst({
      where: { printerId, status: PrintJobStatus.FAILED },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true }
    });

    return {
      printerId: printer.id,
      name: printer.name,
      registered: !!printer.secretHash,
      bridgeConnected: printer.status === PrinterStatus.ONLINE,
      pendingJobCount: pendingJobs,
      lastSuccessfulJob: lastSuccess?.printedAt || null,
      lastFailedJob: lastFailed?.updatedAt || null,
      lastSeen: printer.lastSeen
    };
  }

  async pairPrinter(pairingCode: string) {
    const printer = await this.prisma.printer.findUnique({ where: { pairingCode } });
    if (!printer) throw new UnauthorizedException('Invalid pairing code');
    if (printer.pairingCodeExpiresAt && printer.pairingCodeExpiresAt < new Date()) {
      throw new UnauthorizedException('Pairing code has expired');
    }

    const deviceSecret = randomBytes(32).toString('hex');
    const secretHash = this.hashSecret(deviceSecret);

    await this.prisma.printer.update({
      where: { id: printer.id },
      data: {
        pairingCode: null,
        pairingCodeExpiresAt: null,
        secretHash,
        status: PrinterStatus.ONLINE,
        lastSeen: new Date()
      }
    });

    const branch = await this.prisma.branch.findUnique({ where: { id: printer.branchId } });

    await this.prisma.auditLog.create({
      data: {
        organizationId: branch!.organizationId,
        branchId: printer.branchId,
        action: AuditAction.PRINTER_REGISTERED,
        resourceType: AuditResourceType.PRINTER,
        resourceId: printer.id,
        metadata: { event: 'paired' }
      }
    });

    return { printerId: printer.id, branchId: printer.branchId, deviceSecret };
  }

  private async authenticatePrinter(printerId: string, secret: string) {
    const printer = await this.prisma.printer.findUnique({ where: { id: printerId }, include: { branch: true } });
    if (!printer) throw new NotFoundException('Printer not found');
    if (!printer.secretHash || printer.secretHash !== this.hashSecret(secret)) {
      throw new UnauthorizedException('Invalid printer credentials');
    }
    return printer;
  }

  async createTokenPrintJob(branchId: string, printerId: string, tokenId: string, providedIdempotencyKey?: string) {
    const printer = await this.prisma.printer.findUnique({ where: { id: printerId, branchId } });
    if (!printer) throw new NotFoundException('Printer not found');

    const token = await this.prisma.token.findUnique({ where: { id: tokenId } });
    if (!token) throw new NotFoundException('Token not found');

    // Get ticket payload
    // We mock tenant for ticketPrintService as it just needs organizationId
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    const tenant = { organizationId: branch!.organizationId, branchId, role: Role.SUPER_ADMIN, userId: 'system', membershipId: 'system' };
    const payload = await this.ticketPrintService.getPrintTicket(tenant, 'system', branchId, tokenId);

    // Create job with idempotency
    const idempotencyKey = providedIdempotencyKey || `print_${tokenId}`;
    let job = await this.prisma.printJob.findUnique({ where: { idempotencyKey } });
    
    if (!job) {
      job = await this.prisma.printJob.create({
        data: {
          printerId,
          tokenId,
          idempotencyKey,
          status: PrintJobStatus.PENDING,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12) // 12 hours
        }
      });
      await this.prisma.auditLog.create({
        data: {
          organizationId: branch!.organizationId,
          branchId,
          action: AuditAction.PRINT_JOB_CREATED,
          resourceType: AuditResourceType.PRINT_JOB,
          resourceId: job.id,
          metadata: { printerId, tokenId }
        }
      });
    }

    if (job.status === PrintJobStatus.PENDING) {
      // Notify listeners
      this.jobSubject.next({
        printerId,
        jobId: job.id,
        payload
      });
    }

    return { jobId: job.id, status: job.status };
  }

  streamJobs(printerId: string, secret: string): Observable<MessageEvent> {
    // Authenticate once before subscribing
    this.authenticatePrinter(printerId, secret).catch(() => {}); 
    
    return this.jobSubject.pipe(
      filter(event => event.printerId === printerId),
      map(event => ({
        data: {
          jobId: event.jobId,
          payload: event.payload
        }
      }))
    );
  }

  async getPendingJobs(printerId: string, secret: string) {
    const printer = await this.authenticatePrinter(printerId, secret);
    
    const pendingJobs = await this.prisma.printJob.findMany({
      where: {
        printerId,
        status: PrintJobStatus.PENDING,
        expiresAt: { gt: new Date() }
      },
      include: { token: true },
      orderBy: { createdAt: 'asc' }
    });

    const jobs = [];
    const tenant = { organizationId: printer.branch.organizationId, branchId: printer.branchId, role: Role.SUPER_ADMIN, userId: 'system', membershipId: 'system' };

    for (const job of pendingJobs) {
      try {
        const payload = await this.ticketPrintService.getPrintTicket(tenant, 'system', printer.branchId, job.tokenId);
        jobs.push({ jobId: job.id, payload });
      } catch {
        // Skip if payload generation fails
      }
    }
    return jobs;
  }

  async updateJobStatus(printerId: string, secret: string, jobId: string, dto: { status: 'CLAIMED' | 'PRINTED' | 'FAILED'; lastError?: string }) {
    await this.authenticatePrinter(printerId, secret);
    
    const job = await this.prisma.printJob.findUnique({ where: { id: jobId, printerId } });
    if (!job) throw new NotFoundException('Job not found');

    const updateData: Prisma.PrintJobUpdateInput = {
      status: dto.status,
      lastError: dto.lastError || null
    };

    let whereCondition: any = { id: jobId, printerId };
    
    // State machine constraints
    if (dto.status === PrintJobStatus.CLAIMED) {
      whereCondition.status = PrintJobStatus.PENDING;
    } else if (dto.status === PrintJobStatus.PRINTED || dto.status === PrintJobStatus.FAILED) {
      whereCondition.status = PrintJobStatus.CLAIMED;
    }

    if (dto.status === PrintJobStatus.FAILED) {
      updateData.attempts = { increment: 1 };
    } else if (dto.status === PrintJobStatus.PRINTED) {
      updateData.printedAt = new Date();
    }

    const updated = await this.prisma.printJob.updateMany({
      where: whereCondition,
      data: updateData
    });

    if (updated.count === 0) {
      throw new ForbiddenException('Invalid state transition, concurrent claim, or job not found');
    }

    // Since updateMany doesn't return the record, we can fetch or just return success
    return { id: jobId, status: dto.status };
  }

  async updateHealth(printerId: string, secret: string, dto: { status: 'ONLINE' | 'OFFLINE' | 'ERROR'; lastError?: string }) {
    await this.authenticatePrinter(printerId, secret);
    
    return this.prisma.printer.update({
      where: { id: printerId },
      data: {
        status: dto.status,
        lastError: dto.lastError || null,
        lastSeen: new Date()
      },
      select: { id: true, status: true, lastSeen: true }
    });
  }
}
