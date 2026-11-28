import { describe, expect, it, vi } from "vitest";
import {
  receiptExtractionSchema,
  runStructured,
  sanityCheckReceipt,
  StructuredOutputError,
  normalizeModelConfidence,
  RECEIPT_JSON_SCHEMA,
} from "../../server/services/ai/structured-output";
import { deriveConfidenceBand } from "../../shared/receipt-confidence";

const TODAY = "2026-11-15";

const valid = {
  merchant: "Spinneys",
  date: "2026-11-10",
  subtotal: 100,
  vatPercentage: 5,
  vatAmount: 5,
  total: 105,
  currency: "AED",
  category: "Other",
  lineItems: [],
  confidence: 0.9,
};

const sanity = (d: any) => sanityCheckReceipt(d, { today: TODAY });

describe("R05-22 structured output", () => {
  it("R05-22 accepts a valid extraction and parses fenced JSON", async () => {
    const result = await runStructured({
      schema: receiptExtractionSchema,
      sanity,
      call: async () => "```json\n" + JSON.stringify(valid) + "\n```",
    });
    expect(result.attempts).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.data.total).toBe(105);
  });

  it("R05-22 retries once with validator feedback when the first reply is invalid JSON", async () => {
    const call = vi
      .fn<(feedback?: string) => Promise<unknown>>()
      .mockResolvedValueOnce("sorry, here is your receipt: total is 105")
      .mockResolvedValueOnce(JSON.stringify(valid));
    const result = await runStructured({ schema: receiptExtractionSchema, sanity, call });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][0]).toBeUndefined();
    expect(call.mock.calls[1][0]).toMatch(/could not be parsed|valid JSON/i);
    expect(result.attempts).toBe(2);
  });

  it("R05-22 retries when the schema is violated, then throws StructuredOutputError", async () => {
    const call = vi.fn(async () => JSON.stringify({ merchant: "", total: "abc" }));
    await expect(
      runStructured({ schema: receiptExtractionSchema, sanity, call })
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(call).toHaveBeenCalledTimes(2); // one retry only
  });

  it("R05-22 retries on a failed sanity check and keeps the corrected attempt", async () => {
    const bad = { ...valid, total: 500 }; // 100 + 5 != 500
    const call = vi
      .fn<(feedback?: string) => Promise<unknown>>()
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(valid);
    const result = await runStructured({ schema: receiptExtractionSchema, sanity, call });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0]).toMatch(/does not equal total/);
    expect(result.data.total).toBe(105);
    expect(result.issues).toEqual([]);
  });

  it("R05-22 returns the data with remaining sanity errors when the retry does not fix them", async () => {
    const bad = { ...valid, total: 500 };
    const result = await runStructured({
      schema: receiptExtractionSchema,
      sanity,
      call: async () => bad,
    });
    expect(result.attempts).toBe(2);
    expect(result.issues.map((i) => i.code)).toContain("AMOUNT_MISMATCH");
    expect(deriveConfidenceBand({ extractionConfidence: 0.99, issues: result.issues }).band).toBe(
      "low"
    );
  });

  it("R05-22 sanity: subtotal + VAT must be approximately the total", () => {
    expect(sanity({ ...valid }).filter((i) => i.severity === "error")).toEqual([]);
    expect(sanity({ ...valid, total: 105.04 }).filter((i) => i.severity === "error")).toEqual([]);
    expect(sanity({ ...valid, total: 120 }).map((i) => i.code)).toContain("AMOUNT_MISMATCH");
  });

  it("R05-22 sanity: date window rejects future and ancient dates", () => {
    expect(sanity({ ...valid, date: "2027-03-01" }).map((i) => i.code)).toContain("DATE_FUTURE");
    expect(sanity({ ...valid, date: "2001-03-01" }).map((i) => i.code)).toContain("DATE_ANCIENT");
    expect(sanity({ ...valid, date: "15/06/2026" }).map((i) => i.code)).toContain("DATE_FORMAT");
    expect(sanity({ ...valid, date: TODAY }).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("R05-22 sanity: currency must be an ISO 4217 code", () => {
    expect(sanity({ ...valid, currency: "dirhams" }).map((i) => i.code)).toContain(
      "CURRENCY_INVALID"
    );
    expect(sanity({ ...valid, currency: "XXX" }).map((i) => i.code)).toContain("CURRENCY_INVALID");
    expect(sanity({ ...valid, currency: "usd" }).map((i) => i.code)).not.toContain(
      "CURRENCY_INVALID"
    );
  });

  it("R05-17 sanity: flags an invalid supplier TRN as a warning", () => {
    const issues = sanity({ ...valid, supplierTrn: "12345" });
    expect(issues.find((i) => i.code === "TRN_INVALID")?.severity).toBe("warning");
    expect(sanity({ ...valid, supplierTrn: "100123456700003" }).map((i) => i.code)).not.toContain(
      "TRN_INVALID"
    );
  });

  it("R05-22 coerces string amounts with thousands separators", () => {
    const parsed = receiptExtractionSchema.parse({
      ...valid,
      total: "1,234.56",
      subtotal: "1,175.77",
    });
    expect(parsed.total).toBe(1234.56);
  });

  it("R05-22 the strict JSON schema requires every property and forbids extras", () => {
    expect(RECEIPT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...RECEIPT_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(RECEIPT_JSON_SCHEMA.properties).sort()
    );
  });
});

describe("R05-15 confidence is never defaulted", () => {
  it("R05-15 a missing or invalid confidence is 0 (low), not 0.85", () => {
    expect(normalizeModelConfidence(undefined)).toBe(0);
    expect(normalizeModelConfidence(null)).toBe(0);
    expect(normalizeModelConfidence("high")).toBe(0);
    expect(normalizeModelConfidence(NaN)).toBe(0);
    expect(normalizeModelConfidence(1.7)).toBe(1);
    expect(deriveConfidenceBand({ extractionConfidence: undefined }).band).toBe("low");
  });

  it("R05-23 bands: high / review / low from confidence, agreement and validation", () => {
    expect(deriveConfidenceBand({ extractionConfidence: 0.95 }).band).toBe("high");
    expect(deriveConfidenceBand({ extractionConfidence: 0.7 }).band).toBe("review");
    expect(deriveConfidenceBand({ extractionConfidence: 0.3 }).band).toBe("low");
    // classifier disagreement caps a confident extraction at review
    const disagree = deriveConfidenceBand({
      extractionConfidence: 0.95,
      classifierConfidence: 0.9,
      classifierAgrees: false,
    });
    expect(disagree.band).toBe("review");
    expect(disagree.reasons.join(" ")).toMatch(/disagree/i);
    // any warning prevents "high"; any error forces "low"
    expect(
      deriveConfidenceBand({
        extractionConfidence: 0.95,
        issues: [{ code: "TRN_INVALID", severity: "warning", message: "bad trn" }],
      }).band
    ).toBe("review");
    expect(
      deriveConfidenceBand({
        extractionConfidence: 0.95,
        issues: [{ code: "AMOUNT_MISMATCH", severity: "error", message: "mismatch" }],
      }).band
    ).toBe("low");
  });
});

describe("null VAT is 'not printed' for the sanity check and the retry message", () => {
  it("net + gross with a null VAT is not an AMOUNT_MISMATCH", () => {
    const codes = sanityCheckReceipt(
      { subtotal: 100, vatAmount: null, total: 105, date: "2026-11-10" },
      { today: "2026-11-12" }
    ).map((i) => i.code);
    expect(codes).not.toContain("AMOUNT_MISMATCH");
    // An explicit 0 VAT is printed, so the gap is still a mismatch.
    const zero = sanityCheckReceipt(
      { subtotal: 100, vatAmount: 0, total: 105, date: "2026-11-10" },
      { today: "2026-11-12" }
    ).map((i) => i.code);
    expect(zero).toContain("AMOUNT_MISMATCH");
  });

  it("the retry feedback only corrects printed figures and never invites filling in VAT", async () => {
    const feedbacks: Array<string | undefined> = [];
    const good = { merchant: "X", total: 105, subtotal: 100, vatAmount: 5 };
    await runStructured({
      schema: receiptExtractionSchema,
      call: async (fb) => {
        feedbacks.push(fb);
        return feedbacks.length === 1 ? { ...good, vatAmount: 0 } : good;
      },
      sanity: (d) => sanityCheckReceipt(d, { today: "2026-11-12" }),
    });
    expect(feedbacks[1]).toMatch(/PRINTED/);
    expect(feedbacks[1]).toMatch(/Never calculate, estimate or fill in/);
  });
});
