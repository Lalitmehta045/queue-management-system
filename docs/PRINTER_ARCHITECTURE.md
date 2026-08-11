# Printer Architecture

## Boundary

The cloud backend must never assume direct USB access.

Future print flow:

```text
Cloud Backend
  -> Authenticated Print Job
  -> Reception PC
  -> QueuePrint Bridge
  -> USB
  -> ESC/POS Thermal Printer
```

The QueuePrint Bridge is not implemented in Phase 0.

## Future Backend Contracts

The future printer system should support:

- printer registration
- device identity
- device authentication
- printer jobs
- job retries
- idempotency
- offline handling
- print status
- printer health
- audit logs

## Printer Registration

An authorized organization or branch admin will create a logical printer record. The bridge should pair using a one-time registration code, then receive a device credential. Device secrets must be stored hashed and must be revocable.

## Device Authorization

The bridge authenticates as a device, not as a human user.

Device access must be restricted to its assigned:

- organization
- branch
- printer

The bridge must not claim jobs for another tenant, branch, or printer.

## Print Job States

```text
PENDING
CLAIMED
PRINTING
PRINTED
FAILED
CANCELLED
EXPIRED
```

## Idempotency and Duplicates

Print job creation should use an idempotency key based on the originating command. The bridge should claim jobs atomically so duplicate polling, reconnects, or retries do not print the same ticket twice.

## Offline Handling

When the bridge is offline, jobs remain pending until they expire or are claimed. Retry attempts should be tracked separately from the job so operational history is preserved.

## Health

Printer health should eventually include:

- last seen timestamp
- bridge version
- printer status
- last successful print
- last error code/message

Health reports must be authenticated and tenant-scoped.
