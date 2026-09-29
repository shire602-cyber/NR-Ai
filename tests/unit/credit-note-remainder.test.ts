import { describe, it, expect } from "vitest";
import {
  bucketLines,
  compareBuckets,
  effectiveRevenueAccountId,
  findBucketExcess,
  remainderBuckets,
  remainingVatBuckets,
  remainingByAccount,
  remainingLines,
  reverseToZero,
  resolveCreditLineAccount,
} from "../../server/services/credit-note-remainder.service";

const DEFAULT = "acc-4010";
const ZERO = "acc-4060";
const A_ACC = "acc-4020";
const C_ACC = "acc-4030";
const ctx = { defaultAccountId: DEFAULT, zeroRatedAccountId: ZERO };

const orig = (id: string, net: number, acct: string | null, vatRate = 0.05) => ({
  id,
  description: id,
  quantity: 1,
  unitPrice: net,
  vatRate,
  vatSupplyType: vatRate > 0 ? "standard_rated" : "zero_rated",
  revenueAccountId: acct,
});
const credit = (net: number, acct: string | null, vatRate = 0.05) => ({
  description: "[Credit] x",
  quantity: -1,
  unitPrice: net,
  vatRate,
  revenueAccountId: acct,
});
const byAcct = (r: ReturnType<typeof remainingByAccount>) =>
  Object.fromEntries(r.accounts.map((a) => [a.accountId, a.net]));

describe("effectiveRevenueAccountId", () => {
  it("explicit account wins, then 4060 for 0% lines, then the default", () => {
    expect(effectiveRevenueAccountId({ vatRate: 0.05, revenueAccountId: A_ACC }, ctx)).toBe(A_ACC);
    expect(effectiveRevenueAccountId({ vatRate: 0, revenueAccountId: null }, ctx)).toBe(ZERO);
    expect(effectiveRevenueAccountId({ vatRate: 0.05, revenueAccountId: null }, ctx)).toBe(DEFAULT);
    expect(effectiveRevenueAccountId({ vatRate: 0 }, { defaultAccountId: DEFAULT })).toBe(DEFAULT);
  });
});

describe("remainingByAccount", () => {
  const originals = [orig("A", 100, A_ACC), orig("B", 100, null)];

  it("with nothing credited the remainder is what was posted", () => {
    const r = remainingByAccount({ originalLines: originals, creditedLines: [], ctx });
    expect(byAcct(r)).toEqual({ [A_ACC]: 100, [DEFAULT]: 100 });
    expect(r.vat).toBe(10);
  });

  it("proof scenario: partial credit for A only, then the full credit reverses exactly the rest", () => {
    // Old behaviour scaled every line by one factor (0.5) and reversed
    // 4020 by 50 too much and 4010 by 50 too little.
    const r = remainingByAccount({
      originalLines: originals,
      creditedLines: [credit(100, A_ACC)],
      ctx,
    });
    expect(byAcct(r)).toEqual({ [DEFAULT]: 100 });
    expect(r.accounts.find((a) => a.accountId === A_ACC)).toBeUndefined();
    expect(r.vat).toBe(5);
  });

  it("two successive partials", () => {
    const three = [orig("A", 100, A_ACC), orig("B", 100, null), orig("C", 100, C_ACC)];
    const p1 = [credit(40, A_ACC)];
    const p2 = [credit(60, A_ACC), credit(50, DEFAULT)];
    const afterP1 = remainingByAccount({ originalLines: three, creditedLines: p1, ctx });
    expect(byAcct(afterP1)).toEqual({ [A_ACC]: 60, [DEFAULT]: 100, [C_ACC]: 100 });
    const afterP2 = remainingByAccount({ originalLines: three, creditedLines: [...p1, ...p2], ctx });
    expect(byAcct(afterP2)).toEqual({ [DEFAULT]: 50, [C_ACC]: 100 });
    expect(afterP2.vat).toBe(7.5);
  });

  it("never returns a negative remainder when an account was over-credited", () => {
    const r = remainingByAccount({
      originalLines: originals,
      creditedLines: [credit(150, A_ACC)],
      ctx,
    });
    expect(byAcct(r)).toEqual({ [DEFAULT]: 100 });
    expect(r.accounts.every((a) => a.net >= 0)).toBe(true);
    expect(r.vat).toBeGreaterThanOrEqual(0);
  });

  it("resolves an unset credit-line account the same way the posting did (0% -> 4060)", () => {
    const zeroOrig = [orig("Z", 100, null, 0)];
    const r = remainingByAccount({
      originalLines: zeroOrig,
      creditedLines: [credit(30, null, 0)],
      ctx,
    });
    expect(byAcct(r)).toEqual({ [ZERO]: 70 });
    expect(r.vat).toBe(0);
  });
});

