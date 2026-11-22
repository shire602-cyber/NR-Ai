import { randomUUID } from "crypto";
import { doubleCsrf } from "csrf-csrf";
import type { Request, Response, NextFunction } from "express";
import { getEnv, isProduction } from "../config/env";
import { createLogger } from "../config/logger";
import { authCookieBaseOptions } from "../config/cookies";
import { errorCode, errorMessage } from "../errors";

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
  // W5-E: pre-session steps authenticated by their own single-use token.
  /^\/api\/auth\/mfa\/verify-login$/,
  /^\/api\/auth\/verify-email$/,
  // Customer-facing portal endpoints only (the token in the path, or the OTP sign-in). The
  // cookie-authenticated STAFF routes under /api/portal/ (generate-access, revoke-access,
  // contacts/*) are NOT exempt and need X-CSRF-Token.
  /^\/api\/portal\/login\/(request|verify)$/,
  /^\/api\/portal\/[0-9a-f]{64}(\/|$)/i,
  // Other single-purpose public links: the signed token is in the path (e-invoicing approver,
  // hosted payment link).
  /^\/api\/portal\/einvoicing-approve\/[^/]+(\/|$)/,
  /^\/api\/portal\/pay\/[^/]+$/,
  /^\/api\/portal\/public-invoices\/[^/]+\/pay$/,
  // Provider webhooks are authenticated by their own HMAC signature, not a CSRF
  // token (the caller is an external service, not the browser).
  /^\/api\/webhooks\/email-intake$/,
  /^\/api\/webhooks\/stripe$/,
  /^\/api\/webhooks\/einvoice\/[^/]+\/inbound$/, // W4-C: HMAC-signed ASP delivery
  /^\/api\/webhooks\/einvoice\/acube\/(sandbox|production)(?:\/[0-9a-f-]{36})?$/i, // E1: Ed25519-signed A-Cube events
  /^\/api\/webhooks\/einvoice\/complyance\/(sandbox|production)(?:\/[0-9a-f-]{36})?$/i, // E2: HMAC-signed Complyance events
  // W4-D: invoice payment gateways and email delivery events (signed by the provider).
  /^\/api\/webhooks\/invoice-payments\/[a-z]+$/,
  /^\/api\/webhooks\/email-events\/[a-z-]+$/,
  // W5-B: the public API authenticates by API key only (never cookies).
  /^\/api\/v1\//,
  // Client-side error telemetry sink: a fire-and-forget endpoint that returns
  // 204 and takes no state-changing action. It MUST accept reports even when
  // the app is broken (e.g. a chunk failed to load before a CSRF token was
  // ever fetched) — otherwise production errors are silently dropped exactly
  // when we most need them.
  /^\/api\/client-errors$/,
];

/** True when a state-changing request to `path` skips the CSRF check (public or signed endpoints). */
export function isCsrfExemptPath(path: string): boolean {
  return CSRF_BEARER_EXEMPT.some((rx) => rx.test(path));
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

export function readCsrfIdentifierCookie(req: Request): string | undefined {
  const name = csrfIdentifierCookieName();
  const parsed = normalizeCookieValue(req.cookies?.[name]);
  return parsed || readCookieFromHeader(req, name);
}

export function resolveCsrfIdentifier(req: Request, res?: Response): string {
  const slots = req as unknown as Record<symbol, string | undefined>;
  const existingRequestId = normalizeCookieValue(slots[csrfClientIdRequestKey]);
  if (existingRequestId) return existingRequestId;

  const existingCookieId = readCsrfIdentifierCookie(req);
  if (existingCookieId) {
    slots[csrfClientIdRequestKey] = existingCookieId;
    return existingCookieId;
  }

  const generated = randomUUID();
  slots[csrfClientIdRequestKey] = generated;

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
    return isCsrfExemptPath(req.path);
  },
});

export const csrfProtection = doubleCsrfProtection;

export function csrfTokenHandler(req: Request, res: Response): void {
  resolveCsrfIdentifier(req, res);
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
}

export function csrfErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (
    err === invalidCsrfTokenError ||
    errorCode(err) === "EBADCSRFTOKEN" ||
    errorCode(err) === invalidCsrfTokenError.code
  ) {
    log.warn({ msg: errorMessage(err) }, "CSRF token validation failed");
    res.status(403).json({
      message: "Invalid or missing CSRF token",
      code: "CSRF_INVALID",
    });
    return;
  }
  next(err);
}
