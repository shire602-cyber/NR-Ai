# ===================================
# Muhasib.ai Production Dockerfile
# Multi-stage build for optimal size
# ===================================

# Stage 1: Install ALL dependencies and build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# Stage 2: Install production dependencies only
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Stage 3: Production image
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 muhasib

COPY --from=deps /app/node_modules ./node_modules

# Force cache invalidation — date changes every build so nothing below can be cached
RUN echo "build-timestamp: $(date -u +%Y%m%d%H%M%S)" > /app/.build-info

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/migrations ./migrations

RUN mkdir -p uploads && chown -R muhasib:nodejs uploads

USER muhasib

EXPOSE ${PORT:-5000}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-5000}/health/live || exit 1

CMD ["node", "dist/index.js"]