describe("remainingLines (document lines of the capped credit note)", () => {
  it("consumes credited amounts per account+rate and keeps the rest per original line", () => {
    const originals = [orig("A", 100, A_ACC), orig("B", 100, null, 0), orig("C", 100, null)];
    const lines = remainingLines({
      originalLines: originals,
      creditedLines: [credit(100, A_ACC), credit(40, null, 0)],
      ctx,
    });
    expect(lines.map((l) => [l.originalLineId, l.net])).toEqual([
      ["B", 60],
      ["C", 100],
    ]);
    expect(lines.find((l) => l.originalLineId === "C")?.revenueAccountId).toBe(DEFAULT);
    expect(lines.find((l) => l.originalLineId === "B")?.revenueAccountId).toBe(ZERO);
  });
});

describe("resolveCreditLineAccount", () => {
  const originals = [
    { ...orig("11111111-1111-4111-8111-111111111111", 100, A_ACC), description: "Consulting" },
    { ...orig("22222222-2222-4222-8222-222222222222", 100, null), description: "Consulting" },
  ];
  it("resolves from the original line id first (even when descriptions collide)", () => {
    const r = resolveCreditLineAccount(
      { description: "Consulting", vatRate: 0.05, originalLineId: originals[1].id },
      originals,
      ctx
    );
    expect(r).toEqual({ ok: true, accountId: DEFAULT });
  });
  it("id beats the description that would have matched another line", () => {
    const r = resolveCreditLineAccount(
      { description: "Consulting", vatRate: 0.05, originalLineId: originals[0].id },
      originals,
      ctx
    );
    expect(r).toEqual({ ok: true, accountId: A_ACC });
  });
  it("an id that is not a line of this invoice is an error", () => {
    const r = resolveCreditLineAccount(
      { description: "x", vatRate: 0.05, originalLineId: "33333333-3333-4333-8333-333333333333" },
      originals,
      ctx
    );
    expect(r.ok).toBe(false);
  });
  it("falls back to an explicit account, then to description, only when no id is given", () => {
    expect(
      resolveCreditLineAccount({ description: "x", vatRate: 0.05, revenueAccountId: C_ACC }, originals, ctx)
    ).toEqual({ ok: true, accountId: C_ACC });
    expect(resolveCreditLineAccount({ description: "Consulting", vatRate: 0.05 }, originals, ctx)).toEqual({
      ok: true,
      accountId: A_ACC,
    });
  });
  it("a line that matches no original line uses the default account explicitly", () => {
    expect(resolveCreditLineAccount({ description: "unknown", vatRate: 0.05 }, originals, ctx)).toEqual({
      ok: true,
      accountId: DEFAULT,
    });
    // even for 0%: no original line means no 4060 inference
    expect(resolveCreditLineAccount({ description: "unknown", vatRate: 0 }, originals, ctx)).toEqual({
      ok: true,
      accountId: DEFAULT,
    });
  });
});

