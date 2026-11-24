import { createHash } from "node:crypto";
import { AppError } from "../errors";

function unavailable() {
  return new AppError({
    statusCode: 503,
    code: "THROTTLE_UNAVAILABLE",
    message: "The request limit service is temporarily unavailable. Please try again later.",
  });
}

/** Upstash-compatible Redis REST transport for single commands. */
export class RedisThrottleClient {
  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  async command(...command: Array<string | number>): Promise<unknown> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(command),
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw unavailable();
      const body = (await response.json()) as { result?: unknown; error?: string };
      if (body.error || body.result === undefined) throw unavailable();
      return body.result;
    } catch {
      throw unavailable();
    }
  }
}

export function configuredThrottleRedis(): RedisThrottleClient | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const sharedRequired = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  if (url && token) {
    if (!URL.canParse(url) || (sharedRequired && new URL(url).protocol !== "https:")) {
      throw new Error("UPSTASH_REDIS_REST_URL must be a valid URL (HTTPS in production)");
    }
    return new RedisThrottleClient(url, token);
  }
  if (url || token || sharedRequired) {
    throw new Error(
      "Shared throttling requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN"
    );
  }
  return null;
}

// Sorted-set scores use Redis time so Function clock skew cannot shorten a lockout.
// Each script checks and updates a single bucket atomically.
const PRUNE = `
local key = KEYS[1]
local horizon = tonumber(ARGV[1])
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", key, "-inf", now - horizon)
`;

export const INCREMENT_WINDOW =
  PRUNE +
  `
local count = redis.call("ZCARD", key)
if count < tonumber(ARGV[2]) then
  redis.call("ZADD", key, now, ARGV[3])
  redis.call("PEXPIRE", key, horizon)
end
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
return { count + 1, tonumber(oldest[2]) + horizon }
`;

export const CHECK_LOCKOUT =
  PRUNE +
  `
local function retryAfter()
  local retry = 0
  for i = 3, #ARGV, 2 do
    local max = tonumber(ARGV[i])
    local window = tonumber(ARGV[i + 1])
    local hits = redis.call("ZRANGEBYSCORE", key, "(" .. (now - window), "+inf", "WITHSCORES")
    if #hits >= max * 2 then
      retry = math.max(retry, tonumber(hits[#hits - (max - 1) * 2]) + window - now)
    end
  end
  return retry
end
local retry = retryAfter()
local lockedNow = 0
if ARGV[2] ~= "" and retry == 0 then
  redis.call("ZADD", key, now, ARGV[2])
  redis.call("PEXPIRE", key, horizon)
  retry = retryAfter()
  if retry > 0 then lockedNow = 1 end
end
return { retry, redis.call("ZCARD", key), lockedNow }
`;

export const FIXED_WINDOW = `
local key = KEYS[1]
local count = tonumber(redis.call("GET", key)) or 0
if ARGV[2] == "peek" then return { count, 0 } end

local horizon = tonumber(ARGV[1])
local max = tonumber(ARGV[3])
if count == 0 then
  redis.call("SET", key, 1, "PX", horizon)
  return { 1, horizon }
end
if max == 0 or count < max then
  count = redis.call("INCR", key)
else
  count = count + 1
end
return { count, math.max(0, redis.call("PTTL", key)) }
`;

export class RedisThrottleBucket {
  constructor(
    private readonly redis: RedisThrottleClient,
    private readonly namespace: string,
    private readonly horizonMs: number
  ) {}

  private key(identity: string): string {
    return `muhasib:throttle:${this.namespace}:${createHash("sha256").update(identity).digest("hex")}`;
  }

  async eval(
    key: string,
    script: string,
    resultLength: number,
    ...args: Array<string | number>
  ): Promise<number[]> {
    const result = await this.redis.command(
      "EVAL",
      script,
      1,
      this.key(key),
      this.horizonMs,
      ...args
    );
    if (
      !Array.isArray(result) ||
      result.length !== resultLength ||
      !result.every((value) => Number.isSafeInteger(value) && value >= 0)
    ) {
      throw unavailable();
    }
    return result;
  }

  async refund(key: string, id: string): Promise<void> {
    await this.redis.command("ZREM", this.key(key), id);
  }

  async decrement(key: string): Promise<void> {
    await this.redis.command("ZPOPMAX", this.key(key));
  }

  async reset(key: string): Promise<void> {
    await this.redis.command("DEL", this.key(key));
  }
}
