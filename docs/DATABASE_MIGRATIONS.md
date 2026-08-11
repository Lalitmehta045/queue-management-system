# Database Migration Deployment Strategy

## Overview

This document defines the production-safe process for deploying database schema changes using Prisma migrations.

## Core Principle

**In production, ALWAYS use `prisma migrate deploy`**

This command:
- Applies only unapplied migrations in serial order
- Never resets, drops, or recreates the database
- Never modifies historical migration records
- Fails safely if migrations cannot be applied
- Preserves all existing data

**NEVER use**:
- `prisma migrate dev` (may reset and apply dev-only changes)
- `prisma migrate reset` (destructive, drops database)
- Manual SQL modifications (break migration history)

## Migration Lifecycle

### 1. Development Phase

In development, migrations are created and tested locally:

```bash
# Create new migration after schema changes
npx prisma migrate dev --name descriptive_name

# Review generated migration
cat prisma/migrations/<timestamp>_<name>/migration.sql

# Test migration with test data
npm run test

# Verify migration can be reset/replayed
npx prisma migrate reset --force
npm run test
```

### 2. Code Review Phase

Before committing:

- [ ] Migration SQL is reviewed for correctness
- [ ] Migration is backward-compatible (where possible)
- [ ] Migration has no destructive operations
- [ ] Migration performance is acceptable
- [ ] Test data passes after migration
- [ ] Rollback plan is documented (if needed)

Example migration file structure:

```
prisma/migrations/
  20260809120000_initial_schema/
    migration.sql
  20260810150000_add_user_email_field/
    migration.sql
  20260811100000_create_audit_log_table/
    migration.sql
```

### 3. CI/CD Phase

In GitHub Actions:

```yaml
- name: Validate Prisma schema
  run: npx prisma validate

- name: Generate Prisma client
  run: npx prisma generate

- name: Run tests
  run: npm run test

- name: Build application
  run: npm run build
```

**Important**: Migrations are NOT applied in CI. They are applied in production separately.

### 4. Production Deployment Phase

#### Pre-Migration Verification

```bash
# 1. Verify current migration status
npx prisma migrate status

# Expected output:
# Current database revision: 20260810150000_add_user_email_field
# Migrations pending: 1
#   20260811100000_create_audit_log_table
```

#### Apply Migrations

```bash
# 2. Apply pending migrations
npx prisma migrate deploy

# OR in container before starting application:
docker run --rm \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://..." \
  api:latest \
  npx prisma migrate deploy
```

#### Post-Migration Verification

```bash
# 3. Verify all migrations applied
npx prisma migrate status

# Expected output:
# Current database revision: 20260811100000_create_audit_log_table
# All migrations have been applied.

# 4. Verify Prisma client matches schema
npx prisma generate

# Should show no changes to generated client

# 5. Start application and verify health
curl https://api.example.com/health/ready
# Expected: 200 OK
```

## Migration Best Practices

### Backward Compatibility

Migrations should be backward-compatible where possible:

**Good** - Backward Compatible:
```sql
-- Add new column with default value
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT false;

-- Rename column (via migration, not through schema)
ALTER TABLE users RENAME COLUMN email_address TO email;

-- Add new nullable column
ALTER TABLE organizations ADD COLUMN phone_number VARCHAR(20);

-- Create new index
CREATE INDEX idx_users_email ON users(email);
```

**Avoid** - Breaking Changes:
```sql
-- Drop column (loses data)
ALTER TABLE users DROP COLUMN legacy_field;

-- Change column type (may lose data or break queries)
ALTER TABLE users ALTER COLUMN user_id TYPE TEXT;

-- Rename table (breaks foreign keys)
ALTER TABLE users RENAME TO user_account;

-- Make column NOT NULL without default (fails if nulls exist)
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

### Performance Considerations

Large table migrations can impact production:

```sql
-- ❌ BAD: Locks entire table during index creation
CREATE INDEX idx_large_table ON large_table(column_name);

-- ✅ GOOD: Concurrent index creation (PostgreSQL 11+)
CREATE INDEX CONCURRENTLY idx_large_table ON large_table(column_name);

-- ❌ BAD: Alters millions of rows
UPDATE users SET status = 'active' WHERE status IS NULL;

-- ✅ GOOD: Batches or uses default value
ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active';
```

### Testing Migrations

Before deploying to production:

```bash
# 1. Test in development
npx prisma migrate dev --name test_migration
npm run test

# 2. Test reset/replay (simulates starting from previous state)
npx prisma migrate reset --force
npm run test

# 3. Test in CI/CD environment
# GitHub Actions provides test database with services

# 4. Manual testing on staging (if available)
# Apply migrations and verify all features work
```

## Migration Rollback Strategy

### Application Rollback

If the application has a bug after migration:

1. **Identify rollback point** - Which migration caused the issue?
2. **Create new migration** - Don't delete old migrations
3. **Add remediation SQL** - Undo the problematic changes
4. **Test thoroughly** - Verify rollback in development
5. **Deploy new migration** - Apply via `prisma migrate deploy`

**Example**:

If migration `20260811_create_audit_log_table` added a constraint that caused issues:

```bash
# 1. Create rollback migration
npx prisma migrate dev --name drop_audit_log_constraint_rollback

