// ─── Load environment variables first ────────────────────────
import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { validateEnv, isProduction, isDevelopment } from './config/env';
import { createLogger } from './config/logger';
import { applySecurityMiddleware } from './middleware/security';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { csrfProtection, csrfTokenHandler, csrfErrorHandler } from './middleware/csrf';
import { registerRoutes } from './routes';
import { initSocketServer } from './services/socket.service';
import { setupVite, serveStatic } from './vite';
import { initScheduler } from './services/scheduler.service';
import { runMigrations, closePool, ensureCriticalSchema, pingDb, getPoolStats } from './db';
import { installGracefulShutdown } from './shutdown';

// ─── Validate environment on startup ─────────────────────────
const env = validateEnv();
const log = createLogger('server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const app = express();

// ─── Trust proxy (required behind reverse proxy / Railway / Render) ──
app.set('trust proxy', 1);

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
  /^\/api\/firm\/bulk\/ocr/,
  /^\/api\/companies\/[^/]+\/receipts$/,
  /^\/api\/companies\/[^/]+\/bank-statements\/import$/,
];

const largeJson = express.json({ limit: '10mb' });
const smallJson = express.json({ limit: '1mb' });

app.use((req, res, next) => {
  const useLarge = largeJsonRoutes.some((rx) => rx.test(req.path));
  return (useLarge ? largeJson : smallJson)(req, res, next);
});
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── Cookie parser (must run before CSRF + session) ─────────
app.use(cookieParser(env.SESSION_SECRET));

// ─── Session configuration ───────────────────────────────────
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      conString: env.DATABASE_URL,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction(),
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax',
    },
  })
);

// ─── Passport initialization ─────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());
import './auth';

// ─── Request logging ─────────────────────────────────────────
app.use(requestLogger);

// ─── CSRF token endpoint (public, sets cookie + returns header token) ─
app.get('/api/csrf-token', csrfTokenHandler);

// ─── CSRF protection on state-changing requests ─────────────
// Skips Bearer-auth requests and a small allowlist (login/register/portal).
app.use(csrfProtection);

// ─── Health check (before auth, always accessible) ───────────
// Liveness probe — process is up. Cheap; safe for orchestrators.
app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Readiness/full health — depends on DB. Reports pool + memory + version.
app.get('/health', async (_req, res) => {
  const ping = await pingDb();
  const status = ping.ok ? 'ok' : 'degraded';
  const mem = process.memoryUsage();
  res.status(ping.ok ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0',
    node: process.version,
    pid: process.pid,
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    },
    checks: {
      database: ping.ok ? 'ok' : 'error',
      databaseLatencyMs: ping.latencyMs,
      databaseError: ping.error,
      pool: getPoolStats(),
    },
  });
});

// ─── Ensure required directories exist ───────────────────────
const uploadsDir = path.resolve(projectRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  log.info(`Created uploads directory: ${uploadsDir}`);
}

// ─── Module-level refs for graceful shutdown ─────────────────
let httpServer: any = null;
let ioServer: any = null;

// ─── Bootstrap application ───────────────────────────────────
async function bootstrap() {
  log.info({ environment: env.NODE_ENV, port: env.PORT }, 'Starting server');

  // Migrations are deploy-phase work, not boot-phase work. Default off in
  // prod; opt-in via AUTO_MIGRATE_ON_BOOT=true (dev/test/single-instance).
  // For prod, run `npm run db:migrate` in the Railway release command
  // (railway.json -> deploy.preDeployCommand or equivalent).
  if (env.AUTO_MIGRATE_ON_BOOT) {
    const migrationsFolder = path.join(projectRoot, 'migrations');
    log.info({ migrationsFolder }, 'Running database migrations...');
    try {
      await runMigrations(migrationsFolder);
      log.info('Database migrations completed successfully');
    } catch (migrationErr) {
      log.error({ err: migrationErr }, 'Database migration failed — continuing startup with existing schema');
    }
    // Belt-and-suspenders: only run alongside boot-time migrations. In prod
    // (AUTO_MIGRATE_ON_BOOT=false), this band-aid is also off — every
    // replica running DDL on boot is a multi-instance race risk.
    await ensureCriticalSchema();
  } else {
    log.info('Skipping boot-time migrations and schema guard (AUTO_MIGRATE_ON_BOOT=false). Run `npm run db:migrate` in deploy phase.');
  }

  // Register all API routes
  const server = await registerRoutes(app);
  httpServer = server;

  // ─── WebSocket (Socket.io) ────────────────────────────
  ioServer = initSocketServer(server);

  // ─── Background scheduler (engagement automation) ─────
  initScheduler();

  // ─── API 404 handler (before static/SPA fallback) ───────
  app.use('/api/*', notFoundHandler);

  // ─── CSRF error handler runs before global handler ───────
  app.use(csrfErrorHandler);

  // ─── Error handling (MUST be after routes) ───────────────
  app.use(globalErrorHandler);

  // ─── Vite / Static serving ───────────────────────────────
  if (isDevelopment()) {
    await setupVite(app, server);
    log.info('Vite development server configured');
  } else {
    serveStatic(app);
    log.info('Serving static files');
  }

  // ─── Start listening ─────────────────────────────────────
  const port = env.PORT;
  server.listen(port, '0.0.0.0', () => {
    log.info(`✓ Server running at http://localhost:${port}`);
    log.info(`✓ Database: ${env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
    log.info(`✓ AI: ${env.OPENAI_API_KEY ? 'Configured' : 'Not configured'}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      log.fatal({ port }, 'Port already in use');
    } else {
      log.fatal({ error }, 'Server error');
    }
    process.exit(1);
  });

  // ─── Graceful shutdown wired now that servers exist ──────
  const shutdown = installGracefulShutdown({
    httpServer,
    ioServer,
    closePool,
  });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

bootstrap().catch((error) => {
  log.fatal({ error }, 'Failed to start server');
  process.exit(1);
});

// Note: graceful shutdown handlers are wired up inside bootstrap() once
// httpServer / ioServer references are populated. Until then, signals fall
// through to the default handler (immediate exit) which is fine — there are
// no in-flight requests to drain pre-bootstrap.

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  log.fatal({ error }, 'Uncaught exception');
  process.exit(1);
});
