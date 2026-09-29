import { randomUUID } from "crypto";
import { doubleCsrf } from "csrf-csrf";
import type { Request, Response, NextFunction } from "express";
import { getEnv, isProduction } from "../config/env";
import { createLogger } from "../config/logger";
import { authCookieBaseOptions } from "../config/cookies";
import { accessCookieName, refreshCookieName } from "../services/auth-cookies.service";

const log = createLogger("csrf");

// Routes whose state-changing requests are authenticated only by Bearer token.
// These are exempt from CSRF (cookies are not used for auth → no CSRF risk).
const CSRF_BEARER_EXEMPT = [
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/register$/,
  /^\/api\/auth\/refresh$/,
  /^\/api\/auth\/refresh-token$/,
  /^\/api\/auth\/forgot-password$/,
  /^\/api\/auth\/reset-password$/,
  /^\/api\/portal\//,
  // Provider webhooks are authenticated by their own HMAC signature, not a CSRF
  // token (the caller is an external service, not the browser).
  /^\/api\/webhooks\/email-intake$/,
  /^\/api\/webhooks\/stripe$/,
  // Client-side error telemetry sink: a fire-and-forget endpoint that returns
  // 204 and takes no state-changing action. It MUST accept reports even when
  // the app is broken (e.g. a chunk failed to load before a CSRF token was
  // ever fetched) — otherwise production errors are silently dropped exactly
  // when we most need them.
  /^\/api\/client-errors$/,
];

// Public (no-login) state-changing endpoints that are NOT CSRF-exempt. A
// visitor without credentials legitimately reaches these, so a CSRF failure
// there stays a 403 rather than being reported as "not logged in".
const PUBLIC_CSRF_PROTECTED = [
  /^\/api\/waitlist$/,
  /^\/api\/referral\/track-signup$/,
  /^\/api\/invitations\/accept\//,
  /^\/api\/auth\/logout$/,
];

const SESSION_COOKIE_NAME = "connect.sid";

function cookieNamesOf(req: Request): Set<string> {
  const names = new Set<string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const name = part.trim().split("=")[0];
    if (name) names.add(name);
  }
  return names;
}

/** True when the request carries any auth credential (Authorization header, auth/session cookie, or a passport user). */
export function hasAuthCredentials(req: Request): boolean {
  if (typeof req.headers.authorization === "string" && req.headers.authorization.trim()) return true;
  if ((req as any).user) return true;
  const cookies = cookieNamesOf(req);
  return (
    cookies.has(accessCookieName()) ||
    cookies.has(refreshCookieName()) ||
    cookies.has(SESSION_COOKIE_NAME)
  );
}

/**
 * Status to return for a failed CSRF check. A request with no credentials at
 * all to a protected route is simply unauthenticated (401); anything that
 * carries credentials — or targets a public form — keeps the 403. The request
 * is rejected either way, so CSRF protection is not weakened.
 */
export function csrfFailureStatus(req: Request): 401 | 403 {
  if (hasAuthCredentials(req)) return 403;
  if (PUBLIC_CSRF_PROTECTED.some((rx) => rx.test(req.path ?? ""))) return 403;
  return 401;
}

function hasBearerAuth(req: Request): boolean {
  const auth = req.headers.authorization;
  return typeof auth === "string" && auth.toLowerCase().startsWith("bearer ");
}

const csrfClientIdRequestKey = Symbol.for("muhasib.csrfClientId");

export function csrfIdentifierCookieName(): string {
  return isProduction() ? "__Host-x-csrf-id" : "x-csrf-id";
}

function normalizeCookieValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return undefined;
  return trimmed;
}

function readCookieFromHeader(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (rawKey !== name) continue;

    const rawValue = rawValueParts.join("=");
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

const { generateCsrfToken, doubleCsrfProtection, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => env.SESSION_SECRET,
  getSessionIdentifier: (req) => resolveCsrfIdentifier(req),
  cookieName: isProduction() ? "__Host-x-csrf" : "x-csrf",
  cookieOptions: authCookieBaseOptions(),
  size: 32,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req) =>
    (req.headers["x-csrf-token"] as string | undefined) ||
    (req.headers["x-xsrf-token"] as string | undefined),
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

export function csrfErrorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  if (
    err === invalidCsrfTokenError ||
    err?.code === "EBADCSRFTOKEN" ||
    err?.code === invalidCsrfTokenError.code
  ) {
    log.warn({ msg: err?.message }, "CSRF token validation failed");
    if (csrfFailureStatus(req) === 401) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    res.status(403).json({
      message: "Invalid or missing CSRF token",
      code: "CSRF_INVALID",
    });
    return;
  }
  next(err);
}
