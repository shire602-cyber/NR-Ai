// Credit note PDF compliance: every download path prints the reference invoice and, for a
// foreign-currency credit note, the POSTED rate and AED VAT (hand-calculated: USD 350 + 5% VAT
// 17.50 at 3.6725 = AED 64.27, the 2020 debit on the credit note's own journal entry).
import { expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { hasEnglishStamp, pdfToText } from "../unit/pdf-test-helpers";

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

async function pdfText(
  token: string,
  url: string
): Promise<{ status: number; text: string; voidStamp: boolean }> {
  const res = await fetch(h.baseUrl + url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) return { status: res.status, text: "", voidStamp: false };
  expect(res.headers.get("content-type")).toContain("application/pdf");
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = await pdfToText(bytes);
  return {
    status: 200,
    text: text.replace(/\s+/g, " "),
    // The rotated stamp extracts as one word or one glyph per word, depending on the platform.
    voidStamp: await hasEnglishStamp(bytes, "VOID"),
  };
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
       JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 AND a.code = '2020'`,
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
  expect(voided.voidStamp).toBe(true);
  expect(pdf.voidStamp).toBe(false);

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

// Art. 60(2)(e) AED figures are the POSTED amounts (never a recomputation), so each PDF ties to
// its own journal entry to the fil.
const aed = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

async function postedRevenueAed(entryId: string): Promise<number> {
  const [row] = await h.sql<{ aed: string }>(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS aed FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 AND a.code NOT IN ('1040', '2055', '2050', '2020')`,
    [entryId]
  );
  return Number(row.aed);
}

it("two USD 350 credit notes on a USD 700 invoice: each PDF difference equals its own journal and the second corrects to 0.00", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const inv = await issue(t, "USD"); // AED 2,570.75
  const first = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [std(350)],
  });
  expect(first.status, first.text).toBe(201);
  const second = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [std(350)],
  });
  expect(second.status, second.text).toBe(201);

  // The first note converts its own revenue; the final note posts the remaining AED balance, so
  // the two figures differ by one fil.
  const aed1 = await postedRevenueAed(first.body.journalEntryId);
  const aed2 = await postedRevenueAed(second.body.journalEntryId);
  expect(aed1).toBe(1285.38);
  expect(aed2).toBe(1285.37);

  const pdf1 = await pdfText(t.token, `/api/credit-notes/${first.body.id}/pdf`);
  expect(pdf1.text).toContain("USD 700.00 (AED 2,570.75)");
  expect(pdf1.text).toContain(`USD 350.00 (AED ${aed(aed1)})`); // difference
  expect(pdf1.text).toContain(`USD 350.00 (AED ${aed(2570.75 - aed1)})`); // corrected 1,285.37

  const pdf2 = await pdfText(t.token, `/api/credit-notes/${second.body.id}/pdf`);
  expect(pdf2.text).toContain("USD 700.00 (AED 2,570.75)");
  expect(pdf2.text).toContain(`USD 350.00 (AED ${aed(aed2)})`); // difference = its own journal
  expect(pdf2.text).not.toContain("USD 350.00 (AED 1,285.38)");
  expect(pdf2.text).toContain("USD 0.00 (AED 0.00)"); // corrected value is exactly nil
});

