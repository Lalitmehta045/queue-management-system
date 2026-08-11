# Authentication Architecture

## Overview
Phase 1 establishes a robust authentication and authorization foundation for the multi-tenant SaaS. It focuses on secure token management, proper refresh mechanisms, and strict tenant isolation.

## Access Token
- **Format:** JWT
- **Lifespan:** Short-lived (15 minutes).
- **Storage:** Secure, HttpOnly, SameSite=lax cookie.
- **Claims:** Minimum necessary (`sub` as userId, `sessionId` for revocation checking).

## Refresh Session
- **Mechanism:** Opaque, cryptographically secure random token (32 bytes).
- **Storage:** Only the SHA-256 hash of the refresh token is stored in the database.
- **Lifespan:** Long-lived (7 days).
- **Storage Strategy:** Sent to the client as an HttpOnly, path-restricted (`/api/auth/refresh`) cookie.

## Token Rotation & Reuse Detection
When a refresh token is used:
1. The backend hashes the presented token and looks up the active `RefreshSession`.
2. If found and not revoked, the session is marked as revoked.
3. A completely new `RefreshSession` and new access/refresh tokens are generated.
4. If a refresh token is presented but its corresponding session is *already* revoked, this indicates token theft and reuse. In this case, ALL active sessions for the user are immediately revoked, requiring re-authentication.

## Tenant Authorization
The system strictly resolves tenant context server-side.
- The `TenantGuard` reads the `x-organization-id` header.
- It queries the database to ensure the authenticated user has an `ACTIVE` membership in the specified organization.
- If verified, `req.tenant` is populated with `organizationId`, `membershipId`, and `role`.
- Subsequent guards (like `RolesGuard`) verify the specific RBAC rules using this trusted `req.tenant` context.
