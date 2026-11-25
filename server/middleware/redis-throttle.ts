import { createHash } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { AppError } from "../errors";

function unavailable() {
  return new AppError({
    statusCode: 503,
    code: "THROTTLE_UNAVAILABLE",
    message: "The request limit service is temporarily unavailable. Please try again later.",
  });
}

const COMMAND_TIMEOUT_MS = 3000;

function encodeResp(command: Array<string | number>): Buffer {
  const chunks: Buffer[] = [Buffer.from("*" + command.length + "\r\n")];
  for (const part of command) {
    const value = Buffer.from(String(part), "utf8");
    chunks.push(Buffer.from("$" + value.length + "\r\n"), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(chunks);
}

function decodeResp(buf: Buffer, offset = 0): { value: unknown; rest: number } | null {
  if (offset >= buf.length) return null;
  const nl = buf.indexOf("\r\n", offset);
  if (nl === -1) return null;
  const type = buf[offset];
  if (type === 43) return { value: buf.toString("utf8", offset + 1, nl), rest: nl + 2 };
  if (type === 45) return { value: new Error(buf.toString("utf8", offset + 1, nl)), rest: nl + 2 };
  if (type === 58) return { value: Number(buf.toString("utf8", offset + 1, nl)), rest: nl + 2 };
  if (type === 36) {
    const len = Number(buf.toString("utf8", offset + 1, nl));
    if (len === -1) return { value: null, rest: nl + 2 };
    const start = nl + 2;
    const end = start + len;
    if (buf.length < end + 2) return null;
    return { value: buf.toString("utf8", start, end), rest: end + 2 };
  }
  if (type === 42) {
    const count = Number(buf.toString("utf8", offset + 1, nl));
    if (count === -1) return { value: null, rest: nl + 2 };
    let cursor = nl + 2;
    const items: unknown[] = [];
    for (let i = 0; i < count; i += 1) {
      const next = decodeResp(buf, cursor);
      if (!next) return null;
      items.push(next.value);
      cursor = next.rest;
    }
    return { value: items, rest: cursor };
  }
  throw new Error("unsupported RESP type");
}

export interface ParsedRedisUrl {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  db: number | null;
  useTls: boolean;
}

/** Shared command surface for the Upstash REST client and the TCP REDIS_URL client. */
export interface ThrottleRedis {
  command(...command: Array<string | number>): Promise<unknown>;
}

export function parseRedisUrl(raw: string): ParsedRedisUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
  }
  const dbRaw = parsed.pathname.replace(/^\//, "");
  const db = dbRaw === "" ? null : Number(dbRaw);
  if (db !== null && (!Number.isInteger(db) || db < 0)) {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
  }
  const host =
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  if (host === "") {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
  }
  return {
    host,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === "rediss:" ? 6380 : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : null,
    password: parsed.password ? decodeURIComponent(parsed.password) : null,
    db,
    useTls: parsed.protocol === "rediss:",
  };
}

type ConnectPhase = "idle" | "connecting" | "ready" | "retired";

export class RedisUrlThrottleClient implements ThrottleRedis {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private phase: ConnectPhase = "idle";
  /** In-flight handshake. Present only while `phase` is `connecting`. */
  private connecting: Promise<void> | null = null;
  private settleConnect: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(private readonly redisUrl: string) {}

  /**
   * Terminal. Drops the socket, including a TLS handshake that has not finished,
   * rejects every waiter, and never opens another connection.
   */
  close(): void {
    if (this.phase === "retired") return;
    this.phase = "retired";
    this.stopSocket();
    this.failWaiters(new Error("closed"));
  }

  async command(...command: Array<string | number>): Promise<unknown> {
    if (this.phase === "retired") throw unavailable();
    try {
      await this.ensureConnected();
      if (this.phase !== "ready") throw new Error("closed");
      return await this.rawCommand(...command);
    } catch {
      if (this.phase === "ready") this.loseSocket(new Error("unavailable"));
      throw unavailable();
    }
  }

  private ensureConnected(): Promise<void> {
    if (this.phase === "retired") return Promise.reject(new Error("closed"));
    if (this.phase === "ready") return Promise.resolve();
    if (this.phase === "connecting" && this.connecting) return this.connecting;
    return this.beginConnect();
  }

  private beginConnect(): Promise<void> {
    const target = parseRedisUrl(this.redisUrl);
    this.phase = "connecting";
    let resolveConnect: () => void = () => {};
    let rejectConnect: (error: Error) => void = () => {};
    this.connecting = new Promise<void>((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
    });
    this.settleConnect = { resolve: resolveConnect, reject: rejectConnect };
    const socket = target.useTls
      ? tls.connect({
          host: target.host,
          port: target.port,
          servername: net.isIP(target.host) ? undefined : target.host,
        })
      : net.connect({ host: target.host, port: target.port });
    this.socket = socket;
    socket.setNoDelay(true);
    const readyEvent = target.useTls ? "secureConnect" : "connect";
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && this.phase === "connecting") {
        this.loseSocket(new Error("timeout"));
      }
    }, COMMAND_TIMEOUT_MS);
    socket.on("data", (chunk: Buffer) => {
      if (this.socket === socket) this.onData(chunk);
    });
    socket.on("error", (error: Error) => {
      if (this.socket === socket && this.phase !== "idle" && this.phase !== "retired") {
        this.loseSocket(error);
      }
    });
    socket.on("close", () => {
      if (this.socket === socket && this.phase !== "idle" && this.phase !== "retired") {
        this.loseSocket(new Error("closed"));
      }
    });
    socket.once(readyEvent, () => {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      if (this.phase !== "connecting" || this.socket !== socket) return;
      void this.finishConnect(target);
    });
    return this.connecting;
  }

  private async finishConnect(target: ParsedRedisUrl): Promise<void> {
    try {
      await this.handshake(target);
    } catch (error) {
      if (this.phase === "connecting") {
        this.loseSocket(error instanceof Error ? error : new Error("closed"));
      }
      return;
    }
    if (this.phase !== "connecting") return;
    this.phase = "ready";
    const settle = this.settleConnect;
    this.settleConnect = null;
    this.connecting = null;
    settle?.resolve();
  }

  private async handshake(target: ParsedRedisUrl) {
    if (this.phase !== "connecting") throw new Error("closed");
    if (target.password) {
      const reply = target.username
        ? await this.rawCommand("AUTH", target.username, target.password)
        : await this.rawCommand("AUTH", target.password);
      if (reply !== "OK") throw new Error("AUTH failed");
    }
    if (this.phase !== "connecting") throw new Error("closed");
    if (target.db != null && target.db !== 0) {
      const reply = await this.rawCommand("SELECT", String(target.db));
      if (reply !== "OK") throw new Error("SELECT failed");
    }
  }

  /** Connection failed or dropped. A later command may try again unless `close` already ran. */
  private loseSocket(error: Error): void {
    if (this.phase === "idle" || this.phase === "retired") return;
    this.phase = "idle";
    this.stopSocket();
    this.failWaiters(error);
  }

  private stopSocket(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    if (!socket) return;
    socket.removeAllListeners();
    socket.on("error", () => {});
    socket.destroy();
  }

  private failWaiters(error: Error): void {
    const settle = this.settleConnect;
    this.settleConnect = null;
    this.connecting = null;
    const waiting = this.pending.splice(0);
    settle?.reject(error);
    for (const item of waiting) item.reject(error);
  }

  private rawCommand(...command: Array<string | number>): Promise<unknown> {
    const socket = this.socket;
    if (!socket || this.phase === "idle" || this.phase === "retired") {
      return Promise.reject(new Error("closed"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.loseSocket(new Error("timeout")), COMMAND_TIMEOUT_MS);
      this.pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          if (value instanceof Error) reject(value);
          else resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.write(encodeResp(command), (error) => {
        if (error) this.loseSocket(error);
      });
    });
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.pending.length > 0) {
      let decoded: { value: unknown; rest: number } | null;
      try {
        decoded = decodeResp(this.buffer, 0);
      } catch (error) {
        this.loseSocket(error instanceof Error ? error : new Error("invalid RESP"));
        return;
      }
      if (!decoded) return;
      this.buffer = this.buffer.subarray(decoded.rest);
      this.pending.shift()?.resolve(decoded.value);
    }
  }
}

