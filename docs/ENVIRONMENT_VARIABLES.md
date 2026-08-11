# Environment Variable Inventory

Complete inventory of all environment variables used by the Queue Management System.

## Overview

The system uses environment-based configuration for different deployment scenarios:
- **Development**: Local development with sensible defaults
- **Test**: CI/CD testing environment
- **Production**: Secure production deployment

## Runtime Environment

### NODE_ENV
- **Description**: Specifies the deployment environment
- **Type**: String (enum)
- **Valid Values**: `development`, `test`, `production`
- **Default**: `development`
- **Required**: Yes (enforced by validation)
- **Production Requirement**: Must be explicitly set to `production`
- **Security**: If not set to `production`, security defaults may be relaxed
- **Location**: App Module Config

## API Server Configuration

### PORT
- **Description**: TCP port for API server to listen on
- **Type**: Number
- **Valid Range**: 1-65535
- **Default**: `4000` (development)
- **Required**: Yes
- **Production Requirement**: May be overridden by container orchestration
- **Example**: `PORT=4000`
- **Security**: Should not be exposed directly to internet (use reverse proxy)
- **Location**: App Module Config

## Database Configuration

### DATABASE_URL
- **Description**: PostgreSQL connection string
- **Type**: String (Connection URL)
- **Format**: `postgresql://[user[:password]@][netloc][:port][/dbname][?param1=value1&...]`
- **Default**: `postgresql://queue_user:queue_password@localhost:5432/queue_management?schema=public` (development)
- **Required**: Yes
- **Production Requirement**: MUST point to production PostgreSQL
- **Example Production**: 
  ```
  DATABASE_URL=postgresql://prod_user:strong_password@prod-db.example.com:5432/queue_management?schema=public&sslmode=require
  ```
- **Security**:
  - MUST use strong credentials (20+ characters)
  - MUST use SSL/TLS for remote connections (`?sslmode=require`)
  - Should specify schema explicitly (`?schema=public`)
  - Should NOT be logged or exposed
  - MUST NOT be in version control
- **Performance**:
  - Connection string is parsed once at startup
  - Connection pooling is configured at application level
  - Max connections: Application pool size + reserve for backups
- **Location**: Prisma Config, Environment Validation
- **Generation Command**: 
  ```bash
  postgresql://[USER]:[PASS]@[HOST]:[PORT]/[DATABASE]?schema=public&sslmode=require
  ```

## Cache & Message Queue

### REDIS_URL
- **Description**: Redis connection string for caching and future message queues
- **Type**: String (Connection URL)
- **Format**: `redis://[:password@]host[:port][/db]`
- **Default**: `redis://localhost:6379` (development)
- **Required**: Yes
- **Production Requirement**: MUST point to production Redis
- **Example Production**:
  ```
  REDIS_URL=redis://:strong_password@prod-redis.example.com:6379/0
  ```
- **Security**:
  - Should use authentication if exposed to network
  - Should use TLS/SSL if remote
  - Should NOT be in version control
- **Performance**:
  - Single instance; no replication/clustering included
  - Connection pooling built into ioredis client
  - Recommended memory: 1-2GB for caching
- **Location**: Environment Validation
- **Note**: Current deployment uses Redis for caching only. Future phases may add message queue support.

## Authentication Configuration

### JWT_ACCESS_SECRET
- **Description**: Secret key for signing JWT access tokens
- **Type**: String (cryptographic secret)
- **Minimum Length**: 32 characters (production requirement)
- **Default**: `replace-with-a-long-random-access-secret` (development only)
- **Required**: Yes
- **Production Requirement**: 
  - MUST be 32+ characters
  - MUST be cryptographically random
  - MUST NOT contain "replace-with" or "development"
  - MUST be environment-specific
  - Different from JWT_REFRESH_SECRET
- **Generation Command**:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Security**:
  - MUST NOT be in version control
  - MUST NOT be logged or exposed
  - Rotation does NOT require restart (old tokens valid until expiry)
  - Should be rotated periodically (e.g., quarterly)
- **Token Properties**:
  - Access tokens expire after configured duration (not yet specified)
  - Used for API authentication
  - Embedded in request Authorization header
- **Location**: Environment Validation, Auth Module
- **Validation**: Must be 32+ characters in production

### JWT_REFRESH_SECRET
- **Description**: Secret key for signing JWT refresh tokens
- **Type**: String (cryptographic secret)
- **Minimum Length**: 32 characters (production requirement)
- **Default**: `replace-with-a-long-random-refresh-secret` (development only)
- **Required**: Yes
- **Production Requirement**:
  - MUST be 32+ characters
  - MUST be cryptographically random
  - MUST NOT contain "replace-with" or "development"
  - MUST be environment-specific
  - Different from JWT_ACCESS_SECRET
