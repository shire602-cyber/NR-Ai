// Invoice PDF "VAT total (AED)" ties to the posted journal entry (the 2020 credit), not to
// vat x rate. Hand-calculated: USD 700 + 5% VAT 35.00 at 3.6725 = AED 128.5375 -> 128.54.
import { expect, it } from "vitest";
import { useHarness } from "./harness";
import { pdfToText } from "../unit/pdf-test-helpers";

const h = useHarness();

it("USD invoice PDF prints the AED VAT as posted to 2020", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const base = `/api/companies/${t.company.id}`;
  const draft = await t.as.post(`${base}/invoices`, {
    customerName: "Acme",
    customerAddress: "Shop 4, Deira, Dubai",
    date: "2026-01-20",
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: [{ description: "Services", quantity: 1, unitPrice: 700, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  const [vat] = await h.sql<{ aed: string }>(
    `SELECT SUM(jl.credit - jl.debit)::text AS aed FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.source = 'invoice' AND je.source_id = $1 AND a.code = '2020'`,
    [draft.body.id]
  );
  expect(Number(vat.aed)).toBe(128.54);

  const res = await fetch(`${h.baseUrl}/api/invoices/${draft.body.id}/pdf`, {
    headers: { Authorization: `Bearer ${t.token}` },
  });
  expect(res.status).toBe(200);
  const text = (await pdfToText(Buffer.from(await res.arrayBuffer()))).replace(/\s+/g, " ");
  expect(text).toContain("VAT total (AED)");
  expect(text).toContain("AED 128.54");
});
