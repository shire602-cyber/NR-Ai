import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { createLogger } from '../config/logger';

const log = createLogger('rate-limit');

/**
 * Sliding-window in-memory store for express-rate-limit.
 *
 * The default memory store is a fixed window: every `windowMs` the counter
 * resets, so a client can spend its entire budget at the end of one window
 * and the start of the next (a 2x burst). The sliding window approach below
 * keeps a rolling list of timestamps per key and counts how many fall inside
 * the last `windowMs` milliseconds, which smooths bursts and matches the
 * X-RateLimit-Remaining header semantics that clients expect.
 */
class SlidingWindowStore {
  windowMs!: number;
  prefix = '';
  private hits = new Map<string, number[]>();

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
    fresh.push(now);
    this.hits.set(key, fresh);

    // Reset time = oldest hit's expiry. If list is empty (just incremented to
    // length 1), reset is now + windowMs.
    const resetMs = (fresh[0] ?? now) + this.windowMs;
    return { totalHits: fresh.length, resetTime: new Date(resetMs) };
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

const compositeKey = (req: Request): string => {
  const userId = (req as any).user?.id as string | undefined;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return userId ? `${ip}:${userId}` : ip;
};

interface RouteLimit {
  windowMs: number;
  max: number;
  message: string;
  /** Routes where the limiter must NOT apply (e.g., GET-only views can be skipped). */
  skipMethods?: Array<'GET' | 'HEAD' | 'OPTIONS'>;
}

/**
 * Build a route-scoped sliding-window limiter. Stores state in memory; each
 * call returns its own store so independent counters don't bleed across
 * route groups (auth, ai, api, etc.).
 */
export function buildLimiter(cfg: RouteLimit) {
  const store = new SlidingWindowStore();
  store.startGc();
  return rateLimit({
    windowMs: cfg.windowMs,
    max: cfg.max,
    standardHeaders: 'draft-7', // RFC RateLimit-* + X-RateLimit-* headers
    legacyHeaders: false,
    keyGenerator: compositeKey,
    skip: (req) => {
      if (req.path === '/health' || req.path === '/health/live') return true;
      if (cfg.skipMethods?.includes(req.method as any)) return true;
      return false;
    },
    handler: (req, res, _next, options) => {
      const retryAfter = Math.ceil((options.windowMs as number) / 1000);
      log.warn(
        { ip: req.ip, userId: (req as any).user?.id, path: req.path, retryAfter },
        'Rate limit exceeded',
      );
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        message: cfg.message,
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: retryAfter },
      });
    },
    store,
  });
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
    windowMs: envInt('RL_API_WINDOW_MS', 60_000),
    max: envInt('RL_API_MAX', 100),
    message: 'Too many requests. Please try again later.',
  } as RouteLimit,
  auth: {
    windowMs: envInt('RL_AUTH_WINDOW_MS', 60_000),
    max: envInt('RL_AUTH_MAX', 5),
    message: 'Too many authentication attempts. Please wait 1 minute.',
  } as RouteLimit,
  ai: {
    windowMs: envInt('RL_AI_WINDOW_MS', 60_000),
    max: envInt('RL_AI_MAX', 20),
    message: 'AI rate limit exceeded. Please try again later.',
  } as RouteLimit,
  read: {
    // Relaxed for GET-heavy dashboards: 5x the api budget.
    windowMs: envInt('RL_READ_WINDOW_MS', 60_000),
    max: envInt('RL_READ_MAX', 500),
    message: 'Too many requests. Please try again later.',
  } as RouteLimit,
};
