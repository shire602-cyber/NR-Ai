// ─── Load environment variables first ────────────────────────
import "dotenv/config";

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import compression from "compression";
import cookieParser from "cookie-parser";

import { validateEnv, isDevelopment } from "./config/env";
import { authCookieBaseOptions } from "./config/cookies";
import { createLogger } from "./config/logger";
import { applySecurityMiddleware } from "./middleware/security";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import { globalErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import { csrfProtection, csrfTokenHandler, csrfErrorHandler } from "./middleware/csrf";
import { logBillingEnforcementStatus } from "./middleware/featureGate";
import { registerRoutes } from "./routes";
import { initSocketServer } from "./services/socket.service";
import { setupVite, serveStatic } from "./vite";
import { initScheduler } from "./services/scheduler.service";
import { runMigrations, closePool, ensureCriticalSchema, pingDb, getPoolStats } from "./db";
import { installGracefulShutdown } from "./shutdown";
import { captureException, monitoringConfigured } from "./services/monitoring";
import { assessStorageDurability } from "./services/fileStorage";

// ─── Validate environment on startup ─────────────────────────
const env = validateEnv();
const log = createLogger("server");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const app = express();

// ─── Trust proxy (required behind reverse proxy / Railway / Render) ──
app.set("trust proxy", 1);

// ─── Correlation ID — must run before logging / security so every
//     request log line and rate-limit warn carries the same trace ID.
app.use(requestId);

// ─── Security middleware (helmet, CORS, rate limiting) ──────
applySecurityMiddleware(app);

// ─── Response compression ────────────────────────────────────
app.use(compression());

// ─── Body parsing ────────────────────────────────────────────
// Most endpoints accept small JSON. A handful of image-upload routes
// (OCR + receipts) accept base64 data URLs and need a larger limit.
const largeJsonRoutes = [
  /^\/api\/ocr\//,
  /^\/api\/export\//,
  /^\/api\/firm\/bulk\/ocr/,
  /^\/api\/companies\/[^/]+\/receipts$/,
  /^\/api\/companies\/[^/]+\/bank-statements\/import$/,
];

const largeJson = express.json({ limit: "10mb" });
const smallJson = express.json({ limit: "1mb" });

// The inbound email webhook needs the EXACT raw bytes to verify its HMAC
// signature, so it gets a raw-body parser and is skipped by the JSON parser.
app.use("/api/webhooks/email-intake", express.raw({ type: "*/*", limit: "20mb" }));

app.use((req, res, next) => {
  if (req.path === "/api/webhooks/email-intake") return next(); // raw body handled above
  const useLarge = largeJsonRoutes.some((rx) => rx.test(req.path));
  return (useLarge ? largeJson : smallJson)(req, res, next);
});
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// ─── Cookie parser (must run before CSRF + session) ─────────
app.use(cookieParser(env.SESSION_SECRET));

// ─── Session configuration ───────────────────────────────────
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      conString: env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      ...authCookieBaseOptions(),
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// ─── Passport initialization ─────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());
import "./auth";

// ─── Request logging ─────────────────────────────────────────
app.use(requestLogger);

// ─── CSRF token endpoint (public, sets cookie + returns header token) ─
app.get("/api/csrf-token", csrfTokenHandler);

// ─── CSRF protection on state-changing requests ─────────────
// Skips Bearer-auth requests and a small allowlist (login/register/portal).
app.use(csrfProtection);

// ─── Health check (before auth, always accessible) ───────────
// Liveness probe — process is up. Cheap; safe for orchestrators.
app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// Railway healthcheck endpoint. This must stay DB-free so deploy readiness is
// about whether the HTTP server is alive, not whether downstream services are.
app.get("/api/version", (_req, res) => {
  res.status(200).json({
    status: "ok",
    version: process.env.APP_VERSION || "1.0.0",
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || null,
    environment: env.NODE_ENV,
    uptime: process.uptime(),
  });
});

// Readiness probe — process is up and can reach the database. Minimal details
// only; full internals stay behind authenticated operational routes.
app.get("/health/ready", async (_req, res) => {
  const ping = await pingDb();
  res.status(ping.ok ? 200 : 503).json({
    status: ping.ok ? "ok" : "degraded",
    checks: {
      database: ping.ok ? "ok" : "error",
      databaseLatencyMs: ping.latencyMs,
    },
  });
});

// Readiness/full health — depends on DB. Reports pool + memory + version.
app.get("/health", async (_req, res) => {
  const ping = await pingDb();
  const status = ping.ok ? "ok" : "degraded";
  const mem = process.memoryUsage();
  res.status(ping.ok ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    version: process.env.APP_VERSION || "1.0.0",
    node: process.version,
    pid: process.pid,
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    },
    checks: {
      database: ping.ok ? "ok" : "error",
      databaseLatencyMs: ping.latencyMs,
      databaseError: ping.error,
      pool: getPoolStats(),
      errorTracking: monitoringConfigured() ? "configured" : "logs-only",
    },
  });
});

