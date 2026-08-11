# Phase 17: Patient QR Queue Status & Live Waiting Page

## Overview

Phase 17 implements a public, mobile-friendly, privacy-first queue status page for patients.

Patients scan a QR code printed on their token ticket and monitor their real-time queue position from any device **without needing to log in or authenticate**.

---

## 1. Public Identifier Strategy

### Chosen Approach: Token.id (UUID v4)

The existing `Token.id` field (`@id @default(uuid()) @db.Uuid`) is used directly as the public identifier.

**Why this is secure:**
- UUID v4 is cryptographically random (122 bits of entropy)
- Not guessable, not sequential
- Not derivable from patient information, branch ID, or organization ID
- No database migration was required

**Public URL format:**
```
https://YOUR-WEB-DOMAIN/queue/<Token.id>
```

Example:
```
https://app.example.com/queue/550e8400-e29b-41d4-a716-446655440000
```

**What is NOT exposed as the identifier:**
- Patient ID (`Patient.id`)
- Queue Entry ID (`QueueEntry.id`)
- Sequential display number (T-001, T-002...)
- Organization ID
- Branch ID

---

## 2. Public API

### `GET /public/queue/:publicTokenId`

Read-only, no authentication required.

**Rate limit:** 100 requests / 60 seconds per client (via `@nestjs/throttler`)

**Response (safe fields only):**
```json
{
  "tokenLabel":            "T-002",
  "status":                "WAITING",
  "serviceName":           "General OPD",
  "departmentName":        "Outpatient",
  "businessDate":          "2026-08-10",
  "currentServingToken":   "T-001",
  "peopleAhead":           3,
  "estimatedWaitMinutes":  18,
  "lastUpdated":           "2026-08-10T10:15:30.000Z"
}
```

**Fields explicitly NOT returned:**
- Patient name, phone, email
- Patient ID or patient number
- Organization ID or branch ID
- Operator name or user ID
- Counter ID or counter name
- Queue entry ID
- Membership or priority category
- JWT or session tokens
- Any audit metadata

### `GET /public/queue/:publicTokenId/events`

Server-Sent Events (SSE) stream. No authentication required.

**Rate limit:** 100 connections / 60 seconds per client

**Events emitted:**
| Event | Trigger |
|-------|---------|
| `QUEUE_UPDATED` | Token created, initial snapshot |
| `TOKEN_CALLED` | Counter calls this token |
| `TOKEN_RECALLED` | Counter recalls token |
| `TOKEN_SERVED` | Token enters SERVING state |
| `TOKEN_SKIPPED` | Token is skipped |
| `TOKEN_COMPLETED` | Service completed |
| `KEEPALIVE` | Every 25 seconds (heartbeat) |

---

## 3. Token Status Handling

| Status | Display |
|--------|---------|
| `WAITING` | Shows token, Now Serving, People Ahead, Estimated Wait |
| `CALLED` | "Your Turn!" banner with call-to-action to proceed to counter |
| `SERVING` | "Being Served" confirmation |
| `COMPLETED` | "Service complete" confirmation |
| `SKIPPED` | "Skipped" inactive state |
| `CANCELLED` | "Cancelled" inactive state |

---

## 4. People-Ahead Calculation

The `peopleAhead` count mirrors the **Phase 14 Priority Queue Engine** ordering used by `QueueCallingService.callNext()`.

### Algorithm (DB-side count, no client data):

**Case A — Starved tokens (issued > 1 hour ago):**
Count of tokens that are:
- Status = `WAITING`
- Same service
- `QueueEntry.status` = `WAITING`
- Also starved (issued > 1 hour ago)
- AND positioned before this token: `businessDate < X` OR `(businessDate = X AND sequenceNumber < Y)`

**Case B — Non-starved tokens (normal priority):**
Count of tokens that are:
- Status = `WAITING`
- `counterId IS NULL`
- Same service
- `QueueEntry.status` = `WAITING`
- AND one of:
  1. Is starved (will be served before all non-starved)
  2. Higher `priorityWeight`
  3. Same `priorityWeight` but earlier `businessDate` / `sequenceNumber`

**Privacy note:** Only the count is returned, never individual token details or priority categories of other patients.

---

## 5. Estimated Wait Algorithm

```
avgServiceSeconds = AVG(completedAt - servingAt) 
                   WHERE serviceId = X
                     AND status = COMPLETED
                     AND servingAt IS NOT NULL
                     AND completedAt IS NOT NULL

estimatedWaitMinutes = max(1, ceil(peopleAhead × avgServiceSeconds / 60))
```

- Uses historical data from the same service
- Parameterized raw SQL (no string interpolation)
- Returns `null` (displayed as "Unavailable") if insufficient data
- Never returns misleading zero

---

## 6. QR Code Generation

QR codes are generated client-side using `react-qr-code@^2.2.0`.

**Encoded URL:**
```
{window.location.origin}/queue/{tokenId}
```

The QR code uses `window.location.origin` so it adapts automatically to any deployment domain.

**Appears in:** Token print ticket (`/dashboard/tokens/[tokenId]/print`)

