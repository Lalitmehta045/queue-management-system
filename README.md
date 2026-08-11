# Smart Queue Management System

Production foundation for a multi-tenant Queue Management SaaS for hospitals, clinics, diagnostic centers, banks, government offices, and service centers.

Phase 0 establishes the monorepo, frontend, backend, database foundation, local infrastructure, CI, and architecture documentation. It intentionally does not implement queue workflows, TV display, printer bridge, analytics, billing, or enterprise features.

## Architecture

- `apps/web`: Next.js, TypeScript, Tailwind CSS
- `apps/api`: NestJS, TypeScript, global validation, health endpoint
- `packages/shared`: shared TypeScript contracts for stable cross-app types
- `prisma`: PostgreSQL schema and migrations
- `docs`: architecture, queue engine, printer, and security standards

The future Queue Engine must live in backend domain/application services and remain independent from HTTP controllers, WebSocket gateways, printer integrations, and React components.

## Prerequisites

- Node.js 20.19 LTS, 22.13 LTS, or a newer supported stable line
- npm 10 or newer
- Docker Desktop

## Installation

```bash
npm install
```

## Environment Setup

Copy `.env.example` to `.env` for local development and replace JWT secrets with local-only random values.

Required variables:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_ACCESS_SECRET`: access token signing secret
- `JWT_REFRESH_SECRET`: refresh token signing secret
- `CORS_ORIGIN`: allowed frontend origin, comma-separated when needed
- `NODE_ENV`: runtime environment
- `PORT`: API port

Secrets must never be committed.

## Local Infrastructure

Start PostgreSQL and Redis:

```bash
docker compose up -d
```

Stop services:

```bash
docker compose down
```

Reset local infrastructure data:

```bash
docker compose down -v
docker compose up -d
```

## Database

Validate Prisma schema:

```bash
npm run prisma:validate
```

Generate Prisma client:

```bash
npm run prisma:generate
```

Run migrations:

```bash
npm run prisma:migrate
```

## Development

Run all apps:

```bash
npm run dev
```

Run only the frontend:

```bash
npm run dev:web
```

Run only the API:

```bash
npm run dev:api
```

Frontend defaults to `http://localhost:3000`.
API defaults to `http://localhost:4000`.

Health endpoint:

```bash
curl http://localhost:4000/health
```

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Deployment Direction

- Frontend: Vercel
- Backend: Render initially
- Database: managed PostgreSQL
- Redis: managed Redis-compatible service

Production deployments must provide strong secrets and restricted CORS origins.
