import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { Role, AuditResourceType } from '@prisma/client';
import { isUUID } from 'class-validator';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { FEATURES } from '../entitlements/features';

@Injectable()
export class SelfServiceService {
  constructor(
    private prisma: PrismaService,
    private appointments: AppointmentsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private parsePayload(payload: string) {
    const parts = payload.split(':');
    if (parts.length < 4 || parts[0] !== 'QMS') {
      throw new BadRequestException('Invalid QR format');
    }
    const version = parts[1];
    const type = parts[2];
    const opaqueIdentifier = parts.slice(3).join(':');
    if (version !== '1') throw new BadRequestException('Unsupported QR version');
    return { type, opaqueIdentifier };
  }

  async validateQr(payload: string, ipAddress?: string, userAgent?: string) {
    const { type, opaqueIdentifier } = this.parsePayload(payload);

    if (type === 'TOKEN') {
      if (!isUUID(opaqueIdentifier)) throw new BadRequestException('Invalid token identifier');
      return { type: 'TOKEN', data: { publicTokenId: opaqueIdentifier } };
    }

    if (type === 'APPT') {
      if (!isUUID(opaqueIdentifier)) throw new BadRequestException('Invalid appointment identifier');
      const appt = await this.prisma.appointment.findUnique({
        where: { id: opaqueIdentifier },
        select: {
          id: true,
          status: true,
          appointmentDate: true,
          startAt: true,
          patient: { select: { firstName: true, lastName: true } },
          service: { select: { name: true } },
          branch: { select: { name: true, organizationId: true, id: true } }
        }
      });
      if (!appt) throw new NotFoundException('Appointment not found');
      await this.entitlements.requireFeature(appt.branch.organizationId, FEATURES.SELF_SERVICE_CHECKIN);
      
      const initials = `${appt.patient.firstName[0]}${appt.patient.lastName[0]}`.toUpperCase();

      // Log the scan
      await this.prisma.auditLog.create({
        data: {
          organizationId: appt.branch.organizationId,
          branchId: appt.branch.id,
          action: 'APPOINTMENT_QR_SCANNED',
          resourceType: AuditResourceType.APPOINTMENT,
          resourceId: appt.id,
          ipAddress: ipAddress ?? 'unknown',
          userAgent: userAgent ?? 'unknown',
          metadata: { status: appt.status }
        }
      });

      return {
        type: 'APPOINTMENT',
        data: {
          appointmentId: appt.id,
          patientInitials: initials,
          serviceName: appt.service.name,
          branchName: appt.branch.name,
          date: appt.appointmentDate.toISOString(),
          time: appt.startAt.toISOString(),
          status: appt.status
        }
      };
    }

    throw new BadRequestException('Unsupported QR type');
  }

  async checkInQr(payload: string, ipAddress?: string, userAgent?: string) {
    const { type, opaqueIdentifier } = this.parsePayload(payload);
    
    if (type !== 'APPT') {
      throw new BadRequestException('QR code cannot be used for check-in');
    }

    if (!isUUID(opaqueIdentifier)) throw new BadRequestException('Invalid appointment identifier');
    
    const appt = await this.prisma.appointment.findUnique({
      where: { id: opaqueIdentifier },
      include: { branch: true, patient: true, service: true }
    });

    if (!appt) throw new NotFoundException('Appointment not found');

    await this.entitlements.requireFeature(appt.branch.organizationId, FEATURES.SELF_SERVICE_CHECKIN);

    const systemTenant = {
      organizationId: appt.branch.organizationId,
      membershipId: 'system-self-service',
      role: Role.SUPER_ADMIN, // Allows bypassing specific branch constraints if needed, but authorizeBranch handles it safely.
      branchId: appt.branchId,
    };

    const auditContext = {
      ipAddress: ipAddress ?? 'unknown',
      userAgent: userAgent ?? 'unknown',
      actorUserId: undefined,
      organizationId: systemTenant.organizationId,
    };

    if (appt.status === 'SCHEDULED') {
      try {
        await this.appointments.confirm(systemTenant, appt.branchId, appt.id, auditContext);
      } catch (err) {
        if (!(err instanceof ConflictException)) {
          throw err;
        }
      }
    }

    // Now call checkIn
    const result = await this.appointments.checkIn(systemTenant, appt.branchId, appt.id, auditContext);
    
    // Also record a self service specific audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId: systemTenant.organizationId,
        branchId: systemTenant.branchId,
        action: 'SELF_SERVICE_CHECK_IN',
        resourceType: AuditResourceType.APPOINTMENT,
        resourceId: appt.id,
        ipAddress: ipAddress ?? 'unknown',
        userAgent: userAgent ?? 'unknown',
        metadata: {
          queueEntryId: result.queueEntry?.id,
          tokenId: result.token?.id,
          displayNumber: result.token?.displayNumber
        }
      }
    });

    return {
      appointmentId: result.appointment.id,
      queueEntryId: result.queueEntry?.id,
      tokenId: result.token?.id,
      publicTokenId: result.token?.id, // same since Phase 17 uses token id as publicTokenId
      displayNumber: result.token?.displayNumber,
      serviceName: appt.service.name,
      patientInitials: `${appt.patient.firstName[0]}${appt.patient.lastName[0]}`.toUpperCase()
    };
  }
}