**QR code encodes ONLY the public URL. Never encodes:**
- Patient phone or email
- JWT or API keys
- Organization or branch IDs

---

## 7. Print Integration

The ticket print page (`apps/web/src/app/dashboard/tokens/[tokenId]/print/page.tsx`) includes:

- Organization name
- Branch name and code
- Token number (large, prominent)
- Service name
- Department name
- Business date
- Issued timestamp
- **QR code** (96×96px, Level M)
- Instruction: "Scan to check queue status"

**Patient PII is NOT printed** (no name, phone, email).

Print supports 80mm thermal and A4 paper via CSS `@media print`.

---

## 8. Reception Panel Integration

After token generation (`apps/web/src/app/dashboard/reception/page.tsx`):

```
TOKEN GENERATED

T-002

[ PRINT TICKET ]   [ OPEN QUEUE STATUS ]   [ DONE ]
```

- **PRINT TICKET** opens the print page in a new tab (which includes the QR code)
- **OPEN QUEUE STATUS** opens `/queue/{tokenId}` in a new tab

---

## 9. Mobile UI

**Route:** `apps/web/src/app/queue/[publicTokenId]/page.tsx`

Features:
- Full-screen dark glassmorphism design
- Animated token display with gradient text
- Live connection indicator (🟢 pulsing dot)
- Context-aware status pill with emoji
- Cards for: Now Serving, People Ahead, Estimated Wait
- State-specific messages for each token status
- Auto-reconnects on SSE disconnect
- Fallback HTTP poll if SSE unavailable
- `robots: noindex, nofollow` to prevent search engine indexing
- No PII rendered on page

---

## 10. SSE Architecture

The SSE stream reuses the existing `DisplayEventsService` pub/sub bus:

```
QueueCallingService.callNext()
  → displayEvents.publish(branchId, 'TOKEN_CALLED')
    → PublicQueueService subscriber (per token)
      → fetches fresh snapshot via getPublicTokenStatus()
        → pushes sanitized snapshot to client as {type: 'TOKEN_CALLED', data: snapshot}
```

**Lifecycle:**
- Max connections per token: 5 (protected by `activeSubscriptions` map)
- Heartbeat: every 25 seconds (`KEEPALIVE` event)
- Bounded lifecycle: 12 hours (auto-complete to allow reconnect)

---

## 11. Privacy Model

| Data | Exposed? |
|------|----------|
| Token display number | ✅ Yes (T-001) |
| Service name | ✅ Yes |
| Department name | ✅ Yes |
| Business date | ✅ Yes |
| Queue status | ✅ Yes |
| Now Serving (label only) | ✅ Yes |
| People ahead (count only) | ✅ Yes (WAITING only) |
| Estimated wait | ✅ Yes (WAITING only) |
| Patient name | ❌ Never |
| Patient phone | ❌ Never |
| Patient email | ❌ Never |
| Patient ID | ❌ Never |
| Organization ID | ❌ Never |
| Branch ID | ❌ Never |
| Priority category | ❌ Never |
| Other patients' data | ❌ Never |
| Operator identity | ❌ Never |
| Counter details | ❌ Never |
| JWT / session | ❌ Never |

---

## 12. Rate Limiting

| Endpoint | Limit | TTL |
|----------|-------|-----|
| `GET /public/queue/:id` | 100 requests | 60 seconds |
| `GET /public/queue/:id/events` | 100 requests | 60 seconds |
| Per-token SSE connections | 5 concurrent | In-memory |

Rate limiting is applied via `@Throttle({ default: { limit: 100, ttl: 60000 } })` decorators, reusing the existing `@nestjs/throttler` infrastructure from Phase 11.

---

## 13. Tenant Isolation & Security

1. The server resolves `publicTokenId → Token → QueueEntry → Service → Department → Branch → Organization` entirely server-side
2. No `organizationId`, `branchId`, or `patientId` is accepted from the client
3. Cross-token isolation: you cannot access another token by manipulating any client-supplied parameter
4. Invalid or non-existent UUIDs return `404 Not Found`
5. Malformed (non-UUID) identifiers return `404 Not Found`

---

## 14. Known Limitations

1. **In-process event bus**: `DisplayEventsService` uses an in-memory Map. In a multi-instance deployment, events from one API instance will not reach SSE connections on another instance. This is a known architectural constraint (Redis Pub/Sub would be needed for multi-instance, but is out of scope per Phase 17).

2. **Estimated wait accuracy**: Wait time estimates are based on historical average service duration. High variance in service times may make estimates inaccurate. The UI labels this as "~X min" to communicate the approximation.

3. **12-hour SSE lifecycle**: SSE connections are auto-closed after 12 hours. Clients must reconnect (the frontend handles this automatically via EventSource reconnection).

4. **QR URL domain**: The QR code uses `window.location.origin`, so if the page is printed from localhost during development, the QR code will encode a localhost URL.

---

## 15. No Database Changes

Zero schema changes were required. The existing `Token.id` (UUID v4, cryptographically random) serves as a secure public identifier.

Migration status: `Database schema is up to date!` ✅
