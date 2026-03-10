// ─── Load environment variables first ────────────────────────
import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import session from 'express-session';
import MemoryStore from 'memorystore';
import passport from 'passport';

import { validateEnv, isProduction, isDevelopment } from './config/env';
import { createLogger } from './config/logger';
import { applySecurityMiddleware } from './middleware/security';
import { requestLogger } from './middleware/requestLogger';
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { registerRoutes } from './routes';
import { setupVite, serveStatic } from './vite';

// ─── Validate environment on startup ─────────────────────────
const env = validateEnv();
const log = createLogger('server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const app = express();

// ─── Trust proxy (required behind reverse proxy / Railway / Render) ──
app.set('trust proxy', 1);

// ─── Security middleware (helmet, CORS, rate limiting) ──────
applySecurityMiddleware(app);

// ─── Body parsing ────────────────────────────────────────────
app.use(
  express.json({
    limit: '50mb', // For base64-encoded receipt images
  })
);
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// ─── Session configuration ───────────────────────────────────
const MemoryStoreSession = MemoryStore(session);
app.use(
  session({
    store: new MemoryStoreSession({
      checkPeriod: 86400000, // Prune expired entries every 24h
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

// ─── Health check (before auth, always accessible) ───────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    version: '1.0.0',
  });
});

// ─── Ensure required directories exist ───────────────────────
const uploadsDir = path.resolve(projectRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  log.info(`Created uploads directory: ${uploadsDir}`);
}

// ─── Bootstrap application ───────────────────────────────────
async function bootstrap() {
  log.info({ environment: env.NODE_ENV, port: env.PORT }, 'Starting server');

  // ─── Auto-migrate database on startup ──────────────────────
  try {
    const { pool } = await import('./db');
    const migrationsDir = path.resolve(projectRoot, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      // Create migration tracking table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash TEXT NOT NULL,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
        )
      `);

      // Get already-applied migrations
      const applied = await pool.query('SELECT hash FROM "__drizzle_migrations"');
      const appliedHashes = new Set(applied.rows.map((r: any) => r.hash));

      // Read and apply SQL migration files in order
      const sqlFiles = fs.readdirSync(migrationsDir)
        .filter((f: string) => f.endsWith('.sql'))
        .sort();

      for (const file of sqlFiles) {
        const hash = file.replace('.sql', '');
        if (appliedHashes.has(hash)) {
          continue; // Already applied
        }
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        log.info(`Applying migration: ${file}`);
        // Split on statement breakpoints and execute each
        const statements = sql.split('--> statement-breakpoint').filter((s: string) => s.trim());
        for (const stmt of statements) {
          if (stmt.trim()) {
            await pool.query(stmt);
          }
        }
        await pool.query('INSERT INTO "__drizzle_migrations" (hash) VALUES ($1)', [hash]);
        log.info(`✓ Applied migration: ${file}`);
      }
      log.info('✓ Database migrations complete');
    }
  } catch (migrationError: any) {
    log.error({ error: migrationError.message, stack: migrationError.stack }, 'Database migration failed');
  }

  // Register all API routes
  const server = await registerRoutes(app);

  // ─── API 404 handler (before static/SPA fallback) ───────
  app.use('/api/*', notFoundHandler);

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
}

bootstrap().catch((error) => {
  console.error('FATAL: Failed to start server:', error);
  log.fatal({ err: error, message: error?.message, stack: error?.stack }, 'Failed to start server');
  process.exit(1);
});

// ─── Graceful shutdown ───────────────────────────────────────
process.on('SIGTERM', () => {
  log.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received. Shutting down...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  log.fatal({ error }, 'Uncaught exception');
  process.exit(1);
});
