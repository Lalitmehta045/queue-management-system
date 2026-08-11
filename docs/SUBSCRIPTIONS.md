# Subscriptions (Phase 22)

This document describes the SaaS subscription layer introduced on top of the
Phase 21 entitlement engine. It covers plans, the organization subscription
lifecycle, administrative APIs, RBAC, tenant isolation, error codes, and known
limitations.

## Overview

- **Stack:** PostgreSQL + Prisma + NestJS (no Redis, no BullMQ, no background
  workers, no payment gateway).
- **Models:** `SubscriptionPlan` and `OrganizationSubscription` (both already
  introduced in Phase 21 and extended here).
- **Enforcement:** server-side only. The frontend is never trusted to enforce
  limits or features.

## Models

### SubscriptionPlan

| Field          | Type      | Notes                                                     |
|----------------|-----------|-----------------------------------------------------------|
| `id`           | UUID      |                                                           |
| `name`         | String    |                                                           |
| `code`         | String    | unique, `[A-Z0-9_]+`                                      |
| `description`  | String?   |                                                           |
| `monthlyPrice` | Decimal   | informational only — no payment processing                |
| `yearlyPrice`  | Decimal   | informational only                                        |
| `active`       | Boolean   | inactive plans cannot be assigned to organizations        |
| `limits`       | JSON      | resource limits map (see below)                           |
| `features`     | JSON      | feature entitlement map (see `ENTITLEMENTS.md`)           |
| timestamps     |           |                                                           |

Supported limit keys (unknown keys are ignored on write):

```
maxBranches, maxUsers, maxCounters, maxServices, maxDisplays,
maxMonthlyTokens, maxDailyTokens, maxWaitingQueueSize
```

Defaults (used when a key is absent):

```
maxBranches=10  maxUsers=100  maxCounters=50  maxServices=100
maxDisplays=50  maxMonthlyTokens=50000  maxDailyTokens=2000  maxWaitingQueueSize=1000
```

### OrganizationSubscription

| Field            | Type       | Notes                                 |
|------------------|------------|---------------------------------------|
| `organizationId` | UUID       | unique (one subscription per org)     |
| `planId`         | UUID       | FK to `SubscriptionPlan`              |
| `status`         | enum       | `TRIAL, ACTIVE, PAST_DUE, CANCELLED, EXPIRED` |
| `startsAt`       | DateTime   |                                       |
| `endsAt`         | DateTime?  |                                       |
| `trialEndsAt`    | DateTime?  |                                       |

## Subscription lifecycle

The following policy is deterministic and enforced by
`EntitlementsService`:

| Status               | Existing data | Feature access | New provisioning      |
|----------------------|---------------|----------------|-----------------------|
| (no subscription)    | LEGACY        | full default   | default limits        |
| `TRIAL`              | full          | plan           | plan limits           |
| `ACTIVE`             | full          | plan           | plan limits           |
| `PAST_DUE`           | full          | plan           | blocked (`SUBSCRIPTION_REQUIRED`) |
| `CANCELLED`          | full          | plan           | blocked (`SUBSCRIPTION_EXPIRED`)   |
| `EXPIRED`            | full          | plan           | blocked (`SUBSCRIPTION_EXPIRED`)   |

- **Data is never deleted or automatically disabled** for any status.
- Reads, updates, token issuance for existing queues, and operational flows
  keep working for `PAST_DUE` / `CANCELLED` / `EXPIRED`.
- Volume caps (`maxDailyTokens`, `maxWaitingQueueSize`) are enforced even for
  non-provisionable statuses — they cap operational volume but never block
  existing operations by themselves.

## Legacy organizations

Organizations without an `OrganizationSubscription` are **legacy**:

- They keep the full default feature set (all features enabled).
- They keep the default resource limits.
- Limits apply only to **new** provisioning; existing resources that exceed a
  newly introduced limit are untouched and remain operational.

## Administrative APIs (SUPER_ADMIN only)

All admin routes require `JwtAuthGuard + TenantGuard + RolesGuard` with
`@Roles(Role.SUPER_ADMIN)`. `ORG_ADMIN`, `BRANCH_ADMIN`, `RECEPTIONIST`, and
`COUNTER_OPERATOR` receive **403**.

### Plans

