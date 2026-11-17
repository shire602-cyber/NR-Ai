# ===================================
# Muhasib.ai Production Dockerfile
# Multi-stage build for optimal size
# ===================================

# RAILWAY_GIT_COMMIT_SHA is injected by Railway and is different on every
# deploy. We declare it as a build ARG at the very top so every subsequent
# layer sees it in its cache key — any source change produces a new SHA
# and invalidates the whole build. Without this, Railway was happily
# reusing a stale "cached" builder stage forever.
ARG RAILWAY_GIT_COMMIT_SHA=local

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies and build the client + server bundles
# ---------------------------------------------------------------------------
FROM node:20.19-bookworm-slim AS builder
ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
WORKDIR /app

# Dependency layer — cacheable. Only invalidates when lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

# Source layer — tagged with the commit SHA so Railway's cache key
# changes every deploy. We embed the SHA in TWO places to defeat
# layer reuse: a label (which is part of the image manifest) and
# a file that the build step reads. Without this Railway was
# reusing the entire builder stage between deploys of the same
# branch, which is why the dist/ produced was sometimes stale.
LABEL railway.commit-sha="${RAILWAY_GIT_COMMIT_SHA}"
RUN echo "source-sha: ${RAILWAY_GIT_COMMIT_SHA}" > /tmp/source-sha && \
    echo "build-time: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /tmp/source-sha
COPY . .
# Touch a sentinel that includes the SHA so even `npm run build`'s
# cache key changes — Vite content-hashes by source, so identical
# source produces identical chunks; we don't try to fight that.
RUN echo "${RAILWAY_GIT_COMMIT_SHA}" > /app/.commit-sha
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Install production dependencies only
# ---------------------------------------------------------------------------
FROM node:20.19-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 3: Minimal production image
# ---------------------------------------------------------------------------
FROM node:20.19-bookworm-slim
ARG RAILWAY_GIT_COMMIT_SHA
ENV NODE_ENV=production
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin muhasib

COPY --from=deps /app/node_modules ./node_modules

# Same SHA trick: guarantees every layer below is re-evaluated on every
# new commit. Also leaves a /app/.build-info file that ops can cat to
# verify which commit is running.
RUN echo "git-sha: ${RAILWAY_GIT_COMMIT_SHA}" > /app/.build-info

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/migrations ./migrations
# PDF fonts (Noto Sans / Noto Sans Arabic) are read from disk by server/services/pdf-fonts.ts.
# server/assets/einvoice holds the vendored UBL 2.1 XSD + OpenPeppol PINT AE schematron (and their
# NOTICE/licences) read by server/services/einvoice/validate.ts; keep it in the image so production
# runs full XSD + schematron validation (override the path with EINVOICE_ARTEFACTS_DIR).
COPY --from=builder /app/server/assets ./server/assets

RUN mkdir -p uploads/receipts && chown -R muhasib:nodejs uploads

# The container runs as the unprivileged `muhasib` user (uid/gid 1001). Self-hosting:
# the host uploads directory must be owned by 1001:1001 (`chown 1001:1001 /srv/muhasib/uploads`,
# docs/release/SELF-HOSTING.md); named volumes inherit the ownership of /app/uploads above.
# Railway mounts volumes owned by root; there set RAILWAY_RUN_UID=0 so the app can start as
# root, chown the mount and drop to uid 1001 itself (server/index.ts).
USER muhasib

EXPOSE ${PORT:-5000}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/version').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
