import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_ANNOUNCEMENT_TEMPLATE, validateAnnouncementTemplate } from './announcement-template';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

type SettingsUpdateFields = {
  announcementEnabled?: boolean;
  soundEnabled?: boolean;
  language?: string;
  speechRate?: number;
  announcementVolume?: number;
  announcementTemplate?: string;
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
};

export const NOTIFICATION_SETTINGS_DEFAULTS = {
  announcementEnabled: true,
  soundEnabled: true,
  language: 'en-US',
  speechRate: 1,
  announcementVolume: 1,
  announcementTemplate: DEFAULT_ANNOUNCEMENT_TEMPLATE,
  smsEnabled: false,
  whatsappEnabled: false,
} as const;

@Injectable()
export class NotificationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenant: Tenant, branchId: string) {
    await this.authorizeBranch(tenant, branchId);
    const settings = await this.prisma.notificationSetting.findUnique({ where: { branchId } });
    return settings ?? { branchId, ...NOTIFICATION_SETTINGS_DEFAULTS };
  }

  async update(tenant: Tenant, branchId: string, dto: UpdateNotificationSettingsDto) {
    await this.authorizeBranch(tenant, branchId);
    const data: SettingsUpdateFields = {};
    if (dto.announcementEnabled !== undefined) data.announcementEnabled = dto.announcementEnabled;
    if (dto.soundEnabled !== undefined) data.soundEnabled = dto.soundEnabled;
    if (dto.language !== undefined) data.language = dto.language;
    if (dto.speechRate !== undefined) data.speechRate = dto.speechRate;
    if (dto.announcementVolume !== undefined) data.announcementVolume = dto.announcementVolume;
    if (dto.announcementTemplate !== undefined) {
      validateAnnouncementTemplate(dto.announcementTemplate);
      data.announcementTemplate = dto.announcementTemplate;
    }
    if (dto.smsEnabled !== undefined) data.smsEnabled = dto.smsEnabled;
    if (dto.whatsappEnabled !== undefined) data.whatsappEnabled = dto.whatsappEnabled;
    return this.prisma.notificationSetting.upsert({
      where: { branchId },
      create: { branchId, ...data },
      update: data,
    });
  }

  /** Internal read used by the notification dispatcher without a tenant context. */
  async getEffective(branchId: string) {
    const settings = await this.prisma.notificationSetting.findUnique({ where: { branchId } });
    return settings ?? NOTIFICATION_SETTINGS_DEFAULTS;
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
}
