# Multi-stage build for production NestJS API
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig.json ./
COPY .npmrc* ./

# Copy workspace packages
COPY apps/api/package*.json ./apps/api/
COPY apps/api/tsconfig*.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY packages/shared/package*.json ./packages/shared/
COPY packages/shared/tsconfig*.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src

# Copy Prisma schema and migrations
COPY prisma ./prisma

# Install dependencies and build
RUN npm ci && npm run build -w apps/api

# Production image
FROM node:20-alpine

WORKDIR /app

# Add non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy root package files
COPY package*.json ./
COPY .npmrc* ./

# Copy workspace packages (production only)
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/

# Copy Prisma client and schema
COPY prisma ./prisma
COPY node_modules/.prisma ./node_modules/.prisma 2>/dev/null || true

# Install production dependencies only
RUN npm ci --omit=dev && npm run prisma:generate

# Copy built application from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Change ownership to nodejs user
RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health/live', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start production server
CMD ["node", "apps/api/dist/main.js"]
