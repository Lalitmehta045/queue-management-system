# Production Checklist

Complete this checklist before deploying to production.

## Environment Configuration

- [ ] `NODE_ENV=production` is set explicitly
- [ ] `DATABASE_URL` points to production PostgreSQL
- [ ] `REDIS_URL` points to production Redis
- [ ] `PORT` is configured for application
- [ ] `CORS_ORIGIN` is restricted to production domain(s)
- [ ] `API_URL` (web app) points to production API
- [ ] `TOKEN_TIME_ZONE` is set to intended timezone
- [ ] `NOTIFICATION_PROVIDER` is configured appropriately
- [ ] `.env` file is NOT committed to version control
- [ ] `.env.example` contains only placeholders, no real values
- [ ] No hardcoded credentials in source code
- [ ] No hardcoded URLs that reference development/staging

## Authentication & Authorization

### JWT Secrets

- [ ] `JWT_ACCESS_SECRET` is at least 32 characters
- [ ] `JWT_ACCESS_SECRET` is cryptographically random
- [ ] `JWT_ACCESS_SECRET` is environment-specific (not shared across environments)
- [ ] `JWT_ACCESS_SECRET` does not contain "replace-with" or "development"
- [ ] `JWT_REFRESH_SECRET` is at least 32 characters
- [ ] `JWT_REFRESH_SECRET` is cryptographically random
- [ ] `JWT_REFRESH_SECRET` is environment-specific
- [ ] `JWT_REFRESH_SECRET` does not contain "replace-with" or "development"
- [ ] JWT secrets are stored securely (not in git, environment vars or secure store)

### CORS

- [ ] CORS is restricted to production domain(s)
- [ ] CORS includes all necessary production domains (web app, analytics, etc.)
- [ ] CORS does not include `*` (wildcard)
- [ ] CORS does not include `http://` URIs (only `https://`)
- [ ] Credentials flag is enabled (secure cookies possible)

### Password Policy

- [ ] Initial password reset is enforced on first login
- [ ] Password requirements are documented
- [ ] Passwords are hashed with bcrypt (cost factor ≥ 10)
- [ ] Passwords are never logged or exposed in error messages

## Database Security

### Connection

- [ ] PostgreSQL uses TLS/SSL for all connections
- [ ] `DATABASE_URL` includes `?sslmode=require` for remote connections
- [ ] Database user has minimal necessary permissions
- [ ] Database user is NOT the superuser
- [ ] Database password is strong (20+ random characters)
- [ ] Database password is unique to each environment
- [ ] Database password is NOT in version control

### Backup & Restore

- [ ] Backup procedure is documented and tested
- [ ] Backups are encrypted at rest
- [ ] Backups are stored off-site
- [ ] Backup retention policy is defined (recommended: 30 days)
- [ ] Restore procedure is documented and tested
- [ ] Restore test is performed monthly
- [ ] Point-in-time recovery is considered (if using WAL archiving)

### Access Control

- [ ] Database access is restricted by network (firewall)
- [ ] Database access is not open to the internet
- [ ] Application server can reach database
- [ ] Only authorized users can connect to database
- [ ] Database user permissions follow principle of least privilege

## API Security

### HTTPS

- [ ] HTTPS is enforced (not optional)
- [ ] HTTP requests are redirected to HTTPS
- [ ] SSL/TLS certificates are valid
- [ ] SSL/TLS certificates are not self-signed
- [ ] SSL/TLS certificates include all necessary SANs
- [ ] SSL/TLS version is TLS 1.2 or higher
- [ ] Certificate renewal is automated

### Security Headers

- [ ] Helmet middleware is enabled and configured
- [ ] `Content-Security-Policy` headers are set
- [ ] `X-Frame-Options` is set (recommended: `DENY` or `SAMEORIGIN`)
- [ ] `X-Content-Type-Options` is set to `nosniff`
- [ ] `Strict-Transport-Security` is set (HSTS header)
- [ ] HSTS includes `includeSubDomains` directive
- [ ] HSTS max-age is at least 1 year (31536000 seconds)
- [ ] `X-XSS-Protection` is configured

