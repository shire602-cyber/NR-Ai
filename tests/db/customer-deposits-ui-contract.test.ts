/**
 * STEP1 F1: the Customer deposits dialog sends the typed AED amount as a decimal string, exactly
 * what `zPositiveFils` expects. It used to send fils (x100), which the validator multiplied again:
 * AED 1,050 booked as 105,000 and "Apply" failed with 409.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function lines(entryId: string) {
  const rows = await h.sql<{ code: string; d: string; c: string }>(
    `SELECT a.code, ROUND(SUM(jl.debit)*100)::bigint::text AS d, ROUND(SUM(jl.credit)*100)::bigint::text AS c
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 GROUP BY a.code ORDER BY a.code`,
    [entryId]
  );
  return rows.map((r) => ({ code: r.code, debitFils: Number(r.d), creditFils: Number(r.c) }));
}

describe("STEP1 F1: customer deposit UI contract (AED strings on the wire)", () => {
  it("books AED 1,050 as 105,000 fils (not 10,500,000) and applies it to an open invoice", async () => {
    const t = await h.createTenant({
      companyColumns: {
        trn_vat_number: "100000000000003",
        emirate: "dubai",
        vat_filing_frequency: "Quarterly",
        vat_period_start_month: 1,
      },
    });
    const bank = await accountByCode(t, "1020");
    const contact = await t.as.post(`${base(t)}/customer-contacts`, { name: "Palm Co" });
    expect(contact.status, contact.text).toBeLessThan(300);
    const dep = await t.as.post(`${base(t)}/customer-deposits`, {
      contactId: contact.body.id, // the dialog picks the customer from the contacts
      date: "2026-02-05",
      amount: "1050", // exactly what the dialog sends
      vatTreatment: "standard",
      paymentAccountId: bank.id,
      reference: null,
    });
    expect(dep.status, dep.text).toBe(201);
    const stored = await h.sql<{ amount: string; vat_amount: string }>(
      `SELECT amount::text, vat_amount::text FROM customer_deposits WHERE id = $1`,
      [dep.body.deposit.id]
    );
    expect(Number(stored[0].amount)).toBe(1050);
    expect(Number(stored[0].vat_amount)).toBe(50);
    // Dr bank 1,050.00; Cr deposit liability 1,000.00; Cr VAT output 50.00.
    const posted = await lines(dep.body.journalEntryId);
    expect(posted.find((l) => l.code === "1020")).toMatchObject({ debitFils: 105000 });
    expect(posted.find((l) => l.code === "2020")).toMatchObject({ creditFils: 5000 });
    expect(posted.reduce((s, l) => s + l.debitFils, 0)).toBe(105000);
    expect(posted.reduce((s, l) => s + l.creditFils, 0)).toBe(105000);

    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Palm Co",
      date: "2026-03-01",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Job", quantity: 1, unitPrice: 2000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);

    const applied = await t.as.post(`${base(t)}/customer-credits/${dep.body.creditId}/apply`, {
      invoiceId: inv.body.id,
      amount: "1050", // the dialog pre-fills the remaining AED amount
    });
    expect(applied.status, applied.text).toBe(201);
    const credit = await h.sql<{ remaining: string }>(
      `SELECT remaining::text FROM customer_credits WHERE id = $1`,
      [dep.body.creditId]
    );
    expect(Number(credit[0].remaining)).toBe(0);
    const alloc = await h.sql<{ n: string }>(
      `SELECT COALESCE(SUM(amount),0)::text AS n FROM customer_credit_allocations WHERE invoice_id = $1`,
      [inv.body.id]
    );
    expect(Number(alloc[0].n)).toBe(1050);
  });

  it("[S2] every system posting stores its description key + params and the API returns them", async () => {
    const t = await h.createTenant({
      companyColumns: {
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

    const rows = await h.sql<{
      memo: string;
      memo_key: string | null;
      memo_params: Record<string, string> | null;
    }>(
      `SELECT memo, memo_key, memo_params FROM journal_entries WHERE company_id = $1 ORDER BY created_at`,
      [t.company.id]
    );
    const deposit = rows.find((r) => r.memo_key === "customerDeposit");
    expect(deposit, JSON.stringify(rows)).toBeTruthy();
    expect(deposit!.memo).toMatch(/^Customer deposit DEP-.* - Palm Co$/);
    expect(deposit!.memo_params).toMatchObject({ party: "Palm Co" });
    expect(rows.find((r) => r.memo_key === "depositApplied")?.memo_params).toMatchObject({
      invoice: expect.stringMatching(/^INV-/),
    });
    expect(rows.find((r) => r.memo_key === "salesInvoice")?.memo_params).toMatchObject({
      party: "Palm Co",
    });
    // No system posting is left without a key.
    expect(rows.filter((r) => !r.memo_key).map((r) => r.memo)).toEqual([]);

    // The journal list and the entry carry the key so the UI can render it in Arabic.
    const list = await t.as.get(`${base(t)}/journal`);
    expect(list.status, list.text).toBe(200);
    const listed = (list.body as Array<{ memoKey: string | null }>).find(
      (e) => e.memoKey === "customerDeposit"
    );
    expect(listed).toMatchObject({ memoKey: "customerDeposit" });

    // A reversal is keyed too (kernel default memo); a manual entry has no key.
    const manual = await t.as.post(`${base(t)}/journal`, {
      date: "2026-03-02",
      status: "posted",
      memo: "Office rent",
      lines: [
        { accountId: (await accountByCode(t, "1020")).id, debit: 0, credit: 10 },
        { accountId: (await accountByCode(t, "5020")).id, debit: 10, credit: 0 },
      ],
    });
    expect(manual.status, manual.text).toBeLessThan(300);
    const [typed] = await h.sql<{ memo_key: string | null }>(
      `SELECT memo_key FROM journal_entries WHERE id = $1`,
      [manual.body.id]
    );
    expect(typed.memo_key).toBeNull();
    const rev = await t.as.post(`/api/journal/${manual.body.id}/reverse`, { reason: "test" });
    expect(rev.status, rev.text).toBeLessThan(300);
    const [reversal] = await h.sql<{ memo_key: string | null; memo_params: Record<string, string> }>(
      `SELECT memo_key, memo_params FROM journal_entries WHERE reversed_entry_id = $1`,
      [manual.body.id]
    );
    expect(reversal.memo_key).toBe("reversalOfReason");
    expect(reversal.memo_params.reason).toBe("test");
  });
});
