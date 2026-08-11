# Multi-stage build for production Next.js web app
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY tsconfig.json ./
COPY .npmrc* ./

# Copy workspace packages
COPY apps/web/package*.json ./apps/web/
COPY apps/web/tsconfig*.json ./apps/web/
COPY apps/web/next.config.ts ./apps/web/
COPY apps/web/postcss.config.js ./apps/web/
COPY apps/web/tailwind.config.ts ./apps/web/
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public 2>/dev/null || true
COPY packages/shared/package*.json ./packages/shared/
COPY packages/shared/tsconfig*.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src

# Install dependencies and build
RUN npm ci && npm run build -w apps/web

# Production image
FROM node:20-alpine

WORKDIR /app

# Add non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy root package files
COPY package*.json ./
COPY .npmrc* ./

# Copy workspace packages (production only)
COPY apps/web/package*.json ./apps/web/
COPY packages/shared/package*.json ./packages/shared/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application and public assets from builder
COPY --from=builder /app/apps/web/.next/standalone ./apps/web/
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public 2>/dev/null || true

# Change ownership to nodejs user
RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start production server
CMD ["node", "apps/web/server.js"]
