# Entitlements (Phase 22)

This document describes the feature entitlement layer and the resource-limit
enforcement built on the Phase 21 entitlement engine.

## Controlled feature catalog

Feature keys are defined in `apps/api/src/entitlements/features.ts`:

| Key                    | Area enforced                       |
|------------------------|-------------------------------------|
| `ANALYTICS`            | `/branches/:branchId/analytics/*`   |
| `APPOINTMENTS`         | `/branches/:branchId/appointments/*`|
| `PRIORITY_QUEUE`       | `POST /priority-configurations`     |
| `QR_STATUS`            | `GET/SSE /public/queue/:tokenId`    |
| `SELF_SERVICE_CHECKIN` | `/public/self-service/qr/*`         |
| `THERMAL_PRINTING`     | printer create/list/print/health    |
| `PUBLIC_DISPLAY`       | `/branches/:branchId/displays/*`    |
| `NOTIFICATIONS`        | notification settings/history       |
| `AUDIT_LOGS`           | `/branches/:branchId/audit-logs`    |

Feature maps are stored as JSON on `SubscriptionPlan.features`. A missing
feature key defaults to **enabled**, so plans created before Phase 22 (and
legacy organizations) keep full access — a plan must explicitly disable a
feature.

## Server-side enforcement

Feature checks are enforced by the API in two ways:

1. **`FeatureGuard`** (decorator `@RequireFeature(...)`) for authenticated
   routes. It runs after `JwtAuthGuard + TenantGuard`, resolves the
   organization from `req.tenant`, and calls
   `EntitlementsService.requireFeature(organizationId, feature)`.
2. **Service-level checks** for public endpoints without a tenant header
   (self-service QR check-in, public queue status), where the organization is
   resolved from the resource's ownership chain.

When a feature is disabled the API returns **403 with
`errorCode: FEATURE_NOT_AVAILABLE`** — direct HTTP calls cannot bypass it.
Hiding a button in the frontend is not considered security.

### Service API

```
EntitlementsService.hasFeature(organizationId, feature, tx?)
EntitlementsService.requireFeature(organizationId, feature, tx?)   // throws FEATURE_NOT_AVAILABLE
EntitlementsService.getFeatures(organizationId, tx?)               // full map
EntitlementsService.getEntitlements(organizationId, tx?)           // limits map
EntitlementsService.enforceLimit(orgId, key, current, increment, tx?)   // provisioning limit + status guard
EntitlementsService.enforceVolumeLimit(orgId, key, current, increment, tx?) // volume cap only
EntitlementsService.requireProvisioningAllowed(orgId, tx?)         // subscription status guard
EntitlementsService.lockOrganization(orgId, tx)                    // SELECT ... FOR UPDATE
```

## Resource limits

Provisioning limits are enforced inside a single PostgreSQL transaction
(lock org row → resolve limits → count → compare → create) for:

- Branch (maxBranches) — `OrganizationsService.createBranch`
- Service (maxServices) — `OperationsService.createService`
- Counter (maxCounters) — `CountersService.create`
- Display (maxDisplays) — `DisplaysService.create`
- Users (maxUsers) — limit available via usage API; no org-level
  user-provisioning endpoint exists yet (see SUBSCRIPTIONS.md limitations)

Volume caps (not blocked by subscription status):

- `maxDailyTokens` — token generation transaction (`TokensService`)
- `maxWaitingQueueSize` — queue-entry creation transaction
  (`QueueEntriesService`)

Over-limit creation returns **409 with `errorCode: PLAN_LIMIT_REACHED`**.

## Usage API

```
GET /organizations/current/usage   (ORG_ADMIN, SUPER_ADMIN)
```

Response shape:

```json
{
  "branches":    { "used": 2, "limit": 5 },
  "users":       { "used": 18, "limit": 50 },
  "counters":    { "used": 4, "limit": 10 },
  "services":    { "used": 8, "limit": 20 },
  "displays":    { "used": 2, "limit": 5 },
  "dailyTokens": { "used": 120, "limit": 2000 },
  "waitingQueue":{ "used": 30, "limit": 1000 }
}
```

- `users` counts ACTIVE memberships in the organization.
- `dailyTokens` counts tokens for today's business date (organization
  timezone from `TOKEN_TIME_ZONE`).
- `waitingQueue` counts WAITING queue entries across the organization.
- Only the caller's own organization is ever reported.

## Defaults and legacy behavior

- `DEFAULT_PLAN_LIMITS` (see `entitlements.service.ts`) and
  `DEFAULT_FEATURES` (all enabled) are the safe fallback.
- Legacy organizations (no subscription) use both.
- Limits apply to new provisioning only; existing resources that exceed a
  newly introduced limit remain operational and are never deleted.

## Audit

Feature/limit decisions are not audited per-request (volume). Subscription
and plan mutations are audited (see SUBSCRIPTIONS.md). Audit metadata is
sanitized by `AuditService` allowlists — secrets, JWTs, passwords, and
unnecessary PII are never logged.
