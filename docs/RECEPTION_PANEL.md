# Reception Panel (Phase 15)

## Overview
The Reception Panel provides a high-speed, operational workflow for front-desk staff. It consolidates patient registration, queue entry creation, token generation, and browser-based printing into a single, optimized interface (`/dashboard/reception`).

## Core Workflow
1. **Patient Selection:** The receptionist either searches for an existing patient or registers a new walk-in patient.
2. **Service Selection:** The receptionist selects the appropriate department and service.
3. **Priority Integration:** A queue weight (Priority) is selected. Options are derived directly from the active `PriorityConfiguration` scoped to the organization and department.
4. **Queue Entry & Token Generation:** Submitting the form creates the QueueEntry and invokes the idempotent Token Engine to issue a sequence number.
5. **Browser Printing:** A successful generation surfaces the token details with a prompt to "PRINT TICKET" or clear the form via "DONE".

## RBAC & Access Control
- **Allowed Roles:** `RECEPTIONIST`, `ORG_ADMIN`, `BRANCH_ADMIN`, `SUPER_ADMIN`.
- **Denied Roles:** `COUNTER_OPERATOR` (unless otherwise bypassed by strict membership policy).
- All interactions strictly enforce the authenticated user's `branchId` context. The user cannot view patients or assign queues for departments outside their allowed branch.

## Tenant Isolation
The backend strictly guards data boundaries.
- The receptionist's JWT token defines their organizational scope.
- `TenantGuard` isolates all requests.
- E2E tests specifically verify that forged `organizationId` or `branchId` payloads are rejected with `403 Forbidden`.
- Fetching Priority Configurations automatically falls back safely to organization-level overrides if department-specific config does not exist.

## Appointments Check-in Integration
When an appointment patient checks in at the reception desk, the system leverages the Priority Config engine to automatically assign `APPOINTMENT` priority (based on defined weights). Checking them in via the standard flow converts them into a `QueueEntry`.

## Duplicate Protection & Concurrency
- Active queue entries per patient-service are constrained server-side (preventing `409 Conflict`).
- Token Generation uses PostgreSQL transactions to safely lock the `TokenSequence`, guaranteeing sequential integrity even under simultaneous front-desk usage.

## Printing Boundary (Phase 15 vs Phase 18)
Currently, printing relies on standard browser print mechanisms (`window.open` -> `window.print`). 
**Note:** This phase DOES NOT include direct ESC/POS physical USB thermal printer support. A native Windows Printer Bridge and physical hardware monitoring are deferred explicitly to Phase 18.

## Audit Logging & Privacy
All actions on the reception desk flow through standard API routes resulting in native audit events:
- `PATIENT_CREATED`
- `QUEUE_ENTRY_CREATED`
- `TOKEN_CREATED`
No patient PII is stored inside the token payload, and printing masks sensitive fields according to compliance rules.
