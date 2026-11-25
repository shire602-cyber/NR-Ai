import { once } from "node:events";
import net from "node:net";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildLimiter,
  buildLockoutTracker,
  LockoutTracker,
  RedisLockoutTracker,
  RedisSlidingWindowStore,
  SlidingWindowStore,
} from "../../server/middleware/rateLimit";
import {
  CHECK_LOCKOUT,
  FIXED_WINDOW,
  INCREMENT_WINDOW,
  RedisUrlThrottleClient,
  configuredThrottleRedis,
  parseRedisUrl,
} from "../../server/middleware/redis-throttle";
import { FixedWindowThrottle } from "../../server/middleware/fixed-window-throttle";

const url = "https://redis.example.invalid";
const identity = "user@example.test|192.0.2.1";
const profile = { windowMs: 60_000, max: 2, message: "Slow down" };

/** Fake Redis at the REST boundary. One set of buckets serves all clients. */
function mockRedis() {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", url);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "mock-token");
  const buckets = new Map<string, Map<string, number>>();
  const fixed = new Map<string, { count: number; expiresAt: number }>();
  let now = Date.now();
  const fetchMock = vi.fn(async (endpoint: string, options: RequestInit) => {
    expect(endpoint).toBe(url);
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({ Authorization: "Bearer mock-token" });
    const [command, ...args] = JSON.parse(String(options.body)) as Array<string | number>;
    const reply = (result: unknown) => Response.json({ result });
    if (command === "DEL") return reply(Number(buckets.delete(String(args[0]))));
    if (command === "ZREM") {
      return reply(Number(buckets.get(String(args[0]))?.delete(String(args[1])) ?? false));
    }
    expect(command).toBe("EVAL");
    const [script, keyCount, bucketKey, horizon, ...argv] = args;
    expect(keyCount).toBe(1);
    expect(bucketKey).toMatch(/^muhasib:throttle:.+:[a-f0-9]{64}$/);
    const key = String(bucketKey);
    if (script === FIXED_WINDOW) {
      const [action, max] = argv;
      const existing = fixed.get(key);
      const current = existing && existing.expiresAt > now ? existing : undefined;
      if (action === "peek") return reply([current?.count ?? 0, 0]);
      const count = (current?.count ?? 0) + 1;
      const expiresAt = current?.expiresAt ?? now + Number(horizon);
      if (!max || count <= Number(max)) fixed.set(key, { count, expiresAt });
      return reply([count, expiresAt - now]);
    }
    const hits = buckets.get(key) ?? new Map<string, number>();
    for (const [id, at] of hits) {
      if (at <= now - Number(horizon)) hits.delete(id);
    }
    buckets.set(key, hits);
    if (script === INCREMENT_WINDOW) {
      const [max, id] = argv;
      const count = hits.size + 1;
      if (hits.size < Number(max)) hits.set(String(id), now);
      return reply([count, Math.min(...hits.values()) + Number(horizon)]);
    }
    expect(script).toBe(CHECK_LOCKOUT);
    const [id, ...rules] = argv;
    const retryAfter = () => {
      let retry = 0;
      for (let i = 0; i < rules.length; i += 2) {
        const max = Number(rules[i]);
        const window = Number(rules[i + 1]);
        const recent = [...hits.values()].filter((at) => at > now - window);
        if (recent.length >= max) {
          retry = Math.max(retry, recent[recent.length - max] + window - now);
        }
      }
      return retry;
    };
    const before = retryAfter();
    if (id && !before) hits.set(String(id), now);
    const after = retryAfter();
    return reply([after, hits.size, id && !before && after ? 1 : 0]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    advance: (ms: number) => {
      now += ms;
    },
    fetchMock,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["login", "mfa"])(
  "shares %s lockouts between Redis-backed instances",
  async (namespace) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RL_LOGIN_LOCK_MAX", "2");
    vi.stubEnv("RL_LOGIN_LOCK_WINDOW_MS", "1000");
    const redis = mockRedis();
    const first = buildLockoutTracker(namespace);
    const second = buildLockoutTracker(namespace);
    expect(first).toBeInstanceOf(RedisLockoutTracker);
    expect(await first.recordFailure(identity)).toMatchObject({ locked: false, failures: 1 });
    expect(await second.recordFailure(identity)).toMatchObject({ lockedNow: true, failures: 2 });
    expect(await first.status(identity)).toMatchObject({ locked: true, retryAfterMs: 1000 });
    redis.advance(999);
    expect(await second.recordFailure(identity)).toMatchObject({
      lockedNow: false,
      failures: 2,
      retryAfterMs: 1,
    });
    redis.advance(1);
    expect(await first.status(identity)).toMatchObject({ locked: false, failures: 2 });
    await second.reset(identity);
    expect(await first.status(identity)).toMatchObject({ locked: false, failures: 0 });
  }
);

it("shares the HTTP budget and refunds only the matching hit", async () => {
  const redis = mockRedis();
  vi.stubEnv("VERCEL", "1");
  const first = buildLimiter("shared-test", profile).store as RedisSlidingWindowStore;
  const second = buildLimiter("shared-test", profile).store as RedisSlidingWindowStore;
  expect(first).toBeInstanceOf(RedisSlidingWindowStore);
  const hits = await Promise.all([
    first.incrementHit(identity, "success"),
    second.incrementHit(identity, "failure"),
  ]);
  expect(hits.map(({ totalHits }) => totalHits).sort()).toEqual([1, 2]);
  expect((await first.increment(identity)).totalHits).toBe(3);
  await second.refundHit(identity, "success");
  await first.refundHit(identity, "success");
  expect((await second.increment(identity)).totalHits).toBe(2);
  redis.advance(profile.windowMs);
  expect((await first.increment(identity)).totalHits).toBe(1);
});

it.each(["api-key", "portal"])("shares fixed %s windows through Redis", async (namespace) => {
  const redis = mockRedis();
  const first = new FixedWindowThrottle(namespace);
  const second = new FixedWindowThrottle(namespace);
  expect(await first.check(identity, 1000, "hit", 1)).toEqual({ count: 1, remainingMs: 1000 });
  redis.advance(400);
  expect(await second.check(identity, 1000, "peek")).toMatchObject({ count: 1 });
  expect(await second.check(identity, 1000, "hit", 1)).toEqual({ count: 2, remainingMs: 600 });
  redis.advance(600);
  expect(await first.check(identity, 1000, "peek")).toMatchObject({ count: 0 });
});

it("refunds successful authentication before the HTTP response ends", async () => {
  const request = globalThis.fetch;
  mockRedis();
  const app = express();
  for (const path of ["/first", "/second"]) {
    app.post(
      path,
      buildLimiter("refund-test", { ...profile, max: 1, skipSuccessfulRequests: true }),
      (req, res) => res.sendStatus(req.query.success ? 200 : 401)
    );
  }
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (path: string) => {
      const response = await request(origin + path, { method: "POST" });
      await response.text();
      return response.status;
    };
    expect(await post("/first?success=1")).toBe(200);
    expect(await post("/second?success=1")).toBe(200);
    expect(await post("/first")).toBe(401);
    expect(await post("/second?success=1")).toBe(429);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each(["development", "test"])(
  "uses in-memory stores in %s without Redis settings",
  async (env) => {
    vi.stubEnv("NODE_ENV", env);
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
    vi.stubEnv("REDIS_URL", undefined);
    const tracker = buildLockoutTracker("login");
    const store = buildLimiter("test", profile).store;
    expect(tracker).toBeInstanceOf(LockoutTracker);
    expect(store).toBeInstanceOf(SlidingWindowStore);
    expect(await tracker.recordFailure(identity)).toMatchObject({ locked: false, failures: 1 });
    expect((await store.increment(identity)).totalHits).toBe(1);
  }
);

it.each([{ NODE_ENV: "production" }, { VERCEL: "1" }])("requires shared Redis with %o", (env) => {
  vi.stubEnv("NODE_ENV", "NODE_ENV" in env ? env.NODE_ENV : "test");
  vi.stubEnv("VERCEL", "VERCEL" in env ? env.VERCEL : undefined);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", undefined);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
  vi.stubEnv("REDIS_URL", undefined);
  expect(() => buildLockoutTracker("mfa")).toThrow(/UPSTASH_REDIS_REST_URL/);
  expect(() => buildLockoutTracker("mfa")).toThrow(/REDIS_URL/);
  expect(() => buildLimiter("missing", profile)).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
});

it("rejects requests when configured Redis is unavailable", async () => {
  const { fetchMock } = mockRedis();
  fetchMock.mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 }));
  await expect(buildLockoutTracker("login").status(identity)).rejects.toMatchObject({
    code: "THROTTLE_UNAVAILABLE",
    statusCode: 503,
  });
  await expect(buildLimiter("outage", profile).store.increment(identity)).rejects.toMatchObject({
    code: "THROTTLE_UNAVAILABLE",
    statusCode: 503,
  });
});

function encodeReply(value: unknown): Buffer {
  if (value instanceof Error) return Buffer.from("-" + value.message + "\r\n");
  if (typeof value === "string") return Buffer.from("+" + value + "\r\n");
  if (typeof value === "number") return Buffer.from(":" + value + "\r\n");
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from("*" + value.length + "\r\n"), ...value.map(encodeReply)]);
  }
  if (value === null) return Buffer.from("$-1\r\n");
  const raw = Buffer.from(String(value), "utf8");
  return Buffer.concat([Buffer.from("$" + raw.length + "\r\n"), raw, Buffer.from("\r\n")]);
}

