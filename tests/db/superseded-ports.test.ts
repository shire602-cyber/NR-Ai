/**
 * Small fixes ported from the superseded launch/phase-* PRs (docs/release/SUPERSEDED-PRS.md).
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { dubaiIso } from "../helpers/dates";

const h = useHarness();

describe("PR-66 month-end checklist and quarterly VAT", () => {
  // The base's E3 (J3-r3) rewrote this step; the PR-66 port was dropped in its favour. This
  // keeps the PR-66 regression: a quarterly filer is not blocked every month.
  it("PR-66: a quarterly filer's mid-quarter months need no return; the period-end month needs the quarter's return", async () => {
    const t = await h.createTenant({ name: "QuarterlyFiler" });
    await h.sql(
      `UPDATE companies SET vat_filing_frequency = 'quarterly', vat_period_start_month = 1 WHERE id = $1`,
      [t.company.id]
    );
    const base = `/api/companies/${t.company.id}`;
    const vatStep = async (period: string) => {
      const r = await t.as.get(`${base}/month-end/checklist?period=${period}`);
      expect(r.status, r.text).toBe(200);
      return r.body.checklist.find((c: { id: number }) => c.id === 7);
    };

    for (const m of ["2025-07", "2025-08"]) expect((await vatStep(m)).status, m).toBe("complete");
    expect((await vatStep("2025-09")).status).toBe("incomplete");

    await h.sql(
      `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, created_by, status)
       VALUES ($1, '2025-07-01', '2025-09-30', '2025-10-28', $2, 'submitted')`,
      [t.company.id, t.user.id]
    );
    const sep = await vatStep("2025-09");
    expect(sep.status).toBe("complete");
    expect(sep.details).toMatch(/1 VAT return\(s\) prepared/);
  });
});

describe("PR-61 payment chasing reads the settlement rule", () => {
  it("PR-61: a partly credited overdue invoice is chased for its open balance, not its total", async () => {
    const t = await h.createTenant({ name: "ChaseCredit" });
    const iso = (d: Date) => dubaiIso(d);
    const day = 86_400_000;
    const created = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Late Payer LLC",
      date: iso(new Date(Date.now() - 60 * day)),
      dueDate: iso(new Date(Date.now() - 30 * day)),
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(created.status, created.text).toBe(200);
    const id = created.body.id as string;
    expect((await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" })).status).toBe(200);
    const cn = await t.as.post(`/api/companies/${t.company.id}/credit-notes`, {
      invoiceId: id,
      lines: [{ description: "Damaged", quantity: 1, unitPrice: 100, vatRate: 5 }],
      reason: "Damaged goods",
    });
    expect(cn.status, cn.text).toBe(201);
    expect((await t.as.post(`/api/credit-notes/${cn.body.id}/issue`, {})).status).toBe(200);

    const overdue = await t.as.get(`/api/chasing/overdue/${t.company.id}`);
    expect(overdue.status, overdue.text).toBe(200);
    const row = overdue.body.rows.find((r: { invoice: { id: string } }) => r.invoice.id === id);
    expect(row.outstanding).toBe(945);
    expect(overdue.body.totalOutstanding).toBe(945);
    // The same figure the invoice list shows (one settlement rule).
    const detail = await t.as.get(`/api/invoices/${id}`);
    expect(detail.body.settlement.amountDue).toBe("945.00");
  });
});

describe("PR-61 expense claims apply the Art. 53 recovery rules", () => {
  it("PR-61: entertainment VAT on a claim is not recoverable; travel VAT still is", async () => {
    const t = await h.createTenant({ name: "ClaimArt53" });
    const item = (category: string) => ({
      expense_date: "2026-01-10",
      category,
      description: `${category} item`,
      amount: 100,
      vat_amount: 5,
      has_tax_invoice: true,
    });
    const c = await t.as.post(`/api/companies/${t.company.id}/expense-claims`, {
      title: "Client dinner and taxi",
      items: [item("Entertainment"), item("Travel")],
    });
    expect(c.status, c.text).toBe(200);
    const rows = await h.sql(
      `SELECT category, vat_recoverable FROM expense_claim_items WHERE claim_id = $1 ORDER BY category`,
      [c.body.id]
    );
    expect(rows).toEqual([
      { category: "Entertainment", vat_recoverable: false },
      { category: "Travel", vat_recoverable: true },
    ]);
  });
});
