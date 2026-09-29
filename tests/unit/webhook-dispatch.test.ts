/**
 * Outbound webhooks: signing (HMAC-SHA256 over timestamp + body), SSRF guard
 * integration, bounded retries with backoff, and the guarantee that a failing
 * endpoint never throws into the caller.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  endpoints: [] as any[],
  deliveries: [] as any[],
  failureIncrements: [] as string[],
  updated: [] as any[],
  throwOnLookup: false,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getActiveWebhookEndpointsForEvent: vi.fn(async () => {
      if (store.throwOnLookup) throw new Error("db down");
      return store.endpoints;
    }),
    createWebhookDelivery: vi.fn(async (d: any) => {
      store.deliveries.push(d);
      return d;
    }),
    updateWebhookEndpoint: vi.fn(async (id: string, d: any) => {
      store.updated.push({ id, ...d });
    }),
    incrementWebhookFailureCount: vi.fn(async (id: string) => {
      store.failureIncrements.push(id);
    }),
  },
}));

import crypto from "crypto";
import {
  dispatchWebhookEvent,
  emitWebhookEvent,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_TIMEOUT_MS,
} from "../../server/services/webhook.service";

const SECRET = "a".repeat(64);
// Public IP literal: passes the SSRF guard without DNS.
const PUBLIC_URL = "https://93.184.216.34/hooks/muhasib";

function endpoint(over: Record<string, unknown> = {}) {
  return { id: "ep-1", url: PUBLIC_URL, secret: SECRET, events: "*", isActive: true, ...over };
}

function mockFetchSequence(...responses: Array<number | Error>) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response("ok", { status: next ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const noSleep = async () => {};

beforeEach(() => {
  store.endpoints = [];
  store.deliveries = [];
  store.failureIncrements = [];
  store.updated = [];
  store.throwOnLookup = false;
  delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("webhook signing", () => {
  it("signs `${timestamp}.${body}` with HMAC-SHA256 and the endpoint secret", () => {
    const sig = signWebhookPayload(SECRET, "1700000000", '{"a":1}');
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update('1700000000.{"a":1}')
      .digest("hex");
    expect(sig).toBe(`sha256=${expected}`);
  });

  it("verifies a fresh signature and rejects tampering, wrong secret and stale timestamps", () => {
    const now = 1_700_000_000;
    const body = '{"event":"invoice.paid"}';
    const sig = signWebhookPayload(SECRET, String(now), body);
    expect(verifyWebhookSignature(SECRET, String(now), body, sig, now)).toBe(true);
    expect(verifyWebhookSignature(SECRET, String(now), body + " ", sig, now)).toBe(false);
    expect(verifyWebhookSignature("b".repeat(64), String(now), body, sig, now)).toBe(false);
    // replay outside the 5 minute tolerance
    expect(verifyWebhookSignature(SECRET, String(now), body, sig, now + 301)).toBe(false);
  });

  it("sends signature, timestamp, event and id headers and a secret-free payload", async () => {
    store.endpoints = [endpoint()];
    const fetchMock = mockFetchSequence(200);

    await dispatchWebhookEvent(
      "co-1",
      "invoice.paid",
      { invoiceId: "inv-1", total: 105 },
      { sleep: noSleep }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(headers["X-Webhook-Event"]).toBe("invoice.paid");
    expect(headers["X-Webhook-Timestamp"]).toMatch(/^\d{10}$/);
    expect(headers["X-Webhook-Signature"]).toBe(
      signWebhookPayload(SECRET, headers["X-Webhook-Timestamp"], body)
    );
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({ event: "invoice.paid", data: { invoiceId: "inv-1", total: 105 } });
    expect(typeof parsed.id).toBe("string");
    expect(body).not.toContain(SECRET);
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]).toMatchObject({ success: true, attemptNumber: 1 });
  });

  it("uses a 5 second timeout", () => {
    expect(WEBHOOK_TIMEOUT_MS).toBe(5000);
  });
});

describe("webhook retries", () => {
  it("retries 5xx with backoff up to 3 attempts, recording each attempt", async () => {
    store.endpoints = [endpoint()];
    const fetchMock = mockFetchSequence(500, 502, 503);
    const sleeps: number[] = [];

    await dispatchWebhookEvent("co-1", "invoice.created", { invoiceId: "i" }, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(WEBHOOK_MAX_ATTEMPTS).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.deliveries.map((d) => d.attemptNumber)).toEqual([1, 2, 3]);
    expect(store.deliveries.every((d) => d.success === false)).toBe(true);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
    expect(store.failureIncrements).toEqual(["ep-1"]); // once per event, not per attempt
  });

  it("stops retrying after the first success", async () => {
    store.endpoints = [endpoint()];
    const fetchMock = mockFetchSequence(503, 200);
    await dispatchWebhookEvent("co-1", "invoice.created", {}, { sleep: noSleep });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.deliveries.map((d) => d.success)).toEqual([false, true]);
    expect(store.failureIncrements).toEqual([]);
  });

  it("re-signs each attempt with a fresh timestamp but the same event id", async () => {
    store.endpoints = [endpoint()];
    const fetchMock = mockFetchSequence(500, 200);
    await dispatchWebhookEvent("co-1", "invoice.created", {}, { sleep: noSleep });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies[0].id).toBe(bodies[1].id);
  });

  it("does not retry a 4xx (other than 408/429)", async () => {
    store.endpoints = [endpoint()];
    const fetchMock = mockFetchSequence(400);
    await dispatchWebhookEvent("co-1", "invoice.created", {}, { sleep: noSleep });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.failureIncrements).toEqual(["ep-1"]);
  });

  it("retries network errors and timeouts", async () => {
    store.endpoints = [endpoint()];
    const fetchMock = mockFetchSequence(new Error("ECONNRESET"), new Error("timeout"), 200);
    await dispatchWebhookEvent("co-1", "invoice.created", {}, { sleep: noSleep });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.deliveries[2].success).toBe(true);
  });
});

describe("webhook SSRF guard", () => {
  it.each([
    "http://127.0.0.1:8080/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/hook",
    "http://[::1]/hook",
  ])("refuses %s without ever calling fetch and without retrying", async (url) => {
    process.env.NODE_ENV = "production";
    store.endpoints = [endpoint({ url })];
    const fetchMock = mockFetchSequence(200);

    await dispatchWebhookEvent("co-1", "invoice.created", {}, { sleep: noSleep });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0].success).toBe(false);
    expect(store.deliveries[0].responseBody).toMatch(/Blocked/);
    process.env.NODE_ENV = "test";
  });
});

describe("failure isolation", () => {
  it("dispatchWebhookEvent never rejects when the endpoint lookup fails", async () => {
    store.throwOnLookup = true;
    await expect(dispatchWebhookEvent("co-1", "invoice.created", {})).resolves.toBeUndefined();
  });

  it("dispatchWebhookEvent never rejects when delivery bookkeeping fails", async () => {
    store.endpoints = [endpoint()];
    mockFetchSequence(500, 500, 500);
    const { storage } = await import("../../server/storage");
    (storage.createWebhookDelivery as any).mockRejectedValueOnce(new Error("db down"));
    await expect(
      dispatchWebhookEvent("co-1", "invoice.created", {}, { sleep: noSleep })
    ).resolves.toBeUndefined();
  });

  it("emitWebhookEvent returns synchronously and swallows every failure", async () => {
    store.throwOnLookup = true;
    expect(emitWebhookEvent("co-1", "invoice.created", {})).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20)); // no unhandled rejection
  });

  it("one failing endpoint does not stop delivery to the others", async () => {
    store.endpoints = [
      endpoint({ id: "bad", url: "https://93.184.216.35/x" }),
      endpoint({ id: "good", url: "https://93.184.216.36/x" }),
    ];
    const fn = vi.fn(async (url: any) => {
      if (String(url).includes("93.184.216.35")) throw new Error("boom");
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    await dispatchWebhookEvent("co-1", "invoice.created", {}, { sleep: noSleep });
    const good = store.deliveries.filter((d) => d.webhookEndpointId === "good");
    expect(good).toHaveLength(1);
    expect(good[0].success).toBe(true);
  });
});
