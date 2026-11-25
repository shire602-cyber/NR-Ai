/**
 * STEP1-E G1 / G2: every system journal LINE stores its description key + params (migration 0132),
 * the APIs return them, and the Arabic account ledger, journal entry and GL PDF render them in
 * Arabic with no English left and no English month names in the body dates.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { localizeJournalLine } from "../../client/src/lib/journal-memo";
import arJournal from "../../client/src/locales/ar/journal.json";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";
import { pdfToText } from "../unit/pdf-test-helpers";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const ar = arJournal as Record<string, string>;

interface LineRow {
  entry_id: string;
  memo_key: string | null;
  source: string;
  description: string | null;
  line_key: string | null;
  line_params: Record<string, string> | null;
}

describe("G1: journal lines carry keys and render Arabic", () => {
  it("[G1] posted lines carry keys; the ledger, entry, GL and GL PDF read Arabic; [G2] PDF dates too", async () => {
    const t = await h.createTenant({
      companyColumns: {
        locale: "ar",
        trn_vat_number: "100000000000003",
        emirate: "dubai",
        vat_filing_frequency: "Quarterly",
        vat_period_start_month: 1,
      },
    });
    const bank = await accountByCode(t, "1020");
    const contact = await t.as.post(`${base(t)}/customer-contacts`, { name: "Palm Co" });
    const dep = await t.as.post(`${base(t)}/customer-deposits`, {
      contactId: contact.body.id,
      date: "2026-02-05",
      amount: "1050",
      vatTreatment: "standard",
      paymentAccountId: bank.id,
      reference: null,
    });
    expect(dep.status, dep.text).toBe(201);
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Palm Co",
      date: "2026-03-01",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Job", quantity: 1, unitPrice: 2000, vatRate: 5 }],
    });
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const applied = await t.as.post(`${base(t)}/customer-credits/${dep.body.creditId}/apply`, {
      invoiceId: inv.body.id,
      amount: "1050",
    });
    expect(applied.status, applied.text).toBe(201);
    const pay = await t.as.post(`${base(t)}/invoices/${inv.body.id}/payments`, {
      amount: 1050,
      date: "2026-03-10",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const bill = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Supplier LLC",
      vendor_trn: "100000000000029",
      bill_number: "B-100",
      bill_date: "2026-03-12",
      due_date: "2026-12-31",
      line_items: [{ description: "Supplies", quantity: 1, unit_price: 400, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    expect((await t.as.post(`/api/bills/${bill.body.id}/approve`, {})).status).toBe(200);
    expect(
      (
        await t.as.post(`/api/bills/${bill.body.id}/payments`, {
          payment_date: "2026-03-20",
          amount: 420,
          payment_account_id: bank.id,
        })
      ).status
    ).toBe(200);

    // 1. Every line of a system posting carries a key (the rows the kernel reversed keep them).
    const rows = await h.sql<LineRow>(
      `SELECT jl.entry_id, je.memo_key, je.source, jl.description, jl.line_key, jl.line_params
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1`,
      [t.company.id]
    );
    expect(rows.length).toBeGreaterThan(10);
    const keyless = rows.filter((r) => r.memo_key && !r.line_key);
    expect(keyless.map((r) => `${r.source}: ${r.description}`)).toEqual([]);
    const keys = new Set(rows.map((r) => r.line_key));
    for (const k of [
      "depositContractLiability",
      "salesRevenue",
      "vatOutput",
      "invoiceReceivable",
      "paymentCashReceived",
      "billInputVat",
      "billSettleAp",
    ]) {
      expect(keys.has(k), `${k} in ${[...keys].join(", ")}`).toBe(true);
    }
    // The stored English text is the template filled with the stored params.
    const revenue = rows.find((r) => r.line_key === "salesRevenue")!;
    expect(revenue.description).toMatch(/^Sales revenue - INV-/);
    expect(revenue.line_params).toMatchObject({ ref: expect.stringMatching(/^INV-/) });

    // 2. Every keyed line renders Arabic with nothing English but the document numbers / names.
    const allow = ["Palm Co", "Supplier LLC", "B-100", "INV-2026-00001", "DEP-2026-00001"];
    for (const r of rows.filter((x) => x.line_key)) {
      const out = localizeJournalLine(ar, "ar", {
        description: r.description,
        lineKey: r.line_key,
        lineParams: r.line_params,
      });
      expect(/[؀-ۿ]/.test(out), `${r.line_key}: ${out}`).toBe(true);
      const params = Object.values(r.line_params ?? {});
      expect(isEnglishLine(out, [...allow, ...params]), `${r.line_key}: ${out}`).toBe(false);
    }

    // 3. The account ledger and the journal entry return the key to the UI.
    const rev = await accountByCode(t, "4020");
    const ledger = await t.as.get(`/api/accounts/${rev.id}/ledger`);
    expect(ledger.status, ledger.text).toBe(200);
    const row = (ledger.body.entries as Array<{ lineKey: string | null }>).find(
      (e) => e.lineKey === "salesRevenue"
    );
    expect(row).toBeTruthy();
    const listed = await t.as.get(`${base(t)}/journal`);
    const entry = (
      listed.body as Array<{
        id: string;
        lines: Array<{ lineKey: string | null; lineParams: Record<string, string> | null }>;
      }>
    ).find((e) => e.lines.some((l) => l.lineKey === "invoiceReceivable"));
    expect(entry).toBeTruthy();
    const detail = await t.as.get(`/api/journal/${entry!.id}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.lines.some((l: { lineKey: string | null }) => l.lineKey)).toBe(true);

    // 4. A reversal keeps each line's key (so the Arabic ledger reads it too).
    const { reverseEntry } = await import("../../server/ledger");
    await reverseEntry(
      entry!.id,
      { date: "2026-03-15", reason: "test" },
      { actorId: t.user.id, companyId: t.company.id }
    );
    const mirrored = await h.sql<{ line_key: string | null }>(
      `SELECT jl.line_key FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.reversed_entry_id = $1`,
      [entry!.id]
    );
    expect(mirrored.length).toBeGreaterThan(0);
    expect(mirrored.every((m) => m.line_key)).toBe(true);

    // 5. The Arabic GL PDF: Arabic line descriptions and Arabic body dates (G1 + G2).
    const { buildStatementFile } = await import("../../server/services/report-render/pack");
    const pdf = await buildStatementFile({
      companyId: t.company.id,
      kind: "general-ledger",
      period: { from: "2026-01-01", to: "2026-03-31" },
      format: "pdf",
      lang: "ar",
    });
    const text = (await pdfToText(pdf.content)).replace(/\s+/g, " ");
    expect(text).toContain("فبراير");
    expect(text).toContain("مارس");
    // No English month name anywhere in the Arabic PDF (the dates used to print "5 Feb 2026").
    expect(text).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
    // No English line text of the postings above.
    for (const english of [
      "Sales revenue",
      "VAT output",
      "Customer deposit",
      "Input VAT",
      "Settle A/P",
      "cash received",
      "Payment to",
    ]) {
      expect(text, english).not.toContain(english);
    }
    expect(text).toContain("إيرادات المبيعات");

    // The English PDF keeps the stored English text and English dates.
    const en = await buildStatementFile({
      companyId: t.company.id,
      kind: "general-ledger",
      period: { from: "2026-01-01", to: "2026-03-31" },
      format: "pdf",
      lang: "en",
    });
    const enText = (await pdfToText(en.content)).replace(/\s+/g, " ");
    expect(enText).toContain("Sales revenue");
    expect(enText).toContain("Feb");
  });
});
