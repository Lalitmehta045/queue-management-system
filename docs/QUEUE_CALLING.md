# Queue Calling

## State machine

```text
WAITING -> CALLED -> SERVING -> COMPLETED
WAITING -> CALLED -> SKIPPED
CALLED/SERVING -> CANCELLED (future policy)
CALLED/SERVING -> CALLED/SERVING via RECALL
```

Phase 5 implements `CALL NEXT`, `CALL SPECIFIC`, `SERVE`, `RECALL`, `SKIP`, `COMPLETE`, current-token lookup, and waiting-queue lookup. Invalid transitions are rejected server-side. Skipped and completed tokens retain their counter/operator attribution but no longer occupy the counter.

## Counter ownership and authorization

Counters remain the existing branch-owned `Counter` model. A `COUNTER_OPERATOR` must have both an active `CounterAssignment` and an active `Membership` with the same organization, branch, and role. The requested counter and route branch are checked against the authenticated tenant. `ORG_ADMIN` and `BRANCH_ADMIN` retain organization/branch management policy; branch admins remain restricted to their assigned branch.

The authenticated user ID is taken from JWT request context for operator attribution. No request body ownership fields are accepted.

## CALL NEXT algorithm

Inside a Prisma transaction:

1. Verify the counter has no active `CALLED` or `SERVING` token.
2. Select waiting tokens in deterministic order: `businessDate`, `sequenceNumber`, `id`.
3. Conditionally update a candidate where status is still `WAITING` and `counterId` is null.
4. Set `CALLED`, `counterId`, `operatorId`, and `calledAt`.
5. Return the scoped current token.

A concurrent claimant either updates a different candidate or receives a controlled conflict. The partial PostgreSQL unique index `Token_one_active_per_counter_idx` additionally enforces one active token per counter.

## Current-token invariant

A token is current when its status is `CALLED` or `SERVING` and its `counterId` matches the counter. PostgreSQL conditionally enforces uniqueness of `counterId` for those statuses. Completion and skip transition the token out of the active set atomically.

## RECALL, SKIP, COMPLETE

- `RECALL` is allowed only for the current `CALLED` or `SERVING` token. It increments bounded `recallCount` and records `recalledAt` without creating a Token.
- `SKIP` changes the current token to `SKIPPED`; skipped tokens cannot be recalled or called again.
- `COMPLETE` changes the current token to `COMPLETED` and records `completedAt`.
- `SERVE` changes only `CALLED` to `SERVING` and records `servingAt`.

## Privacy and scope

Responses include token label, patient number/name, service, department, counter, operator display name, lifecycle timestamps, and recall count. Phone, email, passwords, refresh tokens, and membership security fields are excluded. Public display, voice, printer, notifications, analytics, and queue balancing remain out of scope.