### Request Validation

- [ ] Input validation is strict (whitelist, not blacklist)
- [ ] Query parameters are validated
- [ ] Request bodies are validated with schemas
- [ ] File uploads are validated by type and size
- [ ] File uploads are scanned for malware (if applicable)
- [ ] No unsafe deserialization

### Rate Limiting

- [ ] Rate limiting is configured on login endpoint (5-10 attempts/minute)
- [ ] Rate limiting is configured on password reset (3-5 attempts/hour)
- [ ] Rate limiting is configured on registration (1 per 5 minutes from IP)
- [ ] Rate limiting is configured on API endpoints (appropriate for endpoint)
- [ ] Rate limiting includes exponential backoff
- [ ] Rate limiting errors return 429 Too Many Requests

### Error Handling

- [ ] Errors do not expose internal details (stack traces, SQL, config)
- [ ] Error responses are generic and user-friendly
- [ ] Database errors do not reveal schema
- [ ] File not found errors use consistent messaging
- [ ] Audit logging captures all errors

## Logging & Monitoring

### Application Logs

- [ ] All logs are structured JSON
- [ ] Logs include request ID for tracing
- [ ] Logs include timestamp
- [ ] Logs include service name
- [ ] Logs include log level (DEBUG, INFO, WARN, ERROR, FATAL)
- [ ] Logs do NOT include passwords, tokens, or PII
- [ ] Logs are sent to stdout/stderr (not files)
- [ ] Log aggregation is configured
- [ ] Log retention policy is defined

### Audit Logs

- [ ] All mutations are recorded in audit logs
- [ ] Audit logs include user ID
- [ ] Audit logs include action (CREATE, UPDATE, DELETE)
- [ ] Audit logs include resource type and ID
- [ ] Audit logs include timestamp
- [ ] Audit logs include IP address
- [ ] Audit logs include request ID
- [ ] Audit logs cannot be modified or deleted
- [ ] Audit log retention policy is defined

### Monitoring

- [ ] Error rate is monitored
- [ ] Response time is monitored
- [ ] Database connection count is monitored
- [ ] Redis memory is monitored
- [ ] Disk space is monitored
- [ ] Health check endpoints are monitored
- [ ] Failed authentication attempts are monitored
- [ ] Alerts are configured for anomalies

## Data Protection

### Sensitive Data

- [ ] PII is identified and documented
- [ ] PII handling follows regulatory requirements
- [ ] PII is encrypted at rest (if sensitive)
- [ ] PII is encrypted in transit (HTTPS)
- [ ] PII is not logged or exposed in error messages
- [ ] PII access is audit-logged
- [ ] Deletion/retention policy is documented

### Encryption

- [ ] All data in transit is encrypted (HTTPS)
- [ ] Sensitive data at rest is encrypted (if required)
- [ ] Encryption keys are environment-specific
- [ ] Encryption key rotation procedure is documented
- [ ] Encryption keys are NOT in version control

## Infrastructure

### Network

- [ ] Reverse proxy (nginx, HAProxy, etc.) is configured
- [ ] WebSocket/SSE support is configured
- [ ] Connection timeouts are appropriate (30+ seconds for SSE)
- [ ] Request body size limits are reasonable
- [ ] IP whitelisting is configured if needed (e.g., for backups)

### Resource Limits

- [ ] Application memory limit is set
- [ ] Application CPU limit is set (if containerized)
- [ ] Database connection pool size is configured
- [ ] Redis memory limit is set
- [ ] Request timeout is set (30 seconds minimum for SSE)

### Process Management

- [ ] Application respects SIGTERM gracefully
- [ ] Application completes in-flight requests before shutdown
- [ ] Database connections are closed before shutdown
- [ ] Redis connections are closed before shutdown
- [ ] Shutdown timeout is configured (minimum 30 seconds)

## Deployment

### Build Process

