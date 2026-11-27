// Credit note PDF compliance: every download path prints the reference invoice and, for a
// foreign-currency credit note, the POSTED rate and AED VAT (hand-calculated: USD 350 + 5% VAT
// 17.50 at 3.6725 = AED 64.27, the 2020 debit on the credit note's own journal entry).
import { expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { pdfToText } from "../unit/pdf-test-helpers";

const h = useHarness();
const date = "2026-01-20";
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const std = (price: number) => ({
  description: "Services",
  quantity: 1,
  unitPrice: price,
  vatRate: 5,
});

async function issue(t: Tenant, currency: "AED" | "USD"): Promise<{ id: string; number: string }> {
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme",
    customerAddress: "Shop 4, Deira, Dubai",
    date,
    placeOfSupplyEmirate: "dubai",
    currency,
    ...(currency === "USD" ? { exchangeRate: 3.6725 } : {}),
    lines: [std(700)],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  return { id: draft.body.id, number: draft.body.number };
}

async function pdfText(token: string, url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(h.baseUrl + url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) return { status: res.status, text: "" };
  expect(res.headers.get("content-type")).toContain("application/pdf");
  const text = await pdfToText(Buffer.from(await res.arrayBuffer()));
  return { status: 200, text: text.replace(/\s+/g, " ") };
}

it("AED credit note PDF prints the reference invoice number", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const inv = await issue(t, "AED");
  const cn = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [std(350)],
  });
  expect(cn.status, cn.text).toBe(201);
  const pdf = await pdfText(t.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(pdf.text).toContain(inv.number);
  expect(pdf.text).toContain("20 Jan 2026");
  expect(pdf.text).toContain("Shop 4, Deira, Dubai");
  expect(pdf.text).toContain("AED 700.00"); // original net
  expect(pdf.text).not.toContain("Exchange rate");
});

it("USD credit note PDF prints the reference, the posted rate and the posted AED VAT; other paths match", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const inv = await issue(t, "USD");
  const cn = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [std(350)],
  });
  expect(cn.status, cn.text).toBe(201);
  const [vat] = await h.sql<{ aed: string }>(
    `SELECT SUM(jl.debit)::text AS aed FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 AND a.is_vat_account`,
    [cn.body.journalEntryId]
  );
  expect(Number(vat.aed)).toBe(64.27);

  // The PDF reads only the rate stored on the credit note (never a fresh rate lookup).
  const pdf = await pdfText(t.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(pdf.text).toContain(inv.number);
  expect(pdf.text).toContain("1 USD = 3.6725 AED");
  expect(pdf.text).toContain("AED 64.27");
  // Art. 60(2)(e), hand-calculated: original USD 700 = AED 2,570.75; credited USD 350 = AED
  // 1,285.38 (1,285.375 half up); corrected = 2,570.75 - 1,285.38 = AED 1,285.37 (USD 350).
  expect(pdf.text).toContain("20 Jan 2026");
  expect(pdf.text).toContain("Shop 4, Deira, Dubai");
  expect(pdf.text).toContain("USD 700.00 (AED 2,570.75)");
  expect(pdf.text).toContain("USD 350.00 (AED 1,285.37)");
  expect(pdf.text).toContain("USD 350.00 (AED 1,285.38)");

  // A voided credit note is stamped VOID.
  const voidRes = await t.as.post(`/api/credit-notes/${cn.body.id}/void`, {});
  expect(voidRes.status, voidRes.text).toBe(200);
  const voided = await pdfText(t.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(voided.text).toContain("VOID");

  // The generic invoice PDF route renders a credit-note row through the same credit note layout.
  const viaInvoice = await pdfText(t.token, `/api/invoices/${cn.body.id}/pdf`);
  expect(viaInvoice.status).toBe(200);
  expect(viaInvoice.text).toContain("Tax credit note");
  expect(viaInvoice.text).toContain(inv.number);
  expect(viaInvoice.text).toContain("AED 64.27");
});

it("another tenant cannot download the credit note PDF (404) and its invoice never resolves", async () => {
  const a = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const b = await h.createSecondTenant({ companyColumns: { emirate: "dubai" } });
  const inv = await issue(a, "AED");
  const cn = await a.as.post(`${base(a)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [std(350)],
  });
  expect(cn.status, cn.text).toBe(201);
  expect((await pdfText(b.token, `/api/credit-notes/${cn.body.id}/pdf`)).status).toBe(404);

  // Even if a credit note row pointed at another company's invoice, it is not loaded or printed.
  await issue(b, "AED"); // numbers are per company; the second one has a number A never used
  const invB = await issue(b, "AED");
  expect(invB.number).not.toBe(inv.number);
  await h.sql("UPDATE invoices SET original_invoice_id = $1 WHERE id = $2", [invB.id, cn.body.id]);
  const pdf = await pdfText(a.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(pdf.status).toBe(200);
  expect(pdf.text).not.toContain(invB.number);

  // The JSON endpoint resolves the original invoice number tenant-scoped too.
  const json = await a.as.get(`/api/credit-notes/${cn.body.id}`);
  expect(json.status, json.text).toBe(200);
  expect(json.body.invoiceNumber).toBeNull();
});