```
GET    /admin/subscription-plans
POST   /admin/subscription-plans
GET    /admin/subscription-plans/:id
PATCH  /admin/subscription-plans/:id
PATCH  /admin/subscription-plans/:id/activate
PATCH  /admin/subscription-plans/:id/deactivate
```

- Inactive plans cannot be assigned to organizations (`PLAN_INACTIVE`).
- Mutations are audit-logged (`SUBSCRIPTION_PLAN_CREATED / _UPDATED /
  _ACTIVATED / _DEACTIVATED`).

### Organization subscriptions

```
GET    /admin/organizations/:organizationId/subscription
POST   /admin/organizations/:organizationId/subscription
PATCH  /admin/organizations/:organizationId/subscription
```

- The target organization is taken from the **URL path**, never from the body.
- `POST` fails with `SUBSCRIPTION_EXISTS` if the org already has one.
- `PATCH` on an org without a subscription fails with `SUBSCRIPTION_NOT_FOUND`.
- Audit is recorded against the **target** organization
  (`SUBSCRIPTION_CREATED / _UPDATED / _CANCELLED / _EXPIRED`).

## Organization-facing APIs

```
GET /organizations/current/subscription   (ORG_ADMIN, SUPER_ADMIN)
GET /organizations/current/usage          (ORG_ADMIN, SUPER_ADMIN)
```

Both resolve the organization exclusively from the authenticated tenant
(`x-organization-id` header → active membership → `req.tenant.organizationId`).
Response shapes are safe view models: plan name/code, status, dates, limits,
features, and usage counters. No internal fields, secrets, or other
organizations' data are exposed.

## Error contract

Stable business error codes are returned as the top-level `errorCode` field of
the error body. Frontends must distinguish on these codes, not on HTTP status
alone (statuses are also stable):

| Code                   | HTTP | Meaning                                              |
|------------------------|------|------------------------------------------------------|
| `PLAN_LIMIT_REACHED`   | 409  | resource/volume limit exceeded                        |
| `FEATURE_NOT_AVAILABLE`| 403  | feature not included in the plan                     |
| `SUBSCRIPTION_REQUIRED`| 403  | PAST_DUE — renew to provision new resources          |
| `SUBSCRIPTION_EXPIRED` | 403  | CANCELLED/EXPIRED — restore to provision             |
| `PLAN_INACTIVE`        | 409  | assigning a deactivated plan                         |
| `SUBSCRIPTION_EXISTS`  | 409  | org already has a subscription (POST)                |
| `SUBSCRIPTION_NOT_FOUND`| 404 | org has no subscription (PATCH)                      |

Raw Prisma errors are never surfaced to clients.

## RBAC summary

| Role             | Plans      | Org subscriptions | Own subscription/usage |
|------------------|------------|-------------------|------------------------|
| SUPER_ADMIN      | manage     | manage            | view                   |
| ORG_ADMIN        | forbidden  | forbidden         | view own only          |
| BRANCH_ADMIN     | forbidden  | forbidden         | forbidden              |
| COUNTER_OPERATOR | forbidden  | forbidden         | forbidden              |
| RECEPTIONIST     | forbidden  | forbidden         | forbidden              |

## Tenant isolation

- The tenant is always resolved server-side from the membership; client
  `organizationId`, `planId`, status, limits, or feature flags are never
  trusted.
- Forged `x-organization-id` headers are rejected by `TenantGuard` (403).
- Cross-tenant reads of subscription/usage are impossible because both
  endpoints are scoped to `req.tenant.organizationId`.

## Concurrency strategy

All new-resource provisioning follows this single PostgreSQL transaction:

1. `SELECT ... FOR UPDATE` on the `Organization` row (serializes concurrent
   provisioning for that org).
2. Resolve the active subscription + plan limits.
3. Count current usage.
4. Compare against the limit.
5. Create the resource.

Check and create are never split, no application-level locks are used, and no
Redis is involved. The same pattern is used for the volume caps in token
generation and queue-entry creation.

## Known limitations

- No payment processing — subscription status is an administrative
  foundation only.
- `maxUsers` is enforced as a limit in the usage API, but there is currently
  no user-provisioning endpoint inside an existing organization; if one is
  added it must call `entitlements.enforceLimit(..., 'maxUsers', ...)` inside
  a transaction.
- Pricing (`monthlyPrice` / `yearlyPrice`) is informational.
- Plan features default to *enabled* when a plan does not declare a `features`
  map (backward-compatible with Phase 21 plans).
