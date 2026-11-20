/**
 * Accounting round A integration follow-ups (A4 notes on A3's statements):
 *  - H3: deferred tax expense (5210) is presented with current tax (5200) in the income-tax
 *    section after profit before tax (IAS 12.58, IAS 1.82(d)), never in operating expenses.
 *  - C5: deferred tax assets / liabilities (1270 / 2260) and the non-current gratuity provision
 *    (2036) are non-cash parts of operating profit in the indirect cash flow (IAS 7.35, 7.20),
 *    not investing or financing flows.
 * (L7, revaluation eliminating accumulated depreciation, is asserted in a3-ifrs-statements S7.)
 */
import { describe, expect, it } from "vitest";
import { postJournalEntry, useHarness } from "./harness";

const h = useHarness();

describe("A3 x A4: deferred tax and gratuity in the statements", () => {
  it("5210 sits in income tax; 1270 / 2260 / 2036 movements stay in operating", async () => {
    const t = await h.createTenant({ name: "ARoundA4", planId: "professional" });
    const cid = t.company.id;
    for (const [code, nameEn, type, subType] of [
      ["5200", "Corporate Tax Expense", "expense", undefined],
      ["5210", "Deferred Tax Expense", "expense", undefined],
      ["2060", "Corporate Tax Payable", "liability", "current_liability"],
      ["1270", "Deferred Tax Asset", "asset", "non_current_asset"],
      ["2260", "Deferred Tax Liability", "liability", "non_current_liability"],
    ] as const) {
      const r = await t.as.post(`/api/companies/${cid}/accounts`, { code, nameEn, type, subType });
      expect(r.status, r.text).toBeLessThan(300);
    }
    await postJournalEntry(t, {
      date: "2026-03-31",
      lines: [
        { code: "1020", debit: 100_000 },
        { code: "4020", credit: 100_000 },
      ],
    });
    // End-of-service accrual (non-cash, payroll cost): Dr 5020 / Cr 2036.
    await postJournalEntry(t, {
      date: "2026-06-30",
      lines: [
        { code: "5020", debit: 5_000 },
        { code: "2036", credit: 5_000 },
      ],
    });
    // Current tax provision and deferred tax (DTA up 900 as income, DTL up 2,700 as expense).
    await postJournalEntry(t, {
      date: "2026-09-30",
      lines: [
        { code: "5200", debit: 1_000 },
        { code: "2060", credit: 1_000 },
      ],
    });
    await postJournalEntry(t, {
      date: "2026-09-30",
      lines: [
        { code: "1270", debit: 900 },
        { code: "5210", debit: 2_700 },
        { code: "5210", credit: 900 },
        { code: "2260", credit: 2_700 },
      ],
    });

    const pl = (
      await t.as.get(`/api/companies/${cid}/reports/profit-loss?from=2026-01-01&to=2026-09-30`)
    ).body;
    expect(pl.sections.incomeTax.lines.map((l: any) => l.accountCode).sort()).toEqual([
      "5200",
      "5210",
    ]);
    expect(pl.sections.operatingExpenses.lines.map((l: any) => l.accountCode)).not.toContain(
      "5210"
    );
    expect(pl.profitBeforeTax).toBe(95_000);
    expect(pl.incomeTaxExpense).toBe(2_800);
    expect(pl.netProfit).toBe(92_200);

    const r = await t.as.get(
      `/api/companies/${cid}/financial-statements/cash-flow?startDate=2026-01-01&endDate=2026-09-30`
    );
    expect(r.status, r.text).toBe(200);
    const cf = r.body;
    expect(cf.netCashChange).toBe(100_000);
    expect(cf.operating.total).toBe(100_000);
    expect(cf.investing.total).toBe(0);
    expect(cf.financing.total).toBe(0);
    expect(cf.investing.breakdown).toEqual([]);
    expect(cf.financing.breakdown).toEqual([]);
    const op = Object.fromEntries(
      cf.operating.breakdown.map((l: any) => [l.accountCode, l.amount])
    );
    expect(op).toMatchObject({ "1270": -900, "2260": 2_700, "2036": 5_000, "2060": 1_000 });
    expect(cf.cashProof.isBalanced).toBe(true);
  });
});
