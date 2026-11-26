// F07 — foreign-currency invoice and credit-note legs in the AED ledger, exercised through the
// LIVE posting helpers (invoice-posting.service: buildRevenueLines, revenueBuckets,
// creditBucketBaseAmounts). Expected values are hand-calculated, independent of the code.
//
// Fixture: USD invoice @ 3.6725 AED/USD
//   line A  standard    1 × 700.00 USD → VAT 35.00
//   line B  zero-rated  1 × 300.00 USD → VAT 0
//   original AED legs: standard revenue 700 × 3.6725 = 2,570.75
//                      zero-rated sales 300 × 3.6725 = 1,101.75
//                      output VAT        35 × 3.6725 =   128.5375 → 128.54
//                      A/R (sum)                       3,801.04
// Posting against a database (final credit clearing to the fil, void mirrors, refunds) is in
// tests/db/f07-fx-credit-payment.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRevenueLines,
  creditBucketBaseAmounts,
  creditNoteDate,
  revenueBuckets,
  toBase,
  type OriginalLeg,
} from "../../server/services/invoice-posting.service";
import { computeSalesDocument } from "../../server/services/document-totals.service";

const RATE = "3.6725";
const ACC = {
  ar: "AR",
  vatOutput: "VAT",
  revenue: {
    standard_sales: "REV",
    zero_rated_sales: "ZR",
    exempt_sales: "EX",
    out_of_scope_revenue: "OOS",
  },
} as const;
const line = (priceFils: number, supply: "standard_rated" | "zero_rated") => ({
  quantity: 1,
  unitPriceFils: priceFils,
  vatRate: supply === "standard_rated" ? 0.05 : 0,
  vatSupplyType: supply,
});

function posted(lines: ReturnType<typeof buildRevenueLines>) {
  const byAccount = (id: string) => {
    const l = lines.find((x) => x.accountId === id);
    return l ? (l.creditFils ?? 0) - (l.debitFils ?? 0) : 0;
  };
  const ar = lines.find((x) => x.accountId === "AR")!;
  return {
    ar: ar.debitFils,
    standard: byAccount("REV"),
    zeroRated: byAccount("ZR"),
    vat: byAccount("VAT"),
  };
}

const invoiceTotals = computeSalesDocument([
  line(70000, "standard_rated"),
  line(30000, "zero_rated"),
]);
const invoiceLines = buildRevenueLines({
  invoice: { number: "INV-1", customerName: "Acme", currency: "USD" },
  rate: RATE,
  totals: invoiceTotals,
  lines: [{}, {}],
  accounts: { ...ACC, revenue: { ...ACC.revenue } },
  baseCurrency: "AED",
});

describe("F07 A0: the original USD invoice posts AED legs at its own rate", () => {
  it("splits standard / zero-rated / VAT and debits A/R with their sum", () => {
    expect(posted(invoiceLines)).toEqual({
      ar: 380104,
      standard: 257075,
      zeroRated: 110175,
      vat: 12854,
    });
    // Every leg carries its USD amount so the foreign trial balance ties.
    const ar = invoiceLines.find((l) => l.accountId === "AR")!;
    expect(ar.foreignDebit).toBe("1035.00");
    expect(ar.exchangeRate).toBe(RATE);
  });
});

describe("F07 A1/A2: a partial credit converts at the ORIGINAL rate into the right accounts", () => {
  const creditTotals = computeSalesDocument([line(35000, "standard_rated")]);
  const buckets = revenueBuckets(creditTotals, [{}]);
  const legs: OriginalLeg[] = [
    {
      accountId: "REV",
      costCenterId: null,
      kind: "revenue",
      role: "standard_sales",
      remainingBase: 257075,
      remainingForeign: 70000,
    },
    {
      accountId: "ZR",
      costCenterId: null,
      kind: "revenue",
      role: "zero_rated_sales",
      remainingBase: 110175,
      remainingForeign: 30000,
    },
  ];

  it("USD 350 standard → AED 1,285.38 revenue (not 350, not today's rate); VAT USD 17.50 → 64.27", () => {
    expect(buckets).toHaveLength(1);
    expect(buckets[0].role).toBe("standard_sales");
    const base = creditBucketBaseAmounts(buckets, legs, RATE).get(buckets[0]);
    // 350 × 3.6725 = 1,285.375 → 1,285.38 (half up)
    expect(base).toBe(128538);
    // 17.50 × 3.6725 = 64.26875 → 64.27
    expect(toBase(creditTotals.vatFils, RATE)).toBe(6427);
    expect(creditTotals.vatFils).toBe(1750);
  });

  it("a zero-rated credit maps to the zero-rated role, never to standard revenue", () => {
    const zr = computeSalesDocument([line(10000, "zero_rated")]);
    const b = revenueBuckets(zr, [{}]);
    expect(b.map((x) => x.role)).toEqual(["zero_rated_sales"]);
    expect(creditBucketBaseAmounts(b, legs, RATE).get(b[0])).toBe(36725); // 100 × 3.6725
    expect(zr.vatFils).toBe(0);
  });

  it("partial standard credit + the remainder add up to the original posting to the fil", () => {
    // The final credit mirrors "original less prior credits" per leg (remaining mode in
    // postCreditNoteInTx); the partial's base is what that arithmetic subtracts.
    const partial = { standard: 128538, vat: 6427 };
    const remaining = {
      standard: 257075 - partial.standard,
      zeroRated: 110175,
      vat: 12854 - partial.vat,
    };
    expect(remaining).toEqual({ standard: 128537, zeroRated: 110175, vat: 6427 });
    // Naive conversion of the remaining USD 350 would give 128538: the 0.01 is rounding, which
    // the mirror absorbs, and is never booked as an exchange difference.
    expect(toBase(35000, RATE)).toBe(128538);
    expect(partial.standard + remaining.standard).toBe(257075);
  });
});

describe("F07 creditNoteDate: default is the Dubai business date, not the UTC date", () => {
  afterEach(() => vi.useRealTimers());
  it("22:30 UTC on 10 March is already 11 March in Dubai", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T22:30:00.000Z"));
    expect(creditNoteDate().toISOString()).toBe("2026-03-11T00:00:00.000Z");
    expect(creditNoteDate(null).toISOString()).toBe("2026-03-11T00:00:00.000Z");
  });
  it("an explicit date wins", () => {
    expect(creditNoteDate("2026-01-20").toISOString()).toBe("2026-01-20T00:00:00.000Z");
  });
});
