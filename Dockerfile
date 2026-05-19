# ===================================
# Muhasib.ai Production Dockerfile
# Multi-stage build for optimal size
# ===================================

# RAILWAY_GIT_COMMIT_SHA is injected by Railway and changes on every deploy.
# Use it before copying source so Railway cannot reuse a stale builder layer
# for a newer commit.
ARG RAILWAY_GIT_COMMIT_SHA=local

# Stage 1: Install ALL dependencies and build
FROM node:20-alpine AS builder
ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
LABEL railway.commit-sha="${RAILWAY_GIT_COMMIT_SHA}"
RUN echo "source-sha: ${RAILWAY_GIT_COMMIT_SHA}" > /tmp/source-sha && \
    echo "build-time: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /tmp/source-sha
COPY . .
RUN echo "${RAILWAY_GIT_COMMIT_SHA}" > /app/.commit-sha
RUN npm run build

# Stage 2: Install production dependencies only
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Stage 3: Production image
FROM node:20-alpine
ARG RAILWAY_GIT_COMMIT_SHA
WORKDIR /app

ENV NODE_ENV=production
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 muhasib

COPY --from=deps /app/node_modules ./node_modules

RUN echo "git-sha: ${RAILWAY_GIT_COMMIT_SHA}" > /app/.build-info

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/migrations ./migrations

RUN mkdir -p uploads && chown -R muhasib:nodejs uploads

USER muhasib

EXPOSE ${PORT:-5000}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-5000}/api/version || exit 1

CMD ["node", "dist/index.js"]