describe("reverseToZero (AED journal remainder)", () => {
  const AR = "ar";
  const VAT = "vat";
  const labels = { revenue: "rev", vat: "vat", ar: "ar" };
  const posted = [
    { accountId: AR, debit: 210, credit: 0 },
    { accountId: A_ACC, debit: 0, credit: 100 },
    { accountId: DEFAULT, debit: 0, credit: 100 },
    { accountId: VAT, debit: 0, credit: 10 },
  ];
  const partial = [
    { accountId: A_ACC, debit: 100, credit: 0 },
    { accountId: VAT, debit: 5, credit: 0 },
    { accountId: AR, debit: 0, credit: 105 },
  ];
  const net = (lines: Array<{ accountId: string; debit: number; credit: number }>) => {
    const m: Record<string, number> = {};
    for (const l of lines) m[l.accountId] = Math.round(((m[l.accountId] ?? 0) + l.debit - l.credit) * 100) / 100;
    return m;
  };

  it("void: exactly negates the original entry", () => {
    const lines = reverseToZero(posted, { arAccountId: AR, vatAccountId: VAT, labels });
    const total = net([...posted, ...lines]);
    expect(Object.values(total).every((v) => v === 0)).toBe(true);
    expect(lines.find((l) => l.accountId === AR)).toMatchObject({ debit: 0, credit: 210 });
  });

  it("final credit note: reverses posted minus what earlier credit notes reversed", () => {
    const lines = reverseToZero([...posted, ...partial], { arAccountId: AR, vatAccountId: VAT, labels });
    expect(lines.find((l) => l.accountId === A_ACC)).toBeUndefined();
    expect(lines.find((l) => l.accountId === DEFAULT)).toMatchObject({ debit: 100, credit: 0 });
    expect(lines.find((l) => l.accountId === VAT)).toMatchObject({ debit: 5, credit: 0 });
    expect(lines.find((l) => l.accountId === AR)).toMatchObject({ debit: 0, credit: 105 });
    expect(Object.values(net([...posted, ...partial, ...lines])).every((v) => v === 0)).toBe(true);
  });

  it("is balanced and labels legs by account role", () => {
    const lines = reverseToZero(posted, { arAccountId: AR, vatAccountId: VAT, labels });
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBeCloseTo(cr, 10);
    expect(lines.find((l) => l.accountId === AR)?.description).toBe("ar");
    expect(lines.find((l) => l.accountId === VAT)?.description).toBe("vat");
    expect(lines.find((l) => l.accountId === DEFAULT)?.description).toBe("rev");
  });

  it("uses the AED figures as posted (USD 100 + 5% @ 3.6725: 385.61 / 367.25 / 18.36)", () => {
    const usd = [
      { accountId: AR, debit: 385.61, credit: 0 },
      { accountId: DEFAULT, debit: 0, credit: 367.25 },
      { accountId: VAT, debit: 0, credit: 18.36 },
    ];
    const lines = reverseToZero(usd, { arAccountId: AR, vatAccountId: VAT, labels });
    expect(lines.find((l) => l.accountId === AR)).toMatchObject({ credit: 385.61 });
    expect(lines.find((l) => l.accountId === DEFAULT)).toMatchObject({ debit: 367.25 });
    expect(lines.find((l) => l.accountId === VAT)).toMatchObject({ debit: 18.36 });
  });
});


// ─── VAT buckets: document lines must agree with what the journal reverses ───

describe("bucketLines", () => {
  it("groups by (rate, supply type) with absolute net and VAT", () => {
    const b = bucketLines(
      [
        { quantity: -1, unitPrice: 100, vatRate: 0.05 },
        { quantity: 2, unitPrice: 50, vatRate: 0.05 },
        { quantity: -1, unitPrice: 105, vatRate: 0, vatSupplyType: "zero_rated" },
        { quantity: 1, unitPrice: 30, vatRate: 0, vatSupplyType: "exempt" },
      ],
      ctx
    );
    const by = Object.fromEntries(b.map((x) => [`${x.vatRate}|${x.supplyType}`, x]));
    expect(by["0.05|standard_rated"]).toMatchObject({ net: 200, vat: 10 });
    expect(by["0|zero_rated"]).toMatchObject({ net: 105, vat: 0 });
    expect(by["0|exempt"]).toMatchObject({ net: 30, vat: 0 });
    expect(b).toHaveLength(3);
  });

  it("splits by revenue account when asked", () => {
    const b = bucketLines(
      [
        { quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: A_ACC },
        { quantity: 1, unitPrice: 100, vatRate: 0.05 },
      ],
      ctx,
      { byAccount: true }
    );
    expect(Object.fromEntries(b.map((x) => [x.accountId, x.net]))).toEqual({ [A_ACC]: 100, [DEFAULT]: 100 });
  });

  it("a taxed line is standard-rated whatever type was stored", () => {
    const b = bucketLines([{ quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "exempt" }], ctx);
    expect(b[0].supplyType).toBe("standard_rated");
  });
});

