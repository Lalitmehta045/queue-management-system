# Production Deployment Guide

## Overview

This document describes the production deployment process for the Queue Management System. The deployment architecture supports:

- Multi-tenant SaaS deployment
- PostgreSQL database with Prisma ORM
- Redis for caching and messaging
- NestJS API server
- Next.js web application
- Stateless, horizontally scalable architecture
- Health checks and readiness probes
- Graceful shutdown handling
- Structured JSON logging
- Request correlation and tracing

## Architecture

### Components

```
┌─────────────────┐
│  Load Balancer  │
│   (Optional)    │
└────────┬────────┘
         │
    ┌────┴────┐
    │          │
┌───┴──┐  ┌───┴──┐
│ Web  │  │ API  │  (Stateless, horizontally scalable)
│ :3000│  │:4000 │
└───┬──┘  └───┬──┘
    │         │
    └────┬────┘
         │
    ┌────┴─────────┐
    │              │
┌───┴──┐    ┌─────┴──┐
│  DB  │    │ Redis  │
│ :5432│    │ :6379  │
└──────┘    └────────┘
```

### Database

- **PostgreSQL 16+** with SSL support
- **Schema**: `public` (or specified in `DATABASE_URL`)
- **Migrations**: Managed by Prisma, applied via `prisma migrate deploy`
- **Connection pooling**: Recommended via PgBouncer or similar for multiple application instances
- **Backups**: Operator responsibility (see OPERATIONS.md)

### Redis

- **Redis 7+** (or compatible)
- **Purpose**: Caching, future message queues
- **Persistence**: Optional (AppendOnly mode not required for cache-only usage)
- **Connection pooling**: Built into application via ioredis

### API Server (NestJS)

- **Port**: 4000 (configurable via `PORT`)
- **Process**: Single Node.js process per container/instance
- **Scaling**: Horizontal scaling through load balancer
- **Health endpoints**:
  - `GET /health` → Live status
  - `GET /health/live` → Readiness
  - `GET /health/ready` → Database connectivity

### Web Application (Next.js)

- **Port**: 3000 (configurable)
- **Build**: Static and dynamic routes
- **Rewrites**: `/api/*` routes proxy to API server
- **Environment variables**: Injected at build time
- **Scaling**: Horizontal scaling behind load balancer

## Pre-Deployment Checklist

Before deploying to production:

### Environment Configuration

- [ ] `NODE_ENV=production` is set
- [ ] `DATABASE_URL` is configured for production database
- [ ] `REDIS_URL` is configured for production Redis
- [ ] `JWT_ACCESS_SECRET` is a unique, 32+ character secret
- [ ] `JWT_REFRESH_SECRET` is a unique, 32+ character secret
- [ ] `CORS_ORIGIN` matches production domain
- [ ] `API_URL` (for web app) is configured for production API
- [ ] `TOKEN_TIME_ZONE` is set to intended timezone
- [ ] `NOTIFICATION_PROVIDER` is configured appropriately
- [ ] `.env` file is NOT committed to version control

### Database

- [ ] PostgreSQL 16+ is running and accessible
- [ ] Database user has appropriate permissions
- [ ] PostgreSQL is configured with SSL if across network
- [ ] Backup strategy is documented and tested
- [ ] Database disk space is monitored

### Redis

- [ ] Redis 7+ is running and accessible
- [ ] Redis password is set (if exposed to network)
- [ ] Redis is configured for production use
- [ ] Memory limits are set appropriately

### Security

- [ ] HTTPS is enabled on reverse proxy
- [ ] CORS origins are restricted to production domain(s)
- [ ] JWT secrets are environment-specific
- [ ] Database credentials use strong passwords
- [ ] Application logs do not expose secrets

### Infrastructure

- [ ] Reverse proxy (nginx, HAProxy, etc.) is configured
- [ ] HTTPS certificates are valid and auto-renewal is configured
- [ ] WebSocket/SSE proxy settings allow long-lived connections
- [ ] Request timeouts are appropriate for SSE (30+ seconds)
- [ ] Compression is disabled or safe for SSE responses

