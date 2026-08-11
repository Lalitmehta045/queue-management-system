-- Phase 22 — SaaS subscription & entitlement management
-- Adds plan feature entitlements and subscription lifecycle audit actions.

-- SubscriptionPlan.features: JSON map of enabled feature keys for the plan.
-- Default '{}' means the plan inherits the full default feature set (all features enabled),
-- which preserves Phase 21 behavior for existing plans and legacy organizations.
ALTER TABLE "SubscriptionPlan" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';

-- New subscription lifecycle audit actions.
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_PLAN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_PLAN_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_PLAN_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_PLAN_DEACTIVATED';
