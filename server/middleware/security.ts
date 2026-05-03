import helmet from 'helmet';
import cors from 'cors';
import type { Express, Request, Response, NextFunction } from 'express';
import { getEnv, isProduction } from '../config/env';
import { createLogger } from '../config/logger';
import { buildLimiter, limiterProfiles } from './rateLimit';
import { cspNonce, buildCspDirectives, cspReportHandler } from './csp';

const log = createLogger('security');

/**
 * Apply all security middleware to the Express app.
 * Must be called BEFORE route registration.
 */
export function applySecurityMiddleware(app: Express): void {
  const env = getEnv();

  // ─── Per-request CSP nonce (must run before helmet) ───────
  app.use(cspNonce);

  // CSP violation reports come in as POST with JSON content type — accept
  // both standard `application/csp-report` and `application/json` payloads.
  app.use('/api/csp-report', (req, res, next) => {
    const ctype = (req.headers['content-type'] || '').toLowerCase();
    if (ctype.includes('csp-report')) {
      // helmet's CSP report-uri sends application/csp-report; parse manually
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        next();
      });
      return;
    }
    next();
  });
  app.post('/api/csp-report', cspReportHandler);

  // ─── Helmet: Security Headers ─────────────────────────────
  // Sets X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
  // Content-Security-Policy, Strict-Transport-Security, etc.
  app.use(
    helmet({
      contentSecurityPolicy: buildCspDirectives(),
      crossOriginEmbedderPolicy: false, // Allow embedding (PDF viewers, etc.)
    })
  );

  // ─── CORS: Cross-Origin Resource Sharing ──────────────────
  const allowedOrigins = new Set<string>();

  if (env.FRONTEND_URL) {
    allowedOrigins.add(env.FRONTEND_URL);
  }

  if (env.CORS_ORIGIN) {
    for (const origin of env.CORS_ORIGIN.split(',')) {
      const trimmed = origin.trim();
      if (trimmed) allowedOrigins.add(trimmed);
    }
  }

  // In development, allow localhost origins
  if (!isProduction()) {
    [
      'http://localhost:5173',
      'http://localhost:5000',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5000',
      'http://127.0.0.1:3000'
    ].forEach((origin) => allowedOrigins.add(origin));
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);

        if (allowedOrigins.has(origin)) {
          return callback(null, true);
        }

        log.warn({ origin }, 'Blocked CORS request from unauthorized origin');
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'X-XSRF-Token'],
      exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page', 'Retry-After', 'RateLimit-Reset'],
      maxAge: 86400, // Cache preflight for 24 hours
    })
  );

  // ─── Request Size Limits ──────────────────────────────────
  // Hard ceiling: image-upload routes allow up to 10MB; the per-route
  // body parser in index.ts enforces tighter per-route limits.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > 10_485_760) {
      // 10MB
      return res.status(413).json({ message: 'Request too large' });
    }
    next();
  });

  // ─── HTTPS Enforcement (production only) ──────────────────
  if (isProduction()) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const proto = req.headers['x-forwarded-proto'];
      // Only redirect if header is present AND not https, skip health checks
      if (proto && proto !== 'https' && req.path !== '/health') {
        return res.redirect(301, `https://${req.hostname}${req.url}`);
      }
      next();
    });
  }

  // ─── Security Logging ─────────────────────────────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Log suspicious requests
    const suspiciousPatterns = [
      /\.\.\//,          // Path traversal
      /<script/i,        // XSS attempt
      /union\s+select/i, // SQL injection
      /javascript:/i,    // XSS in URLs
    ];

    const fullUrl = req.originalUrl || req.url;
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(fullUrl) || pattern.test(JSON.stringify(req.body || ''))) {
        log.warn(
          { ip: req.ip, method: req.method, url: fullUrl },
          'Suspicious request detected'
        );
        break;
      }
    }
    next();
  });

  log.info('Security middleware applied');
}

/**
 * Rate limiting needs parsed bodies for auth login keys (`ip + email`), so it
 * is installed after JSON parsing in index.ts while still before routes.
 */
export function applyRateLimitMiddleware(app: Express): void {
  app.use('/api/auth/login', buildLimiter(limiterProfiles.authLogin));
  app.use('/api/auth/register', buildLimiter(limiterProfiles.authRegister));
  app.use(['/api/auth/forgot-password', '/api/auth/reset-password'], buildLimiter(limiterProfiles.authRecovery));
  app.use(['/api/auth/refresh-token', '/api/auth/refresh', '/api/auth/logout'], buildLimiter(limiterProfiles.authSession));
  app.use('/api/auth/', buildLimiter(limiterProfiles.authOther));
  app.use('/api/ai/', buildLimiter(limiterProfiles.ai));
  app.use('/api/ocr/', buildLimiter(limiterProfiles.ai));
  app.use('/api/firm/bulk/ocr', buildLimiter(limiterProfiles.ai));
  app.use('/api/', buildLimiter(limiterProfiles.api));

  log.info('Rate-limit middleware applied');
}
