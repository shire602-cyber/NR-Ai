import { configuredThrottleRedis, FIXED_WINDOW, RedisThrottleBucket } from "./redis-throttle";

/** Per-key counter whose window starts on the first hit. */
export class FixedWindowThrottle {
  private readonly windows = new Map<string, { count: number; expiresAt: number }>();
  private sweepAt = 0;

  constructor(private readonly namespace: string) {}

  async check(
    key: string,
    windowMs: number,
    mode: "peek" | "hit",
    max = 0,
    now = Date.now()
  ): Promise<{ count: number; remainingMs: number }> {
    const redis = configuredThrottleRedis();
    if (redis) {
      const bucket = new RedisThrottleBucket(redis, `http:${this.namespace}`, windowMs);
      const [count, remainingMs] = await bucket.eval(key, FIXED_WINDOW, 2, mode, max);
      return { count, remainingMs };
    }

    if (now >= this.sweepAt) {
      this.sweepAt = now + 60_000;
      for (const [id, window] of this.windows) {
        if (window.expiresAt <= now) this.windows.delete(id);
      }
    }
    const existing = this.windows.get(key);
    const window = existing && existing.expiresAt > now ? existing : undefined;
    if (mode === "peek") return { count: window?.count ?? 0, remainingMs: 0 };

    const count = (window?.count ?? 0) + 1;
    const expiresAt = window?.expiresAt ?? now + windowMs;
    if (!max || count <= max) this.windows.set(key, { count, expiresAt });
    return { count, remainingMs: expiresAt - now };
  }

  resetMemory(): void {
    this.windows.clear();
    this.sweepAt = 0;
  }
}
