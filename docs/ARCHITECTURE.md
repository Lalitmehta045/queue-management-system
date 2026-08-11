# Architecture

## Phase 0 Scope

Phase 0 establishes the production foundation only:

- npm workspaces monorepo
- Next.js web app
- NestJS API
- PostgreSQL and Prisma
- Deferred Redis/BullMQ infrastructure (in-memory alternatives used)
- strict TypeScript
- environment validation
- health endpoint
- CI quality gates
- architectural documentation

The queue workflow, TV display, printer bridge, voice announcements, analytics, billing, and enterprise features are deferred.

## Monorepo Layout

```text
apps/
  web/
  api/
packages/
  shared/
prisma/
docs/
```

## Dependency Direction

- React components must not contain queue business rules.
- HTTP controllers must remain thin and call application services.
- WebSocket gateways must publish notifications from committed backend events.
- Printer integrations must consume backend print-job contracts.
- The future Queue Engine owns token creation, state transitions, ordering, priority, counter assignment, transactions, events, and audit.

## Multi-Tenancy Boundary

`Organization` is the tenant root. A user can belong to multiple organizations through `Membership`.

The frontend must never be trusted as the source of tenant authority. Future request handling must derive active organization and branch scope from authenticated membership context, then pass that scope into service/repository methods.

Tenant-owned database access must include `organizationId`. Branch-scoped access must additionally include `branchId` where the resource belongs to a branch.

## Department and Service Management

Phase 2B adds the operational configuration hierarchy `Organization -> Branch -> Department -> Service`.
Departments are owned by branches and services are owned by departments. Department and service reads and mutations verify the complete parent chain against the authenticated organization context; route parent IDs are never taken from request bodies.

Departments and services use `ACTIVE` and `INACTIVE` lifecycle statuses and are protected from deletion with restrictive foreign keys. Names are unique within their immediate parent, and list endpoints use the existing page/limit pagination convention with a maximum limit of 100.

`ORG_ADMIN` and `SUPER_ADMIN` can manage this configuration. Branch-admin mutation authorization remains deferred until branch-scoped authorization is implemented consistently across the application.

## Counter and Operator Management

Phase 2C adds `Counter` as a branch-owned resource and `CounterAssignment` as a relationship to an existing `User`; operators are never duplicated as person records. The existing nullable `Membership.branchId` is the branch-scope foundation: `ORG_ADMIN` and `SUPER_ADMIN` may manage counters across their organization, while `BRANCH_ADMIN` access is limited to the branch on their active membership. Counter management queries include the branch and organization ownership chain.

Counter codes are unique within a branch, counters use the non-destructive `ACTIVE`/`INACTIVE` lifecycle, and an operator may have at most one assignment in a branch. Only active same-branch memberships with `COUNTER_OPERATOR` or `RECEPTIONIST` roles are eligible for assignment.

Counter-Service mapping is intentionally deferred. Phase 2B does not define a routing contract, and Phase 2C does not implement queue behavior; the mapping can be added when queue-service routing requirements are specified.

Phase 5 adds queue calling without duplicating Counter or CounterAssignment. Token execution is `WAITING -> CALLED -> SERVING -> COMPLETED`, with `SKIPPED` as an interruption state. Counter/operator attribution is stored on Token, and a PostgreSQL partial unique index permits at most one `CALLED` or `SERVING` Token per counter. Queue operations validate active same-branch assignments for counter operators and preserve the existing tenant ownership chain.

Phase 6 adds a branch-owned `Display` configuration with an opaque public identifier. Public display reads resolve `Display -> Branch -> Organization`, expose only token/counter-safe summaries, and use branch-scoped Server-Sent Events for live queue updates. Display management remains authenticated and branch scoped; public endpoints are read-only.

Phase 7 adds the customer notification layer on top of Phase 5 queue operations and Phase 6 displays without changing either: browser voice announcements on the public display (serialized client queue, duplicate prevention via event identity, never bypassing autoplay restrictions), authenticated printable tickets (80mm thermal / A4 fallback), a `NotificationProvider` abstraction (`Noop`/`Mock` until a real provider is configured), branch-level notification settings, audit-safe notification history, bounded retries, and strict failure isolation so notification failures never roll back or block queue transitions. See `docs/NOTIFICATIONS.md`.

Phase 2A organization and branch endpoints require the existing `x-organization-id` context header. `TenantGuard` resolves that ID through an active membership before controllers run; request bodies, query strings, and route parameters cannot select a tenant. Branch reads and writes include both the branch ID and resolved organization ID in the database predicate.

Organization and branch mutations are available to `ORG_ADMIN` and `SUPER_ADMIN`. `BRANCH_ADMIN` remains deferred until branch-scoped authorization is implemented.

## Future Realtime Architecture

Phase 6 uses SSE for the public read-only display. Broader authenticated realtime notifications can still use Socket.IO later if bidirectional rooms are required. REST/database snapshots remain the source of truth.

Future event names:

```text
queue.token.created
queue.token.called
queue.token.serving
queue.token.skipped
queue.token.recalled
queue.token.transferred
queue.token.completed
queue.token.cancelled
queue.updated
counter.status.changed
printer.job.created
printer.job.updated
```

