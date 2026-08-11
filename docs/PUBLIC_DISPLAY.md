# Public Queue Display

## Architecture

Phase 6 uses a persistent `Display` configuration owned by a Branch. Each Display has an opaque random `publicId`, a name, and an active flag. Public URLs use only the opaque identifier:

```text
/display/:publicId
```

The public API resolves the Display through `Display -> Branch -> Organization` and never accepts an organization or branch selector from the client.

## Public API

```text
GET /public/displays/:publicId
GET /public/displays/:publicId/events
```

The endpoint is read-only and returns:

- Display name
- Current CALLED/SERVING token label, counter, status, service, and department
- Recent token labels and counters
- Waiting token count
- Recall indication and recall count

It intentionally excludes patient names, phone, email, operator identity, organization identifiers, memberships, passwords, JWTs, and session data.

## Real-time strategy

Phase 6 uses Server-Sent Events because the public display is read-only and only needs server-to-browser queue updates. The stream resolves the opaque public display ID to one active Display and subscribes only to that Display's Branch.

The browser connects to:

```text
GET /public/displays/:publicId/events
```

The first event is a sanitized `QUEUE_UPDATED` snapshot. After that, authenticated queue mutations publish branch-scoped events. The frontend updates without a full refresh and falls back to the read API once if the initial stream is unavailable, so the screen can still show stale-safe display data while reconnecting.

## Event types

```text
QUEUE_UPDATED
TOKEN_CALLED
TOKEN_SERVED
TOKEN_RECALLED
TOKEN_SKIPPED
TOKEN_COMPLETED
KEEPALIVE
```

All queue events carry the same display-safe snapshot shape as `GET /public/displays/:publicId`. `KEEPALIVE` carries only an `updatedAt` timestamp and is used to keep idle connections open. Recalled tokens are represented by the same token label with `recalled: true` and an incremented `recallCount`; a recall does not create or duplicate a token.

## Public security

Inactive displays and inactive branches return not found. A lightweight in-memory limiter allows 120 snapshot requests and 20 SSE connection attempts per display/client key per minute, sufficient for normal TV display operation while limiting accidental abuse. The endpoint has no mutation route. Staff JWTs are never placed in the public URL.

Public clients never provide or select an organization. Ownership is resolved from `Display -> Branch -> Organization` in the database. Staff display management remains authenticated and validates the branch against the tenant context from `TenantGuard`.

## Voice announcements (Phase 7)

The display can announce newly called and recalled tokens using browser speech synthesis. Announcements are derived from the existing SSE events: `TOKEN_CALLED` and `TOKEN_RECALLED` only. The snapshot carries a `calledAt` timestamp; clients deduplicate with the key `eventType:tokenLabel:calledAt:recalled:recallCount`, so duplicate deliveries, reconnects, and historical snapshots never re-announce, while every recall announces again. Utterances are serialized in a small client queue with a watchdog so stale speech cannot block later announcements.

Announcements are disabled by default and enabled through a visible user-gesture control (`🔊`/`🔇`) persisted in `localStorage`; browsers' autoplay restrictions are never bypassed. `prefers-reduced-motion` users default to muted, and browsers without speech synthesis show a "Voice unavailable" note. Staff settings are never exposed through the public API.

## Reconnect behavior

The browser uses native `EventSource` reconnect behavior. While reconnecting, the display keeps the last safe snapshot visible and shows a "Reconnecting..." status. If no snapshot has ever loaded, it shows "Display unavailable" without exposing stack traces or transport errors.

## Display lifecycle

`ORG_ADMIN`, `BRANCH_ADMIN`, and `SUPER_ADMIN` can create, rename, activate, and deactivate displays through branch-scoped authenticated endpoints. `COUNTER_OPERATOR` cannot manage displays. Display deletion is intentionally unavailable to preserve stable public configuration and avoid accidental loss of a screen URL.
