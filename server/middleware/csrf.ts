import { randomUUID } from 'crypto';
import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response, NextFunction } from 'express';
import { getEnv, isProduction } from '../config/env';
import { createLogger } from '../config/logger';
import { authCookieBaseOptions } from '../config/cookies';

const log = createLogger('csrf');

// Routes whose state-changing requests are authenticated only by Bearer token.
// These are exempt from CSRF (cookies are not used for auth → no CSRF risk).
const CSRF_BEARER_EXEMPT = [
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/register$/,
  /^\/api\/auth\/refresh$/,
  /^\/api\/portal\//,
];

function hasBearerAuth(req: Request): boolean {
  const auth = req.headers.authorization;
  return typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ');
}

const csrfClientIdRequestKey = Symbol.for('muhasib.csrfClientId');

export function csrfIdentifierCookieName(): string {
  return isProduction() ? '__Host-x-csrf-id' : 'x-csrf-id';
}

function normalizeCookieValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return undefined;
  return trimmed;
}

function readCookieFromHeader(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValueParts] = part.trim().split('=');
    if (rawKey !== name) continue;

    const rawValue = rawValueParts.join('=');
    try {
      return normalizeCookieValue(decodeURIComponent(rawValue));
    } catch {
      return normalizeCookieValue(rawValue);
    }
  }

  return undefined;
}

function readCsrfIdentifierCookie(req: Request): string | undefined {
  const name = csrfIdentifierCookieName();
  const parsed = normalizeCookieValue((req as any).cookies?.[name]);
  return parsed || readCookieFromHeader(req, name);
}

export function resolveCsrfIdentifier(req: Request, res?: Response): string {
  const existingRequestId = normalizeCookieValue((req as any)[csrfClientIdRequestKey]);
  if (existingRequestId) return existingRequestId;

  const existingCookieId = readCsrfIdentifierCookie(req);
  if (existingCookieId) {
    (req as any)[csrfClientIdRequestKey] = existingCookieId;
    return existingCookieId;
  }

  const generated = randomUUID();
  (req as any)[csrfClientIdRequestKey] = generated;

  if (res) {
    res.cookie(csrfIdentifierCookieName(), generated, authCookieBaseOptions());
  }

  return generated;
}

const env = getEnv();

const {
  generateCsrfToken,
  doubleCsrfProtection,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: () => env.SESSION_SECRET,
  getSessionIdentifier: (req) => resolveCsrfIdentifier(req),
  cookieName: isProduction() ? '__Host-x-csrf' : 'x-csrf',
  cookieOptions: authCookieBaseOptions(),
  size: 32,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getCsrfTokenFromRequest: (req) =>
    (req.headers['x-csrf-token'] as string | undefined) ||
    (req.headers['x-xsrf-token'] as string | undefined),
  skipCsrfProtection: (req) => {
    if (hasBearerAuth(req)) return true;
    return CSRF_BEARER_EXEMPT.some((rx) => rx.test(req.path));
  },
});

export const csrfProtection = doubleCsrfProtection;

export function csrfTokenHandler(req: Request, res: Response): void {
  resolveCsrfIdentifier(req, res);
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
}

export function csrfErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err === invalidCsrfTokenError || err?.code === 'EBADCSRFTOKEN' || err?.code === invalidCsrfTokenError.code) {
    log.warn({ msg: err?.message }, 'CSRF token validation failed');
    res.status(403).json({
      message: 'Invalid or missing CSRF token',
      code: 'CSRF_INVALID',
    });
    return;
  }
  next(err);
}