Future event payload:

```json
{
  "eventId": "uuid",
  "eventType": "queue.token.called",
  "occurredAt": "2026-08-08T00:00:00.000Z",
  "organizationId": "uuid",
  "branchId": "uuid",
  "departmentId": "uuid",
  "serviceId": "uuid",
  "aggregateType": "Token",
  "aggregateId": "uuid",
  "version": 1,
  "data": {}
}
```

Room strategy:

```text
org:{organizationId}
org:{organizationId}:branch:{branchId}
org:{organizationId}:branch:{branchId}:department:{departmentId}
org:{organizationId}:branch:{branchId}:service:{serviceId}
counter:{counterId}
display:{displayId}
printer:{printerId}
```

Room membership must be authorized server-side. Clients must not be allowed to join arbitrary rooms by sending IDs.

## Reconnection and Ordering

Every durable event should have `eventId`, `occurredAt`, and aggregate `version`.

Clients must deduplicate by `eventId`. After reconnect, clients must request a fresh REST snapshot and then apply newer events only.

## Background Jobs

Redis and BullMQ are part of the future target architecture, but are explicitly **DEFERRED** in Phase 0 / Free-Tier deployment. No workers are implemented. Future workers should process durable jobs such as printer retries, announcements, analytics aggregation, and notification fan-out. Phase 7 keeps notification dispatch behind a clean service abstraction that can later be connected to BullMQ/Redis without changing queue operations or the provider interface.

## Auth Foundation

The selected direction is custom JWT-based authentication:

- short-lived access token
- refresh token with rotation
- membership resolution from authenticated user
- active organization context from membership
- role authorization based on organization and optional branch scope

Phase 0 does not implement login, fake users, or demo credentials.

## Analytics & Reporting (Phase 9)

Phase 9 adds a read-only analytics layer for `ORG_ADMIN` and `BRANCH_ADMIN` roles. Analytics queries are tenant-isolated through the existing `TenantGuard` + `authorizeBranch()` pattern and compute all metrics server-side from the database.

The `AnalyticsModule` provides six endpoints under `branches/:branchId/analytics/`: summary KPIs, service performance, counter performance, daily trends, appointment metrics, and CSV export. Count-based metrics use Prisma's `count()` and `groupBy()`. Time-based averages (waiting time, service time) use parameterized `$queryRawUnsafe` because Prisma cannot express timestamp-difference aggregations. No raw SQL is used for count or filter operations.

Analytics queries are strictly read-only — they never mutate queue, token, or appointment state. No locks are introduced into queue operations. All responses exclude patient PII (phone, email, password). The frontend dashboard at `/dashboard/analytics` uses recharts for trend visualization and follows the existing page patterns. See `docs/ANALYTICS.md` for full metric definitions and API reference.

## Production Hardening (Phase 11)

Phase 11 establishes a robust foundation for production deployments by implementing:
- **Resilience:** Graceful shutdown hooks handle database connections and long-lived client subscriptions cleanly. Prisma connections are isolated and managed appropriately on startup and shutdown.
- **Observability:** Structured JSON logging is implemented via `nestjs-pino`, seamlessly propagating request IDs (`x-request-id`) across the stack and into error responses without leaking internal stack traces.
- **Rate Limiting:** Stricter, in-memory rate limiting guards sensitive paths like token generation and SSE endpoints.
- **SSE Hardening:** Server-Sent Events implement explicit heartbeat signals and bounded lifecycles (e.g., 12 hours max) to prevent stalled connections on external load balancers and proxy servers.
- **Testing:** Concurrency and security-specific E2E tests validate idempotency, race conditions, limits, and request tracking under load.

## Production Deployment (Phase 12/13)

Phase 13 prepares the system for real production deployment using a **Free-Tier Cloud Architecture**:

### Deployment Architecture
- **Stateless API server**: Deployed on Railway/Render.
- **Web Application**: Deployed on Vercel.
- **Single PostgreSQL database**: Managed provider.
- **Redis & Background Jobs**: Explicitly **DEFERRED** (in-memory rate limiting and synchronous operations used instead).
- **Reverse proxy**: HTTPS termination and routing handled by Vercel, Railway, and Cloudflare.
- **Health checks**: Liveness and readiness probes available.

### Environment & Configuration
- **Environment separation**: Development, test, and production configurations
- **Strict validation**: All environment variables validated at startup
- **Secrets management**: Credentials injected at runtime, never committed
- **Configuration documentation**: Complete inventory with security requirements

### Containerization
- **Multi-stage Docker builds**: Minimal runtime images (~200-300MB)
- **API Dockerfile**: Production NestJS build with health checks
- **Web Dockerfile**: Production Next.js standalone build
- **Non-root user**: Security best practice in containers
- **Health checks**: Built-in container health endpoints

### CI/CD Pipeline
- **GitHub Actions workflow**: Lint, typecheck, test, build, audit
- **Secrets scanning**: Detects credentials in code
- **Artifact verification**: Ensures builds complete successfully
- **Quality gates**: Fails on any quality issues
- **Database services**: PostgreSQL and Redis available in CI