describe("remainingVatBuckets / findBucketExcess (partial credit cap per VAT bucket)", () => {
  // proof scenario: 100 @5% + 105 @0% = 210
  const originals = [orig("S", 100, null, 0.05), orig("Z", 105, null, 0)];

  it("remaining is original minus credited per (rate, supply type)", () => {
    const rem = remainingVatBuckets({ originalLines: originals, creditedLines: [credit(40, null, 0.05)], ctx });
    const by = Object.fromEntries(rem.map((x) => [`${x.vatRate}|${x.supplyType}`, x]));
    expect(by["0.05|standard_rated"]).toMatchObject({ net: 60, vat: 3 });
    expect(by["0|zero_rated"]).toMatchObject({ net: 105, vat: 0 });
  });

  it("a credit of 200 @5% exceeds what remains at 5% (100) though the total fits", () => {
    const rem = remainingVatBuckets({ originalLines: originals, creditedLines: [], ctx });
    const req = bucketLines([{ quantity: -1, unitPrice: 200, vatRate: 0.05 }], ctx);
    const excess = findBucketExcess(rem, req);
    expect(excess).not.toBeNull();
    expect(excess).toMatchObject({ vatRate: 0.05, supplyType: "standard_rated" });
  });

  it("a credit within each bucket is fine, within the 0.01 tolerance", () => {
    const rem = remainingVatBuckets({ originalLines: originals, creditedLines: [], ctx });
    const ok = bucketLines(
      [
        { quantity: -1, unitPrice: 100, vatRate: 0.05 },
        { quantity: -1, unitPrice: 105.01, vatRate: 0, vatSupplyType: "zero_rated" },
      ],
      ctx
    );
    expect(findBucketExcess(rem, ok)).toBeNull();
    const over = bucketLines([{ quantity: -1, unitPrice: 105.5, vatRate: 0, vatSupplyType: "zero_rated" }], ctx);
    expect(findBucketExcess(rem, over)).not.toBeNull();
  });

  it("a bucket that does not exist on the invoice has nothing to credit", () => {
    const rem = remainingVatBuckets({ originalLines: originals, creditedLines: [], ctx });
    const req = bucketLines([{ quantity: -1, unitPrice: 10, vatRate: 0, vatSupplyType: "exempt" }], ctx);
    expect(findBucketExcess(rem, req)).toMatchObject({ supplyType: "exempt" });
  });

  it("earlier credit notes are deducted", () => {
    const rem = remainingVatBuckets({ originalLines: originals, creditedLines: [credit(70, null, 0.05)], ctx });
    const req = bucketLines([{ quantity: -1, unitPrice: 40, vatRate: 0.05 }], ctx);
    expect(findBucketExcess(rem, req)).not.toBeNull();
  });
});

describe("remainderBuckets + compareBuckets (final credit note lines)", () => {
  const originals = [orig("S", 100, null, 0.05), orig("Z", 105, null, 0)];

  it("the remainder with nothing credited is the whole invoice, per rate/type/account", () => {
    const exp = remainderBuckets({ originalLines: originals, creditedLines: [], ctx });
    const by = Object.fromEntries(exp.map((x) => [`${x.vatRate}|${x.supplyType}|${x.accountId}`, x.net]));
    expect(by).toEqual({ [`0.05|standard_rated|${DEFAULT}`]: 100, [`0|zero_rated|${ZERO}`]: 105 });
  });

  it("proof scenario: 200 @5% does NOT match 100 @5% + 105 @0%", () => {
    const exp = remainderBuckets({ originalLines: originals, creditedLines: [], ctx });
    const supplied = bucketLines([{ quantity: -1, unitPrice: 200, vatRate: 0.05 }], ctx, { byAccount: true });
    const r = compareBuckets(exp, supplied);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.expected).toHaveLength(2);
  });

  it("the exact mix matches, also when the split is into several lines", () => {
    const exp = remainderBuckets({ originalLines: originals, creditedLines: [], ctx });
    const supplied = bucketLines(
      [
        { quantity: -1, unitPrice: 60, vatRate: 0.05, revenueAccountId: DEFAULT },
        { quantity: -1, unitPrice: 40, vatRate: 0.05, revenueAccountId: DEFAULT },
        { quantity: -1, unitPrice: 105, vatRate: 0, vatSupplyType: "zero_rated", revenueAccountId: ZERO },
      ],
      ctx,
      { byAccount: true }
    );
    expect(compareBuckets(exp, supplied)).toEqual({ ok: true });
  });

  it("the remainder after a partial credit is what is left per bucket", () => {
    const exp = remainderBuckets({ originalLines: originals, creditedLines: [credit(30, null, 0.05)], ctx });
    const by = Object.fromEntries(exp.map((x) => [`${x.vatRate}`, x.net]));
    expect(by).toEqual({ "0.05": 70, "0": 105 });
  });

  it("invariant: credited buckets never exceed the invoice and equal it once fully credited", () => {
    const partial = [credit(30, null, 0.05)];
    const rest = remainderBuckets({ originalLines: originals, creditedLines: partial, ctx });
    const restLines = rest.map((b) => ({
      quantity: -1,
      unitPrice: b.net,
      vatRate: b.vatRate,
      vatSupplyType: b.supplyType,
      revenueAccountId: b.accountId,
    }));
    const all = bucketLines([...partial, ...restLines], ctx);
    const inv = bucketLines(originals, ctx);
    expect(compareBuckets(inv, all)).toEqual({ ok: true });
    for (const a of all) {
      const i = inv.find((x) => x.vatRate === a.vatRate && x.supplyType === a.supplyType)!;
      expect(a.net).toBeLessThanOrEqual(i.net + 0.005);
      expect(a.vat).toBeLessThanOrEqual(i.vat + 0.005);
    }
  });
});