/** Upstash-compatible Redis REST transport for single commands. */
export class RedisThrottleClient implements ThrottleRedis {
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

let activeThrottle: { key: string; client: ThrottleRedis } | null = null;

function retireActiveThrottle(): void {
  const previous = activeThrottle;
  activeThrottle = null;
  if (previous?.client instanceof RedisUrlThrottleClient) previous.client.close();
}

function useActiveThrottle(key: string, create: () => ThrottleRedis): ThrottleRedis {
  if (activeThrottle?.key === key) return activeThrottle.client;
  retireActiveThrottle();
  const client = create();
  activeThrottle = { key, client };
  return client;
}

function rejectThrottleConfig(error: Error): never {
  retireActiveThrottle();
  throw error;
}

export function configuredThrottleRedis(): ThrottleRedis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const redisUrl = process.env.REDIS_URL?.trim();
  const sharedRequired = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  const missing = new Error(
    "Shared throttling requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or REDIS_URL"
  );
  if (url && token) {
    if (!URL.canParse(url) || (sharedRequired && new URL(url).protocol !== "https:")) {
      return rejectThrottleConfig(
        new Error("UPSTASH_REDIS_REST_URL must be a valid URL (HTTPS in production)")
      );
    }
    return useActiveThrottle(`upstash:${url}:${token}`, () => new RedisThrottleClient(url, token));
  }
  if (url || token) return rejectThrottleConfig(missing);
  if (redisUrl) {
    try {
      parseRedisUrl(redisUrl);
    } catch (error) {
      return rejectThrottleConfig(
        error instanceof Error
          ? error
          : new Error("REDIS_URL must be a valid redis:// or rediss:// URL")
      );
    }
    return useActiveThrottle(`redis:${redisUrl}`, () => new RedisUrlThrottleClient(redisUrl));
  }
  if (sharedRequired) return rejectThrottleConfig(missing);
  retireActiveThrottle();
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
    private readonly redis: ThrottleRedis,
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