function decodeCommand(
  buf: Buffer,
  offset = 0
): { value: Array<string | number>; rest: number } | null {
  if (offset >= buf.length || buf[offset] !== 42) return null;
  const nl = buf.indexOf("\r\n", offset);
  if (nl === -1) return null;
  const count = Number(buf.toString("utf8", offset + 1, nl));
  let cursor = nl + 2;
  const items: Array<string | number> = [];
  for (let i = 0; i < count; i += 1) {
    if (cursor >= buf.length || buf[cursor] !== 36) return null;
    const sizeNl = buf.indexOf("\r\n", cursor);
    if (sizeNl === -1) return null;
    const len = Number(buf.toString("utf8", cursor + 1, sizeNl));
    const start = sizeNl + 2;
    const end = start + len;
    if (buf.length < end + 2) return null;
    items.push(buf.toString("utf8", start, end));
    cursor = end + 2;
  }
  return { value: items, rest: cursor };
}

const REDIS_FIXTURE_AUTH = "example-only-value";

async function startRedisUrlStub(db: number | null = null) {
  const buckets = new Map<string, Map<string, number>>();
  const fixed = new Map<string, { count: number; expiresAt: number }>();
  let now = Date.now();
  let connections = 0;
  let rejectedBeforeReady = 0;
  const commands: string[][] = [];
  const sockets = new Set<net.Socket>();
  let armPause = false;
  let pauseAck: (() => void) | null = null;
  const server = net.createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let stage: "auth" | "select" | "ready" = "auth";
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const decoded = decodeCommand(buf, 0);
        if (!decoded) break;
        buf = buf.subarray(decoded.rest);
        const [command, ...args] = decoded.value.map(String);
        const reply = (value: unknown) => socket.write(encodeReply(value));
        if (stage === "auth") {
          if (command !== "AUTH" || args[0] !== "default" || args[1] !== REDIS_FIXTURE_AUTH) {
            rejectedBeforeReady += 1;
            reply(new Error("NOAUTH"));
            continue;
          }
          commands.push(["AUTH", ...args]);
          reply("OK");
          stage = db != null && db !== 0 ? "select" : "ready";
          continue;
        }
        if (stage === "select") {
          if (command !== "SELECT" || args[0] !== String(db)) {
            rejectedBeforeReady += 1;
            reply(new Error("NOAUTH"));
            continue;
          }
          commands.push(["SELECT", ...args]);
          reply("OK");
          stage = "ready";
          continue;
        }
        if (armPause) {
          armPause = false;
          const ack = pauseAck;
          pauseAck = null;
          ack?.();
          continue;
        }
        commands.push([command, ...args]);
        if (command === "DEL") {
          reply(Number(buckets.delete(String(args[0]))));
          continue;
        }
        if (command === "ZREM") {
          reply(Number(buckets.get(String(args[0]))?.delete(String(args[1])) ?? false));
          continue;
        }
        if (command !== "EVAL") {
          reply(new Error("ERR unknown command"));
          continue;
        }
        const [script, , bucketKey, horizon, ...argv] = args;
        const key = String(bucketKey);
        if (script === FIXED_WINDOW) {
          const [action, max] = argv;
          const existing = fixed.get(key);
          const current = existing && existing.expiresAt > now ? existing : undefined;
          if (action === "peek") {
            reply([current?.count ?? 0, 0]);
            continue;
          }
          const count = (current?.count ?? 0) + 1;
          const expiresAt = current?.expiresAt ?? now + Number(horizon);
          if (!max || count <= Number(max)) fixed.set(key, { count, expiresAt });
          reply([count, expiresAt - now]);
          continue;
        }
        const hits = buckets.get(key) ?? new Map<string, number>();
        for (const [id, at] of hits) {
          if (at <= now - Number(horizon)) hits.delete(id);
        }
        buckets.set(key, hits);
        if (script === INCREMENT_WINDOW) {
          const [max, id] = argv;
          const count = hits.size + 1;
          if (hits.size < Number(max)) hits.set(String(id), now);
          reply([count, Math.min(...hits.values()) + Number(horizon)]);
          continue;
        }
        const [id, ...rules] = argv;
        const retryAfter = () => {
          let retry = 0;
          for (let i = 0; i < rules.length; i += 2) {
            const max = Number(rules[i]);
            const window = Number(rules[i + 1]);
            const recent = [...hits.values()].filter((at) => at > now - window);
            if (recent.length >= max) {
              retry = Math.max(retry, recent[recent.length - max] + window - now);
            }
          }
          return retry;
        };
        const before = retryAfter();
        if (id && !before) hits.set(String(id), now);
        const after = retryAfter();
        reply([after, hits.size, id && !before && after ? 1 : 0]);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const dbPath = db == null ? "" : "/" + String(db);
  return {
    url:
      "redis://default:" + encodeURIComponent(REDIS_FIXTURE_AUTH) + "@127.0.0.1:" + port + dbPath,
    connections: () => connections,
    commands: () => commands,
    rejectedBeforeReady: () => rejectedBeforeReady,
    advance: (ms: number) => {
      now += ms;
    },
    pauseNext: () =>
      new Promise<void>((resolve) => {
        armPause = true;
        pauseAck = resolve;
      }),
    dropSockets: () => {
      const open = [...sockets];
      return Promise.all(
        open.map(
          (socket) =>
            new Promise<void>((resolve) => {
              if (socket.destroyed) {
                resolve();
                return;
              }
              socket.once("close", () => resolve());
              socket.destroy();
            })
        )
      );
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

it("parses redis and rediss URLs", () => {
  const parsed = parseRedisUrl("redis://default:example%2Fonly@example.test:6379/2");
  expect(parsed.host).toBe("example.test");
  expect(parsed.port).toBe(6379);
  expect(parsed.username).toBe("default");
  expect(parsed.password).toBe("example/only");
  expect(parsed.db).toBe(2);
  expect(parsed.useTls).toBe(false);
  const tls = parseRedisUrl("rediss://example.test");
  expect(tls.port).toBe(6380);
  expect(tls.useTls).toBe(true);
  expect(tls.password).toBeNull();
  expect(tls.db).toBeNull();
  expect(() => parseRedisUrl("https://example.test")).toThrow(/REDIS_URL/);
  expect(() => parseRedisUrl("redis://example.test/nope")).toThrow(/REDIS_URL/);
});

it("uses REDIS_URL in production without Upstash", async () => {
  const redis = await startRedisUrlStub();
  try {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
    vi.stubEnv("REDIS_URL", redis.url);
    vi.stubEnv("RL_LOGIN_LOCK_MAX", "2");
    vi.stubEnv("RL_LOGIN_LOCK_WINDOW_MS", "1000");
    expect(configuredThrottleRedis()).toBeInstanceOf(RedisUrlThrottleClient);
    const first = buildLockoutTracker("login");
    const second = buildLockoutTracker("login");
    expect(first).toBeInstanceOf(RedisLockoutTracker);
    expect(await first.recordFailure(identity)).toMatchObject({ locked: false, failures: 1 });
    expect(await second.recordFailure(identity)).toMatchObject({ lockedNow: true, failures: 2 });
    redis.advance(1000);
    expect(await first.status(identity)).toMatchObject({ locked: false, failures: 2 });
    expect(redis.connections()).toBe(1);
    expect(redis.rejectedBeforeReady()).toBe(0);
    expect(redis.commands()[0]).toEqual(["AUTH", "default", REDIS_FIXTURE_AUTH]);
  } finally {
    await redis.close();
  }
});

it("shares one authenticated TCP client and fails closed when that connection drops", async () => {
  const redis = await startRedisUrlStub(2);
  try {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
    vi.stubEnv("REDIS_URL", redis.url);
    vi.stubEnv("RL_LOGIN_LOCK_MAX", "5");
    vi.stubEnv("RL_LOGIN_LOCK_WINDOW_MS", "1000");
    const client = configuredThrottleRedis();
    expect(client).toBeInstanceOf(RedisUrlThrottleClient);
    expect(configuredThrottleRedis()).toBe(client);
    const first = buildLockoutTracker("login");
    const second = buildLockoutTracker("login");
    const windows = new FixedWindowThrottle("api-key");
    const [left, right, ...counts] = await Promise.all([
      first.recordFailure(identity),
      second.recordFailure(identity),
      windows.check(identity, 1000, "hit", 5),
      windows.check("other@example.test|192.0.2.2", 1000, "hit", 5),
    ]);
    expect(redis.connections()).toBe(1);
    expect(redis.rejectedBeforeReady()).toBe(0);
    expect(redis.commands()[0]).toEqual(["AUTH", "default", REDIS_FIXTURE_AUTH]);
    expect(redis.commands()[1]).toEqual(["SELECT", "2"]);
    expect(
      redis
        .commands()
        .slice(2)
        .every(([command]) => command === "EVAL")
    ).toBe(true);
    expect([left.failures, right.failures].sort()).toEqual([1, 2]);
    expect(counts.map((hit) => hit.count).sort()).toEqual([1, 1]);

    const paused = redis.pauseNext();
    const dropped = first.status(identity);
    await paused;
    await redis.dropSockets();
    await expect(dropped).rejects.toMatchObject({
      code: "THROTTLE_UNAVAILABLE",
      statusCode: 503,
    });
    expect(redis.connections()).toBe(1);
  } finally {
    await redis.close();
  }
});
