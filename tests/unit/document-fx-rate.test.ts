import { describe, it, expect, vi } from "vitest";
import { resolveDocumentExchangeRate } from "../../server/services/document-fx-rate";

const date = new Date("2026-09-01T00:00:00Z");

describe("resolveDocumentExchangeRate", () => {
  it("AED needs no lookup and is always 1", async () => {
    const lookup = vi.fn();
    const r = await resolveDocumentExchangeRate({ currency: "AED", date, companyId: "c1", lookup });
    expect(r).toEqual({ ok: true, rate: 1 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("a foreign document takes the stored rate: getLatestRate(cur, AED, date, company)", async () => {
    const lookup = vi.fn().mockResolvedValue(3.6725);
    const r = await resolveDocumentExchangeRate({ currency: "usd", date, companyId: "c1", lookup });
    expect(r).toEqual({ ok: true, rate: 3.6725 });
    expect(lookup).toHaveBeenCalledWith("USD", "AED", date, "c1");
  });

  it("an explicit positive rate wins and skips the lookup", async () => {
    const lookup = vi.fn();
    const r = await resolveDocumentExchangeRate({
      currency: "USD",
      date,
      companyId: "c1",
      suppliedRate: 3.7,
      lookup,
    });
    expect(r).toEqual({ ok: true, rate: 3.7 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("an invalid supplied rate falls back to the stored one", async () => {
    const lookup = vi.fn().mockResolvedValue(3.6725);
    const r = await resolveDocumentExchangeRate({ currency: "USD", date, companyId: "c1", suppliedRate: -2, lookup });
    expect(r).toEqual({ ok: true, rate: 3.6725 });
  });

  it("no rate available: NO_EXCHANGE_RATE with a message naming the currency", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const r = await resolveDocumentExchangeRate({ currency: "CHF", date, companyId: "c1", lookup });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("NO_EXCHANGE_RATE");
      expect(r.message).toContain("CHF");
    }
  });

  it("a zero or negative stored rate is treated as no rate", async () => {
    const lookup = vi.fn().mockResolvedValue(0);
    const r = await resolveDocumentExchangeRate({ currency: "CHF", date, companyId: "c1", lookup });
    expect(r.ok).toBe(false);
  });
});
