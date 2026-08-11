# Operations Manual (Production Reliability)

This document outlines the operational procedures for managing the Queue Management System in a production environment.

## 1. Zero-Downtime Queue Pause/Resume

In scenarios where a branch is overwhelmed, facing staff shortages, or experiencing a critical local failure, administrators can temporarily halt new queue entries without dropping existing ones.

### Queue Status Options
*   `OPEN`: Standard operational state. New walk-in queue entries and appointment check-ins are accepted.
*   `PAUSED`: The queue is temporarily halted.
    *   **Behavior:** The API will reject new queue entry creation (`POST /queue`) with a `409 Conflict` (Queue is currently paused for this branch).
    *   **Existing Entries:** Patients already in the queue will continue to be processed and called by counters.

### How to Pause/Resume a Queue
*   **Via UI:** Navigate to `Organization Settings -> Branches`. Locate the specific branch and click the `Pause Queue` or `Resume Queue` button.
*   **Via API (Admin/Branch Admin):**
    *   Pause: `POST /api/organizations/current/branches/:branchId/queue-pause`
    *   Resume: `POST /api/organizations/current/branches/:branchId/queue-resume`

## 2. Health Monitoring and Diagnostics

The system provides dedicated endpoints for uptime monitoring, alerting, and internal diagnostics without exposing sensitive internal state.

### External Monitoring (Ping/Uptime)
*   **Endpoint:** `GET /health`
*   **Purpose:** Use this endpoint for external services (e.g., Datadog, Pingdom, AWS Route53 Health Checks).
*   **Response:** `200 OK` if the HTTP server is responsive. It does not perform deep database checks to avoid overwhelming the system during high load.

### Internal Diagnostics (Deep Health)
*   **Endpoint:** `GET /health/diagnostics`
*   **Purpose:** Use this endpoint for internal dashboards or Kubernetes readiness probes. It performs a lightweight query (`SELECT 1`) to the database.
*   **Security:** This endpoint explicitly strips environment variables, database credentials, and internal filesystem paths. It only returns safe operational metrics.
*   **Response Format:**
    ```json
    {
      "status": "ok",
      "timestamp": "2026-08-10T14:32:00.000Z",
      "uptime": 3600,
      "database": "connected"
    }
    ```

## 3. Printer Bridge Operations

The Printer Bridge enables local printing from the cloud application. Monitoring its health is critical for operations.

### Checking Printer Bridge Health
*   **Endpoint:** `GET /api/branches/:branchId/printers/:printerId/health`
*   **Access:** Restricted to `SUPER_ADMIN`, `ORG_ADMIN`, and `BRANCH_ADMIN` roles.
*   **Purpose:** Allows administrators to verify if a local print bridge is actively polling and checking in, indicating it is online and ready to print physical tokens.
*   **Response Format:**
    ```json
    {
      "status": "online",
      "lastCheckIn": "2026-08-10T14:31:45.000Z",
      "isStale": false,
      "printerId": "uuid-..."
    }
    ```
    *Note:* A printer is considered "stale" (offline) if it hasn't checked in within the expected polling interval (typically > 2 minutes).
