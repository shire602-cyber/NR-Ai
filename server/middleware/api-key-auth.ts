/**
 * Public API key authentication (W5-B, R19-01, R19-15).
 *
 * Keys are issued by /api/companies/:companyId/api-keys as `muh_<64 hex>`.
 * Only the SHA-256 hash and the first 8 hex characters (the indexed
 * `key_prefix`) are stored. A request is authenticated by:
 *
 *   Authorization: ApiKey muh_...      (preferred)
 *   X-API-Key: muh_...
 *   Authorization: Bearer muh_...      (accepted on /api/v1 only)
 *
 * The key binds the request to ONE company and a set of scopes. Keys are
 * accepted only on /api/v1; every other route is session/JWT-only and a
 * request carrying an API key there is refused with 401 API_KEY_NOT_ACCEPTED
 * (`rejectApiKeysOutsidePublicApi`, mounted in server/routes.ts).
 */
import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pq } from "../services/connectors/pq";
import { createLogger } from "../config/logger";
import { billingEnforced, companyPlanId, getTierFeatures } from "./featureGate";

const log = createLogger("api-key-auth");

export const API_KEY_PREFIX = "muh_";

/** Scope catalogue. Adding one is an API change: document it in docs/api/README.md. */
export const API_SCOPES = [
  "read:invoices",
  "write:invoices",
  "read:contacts",
  "write:contacts",
  "read:bills",
  "read:payments",
  "write:payments",
  "read:accounts",
  "read:reports",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const SCOPE_SET = new Set<string>(API_SCOPES);

/** Legacy keys stored "read" / "write" / "read,write" before scopes existed. */
export function expandScopes(raw: string | null | undefined): ApiScope[] {
  const out = new Set<ApiScope>();
  for (const token of String(raw ?? "")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)) {
    if (token === "read" || token === "read:*") {
      for (const s of API_SCOPES) if (s.startsWith("read:")) out.add(s);
    } else if (token === "write" || token === "write:*" || token === "*") {
      for (const s of API_SCOPES) out.add(s);
    } else if (SCOPE_SET.has(token)) {
      out.add(token as ApiScope);
    }
  }
  return API_SCOPES.filter((s) => out.has(s)); // catalogue order
}

export interface ApiKeyContext {
  id: string;
  companyId: string;
  scopes: ApiScope[];
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by apiKeyAuth on /api/v1 requests. */
      apiKey?: ApiKeyContext;
    }
  }
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Generate a new key: the raw secret (shown once), its prefix and hash. */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const secret = crypto.randomBytes(32).toString("hex");
  return {
    raw: `${API_KEY_PREFIX}${secret}`,
    prefix: secret.slice(0, 8),
    hash: hashApiKey(secret),
  };
}

/** The raw key carried by a request, or null. */
export function readApiKey(req: Request): string | null {
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = /^ApiKey\s+(\S+)$/i.exec(auth.trim());
    if (m) return m[1];
    const b = /^Bearer\s+(muh_\S+)$/i.exec(auth.trim());
    if (b) return b[1];
  }
  return null;
}

/** True when the request presents an API key in any accepted form. */
export function carriesApiKey(req: Request): boolean {
  if (typeof req.headers["x-api-key"] === "string") return true;
  const auth = req.headers.authorization;
  return typeof auth === "string" && /^(ApiKey\s|Bearer\s+muh_)/i.test(auth.trim());
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

interface KeyRow {
  id: string;
  company_id: string;
  name: string;
  key_hash: string;
  scopes: string;
  is_active: boolean;
  expires_at: Date | null;
  revoked_at: Date | null;
  rate_limit_per_minute: number;
}

// ─── Per-key rate limit (fixed one-minute window, in-process) ───────────────

const windows = new Map<string, { start: number; count: number }>();

/** Returns seconds until the window resets when over the limit, else 0. */
export function takeRateToken(keyId: string, limitPerMinute: number, now = Date.now()): number {
  const limit = Math.max(1, limitPerMinute || 1);
  const w = windows.get(keyId);
  if (!w || now - w.start >= 60_000) {
    windows.set(keyId, { start: now, count: 1 });
    return 0;
  }
  if (w.count >= limit) return Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000));
  w.count += 1;
  return 0;
}

