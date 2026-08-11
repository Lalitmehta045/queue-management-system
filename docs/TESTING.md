# Testing Strategy

## Phase 0 Tests

The backend has Jest coverage for:

- Nest application bootstrap
- `GET /health`
- environment validation

These tests must assert real behavior and must not use placeholder assertions such as `expect(true).toBe(true)`.

## Future Mandatory Tests

Queue and tenant features must add tests for:

- concurrent token generation
- cross-tenant access denial
- branch scope denial
- invalid queue transition rejection
- valid queue transition event creation
- idempotent token creation
- unauthorized printer job access
- unauthorized WebSocket room join
- websocket reconnect snapshot behavior

## CI

CI must run:

- dependency installation
- lint
- typecheck
- tests
- build
