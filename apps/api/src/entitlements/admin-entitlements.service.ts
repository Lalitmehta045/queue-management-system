import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResourceType, Prisma, SubscriptionStatus } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignOrganizationSubscriptionDto } from './dto/assign-organization-subscription.dto';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateOrganizationSubscriptionDto } from './dto/update-organization-subscription.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { normalizePlanFeatures, normalizePlanLimits } from './entitlements.service';

const PLAN_SELECT = {
  id: true,
  name: true,
  code: true,
  description: true,
  monthlyPrice: true,
  yearlyPrice: true,
  active: true,
  limits: true,
  features: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubscriptionPlanSelect;

const SUBSCRIPTION_SELECT = {
  id: true,
  organizationId: true,
  planId: true,
  status: true,
  startsAt: true,
  endsAt: true,
  trialEndsAt: true,
  createdAt: true,
  updatedAt: true,
  plan: {
    select: {
      id: true,
      name: true,
      code: true,
      active: true,
      limits: true,
      features: true,
    },
  },
} satisfies Prisma.OrganizationSubscriptionSelect;

@Injectable()
export class AdminEntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------
  // Subscription plans
  // ---------------------------------------------------------------

  async listPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: PLAN_SELECT,
    });
  }

  async getPlan(planId: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      select: PLAN_SELECT,
    });
    if (!plan) throw new NotFoundException('Subscription plan not found');
    return plan;
  }

  async createPlan(dto: CreateSubscriptionPlanDto, auditContext?: AuditContext) {
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        description: dto.description ?? null,
        monthlyPrice: dto.monthlyPrice ?? 0,
        yearlyPrice: dto.yearlyPrice ?? 0,
        active: dto.active ?? true,
        limits: normalizePlanLimits(dto.limits),
        features: normalizePlanFeatures(dto.features),
      },
      select: PLAN_SELECT,
    });

    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        branchId: null,
        action: AuditAction.SUBSCRIPTION_PLAN_CREATED,
        resourceType: AuditResourceType.SUBSCRIPTION_PLAN,
        resourceId: plan.id,
        metadata: { name: plan.name, code: plan.code },
      });
    }
    return plan;
  }

  async updatePlan(planId: string, dto: UpdateSubscriptionPlanDto, auditContext?: AuditContext) {
    await this.getPlan(planId);
    const data: Prisma.SubscriptionPlanUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.monthlyPrice !== undefined) data.monthlyPrice = dto.monthlyPrice;
    if (dto.yearlyPrice !== undefined) data.yearlyPrice = dto.yearlyPrice;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.limits !== undefined) data.limits = normalizePlanLimits(dto.limits);
    if (dto.features !== undefined) data.features = normalizePlanFeatures(dto.features);

    const plan = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data,
      select: PLAN_SELECT,
    });

    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        branchId: null,
        action: AuditAction.SUBSCRIPTION_PLAN_UPDATED,
        resourceType: AuditResourceType.SUBSCRIPTION_PLAN,
        resourceId: plan.id,
        metadata: { name: plan.name, code: plan.code, changedFields: Object.keys(dto) },
      });
    }
    return plan;
  }

  async setPlanActive(planId: string, active: boolean, auditContext?: AuditContext) {
    await this.getPlan(planId);
    const plan = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: { active },
      select: PLAN_SELECT,
    });

    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        branchId: null,
        action: active
          ? AuditAction.SUBSCRIPTION_PLAN_ACTIVATED
          : AuditAction.SUBSCRIPTION_PLAN_DEACTIVATED,
        resourceType: AuditResourceType.SUBSCRIPTION_PLAN,
        resourceId: plan.id,
        metadata: { name: plan.name, code: plan.code, active: plan.active },
      });
    }
    return plan;
  }

  // ---------------------------------------------------------------
  // Organization subscriptions
  // ---------------------------------------------------------------

  async getOrganizationSubscription(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const subscription = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: SUBSCRIPTION_SELECT,
    });

    return {
      organization,
      subscription: subscription ?? null,
    };
  }

  async assignOrganizationSubscription(
    organizationId: string,
    dto: AssignOrganizationSubscriptionDto,
    auditContext?: AuditContext,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const existing = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        errorCode: 'SUBSCRIPTION_EXISTS',
        message: 'Organization already has a subscription. Use PATCH to update it.',
      });
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Subscription plan not found');
    if (!plan.active) {
      throw new ConflictException({
        errorCode: 'PLAN_INACTIVE',
        message: 'Cannot assign an inactive subscription plan.',
      });
    }

    const subscription = await this.prisma.organizationSubscription.create({
      data: {
        organizationId,
        planId: plan.id,
        status: dto.status ?? SubscriptionStatus.TRIAL,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        trialEndsAt: dto.trialEndsAt ? new Date(dto.trialEndsAt) : null,
      },
      select: SUBSCRIPTION_SELECT,
    });

    if (auditContext) {
      await this.audit.record({
        ...auditContext,
        organizationId,
        branchId: null,
        action: AuditAction.SUBSCRIPTION_CREATED,
        resourceType: AuditResourceType.ORGANIZATION_SUBSCRIPTION,
        resourceId: subscription.id,
        metadata: {
          planId: subscription.planId,
          status: subscription.status,
          startsAt: subscription.startsAt.toISOString(),
        },
      });
    }
    return subscription;
  }

  async updateOrganizationSubscription(
    organizationId: string,
    dto: UpdateOrganizationSubscriptionDto,
    auditContext?: AuditContext,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const existing = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Organization does not have a subscription. Use POST to assign one.',
      });
    }

    if (dto.planId !== undefined) {
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new NotFoundException('Subscription plan not found');
      if (!plan.active) {
        throw new ConflictException({
          errorCode: 'PLAN_INACTIVE',
          message: 'Cannot assign an inactive subscription plan.',
        });
      }
    }

    const data: Prisma.OrganizationSubscriptionUpdateInput = {};
    if (dto.planId !== undefined) data.plan = { connect: { id: dto.planId } };
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.startsAt !== undefined) data.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) data.endsAt = new Date(dto.endsAt);
    if (dto.trialEndsAt !== undefined) data.trialEndsAt = new Date(dto.trialEndsAt);

    const subscription = await this.prisma.organizationSubscription.update({
      where: { organizationId },
      data,
      select: SUBSCRIPTION_SELECT,
    });

    if (auditContext) {
      const action =
        dto.status === SubscriptionStatus.CANCELLED
          ? AuditAction.SUBSCRIPTION_CANCELLED
          : dto.status === SubscriptionStatus.EXPIRED
            ? AuditAction.SUBSCRIPTION_EXPIRED
            : AuditAction.SUBSCRIPTION_UPDATED;
      await this.audit.record({
        ...auditContext,
        organizationId,
        branchId: null,
        action,
        resourceType: AuditResourceType.ORGANIZATION_SUBSCRIPTION,
        resourceId: subscription.id,
        metadata: {
          planId: subscription.planId,
          status: subscription.status,
          changedFields: Object.keys(dto),
        },
      });
    }
    return subscription;
  }
}
