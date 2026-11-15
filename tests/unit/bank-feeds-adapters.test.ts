/**
 * Contract tests for the Lean / Tarabut / Wio bank-feed adapters (W3-C, R06-19) against recorded
 * sandbox-shaped fixtures. No live calls: fetch is injected.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BANK_FEED_ADAPTERS } from "../../server/services/bank-feeds/adapters";
import { amountFils, isoDay, setBankFeedFetch } from "../../server/services/bank-feeds/http";
import type { FetchLike } from "../../server/services/bank-feeds/types";

const ENV_KEYS = [
  "LEAN_APP_TOKEN",
  "TARABUT_CLIENT_ID",
  "TARABUT_CLIENT_SECRET",
  "WIO_CLIENT_ID",
  "WIO_CLIENT_SECRET",
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  setBankFeedFetch(null);
});

function recorded(
  routes: Record<string, unknown>,
  seen: Array<{ url: string; init?: unknown }> = []
): FetchLike {
  return async (url, init) => {
    seen.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => "nf" };
    const data = routes[key];
    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  };
}

describe("bank-feed adapters [R06-19]", () => {
  it("are unconfigured without credentials", () => {
    for (const a of Object.values(BANK_FEED_ADAPTERS)) expect(a.isConfigured()).toBe(false);
    process.env.TARABUT_CLIENT_ID = "id";
    expect(BANK_FEED_ADAPTERS.tarabut.isConfigured()).toBe(false); // secret missing
    process.env.TARABUT_CLIENT_SECRET = "secret";
    expect(BANK_FEED_ADAPTERS.tarabut.isConfigured()).toBe(true);
  });

  it("authorize URLs carry the state and the exact redirect URI", () => {
    process.env.LEAN_APP_TOKEN = "app";
    process.env.WIO_CLIENT_ID = "wio-id";
    process.env.TARABUT_CLIENT_ID = "tb-id";
    for (const a of Object.values(BANK_FEED_ADAPTERS)) {
      const url = new URL(
        a.authorizeUrl({ state: "s".repeat(43), redirectUri: "https://app.test/cb" })
      );
      expect(url.searchParams.get("state")).toBe("s".repeat(43));
      expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    }
  });

  it("Lean: accounts and transactions (negative = debit), bad rows rejected", async () => {
    process.env.LEAN_APP_TOKEN = "app";
    const seen: Array<{ url: string; init?: unknown }> = [];
    setBankFeedFetch(
      recorded(
        {
          "/data/v1/accounts": {
            payload: {
              accounts: [
                {
                  account_id: "a1",
                  name: "Current",
                  currency_code: "aed",
                  iban: "AE070331234567890123456",
                  institution: { name: "ENBD" },
                },
              ],
            },
          },
          "/data/v1/transactions": {
            payload: {
              transactions: [
                {
                  transaction_id: "t1",
                  timestamp: "2026-10-01T10:00:00Z",
                  description: "POS",
                  amount: -10.255,
                  balance: "100.00",
                },
                {
                  transaction_id: "t2",
                  timestamp: "2026-10-02",
                  description: "IN",
                  amount: "1,250.50",
                },
                {
                  transaction_id: "t3",
                  timestamp: "2026-02-30",
                  description: "BAD DATE",
                  amount: 1,
                },
                {
                  transaction_id: "t4",
                  timestamp: "2026-10-03",
                  description: "NAN",
                  amount: "abc",
                },
                { timestamp: "2026-10-03", description: "NO ID", amount: 1 },
              ],
            },
          },
        },
        seen
      )
    );
    const tokens = await BANK_FEED_ADAPTERS.lean.exchangeCode({
      code: "entity-1",
      redirectUri: "x",
    });
    expect(tokens.accessToken).toBe("entity-1");
    const accounts = await BANK_FEED_ADAPTERS.lean.listAccounts(tokens);
    expect(accounts).toEqual([
      {
        externalId: "a1",
        name: "Current",
        bankName: "ENBD",
        iban: "AE070331234567890123456",
        currency: "AED",
        last4: "3456",
      },
    ]);
    const r = await BANK_FEED_ADAPTERS.lean.fetchTransactions(
      tokens,
      "a1",
      "2026-10-01",
      "2026-10-31"
    );
    expect(r.transactions.map((t) => [t.externalId, t.date, t.amountFils, t.balanceFils])).toEqual([
      ["t1", "2026-10-01", -1026, 10000],
      ["t2", "2026-10-02", 125050, null],
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "Invalid date",
      "Invalid amount",
      "Missing transaction_id",
    ]);
    expect(JSON.stringify(seen[0].init)).toContain("lean-app-token");
  });

  it("Tarabut: token exchange and credit/debit indicator", async () => {
    process.env.TARABUT_CLIENT_ID = "id";
    process.env.TARABUT_CLIENT_SECRET = "secret";
    setBankFeedFetch(
      recorded({
        "/auth/token": { access_token: "at", refresh_token: "rt", expires_in: 3600 },
        "/transactions": {
          transactions: [
            {
              transactionId: "x1",
              bookingDateTime: "2026-10-05T00:00:00Z",
              amount: { value: "99.99", currency: "AED" },
              creditDebitIndicator: "Debit",
              transactionInformation: "DEWA",
            },
            {
              transactionId: "x2",
              bookingDateTime: "2026-10-06",
              amount: { value: "500" },
              creditDebitIndicator: "Credit",
            },
            { transactionId: "x3", bookingDateTime: "2026-10-06", amount: { value: "1" } },
          ],
        },
        "/accounts": { accounts: [{ accountId: "acc", providerName: "FAB", currency: "AED" }] },
      })
    );
    const tokens = await BANK_FEED_ADAPTERS.tarabut.exchangeCode({
      code: "c",
      redirectUri: "https://app.test/cb",
    });
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    const r = await BANK_FEED_ADAPTERS.tarabut.fetchTransactions(
      tokens,
      "acc",
      "2026-10-01",
      "2026-10-31"
    );
    expect(r.transactions.map((t) => t.amountFils)).toEqual([-9999, 50000]);
    expect(r.rejected).toHaveLength(1);
  });

  it("Wio: provider errors surface as errors, never as an empty success", async () => {
    process.env.WIO_CLIENT_ID = "id";
    process.env.WIO_CLIENT_SECRET = "secret";
    setBankFeedFetch(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "unauthorized",
    }));
    await expect(
      BANK_FEED_ADAPTERS.wio.fetchTransactions(
        { accessToken: "a", refreshToken: null, expiresAt: null },
        "acc",
        "2026-10-01",
        "2026-10-02"
      )
    ).rejects.toThrow(/401/);
  });

  it("amount and date parsing is strict", () => {
    expect(amountFils("1e5")).toBeNull();
    expect(amountFils("NaN")).toBeNull();
    expect(amountFils(-0.005)).toBe(-1);
    expect(isoDay("2026-13-01")).toBeNull();
    expect(isoDay("2026-10-01T23:59:59Z")).toBe("2026-10-01");
  });
});
