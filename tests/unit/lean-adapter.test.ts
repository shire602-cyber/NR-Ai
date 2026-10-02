import { describe, expect, it, vi } from "vitest";
import { LeanClient, ProviderError, bankDay, leanConfig, mapLeanTransaction, type FetchLike } from "../../server/services/open-banking.service";

const cfg = { appToken: "app-1", clientSecret: "sec", environment: "sandbox" as const, apiBase: "https://api.test", authBase: "https://auth.test" };

function fakeFetch(handler: (url: string, init: any) => { status?: number; body: any }): FetchLike & { calls: Array<{ url: string; init: any }> } {
  const calls: Array<{ url: string; init: any }> = [];
  const f = (async (url: string, init: any) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  }) as FetchLike & { calls: typeof calls };
  f.calls = calls;
  return f;
}

describe("leanConfig", () => {
  it("is off without both the app token and the secret", () => {
    expect(leanConfig({})).toBeNull();
    expect(leanConfig({ LEAN_APP_TOKEN: "a" })).toBeNull();
    expect(leanConfig({ LEAN_CLIENT_SECRET: "s" })).toBeNull();
  });
  it("defaults to the sandbox hosts and honours overrides and production", () => {
    expect(leanConfig({ LEAN_APP_TOKEN: "a", LEAN_CLIENT_SECRET: "s" })).toMatchObject({ environment: "sandbox", apiBase: "https://sandbox.leantech.me", authBase: "https://auth.sandbox.leantech.me" });
    expect(leanConfig({ LEAN_APP_TOKEN: "a", LEAN_CLIENT_SECRET: "s", LEAN_ENV: "production" })).toMatchObject({ apiBase: "https://api2.leantech.me", authBase: "https://auth.leantech.me" });
    expect(leanConfig({ LEAN_APP_TOKEN: "a", LEAN_CLIENT_SECRET: "s", LEAN_API_BASE_URL: "http://127.0.0.1:9/", LEAN_AUTH_BASE_URL: "http://127.0.0.1:8" })).toMatchObject({ apiBase: "http://127.0.0.1:9", authBase: "http://127.0.0.1:8" });
  });
});

describe("LeanClient", () => {
  it("gets a client-credentials token once per scope and sends it as a bearer", async () => {
    const f = fakeFetch((url) => (url.endsWith("/oauth2/token") ? { body: { access_token: "T", expires_in: 3600 } } : { body: { customer_id: "cust-1" } }));
    const c = new LeanClient(cfg, f);
    expect(await c.createCustomer("company-1")).toBe("cust-1");
    await c.createCustomer("company-2");
    const tokenCalls = f.calls.filter((x) => x.url.endsWith("/oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(tokenCalls[0].init.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("api");
    expect(form.get("client_id")).toBe("app-1");
    expect(f.calls[1].init.headers.Authorization).toBe("Bearer T");
    expect(JSON.parse(f.calls[1].init.body)).toEqual({ app_user_id: "company-1" });
  });

  it("asks for a customer-scoped token for the Link SDK", async () => {
    const f = fakeFetch(() => ({ body: { access_token: "CT", expires_in: 3600 } }));
    expect(await new LeanClient(cfg, f).customerToken("cust-1")).toBe("CT");
    expect(new URLSearchParams(f.calls[0].init.body).get("scope")).toBe("customer.cust-1");
  });

  it("lists entities with the date range and reads id and customer", async () => {
    const f = fakeFetch((url) => (url.includes("oauth2") ? { body: { access_token: "T" } } : { body: { data: [{ id: "e1", customer_id: "c1", status: "ACTIVE" }] } }));
    const out = await new LeanClient(cfg, f).listEntities("2020-01-01", "2026-10-03");
    expect(out).toEqual([{ id: "e1", customerId: "c1", status: "ACTIVE", bankName: null, createdAt: null }]);
    expect(f.calls[1].url).toContain("/customers/v1/entities?start_date=2020-01-01&end_date=2026-10-03");
  });

  it("lists enabled accounts with IBAN and currency", async () => {
    const f = fakeFetch((url) =>
      url.includes("oauth2")
        ? { body: { access_token: "T" } }
        : { body: { data: { accounts: [{ account_id: "a1", status: "ENABLED", currency: "aed", account: [{ scheme_name: "IBAN", identification: "AE070331234567890123456" }], servicer: { identification: "ENBD" } }, { account_id: "a2", status: "DISABLED" }], page: { total_pages: 1 } } } }
    );
    const out = await new LeanClient(cfg, f).listAccounts("e1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: "a1", currency: "AED", iban: "AE070331234567890123456", last4: "3456" });
    expect(f.calls[1].url).toContain("/data/v2/accounts?entity_id=e1");
  });

  it("pages through transactions", async () => {
    let n = 0;
    const f = fakeFetch((url) => {
      if (url.includes("oauth2")) return { body: { access_token: "T" } };
      n++;
      return { body: { data: { transactions: [{ transaction_id: `t${n}` }], page: { total_pages: 2 } } } };
    });
    const rows = await new LeanClient(cfg, f).listTransactions("e1", "a1", "2026-09-01", "2026-09-30");
    expect(rows.map((r) => r.transaction_id)).toEqual(["t1", "t2"]);
  });

  it("turns a provider error into a ProviderError without leaking the body", async () => {
    const f = fakeFetch((url) => (url.includes("oauth2") ? { body: { access_token: "T" } } : { status: 500, body: { secret: "x" } }));
    await expect(new LeanClient(cfg, f).listEntities("a", "b")).rejects.toBeInstanceOf(ProviderError);
  });

  it("turns a network failure into a ProviderError", async () => {
    const f = vi.fn().mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(new LeanClient(cfg, f as any).token("api")).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("transaction mapping", () => {
  const tx = { transaction_id: "t1", amount: { currency: "AED", amount: 42.5 }, credit_debit_indicator: "DEBIT", booking_date_time: "2026-09-01T21:00:00Z", status: "BOOKED", transaction_information: "  POS  Carrefour " };
  it("signs by indicator and uses the Dubai day", () => {
    const m = mapLeanTransaction(tx)!;
    expect(m.line.amount).toBe(-42.5);
    expect(m.line.date.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(m.line.description).toBe("POS Carrefour");
    expect(m.line.externalId).toBe("t1");
    expect(m.currency).toBe("AED");
  });
  it("skips pending, undated and zero lines", () => {
    expect(mapLeanTransaction({ ...tx, status: "PENDING" })).toBeNull();
    expect(mapLeanTransaction({ ...tx, booking_date_time: undefined, value_date_time: undefined })).toBeNull();
    expect(mapLeanTransaction({ ...tx, amount: { currency: "AED", amount: 0 } })).toBeNull();
    expect(mapLeanTransaction({ ...tx, transaction_id: undefined })).toBeNull();
  });
  it("credits are positive", () => {
    expect(mapLeanTransaction({ ...tx, credit_debit_indicator: "CREDIT" })!.line.amount).toBe(42.5);
    expect(bankDay("nope")).toBeNull();
  });
});