### Monitoring

- [ ] Application logs are collected and monitored
- [ ] Health check endpoints are monitored
- [ ] Database connectivity is monitored
- [ ] Error rates are monitored

## Deployment Process

### 1. Build Application

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run build
npm audit
```

Verify all checks pass with exit code 0.

### 2. Verify Database

```bash
npx prisma migrate status
```

Review pending migrations. If this is a fresh deployment, there should be no pending migrations.

### 3. Container Build (if using Docker)

```bash
# API
docker build -f apps/api/Dockerfile -t api:latest .

# Web
docker build -f apps/web/Dockerfile -t web:latest .
```

Verify images build successfully and are a reasonable size:
- API image: ~200-300MB
- Web image: ~200-300MB

### 4. Database Migration (Production)

**IMPORTANT**: This step must complete successfully before deploying new application code.

```bash
# Option A: Direct connection
npm run prisma:deploy

# Option B: In a container before starting app
docker run --rm \
  -e DATABASE_URL="postgresql://..." \
  api:latest \
  npx prisma migrate deploy
```

**Verify migration status**:
```bash
npx prisma migrate status
```

Output should show all migrations as "applied" with no pending migrations.

If migration fails:
- [ ] Check database connectivity
- [ ] Review PostgreSQL logs
- [ ] Verify database disk space
- [ ] Verify user has necessary permissions
- [ ] Do NOT reset database or drop schemas
- [ ] Contact DBA if needed

### 5. Start Application

```bash
# Using Docker Compose (development/staging)
docker-compose up -d

# Using Docker (production)
docker run -d \
  -p 4000:4000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://..." \
  -e REDIS_URL="redis://..." \
  -e JWT_ACCESS_SECRET="..." \
  -e JWT_REFRESH_SECRET="..." \
  -e CORS_ORIGIN="https://app.example.com" \
  -e API_URL="https://app.example.com/api" \
  api:latest

docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e API_URL="https://api.example.com" \
  web:latest
```

### 6. Health Check Verification

```bash
# Check API health
curl -v https://api.example.com/health/live
curl -v https://api.example.com/health/ready

