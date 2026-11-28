/**
 * W3-A order-to-cash: R07-01 (R03-06), R03-01..05, R03-07, R03-08, R03-10..14, R03-20..25, R20-05.
 *
 * Every assertion reads the real ledger (journal_lines × accounts) of a fresh tenant.
 */
import { describe, expect, it, vi } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { dubaiIso, dubaiToday } from "../helpers/dates";

const h = useHarness();
const today = () => dubaiToday();
const daysAgo = (n: number) => dubaiIso(new Date(Date.now() - n * 86_400_000));

type Line = Record<string, unknown>;

async function createInvoice(t: Tenant, over: Record<string, unknown> = {}, lines?: Line[]) {
  return t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    date: today(),
    lines: lines ?? [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    ...over,
  });
}

async function mkIssued(t: Tenant, over: Record<string, unknown> = {}, lines?: Line[]) {
  const c = await createInvoice(t, over, lines);
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string; number: string; total: number };
}

/** Net (debit − credit) per account code over posted entries of the company. */
async function balances(t: Tenant): Promise<Record<string, number>> {
  const rows = await h.sql<{ code: string; net: string }>(
    `SELECT a.code, (COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0))::text AS net
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted'
      GROUP BY a.code`,
    [t.company.id]
  );
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.net)]));
}

async function entryLinesOf(t: Tenant, sourceId: string) {
  return h.sql<{ code: string; debit: string; credit: string; entry_kind: string; date: string }>(
    `SELECT a.code, jl.debit::text AS debit, jl.credit::text AS credit, je.entry_kind,
            to_char(je.date, 'YYYY-MM-DD') AS date
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted'
        AND (je.source_id = $2 OR je.id IN (
              SELECT reversed_by_entry_id FROM journal_entries
               WHERE company_id = $1 AND source_id = $2 AND reversed_by_entry_id IS NOT NULL))
      ORDER BY je.created_at, a.code`,
    [t.company.id, sourceId]
  );
}

async function pay(t: Tenant, invoiceId: string, body: Record<string, unknown>) {
  const bank = await accountByCode(t, "1020");
  return t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
    date: today(),
    method: "bank",
    paymentAccountId: bank.id,
    ...body,
  });
}

