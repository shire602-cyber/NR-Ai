/**
 * W5-C rate feed adapters (R14-14): recorded CBUAE / ECB payloads parse into rate rows; the
 * writer only ever creates SYSTEM rows (company_id NULL) tagged with the provider; the feed and
 * its capability stay off unless FX_RATE_FEED is configured. No network calls.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveRate = vi.fn();
vi.mock("../../server/services/fx/rates", async (orig) => ({
  ...(await orig<typeof import("../../server/services/fx/rates")>()),
  saveRate: (...args: unknown[]) => saveRate(...args),
}));

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "fx-feed", name), "utf8");

describe("R14-14 rate feed adapters", () => {
  beforeEach(() => saveRate.mockReset());

  it("R14-14: parses the recorded ECB reference-rate XML (1 EUR = rate CUR) and rejects unknown codes", async () => {
    const { parseEcbXml } = await import("../../server/services/fx/feed");
    const p = parseEcbXml(fixture("ecb-eurofxref-daily.xml"));
    expect(p.provider).toBe("ecb");
    expect(p.date).toBe("2026-11-13");
    expect(p.rates).toContainEqual({ from: "EUR", to: "USD", rate: "1.0812" });
    expect(p.rates).toContainEqual({ from: "EUR", to: "GBP", rate: "0.83915" });
    expect(p.rates).toHaveLength(5);
    expect(p.rejected).toEqual([{ value: "XXZ", reason: "UNKNOWN_CURRENCY" }]);
  });

  it("R14-14: parses the recorded CBUAE table (AED per 1 unit) by currency name, with its date", async () => {
    const { parseCbuae } = await import("../../server/services/fx/feed");
    const p = parseCbuae(fixture("cbuae-rates.html"));
    expect(p.date).toBe("2026-11-13");
    expect(p.rates).toEqual([
      { from: "USD", to: "AED", rate: "3.6725" },
      { from: "EUR", to: "AED", rate: "3.9708" },
      { from: "GBP", to: "AED", rate: "4.7312" },
      { from: "INR", to: "AED", rate: "0.043791" },
      { from: "SAR", to: "AED", rate: "0.979333" },
    ]);
    expect(p.rejected.map((r) => r.reason)).toEqual(["UNKNOWN_CURRENCY", "INVALID_RATE"]);
    const j = parseCbuae(fixture("cbuae-rates.json"));
    expect(j.rates).toContainEqual({ from: "KWD", to: "AED", rate: "11.9601" });
  });

  it("R14-14: malformed payloads are a 422 FEED_PARSE_ERROR, never a partial write", async () => {
    const { parseEcbXml, parseCbuae } = await import("../../server/services/fx/feed");
    expect(() => parseEcbXml("<html>maintenance</html>")).toThrowError(
      expect.objectContaining({ code: "FEED_PARSE_ERROR", statusCode: 422 })
    );
    expect(() => parseCbuae("<table></table>", "2026-11-13")).toThrowError(
      expect.objectContaining({ code: "FEED_PARSE_ERROR" })
    );
  });

  it("R14-14: the writer creates system rows only (companyId null) with the provider as source", async () => {
    const { writeSystemRates, parseCbuae } = await import("../../server/services/fx/feed");
    const p = parseCbuae(fixture("cbuae-rates.json"));
    saveRate.mockResolvedValue({ row: {}, replaced: false, changePct: null });
    const out = await writeSystemRates(
      p.rates.map((r) => ({ ...r, date: p.date })),
      null,
      "cbuae"
    );
    expect(out.inserted).toBe(3);
    for (const call of saveRate.mock.calls) {
      expect(call[0]).toBeNull(); // system scope
      expect(call[2]).toMatchObject({ source: "cbuae", rateType: "spot", effectiveDate: p.date });
    }
  });

  it("R14-14: a sanity-band rejection is skipped and reported, not written", async () => {
    const { writeSystemRates } = await import("../../server/services/fx/feed");
    const { DomainError } = await import("../../server/errors");
    saveRate.mockRejectedValueOnce(new DomainError("RATE_CHANGE_UNCONFIRMED", 409));
    const out = await writeSystemRates(
      [{ from: "USD", to: "AED", rate: "9.99", date: "2026-11-13" }],
      null,
      "cbuae"
    );
    expect(out.inserted).toBe(0);
    expect(out.skipped).toEqual([
      { pair: "USD/AED", date: "2026-11-13", reason: "RATE_CHANGE_UNCONFIRMED" },
    ]);
  });

  it("R14-14: disabled without FX_RATE_FEED — capability requires_external, provider runs refuse", async () => {
    const { configuredProviders, runFeedProvider } = await import("../../server/services/fx/feed");
    const { getCapability } = await import("../../shared/capabilities");
    expect(configuredProviders({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(getCapability("fx_rate_feed", {}).status).toBe("requires_external");
    expect(getCapability("fx_rate_feed", { FX_RATE_FEED: "cbuae,ecb" }).status).toBe("live");
    expect(configuredProviders({ FX_RATE_FEED: "ECB" } as NodeJS.ProcessEnv)).toEqual(["ecb"]);
    const fetcher = vi.fn();
    await expect(
      runFeedProvider("cbuae", { env: {} as NodeJS.ProcessEnv, fetcher })
    ).rejects.toMatchObject({ code: "FX_RATE_FEED_NOT_CONFIGURED", statusCode: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("R14-14: CSV import rows need date,from,to,rate", async () => {
    const { parseRateCsv } = await import("../../server/services/fx/feed");
    expect(parseRateCsv("date,from,to,rate\n2026-11-13,usd,aed,3.6725\n")).toEqual([
      { date: "2026-11-13", from: "USD", to: "AED", rate: "3.6725" },
    ]);
    expect(() => parseRateCsv("day,rate\n1,2")).toThrowError(
      expect.objectContaining({ code: "CSV_HEADER_INVALID" })
    );
  });
});
