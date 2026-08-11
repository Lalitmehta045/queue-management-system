# Token Engine

## Exact numbering strategy

Token numbers are scoped by:

```text
branch + service + business date
```

The exact sequence scope is `(branchId, serviceId, businessDate)`. The current application has no stable service code, so display labels use the exact neutral `T-001`, `T-002`, ... format. The numeric `sequenceNumber` remains the authoritative value; `displayNumber` is presentation data.

Database uniqueness is enforced by:

- `TokenSequence @@unique([branchId, serviceId, businessDate])`
- `Token @@unique([queueEntryId])`
- `Token @@unique([sequenceId, sequenceNumber])`
- `Token @@unique([sequenceId, displayNumber])`

## Business date

Business dates use the `TOKEN_TIME_ZONE` configuration value. The development default is `Asia/Kolkata`; production must provide the setting explicitly. Dates are stored as PostgreSQL `DATE` values, so timezone conversion is isolated to the business-date helper.

## Business date and sequence safety

`TokenSequence` contains `id`, `branchId`, `serviceId`, `businessDate DATE`, `nextNumber`, and timestamps. Generation first ensures the scoped row exists. Inside a Prisma interactive `$transaction`, it reads the current `nextNumber`, then executes:

```text
UPDATE TokenSequence
SET nextNumber = nextNumber + 1
WHERE id = sequence.id AND nextNumber = previouslyReadNumber
```

The implementation uses Prisma `updateMany` with `increment: 1` and the compare predicate. Exactly one concurrent transaction can update a given old `nextNumber`; all other transactions affect zero rows, roll back, and retry with bounded jitter. The successful increment and Token insert commit together.

The unique `queueEntryId` constraint handles same-QueueEntry races. A losing transaction may temporarily attempt a sequence claim, but its subsequent unique Token conflict rolls the whole transaction back. The verified sequence row advances exactly once.

Sequence allocation and Token creation roll back together for ordinary transaction failures, so this implementation does not intentionally create gaps from a failed Token insert. PostgreSQL sequence gaps are not used because numbering is maintained in a transactional table row. A future non-transactional PostgreSQL sequence would have different gap semantics and would require a separate product decision.

## Idempotency and history

`Token.queueEntryId` is unique. Repeated generation for a QueueEntry returns the existing Token. Tokens are never deleted. Cancellation changes status to `CANCELLED` and does not release or reuse the sequence number.

QueueEntry remains `WAITING`; calling, serving, completion, counters, displays, and printers are later phases.

## Migration history verification

The repository contains an older timestamp ordering defect: `20260809072304_phase_3b_queue_entries` sorts before the already-existing `20260809120000_phase_2b_departments_services` and `20260809130000_phase_2c_counters` migrations. Historical migrations were not changed or deleted. The real database is healthy: `prisma migrate status` reports all migrations applied and `prisma migrate deploy` succeeds with no pending migrations. Future migrations must use timestamps after the latest existing migration, such as the Phase 4 migration `20260809140000_phase_4_token_engine`.
