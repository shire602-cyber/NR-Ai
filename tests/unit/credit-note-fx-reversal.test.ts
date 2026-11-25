// F07 — credit-note reversals in the AED ledger: original rate, tax-treatment
// split, and exact clearing on the final credit. Expected values are computed
// by hand below, independently of the implementation.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  addLegs,
  planCreditNoteReversal,
  sumLegs,
  ZERO_LEGS,
  type ReversalLegs,
} from "../../server/services/credit-note-posting";

// Fixture: USD invoice @ 3.6725 AED/USD
//   line A  standard  1 × 700.00  → net 700.00, VAT 35.00
//   line B  zero-rated 1 × 300.00 → net 300.00, VAT 0
//   subtotal 1,000.00 · VAT 35.00 · total 1,035.00 USD
// Original AED posting (invoice-posting.service):
//   subtotal AED = round(1000 × 3.6725) = 3,672.50
//   VAT AED      = round(35 × 3.6725)   = 128.54 (128.5375)
//   zero-rated   = round(300 × 3.6725)  = 1,101.75
//   standard     = 3,672.50 − 1,101.75  = 2,570.75
//   A/R          = 3,672.50 + 128.54    = 3,801.04
const RATE = 3.6725;
const original: ReversalLegs = { ar: 3801.04, standardRevenue: 2570.75, zeroRated: 1101.75, vat: 128.54 };

describe("F07 planCreditNoteReversal — foreign currency", () => {
  it("partial credit converts at the original rate and keeps the tax split", () => {
    // Credit half of line A: 1 × 350.00 standard → net 350, VAT 17.50, total 367.50 USD
    const legs = planCreditNoteReversal({
      rate: RATE,
      doc: { subtotal: 350, vatAmount: 17.5, total: 367.5 },
      zeroRatedNetDoc: 0,
      isFinal: false,
      originalPosted: original,
      priorReversed: ZERO_LEGS,
    });
    // 350 × 3.6725 = 1,285.375 → 1,285.38 ; 17.5 × 3.6725 = 64.26875 → 64.27
    expect(legs).toEqual({ standardRevenue: 1285.38, zeroRated: 0, vat: 64.27, ar: 1349.65 });
    // Old behaviour posted the USD figure (367.50) as AED — a 982.15 AED gap.
    expect(legs.ar).not.toBe(367.5);
  });

  it("final credit clears every leg to the fil after a partial credit", () => {
    const first: ReversalLegs = { standardRevenue: 1285.38, zeroRated: 0, vat: 64.27, ar: 1349.65 };
    const final = planCreditNoteReversal({
      rate: RATE,
      // Remaining document: net 650 (350 std + 300 zero), VAT 17.50, total 667.50 USD
      doc: { subtotal: 650, vatAmount: 17.5, total: 667.5 },
      zeroRatedNetDoc: 300,
      isFinal: true,
      originalPosted: original,
      priorReversed: first,
    });
    // Remaining posted: std 2,570.75 − 1,285.38 = 1,285.37 ; zero 1,101.75 ; VAT 128.54 − 64.27 = 64.27
    expect(final).toEqual({ standardRevenue: 1285.37, zeroRated: 1101.75, vat: 64.27, ar: 2451.39 });
    const total = addLegs(first, final);
    expect(total).toEqual(original); // A/R, revenue, zero-rated and VAT all net to zero
    // A naive conversion of the remaining doc would leave a residual:
    // 350 × 3.6725 = 1,285.38 (≠ 1,285.37) — the 0.01 is rounding, not FX.
    expect(Math.round(350 * RATE * 100) / 100).toBe(1285.38);
  });

  it("partial credit never reverses more than is still posted on a leg", () => {
    const legs = planCreditNoteReversal({
      rate: RATE,
      doc: { subtotal: 350, vatAmount: 17.5, total: 367.5 },
      zeroRatedNetDoc: 0,
      isFinal: false,
      originalPosted: original,
      priorReversed: { ar: 2451.39, standardRevenue: 2000, zeroRated: 0, vat: 100 },
    });
    expect(legs.standardRevenue).toBe(570.75);
    expect(legs.vat).toBe(28.54);
  });

  it("AED invoice: rate 1, full credit equals the original legs", () => {
    const aed: ReversalLegs = { ar: 1050, standardRevenue: 1000, zeroRated: 0, vat: 50 };
    expect(
      planCreditNoteReversal({
        rate: 1,
        doc: { subtotal: 1000, vatAmount: 50, total: 1050 },
        zeroRatedNetDoc: 0,
        isFinal: true,
        originalPosted: aed,
        priorReversed: ZERO_LEGS,
      })
    ).toEqual(aed);
  });

  it("legacy invoice with no posted journal falls back to converted amounts", () => {
    expect(
      planCreditNoteReversal({
        rate: RATE,
        doc: { subtotal: 1000, vatAmount: 35, total: 1035 },
        zeroRatedNetDoc: 300,
        isFinal: true,
        originalPosted: null,
        priorReversed: ZERO_LEGS,
      })
    ).toEqual({ standardRevenue: 2570.75, zeroRated: 1101.75, vat: 128.54, ar: 3801.04 });
  });
});

describe("F07 sumLegs reads posted journal lines", () => {
  const acc = { ar: "AR", revenue: "REV", zeroRated: "ZR", vat: "VAT" };
  it("sums an invoice posting (credit-side revenue) and a credit note (debit-side)", () => {
    const invoiceLines = [
      { accountId: "AR", debit: "3801.04", credit: "0" },
      { accountId: "REV", debit: 0, credit: 2570.75 },
      { accountId: "ZR", debit: 0, credit: 1101.75 },
      { accountId: "VAT", debit: 0, credit: 128.54 },
    ];
    expect(sumLegs(invoiceLines, acc, "credit")).toEqual(original);
    const cnLines = [
      { accountId: "REV", debit: 1285.38, credit: 0 },
      { accountId: "VAT", debit: 64.27, credit: 0 },
      { accountId: "AR", debit: 0, credit: 1349.65 },
    ];
    expect(sumLegs(cnLines, acc, "debit")).toEqual({
      ar: 1349.65,
      standardRevenue: 1285.38,
      zeroRated: 0,
      vat: 64.27,
    });
  });
});

describe("F07 route wiring (source invariants)", () => {
  const src = readFileSync("server/routes/invoices.routes.ts", "utf8");
  it("credit-note JE uses the planned AED legs and stores rate + base amount", () => {
    expect(src).toContain("planCreditNoteReversal({");
    expect(src).toContain("exchangeRate: cnRate,");
    expect(src).toContain("baseCurrencyAmount: -reversal.ar,");
    expect(src).toContain("credit: reversal.ar,");
    expect(src).toContain("Reverse zero-rated sales");
  });
  it("void reversal mirrors the original posted AED lines", () => {
    expect(src).toContain("const postedLines = await storage.getJournalLinesByEntryId(originalEntry.id);");
    expect(src).toMatch(/debit: Number\(l\.credit\) \|\| 0,\s*credit: Number\(l\.debit\) \|\| 0,/);
  });
});