# Expected response (200 OK):
# {
#   "status": "ok",
#   "service": "queue-management-api",
#   "timestamp": "2026-08-09T...",
#   "uptimeSeconds": 10
# }
```

If `/health/ready` returns 503:
- [ ] Verify database connectivity
- [ ] Check PostgreSQL logs
- [ ] Verify `DATABASE_URL` is correct
- [ ] Verify network connectivity between app and database

### 7. Smoke Test

Run smoke tests against production deployment (see smoke-tests.sh):

```bash
./scripts/smoke-tests.sh https://app.example.com
```

Expected output:
```
✓ GET /health/live
✓ GET /health/ready
✓ POST /auth/register
✓ POST /auth/login
✓ GET /organizations (requires auth)
...
```

If any test fails:
- [ ] Review application logs
- [ ] Verify environment configuration
- [ ] Check database state
- [ ] Verify API is fully started
- [ ] Roll back if needed (see ROLLBACK_STRATEGY.md)

### 8. Enable Traffic

Once all health checks and smoke tests pass:

- [ ] Update load balancer to route traffic
- [ ] Monitor error rates and logs
- [ ] Monitor database performance
- [ ] Monitor Redis memory usage

## Rollback

If deployment fails at any stage:

### Database Migration Failed

**Do NOT reset database.** Instead:

1. Investigate error in PostgreSQL logs
2. Check disk space, permissions
3. Fix underlying issue
4. Re-run `npx prisma migrate deploy`
5. Application can remain on previous version during DB troubleshooting

### Application Startup Failed

1. Stop new application instances
2. Verify configuration (all env vars set)
3. Check application logs
4. Fix configuration or code issue
5. Restart application

### Application Crashed After Startup

1. Stop application
2. Revert to previous image/version
3. Start previous version
4. Investigate issue and redeploy

### Database Corruption or Data Loss

This should NOT happen with `prisma migrate deploy`. If it does:

1. Stop all application instances
2. Contact DBA
3. Restore from backup (procedure in OPERATIONS.md)
4. Re-run migrations
5. Verify data integrity
6. Resume deployment

## Production Limits

- **Maximum application instances**: Unlimited (stateless)
- **Maximum concurrent users**: Limited by PostgreSQL and Redis capacity
- **Request timeout**: 30 seconds (suitable for SSE with heartbeat)
- **JWT token size**: ~1KB per token
- **SSE connection lifetime**: 12 hours (controlled by client)
- **API rate limiting**: Configured per endpoint (see PRODUCTION_CHECKLIST.md)

## Known Limitations

### Single Database Server

Current deployment does not include:
- PostgreSQL replication or failover
- Database high availability
- Automatic failover

**Recommended**: Configure PostgreSQL backups and restore procedures. Consider managed PostgreSQL services (AWS RDS, Azure Database, etc.) for production.

### Single Redis Instance

Current deployment does not include:
- Redis clustering
- Redis persistence for queue durability
- Redis Sentinel for failover

**Recommendation**: For production, use managed Redis services or configure Redis Sentinel.

### Single Region

Current deployment is suitable for single-region deployment. Multi-region requires:
- Database replication
- Distributed session management
- CDN for static assets
- DNS failover

## Monitoring & Observability

### Application Logs

All logs are structured JSON written to stdout/stderr:

```json
{
  "level": 30,
  "time": "2026-08-09T...",
  "pid": 1234,
  "hostname": "api-pod-1",
  "req": {
    "id": "req-uuid",
    "method": "POST",
    "url": "/auth/login"
  },
  "res": {
    "statusCode": 200
  },
  "msg": "request completed"
}
```

**Collect logs to central system**: Use `docker logs`, Kubernetes log aggregation, or similar.

### Key Metrics to Monitor

- `requests.total` - Total request count
- `requests.errors` - Error rate
- `requests.duration_ms` - Response time
- `database.connections` - Active DB connections
- `database.query_duration_ms` - Query latency
- `redis.connections` - Active Redis connections
- `health.ready` - 1 if database accessible, 0 otherwise

### Health Endpoints

```bash
# Liveness probe (app is running)
GET /health/live
# Response: 200 OK

# Readiness probe (app can serve requests)
GET /health/ready
# Response: 200 OK if database connected, 503 SERVICE_UNAVAILABLE if not
```

## Security Considerations

See PRODUCTION_CHECKLIST.md for full security checklist.

### Database Security

- Use TLS/SSL for all database connections
- Restrict database access to application network
- Use strong, unique credentials
- Rotate credentials regularly
- Monitor database logs for unauthorized access

### API Security

- All endpoints validate JWT (except /health, /auth/register, /auth/login)
- CORS is restricted to configured origins
- Helmet security headers are enabled
- Rate limiting is configured per endpoint
- Request validation is strict

### Session Security

- JWT tokens are signed with environment-specific secrets
- Access tokens expire after configured duration
- Refresh tokens are used to obtain new access tokens
- Tokens are never logged or exposed in error messages

### Data Security

- All requests are logged with request ID for tracing
- Sensitive data (passwords, tokens) is never logged
- Audit logs record all mutations
- PII handling follows security guidelines

## Support & Escalation

### Application Issues

1. Check application logs for errors
2. Verify environment configuration
3. Check database and Redis connectivity
4. Review OPERATIONS.md for common issues
5. Contact application team

### Database Issues

1. Check PostgreSQL logs
2. Verify disk space
3. Monitor connection count
4. Contact DBA
5. Restore from backup if needed

### Infrastructure Issues

1. Check network connectivity
2. Verify SSL certificates
3. Review reverse proxy logs
4. Contact infrastructure team

## References

- `OPERATIONS.md` - Operational procedures
- `PRODUCTION_CHECKLIST.md` - Pre-deployment checklist
- `SECURITY.md` - Security architecture
- `ARCHITECTURE.md` - System architecture
