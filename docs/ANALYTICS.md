# Analytics & Reporting (Phase 9)

## Overview

Phase 9 adds a secure, tenant-isolated Analytics & Reporting layer for organization and branch administrators. All metrics are computed server-side from database data — no client-provided values are trusted for calculations.

## API Endpoints

All endpoints are under `branches/:branchId/analytics/` and require `JwtAuthGuard`, `TenantGuard`, and `RolesGuard`.

| Method | Path | RBAC | Description |
|--------|------|------|-------------|
| GET | `/branches/:branchId/analytics/summary` | ORG_ADMIN, BRANCH_ADMIN | KPI dashboard metrics |
| GET | `/branches/:branchId/analytics/services` | ORG_ADMIN, BRANCH_ADMIN | Per-service performance |
| GET | `/branches/:branchId/analytics/counters` | ORG_ADMIN, BRANCH_ADMIN | Per-counter performance |
| GET | `/branches/:branchId/analytics/trends` | ORG_ADMIN, BRANCH_ADMIN | Daily operational trends |
| GET | `/branches/:branchId/analytics/appointments` | ORG_ADMIN, BRANCH_ADMIN | Appointment analytics |
| GET | `/branches/:branchId/analytics/export` | ORG_ADMIN, BRANCH_ADMIN | CSV export |

### Query Parameters

All endpoints accept the same optional query parameters:

| Parameter | Type | Validation | Description |
|-----------|------|------------|-------------|
| `businessDate` | string | `YYYY-MM-DD` | Single business date filter |
| `startDate` | string | `YYYY-MM-DD` | Date range start (inclusive) |
| `endDate` | string | `YYYY-MM-DD` | Date range end (inclusive) |
| `serviceId` | UUID | `IsUUID` | Filter by service |
| `departmentId` | UUID | `IsUUID` | Filter by department |
| `counterId` | UUID | `IsUUID` | Filter by counter |

The export endpoint accepts an additional `type` parameter: `services`, `counters`, or `trends` (default: `services`).

## Metric Definitions

### Token Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| Tokens Issued | Total tokens created | `COUNT(Token)` |
| Tokens Called | Tokens in `CALLED` status | `COUNT(Token WHERE status = CALLED)` |
| Tokens Serving | Tokens in `SERVING` status | `COUNT(Token WHERE status = SERVING)` |
| Tokens Completed | Tokens in `COMPLETED` status | `COUNT(Token WHERE status = COMPLETED)` |
| Tokens Skipped | Tokens in `SKIPPED` status | `COUNT(Token WHERE status = SKIPPED)` |
| Tokens Cancelled | Tokens in `CANCELLED` status | `COUNT(Token WHERE status = CANCELLED)` |
| Currently Serving | `CALLED + SERVING` count | Derived |

### Time Metrics

| Metric | Definition | Formula |
|--------|-----------|---------|
| Average Waiting Time | Time from issuance to being called | `AVG(calledAt - issuedAt)` where both are non-null |
| Average Service Time | Time from service start to completion | `AVG(completedAt - servingAt)` where both are non-null |
| Average Handling Time | Total time in system | `AVG(completedAt - issuedAt)` where both are non-null |

Times are returned in **seconds**.

### Rate Metrics

| Metric | Formula |
|--------|---------|
| Completion Rate | `(completed / totalTokens) * 100` |
| Cancellation Rate | `(cancelled / totalTokens) * 100` |
| Skip Rate | `(skipped / totalTokens) * 100` |

### Queue Entry Metrics

| Metric | Definition |
|--------|-----------|
| Total Queue Entries | All queue entries in scope |
| Waiting Queue Count | Queue entries with `WAITING` status |
| Cancelled Queue Count | Queue entries with `CANCELLED` status |

Note: QueueEntry status is intentionally simple (`WAITING`/`CANCELLED`). The detailed lifecycle lives on the Token model.

### Appointment Metrics

| Metric | Definition |
|--------|-----------|
| Appointments Created | Total appointments in scope |
| Appointments Completed | Status = `COMPLETED` |
| Appointments Cancelled | Status = `CANCELLED` |
| Appointments No Show | Status = `NO_SHOW` |
| Appointment vs Walk-in | Checked-in appointments vs remaining tokens |

## Date/Business Date Behavior

