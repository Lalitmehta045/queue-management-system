# Customer Notifications (Phase 7)

Phase 7 adds the customer notification layer on top of the Phase 5 queue
operations and the Phase 6 public display. It covers:

- voice announcement when a token is called or recalled (browser speech
  synthesis on the public display)
- printable queue/token tickets (80mm thermal and A4 fallback)
- a notification provider abstraction for future SMS/WhatsApp delivery
- branch-level notification configuration and audit-safe history
- bounded retry and strict failure isolation from queue operations

Phase 7 does **not** modify the token numbering strategy or the Phase 5 queue
state machine. It does not implement AI queue optimization, analytics,
payments, or marketing features.

## 1. Voice announcement architecture

Announcements are **derived** from the existing Phase 6 event system; no second
event system was introduced. The chain is:

```text
Queue operation (call / call specific / recall)
      ↓
DisplayEventsService.publish(branchId, TOKEN_CALLED | TOKEN_RECALLED)
      ↓
Public display SSE (sanitized snapshot, includes calledAt identity)
      ↓
Browser voice announcement (window.speechSynthesis)
```

Only `TOKEN_CALLED` and `TOKEN_RECALLED` produce voice. The spoken text is:

```text
Token {token}, please proceed to {counter}.            (+ " for {service}")
```

It uses the token label and the counter display name only. Patient names,
phone, email, internal IDs, and membership information are never announced.

### Announcement template

The server validates configurable announcement templates used for outgoing
message content. Allowed variables are `{token}`, `{counter}`, `{service}`.
Unknown variables, empty templates, overly long templates, and characters that
could enable HTML/code injection (`< > ( ) ; \` $`) are rejected with 400.

Default template: `Token {token}, please proceed to {counter}.`

### Duplicate announcement protection

The public display never announces:

- the same event twice (duplicate SSE delivery)
- the same event again after reconnect (the initial reconnect snapshot is
  `QUEUE_UPDATED`, which never announces)
- historical events on initial page load

Event identity is derived from the sanitized snapshot payload:
`eventType:tokenLabel:calledAt:recalled:recallCount`. `calledAt` is a stable
timestamp per call; `recallCount` increments per recall, so recalls announce
again while duplicates are dropped. A bounded recent-key cache (200 entries)
prevents memory growth.

### Browser speech strategy

- `window.speechSynthesis` with a client-side serialized queue: the next
  utterance starts only after the previous one ends.
- A 15s watchdog forces completion if a browser fails to fire `onend`, so stale
  utterances never block the queue. The queue is capped at 5 pending items
  (oldest dropped).
- Speech unavailable in the browser is handled safely: the display shows
  "Voice unavailable" and no controls.
- Browser autoplay restrictions are never bypassed. Announcements are disabled
  by default; a visible **"🔇 Enable Announcements"** control (a user gesture)
  unlocks audio and the choice persists in `localStorage`.
- `prefers-reduced-motion` users get announcements disabled by default (they
  can still enable them explicitly).
- Settings (enabled, voice, speech rate, volume) are client-local on the
  public display and are not exposed through any public API.

## 2. Printing

Authenticated staff print tickets through:

```text
POST /branches/:branchId/tokens/:tokenId/print
```

The response contains only safe ticket fields: organization name, branch name,
token label, business date, issued time, service, department, optional counter,
status, and printed timestamp. **No patient name, phone, email, membership, or
authentication data is returned.**

The web UI prints from `/dashboard/tokens/[tokenId]/print?branch=:branchId`,
which calls the endpoint and opens the browser print dialog. The ticket sheet
is styled for 80mm thermal printers (`@page { size: 80mm auto }`) with an A4
fallback, is readable in monochrome, and hides all page chrome under
`@media print`. No proprietary printer SDK or direct hardware integration is
required; the existing `docs/PRINTER_ARCHITECTURE.md` bridge remains the future
path for direct ESC/POS printing.

Print RBAC:

| Role | Allowed |
| --- | --- |
| ORG_ADMIN | any token in the organization's branch |
| BRANCH_ADMIN | any token in their own branch |
| RECEPTIONIST | any token in the branch |
| COUNTER_OPERATOR | only the active (CALLED/SERVING) token of an assigned counter |
| Public | never (no public print endpoint) |

## 3. Notification provider abstraction

```text
NotificationProvider (interface)
├── NoopProvider  (default, NOTIFICATION_PROVIDER=noop)
└── MockProvider  (development only, NOTIFICATION_PROVIDER=mock)
```

