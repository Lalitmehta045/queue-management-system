# Counter Operator Panel (Phase 16)

## Overview
The Counter Operator Panel provides a streamlined, operational interface (`/dashboard/counter`) for staff to manage queue calling. It centralizes all token lifecycle operations (CALL NEXT, CALL SPECIFIC, RECALL, SKIP, SERVE, COMPLETE) into a single, real-time dashboard powered by Server-Sent Events (SSE).

## Counter Assignment
- Operator counters are automatically fetched using `GET /api/branches/:branchId/counters/assigned`.
- If an operator is assigned only one counter, it is automatically selected.
- If multiple counters are assigned, a select dropdown is provided.
- An inactive counter or unassigned counter is strictly rejected by the backend (`403 Forbidden` / `409 Conflict`).

## RBAC & Access Control
- **Allowed Roles:** `COUNTER_OPERATOR`, `ORG_ADMIN`, `BRANCH_ADMIN`, `SUPER_ADMIN`.
- **Denied Roles:** `RECEPTIONIST` (unless they also hold an explicit counter operator membership).
- The `TenantGuard` and `authorizeCounter` functions explicitly prevent cross-tenant and cross-branch operations. Forged `counterId`, `branchId`, or `organizationId` claims are rejected.

## Real-Time Updates (SSE)
The Counter Panel uses an `EventSource` pointing to `/api/branches/:branchId/counters/:counterId/events`.
- This streams `QUEUE_UPDATED`, `TOKEN_CALLED`, `TOKEN_RECALLED`, `TOKEN_SERVED`, `TOKEN_SKIPPED`, and `TOKEN_COMPLETED` events.
- It reuses the existing `DisplayEventsService` backend architecture, requiring no new event bus.
- Includes automatic reconnect (`reconnecting` state) and KEEPALIVE heartbeats.

## Priority & Concurrency
- `CALL NEXT` operations are entirely authoritative on the backend. The frontend does not dictate the next token.
- `QueueCallingService` uses the Phase 14 Priority Configuration (weights) and Starvation Prevention (1-hour wait limit) to order tokens.
- PostgreSQL transactions and `UPDATE ... WHERE counterId IS NULL` locks prevent race conditions. The system handles 50+ concurrent `CALL NEXT` operations across counters without duplicate assignments.

## Token Lifecycle
The UI and Backend enforce strict state machines:
- **CALL NEXT/SPECIFIC:** `WAITING` -> `CALLED`.
- **RECALL:** Increments `recallCount` (keeps `CALLED` or `SERVING`).
- **SERVE:** `CALLED` -> `SERVING`.
- **SKIP:** `CALLED` / `SERVING` -> `SKIPPED`.
- **COMPLETE:** `CALLED` / `SERVING` -> `COMPLETED`.

## Public Display & Audit Integration
- Counter actions immediately trigger native `DisplayEventsService` broadcasts, instantly updating the Public Display (`/display/[id]`).
- Voice announcements trigger seamlessly via the existing Webhooks/Notifications Engine.
- All actions generate `AuditLog` records containing `counterName`, `operatorUserId`, `displayNumber`, and `recallCount`.

## Privacy
- The Counter Panel surfaces only safe data (`patientNumber`, `firstName`, `lastName`, `displayNumber`, `service`).
- `email`, `phone`, `password`, and `jwt` fields are never transmitted to this dashboard.

## Known Limitations (Deferred to Phase 18+)
- No physical ECS/POS printer integrations (Waiters can print via browser `window.open` but cannot query hardware).
- Hardware health checks and Redis-based workers for distributed queuing are not present (Intentionally reliant on PostgreSQL).
