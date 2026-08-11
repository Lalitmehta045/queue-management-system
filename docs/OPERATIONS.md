# Operations Guide

## Daily Operations

### Health Monitoring

Check application health:

```bash
# Check API liveness
curl https://api.example.com/health/live

# Check API readiness (includes database connectivity)
curl https://api.example.com/health/ready

# Check expected response
{
  "status": "ok",
  "service": "queue-management-api",
  "timestamp": "2026-08-09T01:00:00.000Z",
  "uptimeSeconds": 3600
}
```

If `/health/ready` returns 503:
- Database connectivity issue
- Check PostgreSQL logs: `SELECT * FROM pg_stat_activity`
- Verify connection string
- Check network connectivity

### Log Monitoring

All logs are structured JSON to stdout/stderr:

```bash
# View API logs (Docker)
docker logs api-container

# View API logs (Kubernetes)
kubectl logs -f api-deployment-pod-0

# Search logs for errors
docker logs api-container 2>&1 | grep '"level":[15][0-9]' | jq '.msg'
```

**Key log levels**:
- `10`: DEBUG
- `20`: INFO
- `30`: WARN
- `40`: ERROR
- `50`: FATAL

### Resource Monitoring

```bash
# Monitor application memory (Docker)
docker stats api-container

# Check database connections
PGPASSWORD=password psql -h localhost -U queue_user -d queue_management -c \
  "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"

# Check Redis memory
redis-cli INFO memory

# Expected output
used_memory_human: 5M
maxmemory_human: 2G
```

### Common Issues

#### High Database Connection Count

**Symptoms**: Slow queries, connection timeouts

**Solution**:
```bash
# Check active connections
psql -c "SELECT datname, usename, state, count(*) FROM pg_stat_activity GROUP BY datname, usename, state ORDER BY count DESC;"

# Kill idle connections (if safe)
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND query_start < now() - interval '5 minutes';"
```

If connections continue to grow:
- Check application connection string
- Verify connection pooling is configured
- Scale down and restart application

#### High Redis Memory

**Symptoms**: Redis evictions, slow response

**Solution**:
```bash
# Check Redis keys
redis-cli DBSIZE

# Check memory usage
redis-cli INFO memory

# Monitor for memory leaks
redis-cli MONITOR  # Caution: can impact performance
```

If memory keeps growing:
- Check for leaked keys
- Consider cache TTL reduction
- Scale Redis or add more memory

#### Database Disk Full

**Symptoms**: Application errors, new writes fail

**Solution**:
```bash
# Check disk space
df -h /var/lib/postgresql

# Check table sizes
psql -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
         FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') 
         ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"

# Check WAL files (if using streaming replication)
ls -lh /var/lib/postgresql/wal_archive/ | head -20
```

Actions:
1. Stop new writes (scale down application)
2. Archive old data if applicable
3. Remove WAL files (if safe and not streaming to standby)
4. Add more disk space
5. Monitor after recovery

## Database Operations

### Backups

**NOTE**: This section describes recommended backup procedures. Actual backup implementation is YOUR responsibility.

#### File System Backup

```bash
# Full database backup (pg_dump)
pg_dump -h localhost -U queue_user queue_management > backup_$(date +%Y%m%d_%H%M%S).sql

# Compressed backup
pg_dump -h localhost -U queue_user -Fc queue_management > backup_$(date +%Y%m%d_%H%M%S).dump

# With verbose output
pg_dump -h localhost -U queue_user -v queue_management > backup_$(date +%Y%m%d_%H%M%S).sql 2>&1

# Transfer to backup storage
scp backup_*.sql backup-server:/backups/
```

#### Continuous Archiving (Advanced)

If streaming replication is configured:

```bash
# Check WAL archiving status
psql -c "SELECT name, setting FROM pg_settings WHERE name LIKE '%archive%';"

# Verify WAL files are being archived
ls -l /var/lib/postgresql/wal_archive/ | head -5
```

#### Backup Retention

Recommended retention: 30 days full backups + continuous WAL

```bash
# Remove backups older than 30 days
find /backups -name "backup_*.sql" -mtime +30 -delete
```

### Restore Procedures

#### From pg_dump Backup