describe("W3-A sales cycle", () => {
  it("[R03-01][R03-22] USD 1,050 @3.6725 issued then voided nets A/R, revenue and VAT to 0.00 AED on the invoice date", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t, { currency: "USD", exchangeRate: 3.6725, date: daysAgo(3) });
    expect(Number(inv.total)).toBe(1050);
    const before = await balances(t);
    expect(before["1040"]).toBeCloseTo(3856.13, 2);
    const v = await t.as.patch(`/api/invoices/${inv.id}/status`, { status: "void" });
    expect(v.status, v.text).toBe(200);
    expect(v.body.status).toBe("void");
    const after = await balances(t);
    expect(after["1040"] ?? 0).toBe(0);
    expect(after["4020"] ?? 0).toBe(0);
    expect(after["2020"] ?? 0).toBe(0);
    const lines = await entryLinesOf(t, inv.id);
    const reversal = lines.filter((l) => l.entry_kind === "reversal");
    expect(reversal.length).toBeGreaterThan(0);
    // R03-13: the void is dated on the invoice date (open period), not today.
    expect(new Set(reversal.map((l) => l.date))).toEqual(new Set([daysAgo(3)]));
    // A second void is a no-op, never a second reversal.
    await t.as.patch(`/api/invoices/${inv.id}/status`, { status: "void" });
    expect((await entryLinesOf(t, inv.id)).filter((l) => l.entry_kind === "reversal").length).toBe(
      reversal.length
    );
  });

  it("[R03-04][R07-01] a partial credit note on a zero-rated line debits 4060, not 4020", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t, {}, [
      { description: "Std", quantity: 1, unitPrice: 1000, vatRate: 5 },
      {
        description: "Export",
        quantity: 1,
        unitPrice: 500,
        vatRate: 0,
        vatSupplyType: "zero_rated",
      },
    ]);
    const cn = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {
      lines: [
        {
          description: "Export",
          quantity: 1,
          unitPrice: 200,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    expect(cn.status, cn.text).toBe(201);
    const cnLines = await entryLinesOf(t, cn.body.id);
    const debited = cnLines.filter((l) => Number(l.debit) > 0).map((l) => l.code);
    expect(debited).toEqual(["4060"]);
    const b = await balances(t);
    expect(b["4060"]).toBe(-300);
    expect(b["4020"]).toBe(-1000);
    expect(b["1040"]).toBe(1550 - 200);
  });

  it("[R03-02] create rejects client status / number / totals / journal ids; nothing is written", async () => {
    const t = await h.createTenant();
    for (const extra of [
      { status: "paid" },
      { number: "INV-X" },
      { total: 1 },
      { subtotal: 1 },
      { journalEntryId: "00000000-0000-0000-0000-000000000001" },
      { companyId: t.company.id },
      { baseCurrencyAmount: 5 },
      { einvoiceStatus: "accepted" },
    ]) {
      const r = await createInvoice(t, extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    const rows = await h.sql("SELECT count(*)::int AS n FROM invoices WHERE company_id = $1", [
      t.company.id,
    ]);
    expect(rows[0].n).toBe(0);
  });

  it("[R03-03] an issued invoice is immutable: PUT currency or customer is 409, notes stay editable", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t);
    const cur = await t.as.put(`/api/invoices/${inv.id}`, { currency: "EUR" });
    expect(cur.status, cur.text).toBe(409);
    expect(cur.body.code).toBe("INVOICE_ISSUED_IMMUTABLE");
    const cust = await t.as.put(`/api/invoices/${inv.id}`, { customerName: "Renamed" });
    expect(cust.status).toBe(409);
    // S1: the message never names a field id (the UI shows catalog copy for the code).
    expect(cust.body.message).not.toMatch(/customerName/);
    expect(cust.body.details.fields).toContain("customerName");
    const lines = await t.as.put(`/api/invoices/${inv.id}`, {
      lines: [{ description: "Consulting", quantity: 2, unitPrice: 1000, vatRate: 5 }],
    });
    expect(lines.status).toBe(409);
    const notes = await t.as.put(`/api/invoices/${inv.id}`, {
      notes: "Thank you",
      customerName: "Acme LLC",
    });
    expect(notes.status, notes.text).toBe(200);
    expect(notes.body.notes).toBe("Thank you");
    const row = await h.sql("SELECT currency, customer_name FROM invoices WHERE id = $1", [inv.id]);
    expect(row[0]).toEqual({ currency: "AED", customer_name: "Acme LLC" });
  });

  it("[R03-05] a payment into Accounts Receivable (not cash/bank) is 422 and posts nothing", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t);
    const ar = await accountByCode(t, "1040");
    const r = await pay(t, inv.id, { amount: 1050, paymentAccountId: ar.id });
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("PAYMENT_ACCOUNT_NOT_CASH_OR_BANK");
    const p = await h.sql("SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1", [
      inv.id,
    ]);
    expect(p[0].n).toBe(0);
  });

  it("[R03-13] PATCH status=paid is refused in favour of the payment endpoint; the payment date drives the journal date", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t, { date: daysAgo(10) });
    const bank = await accountByCode(t, "1020");
    const patch = await t.as.patch(`/api/invoices/${inv.id}/status`, {
      status: "paid",
      paymentAccountId: bank.id,
    });
    expect(patch.status).toBe(400); // paymentAccountId is not part of the status contract
    const patch2 = await t.as.patch(`/api/invoices/${inv.id}/status`, { status: "paid" });
    expect(patch2.status).toBe(422);
    expect(patch2.body.code).toBe("USE_PAYMENT_ENDPOINT");
    const r = await pay(t, inv.id, { amount: 1050, date: daysAgo(2) });
    expect(r.status, r.text).toBe(201);
    expect(r.body.status).toBe("paid");
    const je = await h.sql<{ d: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE company_id = $1 AND source = 'payment'`,
      [t.company.id]
    );
    expect(je.map((x) => x.d)).toEqual([daysAgo(2)]);
  });

  it("[R07-01] zero_rated, exempt and out_of_scope lines persist their supply type and post to 4060 / 4070 / 4030", async () => {
    const t = await h.createTenant();
    const noType = await createInvoice(t, {}, [
      { description: "Ambiguous", quantity: 1, unitPrice: 100, vatRate: 0 },
    ]);
    expect(noType.status, noType.text).toBe(400);
    expect(noType.body.code).toBe("SUPPLY_TYPE_REQUIRED");
    const mismatch = await createInvoice(t, {}, [
      { description: "Bad", quantity: 1, unitPrice: 100, vatRate: 5, vatSupplyType: "exempt" },
    ]);
    expect(mismatch.status).toBe(400);

    const inv = await mkIssued(t, {}, [
      { description: "Std", quantity: 1, unitPrice: 1000, vatRate: 5 },
      { description: "Zero", quantity: 1, unitPrice: 500, vatRate: 0, vatSupplyType: "zero_rated" },
      { description: "Exempt", quantity: 1, unitPrice: 250, vatRate: 0, vatSupplyType: "exempt" },
      {
        description: "OOS",
        quantity: 1,
        unitPrice: 100,
        vatRate: 0,
        vatSupplyType: "out_of_scope",
      },
    ]);
    const stored = await h.sql<{ description: string; vat_supply_type: string }>(
      "SELECT description, vat_supply_type FROM invoice_lines WHERE invoice_id = $1 ORDER BY description",
      [inv.id]
    );
    expect(Object.fromEntries(stored.map((s) => [s.description, s.vat_supply_type]))).toEqual({
      Exempt: "exempt",
      OOS: "out_of_scope",
      Std: "standard_rated",
      Zero: "zero_rated",
    });
    const b = await balances(t);
    expect(b["4020"]).toBe(-1000);
    expect(b["4060"]).toBe(-500);
    expect(b["4070"]).toBe(-250);
    expect(b["4030"]).toBe(-100);
    expect(b["2020"]).toBe(-50);
    expect(b["1040"]).toBe(1900);
    // update also keeps the supply type (draft edit)
    const d = await createInvoice(t, {}, [
      { description: "Z", quantity: 1, unitPrice: 10, vatRate: 0, vatSupplyType: "zero_rated" },
    ]);
    const u = await t.as.put(`/api/invoices/${d.body.id}`, {
      lines: [
        { description: "E", quantity: 1, unitPrice: 10, vatRate: 0, vatSupplyType: "exempt" },
      ],
    });
    expect(u.status, u.text).toBe(200);
    expect(u.body.lines[0].vatSupplyType).toBe("exempt");
  });

  it("[R03-07][R03-20] a 10% discount reduces totals and credits revenue net; unknown discount fields are 400", async () => {
    const t = await h.createTenant();
    const bad = await createInvoice(t, {}, [
      { description: "x", quantity: 1, unitPrice: 100, vatRate: 5, discount: 10 },
    ]);
    expect(bad.status).toBe(400);
    const inv = await mkIssued(t, { discountType: "percent", discountValue: 10 }, [
      { description: "A", quantity: 2, unitPrice: 500, vatRate: 5 },
    ]);
    const row = await h.sql(
      "SELECT subtotal::text, vat_amount::text, total::text, discount_amount::text FROM invoices WHERE id = $1",
      [inv.id]
    );
    expect(row[0]).toEqual({
      subtotal: "900.00",
      vat_amount: "45.00",
      total: "945.00",
      discount_amount: "100.00",
    });
    const b = await balances(t);
    expect(b["4020"]).toBe(-900);
    expect(b["2020"]).toBe(-45);
    expect(b["1040"]).toBe(945);

    const lineDisc = await createInvoice(t, {}, [
      {
        description: "B",
        quantity: 1,
        unitPrice: 200,
        vatRate: 5,
        discountType: "amount",
        discountValue: 50,
      },
    ]);
    expect(lineDisc.status, lineDisc.text).toBe(200);
    expect(Number(lineDisc.body.subtotal)).toBe(150);
    expect(Number(lineDisc.body.lines[0].discountAmount)).toBe(50);
  });

  it("[R03-08][R03-21] credit note 100 on a paid invoice → customer credit 100; apply reduces the next invoice; refund posts cash out", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t);
    expect((await pay(t, inv.id, { amount: 1050 })).status).toBe(201);
    const cn = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {
      lines: [
        {
          description: "Refund part",
          quantity: 1,
          unitPrice: 100,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    // The invoice has no zero-rated revenue to credit.
    expect(cn.status, cn.text).toBe(409);
    expect(cn.body.code).toBe("CREDIT_EXCEEDS_REMAINING");
    expect(cn.body.details.supplyType).toBe("zero_rated");
    const cn2 = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {
      lines: [{ description: "Refund part", quantity: 1, unitPrice: 95.24, vatRate: 5 }],
    });
    expect(cn2.status, cn2.text).toBe(201);
    expect(cn2.body.customerCredit.amount).toBe("100.00");
    let b = await balances(t);
    expect(b["1040"] ?? 0).toBe(0); // receivable never goes negative
    expect(b["2055"]).toBe(-100);

    const credits = await t.as.get(`/api/companies/${t.company.id}/customer-credits`);
    expect(credits.status).toBe(200);
    const credit = credits.body.find((c: { sourceId: string }) => c.sourceId === cn2.body.id);
    expect(Number(credit.remaining)).toBe(100);

    const next = await mkIssued(t, {}, [
      { description: "Next", quantity: 1, unitPrice: 200, vatRate: 5 },
    ]);
    const apply = await t.as.post(
      `/api/companies/${t.company.id}/customer-credits/${credit.id}/apply`,
      { invoiceId: next.id, amount: 60 }
    );
    expect(apply.status, apply.text).toBe(201);
    const detail = await t.as.get(`/api/invoices/${next.id}`);
    expect(detail.body.settlement.amountDue).toBe("150.00");
    expect(detail.body.status).toBe("partial");

    const bank = await accountByCode(t, "1020");
    const bankBefore = (await balances(t))["1020"];
    const refund = await t.as.post(
      `/api/companies/${t.company.id}/customer-credits/${credit.id}/refund`,
      { amount: 40, paymentAccountId: bank.id }
    );
    expect(refund.status, refund.text).toBe(201);
    b = await balances(t);
    expect(b["1020"]).toBeCloseTo(bankBefore - 40, 2);
    expect(b["2055"] ?? 0).toBe(0);
    const over = await t.as.post(
      `/api/companies/${t.company.id}/customer-credits/${credit.id}/refund`,
      { amount: 1, paymentAccountId: bank.id }
    );
    expect(over.status).toBe(409);
    // The used credit's credit note can no longer be voided.
    const v = await t.as.post(`/api/credit-notes/${cn2.body.id}/void`, {});
    expect(v.status).toBe(409);
  });

  it("[R03-21] standalone credit note: draft → issue → void restores balances; debit notes have their own numbering", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t);
    const before = await balances(t);
    const draft = await t.as.post(`/api/companies/${t.company.id}/credit-notes`, {
      invoiceId: inv.id,
      lines: [{ description: "Damaged", quantity: 1, unitPrice: 100, vatRate: 5 }],
      reason: "Damaged goods",
    });
    expect(draft.status, draft.text).toBe(201);
    expect(draft.body.status).toBe("draft");
    expect(await balances(t)).toEqual(before); // a draft posts nothing
    const issued = await t.as.post(`/api/credit-notes/${draft.body.id}/issue`, {});
    expect(issued.status, issued.text).toBe(200);
    expect(issued.body.status).toBe("issued");
    expect((await balances(t))["1040"]).toBe(1050 - 105);
    const voided = await t.as.post(`/api/credit-notes/${draft.body.id}/void`, {});
    expect(voided.status, voided.text).toBe(200);
    expect(voided.body.status).toBe("void");
    const after = await balances(t);
    expect(after["1040"]).toBe(1050);
    expect(after["4020"]).toBe(-1000);
    expect(after["2020"]).toBe(-50);

    const dn = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/debit-note`, {
      lines: [{ description: "Extra freight", quantity: 1, unitPrice: 40, vatRate: 5 }],
    });
    expect(dn.status, dn.text).toBe(201);
    expect(dn.body.number).toMatch(/^DN-\d{4}-00001$/);
    expect(dn.body.invoiceType).toBe("debit_note");
    expect((await balances(t))["1040"]).toBe(1050 + 42);
  });

  it("[W3-A RBAC] /api/credit-notes/:id resolves its company from invoices: other tenants get 404, a viewer gets 403", async () => {
    const t = await h.createTenant();
    const b = await h.createSecondTenant();
    const inv = await mkIssued(t);
    const draft = await t.as.post(`/api/companies/${t.company.id}/credit-notes`, {
      invoiceId: inv.id,
      lines: [{ description: "Damaged", quantity: 1, unitPrice: 100, vatRate: 5 }],
      reason: "Damaged goods",
    });
    expect(draft.status, draft.text).toBe(201);
    const id = draft.body.id as string;
    // The policy row lookup must hit the invoices row (credit_notes has no such id).
    expect(await h.sql(`SELECT 1 FROM credit_notes WHERE id = $1`, [id])).toEqual([]);
    expect((await b.as.get(`/api/credit-notes/${id}`)).status).toBe(404);
    expect((await b.as.post(`/api/credit-notes/${id}/issue`, {})).status).toBe(404);
    expect((await b.as.post(`/api/credit-notes/${id}/void`, {})).status).toBe(404);

    const viewer = await h.createTenant({ name: "CnViewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      viewer.user.id,
    ]);
    expect((await viewer.as.get(`/api/credit-notes/${id}`)).status).toBe(200);
    expect((await viewer.as.post(`/api/credit-notes/${id}/issue`, {})).status).toBe(403);
    const still = await h.sql<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [
      id,
    ]);
    expect(still[0].status).toBe("draft");
    expect((await t.as.get(`/api/credit-notes/${id}`)).status).toBe(200);
  });

  it("[R03-10][R03-25] invoice for a contact with TRN and net30 fills customerTrn, address and dueDate", async () => {
    const t = await h.createTenant();
    const created = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Gulf Trading",
      trnNumber: "100222333400003",
      address: "Office 1",
      city: "Dubai",
      paymentTerms: 30,
      emirate: "dubai",
    });
    expect(created.status, created.text).toBe(200);
    const contact = created.body as { id: string; emirate: string };
    expect(contact.emirate).toBe("dubai");
    const date = daysAgo(1);
    const r = await createInvoice(t, { customerName: undefined, contactId: contact.id, date });
    expect(r.status, r.text).toBe(200);
    expect(r.body.customerName).toBe("Gulf Trading");
    expect(r.body.customerTrn).toBe("100222333400003");
    expect(r.body.contactId).toBe(contact.id);
    expect(r.body.paymentTerms).toBe("net30");
    expect(r.body.placeOfSupplyEmirate).toBe("dubai");
    expect(new Date(r.body.dueDate).toISOString().slice(0, 10)).toBe(
      new Date(new Date(`${date}T00:00:00Z`).getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
    );
    const other = await h.createSecondTenant();
    const leak = await other.as.post(`/api/companies/${other.company.id}/invoices`, {
      contactId: contact.id,
      date,
      lines: [{ description: "x", quantity: 1, unitPrice: 1, vatRate: 5 }],
    });
    expect(leak.status).toBe(404);
  });

  it("[R03-11] quotes are strict and 20 parallel conversions produce exactly one invoice; progress billing bills part", async () => {
    const t = await h.createTenant();
    const bad = await t.as.post(`/api/companies/${t.company.id}/quotes`, {
      customerName: "Q",
      date: today(),
      status: "converted",
      lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 5 }],
    });
    expect(bad.status).toBe(400);
    const neg = await t.as.post(`/api/companies/${t.company.id}/quotes`, {
      customerName: "Q",
      date: today(),
      lines: [{ description: "x", quantity: -1, unitPrice: 10, vatRate: 5 }],
    });
    expect(neg.status).toBe(400);
    const q = await t.as.post(`/api/companies/${t.company.id}/quotes`, {
      customerName: "Quote Co",
      date: today(),
      paymentTerms: "net15",
      lines: [{ description: "Build", quantity: 4, unitPrice: 250, vatRate: 5 }],
    });
    expect(q.status, q.text).toBe(201);
    const b2 = await h.createSecondTenant();
    const move = await t.as.put(`/api/quotes/${q.body.id}`, { companyId: b2.company.id });
    expect(move.status).toBe(400);

    // Progress billing: 1 of 4 units first.
    const part = await t.as.post(`/api/quotes/${q.body.id}/convert-to-invoice`, {
      lines: [{ quoteLineId: q.body.lines[0].id, quantity: 1 }],
    });
    expect(part.status, part.text).toBe(200);
    expect(part.body.fullyBilled).toBe(false);
    expect(Number(part.body.invoice.total)).toBe(262.5);
    expect(part.body.invoice.paymentTerms).toBe("net15");
    expect(part.body.invoice.dueDate).toBeTruthy();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => t.as.post(`/api/quotes/${q.body.id}/convert-to-invoice`, {}))
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok.length, JSON.stringify(results.map((r) => r.status))).toBe(1);
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    expect(Number(ok[0].body.invoice.total)).toBe(787.5);
    const rows = await h.sql("SELECT count(*)::int AS n FROM invoices WHERE source_quote_id = $1", [
      q.body.id,
    ]);
    expect(rows[0].n).toBe(2);
    const status = await h.sql("SELECT status FROM quotes WHERE id = $1", [q.body.id]);
    expect(status[0].status).toBe("converted");
  });

  it("[PR93-3] skips expired auto-issue templates before changing invoices, journals or schedules", async () => {
    const active = await h.createTenant();
    const expired = await h.createSecondTenant();
    async function due(t: Tenant) {
      const created = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
        customerName: "Monthly Customer",
        frequency: "monthly",
        startDate: today(),
        autoIssue: true,
        lines: [{ description: "Retainer", quantity: 1, unitPrice: 100, vatRate: 5 }],
      });
      expect(created.status, created.text).toBe(200);
      return created.body.id as string;
    }
    const activeId = await due(active);
    const expiredId = await due(expired);
    await h.sql(
      "UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE company_id = $1",
      [expired.company.id]
    );
    const state = async (tenant: Tenant, id: string) => ({
      invoices: await h.sql("SELECT id, status FROM invoices WHERE company_id = $1 ORDER BY id", [
        tenant.company.id,
      ]),
      journal: await h.sql("SELECT id FROM journal_entries WHERE company_id = $1 ORDER BY id", [
        tenant.company.id,
      ]),
      schedule: await h.sql("SELECT * FROM recurring_invoices WHERE id = $1", [id]),
    });
    const beforeExpired = await state(expired, expiredId);
    const beforeActive = await state(active, activeId);
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    vi.stubEnv("BILLING_ENFORCEMENT", "true");
    try {
      await generateDueRecurringInvoices();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await state(expired, expiredId)).toEqual(beforeExpired);
    const afterActive = await state(active, activeId);
    expect(afterActive.invoices).toEqual([{ id: expect.any(String), status: "sent" }]);
    expect(afterActive.journal).toHaveLength(beforeActive.journal.length + 1);
    expect(afterActive.schedule[0].next_run_date).not.toEqual(
      beforeActive.schedule[0].next_run_date
    );
  });

  it("[R03-12][R03-23] a EUR recurring template generates an invoice at the company EUR rate with the correct AED posting", async () => {
    const t = await h.createTenant();
    const rate = await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
      fromCurrency: "EUR",
      toCurrency: "AED",
      rate: 4,
      // The scheduler dates the generated invoice by the Dubai day; the rate must be effective then.
      effectiveDate: today(),
    });
    expect(rate.status, rate.text).toBe(201);
    const bad = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
      customerName: "Euro GmbH",
      frequency: "monthly",
      startDate: today(),
      lines: [{ description: "Licence", quantity: 1, unitPrice: 100, vatRate: 0 }],
    });
    expect(bad.status).toBe(400); // 0% line without supply type
    const tpl = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
      customerName: "Euro GmbH",
      currency: "EUR",
      frequency: "monthly",
      startDate: today(),
      autoIssue: true,
      autoSend: true,
      sendToEmail: "billing@example.com",
      lines: [
        { description: "Licence", quantity: 1, unitPrice: 100, vatRate: 5 },
        {
          description: "Export svc",
          quantity: 1,
          unitPrice: 50,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    expect(tpl.status, tpl.text).toBe(200);
    const draftTpl = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
      customerName: "Draft Co",
      frequency: "monthly",
      startDate: today(),
      autoIssue: false,
      lines: [{ description: "Retainer", quantity: 1, unitPrice: 10, vatRate: 5 }],
    });
    expect(draftTpl.status).toBe(200);
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    await generateDueRecurringInvoices();

    const [gen] = await h.sql<{ id: string; status: string; exchange_rate: string; total: string }>(
      "SELECT id, status, exchange_rate::text, total::text FROM invoices WHERE company_id = $1 AND customer_name = 'Euro GmbH'",
      [t.company.id]
    );
    expect(gen).toBeTruthy();
    expect(Number(gen.exchange_rate)).toBe(4);
    expect(gen.total).toBe("155.00");
    expect(gen.status).toBe("sent");
    const b = await balances(t);
    expect(b["1040"]).toBe(620); // 155 EUR × 4
    expect(b["4020"]).toBe(-400);
    expect(b["4060"]).toBe(-200);
    expect(b["2020"]).toBe(-20);
    const tplRow = await h.sql(
      "SELECT last_run_status, last_run_message FROM recurring_invoices WHERE id = $1",
      [tpl.body.id]
    );
    // No email provider in the harness: honest "issued, not sent".
    expect(tplRow[0].last_run_status).toBe("issued_not_sent");
    const [draft] = await h.sql<{ status: string }>(
      "SELECT status FROM invoices WHERE company_id = $1 AND customer_name = 'Draft Co'",
      [t.company.id]
    );
    expect(draft.status).toBe("draft");
  });

  it("[R20-05] invoice list: cursor pagination (default 50), stable pages, all=true escape", async () => {
    const t = await h.createTenant();
    for (let i = 0; i < 7; i++)
      expect((await createInvoice(t, { customerName: `C${i}` })).status).toBe(200);
    const p1 = await t.as.get(`/api/companies/${t.company.id}/invoices?limit=3`);
    expect(p1.status).toBe(200);
    expect(p1.body.items.length).toBe(3);
    expect(p1.body.limit).toBe(3);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await t.as.get(
      `/api/companies/${t.company.id}/invoices?limit=3&cursor=${encodeURIComponent(p1.body.nextCursor)}`
    );
    const p3 = await t.as.get(
      `/api/companies/${t.company.id}/invoices?limit=3&cursor=${encodeURIComponent(p2.body.nextCursor)}`
    );
    expect(p3.body.items.length).toBe(1);
    expect(p3.body.nextCursor).toBeNull();
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map(
      (x: { id: string }) => x.id
    );
    expect(new Set(ids).size).toBe(7);
    const def = await t.as.get(`/api/companies/${t.company.id}/invoices?cursor=`);
    expect(def.body.limit).toBe(50);
    // No paging params: paginated by default (R20-05 complete), never the full array.
    const bare = await t.as.get(`/api/companies/${t.company.id}/invoices`);
    expect(bare.status).toBe(200);
    expect(Array.isArray(bare.body)).toBe(false);
    expect(bare.body.limit).toBe(50);
    expect(bare.body.items.length).toBe(7);
    expect(bare.body.nextCursor).toBeNull();
    const all = await t.as.get(`/api/companies/${t.company.id}/invoices?all=true`);
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.length).toBe(7);
    expect(all.body[0].einvoiceXml).toBeUndefined();
    const badCursor = await t.as.get(`/api/companies/${t.company.id}/invoices?limit=2&cursor=zzz`);
    expect(badCursor.status).toBe(400);
  });

  it("[R03-14] public share view labels a tax invoice and shows due date and payment status", async () => {
    const t = await h.createTenant();
    await t.as.patch(`/api/companies/${t.company.id}`, {
      trnVatNumber: "100123456700003",
      emirate: "dubai",
    });
    const inv = await mkIssued(t, { paymentTerms: "net30" });
    const share = await t.as.post(`/api/invoices/${inv.id}/share`, {});
    expect(share.status).toBe(200);
    const pub = await h.anon.get(`/api/public/invoices/${share.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.invoice.isTaxInvoice).toBe(true);
    expect(pub.body.invoice.dueDate).toBeTruthy();
    expect(pub.body.invoice.paymentStatus).toBe("unpaid");
    expect(pub.body.invoice.amountDue).toBe(1050);
    // R03-24: template branding (strict contract) is applied to the PDF.
    const badTpl = await t.as.post(`/api/companies/${t.company.id}/invoice-templates`, {
      name: "Brand",
      watermark: "x",
    });
    expect(badTpl.status).toBe(400);
    const tpl = await t.as.post(`/api/companies/${t.company.id}/invoice-templates`, {
      name: "Brand",
      primaryColor: "#0D5C3D",
      footerText: "Thanks from Brand",
      termsText: "Payment within 30 days",
      bankDetails: "IBAN AE07 0331 2345 6789 0123 456",
    });
    expect(tpl.status, tpl.text).toBe(201);
    expect((await t.as.post(`/api/invoice-templates/${tpl.body.id}/set-default`, {})).status).toBe(
      200
    );
    const pdf = await t.as.get(`/api/invoices/${inv.id}/pdf`);
    expect(pdf.status).toBe(200);
    const dn = await t.as.get(`/api/invoices/${inv.id}/delivery-note`);
    expect(dn.status).toBe(200);
    expect(dn.headers.get("content-type")).toContain("application/pdf");
  });

  it("[R03-22] a partial credit on a foreign invoice reverses at the original rate; payment at a new rate books realised FX", async () => {
    const t = await h.createTenant();
    const inv = await mkIssued(t, { currency: "USD", exchangeRate: 3.6725 });
    const cn = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {
      lines: [{ description: "Part", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(cn.status, cn.text).toBe(201);
    const b = await balances(t);
    // 950 USD left at 3.6725 = 3,488.88 (revenue 900×3.6725 + VAT 45×3.6725 rounded per leg)
    expect(b["4020"]).toBeCloseTo(-(3672.5 - 367.25), 2);
    const r = await pay(t, inv.id, { amount: 945, exchangeRate: 3.7 });
    expect(r.status, r.text).toBe(201);
    expect(r.body.status).toBe("paid");
    const after = await balances(t);
    expect(after["1040"] ?? 0).toBeCloseTo(0, 2);
    expect(after["4090"]).toBeLessThan(0); // realised FX gain
  });

  it("[R03-02][R03-13] status, payment and credit-note events are emitted after commit", async () => {
    const { onDomainEvent } = await import("../../server/platform/domain-events");
    const seen: string[] = [];
    const off = onDomainEvent("*", (e) => {
      seen.push(e.type);
    });
    const t = await h.createTenant();
    const inv = await mkIssued(t);
    await pay(t, inv.id, { amount: 1050 });
    await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {});
    const v = await mkIssued(t);
    await t.as.patch(`/api/invoices/${v.id}/status`, { status: "void" });
    await new Promise((r) => setTimeout(r, 50));
    off();
    for (const type of [
      "invoice.created",
      "invoice.issued",
      "payment.received",
      "invoice.paid",
      "credit_note.issued",
      "invoice.voided",
    ]) {
      expect(seen, type).toContain(type);
    }
    const { has } = await import("../../server/platform/service-registry");
    expect(has("invoices.recordPayment")).toBe(true);
  });
});