it("a USD invoice split over two cost centres prints the posted per-bucket AED, not one conversion", async () => {
  const t = await h.createTenant({ planId: "enterprise", companyColumns: { emirate: "dubai" } });
  const centre = async (code: string) => {
    const res = await t.as.post(`${base(t)}/cost-centers`, { code, name: code });
    expect(res.status, res.text).toBe(201);
    return res.body.id as string;
  };
  const a = await centre("JOB-A");
  const b = await centre("JOB-B");
  const line = (costCenterId: string, price: number) => ({ ...std(price), costCenterId });
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.67,
    lines: [line(a, 0.5), line(b, 0.5)],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  const [orig] = await h.sql<{ aed: string }>(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::text AS aed FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.source = 'invoice' AND je.source_id = $1 AND a.code NOT IN ('1040', '2055', '2050', '2020')`,
    [draft.body.id]
  );
  // Each bucket converts on its own: 0.50 x 3.67 = 1.835 -> 1.84, twice = 3.68 (one conversion
  // of USD 1.00 would give 3.67).
  expect(Number(orig.aed)).toBe(3.68);

  const cn = await t.as.post(`${base(t)}/invoices/${draft.body.id}/credit-note`, {
    date,
    lines: [line(a, 0.5)],
  });
  expect(cn.status, cn.text).toBe(201);
  const credited = await postedRevenueAed(cn.body.journalEntryId);
  expect(credited).toBe(1.84);
  const pdf = await pdfText(t.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(pdf.text).toContain("USD 1.00 (AED 3.68)");
  expect(pdf.text).toContain(`USD 0.50 (AED ${aed(credited)})`);
  expect(pdf.text).not.toContain("(AED 3.67)");
});

// Zero-rated (4060) and exempt (4070) sales are flagged is_vat_account in the chart but are
// revenue: they must stay in the posted AED figures, while only the 2020 tax leg is VAT.
const zero = (price: number) => ({
  description: "Export",
  quantity: 1,
  unitPrice: price,
  vatRate: 0,
  vatSupplyType: "zero_rated",
});
const exempt = (price: number) => ({
  description: "Rent",
  quantity: 1,
  unitPrice: price,
  vatRate: 0,
  vatSupplyType: "exempt",
});

async function issueUsd(t: Tenant, lines: unknown[]): Promise<{ id: string; number: string }> {
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines,
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  return { id: draft.body.id, number: draft.body.number };
}

async function vatLegAed(entryId: string): Promise<number> {
  const [row] = await h.sql<{ aed: string }>(
    `SELECT COALESCE(SUM(jl.debit + jl.credit), 0)::text AS aed FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 AND a.code = '2020'`,
    [entryId]
  );
  return Number(row.aed);
}

it("zero-rated-only USD export invoice: posted AED original, credited and corrected figures keep the 4060 revenue", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const inv = await issueUsd(t, [zero(1000)]);
  const cn = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [zero(400)],
  });
  expect(cn.status, cn.text).toBe(201);
  // 1,000 x 3.6725 = 3,672.50; 400 x 3.6725 = 1,469.00; corrected 2,203.50; no VAT at all.
  expect(await postedRevenueAed(cn.body.journalEntryId)).toBe(1469);
  expect(await vatLegAed(cn.body.journalEntryId)).toBe(0);
  const pdf = await pdfText(t.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(pdf.text).toContain("USD 1,000.00 (AED 3,672.50)");
  expect(pdf.text).toContain("USD 400.00 (AED 1,469.00)");
  expect(pdf.text).toContain("USD 600.00 (AED 2,203.50)");
});

it("mixed USD 1,000 standard + 1,000 zero-rated invoice with a partial credit note", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const inv = await issueUsd(t, [std(1000), zero(1000)]);
  const cn = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [std(200), zero(300)],
  });
  expect(cn.status, cn.text).toBe(201);
  // Original 2,000 = AED 7,345.00 (not 3,672.50); credited 500 = 734.50 + 1,101.75 = 1,836.25
  // (hand-calculated); corrected 1,500 = AED 5,508.75. VAT row is only the 2020 leg:
  // 5% x 200 = USD 10 = AED 36.73 (36.725 half up).
  expect(await postedRevenueAed(cn.body.journalEntryId)).toBe(1836.25);
  expect(await vatLegAed(cn.body.journalEntryId)).toBe(36.73);
  const pdf = await pdfText(t.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(pdf.text).toContain("USD 2,000.00 (AED 7,345.00)");
  expect(pdf.text).toContain("USD 500.00 (AED 1,836.25)");
  expect(pdf.text).toContain("USD 1,500.00 (AED 5,508.75)");
  expect(pdf.text).toContain("AED 36.73");
  expect(pdf.text).not.toContain("AED 3,672.50");
});

it("exempt USD invoice keeps the 4070 revenue in the posted AED figures", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const inv = await issueUsd(t, [exempt(1000)]);
  const cn = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {
    date,
    lines: [exempt(400)],
  });
  expect(cn.status, cn.text).toBe(201);
  expect(await postedRevenueAed(cn.body.journalEntryId)).toBe(1469);
  expect(await vatLegAed(cn.body.journalEntryId)).toBe(0);
  const pdf = await pdfText(t.token, `/api/credit-notes/${cn.body.id}/pdf`);
  expect(pdf.text).toContain("USD 1,000.00 (AED 3,672.50)");
  expect(pdf.text).toContain("USD 400.00 (AED 1,469.00)");
  expect(pdf.text).toContain("USD 600.00 (AED 2,203.50)");
});
