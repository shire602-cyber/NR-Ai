import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { isProduction } from '../config/env';
import { createLogger } from '../config/logger';

const log = createLogger('csp');

/**
 * Per-request nonce middleware. Attaches `res.locals.cspNonce` for templates
 * that need to inline a script (rare here; mostly available for future use).
 */
export function cspNonce(_req: Request, res: Response, next: NextFunction): void {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

/**
 * Build the Helmet contentSecurityPolicy directive set.
 *
 * Production: strict CSP — only same-origin scripts (no inline), nonces available
 * for any inline script we explicitly emit, and reports posted to /api/csp-report.
 * Development: relaxed CSP — Vite needs inline scripts and HMR over ws://, so we
 * keep the directives but allow 'unsafe-inline' and 'unsafe-eval' for scripts.
 */
export function buildCspDirectives() {
  const prod = isProduction();
  // helmet hands raw http types to its directive callback, not express types.
  const nonceFn = (_req: IncomingMessage, res: ServerResponse): string => {
    const expressRes = res as unknown as Response;
    return `'nonce-${(expressRes.locals?.cspNonce as string) ?? ''}'`;
  };

  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: prod
        ? ["'self'", nonceFn]
        : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: prod
        ? ["'self'"]
        : ["'self'", 'ws://localhost:*', 'http://localhost:*', 'ws://127.0.0.1:*'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      reportUri: ['/api/csp-report'],
      ...(prod ? { upgradeInsecureRequests: [] } : {}),
    },
  };
}

/**
 * CSP violation report endpoint. The browser POSTs JSON describing the
 * blocked resource. We log a structured warning so it shows up in pino output
 * and any downstream log aggregator without spamming at error level.
 */
export function cspReportHandler(req: Request, res: Response): void {
  const report = (req.body && (req.body['csp-report'] || req.body)) || {};
  log.warn(
    {
      blockedUri: report['blocked-uri'],
      violatedDirective: report['violated-directive'],
      effectiveDirective: report['effective-directive'],
      documentUri: report['document-uri'],
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
      ip: req.ip,
      ua: req.headers['user-agent'],
    },
    'CSP violation reported',
  );
  res.status(204).end();
}
