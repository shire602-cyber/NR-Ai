/**
 * E3 (J2-r3 Medium): a company registered as "Non-registered" booked supplier VAT as recoverable
 * input VAT (Dr 1050 36.73) and the VAT page showed "Input 36.73, net -36.73". A company that is
 * not VAT registered cannot recover input VAT: the supplier's VAT is part of the expense / asset
 * cost and nothing reaches 1050. A registered company keeps Dr 1050.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function lines(t: Tenant, source: string, sourceId: string) {
  return h.sql<{ code: string; debit: string; credit: string }>(
    `SELECT a.code, jl.debit::text AS debit, jl.credit::text AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = $2 AND je.source_id = $3 AND je.status = 'posted'
      ORDER BY a.code`,
    [t.company.id, source, sourceId]
  );
}

const money = (rows: Array<{ code: string; debit: string; credit: string }>) =>
  rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));

async function approvedBill(t: Tenant) {
  const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Supplier LLC",
    bill_number: "CH-77",
    bill_date: "2026-11-10",
    due_date: "2026-12-10",
    line_items: [{ description: "Office supplies", quantity: 1, unit_price: 734.5, vat_rate: 5 }],
  });
  expect(bill.status, bill.text).toBe(200);
  const ap = await t.as.post(`/api/bills/${bill.body.id}/approve`, {});
  expect(ap.status, ap.text).toBe(200);
  return bill.body.id as string;
}

const nonRegistered = { trn_vat_number: null, tax_registration_type: "Non-registered" };

describe("E3 (J2-r3) a company that is not VAT registered recovers no input VAT", () => {
  it("a 5% bill posts the VAT into the expense: Dr expense 771.23 / Cr AP 771.23, nothing on 1050", async () => {
    const t = await h.createTenant({ companyColumns: nonRegistered });
    const id = await approvedBill(t);
    const rows = money(await lines(t, "bill", id));
    expect(rows.find((r) => r.code === "1050")).toBeUndefined();
    const debits = rows.filter((r) => r.debit > 0);
    expect(debits).toHaveLength(1);
    expect(debits[0].debit).toBe(771.23);
    expect(debits[0].code.startsWith("5")).toBe(true);
    expect(rows.find((r) => r.code === "2010")).toEqual({ code: "2010", debit: 0, credit: 771.23 });
    const [vat] = await h.sql<{ balance: string }>(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS balance
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE a.company_id = $1 AND a.code = '1050'`,
      [t.company.id]
    );
    expect(Number(vat.balance)).toBe(0);
  });

  it("a registered company keeps the recoverable input VAT on 1050 (exact lines)", async () => {
    const t = await h.createTenant();
    const id = await approvedBill(t);
    const rows = money(await lines(t, "bill", id));
    expect(rows.find((r) => r.code === "1050")).toEqual({ code: "1050", debit: 36.73, credit: 0 });
    expect(rows.find((r) => r.code === "2010")).toEqual({ code: "2010", debit: 0, credit: 771.23 });
    const expense = rows.filter((r) => r.debit > 0 && r.code !== "1050");
    expect(expense).toHaveLength(1);
    expect(expense[0].debit).toBe(734.5);
  });

  it("a purchased asset's input VAT joins its cost when not registered; registered posts Dr 1050", async () => {
    for (const [cols, expected] of [
      [nonRegistered, { cost: 63000, vat: 0 }],
      [{}, { cost: 60000, vat: 3000 }],
    ] as const) {
      const t = await h.createTenant({ companyColumns: cols });
      const bank = await accountByCode(t, "1020");
      const asset = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
        assetName: "Delivery van",
        category: "vehicles",
        purchaseDate: "2026-09-01",
        purchaseCost: 60000,
        salvageValue: 0,
        usefulLifeYears: 5,
        depreciationMethod: "straight_line",
        paymentAccountId: bank.id,
        inputVat: 3000,
      });
      expect(asset.status, asset.text).toBe(201);
      const je = asset.body.capitalizationJournalEntryId as string;
      const rows = money(
        await h.sql(
          `SELECT a.code, jl.debit::text AS debit, jl.credit::text AS credit
             FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
            WHERE jl.entry_id = $1 ORDER BY a.code`,
          [je]
        )
      );
      const vatLine = rows.find((r) => r.code === "1050");
      expect(vatLine?.debit ?? 0).toBe(expected.vat);
      const costLine = rows.find((r) => r.debit > 0 && r.code !== "1050")!;
      expect(costLine.debit).toBe(expected.cost);
      expect(rows.find((r) => r.code === bank.code)).toMatchObject({ credit: 63000 });
      expect(Number(asset.body.purchase_cost)).toBe(expected.cost);
    }
  });

  it("INTEGRATE-H: a stock bill of a non-registered company carries the VAT into stock and the inventory tie holds", async () => {
    const t = await h.createTenant({ companyColumns: nonRegistered });
    const p = await t.as.post(`/api/companies/${t.company.id}/products`, {
      name: "Widget",
      unitPrice: 100,
      costPrice: 0,
    });
    expect(p.status, p.text).toBe(200);
    const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Stock Supplier",
      bill_number: "ST-1",
      bill_date: "2026-11-10",
      due_date: "2026-12-10",
      line_items: [
        {
          description: "Widgets",
          quantity: 10,
          unit_price: 50,
          vat_rate: 5,
          product_id: p.body.id,
        },
      ],
    });
    expect(bill.status, bill.text).toBe(200);
    const ap = await t.as.post(`/api/bills/${bill.body.id}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    const rows = money(await lines(t, "bill", bill.body.id));
    expect(rows.find((r) => r.code === "1050")).toBeUndefined();
    expect(rows.find((r) => r.code === "2010")).toEqual({ code: "2010", debit: 0, credit: 525 });
    const val = await t.as.get(`/api/companies/${t.company.id}/inventory/valuation`);
    expect(val.status, val.text).toBe(200);
    expect(val.body.reconciled, JSON.stringify(val.body)).toBe(true);
    expect(val.body.difference).toBe("0.00");
    expect(Number(val.body.glBalance)).toBe(525);
  });
});
