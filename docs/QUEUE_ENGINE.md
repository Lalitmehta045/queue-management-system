# Queue Engine

## Boundary

The Queue Engine will be a backend domain/application service layer independent from:

- HTTP controllers
- WebSocket gateways
- React components
- TV display clients
- printer integrations
- voice announcement clients

Controllers and gateways must not own queue business rules. They should authenticate, authorize, validate DTOs, call the Queue Engine, and return or publish the result.

## Responsibilities

The future Queue Engine owns:

- token creation
- token lifecycle state transitions
- queue ordering
- priority handling
- counter assignment
- skip
- recall
- transfer
- complete
- domain event creation
- audit log creation
- transaction boundaries
- idempotency handling

## Token State Machine

Initial creation:

```text
CREATED -> WAITING
```

Valid transitions:

```text
WAITING -> CALLED
WAITING -> SKIPPED
WAITING -> CANCELLED
WAITING -> TRANSFERRED

CALLED -> SERVING
CALLED -> SKIPPED
CALLED -> NO_SHOW
CALLED -> CANCELLED

SERVING -> COMPLETED
SERVING -> TRANSFERRED
SERVING -> CANCELLED

SKIPPED -> CALLED
SKIPPED -> CANCELLED

TRANSFERRED -> WAITING in destination queue
```

Recall is expected to produce a `queue.token.recalled` event. It may not require a state change when the token is already `CALLED`.

Invalid transitions must be rejected by the Queue Engine.

## Token Numbering

Token uniqueness will be scoped by:

```text
organizationId
branchId
serviceId
tokenDate
tokenNumber
```

Expected future unique constraint:

```sql
UNIQUE (
  organizationId,
  branchId,
  serviceId,
  tokenDate,
  tokenNumber
)
```

Generation must use:

- database transaction
- per-scope counter row
- row locking or safe atomic increment
- idempotency key

Generation must never use:

```text
MAX(tokenNumber) + 1
```

## Concurrency

All queue mutations must run inside database transactions.

Future implementation should use:

- transactional row locking for per-scope token counters
- optimistic version checks for token state changes
- idempotency records for externally retried requests
- domain events persisted in the same transaction as state changes
- event publication only after successful commit

## Ordering and Priority

Initial queue ordering should be explicit:

```text
priority DESC
checkInTime ASC
sequenceNumber ASC
createdAt ASC
```

Priority changes must be authorized and audited.

## Audit

Queue mutations should write audit records containing:

- actor user or device
- organization, branch, department, and service scope when applicable
- action
- previous state
- next state
- token id
- counter id when applicable
- request id or idempotency key
- timestamp