Methods: `sendSMS(recipient, message)` and `sendWhatsApp(recipient, message)`,
both returning `ProviderResult`:

```ts
{ ok: true, providerMessageId?, delivered: boolean }
{ ok: false, transient: boolean, errorCode: string }
```

- `NoopProvider` accepts the request but never performs delivery and never
  claims delivery — records transition to `SENT` at most.
- `MockProvider` prints the masked recipient and message to the console for
  local inspection; it never claims delivery.
- A real provider (Twilio, MSG91, Meta WhatsApp, etc.) can be added by
  implementing `NotificationProvider` and returning `delivered: true` only when
  the provider confirms delivery.

**Delivery is not configured.** Until a real provider is implemented, the
system never claims `DELIVERED`.

## 4. Notification lifecycle and retry

Triggers are hooked into existing queue operations (fire-and-forget, never
awaited by the caller):

```text
TOKEN_CREATED    tokens.generate
TOKEN_CALLED     queue-calling call next / call specific
TOKEN_RECALLED   queue-calling recall
TOKEN_COMPLETED  queue-calling complete
TOKEN_CANCELLED  tokens.cancel
```

Lifecycle per channel (SMS / WhatsApp):

```text
QUEUED → SENT → (provider confirms) DELIVERED
       └→ FAILED (permanent error, or transient exhausted)
```

Retry policy:

- bounded: `maxAttempts = 3`
- transient failures are retried with a small linear backoff
- permanent failures and provider exceptions terminate immediately
  (`PROVIDER_EXCEPTION` is treated as transient to allow bounded retries)
- no infinite retries

## 5. Failure isolation

Notification failure never rolls back or blocks queue operations:

```text
Token successfully called
  ↓
SSE event succeeds/fails independently
  ↓
Voice announcement succeeds/fails independently
  ↓
SMS/WhatsApp succeeds/fails independently
```

`CALL NEXT` remains fast: dispatch is asynchronous (`void ... .catch`), every
dispatch failure is logged and swallowed, and the queue state transition is
committed before any notification work begins. The e2e suite proves queue
operations return 201 while the provider is in permanent-failure and
throwing modes.

## 6. Privacy

- patient phone is read only inside the notification service at send time and
  is never returned by any API
- notification records store no message content and no phone number
- logs mask phone numbers (`******1234`)
- public display and notification APIs never expose patient fields

## 7. Tenant and branch isolation

Notification settings and history are scoped through the trusted
`Organization → Branch` chain resolved from `TenantGuard` context; client
bodies never select a tenant. `BRANCH_ADMIN` access is limited to the branch on
their active membership; `ORG_ADMIN` and `SUPER_ADMIN` are organization-wide.
Cross-tenant and cross-branch reads return 403/404.

## 8. Data model

Migration `20260809170000_phase_7_notifications` adds:

- `NotificationSetting` (one per branch): announcement/sound toggles, language,
  speech rate, volume, announcement template, SMS/WhatsApp toggles
- `Notification` (history): branchId, tokenId, channel, eventType, status,
  provider, providerMessageId, attempts, errorCode, sentAt, failedAt,
  createdAt
- enums `NotificationChannel`, `NotificationEventType`, `NotificationStatus`

Both tables use restrictive foreign keys (`Restrict`) so history cannot be
orphaned, and indexes cover `(branchId, createdAt)`, `(branchId, status)`, and
`(tokenId)`.

## 9. API surface

```text
GET  /branches/:branchId/notification-settings   (ORG_ADMIN, BRANCH_ADMIN)
PATCH /branches/:branchId/notification-settings  (ORG_ADMIN, BRANCH_ADMIN)
GET  /branches/:branchId/notifications           (ORG_ADMIN, BRANCH_ADMIN)
POST /branches/:branchId/tokens/:tokenId/print   (ORG_ADMIN, BRANCH_ADMIN, RECEPTIONIST, COUNTER_OPERATOR)
```

Public endpoints remain limited to the Phase 6 display APIs (read-only). There
is no public print, notification, settings, or template mutation.

## 10. Future scaling: BullMQ / Redis

Phase 7 intentionally does not introduce BullMQ or a distributed queue. The
notification dispatch is a clean service abstraction (`NotificationsService`)
that can later be connected to BullMQ/Redis workers without changing queue
operations or the provider interface. The planned path:

```text
Queue operation → publish durable event
      ↓
Notification worker (BullMQ, future) → bounded retries with backoff
      ↓
NotificationProvider → provider webhook/status callback → DELIVERED
```

`REDIS_URL` already exists in the environment and docker-compose for that
future work.
