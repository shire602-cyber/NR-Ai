import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Factory runs only when the module is actually imported — the counter proves
// the SDK is never loaded when no DSN is configured.
const sdk = vi.hoisted(() => ({
  loads: 0,
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));

vi.mock("@sentry/node", () => {
  sdk.loads += 1;
  return {
    init: sdk.init,
    captureException: sdk.captureException,
    flush: sdk.flush,
  };
});

vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Built at runtime so no token-shaped literal sits in the repository.
const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const JWT = [
  b64url({ alg: "HS256", typ: "JWT" }),
  b64url({ sub: "fixture-user", note: "not a credential" }),
  Buffer.from("fixture-signature-not-a-real-mac-0000").toString("base64url"),
].join(".");

describe("monitoring with Sentry", () => {
  const savedDsn = process.env.SENTRY_DSN;
  beforeEach(() => {
    vi.resetModules();
    sdk.loads = 0;
    sdk.init.mockClear();
    sdk.captureException.mockClear();
    sdk.flush.mockClear();
  });
  afterEach(() => {
    if (savedDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = savedDsn;
  });

  it("never imports or calls the SDK when SENTRY_DSN is unset", async () => {
    delete process.env.SENTRY_DSN;
    const mon = await import("../../server/services/monitoring");
    await mon.initMonitoring();
    mon.captureException(new Error("boom"), { requestId: "r1" });
    await mon.flushMonitoring();
    expect(sdk.loads).toBe(0);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("initialises once and forwards exactly once with scrubbed context when SENTRY_DSN is set", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    process.env.SENTRY_ENVIRONMENT = "staging";
    const mon = await import("../../server/services/monitoring");
    await mon.initMonitoring();
    await mon.initMonitoring(); // idempotent
    mon.captureException(new Error(`token ${JWT} leaked for jane@example.com`), {
      requestId: "req-1",
      userId: "user-1",
      companyId: "co-1",
      method: "POST",
      url: "/api/companies/co-1/invoices?token=abc",
      body: { password: "hunter2" },
      authorization: "Bearer zzz",
    });
    await mon.flushMonitoring();

    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect((sdk.init.mock.calls[0][0] as any).dsn).toBe(process.env.SENTRY_DSN);
    expect((sdk.init.mock.calls[0][0] as any).environment).toBe("staging");
    expect(sdk.captureException).toHaveBeenCalledTimes(1);

    const [sent, hint] = sdk.captureException.mock.calls[0] as [Error, any];
    expect(sent.message).not.toContain("eyJ");
    expect(sent.message).not.toContain("jane@example.com");
    expect(hint.tags).toMatchObject({
      requestId: "req-1",
      userId: "user-1",
      companyId: "co-1",
      method: "POST",
    });
    const serialised = JSON.stringify(hint);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("Bearer zzz");
    expect(serialised).not.toContain("token=abc");
    expect(sdk.flush).toHaveBeenCalled();
  });

  it("does not throw when the SDK itself fails", async () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    sdk.captureException.mockImplementationOnce(() => {
      throw new Error("sdk down");
    });
    const mon = await import("../../server/services/monitoring");
    await mon.initMonitoring();
    expect(() => mon.captureException(new Error("x"))).not.toThrow();
    await mon.flushMonitoring();
  });
});
