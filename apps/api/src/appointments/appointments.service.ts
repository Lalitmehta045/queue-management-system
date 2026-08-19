import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, AuditAction, AuditResourceType, PriorityLevel } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { QueueEntriesService } from '../queue-entries/queue-entries.service';
import { TokensService } from '../tokens/tokens.service';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueEntries: QueueEntriesService,
    private readonly tokens: TokensService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) throw new ForbiddenException('You do not have access to this branch');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(tenant: Tenant, branchId: string, dto: { patientId: string; serviceId: string; appointmentDate: string; startTime: string; notes?: string }, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    // validate patient and service
    const [patient, service] = await this.prisma.$transaction([
      this.prisma.patient.findFirst({ where: { id: dto.patientId, branchId, status: 'ACTIVE', branch: { organizationId: tenant.organizationId } }, select: { id: true } }),
      this.prisma.service.findFirst({ where: { id: dto.serviceId, status: 'ACTIVE', department: { branchId, branch: { organizationId: tenant.organizationId } } }, select: { id: true, durationMinutes: true } }),
    ]);
    if (!patient) throw new NotFoundException('Patient not found or inactive');
    if (!service) throw new NotFoundException('Service not found or inactive');
    if (!dto.appointmentDate || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dto.appointmentDate)) throw new BadRequestException('Invalid appointmentDate');
    if (!dto.startTime || !/^[0-9]{2}:[0-9]{2}$/.test(dto.startTime)) throw new BadRequestException('Invalid startTime');

    // compose startAt and endAt (assume input times are local to business timezone and already normalized by client)
    const startAt = new Date(`${dto.appointmentDate}T${dto.startTime}:00Z`);
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('Invalid start time');
    const duration = service.durationMinutes ?? 15;
    if (!(Number.isInteger(duration) && duration > 0 && duration <= 60 * 24)) throw new BadRequestException('Invalid service duration');
    const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

    try {
      const appt = await this.prisma.appointment.create({ data: { patientId: patient.id, serviceId: service.id, branchId, appointmentDate: new Date(`${dto.appointmentDate}T00:00:00.000Z`), startAt, endAt, notes: dto.notes ?? null }, select: { id: true, patientId: true, serviceId: true, branchId: true, appointmentDate: true, startAt: true, endAt: true, status: true } });
      // Fire-and-forget notification hook
      void this.notifications.onAppointmentCreated(branchId, appt.id).catch(() => undefined);
      if (auditContext) {
        await this.audit.record({
          ...auditContext,
          organizationId: tenant.organizationId,
          branchId,
          action: AuditAction.APPOINTMENT_CREATED,
          resourceType: AuditResourceType.APPOINTMENT,
          resourceId: appt.id,
          metadata: { patientId: appt.patientId, serviceId: appt.serviceId, appointmentDate: dto.appointmentDate, startAt, status: appt.status },
        });
      }
      return appt;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Requested slot is already booked');
      }
      throw error;
    }
  }

  async get(tenant: Tenant, branchId: string, appointmentId: string) {
    await this.authorizeBranch(tenant, branchId);
    if (!isUUID(appointmentId)) throw new NotFoundException('Appointment not found');
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId, branch: { organizationId: tenant.organizationId } }, select: { id: true, patientId: true, serviceId: true, branchId: true, appointmentDate: true, startAt: true, endAt: true, status: true, notes: true } });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  async list(tenant: Tenant, branchId: string, query: { page: number; limit: number; status?: string; search?: string }) {
    await this.authorizeBranch(tenant, branchId);
    const where: Prisma.AppointmentWhereInput = { branchId, branch: { organizationId: tenant.organizationId } };
    
    if (query.status) {
      where.status = query.status as any;
    }
    
    if (query.search?.trim()) {
      where.patient = {
        OR: [
          { patientNumber: { contains: query.search.trim(), mode: 'insensitive' } },
          { firstName: { contains: query.search.trim(), mode: 'insensitive' } },
          { lastName: { contains: query.search.trim(), mode: 'insensitive' } },
        ],
      };
    }
    
    const [data, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        orderBy: { startAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true, patientId: true, serviceId: true, branchId: true, appointmentDate: true, startAt: true, endAt: true, status: true, notes: true,
          patient: { select: { patientNumber: true, firstName: true, lastName: true } },
          service: { select: { name: true, department: { select: { name: true } } } },
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);
    
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async confirm(tenant: Tenant, branchId: string, appointmentId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const existing = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId, branch: { organizationId: tenant.organizationId } } });
    if (!existing) throw new NotFoundException('Appointment not found');
    if (existing.status !== 'SCHEDULED') throw new ConflictException('Only scheduled appointments can be confirmed');
    const appt = await this.prisma.appointment.updateMany({ where: { id: appointmentId, status: 'SCHEDULED', branch: { organizationId: tenant.organizationId } }, data: { status: 'CONFIRMED' } });
    if (appt.count !== 1) throw new ConflictException('Appointment could not be confirmed');
    void this.notifications.onAppointmentConfirmed(branchId, appointmentId).catch(() => undefined);
    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId: tenant.organizationId,
        branchId,
        action: AuditAction.APPOINTMENT_UPDATED,
        resourceType: AuditResourceType.APPOINTMENT,
        resourceId: appointmentId,
        metadata: { status: 'CONFIRMED', changedFields: ['status'] },
      });
    }
    return this.get(tenant, branchId, appointmentId);
  }

  async cancel(tenant: Tenant, branchId: string, appointmentId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const existing = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId, branch: { organizationId: tenant.organizationId } } });
    if (!existing) throw new NotFoundException('Appointment not found');
    if (existing.status === 'CANCELLED') throw new ConflictException('Appointment is already cancelled');
    const res = await this.prisma.appointment.updateMany({ where: { id: appointmentId, status: { in: ['SCHEDULED','CONFIRMED'] }, branch: { organizationId: tenant.organizationId } }, data: { status: 'CANCELLED' } });
    if (res.count !== 1) throw new ConflictException('Appointment could not be cancelled');
    void this.notifications.onAppointmentCancelled(branchId, appointmentId).catch(() => undefined);
    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId: tenant.organizationId,
        branchId,
        action: AuditAction.APPOINTMENT_CANCELLED,
        resourceType: AuditResourceType.APPOINTMENT,
        resourceId: appointmentId,
        metadata: { status: 'CANCELLED', changedFields: ['status'] },
      });
    }
    return this.get(tenant, branchId, appointmentId);
  }

  async noShow(tenant: Tenant, branchId: string, appointmentId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const existing = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId, branch: { organizationId: tenant.organizationId } } });
    if (!existing) throw new NotFoundException('Appointment not found');
    if (existing.status !== 'CONFIRMED') throw new ConflictException('Only confirmed appointments can be marked no-show');
    const res = await this.prisma.appointment.updateMany({ where: { id: appointmentId, status: 'CONFIRMED', branch: { organizationId: tenant.organizationId } }, data: { status: 'NO_SHOW' } });
    if (res.count !== 1) throw new ConflictException('Appointment could not be marked no-show');
    void this.notifications.onAppointmentNoShow(branchId, appointmentId).catch(() => undefined);
    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId: tenant.organizationId,
        branchId,
        action: AuditAction.APPOINTMENT_UPDATED,
        resourceType: AuditResourceType.APPOINTMENT,
        resourceId: appointmentId,
        metadata: { status: 'NO_SHOW', changedFields: ['status'] },
      });
    }
    return this.get(tenant, branchId, appointmentId);
  }

  async availability(tenant: Tenant, branchId: string, serviceId: string, date: string) {
    await this.authorizeBranch(tenant, branchId);
    if (!serviceId) throw new BadRequestException('serviceId is required');
    if (!date || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) throw new BadRequestException('Invalid date');
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, status: 'ACTIVE', department: { branchId, branch: { organizationId: tenant.organizationId } } }, select: { id: true, durationMinutes: true } });
    if (!service) throw new NotFoundException('Service not found');
    const working = await this.prisma.branchWorkingHours.findMany({ where: { branchId, dayOfWeek: new Date(date).getUTCDay(), active: true }, orderBy: { dayOfWeek: 'asc' } });
    if (!working || working.length === 0) throw new NotFoundException('Branch working hours not configured for this day');
    const duration = service.durationMinutes ?? 15;
    // Gather existing appointments for date that are not cancelled or no-show
    const appts = await this.prisma.appointment.findMany({ where: { serviceId, appointmentDate: new Date(`${date}T00:00:00.000Z`), status: { not: 'CANCELLED' } }, select: { startAt: true, endAt: true, status: true } });

    const slots: Array<{ date: string; startTime: string; endTime: string; available: boolean }> = [];
    for (const w of working) {
      // parse openTime/closeTime HH:MM and build slots
      const [oh = 0, om = 0] = w.openTime.split(':').map((s) => parseInt(s, 10));
      const [ch = 0, cm = 0] = w.closeTime.split(':').map((s) => parseInt(s, 10));
      // build start pointer in minutes since midnight
      let ptr = oh * 60 + om;
      const endLimit = ch * 60 + cm;
      while (ptr + duration <= endLimit) {
        const sh = Math.floor(ptr / 60).toString().padStart(2, '0');
        const sm = (ptr % 60).toString().padStart(2, '0');
        const eh = Math.floor((ptr + duration) / 60).toString().padStart(2, '0');
        const em = ((ptr + duration) % 60).toString().padStart(2, '0');
        const startAt = new Date(`${date}T${sh}:${sm}:00Z`);
        const endAt = new Date(`${date}T${eh}:${em}:00Z`);
        const conflict = appts.some((a) => !(endAt <= a.startAt || startAt >= (a.endAt ?? a.startAt)));
        slots.push({ date, startTime: `${sh}:${sm}`, endTime: `${eh}:${em}`, available: !conflict });
        ptr += duration;
      }
    }
    return { date, serviceId, slots };
  }

  async checkIn(tenant: Tenant, branchId: string, appointmentId: string, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    
    // Check if appointment is expired (e.g. appointmentDate is in the past, ignoring time)
    const apptBefore = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId, branch: { organizationId: tenant.organizationId } } });
    if (!apptBefore) throw new NotFoundException('Appointment not found');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (apptBefore.appointmentDate < today) {
      throw new ConflictException('Appointment has expired');
    }

    // Try to atomically move appointment to CHECKED_IN if it is CONFIRMED
    const updated = await this.prisma.appointment.updateMany({ where: { id: appointmentId, status: 'CONFIRMED', branch: { organizationId: tenant.organizationId } }, data: { status: 'CHECKED_IN' } });
    if (updated.count === 0) {
      // Maybe already checked in
      const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId, branch: { organizationId: tenant.organizationId } } });
      if (!appt) throw new NotFoundException('Appointment not found');
      if (appt.status !== 'CHECKED_IN') throw new ConflictException('Appointment is not in a state that can be checked-in');
      // find existing queueEntry and token
      const entry = await this.prisma.queueEntry.findFirst({ where: { patientId: appt.patientId, serviceId: appt.serviceId }, orderBy: { createdAt: 'desc' } });
      if (!entry) {
        throw new ConflictException('Appointment check-in is already in progress, please wait and try again');
      }
      const token = await this.tokens.getForQueueEntry(tenant, branchId, entry.id).catch(() => null);
      return { appointment: appt, queueEntry: entry, token };
    }
    // Fetch appointment
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId, branch: { organizationId: tenant.organizationId } } });
    if (!appt) throw new NotFoundException('Appointment not found after update');
    // Create queue entry (idempotent through unique constraint in QueueEntry)
    let queueEntry;
    try {
      queueEntry = await this.queueEntries.create(tenant, branchId, { patientId: appt.patientId, serviceId: appt.serviceId, priority: PriorityLevel.APPOINTMENT });
    } catch (err) {
      // If conflict, fetch existing entry
      if (err instanceof ConflictException) {
        queueEntry = await this.prisma.queueEntry.findFirst({ where: { patientId: appt.patientId, serviceId: appt.serviceId }, orderBy: { createdAt: 'desc' } });
      } else {
        throw err;
      }
    }
    if (!queueEntry) throw new ConflictException('Could not create or find queue entry for appointment check-in');
    // Generate token (tokens service is idempotent per queueEntry)
    const token = await this.tokens.generate(tenant, branchId, queueEntry.id, auditContext);
    // Notification (fire-and-forget)
    void this.notifications.onAppointmentCheckedIn(branchId, appointmentId).catch(() => undefined);
    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId: tenant.organizationId,
        branchId,
        action: AuditAction.APPOINTMENT_UPDATED,
        resourceType: AuditResourceType.APPOINTMENT,
        resourceId: appointmentId,
        metadata: { status: 'CHECKED_IN', changedFields: ['status'] },
      });
    }
    return { appointment: appt, queueEntry, token };
  }
}
