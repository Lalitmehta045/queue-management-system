# Audit Logging & System Activity Architecture

## Overview
The Audit Logging system provides an immutable, append-only, tenant-isolated security trace for all system activities in the Queue Management System. It captures operational state changes and authentication events across organizations and branches.

---

## Action Taxonomy
The controlled vocabulary of audit actions supported by the system includes:
- **Authentication**: `AUTH_LOGIN`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`
- **Organization & Branch**: `ORGANIZATION_UPDATED`, `BRANCH_CREATED`, `BRANCH_UPDATED`, `BRANCH_ACTIVATED`, `BRANCH_DEACTIVATED`
- **Departments & Services**: `DEPARTMENT_CREATED`, `DEPARTMENT_UPDATED`, `DEPARTMENT_ACTIVATED`, `DEPARTMENT_DEACTIVATED`, `SERVICE_CREATED`, `SERVICE_UPDATED`, `SERVICE_ACTIVATED`, `SERVICE_DEACTIVATED`
- **Counters & Operators**: `COUNTER_CREATED`, `COUNTER_UPDATED`, `COUNTER_ACTIVATED`, `COUNTER_DEACTIVATED`, `OPERATOR_ASSIGNED`, `OPERATOR_UNASSIGNED`
- **Patients**: `PATIENT_CREATED`, `PATIENT_UPDATED`, `PATIENT_ACTIVATED`, `PATIENT_DEACTIVATED`
- **Queue Entries & Tokens**: `QUEUE_ENTRY_CREATED`, `QUEUE_ENTRY_CANCELLED`, `TOKEN_CREATED`, `TOKEN_CANCELLED`, `TOKEN_CALLED`, `TOKEN_RECALLED`, `TOKEN_SKIPPED`, `TOKEN_SERVED`, `TOKEN_COMPLETED`
- **Appointments**: `APPOINTMENT_CREATED`, `APPOINTMENT_UPDATED`, `APPOINTMENT_CANCELLED`
- **Notifications & Displays**: `NOTIFICATION_SETTING_UPDATED`, `DISPLAY_UPDATED`

---

## Tenant Isolation & RBAC
- **Tenant Context**: Every audit event is bound to an `organizationId` and (where applicable) a `branchId`.
- **Query Protection**: API endpoints query records strictly scoped to the caller's authorized `organizationId` and `branchId`.
- **Role-Based Access Control**:
  - `SUPER_ADMIN`: Global audit access.
  - `ORG_ADMIN`: Access to audit logs for any branch within their active organization.
  - `BRANCH_ADMIN`: Access restricted exclusively to their assigned branch.
  - All other roles (`RECEPTIONIST`, `DOCTOR`, `COUNTER_OPERATOR`, `DISPLAY_OPERATOR`): Access **DENIED**.
- **Append-Only Integrity**: Audit records are strictly read-only to application users. No API endpoint exists to update or delete audit records.

---

## Metadata Sanitization & Privacy
Metadata payloads are explicitly sanitized using per-resource allowlists before database storage:
- **Sensitive Key Pattern Matching**: Any property matching `password`, `token`, `secret`, `otp`, `authorization`, `cookie`, `session`, `hash`, `phone`, `email`, `firstName`, `lastName`, `notes` is stripped automatically.
- **Allowed Keys**: Only safe, non-sensitive identifiers and metrics (e.g. `patientNumber`, `displayNumber`, `changedFields`, `status`, `durationMinutes`) are recorded.

---

## Failure Isolation
Audit logging calls in core mutation handlers are designed to be non-blocking with try/catch error handling. Failures in audit persistence log warnings but do not cause queue operations, token state changes, or counter actions to fail unexpectedly.

---

## Proxy & IP Limitations
Client IP addresses and user agents are extracted directly from trusted HTTP request headers (`req.ip` / `req.headers['user-agent']`). Client-supplied IP overrides in body/query parameters are strictly ignored.
