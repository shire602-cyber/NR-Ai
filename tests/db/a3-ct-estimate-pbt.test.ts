/**
 * A3 (H3) follow-up: the dashboard corporate-tax estimate and the cash-flow forecast's
 * corporate-tax outflow are computed on profit BEFORE tax. A posted CT provision (5200) is the
 * estimate's own result; deducting it from its own base understated the tax (the executive
 * summary was fixed the same way in A3).
 *
 * Revenue 1,000,000, operating expenses 345,000, CT provision 27,450 posted.
 * Profit before tax 655,000; CT = 9% x (655,000 - 375,000) = 25,200.
 * (Deducting the provision would give 9% x (627,550 - 375,000) = 22,729.50.)
 */
import { afterAll, describe, expect, it } from "vitest";
import { freezeTime, postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();
const restore = freezeTime("2026-11-17T08:00:00Z");
afterAll(() => restore());

async function seed(): Promise<Tenant> {
  const t = await h.createTenant({ name: "A3CT", planId: "professional" });
  const cid = t.company.id;
  for (const [code, nameEn, type, subType] of [
    ["5200", "Corporate Tax Expense", "expense", undefined],
    ["2060", "Corporate Tax Payable", "liability", "current_liability"],
  ] as const) {
    const r = await t.as.post(`/api/companies/${cid}/accounts`, { code, nameEn, type, subType });
    expect(r.status, r.text).toBeLessThan(300);
  }
  await postJournalEntry(t, {
    date: "2026-03-31",
    lines: [
      { code: "1020", debit: 1_000_000 },
      { code: "4020", credit: 1_000_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2026-03-31",
    lines: [
      { code: "5020", debit: 345_000 },
      { code: "1020", credit: 345_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2026-10-31",
    lines: [
      { code: "5200", debit: 27_450 },
      { code: "2060", credit: 27_450 },
    ],
  });
  return t;
}

describe("A3 H3: CT estimates are on profit before tax", () => {
  it("dashboard stats: a posted CT provision is not deducted from the estimate's base", async () => {
    const t = await seed();
    const r = await t.as.get(`/api/companies/${t.company.id}/dashboard/stats`);
    expect(r.status, r.text).toBe(200);
    const ct = r.body.corporateTax;
    expect(ct.periodFrom).toBe("2026-01-01");
    expect(ct.revenue).toBe(1_000_000);
    expect(ct.expenses).toBe(345_000);
    expect(ct.taxableIncome).toBe(655_000);
    expect(ct.estimatedLiability).toBe(25_200);
  });

  it("cash-flow forecast: the corporate-tax outflow uses the same base", async () => {
    const t = await seed();
    await h.sql(
      `INSERT INTO compliance_calendar (company_id, event_type, description, event_date, status)
       VALUES ($1, 'corporate_tax', 'CT return due', '2026-12-15T08:00:00Z', 'upcoming')`,
      [t.company.id]
    );
    const r = await t.as.get(`/api/companies/${t.company.id}/cashflow/forecast?days=90`);
    expect(r.status, r.text).toBe(200);
    const ct = r.body.items.filter((i: { kind: string }) => i.kind === "corporate_tax");
    expect(ct).toHaveLength(1);
    expect(ct[0].amount).toBe(-25_200);
  });
});