```bash
# List backups
ls -lt backup_*.sql | head -5

# Restore from text backup
psql -h localhost -U queue_user queue_management < backup_20260809_120000.sql

# Restore from compressed backup
pg_restore -h localhost -U queue_user -d queue_management backup_20260809_120000.dump

# Restore with verbose output
pg_restore -h localhost -U queue_user -v -d queue_management backup_20260809_120000.dump
```

#### Restore Procedure

1. Stop all application instances
   ```bash
   docker stop api-container
   docker stop web-container
   ```

2. Create new database (or drop and recreate)
   ```bash
   psql -U postgres -c "DROP DATABASE IF EXISTS queue_management_restore;"
   psql -U postgres -c "CREATE DATABASE queue_management_restore OWNER queue_user;"
   ```

3. Restore backup
   ```bash
   pg_restore -U queue_user -d queue_management_restore backup_20260809_120000.dump
   ```

4. Verify restore
   ```bash
   psql -U queue_user -d queue_management_restore -c "SELECT COUNT(*) FROM organization;"
   ```

5. If restore is valid, rename database
   ```bash
   psql -U postgres -c "
     ALTER DATABASE queue_management RENAME TO queue_management_backup;
     ALTER DATABASE queue_management_restore RENAME TO queue_management;
   "
   ```

6. Restart applications
   ```bash
   docker start api-container
   docker start web-container
   ```

7. Verify application is healthy
   ```bash
   curl https://api.example.com/health/ready
   ```

### Migrations

#### Check Migration Status

```bash
npx prisma migrate status --schema prisma/schema.prisma
```

Expected output:
```
Current database revision: 20260809120000_initial_schema
All migrations have been applied.
```

If migrations are pending, this indicates:
- New migrations have been created but not deployed
- Application is running older code than database schema

#### Apply Migrations

```bash
# In production, ALWAYS use 'migrate deploy' (not 'migrate dev')
npx prisma migrate deploy --schema prisma/schema.prisma
```

If migration fails:
1. Review error message
2. Check database permissions
3. Check disk space
4. Manual intervention may be required

#### Creating Migrations

**DO NOT create migrations in production.** Instead:

1. Create migration in development
   ```bash
   npx prisma migrate dev --name descriptive_name --schema prisma/schema.prisma
   ```

2. Review generated SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`

3. Test migration thoroughly

4. Commit migration to version control

5. Deploy via CI/CD pipeline

### Database Maintenance

#### Vacuum

```bash
# Full vacuum (blocks writes)
vacuumdb -h localhost -U queue_user queue_management

# Analyze (updates statistics)
analyzedb -h localhost -U queue_user queue_management

# Auto-vacuum status
psql -c "SELECT datname, last_autovacuum, last_autoanalyze FROM pg_stat_user_tables ORDER BY datname;"
```

#### Reindex

```bash
# Reindex all indexes in database
reindexdb -h localhost -U queue_user queue_management

# Reindex specific table
reindexdb -h localhost -U queue_user -t table_name queue_management
```

#### Statistics

```bash
# Check table sizes
psql -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
         FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"

# Check index sizes
psql -c "SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid))
         FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY pg_relation_size(indexrelid) DESC;"

# Check database size
psql -c "SELECT pg_size_pretty(pg_database_size('queue_management'));"
```

## Application Updates

### Zero-Downtime Updates

For stateless applications (recommended):

1. Build new image
2. Run smoke tests against new image
3. Start new instances with new image
4. Route new traffic to new instances
5. Wait for in-flight requests to complete
6. Stop old instances

### Rolling Update with Load Balancer

```bash
# Example: Update 2 instances with 0 downtime

# 1. Bring up new instance
docker run -d --name api-2 ... api:new-version

# 2. Verify new instance is healthy
curl http://localhost:4000/health/ready

# 3. Add new instance to load balancer
# (Load balancer specific)

# 4. Wait for connections to drain from old instance
# (typically 30-60 seconds)

# 5. Remove old instance from load balancer
# (Load balancer specific)