- [ ] Build is deterministic (same code = same output)
- [ ] Dependencies are locked (package-lock.json)
- [ ] Build artifact is reproducible
- [ ] Build logs do NOT contain secrets
- [ ] Container images are scanned for vulnerabilities
- [ ] Unused development dependencies are removed

### Database Migrations

- [ ] Migrations are tested in development
- [ ] Migrations are version-controlled
- [ ] Migrations are backward-compatible (if possible)
- [ ] Migrations include rollback plan (documented, not automatic)
- [ ] `prisma migrate deploy` is used (never `migrate dev` in production)
- [ ] Migration failures are handled gracefully
- [ ] Database is not reset or dropped during migrations

### Deployment Procedure

- [ ] Deployment checklist is defined
- [ ] Database migrations run before application startup
- [ ] Health checks pass before traffic is routed
- [ ] Smoke tests pass before deployment is considered complete
- [ ] Rollback procedure is defined and tested
- [ ] Deployment is audited and logged

### Secrets Management

- [ ] Secrets are NOT in version control
- [ ] Secrets are NOT in environment files that are committed
- [ ] Secrets are injected at runtime
- [ ] Secrets are stored in secure store (environment variables, secret manager, etc.)
- [ ] Secrets are rotated regularly
- [ ] Secret rotation does NOT require application restart
- [ ] Secrets are not logged or exposed in error messages

## Security Testing

- [ ] Dependency audit passes (npm audit)
- [ ] No known vulnerabilities in dependencies
- [ ] Code is scanned for secrets (git-secrets, truffleHog, etc.)
- [ ] SQL injection is not possible (parameterized queries)
- [ ] XSS is not possible (input validation, output encoding)
- [ ] CSRF is not possible (CORS, SameSite cookies)
- [ ] Authentication bypass is not possible
- [ ] Authorization bypass is not possible
- [ ] Rate limiting cannot be bypassed

## Compliance & Documentation

- [ ] Architecture is documented
- [ ] Deployment procedure is documented
- [ ] Operations procedures are documented
- [ ] Rollback procedures are documented
- [ ] Security controls are documented
- [ ] Data protection policy is documented
- [ ] Incident response plan is documented
- [ ] Change log is maintained

## Pre-Deployment Verification

### Quality Gates

- [ ] `npm run lint` passes with 0 warnings
- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm run test` passes all tests
- [ ] `npm run build` succeeds
- [ ] `npm audit` shows 0 vulnerabilities (or approved exceptions)
- [ ] `npx prisma validate` passes
- [ ] `npx prisma migrate status` shows no pending migrations

### Code Review

- [ ] Code has been reviewed by at least one other developer
- [ ] All review comments have been addressed
- [ ] No obvious security issues
- [ ] No hardcoded credentials or secrets
- [ ] No commented-out debug code

### Health Checks

- [ ] API starts successfully
- [ ] `GET /health/live` responds with 200 OK
- [ ] `GET /health/ready` responds with 200 OK (database connected)
- [ ] Web app builds successfully
- [ ] Web app can reach API
- [ ] Reverse proxy (if used) forwards requests correctly
- [ ] SSL/TLS certificate is valid

### Smoke Tests

- [ ] Authentication endpoints work (`/auth/register`, `/auth/login`)
- [ ] Organization endpoints respond with 401 without token
- [ ] Organization endpoints work with valid token
- [ ] Database can be queried (organizations exist)
- [ ] Redis is accessible
- [ ] All critical workflows are tested

## Sign-Off

- [ ] Product owner has approved deployment
- [ ] Security team has approved deployment
- [ ] Infrastructure team has reviewed deployment
- [ ] DBA has reviewed database changes
- [ ] Deployment has been scheduled
- [ ] On-call support is notified
- [ ] Rollback plan has been communicated

---

**Deployment Date**: _______________

**Deployed By**: _______________

**Approved By**: _______________

**Status**: ☐ APPROVED ☐ REJECTED

**Notes**: ________________________________________________________________

