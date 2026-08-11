# Incident Response Plan

This document provides a framework for handling production incidents within the Queue Management System.

## Severity Levels

*   **SEV-1 (Critical):** Core system is completely unavailable (e.g., Database down, API unreachable). All branches affected. Immediate action required (24/7).
*   **SEV-2 (High):** Major functionality broken for multiple users/branches (e.g., Queue creation failing, notifications not sending, printer bridge disconnected for an entire branch). Action required within 1 hour.
*   **SEV-3 (Medium):** Non-critical feature broken or issue isolated to a small number of users (e.g., Analytics dashboard not updating, single printer failing). Action required during business hours.
*   **SEV-4 (Low):** Minor bug or cosmetic issue. Action required during normal sprint cycle.

## Communication Channels

*   **Primary Incident Channel:** Dedicated Slack/Teams channel (e.g., `#incidents-qms`).
*   **Status Page:** Update the public status page for SEV-1 and SEV-2 incidents.
*   **Stakeholder Updates:** Email updates to branch managers and organizational admins every 30-60 minutes during SEV-1/SEV-2 incidents.

## Incident Lifecycle

1.  **Detection & Triage:**
    *   Monitor alerts (e.g., from `/health/diagnostics` failures, high error rates).
    *   Assess severity and declare the incident in the primary channel.
2.  **Containment & Mitigation:**
    *   Stop the bleeding. This may involve:
        *   Pausing queues using the `Pause Queue` feature in the UI to prevent data corruption.
        *   Rolling back a recent deployment.
        *   Blocking malicious traffic.
3.  **Resolution:**
    *   Identify the root cause.
    *   Develop and deploy a fix.
    *   Verify the system is fully operational.
4.  **Post-Incident (Post-Mortem):**
    *   Conduct a blameless post-mortem within 48 hours for all SEV-1 and SEV-2 incidents.
    *   Document the timeline, root cause, impact, and action items to prevent recurrence.
    *   Update this document or the `DISASTER_RECOVERY.md` if necessary.

## Common Scenarios & Runbooks

### Scenario A: High API Latency / Database Overload
*   **Check:** Monitor database connection pool and query times.
*   **Action:**
    *   Temporarily pause queues for busy branches to reduce write load.
    *   Scale API pods.
    *   Investigate slow queries using `pg_stat_statements`.

### Scenario B: Printer Bridge Disconnections
*   **Check:** Verify printer health via `GET /api/branches/:branchId/printers/:printerId/health`.
*   **Action:**
    *   If a single printer is down, instruct the branch to restart the local bridge agent.
    *   If all printers are down, check the SSE (Server-Sent Events) connection limits on the API gateway/load balancer. Ensure long-lived connections are allowed.

### Scenario C: SMS/WhatsApp Notification Failures
*   **Check:** Verify provider health via `GET /api/branches/:branchId/notifications/health`.
*   **Action:**
    *   If the provider is `disabled` or `unavailable`, check external provider status pages (e.g., Twilio).
    *   The system is designed to swallow notification errors (fire-and-forget), so core queue operations will continue. Notify branches to rely on visual displays (TVs) until notifications are restored.