# 2. Edit migration to undo the constraint
# prisma/migrations/20260812_drop_audit_log_constraint_rollback/migration.sql
ALTER TABLE audit_log DROP CONSTRAINT audit_log_type_check;

# 3. Test rollback
npx prisma migrate reset --force
npm run test

# 4. Deploy rollback
npx prisma migrate deploy
```

### Database Rollback

If database schema is corrupted:

1. **STOP APPLICATION INSTANCES** - Prevent further writes
2. **RESTORE FROM BACKUP** - Use documented backup procedure
3. **RE-APPLY MIGRATIONS** - Bring database to current schema
4. **VERIFY DATA** - Check critical data is intact
5. **RESTART APPLICATION** - Bring application back online

**Do NOT**:
- Reset database (`prisma migrate reset`)
- Drop migrations (`rm -rf prisma/migrations/...`)
- Manual SQL deletes

See OPERATIONS.md for detailed restore procedures.

## Common Issues & Solutions

### Migration Status Shows "Pending" Migrations

**Symptom**: 
```
Migrations pending:
  20260811100000_create_audit_log_table
```

**Causes**:
1. Migration files exist but haven't been deployed
2. Another deployment process is running
3. Database is on different host than expected

**Solution**:
```bash
# Verify database connection
npx prisma db execute --stdin < <(echo "SELECT 1")

# Apply pending migrations
npx prisma migrate deploy

# Verify again
npx prisma migrate status
```

### Migration Fails: "Column Already Exists"

**Symptom**: Migration fails during `prisma migrate deploy`

**Cause**: Duplicate migration (likely from merge conflict or manual intervention)

**Solution**:
```bash
# 1. Check migration files for duplicates
ls -la prisma/migrations/ | grep <timestamp>

# 2. If truly duplicate, remove newer one (if safe)
# Coordinate with team first!

# 3. If migration was partially applied, manually complete it
psql -U queue_user queue_management -c "<SQL from migration>"

# 4. Mark migration as applied
INSERT INTO _prisma_migrations (id, checksum, finished_at, execution_time, migration_name, logs, rolled_back_at) 
VALUES (
  '<new-uuid>',
  '<checksum>',
  NOW(),
  0,
  '20260811100000_create_audit_log_table',
  NULL,
  NULL
);

# 5. Retry
npx prisma migrate deploy
```

### Migration Fails: "Database Disk Full"

**Symptom**: Migration fails with "No space left on device"

**Solution**:
```bash
# 1. Stop all application instances
docker stop api-container

# 2. Check disk space
df -h /var/lib/postgresql

# 3. Remove old backups (if safe)
rm /backups/old_backups_* 

# 4. Expand disk (contact infrastructure)

# 5. Retry migration
npx prisma migrate deploy

# 6. Restart application
docker start api-container
```

### Migration Fails: "Permission Denied"

**Symptom**: Migration fails with permission errors

**Cause**: Database user lacks necessary permissions

**Solution**:
```bash
# 1. Check user permissions (as PostgreSQL superuser)
psql -U postgres -c "
  SELECT grantee, privilege_type 
  FROM information_schema.table_privileges 
  WHERE table_name='organization' AND grantee='queue_user';
"

# 2. Grant necessary permissions
psql -U postgres -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO queue_user;"
psql -U postgres -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO queue_user;"

# 3. Retry migration
npx prisma migrate deploy
```

## Maintenance & Cleanup

### Regular Maintenance

```bash
# Monthly: Verify migrations are valid
npx prisma migrate status
npx prisma validate

# Quarterly: Review old migrations for cleanup opportunities
ls -la prisma/migrations/ | head -10
```

### Migration Archive

Keep historical migrations indefinitely:

- Migrations document schema evolution
- Required for point-in-time recovery
- Safe to keep (do not delete)

```bash
# List all migrations
ls -1 prisma/migrations/ | wc -l

# Example: 47 migrations after 2 years of development
```

## Emergency Procedures

### If Migration Corrupts Data

1. **Stop all writes** - Scale down application
2. **Assess damage** - Query affected tables
3. **Restore from backup** - Use OPERATIONS.md procedure
4. **Re-apply migrations** - Start from last good backup point
5. **Investigate cause** - Review migration SQL
6. **Fix migration** - Create new migration to remediate
7. **Test thoroughly** - Verify fix before re-deploying

### If Migration Locks Table (Long-Running)

```bash
# 1. Check for locks
psql -c "SELECT * FROM pg_locks l JOIN pg_stat_activity a ON l.pid = a.pid WHERE relation = 'users'::regclass;"

# 2. If safe to cancel
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%ALTER TABLE users%';"

# 3. Restart migration
npx prisma migrate deploy
```

## References

- `DEPLOYMENT.md` - Deployment process including migration steps
- `OPERATIONS.md` - Operations procedures including restore
- `PRODUCTION_CHECKLIST.md` - Pre-deployment verification
- [Prisma Migrate Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- PostgreSQL Documentation