// ─── Ensure required directories exist & fix mounted-volume ownership ──
// On Railway, the durable receipt-image storage is a mounted Volume. Railway
// mounts volumes owned by ROOT, but the container runs as the unprivileged
// `muhasib` user (uid 1001) — so the app gets EACCES creating/writing inside
// the mount (e.g. `mkdir /app/uploads/receipts`). To fix this cleanly we let
// the container start as root, make the uploads tree writable by the app
// user, then DROP privileges back to that user for the rest of the process.
const uploadsDir = path.resolve(projectRoot, "uploads");
const receiptsDir = path.join(uploadsDir, "receipts");

// Must match the user/group created in the Dockerfile (muhasib:nodejs).
const APP_UID = 1001;
const APP_GID = 1001;

const runningAsRoot =
  process.platform === "linux" &&
  typeof process.getuid === "function" &&
  process.getuid() === 0;

if (runningAsRoot) {
  // We own everything right now — create the tree and hand the (root-owned)
  // volume mount over to the app user so it stays writable after we drop.
  try {
    fs.mkdirSync(receiptsDir, { recursive: true });
    execSync(`chown -R ${APP_UID}:${APP_GID} ${uploadsDir}`);
    log.info({ uploadsDir }, "Prepared uploads volume and chowned to app user");
  } catch (err) {
    log.error(
      { err: (err as Error).message, uploadsDir },
      "Failed to prepare/chown uploads volume; saves still work as root"
    );
  }
  // Drop privileges: setgid BEFORE setuid (cannot setgid once unprivileged).
  try {
    if (typeof process.setgid === "function" && typeof process.setuid === "function") {
      process.setgid(APP_GID);
      process.setuid(APP_UID);
      log.info({ uid: APP_UID, gid: APP_GID }, "Dropped privileges to app user");
    }
  } catch (err) {
    // Staying root is acceptable: the volume is already chowned and root can
    // write it, so receipt saving works — we only lose the hardening.
    log.error(
      { err: (err as Error).message },
      "Failed to drop privileges; continuing as root"
    );
  }
} else {
  // Non-root (local dev, or already-unprivileged): just ensure the dirs.
  try {
    fs.mkdirSync(receiptsDir, { recursive: true });
  } catch (err) {
    log.warn(
      { err: (err as Error).message, receiptsDir },
      "Could not create uploads directory"
    );
  }
}

// ─── Storage durability check ────────────────────────────────
// Receipt images must survive redeploys. Object storage OR a persistent volume
// satisfies this; an ephemeral container disk does not. We surface the result
// at boot so an accidentally-ephemeral production deploy is loud, not silent.
// Set STORAGE_STRICT=true to hard-fail the boot instead of warning.
{
  const durability = assessStorageDurability(uploadsDir);
  if (durability.durable) {
    log.info(
      { backend: durability.backend, detail: durability.detail },
      "Receipt image storage is durable"
    );
  } else if (env.NODE_ENV === "production") {
    const msg =
      `Receipt image storage is EPHEMERAL (${durability.detail}). ` +
      "Images will be lost on redeploy. Configure object storage " +
      "(S3_BUCKET or BLOB_READ_WRITE_TOKEN) or attach a persistent volume.";
    if (process.env.STORAGE_STRICT === "true") {
      log.error(
        { backend: durability.backend },
        `${msg} STORAGE_STRICT is set - refusing to boot.`
      );
      process.exit(1);
    }
    log.error({ backend: durability.backend }, msg);
  } else {
    log.warn(
      { backend: durability.backend, detail: durability.detail },
      "Receipt image storage is ephemeral (acceptable for local dev)"
    );
  }
}