- **Generation Command**:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Security**:
  - MUST NOT be in version control
  - MUST NOT be logged or exposed
  - Rotation requires client re-authentication
  - Should be rotated periodically (e.g., quarterly)
- **Token Properties**:
  - Refresh tokens used to obtain new access tokens
  - Longer expiration than access tokens
  - Used only for /auth/refresh endpoint
- **Location**: Environment Validation, Auth Module
- **Validation**: Must be 32+ characters in production

## Cross-Origin Resource Sharing

### CORS_ORIGIN
- **Description**: Comma-separated list of allowed origins for CORS requests
- **Type**: String (CSV)
- **Default**: `http://localhost:3000` (development)
- **Required**: Yes
- **Production Requirement**: Restricted to production domain(s)
- **Examples**:
  - Single origin: `https://app.example.com`
  - Multiple origins: `https://app.example.com,https://admin.example.com`
  - With ports: `https://app.example.com:3000,https://api.example.com:4000`
- **Security**:
  - MUST use HTTPS in production
  - MUST NOT use wildcard `*` in production
  - MUST NOT include `http://` in production
  - Credentials flag is enabled (secure cookies supported)
  - Only specified origins can make cross-origin requests
- **Parser**: Splits on `,` and trims whitespace
- **Location**: Environment Validation, App Module Config
- **Note**: If client and API are on same origin, CORS is not needed

## Timezone Configuration

### TOKEN_TIME_ZONE
- **Description**: IANA timezone for token time calculations and scheduling
- **Type**: String (IANA timezone identifier)
- **Default**: `Asia/Kolkata` (development)
- **Required**: Yes
- **Production Requirement**: MUST match operational timezone
- **Valid Values**: Standard IANA timezone identifiers
- **Examples**:
  - `Asia/Kolkata` (India Standard Time, UTC+5:30)
  - `America/New_York` (Eastern Time)
  - `Europe/London` (Greenwich Mean Time)
  - `UTC` (Coordinated Universal Time)
  - `Australia/Sydney`
- **Usage**: 
  - Token expiration calculations
  - Scheduled appointments
  - Report date ranges
  - User-facing time displays
- **Security**: No security implications
- **Location**: Environment Validation, Token Module
- **Note**: All internal timestamps stored in UTC; this controls display/calculation timezone
- **Validation**: Must be valid IANA timezone

## Notifications Configuration

### NOTIFICATION_PROVIDER
- **Description**: Provider for sending notifications (SMS, email, etc.)
- **Type**: String (enum)
- **Valid Values**: `noop`, `mock` (real providers added in future phases)
- **Default**: `noop` (development)
- **Required**: Yes
- **Production Requirement**: Must be explicitly set
- **Options**:
  - `noop`: No-operation provider, does nothing (safe for development)
  - `mock`: Mock provider for testing, logs but doesn't send
  - (Future) Real providers (Twilio, SendGrid, etc.)
- **Security**: 
  - Provider credentials would NOT be environment variables (see below)
  - Notification failures never block queue operations
  - Notification history is audit-logged
- **Location**: Environment Validation, Notifications Module
- **Note**: Real provider credentials (API keys, etc.) would be injected separately per provider

## Web Application Configuration

### API_URL
- **Description**: URL for API server accessible from Next.js web app
- **Type**: String (URL)
- **Default**: `http://localhost:4000` (development)
- **Required**: No (falls back to default if not set)
- **Production Requirement**: MUST point to production API
- **Examples**:
  - Development: `http://localhost:4000`
  - Staging: `https://api-staging.example.com`
  - Production: `https://api.example.com`
- **Usage**: 
  - Next.js rewrites `/api/*` requests to this URL
  - Must be accessible from browser AND server
  - Used during server-side rendering
- **Security**:
  - MUST use HTTPS in production
  - Should match reverse proxy routing
  - Must be accessible from browser (public URL)
- **Location**: next.config.ts (rewrites configuration)
- **Build-Time Injection**: Set during web app build
- **Note**: Changes require web app rebuild

## Optional / Future Configuration

### Notification Provider Credentials

**Not Currently Used** - Placeholder for future phases

When real notification providers are added, credentials would be configured via:
- Separate environment variables (e.g., `SMS_PROVIDER_API_KEY`)
- Or external secret management (AWS Secrets Manager, HashiCorp Vault, etc.)

### Future Service Integration

**Not Currently Used** - Placeholder for future services:
- Analytics platform credentials
- External API keys
- Cloud service credentials
- Payment provider keys
- etc.

