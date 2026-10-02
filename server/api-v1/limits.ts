/**
 * Per-key rate limits: requests per minute (sliding window) and per UTC day.
 * In-process, like the house limiter; a multi-instance deployment would move
 * the counters to Postgres. Draft-7 `RateLimit` plus the split `RateLimit-*`
 * headers are sent on every response.
 */
import type { NextFunction, Request, Response } from "express";
import { ctx } from "./context";
import { errorEnvelope } from "./response";

const MINUTE_MS = 60_000;
const minuteHits = new Map<string, number[]>();
const dayCounts = new Map<string, { day: string; count: number }>();

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const secondsToUtcMidnight = (t: number) => {
  const next = new Date(t);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - t) / 1000));
};

const gc = setInterval(() => {
  const cutoff = Date.now() - MINUTE_MS;
  for (const [k, arr] of minuteHits) {
    const fresh = arr.filter((t) => t > cutoff);
    if (fresh.length) minuteHits.set(k, fresh);
    else minuteHits.delete(k);
  }
  const today = utcDay(Date.now());
  for (const [k, v] of dayCounts) if (v.day !== today) dayCounts.delete(k);
}, MINUTE_MS);
gc.unref?.();

function setHeaders(res: Response, limit: number, remaining: number, resetSeconds: number) {
  res.setHeader("RateLimit-Policy", `${limit};w=60`);
  res.setHeader("RateLimit", `limit=${limit}, remaining=${remaining}, reset=${resetSeconds}`);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader("RateLimit-Reset", String(resetSeconds));
}

export function perKeyLimiter(req: Request, res: Response, next: NextFunction): void {
  const c = ctx(req);
  const now = Date.now();

  const day = utcDay(now);
  const dayRec = dayCounts.get(c.keyId);
  const dayCount = dayRec && dayRec.day === day ? dayRec.count : 0;
  if (dayCount >= c.ratePerDay) {
    const retry = secondsToUtcMidnight(now);
    setHeaders(res, c.ratePerMinute, 0, retry);
    res.setHeader("Retry-After", String(retry));
    res.status(429).json(
      errorEnvelope(req, 429, "RATE_LIMITED", "Daily request limit reached for this API key", {
        limit: c.ratePerDay,
        window: "day",
        retryAfterSeconds: retry,
      })
    );
    return;
  }

  const arr = (minuteHits.get(c.keyId) ?? []).filter((t) => t > now - MINUTE_MS);
  if (arr.length >= c.ratePerMinute) {
    const retry = Math.max(1, Math.ceil((arr[0] + MINUTE_MS - now) / 1000));
    minuteHits.set(c.keyId, arr);
    setHeaders(res, c.ratePerMinute, 0, retry);
    res.setHeader("Retry-After", String(retry));
    res.status(429).json(
      errorEnvelope(req, 429, "RATE_LIMITED", "Too many requests for this API key", {
        limit: c.ratePerMinute,
        window: "minute",
        retryAfterSeconds: retry,
      })
    );
    return;
  }

  arr.push(now);
  minuteHits.set(c.keyId, arr);
  dayCounts.set(c.keyId, { day, count: dayCount + 1 });
  setHeaders(res, c.ratePerMinute, c.ratePerMinute - arr.length, Math.max(1, Math.ceil((arr[0] + MINUTE_MS - now) / 1000)));
  next();
}

// ── Unauthenticated callers: a small per-IP failure budget so key guessing is throttled ──
const FAIL_LIMIT_PER_MINUTE = 30;
const failHits = new Map<string, number[]>();

/** Records a failed authentication; returns true while the IP is still within budget. */
export function recordAuthFailure(ip: string): boolean {
  const now = Date.now();
  const arr = (failHits.get(ip) ?? []).filter((t) => t > now - MINUTE_MS);
  arr.push(now);
  failHits.set(ip, arr);
  return arr.length <= FAIL_LIMIT_PER_MINUTE;
}

export function authFailureRetryAfter(ip: string): number {
  const arr = failHits.get(ip) ?? [];
  return arr.length ? Math.max(1, Math.ceil((arr[0] + MINUTE_MS - Date.now()) / 1000)) : 60;
}

/** Test hook. */
export function __resetLimitsForTests(): void {
  minuteHits.clear();
  dayCounts.clear();
  failHits.clear();
}
