import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { renderAnnouncement } from './announcement-template';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import {
  maskPhone,
  NotificationProvider,
  NotificationProviderToken,
  type ProviderResult,
} from './notification-providers';
import { NotificationSettingsService } from './notification-settings.service';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 80;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: NotificationSettingsService,
    @Inject(NotificationProviderToken) private readonly provider: NotificationProvider,
  ) {}

  async onTokenCreated(branchId: string, tokenId: string) {
    await this.dispatch(branchId, tokenId, NotificationEventType.TOKEN_CREATED);
  }

  async onTokenCalled(branchId: string, tokenId: string) {
    await this.dispatch(branchId, tokenId, NotificationEventType.TOKEN_CALLED);
  }

  async onTokenRecalled(branchId: string, tokenId: string) {
    await this.dispatch(branchId, tokenId, NotificationEventType.TOKEN_RECALLED);
  }

  async onTokenCompleted(branchId: string, tokenId: string) {
    await this.dispatch(branchId, tokenId, NotificationEventType.TOKEN_COMPLETED);
  }

  async onTokenCancelled(branchId: string, tokenId: string) {
    await this.dispatch(branchId, tokenId, NotificationEventType.TOKEN_CANCELLED);
  }

  // Appointment lifecycle hooks: use existing provider & settings, deliver asynchronously, and do not persist Notification records for appointment events.
  async onAppointmentCreated(branchId: string, appointmentId: string) {
    await this.dispatchAppointment(branchId, appointmentId, 'APPOINTMENT_CREATED');
  }

  async onAppointmentConfirmed(branchId: string, appointmentId: string) {
    await this.dispatchAppointment(branchId, appointmentId, 'APPOINTMENT_CONFIRMED');
  }

  async onAppointmentCheckedIn(branchId: string, appointmentId: string) {
    await this.dispatchAppointment(branchId, appointmentId, 'APPOINTMENT_CHECKED_IN');
  }

  async onAppointmentCancelled(branchId: string, appointmentId: string) {
    await this.dispatchAppointment(branchId, appointmentId, 'APPOINTMENT_CANCELLED');
  }

  async onAppointmentNoShow(branchId: string, appointmentId: string) {
    await this.dispatchAppointment(branchId, appointmentId, 'APPOINTMENT_NO_SHOW');
  }

  private async dispatchAppointment(branchId: string, appointmentId: string, kind: string) {
    try {
      await this.dispatchAppointmentUnsafe(branchId, appointmentId, kind);
    } catch (error: unknown) {
      this.logger.warn(`Appointment notification failed for ${appointmentId} (${kind}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async dispatchAppointmentUnsafe(branchId: string, appointmentId: string, kind: string) {
    // Lookup appointment + patient + service details
    if (!isUUID(branchId) || !isUUID(appointmentId)) return;
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, branchId }, select: { appointmentDate: true, startAt: true, patient: { select: { phone: true } }, service: { select: { name: true, department: { select: { name: true } } } } } });
    if (!appt) return;
    const phone = appt.patient.phone?.trim();
    if (!phone) return;

    const settings = await this.settingsService.getEffective(branchId);
    const message = `${kind.replace(/_/g, ' ')}: ${appt.service.name} on ${appt.appointmentDate.toISOString().slice(0,10)} at ${appt.startAt.toISOString().slice(11,16)}.`;

    const candidates: Array<{ channel: NotificationChannel; enabled: boolean }> = [
      { channel: NotificationChannel.SMS, enabled: settings.smsEnabled },
      { channel: NotificationChannel.WHATSAPP, enabled: settings.whatsappEnabled },
    ];

    for (const candidate of candidates) {
      if (!candidate.enabled) continue;
      await this.deliverAppointmentWithRetry(candidate.channel, phone, message);
    }
  }

  private async deliverAppointmentWithRetry(channel: NotificationChannel, recipient: string, message: string) {
    const MAX_ATTEMPTS_APPT = 3;
    const RETRY_DELAY_MS_APPT = 80;
    let attempts = 0;
    let lastError = 'UNKNOWN';
    while (attempts < MAX_ATTEMPTS_APPT) {
      attempts += 1;
      try {
        const result =
          channel === NotificationChannel.SMS
            ? await this.provider.sendSMS(recipient, message)
            : await this.provider.sendWhatsApp(recipient, message);
        if (result.ok) return;
        lastError = result.errorCode;
        if (!result.transient || attempts >= MAX_ATTEMPTS_APPT) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS_APPT * attempts));
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempts >= MAX_ATTEMPTS_APPT) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS_APPT * attempts));
      }
    }
    this.logger.warn(`Failed to deliver appointment notification to ${recipient}: ${lastError}`);
  }

  async list(tenant: Tenant, branchId: string, query: ListNotificationsDto) {
    await this.authorizeBranch(tenant, branchId);
    const where: Prisma.NotificationWhereInput = { branchId };
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: this.notificationSelect,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      data,
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  /**
   * Dispatch guard: notification failures must never affect the queue
   * operation that triggered them. Every failure is logged and swallowed.
   */
  private async dispatch(branchId: string, tokenId: string, eventType: NotificationEventType) {
    try {
      await this.dispatchUnsafe(branchId, tokenId, eventType);
    } catch (error: unknown) {
      this.logger.warn(
        `Notification dispatch failed for token ${tokenId} (${eventType}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async dispatchUnsafe(branchId: string, tokenId: string, eventType: NotificationEventType) {
    if (!isUUID(branchId) || !isUUID(tokenId)) return;
    const token = await this.prisma.token.findFirst({
      where: { id: tokenId, queueEntry: { patient: { branchId } } },
      select: {
        displayNumber: true,
        queueEntry: {
          select: {
            patient: { select: { phone: true } },
            service: { select: { name: true, department: { select: { name: true } } } },
          },
        },
        counter: { select: { name: true, code: true } },
      },
    });
    if (!token) return;
    const phone = token.queueEntry.patient?.phone?.trim();
    if (!phone) return;

    const settings = await this.settingsService.getEffective(branchId);
    const candidates: Array<{ channel: NotificationChannel; enabled: boolean }> = [
      { channel: NotificationChannel.SMS, enabled: settings.smsEnabled },
      { channel: NotificationChannel.WHATSAPP, enabled: settings.whatsappEnabled },
    ];

    const message = renderAnnouncement(settings.announcementTemplate, {
      token: token.displayNumber,
      counter: token.counter?.name ?? token.counter?.code ?? 'Counter',
      service: token.queueEntry.service.name,
    });

    for (const candidate of candidates) {
      if (!candidate.enabled) continue;
      await this.deliverWithRetry(branchId, tokenId, candidate.channel, eventType, phone, message);
    }
  }

  private async deliverWithRetry(
    branchId: string,
    tokenId: string,
    channel: NotificationChannel,
    eventType: NotificationEventType,
    recipient: string,
    message: string,
  ) {
    const record = await this.prisma.notification.create({
      data: {
        branchId,
        tokenId,
        channel,
        eventType,
        status: NotificationStatus.QUEUED,
        provider: this.provider.name,
      },
      select: { id: true },
    });

    let attempts = 0;
    let lastError = 'UNKNOWN';
    let result: ProviderResult;
    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      try {
        result =
          channel === NotificationChannel.SMS
            ? await this.provider.sendSMS(recipient, message)
            : await this.provider.sendWhatsApp(recipient, message);
      } catch (error: unknown) {
        this.logger.warn(
          `Provider threw for ${channel} to ${maskPhone(recipient)} (attempt ${attempts}/${MAX_ATTEMPTS}): ${error instanceof Error ? error.message : String(error)}`,
        );
        result = { ok: false, transient: true, errorCode: 'PROVIDER_EXCEPTION' };
      }

      if (result.ok) {
        await this.prisma.notification.update({
          where: { id: record.id },
          data: {
            status: result.delivered ? NotificationStatus.DELIVERED : NotificationStatus.SENT,
            providerMessageId: result.providerMessageId ?? null,
            attempts,
            sentAt: new Date(),
          },
        });
        return;
      }

      lastError = result.errorCode;
      if (!result.transient || attempts >= MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempts));
    }

    await this.prisma.notification.update({
      where: { id: record.id },
      data: { status: NotificationStatus.FAILED, attempts, errorCode: lastError, failedAt: new Date() },
    });
  }

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) {
      throw new ForbiddenException('You do not have access to this branch');
    }
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async getProviderHealth() {
    const status = await this.provider.status();
    return {
      provider: this.provider.name,
      status
    };
  }

  private readonly notificationSelect = {
    id: true,
    channel: true,
    eventType: true,
    status: true,
    provider: true,
    providerMessageId: true,
    attempts: true,
    errorCode: true,
    sentAt: true,
    failedAt: true,
    createdAt: true,
    token: { select: { displayNumber: true } },
  } satisfies Prisma.NotificationSelect;
}
