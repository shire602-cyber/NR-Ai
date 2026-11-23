/**
 * E3 (J1-r3 Low, still present from r2): invoice service lines posted to 4010 Product Sales.
 * An invoice line can now name its income account (migration 0124, invoice_lines
 * .revenue_account_id): the issue entry credits that account; a line without one keeps the item
 * rule (4020 for free text). Only an active income account of the company is accepted.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function revenueCredits(t: Tenant, invoiceId: string) {
  const rows = await h.sql<{ code: string; credit: string }>(
    `SELECT a.code, SUM(jl.credit)::text AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'invoice' AND je.source_id = $2
        AND je.status = 'posted' AND a.type = 'income'
      GROUP BY a.code ORDER BY a.code`,
    [t.company.id, invoiceId]
  );
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.credit)]));
}

async function issue(t: Tenant, lines: object[]) {
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    date: "2026-11-10",
    placeOfSupplyEmirate: "dubai",
    lines,
  });
  if (inv.status !== 200) return inv;
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  return inv;
}

describe("E3 (J1-r3) invoice line income account", () => {
  it("defaults free-text service to 4020 and honors an explicit revenue account", async () => {
    const t = await h.createTenant();
    const sales = await accountByCode(t, "4010");
    const inv = await issue(t, [
      {
        description: "Consulting",
        quantity: 2,
        unitPrice: 1500,
        vatRate: 0.05,
        revenueAccountId: sales.id,
      },
      { description: "Installation", quantity: 1, unitPrice: 200, vatRate: 0.05 },
    ]);
    expect(inv.status, inv.text).toBe(200);
    expect(await revenueCredits(t, inv.body.id)).toEqual({ "4010": 3000, "4020": 200 });
    const stored = await h.sql<{ description: string; revenue_account_id: string | null }>(
      `SELECT description, revenue_account_id FROM invoice_lines WHERE invoice_id = $1
        ORDER BY description`,
      [inv.body.id]
    );
    expect(stored).toEqual([
      { description: "Consulting", revenue_account_id: sales.id },
      { description: "Installation", revenue_account_id: null },
    ]);
  });

  it("refuses an account that is not one of the company's income accounts", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const expense = await accountByCode(t, "5000");
    const foreign = await accountByCode(other, "4020");
    for (const id of [expense.id, foreign.id]) {
      const r = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
        customerName: "Acme LLC",
        date: "2026-11-10",
        placeOfSupplyEmirate: "dubai",
        lines: [
          { description: "Job", quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: id },
        ],
      });
      expect(r.status, r.text).toBe(422);
      expect(r.body.code).toBe("REVENUE_ACCOUNT_INVALID");
    }
  });
});
