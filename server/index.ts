// ─── Load environment variables first ────────────────────────
import "dotenv/config";
// The process runs in UTC: timestamp columns carry no zone (server/config/pin-timezone.ts).
import "./config/pin-timezone";
// zod 3-compatible validation messages, before any schema parses (R17-27).
import "../shared/zod-config";

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

import { createServer, type Server as HttpServer } from "http";
import type { Server as IoServer } from "socket.io";
import { createApp } from "./app";
import { validateEnv, isDevelopment } from "./config/env";
import { createLogger } from "./config/logger";
import { logBillingEnforcementStatus } from "./middleware/featureGate";
import { initSocketServer } from "./services/socket.service";
import { setupVite, serveStatic } from "./vite";
import { initScheduler } from "./services/scheduler.service";
import { runMigrations, closePool, ensureCriticalSchema } from "./db";
import { installGracefulShutdown } from "./shutdown";
import { captureException } from "./services/monitoring";
import { assessStorageDurability } from "./services/fileStorage";
import { artefactFilesPresent } from "./services/einvoice/validate";

// ─── Validate environment on startup ─────────────────────────
const env = validateEnv();
const log = createLogger("server");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

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
  process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0;

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
    log.error({ err: (err as Error).message }, "Failed to drop privileges; continuing as root");
  }
} else {
  // Non-root (local dev, or already-unprivileged): just ensure the dirs.
  try {
    fs.mkdirSync(receiptsDir, { recursive: true });
  } catch (err) {
    log.warn({ err: (err as Error).message, receiptsDir }, "Could not create uploads directory");
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
let httpServer: HttpServer | null = null;
let ioServer: IoServer | null = null;

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

  const app = await createApp();
  const server = createServer(app);
  httpServer = server;

  // ─── WebSocket (Socket.io) ────────────────────────────
  ioServer = initSocketServer(server);

  // ─── Background scheduler (engagement automation) ─────
  initScheduler();

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
    // W4-C: e-invoice XSD + PINT AE schematron ship in server/assets/einvoice
    // (copied into the image with server/assets). Without them validation
    // reports `available: false` for those layers, so say so at boot.
    const einvoiceArtefacts = artefactFilesPresent();
    if (einvoiceArtefacts.xsd && einvoiceArtefacts.schematron) {
      log.info(`✓ E-invoice artefacts: XSD + schematron found in ${einvoiceArtefacts.dir}`);
    } else {
      log.warn(
        einvoiceArtefacts,
        "E-invoice validation artefacts missing: UBL XSD and/or PINT AE schematron layers will report unavailable"
      );
    }
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