# 6. Stop old instance
docker stop api-1
```

### Coordinating Web & API Updates

If both web and API are changing:

1. Deploy API first
2. Verify API health
3. Deploy web second (web can communicate with new API)
4. Verify web can connect to API

## Incident Response

### Application Crash

1. Check application logs
   ```bash
   docker logs api-container | tail -100
   ```

2. Verify database connectivity
   ```bash
   curl https://api.example.com/health/ready
   ```

3. Restart application (if transient error)
   ```bash
   docker restart api-container
   ```

4. If crash persists, rollback to previous version

### High Error Rate

1. Check application logs for patterns
   ```bash
   docker logs api-container 2>&1 | grep '"level":4[0-9]' | tail -20
   ```

2. Check database
   ```bash
   curl https://api.example.com/health/ready
   ```

3. Check Redis
   ```bash
   redis-cli PING
   ```

4. If external service is down, may need to implement fallback or circuit breaker

5. If application bug, rollback and deploy fix

### High Latency

1. Check database query performance
   ```bash
   psql -c "SELECT query, calls, total_time, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"
   ```

2. Check Redis performance
   ```bash
   redis-cli LATENCY LATEST
   ```

3. Check application CPU/memory
   ```bash
   docker stats
   ```

4. Scale up if resource constrained

5. Optimize slow queries if database is bottleneck

## Security Maintenance

### Secret Rotation

When rotating secrets, follow this procedure to avoid downtime:

1. Generate new secret
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Update environment variable in deployment system

3. For JWT secrets, old tokens remain valid until expiration
   - Access tokens: Valid for configured duration
   - Refresh tokens: Valid until rotation (application should handle gracefully)

4. Monitor logs for authentication failures

5. No application restart required for JWT secret rotation

### Dependency Updates

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Run tests after update
npm run test

# Review changes
git diff package-lock.json

# Commit and deploy via CI/CD
```

## Scheduled Maintenance

### Weekly

- [ ] Review error logs
- [ ] Check backup completion
- [ ] Verify monitoring is functioning
- [ ] Check disk space usage

### Monthly

- [ ] Vacuum and analyze database
- [ ] Reindex database
- [ ] Audit access logs
- [ ] Review and rotate secrets if needed
- [ ] Update dependencies if security patches available

### Quarterly

- [ ] Test backup restore procedure
- [ ] Review and update runbooks
- [ ] Capacity planning analysis
- [ ] Security audit

## Disaster Recovery

### Recovery Time Objective (RTO)

- **Target**: 2-4 hours to restore from backup
- **Depends on**: Backup size, recovery procedure, data volume

### Recovery Point Objective (RPO)

- **Target**: Last available backup (24 hours)
- **With WAL archiving**: Can recover to point-in-time

### Disaster Recovery Drill

**Monthly**: Simulate restore from backup

```bash
#!/bin/bash
# 1. Create temp database
psql -U postgres -c "CREATE DATABASE test_restore OWNER queue_user;"

# 2. Restore backup
pg_restore -U queue_user -d test_restore backup_20260809_120000.dump

# 3. Verify data integrity
psql -U queue_user -d test_restore -c "SELECT COUNT(*) FROM organization;"

# 4. Drop test database
psql -U postgres -c "DROP DATABASE test_restore;"

echo "✓ Disaster recovery drill completed successfully"
```

If restore fails, immediately investigate and update procedures.

## Logs & Troubleshooting

### View Application Logs

```bash
# Last 100 lines
docker logs api-container | tail -100

# Follow logs in real-time
docker logs -f api-container

# Filter for errors
docker logs api-container 2>&1 | grep '"level":4[0-9]'

# Pretty print JSON logs
docker logs api-container 2>&1 | jq -r '.msg // .'
```

### View Database Logs

```bash
# PostgreSQL log file
tail -f /var/log/postgresql/postgresql.log

# Or via Docker
docker exec postgres-container tail -f /var/log/postgresql/postgresql.log

# Query slow log
psql -c "SELECT query, calls, total_time, mean_time FROM pg_stat_statements WHERE mean_time > 100 ORDER BY mean_time DESC LIMIT 10;"
```

### View Redis Logs

```bash
# Redis log from config
redis-cli CONFIG GET logfile

# Or via Docker
docker logs redis-container

# Check for errors
docker logs redis-container 2>&1 | grep -i error
```

## Contacts & Escalation

Maintain a runbook with:

- [ ] DBA contact information
- [ ] Infrastructure team contact
- [ ] Security team contact
- [ ] On-call rotation
- [ ] Escalation procedures

## References

- `DEPLOYMENT.md` - Deployment procedure
- `PRODUCTION_CHECKLIST.md` - Pre-deployment checklist
- `SECURITY.md` - Security architecture
