import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ValidatedEnvironment } from '../config/env.validation';
import { ALL_FEATURES, DEFAULT_FEATURES, FeatureKey, FeatureMap } from './features';

export const DEFAULT_PLAN_LIMITS = {
  maxBranches: 10,
  maxUsers: 100,
  maxCounters: 50,
  maxServices: 100,
  maxDisplays: 50,
  maxMonthlyTokens: 50000,
  maxDailyTokens: 2000,
  maxWaitingQueueSize: 1000,
} as const;

export type PlanLimitKey = keyof typeof DEFAULT_PLAN_LIMITS;
export type PlanLimits = Record<PlanLimitKey, number>;

/**
 * Subscription lifecycle policy (documented in docs/SUBSCRIPTIONS.md):
 *
 * | Status              | Existing data | Features | New provisioning |
 * |---------------------|---------------|----------|------------------|
 * | (no subscription)   | LEGACY        | full     | DEFAULT limits   |
 * | TRIAL               | full          | plan     | plan limits      |
 * | ACTIVE              | full          | plan     | plan limits      |
 * | PAST_DUE            | full          | plan     | blocked (SUBSCRIPTION_REQUIRED) |
 * | CANCELLED           | full          | plan     | blocked (SUBSCRIPTION_EXPIRED)   |
 * | EXPIRED             | full          | plan     | blocked (SUBSCRIPTION_EXPIRED)   |
 *
 * Data is NEVER automatically deleted or disabled for any status.
 * Limits resolve from the assigned plan whenever a subscription exists.
 */
const PROVISIONABLE_STATUSES: readonly SubscriptionStatus[] = ['TRIAL', 'ACTIVE'];

export type ResolvedSubscriptionAccess = {
  status: SubscriptionStatus | 'LEGACY';
  plan: {
    id: string;
    name: string;
    code: string;
    description: string | null;
    monthlyPrice: number;
    yearlyPrice: number;
    active: boolean;
    limits: PlanLimits;
    features: FeatureMap;
  } | null;
  limits: PlanLimits;
  features: FeatureMap;
  provisionable: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  trialEndsAt: Date | null;
};

const LEGACY_PLAN = {
  name: 'Legacy Plan',
  code: 'legacy',
  description: null,
  monthlyPrice: 0,
  yearlyPrice: 0,
  active: true,
} as const;

