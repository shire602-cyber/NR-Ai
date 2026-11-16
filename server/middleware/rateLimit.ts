import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { getAccessTokenFromRequest } from "../services/auth-cookies.service";

const log = createLogger("rate-limit");

/**
 * Sliding-window in-memory store for express-rate-limit.
 *
 * The default memory store is a fixed window: every `windowMs` the counter
 * resets, so a client can spend its entire budget at the end of one window
 * and the start of the next (a 2x burst). The sliding window approach below
 * keeps a rolling list of timestamps per key and counts how many fall inside
 * the last `windowMs` milliseconds.
 *
 * R17-06: a request that is already over the limit is NOT recorded. The old
 * store pushed a timestamp for every hit, so a client that kept retrying
 * while throttled kept itself throttled forever. Now the budget recovers as
 * soon as the oldest accepted hit leaves the window, however often the
 * client retries in the meantime.
 */
export class SlidingWindowStore {
  windowMs!: number;
  prefix = "";
  private hits = new Map<string, number[]>();

  constructor(private readonly max?: number) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<{
    totalHits: number;
    resetTime: Date;
  }> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const arr = this.hits.get(key) || [];
    // Drop timestamps that fell out of the window
    const fresh = arr.filter((t) => t > cutoff);
    const overLimit = this.max !== undefined && fresh.length >= this.max;
    if (!overLimit) fresh.push(now);
    if (fresh.length) this.hits.set(key, fresh);
    else this.hits.delete(key);

    // Reset time = when the oldest counted hit expires.
    const resetMs = (fresh[0] ?? now) + this.windowMs;
    return {
      totalHits: overLimit ? fresh.length + 1 : fresh.length,
      resetTime: new Date(resetMs),
    };
  }

  async decrement(key: string): Promise<void> {
    const arr = this.hits.get(key);
    if (!arr || arr.length === 0) return;
    arr.pop();
    if (arr.length === 0) this.hits.delete(key);
  }

  async resetKey(key: string): Promise<void> {
    this.hits.delete(key);
  }

  async resetAll(): Promise<void> {
    this.hits.clear();
  }

  /** Number of keys currently tracked (tests: bucket fan-out). */
  size(): number {
    return this.hits.size;
  }

  // Periodic GC so the map cannot grow forever for ephemeral keys.
  startGc(intervalMs = 60_000): NodeJS.Timeout {
    const t = setInterval(() => {
      const cutoff = Date.now() - this.windowMs;
      for (const [k, arr] of this.hits) {
        const fresh = arr.filter((t) => t > cutoff);
        if (fresh.length === 0) this.hits.delete(k);
        else if (fresh.length !== arr.length) this.hits.set(k, fresh);
      }
    }, intervalMs);
    t.unref?.();
    return t;
  }
}

// ─── Request identity (R01-10) ──────────────────────────────────────────────

export type RateLimitIdentity =
  | { kind: "user"; userId: string; companyId: string | null; key: string }
  | { kind: "ip"; ip: string; key: string };

const IDENTITY = Symbol.for("muhasib.rateLimitIdentity");

