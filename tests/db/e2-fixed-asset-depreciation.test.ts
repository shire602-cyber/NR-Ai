/**
 * E2 (J3-r2): depreciation is never future-dated (a month is recorded only after it ends, the
 * default is the last ended month), a disposal stops depreciation and is never dated in the
 * future (D2 N10), and the balance sheet never shows accumulated depreciation
 * (1240) as a positive asset.
 */
import { afterEach, describe, expect, it } from "vitest";
import { accountByCode, freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

async function glThrough(t: Tenant, code: string, asOf: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2 AND je.date::date <= $3`,
    [t.company.id, code, asOf]
  );
  return Number(rows[0].n) / 100;
}

/** Every value the statement reports for `code`, wherever it sits in the response. */
function amountsFor(node: unknown, code: string, out: number[] = []): number[] {
  if (Array.isArray(node)) node.forEach((n) => amountsFor(n, code, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const c = o.accountCode ?? o.code;
    if (c === code) {
      const v = o.amount ?? o.balance ?? o.value;
      if (typeof v === "number" || typeof v === "string") out.push(Number(v));
    }
    Object.values(o).forEach((v) => amountsFor(v, code, out));
  }
  return out;
}

describe("E2 (J3-r2) fixed-asset depreciation dates and disposal", () => {
  it("refuses a month that has not ended, defaults to the last ended month, and disposal stops depreciation", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "E2Dep" });
    const cid = t.company.id;
    const bank = await accountByCode(t, "1020");
    const asset = await t.as.post(`/api/companies/${cid}/fixed-assets`, {
      assetName: "Laptop",
      category: "computers",
      purchaseDate: "2026-09-01",
      purchaseCost: 12000,
      salvageValue: 0,
      usefulLifeYears: 1,
      depreciationMethod: "straight_line",
      paymentAccountId: bank.id,
    });
    expect(asset.status, asset.text).toBe(201);
    const id = asset.body.id as string;

    // November 2026 has not ended on 18 Nov: no entry dated 30 Nov.
    const nov = await t.as.post(`/api/fixed-assets/${id}/depreciate`, { month: 11, year: 2026 });
    expect(nov.status, nov.text).toBe(422);
    expect(nov.body.code).toBe("DEPRECIATION_PERIOD_NOT_ENDED");
    const run = await t.as.post(`/api/companies/${cid}/fixed-assets/run-depreciation`, {
      month: 11,
      year: 2026,
    });
    expect(run.status, run.text).toBe(422);
    expect(run.body.code).toBe("DEPRECIATION_PERIOD_NOT_ENDED");
    const future = await h.sql(
      `SELECT 1 FROM journal_entries WHERE company_id = $1 AND date::date > '2026-11-18'`,
      [cid]
    );
    expect(future).toHaveLength(0);

    // No month given: the last ended month (October), dated 31 Oct.
    const oct = await t.as.post(`/api/fixed-assets/${id}/depreciate`, {});
    expect(oct.status, oct.text).toBe(200);
    expect(oct.body.period).toEqual({ month: 10, year: 2026 });

    // D2 (N10): a disposal is never dated in the future. (D2 N6: a disposal dated before booked
    // depreciation now reverses that depreciation; tests/db/d2-accounting-round-d.test.ts.)
    const early = await t.as.post(`/api/fixed-assets/${id}/dispose`, {
      disposalDate: "2026-11-19",
      disposalAmount: 0,
    });
    expect(early.status, early.text).toBe(422);
    expect(early.body.code).toBe("DISPOSAL_DATE_IN_FUTURE");

    const sold = await t.as.post(`/api/fixed-assets/${id}/dispose`, {
      disposalDate: "2026-11-18",
      disposalAmount: 0,
    });
    expect(sold.status, sold.text).toBeLessThan(300);

    // Disposed: no more depreciation, single or bulk.
    const after = await t.as.post(`/api/fixed-assets/${id}/depreciate`, { month: 10, year: 2026 });
    expect(after.status).toBeGreaterThanOrEqual(400);
    const bulk = await t.as.post(`/api/companies/${cid}/fixed-assets/run-depreciation`, {
      month: 10,
      year: 2026,
    });
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body.posted).toBe(0);

    // 1240 is cleared, never a debit (positive asset), on the disposal date and after.
    for (const asOf of ["2026-10-31", "2026-11-18"]) {
      expect(await glThrough(t, "1240", asOf)).toBeLessThanOrEqual(0);
      const bs = await t.as.get(`/api/companies/${cid}/reports/balance-sheet?asOf=${asOf}`);
      expect(bs.status, bs.text).toBe(200);
      expect(bs.body.isBalanced).toBe(true);
      const shown = amountsFor(bs.body, "1240");
      // Before the disposal the contra-asset is on the statement (Sep + Oct), as a negative.
      if (asOf === "2026-10-31")
        expect(shown, JSON.stringify(bs.body).slice(0, 400)).toContain(-2000);
      for (const v of shown) expect(v).toBeLessThanOrEqual(0);
    }
    expect(await glThrough(t, "1240", "2026-11-18")).toBe(0);
  });
});