@Injectable()
export class EntitlementsService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) configService: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.timeZone = configService.get('TOKEN_TIME_ZONE');
  }

  // ---------------------------------------------------------------
  // Access resolution
  // ---------------------------------------------------------------

  private async resolveAccess(
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ResolvedSubscriptionAccess> {
    const db = tx || this.prisma;
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: { include: { plan: true } } },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    if (!org.subscription) {
      // Legacy organization — no explicit subscription. Keep working with
      // default limits and the full default feature set.
      return {
        status: 'LEGACY',
        plan: null,
        limits: { ...DEFAULT_PLAN_LIMITS },
        features: { ...DEFAULT_FEATURES },
        provisionable: true,
        startsAt: null,
        endsAt: null,
        trialEndsAt: null,
      };
    }

    const sub = org.subscription;
    const planLimits = normalizePlanLimits(sub.plan.limits);
    const planFeatures = normalizePlanFeatures(sub.plan.features);

    return {
      status: sub.status,
      plan: {
        id: sub.plan.id,
        name: sub.plan.name,
        code: sub.plan.code,
        description: sub.plan.description,
        monthlyPrice: Number(sub.plan.monthlyPrice),
        yearlyPrice: Number(sub.plan.yearlyPrice),
        active: sub.plan.active,
        limits: { ...DEFAULT_PLAN_LIMITS, ...planLimits },
        features: planFeatures,
      },
      limits: { ...DEFAULT_PLAN_LIMITS, ...planLimits },
      features: planFeatures,
      provisionable: PROVISIONABLE_STATUSES.includes(sub.status),
      startsAt: sub.startsAt,
      endsAt: sub.endsAt,
      trialEndsAt: sub.trialEndsAt,
    };
  }

  /** Resolve the effective resource limits for an organization. */
  async getEntitlements(organizationId: string, tx?: Prisma.TransactionClient): Promise<PlanLimits> {
    const access = await this.resolveAccess(organizationId, tx);
    return access.limits;
  }

  /** Resolve the effective feature entitlements for an organization. */
  async getFeatures(organizationId: string, tx?: Prisma.TransactionClient): Promise<FeatureMap> {
    const access = await this.resolveAccess(organizationId, tx);
    return access.features;
  }

  /** Server-side feature entitlement check. */
  async hasFeature(
    organizationId: string,
    feature: FeatureKey,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const access = await this.resolveAccess(organizationId, tx);
    return access.features[feature] === true;
  }

  /** Server-side feature entitlement enforcement. */
  async requireFeature(
    organizationId: string,
    feature: FeatureKey,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const access = await this.resolveAccess(organizationId, tx);
    if (access.features[feature] !== true) {
      throw new ForbiddenException({
        errorCode: 'FEATURE_NOT_AVAILABLE',
        feature,
        message: `The "${feature}" feature is not included in your current plan.`,
      });
    }
  }

  // ---------------------------------------------------------------
  // Subscription lifecycle
  // ---------------------------------------------------------------

  private provisioningError(status: SubscriptionStatus | 'LEGACY'): ForbiddenException {
    if (status === 'PAST_DUE') {
      return new ForbiddenException({
        errorCode: 'SUBSCRIPTION_REQUIRED',
        status,
        message:
          'Your subscription is past due. Existing data remains available, but new resources cannot be provisioned until the subscription is renewed.',
      });
    }
    return new ForbiddenException({
      errorCode: 'SUBSCRIPTION_EXPIRED',
      status,
      message:
        'Your subscription is no longer active. Existing data remains available, but new resources cannot be provisioned until the subscription is restored.',
    });
  }

  /**
   * Block new resource provisioning for non-provisionable subscription
   * statuses. Existing resources are NEVER touched.
   */
  async requireProvisioningAllowed(
    organizationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const access = await this.resolveAccess(organizationId, tx);
    if (!access.provisionable) {
      throw this.provisioningError(access.status);
    }
  }

  /**
   * Enforce a plan limit for NEW resource provisioning (branches, users,
   * counters, services, displays). Must be called inside the SAME PostgreSQL
   * transaction that (1) locked the organization row, (2) counted current
   * usage, and (3) will create the resource — never split check & create.
   *
   * Also blocks provisioning entirely when the subscription status does not
   * allow it (PAST_DUE / CANCELLED / EXPIRED).
   */
  async enforceLimit(
    organizationId: string,
    resourceType: PlanLimitKey,
    currentCount: number,
    increment: number = 1,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const access = await this.resolveAccess(organizationId, tx);

    if (!access.provisionable) {
      throw this.provisioningError(access.status);
    }

    this.assertWithinLimit(access.limits, resourceType, currentCount, increment);
  }

  /**
   * Enforce a volume cap (maxDailyTokens, maxWaitingQueueSize). These cap
   * operational volume but are NOT blocked by subscription status — existing
   * queue operations must keep working for PAST_DUE / CANCELLED / EXPIRED
   * organizations.
   */
  async enforceVolumeLimit(
    organizationId: string,
    resourceType: PlanLimitKey,
    currentCount: number,
    increment: number = 1,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const access = await this.resolveAccess(organizationId, tx);
    this.assertWithinLimit(access.limits, resourceType, currentCount, increment);
  }

  private assertWithinLimit(
    limits: PlanLimits,
    resourceType: PlanLimitKey,
    currentCount: number,
    increment: number,
  ): void {
    const limit = limits[resourceType];
    if (currentCount + increment > limit) {
      throw new ConflictException({
        errorCode: 'PLAN_LIMIT_REACHED',
        resourceType,
        limit,
        message: `Plan limit reached for ${resourceType}. Maximum allowed is ${limit}.`,
      });
    }
  }

  /** Lock the organization row to serialize concurrent limit enforcement. */
  async lockOrganization(organizationId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
  }

  // ---------------------------------------------------------------
  // Safe view models
  // ---------------------------------------------------------------

  async getSubscriptionDetails(organizationId: string) {
    const access = await this.resolveAccess(organizationId);

    const plan = access.plan ?? {
      ...LEGACY_PLAN,
      limits: { ...DEFAULT_PLAN_LIMITS },
      features: { ...DEFAULT_FEATURES },
    };

    return {
      organizationId,
      hasActiveSubscription: access.status !== 'LEGACY',
      status: access.status,
      plan,
      limits: access.limits,
      features: access.features,
      startsAt: access.startsAt,
      endsAt: access.endsAt,
      trialEndsAt: access.trialEndsAt,
    };
  }

  /** Current usage vs. plan limits for the organization's own dashboard. */
  async getUsage(organizationId: string) {
    const access = await this.resolveAccess(organizationId);
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });

    const [branches, users, counters, services, displays, waitingQueue, dailyTokens] =
      await Promise.all([
        this.prisma.branch.count({ where: { organizationId } }),
        this.prisma.membership.count({ where: { organizationId, status: 'ACTIVE' } }),
        this.prisma.counter.count({ where: { branch: { organizationId } } }),
        this.prisma.service.count({ where: { department: { branch: { organizationId } } } }),
        this.prisma.display.count({ where: { branch: { organizationId } } }),
        this.prisma.queueEntry.count({
          where: { status: 'WAITING', patient: { branch: { organizationId } } },
        }),
        this.prisma.token.count({
          where: {
            businessDate: this.businessDateToday(org?.timezone || undefined),
            queueEntry: { patient: { branch: { organizationId } } },
          },
        }),
      ]);

    return {
      branches: { used: branches, limit: access.limits.maxBranches },
      users: { used: users, limit: access.limits.maxUsers },
      counters: { used: counters, limit: access.limits.maxCounters },
      services: { used: services, limit: access.limits.maxServices },
      displays: { used: displays, limit: access.limits.maxDisplays },
      dailyTokens: { used: dailyTokens, limit: access.limits.maxDailyTokens },
      waitingQueue: { used: waitingQueue, limit: access.limits.maxWaitingQueueSize },
    };
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  private businessDateToday(timezone?: string, now = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || this.timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    );
    return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  }
}

// ---------------------------------------------------------------
// Plan JSON normalization (shared with admin plan management)
// ---------------------------------------------------------------

/** Coerce raw plan limit JSON into a safe, known-key number map. */
export function normalizePlanLimits(raw: unknown): Partial<PlanLimits> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const normalized: Partial<PlanLimits> = {};
  for (const key of ALL_LIMIT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      normalized[key] = Math.floor(value);
    }
  }
  return normalized;
}

/** Coerce raw plan feature JSON into a safe known-key boolean map. */
export function normalizePlanFeatures(raw: unknown): FeatureMap {
  const result: FeatureMap = { ...DEFAULT_FEATURES };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const key of ALL_FEATURES) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'boolean') result[key] = value;
  }
  return result;
}

const ALL_LIMIT_KEYS = Object.keys(DEFAULT_PLAN_LIMITS) as PlanLimitKey[];
