import { describe, it, expect } from "vitest";
import { resolvePaymentDate } from "../../server/services/payment-date.service";

// 2026-09-29 10:00 UTC == 14:00 in the UAE.
const NOW = new Date("2026-09-29T10:00:00Z");

describe("resolvePaymentDate", () => {
  it("defaults to today when nothing is requested and no fallback is given", () => {
    const r = resolvePaymentDate({ now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ymd).toBe("2026-09-29");
      expect(r.source).toBe("fallback");
    }
  });

  it("defaults to the supplied fallback (bank transaction date)", () => {
    const bankDate = new Date("2026-09-10T00:00:00Z");
    const r = resolvePaymentDate({ fallback: bankDate, now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ymd).toBe("2026-09-10");
      expect(r.date.getTime()).toBe(bankDate.getTime());
    }
  });

  it("treats an empty-string request as not supplied", () => {
    const r = resolvePaymentDate({ requested: "", now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ymd).toBe("2026-09-29");
  });

  it("accepts an explicit past date and returns UTC midnight for a bare date", () => {
    const r = resolvePaymentDate({ requested: "2026-09-15", now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ymd).toBe("2026-09-15");
      expect(r.date.toISOString()).toBe("2026-09-15T00:00:00.000Z");
      expect(r.source).toBe("requested");
    }
  });

  it("accepts today's date", () => {
    const r = resolvePaymentDate({ requested: "2026-09-29", now: NOW });
    expect(r.ok).toBe(true);
  });

  it("rejects a future date", () => {
    const r = resolvePaymentDate({ requested: "2026-09-30", now: NOW });
    expect(r).toMatchObject({ ok: false, status: 422, code: "PAYMENT_DATE_IN_FUTURE" });
  });

  it("uses the UAE calendar day: 01:00 UAE on the 30th already allows the 30th", () => {
    // 2026-09-29T21:00Z is 2026-09-30 01:00 in the UAE.
    const r = resolvePaymentDate({ requested: "2026-09-30", now: new Date("2026-09-29T21:00:00Z") });
    expect(r.ok).toBe(true);
  });

  it("accepts a prepayment: a payment dated long before any document is recorded on its real date", () => {
    const r = resolvePaymentDate({ requested: "2026-08-01", now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ymd).toBe("2026-08-01");
  });

  it("accepts a bank-date fallback that precedes the document (deposit)", () => {
    const r = resolvePaymentDate({ fallback: new Date("2026-08-20T00:00:00Z"), now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ymd).toBe("2026-08-20");
  });

  it("does not know a before-document rule any more (a stray documentDate is ignored)", () => {
    const r = resolvePaymentDate({
      requested: "2026-08-31",
      documentDate: "2026-09-01",
      now: NOW,
    } as Parameters<typeof resolvePaymentDate>[0]);
    expect(r.ok).toBe(true);
  });

  it("rejects unparseable and impossible dates", () => {
    expect(resolvePaymentDate({ requested: "garbage", now: NOW })).toMatchObject({
      ok: false,
      status: 400,
      code: "PAYMENT_DATE_INVALID",
    });
    expect(resolvePaymentDate({ requested: "2026-02-30", now: NOW })).toMatchObject({
      ok: false,
      code: "PAYMENT_DATE_INVALID",
    });
  });

});