### Database Operations
- **Migration strategy**: `prisma migrate deploy` in production only
- **Safety**: No automatic rollback, historical migrations preserved
- **Backup procedures**: Documented but operator-implemented
- **Recovery procedures**: Detailed restore steps included

### Operational Documentation
- **FREE_TIER_DEPLOYMENT.md**: Step-by-step production deployment guide for Vercel/Railway.
- **DEPLOYMENT.md**: Production deployment guide.
- **OPERATIONS.md**: Daily operations and incident response.
- **PRODUCTION_CHECKLIST.md**: Pre-deployment security and readiness checklist.

### Security & Monitoring
- **Security headers**: Helmet configured, CSP/HSTS/X-Frame-Options enabled.
- **Rate limiting**: Protects sensitive endpoints (in-memory).
- **Audit logging**: All mutations recorded with full context.
- **Health endpoints**: `/health/live` and `/health/ready` with database connectivity check.
- **Structured logging**: JSON logs to stdout for aggregation in Railway/Vercel.

### Testing & Validation
- **Smoke tests**: Shell script validates deployment health
- **Quality gates**: Comprehensive pre-deployment checklist
- **No destructive operations**: Database reset/drop never used in production
- **Backward compatibility**: Migrations preserve schema history

### Known Limitations
- **Single region**: Multi-region requires database replication and DNS failover.
- **No Redis**: Horizontal scaling is limited until Redis/pub-sub is introduced for SSE fanout and distributed rate limiting.
- **Free-Tier Limits**: Subject to platform constraints (cold starts, storage limits, concurrent connection limits).
U p d a t i n g   A R C H I T E C T U R E . m d   a n d   S E C U R I T Y . m d  
 A d d e d   C o u n t e r   O p e r a t o r   P a n e l   d o c u m e n t a t i o n  
 

## Phase 17: Patient QR Queue Status

### Module: PublicQueueModule
- Location: apps/api/src/public-queue/
- Controller: PublicQueueController exposes GET /public/queue/:id and GET /public/queue/:id/events
- Service: PublicQueueService computes peopleAhead, estimatedWaitMinutes, manages SSE lifecycle

### Public Identifier
Token.id (UUID v4) is the public identifier. No schema change was required.

### SSE Event Flow
QueueCallingService / TokensService -> DisplayEventsService.publish(branchId, eventType) -> PublicQueueService subscriber -> getPublicTokenStatus() snapshot -> sanitizedSnapshot to client

### Privacy Boundary
The public API sits outside the authenticated tenant boundary. It does not use JwtAuthGuard, TenantGuard, or RolesGuard. It resolves ownership chain server-side and never returns PII. Rate-limited at 100 req/60s.

### Frontend
- Route: apps/web/src/app/queue/[publicTokenId]/page.tsx
- Client: QueueStatusClient.tsx with SSE + HTTP fallback + auto-reconnect
- QR: react-qr-code using window.location.origin + /queue/<tokenId>

## Phase 22 — SaaS Subscription & Entitlement Control Plane

Phase 22 builds the SaaS control plane on the Phase 21 entitlement engine
(no Redis, BullMQ, background workers, or payment gateway are introduced).

### Modules & ownership

- `EntitlementsModule` (global) owns the entitlement engine:
  - `EntitlementsService` — access resolution, features, limits, usage,
    subscription lifecycle policy.
  - `AdminEntitlementsService` — plan CRUD + organization subscription
    assignment (SUPER_ADMIN only).
  - `FeatureGuard` + `@RequireFeature` — server-side feature gating.
  - Controllers: `organizations/current/subscription`,
    `organizations/current/usage`, `admin/subscription-plans`,
    `admin/organizations/:organizationId/subscription`.

### Data model

- `SubscriptionPlan` (`limits` JSON, `features` JSON, `active`)
- `OrganizationSubscription` (one per org; `status` enum TRIAL/ACTIVE/
  PAST_DUE/CANCELLED/EXPIRED; `startsAt`, `endsAt`, `trialEndsAt`)
- New audit actions: `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_EXPIRED`,
  `SUBSCRIPTION_PLAN_CREATED/UPDATED/ACTIVATED/DEACTIVATED`.

### Enforcement strategy

- **Provisioning limits** (branches, services, counters, displays) are
  enforced inside one PostgreSQL transaction per creation:
  `SELECT ... FOR UPDATE` on the Organization row → resolve limits → count
  current usage → compare → create. Check and create are never split.
- **Volume caps** (`maxDailyTokens`, `maxWaitingQueueSize`) use the same
  transaction pattern but are not blocked by subscription status.
- **Feature gates** run server-side via `FeatureGuard` (authenticated routes)
  or service-level checks (public endpoints).
- Legacy organizations (no subscription) keep full defaults; limits apply to
  new provisioning only, and existing resources are never deleted or disabled.

### Concurrency

PostgreSQL row locking (not application locks) serializes concurrent
provisioning for an organization, guaranteeing exactly the allowed number of
resources can be created (verified by e2e concurrency tests).

See `docs/SUBSCRIPTIONS.md` and `docs/ENTITLEMENTS.md`.

