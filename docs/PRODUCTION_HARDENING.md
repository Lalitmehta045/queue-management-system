# Production Hardening

This document outlines the production hardening, reliability, and observability measures implemented for the Queue Management System.

## Health Endpoints
- `GET /health/live`: Verifies that the Node.js process is active and running.
- `GET /health/ready`: Checks if external dependencies, particularly the PostgreSQL database, are accessible. This ensures that the application only accepts traffic when it can fully serve it.

## Graceful Shutdown
The application listens for shutdown signals (SIGINT, SIGTERM) and initiates a graceful shutdown process:
1. Stops accepting new HTTP connections.
2. Gracefully disconnects the Prisma database connection to avoid corrupting ongoing transactions.
3. Cleans up long-lived connections such as SSE subscriptions safely.

## Request IDs & Logging
- **Request IDs**: Every API request is assigned a unique `x-request-id` header (either generated using crypto.randomUUID() or securely adopted if passed by a trusted client proxy). This ID is returned in API responses and structured error responses.
- **Structured Logging**: Using `nestjs-pino` and `pino-http`, application logs are emitted as structured JSON, easily ingestible by logging backends (e.g., Datadog, ELK).
- **Redaction**: Passwords, JWT tokens, OTPs, and API credentials are automatically redacted from all production logs.

## Security & Headers
- **Helmet**: Integration of Helmet middleware applies secure HTTP headers (e.g., preventing MIME-type sniffing, cross-site scripting, and enforcing X-Frame-Options).
- **Error Handling**: The global exception filter has been hardened to prevent leaking stack traces, Prisma connection strings, or database schemas in production. Internal unhandled errors return generic responses while logging the full exception internally.

## Rate Limiting & Throttling
- In-memory rate limiting has been integrated using `@nestjs/throttler`.
- **Limitation**: The current implementation is process-local and will not accurately track rates across multiple horizontally scaled application instances.
- **Future Scaling**: To enforce rate limiting across a cluster, a Redis-backed throttler adapter should be integrated in the future.
- Stricter limits are applied to sensitive endpoints (e.g., `/auth/login`, token generation, and SSE endpoints).

## SSE Connections
- Bounded lifecycle: SSE connections are forcefully disconnected after 12 hours to prevent stale long-lived proxy connections.
- Heartbeats: `KEEPALIVE` events are pushed every 25 seconds to prevent load balancers from closing active connections prematurely.
- Rate limiting: Client subscriptions per `publicId` are restricted.
- **Limitation**: SSE pub/sub is strictly process-local. Horizontally scaling the API nodes will require a Redis PubSub adapter so events on Node A can be streamed to clients on Node B.

## Database Resilience
- `PrismaService` explicitly logs connection establishment and handles disconnect gracefully during application shutdown.
- Idempotency mechanisms natively implemented for Tokens and Queue Entries have been maintained and tested under heavy concurrent load to prevent race conditions.