export function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function companyIdFromRequest(req: Request): string | null {
  const url = req.originalUrl || req.url || "";
  const m = /^\/api\/companies\/([0-9a-fA-F-]{36})(?:[/?#]|$)/.exec(url);
  if (m) return m[1].toLowerCase();
  const q = (req.query as Record<string, unknown> | undefined)?.companyId;
  return typeof q === "string" && q ? q : null;
}

/**
 * Who a request counts against. The general limiters run before body parsing
 * and before the route's authMiddleware, so the identity is derived here: a
 * request that carries a correctly signed ACCESS token counts against
 * `userId:companyId` (users behind one office NAT get independent budgets);
 * everything else (anonymous, forged, refresh-token-as-bearer) counts against
 * the client IP. Signature verification is a local HMAC check; revocation is
 * still enforced later by authMiddleware.
 */
export function rateLimitIdentity(req: Request): RateLimitIdentity {
  const slots = req as unknown as Record<symbol, RateLimitIdentity | undefined>;
  const cached = slots[IDENTITY];
  if (cached) return cached;
  let identity: RateLimitIdentity | null = null;
  const header = req.headers.authorization;
  const token =
    getAccessTokenFromRequest(req) || (header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (token) {
    try {
      const decoded = jwt.verify(token, getEnv().JWT_SECRET) as {
        userId?: unknown;
        type?: unknown;
      };
      if (decoded.type === "access" && typeof decoded.userId === "string") {
        const companyId = companyIdFromRequest(req);
        identity = {
          kind: "user",
          userId: decoded.userId,
          companyId,
          key: `u:${decoded.userId}:${companyId ?? "-"}`,
        };
      }
    } catch {
      /* invalid or expired: falls back to the IP bucket */
    }
  }
  if (!identity) {
    const ip = clientIp(req);
    identity = { kind: "ip", ip, key: `ip:${ip}` };
  }
  slots[IDENTITY] = identity;
  return identity;
}

/** Default limiter key: per user+company when authenticated, else per IP. */
export const compositeKey = (req: Request): string => rateLimitIdentity(req).key;

interface RouteLimit {
  windowMs: number;
  max: number;
  message: string;
  /** Routes where the limiter must NOT apply (e.g., GET-only views can be skipped). */
  skipMethods?: Array<"GET" | "HEAD" | "OPTIONS">;
  /** Custom escape hatch — return true to exempt a request from this limiter. */
  skipIf?: (req: Request) => boolean;
  keyGenerator?: (req: Request) => string;
  /** Decrement the hit after successful responses. Useful for failed-login throttles. */
  skipSuccessfulRequests?: boolean;
}

/**
 * Build a route-scoped sliding-window limiter. Stores state in memory; each
 * call returns its own store so independent counters don't bleed across
 * route groups (auth, ai, api, etc.).
 */
export function buildLimiter(cfg: RouteLimit) {
  const store = new SlidingWindowStore(cfg.max);
  store.startGc();
  const limiter = rateLimit({
    windowMs: cfg.windowMs,
    max: cfg.max,
    standardHeaders: "draft-7", // RFC RateLimit-* + X-RateLimit-* headers
    legacyHeaders: false,
    keyGenerator: cfg.keyGenerator ?? compositeKey,
    skipSuccessfulRequests: cfg.skipSuccessfulRequests ?? false,
    // We validate trust proxy ourselves (configureTrustProxy) and key on
    // more than the IP; silence express-rate-limit's IP heuristics.
    validate: false,
    skip: (req) => {
      if (req.path === "/health" || req.path === "/health/live") return true;
      if ((cfg.skipMethods as string[] | undefined)?.includes(req.method)) return true;
      if (cfg.skipIf?.(req)) return true;
      return false;
    },
    handler: (req, res, _next, options) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit
        ?.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil((options.windowMs as number) / 1000);
      log.warn(
        {
          ip: req.ip,
          key: rateLimitIdentity(req).key,
          path: req.path,
          retryAfter,
          resetTime: resetTime?.toISOString(),
        },
        "Rate limit exceeded"
      );
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        message: cfg.message,
        code: "RATE_LIMITED",
        details: { retryAfterSeconds: retryAfter },
      });
    },
    store,
  });
  return Object.assign(limiter, { store });
}

