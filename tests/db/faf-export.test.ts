/**
 * W5-A FTA Audit File (R12-08a): record counts and totals tie to the trial balance and the
 * VAT 201 for a fixture company. The file is labelled as not transmitted to the FTA.
 */
import { describe, expect, it } from "vitest";
import { postJournalEntry, useHarness } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const SUPPLIER_TRN = "100222333400003";
const CUSTOMER_TRN = "100555666700003";
const PERIOD = { from: "2026-08-01", to: "2026-08-31" };

describe("W5-A FTA Audit File", () => {
  it("[R12-08a] FAF listings tie to VAT 201 and the GL listing ties to the trial balance", async () => {
    const t = await h.createTenant({
      companyColumns: {
        trn_vat_number: TRN,
        emirate: "dubai",
        vat_filing_frequency: "Monthly",
        vat_period_start_month: 1,
      },
    });
    await postJournalEntry(t, {
      date: "2026-08-02",
      description: "Capital",
      lines: [
        { code: "1020", debit: 10_000 },
        { code: "3010", credit: 10_000 },
      ],
    });
    for (const [name, amount] of [
      ["Customer One LLC", 1000],
      ["Customer Two LLC", 600],
    ] as const) {
      const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
        customerName: name,
        customerTrn: CUSTOMER_TRN,
        date: "2026-08-10",
        lines: [{ description: "Service", quantity: 1, unitPrice: amount, vatRate: 5 }],
      });
      expect(inv.status, inv.text).toBe(200);
      const s = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
      expect(s.status, s.text).toBe(200);
    }
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Supplier LLC",
      vendor_trn: SUPPLIER_TRN,
      bill_number: "SUP-1",
      bill_date: "2026-08-12",
      due_date: "2026-09-12",
      line_items: [{ description: "Supplies", quantity: 1, unit_price: 400, vat_rate: 5 }],
    });
    expect(b.status, b.text).toBe(200);
    const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
    expect(a.status, a.text).toBe(200);

    const r = await t.as.get(
      `/api/companies/${t.company.id}/reports/faf?from=${PERIOD.from}&to=${PERIOD.to}&format=json`
    );
    expect(r.status, r.text).toBe(200);
    const faf = r.body;
    expect(faf.label).toBe("Generated for upload/inspection — not transmitted to FTA");
    expect(faf.specNotice).toMatch(/verify against the current FTA specification/); // S5 EXTERNAL
    expect(faf.company).toMatchObject({ trn: TRN, periodStart: PERIOD.from, periodEnd: PERIOD.to });

    // Supply listing: two invoices, standard rated, customer TRN carried.
    expect(faf.totals.supplyCount).toBe(2);
    expect(faf.supplies.every((s: { taxCode: string }) => s.taxCode === "SR")).toBe(true);
    expect(faf.supplies[0].customerTrn).toBe(CUSTOMER_TRN);
    expect(faf.totals.supplyTotalFils).toBe(160_000);
    expect(faf.totals.supplyVatTotalFils).toBe(8_000);
    // Purchase listing: one bill with the supplier TRN.
    expect(faf.totals.purchaseCount).toBe(1);
    expect(faf.purchases[0]).toMatchObject({ supplierTrn: SUPPLIER_TRN, invoiceNo: "SUP-1" });
    expect(faf.totals.purchaseVatTotalFils).toBe(2_000);

    // Ties to VAT 201 for the same period.
    const vat = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-return?periodStart=${PERIOD.from}&periodEnd=${PERIOD.to}`
    );
    expect(vat.status, vat.text).toBe(200);
    expect(faf.reconciliation.supplyVatDifferenceFils).toBe(0);
    expect(faf.reconciliation.purchaseVatDifferenceFils).toBe(0);
    expect(faf.reconciliation.vat201OutputVatFils).toBe(8_000);
    expect(faf.reconciliation.vat201RecoverableVatFils).toBe(2_000);

    // GL listing ties to the trial balance (all activity is inside the period).
    const tb = await t.as.get(
      `/api/companies/${t.company.id}/reports/trial-balance?from=${PERIOD.from}&to=${PERIOD.to}`
    );
    expect(tb.status, tb.text).toBe(200);
    expect(faf.totals.glDebitTotalFils).toBe(faf.totals.glCreditTotalFils);
    expect(faf.totals.glDebitTotalFils).toBe(Math.round(tb.body.totals.sumDebits * 100));
    const lines = await h.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1 AND je.status = 'posted'`,
      [t.company.id]
    );
    expect(faf.totals.glCount).toBe(Number(lines[0].n));

    // Text layout: section markers and footer totals.
    const txt = await t.as.get(
      `/api/companies/${t.company.id}/reports/faf?from=${PERIOD.from}&to=${PERIOD.to}`
    );
    expect(txt.status).toBe(200);
    const body: string = txt.text;
    for (const marker of [
      "CompInfoStart",
      "CompInfoEnd",
      "PurcDataStart",
      "PurcDataEnd",
      "SuppDataStart",
      "SuppDataEnd",
      "GLDataStart",
      "GLDataEnd",
    ]) {
      expect(body).toContain(`${marker}\r\n`);
    }
    expect(body).toContain("1600.00,80.00,2");
    expect(body).toContain(SUPPLIER_TRN);

    const missing = await t.as.get(`/api/companies/${t.company.id}/reports/faf`);
    expect(missing.status).toBe(400);
  });
});