/** Tests only. */
export function __resetApiKeyRateLimits(): void {
  windows.clear();
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ message, code });
}

/**
 * Authenticate an API key. Sets req.apiKey; answers 401 / 403 / 429 itself.
 */
export const apiKeyAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  (async () => {
    const raw = readApiKey(req);
    if (!raw) {
      return fail(
        res,
        401,
        "API_KEY_REQUIRED",
        "Send an API key as 'Authorization: ApiKey <key>' or 'X-API-Key: <key>'."
      );
    }
    const secret = raw.startsWith(API_KEY_PREFIX) ? raw.slice(API_KEY_PREFIX.length) : raw;
    if (!/^[0-9a-f]{64}$/i.test(secret)) {
      return fail(res, 401, "API_KEY_INVALID", "Invalid API key");
    }
    const prefix = secret.slice(0, 8).toLowerCase();
    const hash = hashApiKey(secret.toLowerCase());
    const { rows } = await pq<KeyRow>(
      `SELECT id, company_id, name, key_hash, scopes, is_active, expires_at, revoked_at,
              rate_limit_per_minute
         FROM api_keys WHERE key_prefix = $1`,
      [prefix]
    );
    const key = rows.find((r) => safeEqualHex(r.key_hash, hash));
    if (!key || !key.is_active || key.revoked_at) {
      return fail(res, 401, "API_KEY_INVALID", "Invalid or revoked API key");
    }
    if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
      return fail(res, 401, "API_KEY_EXPIRED", "This API key has expired");
    }

    const retryAfter = takeRateToken(key.id, key.rate_limit_per_minute);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      return fail(res, 429, "API_KEY_RATE_LIMITED", "Rate limit for this API key exceeded");
    }

    // Plan gate: the public API is the `apiAccess` feature (same matrix as the pricing page).
    if (billingEnforced()) {
      // Fails closed (S5): no subscription row = Free; null only for firm-billed client books.
      const planId = await companyPlanId(key.company_id);
      if (planId !== null && !getTierFeatures(planId).apiAccess) {
        res.status(403).json({
          message: "Upgrade required to use the public API",
          code: "TIER_LOCKED",
          feature: "apiAccess",
          currentTier: planId,
        });
        return;
      }
    }

    await pq(
      `UPDATE api_keys SET last_used_at = now()
          WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '30 seconds')`,
      [key.id]
    ).catch((err: unknown) => log.warn({ err, keyId: key.id }, "last_used_at update failed"));

    req.apiKey = {
      id: key.id,
      companyId: key.company_id,
      scopes: expandScopes(key.scopes),
      name: key.name,
    };
    next();
  })().catch(next);
};

/** Route guard: the authenticated key must hold `scope` (403 INSUFFICIENT_SCOPE). */
export function requireScope(scope: ApiScope): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.apiKey;
    if (!key) return fail(res, 401, "API_KEY_REQUIRED", "API key required");
    if (!key.scopes.includes(scope)) {
      res.status(403).json({
        message: `This API key lacks the '${scope}' scope`,
        code: "INSUFFICIENT_SCOPE",
        details: { required: scope, granted: key.scopes },
      });
      return;
    }
    next();
  };
}

/**
 * Mounted on /api before every route module: API keys authenticate /api/v1
 * only. Anywhere else a key is refused outright instead of falling through to
 * a confusing JWT error.
 */
export const rejectApiKeysOutsidePublicApi: RequestHandler = (req, res, next) => {
  if (!carriesApiKey(req)) return next();
  const path = req.path.startsWith("/api/") ? req.path.slice(4) : req.path;
  if (path === "/v1" || path.startsWith("/v1/")) return next();
  fail(
    res,
    401,
    "API_KEY_NOT_ACCEPTED",
    "API keys are accepted on /api/v1 only; this route requires a signed-in session."
  );
};