/**
 * Default route limit profiles. Tweakable per env without code changes.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const limiterProfiles = {
  api: {
    windowMs: envInt("RL_API_WINDOW_MS", 60_000),
    max: envInt("RL_API_MAX", 100),
    message: "Too many requests. Please try again later.",
  } as RouteLimit,
  auth: {
    windowMs: envInt("RL_AUTH_WINDOW_MS", 60_000),
    max: envInt("RL_AUTH_MAX", 5),
    message: "Too many authentication attempts. Please wait 1 minute.",
  } as RouteLimit,
  authOAuth: {
    windowMs: envInt("RL_AUTH_OAUTH_WINDOW_MS", 5 * 60_000),
    max: envInt("RL_AUTH_OAUTH_MAX", 30),
    message: "Too many social login attempts. Please try again shortly.",
  } as RouteLimit,
  ai: {
    windowMs: envInt("RL_AI_WINDOW_MS", 60_000),
    max: envInt("RL_AI_MAX", 20),
    message: "AI rate limit exceeded. Please try again later.",
  } as RouteLimit,
  read: {
    // GET-heavy dashboards fire 8-15 requests per page view, so the ceiling
    // must sit well above real navigation and report review. The key is
    // `userId:companyId` for authenticated traffic (rateLimitIdentity), so
    // this budget is per user, not per office.
    windowMs: envInt("RL_READ_WINDOW_MS", 60_000),
    max: envInt("RL_READ_MAX", 600),
    message: "Too many requests. Please try again later.",
  } as RouteLimit,
};

// ─── Progressive lockout for credential endpoints (R01-12) ─────────────────

export interface LockoutRule {
  max: number;
  windowMs: number;
}

export interface LockoutStatus {
  locked: boolean;
  retryAfterMs: number;
  failures: number;
}

/**
 * Counts failures per key and locks the key while any rule is exceeded:
 * by default 5 failures in 15 minutes, then 10 failures in 1 hour. Attempts
 * made while locked are rejected without being recorded, so retrying does not
 * extend the lockout; a success clears the key.
 */
export class LockoutTracker {
  private failures = new Map<string, number[]>();
  private readonly horizonMs: number;

  constructor(readonly rules: LockoutRule[]) {
    this.horizonMs = Math.max(...rules.map((r) => r.windowMs));
  }

  private fresh(key: string, now: number): number[] {
    const arr = (this.failures.get(key) ?? []).filter((t) => t > now - this.horizonMs);
    if (arr.length) this.failures.set(key, arr);
    else this.failures.delete(key);
    return arr;
  }

  status(key: string, now = Date.now()): LockoutStatus {
    const arr = this.fresh(key, now);
    let retryAfterMs = 0;
    for (const rule of this.rules) {
      const inWindow = arr.filter((t) => t > now - rule.windowMs);
      if (inWindow.length >= rule.max) {
        // Unlocks when enough failures leave the window to drop below max.
        const unlockAt = inWindow[inWindow.length - rule.max] + rule.windowMs;
        retryAfterMs = Math.max(retryAfterMs, unlockAt - now);
      }
    }
    return { locked: retryAfterMs > 0, retryAfterMs, failures: arr.length };
  }

  /** Record a failure; returns the status after recording. */
  recordFailure(key: string, now = Date.now()): LockoutStatus & { lockedNow: boolean } {
    const before = this.status(key, now);
    const arr = this.fresh(key, now);
    arr.push(now);
    this.failures.set(key, arr);
    const after = this.status(key, now);
    return { ...after, lockedNow: after.locked && !before.locked };
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  resetAll(): void {
    this.failures.clear();
  }
}

export function loginLockoutRules(): LockoutRule[] {
  return [
    {
      max: envInt("RL_LOGIN_LOCK_MAX", 5),
      windowMs: envInt("RL_LOGIN_LOCK_WINDOW_MS", 15 * 60_000),
    },
    {
      max: envInt("RL_LOGIN_LOCK_LONG_MAX", 10),
      windowMs: envInt("RL_LOGIN_LOCK_LONG_WINDOW_MS", 60 * 60_000),
    },
  ];
}

/** email+IP key for credential endpoints. */
export function credentialKey(req: Request, email: unknown): string {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return `${normalized || "unknown"}|${clientIp(req)}`;
}
