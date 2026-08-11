# Appointments - Phase 8

This document describes the appointment foundation implemented in Phase 8.

## Appointment lifecycle
States: SCHEDULED, CONFIRMED, CHECKED_IN, COMPLETED, CANCELLED, NO_SHOW
Valid transitions:
- SCHEDULED → CONFIRMED
- SCHEDULED → CANCELLED
- CONFIRMED → CHECKED_IN
- CONFIRMED → CANCELLED
- CONFIRMED → NO_SHOW
- CHECKED_IN → COMPLETED

Transitions are enforced server-side; invalid transitions return 409 Conflict.

## Timezone strategy
The project uses `TOKEN_TIME_ZONE` for business-date semantics. Tokens use business dates derived from this timezone. Appointments store UTC timestamps (TIMESTAMP) for startAt/endAt and appointmentDate as DATE (UTC). The client should present times in branch/business timezone and send appointmentDate (YYYY-MM-DD) and startTime (HH:MM) normalized to that date/time. Server currently composes UTC timestamps using the provided date/time; follow-up work may centralize timezone conversion.

## Branch working hours
BranchWorkingHours model holds per-day (0=Sunday..6=Saturday) openTime and closeTime in HH:MM and an active flag. Availability computation uses these entries for the requested date's weekday.

## Service duration
`Service.durationMinutes` (INT, default 15) defines slot length. Validated positive and reasonable upper bound.

## Slot calculation
Server-side availability considers:
- Branch working hours for the day
- Service.durationMinutes
- Existing appointments for that service and date (excluding CANCELLED)
- Returns all candidate slots and boolean `available`

Clients must call the availability API and must not assume availability.

## Double-booking prevention
A DB unique index on (serviceId, appointmentDate, startAt) prevents two appointments for the same service/date/startAt. Creation catches P2002 and returns 409 Conflict. This is transactional-safe when combined with standard SQL constraints.

## Concurrency strategy
- Use DB uniqueness + transactional creates
- Check-in uses conditional updateMany on status to ensure only valid transitions
- Token allocation and QueueEntry creation reuse existing services which are transaction-safe/idempotent

## Check-in flow
- Confirmed appointment → POST /branches/:branchId/appointments/:id/check-in
- Server atomically sets appointment.status = CHECKED_IN and orchestrates QueueEntry creation and Token generation (via existing services). Idempotent and safe for concurrent check-ins.

## Appointment → QueueEntry → Token
Appointment status is separate from Token state. Tokens are still generated per QueueEntry and follow the existing token engine (branch+service+businessDate scope).

## Notifications
Hooks are prepared for appointment lifecycle (created, confirmed, cancelled, checked-in, no-show). Notifications use existing provider abstractions (noop/mock) and are fire-and-forget; failures do not roll back appointment operations.

## Tenant isolation
All endpoints validate branch and resource ownership via tenant context. Client-supplied IDs are validated server-side.

## RBAC
Uses existing Role enums. Receptionists, branch/org admins can manage appointments. Counter operators can view where permitted.

## Known limitations
- DB migration recovery required in some environments (see project root). Do not mark migrations applied unless DB schema verified.
- Timezone handling between client and server requires tightening.
- No providers/doctor resource scheduling; capacity assumed 1 per slot.
- Frontend UI is basic and uses existing styling; further UX polish can be added.