## Environment-Specific Defaults

### Development

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://queue_user:queue_password@localhost:5432/queue_management?schema=public
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=development-only-access-secret-change-before-production
JWT_REFRESH_SECRET=development-only-refresh-secret-change-before-production
CORS_ORIGIN=http://localhost:3000
TOKEN_TIME_ZONE=Asia/Kolkata
NOTIFICATION_PROVIDER=noop
API_URL=http://localhost:4000
```

### Test (CI/CD)

```env
NODE_ENV=test
PORT=4000
DATABASE_URL=postgresql://queue_user:queue_password@localhost:5432/queue_management?schema=public
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=test-access-secret-min-32-chars-xxxxxxxxxxxxxxxx
JWT_REFRESH_SECRET=test-refresh-secret-min-32-chars-xxxxxxxxxxxxxxxx
CORS_ORIGIN=http://localhost:3000
TOKEN_TIME_ZONE=Asia/Kolkata
NOTIFICATION_PROVIDER=mock
API_URL=http://localhost:4000
```

### Production

```env
NODE_ENV=production
PORT=4000  # May be overridden by container orchestration
DATABASE_URL=postgresql://prod_user:STRONG_PASSWORD@prod-db.example.com:5432/queue_management?schema=public&sslmode=require
REDIS_URL=redis://:STRONG_PASSWORD@prod-redis.example.com:6379/0
JWT_ACCESS_SECRET=<random-32-char-hex-string>
JWT_REFRESH_SECRET=<random-32-char-hex-string>
CORS_ORIGIN=https://app.example.com
TOKEN_TIME_ZONE=Asia/Kolkata
NOTIFICATION_PROVIDER=<configured-provider>
API_URL=https://api.example.com
```

## Configuration Validation

### Validation Rules

All configuration is validated at application startup by `env.validation.ts`:

1. **NODE_ENV**: Must be development, test, or production
2. **PORT**: Must be valid TCP port (1-65535)
3. **DATABASE_URL**: Must be non-empty string
4. **REDIS_URL**: Must be non-empty string
5. **JWT_ACCESS_SECRET**: 
   - Must be non-empty
   - Must be 32+ characters in production
   - Must not contain "replace-with" or "development" in production
6. **JWT_REFRESH_SECRET**: 
   - Must be non-empty
   - Must be 32+ characters in production
   - Must not contain "replace-with" or "development" in production
7. **CORS_ORIGIN**: Must be non-empty
8. **TOKEN_TIME_ZONE**: Must be non-empty
9. **NOTIFICATION_PROVIDER**: Must be "noop" or "mock"

### Validation Failure

If validation fails during startup, application will NOT start and will exit with error code 1.

**Example error**:
```
Error: JWT_ACCESS_SECRET must be at least 32 characters in production
```

## Secrets Management

### Development

Development secrets can be stored in `.env` file (gitignored):

```bash
# .env file - DO NOT COMMIT
NODE_ENV=development
JWT_ACCESS_SECRET=development-only-secret
DATABASE_URL=postgresql://dev_user:dev_password@localhost:5432/queue_management
```

### Production

Production secrets must NOT be in `.env` or source control. Instead:

1. **Docker/Container**:
   ```bash
   docker run -e NODE_ENV=production \
              -e DATABASE_URL="postgresql://..." \
              -e JWT_ACCESS_SECRET="..." \
              api:latest
   ```

2. **Kubernetes**:
   ```yaml
   env:
     - name: NODE_ENV
       value: production
     - name: DATABASE_URL
       valueFrom:
         secretKeyRef:
           name: app-secrets
           key: database_url
   ```

3. **AWS Lambda/ECS**:
   - Use AWS Secrets Manager
   - Use IAM role to access secrets

4. **Heroku/Cloud Platforms**:
   - Use platform secret management
   - Set via CLI or web dashboard

## Audit & Compliance

### Secrets Audit

**Verify no secrets are in version control**:

```bash
# Check for common secret patterns
git log -p -S "password" -- . | head -50
git log -p -S "secret" -- . | head -50
git log -p -S "key" -- . | head -50

# Check .env files
git ls-files | grep ".env" | grep -v ".env.example"

# Use git-secrets tool
git secrets --scan
```

### Documentation

- `.env.example` contains all variables with examples
- `.env.example` DOES NOT contain real secrets
- All variables are documented in this file
- Documentation is kept in sync with code

## References

- `env.validation.ts` - Validation logic
- `app.module.ts` - Configuration import
- `.env.example` - Example configuration
- `PRODUCTION_CHECKLIST.md` - Production requirements
- `DEPLOYMENT.md` - Deployment process
