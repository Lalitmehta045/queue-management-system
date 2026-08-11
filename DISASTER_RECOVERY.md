# Backup and Disaster Recovery (Disaster Recovery Plan)

This document outlines the backup requirements, verification steps, and safe database recovery runbook for the Queue Management System.

## 1. Database Backup Requirements

The system utilizes PostgreSQL as the primary datastore. Backups must capture both schema and data to ensure full recoverability.

*   **Frequency:**
    *   Full backup: Daily (during off-peak hours).
    *   Continuous Archiving (WAL): Real-time (using tools like `pgBackRest` or `wal-g`).
*   **Retention:**
    *   Daily backups retained for 30 days.
    *   Weekly backups retained for 6 months.
    *   Monthly backups retained for 1 year.
*   **Storage Location:**
    *   Off-site secure cloud storage (e.g., AWS S3, Google Cloud Storage) with Object Lock (WORM) enabled for protection against ransomware.
*   **Encryption:**
    *   Backups must be encrypted at rest using AES-256 or equivalent.

## 2. Backup Verification and Restore Procedure

Backups are only useful if they can be restored. Regular testing is mandatory.

*   **Verification Schedule:** A full restore test MUST be performed monthly.
*   **Verification Environment:** Restores must be performed in a dedicated, isolated staging environment that mimics production but has NO network access to production integration endpoints (e.g., SMS/WhatsApp gateways, Webhooks).
*   **Success Criteria:**
    *   Restore completes without errors.
    *   The `smart_queue` database schema is intact.
    *   Test queries (e.g., validating the number of active branches or recent queue entries) match expected results from the backup time.

## 3. Safe Database Recovery Runbook (Production)

> [!WARNING]
> This runbook is for **PRODUCTION RECOVERY**. For development or test environments, refer to `DEVELOPMENT_RECOVERY.md`. Never use destructive automated reset scripts (like `prisma migrate reset`) against a production database.

If a production database corruption or severe data loss event occurs, follow these steps:

### Phase 1: Assessment and Triage
1.  **Declare Incident:** Notify stakeholders and declare a Severity 1 incident.
2.  **Halt Traffic:** Pause all incoming traffic to the API to prevent further data corruption or inconsistencies during recovery.
    *   *Action:* Update load balancer rules to return a 503 Service Unavailable page, or scale application pods to 0.
3.  **Identify Recovery Point:** Determine the exact timestamp just before the corruption or data loss occurred (Recovery Point Objective - RPO).

### Phase 2: Recovery Execution
1.  **Provision Recovery Infrastructure:** Do NOT overwrite the compromised database immediately. Provision a *new* PostgreSQL instance with identical specs.
2.  **Restore Base Backup:** Use your continuous archiving tool to restore the most recent full backup to the new instance.
    *   *Example (pgBackRest):* `pgbackrest --stanza=smart_queue --type=time --target="2026-08-10 14:00:00" restore`
3.  **Apply WAL Logs:** Allow the system to replay WAL logs up to the identified Recovery Point.
4.  **Validate Restored Data:**
    *   Connect to the new instance.
    *   Run integrity checks.
    *   Verify critical tables (`Organization`, `Branch`, `Appointment`, `QueueEntry`).
5.  **Apply Prisma Migrations (If necessary):**
    *   Ensure the Prisma schema matches the deployed application version.
    *   Run `npx prisma migrate status` to verify the schema state against the restored DB.
    *   Do **NOT** run `prisma migrate reset` or `prisma db push`. Only use `prisma migrate deploy` if pending migrations exist.

### Phase 3: Cutover and Post-Incident
1.  **Update Connection Strings:** Update the `DATABASE_URL` environment variables in the production environment to point to the new, restored database instance.
2.  **Resume Traffic:** Restore API traffic (e.g., scale pods back up or remove the 503 page).
3.  **Monitor:** Closely monitor error rates, queue creation, and token generation for the next 2 hours.
4.  **Post-Mortem:** Conduct an incident review within 48 hours to identify the root cause and improve this runbook.