// ─── Module-level refs for graceful shutdown ─────────────────
let httpServer: any = null;
let ioServer: any = null;

// ─── Bootstrap application ───────────────────────────────────
async function bootstrap() {
  log.info({ environment: env.NODE_ENV, port: env.PORT }, "Starting server");

  // Migrations are deploy-phase work, not boot-phase work. Default off in
  // prod; opt-in via AUTO_MIGRATE_ON_BOOT=true (dev/test/single-instance).
  // For prod, run `npm run db:migrate` in the Railway release command
  // (railway.json -> deploy.preDeployCommand or equivalent).
  if (env.AUTO_MIGRATE_ON_BOOT) {
    const migrationsFolder = path.join(projectRoot, "migrations");
    log.info({ migrationsFolder }, "Running database migrations...");
    try {
      await runMigrations(migrationsFolder);
      log.info("Database migrations completed successfully");
    } catch (migrationErr) {
      log.error(
        { err: migrationErr },
        "Database migration failed — continuing startup with existing schema"
      );
    }
    // Belt-and-suspenders: only run alongside boot-time migrations. In prod
    // (AUTO_MIGRATE_ON_BOOT=false), this band-aid is also off — every
    // replica running DDL on boot is a multi-instance race risk.
    await ensureCriticalSchema();
  } else {
    log.info(
      "Skipping boot-time migrations and schema guard (AUTO_MIGRATE_ON_BOOT=false). Run `npm run db:migrate` in deploy phase."
    );
  }

  // Register all API routes
  const server = await registerRoutes(app);
  httpServer = server;

  // ─── WebSocket (Socket.io) ────────────────────────────
  ioServer = initSocketServer(server);

  // ─── Background scheduler (engagement automation) ─────
  initScheduler();

  // ─── API 404 handler (before static/SPA fallback) ───────
  app.use("/api/*", notFoundHandler);

  // ─── CSRF error handler runs before global handler ───────
  app.use(csrfErrorHandler);

  // ─── Error handling (MUST be after routes) ───────────────
  app.use(globalErrorHandler);

  // ─── Vite / Static serving ───────────────────────────────
  if (isDevelopment()) {
    await setupVite(app, server);
    log.info("Vite development server configured");
  } else {
    serveStatic(app);
    log.info("Serving static files");
  }

  // ─── Start listening ─────────────────────────────────────
  const port = env.PORT;
  server.listen(port, "0.0.0.0", () => {
    log.info(`✓ Server running at http://localhost:${port}`);
    log.info(`✓ Database: ${env.DATABASE_URL ? "Connected" : "Not configured"}`);
    log.info(`✓ AI: ${env.OPENAI_API_KEY ? "Configured" : "Not configured"}`);
    logBillingEnforcementStatus();
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      log.fatal({ port }, "Port already in use");
    } else {
      log.fatal({ error }, "Server error");
    }
    process.exit(1);
  });

  // ─── Graceful shutdown wired now that servers exist ──────
  const shutdown = installGracefulShutdown({
    httpServer,
    ioServer,
    closePool,
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

bootstrap().catch((error: unknown) => {
  // Use pino's `err` key so the std serializer emits message + stack.
  // (`{ error }` serialized to an empty object — a blind fatal log.)
  log.fatal({ err: error }, "Failed to start server");
  // Belt and braces: if the logger itself is misconfigured, still say why.
  console.error("Failed to start server:", error);
  process.exit(1);
});

// Note: graceful shutdown handlers are wired up inside bootstrap() once
// httpServer / ioServer references are populated. Until then, signals fall
// through to the default handler (immediate exit) which is fine — there are
// no in-flight requests to drain pre-bootstrap.

process.on("unhandledRejection", (reason) => {
  captureException(reason, { source: "unhandledRejection" });
});

process.on("uncaughtException", (error) => {
  captureException(error, { source: "uncaughtException", fatal: true });
  log.fatal({ error }, "Uncaught exception");
  process.exit(1);
});
