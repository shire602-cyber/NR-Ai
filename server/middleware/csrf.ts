import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response, NextFunction } from 'express';
import { getEnv, isProduction } from '../config/env';
import { createLogger } from '../config/logger';

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

const env = getEnv();

const {
  generateCsrfToken,
  doubleCsrfProtection,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: () => env.SESSION_SECRET,
  getSessionIdentifier: (req) => {
    const sid = (req as any).sessionID as string | undefined;
    return sid || req.ip || 'anonymous';
  },
  cookieName: isProduction() ? '__Host-x-csrf' : 'x-csrf',
  cookieOptions: {
    sameSite: 'strict',
    secure: isProduction(),
    httpOnly: true,
    path: '/',
  },
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