- **businessDate**: Filters to a single business day. Takes precedence over startDate/endDate.
- **startDate/endDate**: Filters to a date range (inclusive). Both are optional; at least one must be provided for range filtering.
- Token queries use the `businessDate` field on the Token model.
- Appointment queries use the `appointmentDate` field.

## Tenant Isolation

Every analytics query is scoped through the authenticated organization ownership chain:

1. **TenantGuard** resolves `x-organization-id` header to an active membership
2. **authorizeBranch()** validates the branch belongs to the tenant's organization
3. **BRANCH_ADMIN** is restricted to their assigned `membership.branchId`
4. All database queries include `organizationId` in the WHERE clause through the relation chain:
   - Token → TokenSequence → Branch → Organization
   - Counter → Branch → Organization
   - Service → Department → Branch → Organization

Client-supplied `organizationId` in request bodies, query strings, or route parameters is never trusted.

## RBAC

| Role | Access |
|------|--------|
| SUPER_ADMIN | Full access (global bypass) |
| ORG_ADMIN | All branches in their organization |
| BRANCH_ADMIN | Assigned branch only |
| All other roles | No access (403) |

## Aggregation Approach

### Prisma Queries
- **Counts**: `prisma.token.count()` with scoped WHERE clauses
- **Queue entries**: `prisma.queueEntry.count()` with patient/branch scope
- **Patients**: `prisma.patient.count()` with branch scope
- **Appointments**: `prisma.appointment.count()` with branch scope and status filters

### Raw SQL (Parameterized)
Time-based averages (`AVG(calledAt - issuedAt)`) cannot be expressed in Prisma's query API. These use parameterized `$queryRawUnsafe` with PostgreSQL's `EXTRACT(EPOCH FROM interval)`:

```sql
SELECT
  AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."issuedAt")))::double precision as "avgWaitingSeconds",
  AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."servingAt")))::double precision as "avgServiceSeconds"
FROM "Token" t
JOIN "TokenSequence" ts ON t."sequenceId" = ts.id
JOIN "QueueEntry" qe ON t."queueEntryId" = qe.id
JOIN "Service" s ON qe."serviceId" = s.id
JOIN "Branch" b ON ts."branchId" = b.id
WHERE <parameterized conditions>
```

**Justification**: Prisma does not support computed aggregations on timestamp differences. This is the only approach available without loading entire tables into memory. All parameters are fully parameterized — no string interpolation of user input.

### Service/Counter/Daily Aggregations
These use PostgreSQL `FILTER (WHERE ...)` clauses for conditional counting and averaging in a single query, avoiding multiple round-trips.

## Performance Considerations

- **No full table scans**: All queries include branch + organization scope in WHERE clauses
- **Existing indexes used**: `Token(businessDate, status)`, `Token(counterId, status)`, `TokenSequence(branchId, businessDate)`
- **No data loaded into memory**: All aggregations happen in the database
- **Parallel count queries**: Summary metrics use `Promise.all()` for independent count queries
- **Read-only**: Analytics queries never mutate state or acquire locks

## Known Limitations

1. **Utilization metrics**: Counter utilization (percentage of time active) cannot be computed from the current schema. Token timestamps track when tokens were called/served/completed, but there is no counter open/close time tracking.
2. **Walk-in approximation**: Walk-in count is approximated as `totalTokens - checkedInAppointments`. This may not be exact if appointment check-ins fail to create tokens.
3. **No pre-aggregation**: Analytics are computed on-the-fly from raw data. For very large datasets, a materialized view or aggregation table could be added in the future.
4. **No cross-branch analytics**: ORG_ADMIN can query each branch individually but there is no single endpoint that aggregates across all branches.

## Sensitive Field Exclusion

Analytics responses contain **no patient PII**:
- No phone numbers
- No email addresses
- No passwords or password hashes
- No refresh tokens or session data
- No membership security fields

CSV exports follow the same exclusion rules.

## Frontend

The analytics dashboard is at `/dashboard/analytics` and includes:
- KPI cards grid (15 metrics)
- Date/business date selectors
- Branch context selector (for ORG_ADMIN)
- Service, department, counter filters
- Daily trend line chart (recharts)
- Service performance table
- Counter performance table
- CSV export buttons for each table
- Loading, empty, error, and forbidden states
