/**
 * WQ1 (sales documents finished): cash sale (7.7), one receipt over several invoices with a bank
 * fee and an overpayment (7.6), realised FX on a receipt, partial credit note VAT (7.15), make
 * recurring + outbox (7.13), cost centre on an invoice line (6.9 / 7.2i), attachments (7.2g),
 * the sent / viewed log (7.25), document language (7.21), source filter (13.5), quote by email
 * (7.5).
 */
import { describe, expect, it, vi } from "vitest";
import { drainDomainEvents, onDomainEvent } from "../../server/platform/domain-events";
import { accountByCode, ledgerTotals, useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const DATE = "2026-11-10";

async function bankAccount(t: Tenant) {
  const r = await t.as.post(`${base(t)}/bank-accounts`, {
    nameEn: "Emirates NBD",
    bankName: "Emirates NBD",
  });
  expect(r.status, r.text).toBe(201);
  // The first bank account of a company gets GL 1021 under the 1020 header.
  expect(r.body.glAccount.code).toBe("1021");
  return r.body as { id: string; glAccountId: string; glAccount: { id: string; code: string } };
}

async function contact(t: Tenant, name = "Gulf Retail LLC", extra: Record<string, unknown> = {}) {
  const r = await t.as.post(`${base(t)}/customer-contacts`, {
    name,
    email: "ap@gulfretail.example",
    paymentTerms: 30,
    emirate: "dubai",
    ...extra,
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body as { id: string; name: string };
}

async function issued(t: Tenant, body: Record<string, unknown>) {
  const r = await t.as.post(`${base(t)}/invoices`, {
    date: DATE,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
    ...body,
  });
  expect(r.status, r.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${r.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return r.body as { id: string; number: string; total: number };
}

/** Posted journal lines of the company by source, as "code:debit/credit". */
async function linesBySource(t: Tenant, sources: string[]) {
  const rows = await h.sql<{ source: string; code: string; debit: string; credit: string }>(
    `SELECT je.source, a.code, SUM(jl.debit)::text AS debit, SUM(jl.credit)::text AS credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = ANY($2::text[])
      GROUP BY je.source, a.code ORDER BY je.source, a.code`,
    [t.company.id, sources]
  );
  return rows.map((r) => `${r.source} ${r.code} ${r.debit}/${r.credit}`);
}

async function balanceOf(t: Tenant, code: string): Promise<number> {
  const [row] = await h.sql<{ b: string }>(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS b
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(row.b);
}

describe("WQ1 cash sale (7.7)", () => {
  it("posts the invoice and the payment in one go, with exact lines, and AR nets to 0", async () => {
    const t = await h.createTenant();
    const bank = await bankAccount(t);
    const r = await t.as.post(`${base(t)}/cash-sales`, {
      date: DATE,
      placeOfSupplyEmirate: "dubai",
      paymentAccountId: bank.glAccountId,
      lines: [{ description: "Walk-in repair", quantity: 2, unitPrice: 250, vatRate: 0.05 }],
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({
      status: "paid",
      customerName: "Cash customer",
      source: "cash_sale",
      total: 525,
      paymentTerms: "due_on_receipt",
    });
    expect(await linesBySource(t, ["invoice", "payment"])).toEqual([
      "invoice 1040 525.00/0.00",
      "invoice 2020 0.00/25.00",
      "invoice 4020 0.00/500.00",
      "payment 1021 525.00/0.00",
      "payment 1040 0.00/525.00",
    ]);
    expect(await balanceOf(t, "1040")).toBe(0);
    const totals = await ledgerTotals(t.company.id);
    expect(totals.debit).toBe(totals.credit);
    // Source filter (13.5): the cash sale is listed under its own source only.
    const listed = await t.as.get(`${base(t)}/invoices?source=cash_sale`);
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual([r.body.id]);
    const api = await t.as.get(`${base(t)}/invoices?source=api`);
    expect(api.body.items).toEqual([]);
  });

  it("needs a cash or bank account and rolls back everything when the payment fails", async () => {
    const t = await h.createTenant();
    const ar = await accountByCode(t, "1040");
    const r = await t.as.post(`${base(t)}/cash-sales`, {
      date: DATE,
      placeOfSupplyEmirate: "dubai",
      paymentAccountId: ar.id,
      lines: [{ description: "Item", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("PAYMENT_ACCOUNT_NOT_CASH_OR_BANK");
    const n = await h.sql(`SELECT id FROM invoices WHERE company_id = $1`, [t.company.id]);
    expect(n).toEqual([]);
  });
});

describe("WQ1 receive payment over several invoices (7.6)", () => {
  it("applies oldest first, books the bank fee and the overpayment as customer credit; AR ties to the aging", async () => {
    const t = await h.createTenant();
    const bank = await bankAccount(t);
    const c = await contact(t);
    const older = await issued(t, { contactId: c.id, date: "2026-10-01" });
    const newer = await issued(t, {
      contactId: c.id,
      lines: [{ description: "Support", quantity: 1, unitPrice: 500, vatRate: 0.05 }],
    });
    const open = await t.as.get(
      `${base(t)}/receive-payments/open-invoices?contactId=${encodeURIComponent(c.id)}`
    );
    expect(open.status, open.text).toBe(200);
    expect(
      open.body.map((i: { id: string; openBalance: number }) => [i.id, i.openBalance])
    ).toEqual([
      [older.id, 1050],
      [newer.id, 525],
    ]);

    const r = await t.as.post(`${base(t)}/receive-payments`, {
      contactId: c.id,
      paymentAccountId: bank.glAccountId,
      date: "2026-11-12",
      amount: 2000,
      bankFee: 10,
      reference: "TT-778",
      allocations: [
        { invoiceId: older.id, amount: 1050 },
        { invoiceId: newer.id, amount: 525 },
      ],
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({
      applied: "1575.00",
      customerCredit: "425.00",
      bankFee: "10.00",
    });
    expect(r.body.payments.map((p: { status: string }) => p.status)).toEqual(["paid", "paid"]);

    expect(await linesBySource(t, ["payment", "customer_receipt_fee"])).toEqual([
      "customer_receipt_fee 1021 0.00/10.00",
      "customer_receipt_fee 5110 10.00/0.00",
      "payment 1021 2000.00/0.00",
      "payment 1040 0.00/1575.00",
      "payment 2055 0.00/425.00",
    ]);
    // The bank received what the customer paid less the fee.
    expect(await balanceOf(t, bank.glAccount.code)).toBe(1990);
    // Customer credit (2055) for the overpayment, usable on a later invoice.
    const credits = await h.sql<{ amount: string; remaining: string; contact_id: string }>(
      `SELECT amount::text, remaining::text, contact_id FROM customer_credits WHERE company_id = $1`,
      [t.company.id]
    );
    expect(credits).toEqual([{ amount: "425.00", remaining: "425.00", contact_id: c.id }]);
    // AR 1040 ties to the settlement aging.
    const { agedReceivables } = await import("../../server/reporting/aging");
    const aging = await agedReceivables({ companyId: t.company.id, asOf: "2026-11-30" });
    expect(aging.totals.total).toBe(0);
    expect(await balanceOf(t, "1040")).toBe(aging.netTotal);
  });

  it("is all or nothing: an allocation above an invoice's open balance posts nothing", async () => {
    const t = await h.createTenant();
    const bank = await bankAccount(t);
    const c = await contact(t);
    const a = await issued(t, { contactId: c.id });
    const b = await issued(t, { contactId: c.id });
    const r = await t.as.post(`${base(t)}/receive-payments`, {
      contactId: c.id,
      paymentAccountId: bank.glAccountId,
      date: "2026-11-12",
      amount: 2200,
      allocations: [
        { invoiceId: a.id, amount: 1050 },
        { invoiceId: b.id, amount: 1100 },
      ],
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("ALLOCATION_EXCEEDS_BALANCE");
    expect(await linesBySource(t, ["payment"])).toEqual([]);
  });

  it("another tenant's invoice is a 404 and nothing is posted", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const bank = await bankAccount(t);
    const mine = await issued(t, { customerName: "Gulf Retail LLC" });
    const theirs = await issued(other, { customerName: "Gulf Retail LLC" });
    const r = await t.as.post(`${base(t)}/receive-payments`, {
      customerName: "Gulf Retail LLC",
      paymentAccountId: bank.glAccountId,
      date: "2026-11-12",
      amount: 2100,
      allocations: [
        { invoiceId: mine.id, amount: 1050 },
        { invoiceId: theirs.id, amount: 1050 },
      ],
    });
    expect(r.status, r.text).toBe(404);
    expect(await linesBySource(t, ["payment"])).toEqual([]);
    expect(await linesBySource(other, ["payment"])).toEqual([]);
  });

  it("PR129: the bank fee limit is the cash the payment journals debit to the bank", async () => {
    const t = await h.createTenant();
    const bank = await bankAccount(t);
    const c = await contact(t, "Export Partner FZE");
    const events: string[] = [];
    const off = onDomainEvent("payment.received", (e) => void events.push(e.payload.invoiceId));
    const usd = (exchangeRate: number) =>
      issued(t, {
        contactId: c.id,
        currency: "USD",
        exchangeRate,
        lines: [
          {
            description: "Export consulting",
            quantity: 1,
            unitPrice: 100,
            vatRate: 0,
            vatSupplyType: "zero_rated",
          },
        ],
      });
    const high = await usd(4);
    const low = await usd(3);
    // No typed rate: the service settles at the payment-date rate (3.6725), whatever the invoices
    // were booked at. Each USD 25 leg books AED 91.81, so the bank gets AED 183.62 (not 183.63).
    const receive = (bankFee: number, ...invoices: Array<{ id: string }>) =>
      t.as.post(`${base(t)}/receive-payments`, {
        contactId: c.id,
        paymentAccountId: bank.glAccountId,
        date: "2026-11-12",
        amount: 50,
        bankFee,
        allocations: invoices.map((i) => ({ invoiceId: i.id, amount: 25 })),
      });

    try {
      for (const fee of [190, 183.62]) {
        for (const order of [
          [high, low],
          [low, high],
        ]) {
          const refused = await receive(fee, ...order);
          expect(refused.status, refused.text).toBe(422);
          expect(refused.body.code).toBe("BANK_FEE_TOO_LARGE");
        }
      }
      // Rolled back: no payments, journals or credits, and no after-commit events.
      await drainDomainEvents();
      expect(events).toEqual([]);
      expect(await linesBySource(t, ["payment", "customer_receipt_fee"])).toEqual([]);
      expect(
        await h.sql(`SELECT id FROM invoice_payments WHERE company_id = $1`, [t.company.id])
      ).toEqual([]);
      expect(
        await h.sql(`SELECT status FROM invoices WHERE company_id = $1`, [t.company.id])
      ).toEqual([{ status: "sent" }, { status: "sent" }]);

      const accepted = await receive(183.61, low, high);
      expect(accepted.status, accepted.text).toBe(201);
      expect(accepted.body.bankFee).toBe("183.61");
      await drainDomainEvents();
      expect(events.sort()).toEqual([high.id, low.id].sort());
      // AED 183.62 debited by the two payments, less the fee.
      expect(await balanceOf(t, bank.glAccount.code)).toBe(0.01);
    } finally {
      off();
    }
  });

  it("a USD invoice received at a later rate books realised FX", async () => {
    const t = await h.createTenant();
    const bank = await bankAccount(t);
    const c = await contact(t, "Export Partner FZE");
    const inv = await issued(t, {
      contactId: c.id,
      currency: "USD",
      exchangeRate: 3.6725,
      lines: [
        {
          description: "Export consulting",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    const r = await t.as.post(`${base(t)}/receive-payments`, {
      contactId: c.id,
      paymentAccountId: bank.glAccountId,
      date: "2026-11-14",
      amount: 1000,
      exchangeRate: 3.7,
      allocations: [{ invoiceId: inv.id, amount: 1000 }],
    });
    expect(r.status, r.text).toBe(201);
    expect(await linesBySource(t, ["payment"])).toEqual([
      "payment 1021 3700.00/0.00",
      "payment 1040 0.00/3672.50",
      "payment 4090 0.00/27.50",
    ]);
    expect(await balanceOf(t, "1040")).toBe(0);
  });
});

describe("WQ1 partial credit note from an invoice (7.15)", () => {
  it("reduces VAT 201 Box 1 by the credited line only", async () => {
    const t = await h.createTenant();
    const inv = await issued(t, {
      customerName: "Gulf Retail LLC",
      lines: [
        { description: "Laptop", quantity: 2, unitPrice: 1000, vatRate: 0.05 },
        { description: "Setup", quantity: 1, unitPrice: 400, vatRate: 0.05 },
      ],
    });
    const { computeVat201 } = await import("../../server/tax/vat-engine");
    const before = await computeVat201({
      companyId: t.company.id,
      from: "2026-10-01",
      to: "2026-12-31",
    });
    // One of the two laptops comes back; the setup line is not credited.
    const cn = await t.as.post(`${base(t)}/credit-notes`, {
      invoiceId: inv.id,
      reason: "One laptop returned",
      date: "2026-11-15",
      lines: [
        {
          description: "Laptop",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
    });
    expect(cn.status, cn.text).toBe(201);
    const issuedCn = await t.as.post(`/api/credit-notes/${cn.body.id}/issue`, {});
    expect(issuedCn.status, issuedCn.text).toBe(200);
    const after = await computeVat201({
      companyId: t.company.id,
      from: "2026-10-01",
      to: "2026-12-31",
    });
    const net = (c: typeof before) => ({
      amount: c.boxesFils.box1bDubaiAmount + c.boxesFils.box1bDubaiAdj,
      vat: c.boxesFils.box1bDubaiVat,
    });
    expect(net(before)).toEqual({ amount: 240000, vat: 12000 });
    expect(net(after).amount).toBe(140000);
    // VAT due falls by 5% of the credited line only (50.00), not of the whole invoice.
    expect(before.boxesFils.box12TotalDueTax - after.boxesFils.box12TotalDueTax).toBe(5000);
    const [{ open }] = await h.sql<{ open: string }>(
      `SELECT (i.total - COALESCE((SELECT SUM(-c.total) FROM invoices c
                 WHERE c.original_invoice_id = i.id AND c.invoice_type = 'credit_note'
                   AND c.status NOT IN ('draft','void','cancelled')), 0))::text AS open
         FROM invoices i WHERE i.id = $1`,
      [inv.id]
    );
    expect(Number(open)).toBe(2520 - 1050);
  });
});

describe("WQ1 make recurring from an invoice (7.13)", () => {
  it("creates the schedule and the next run emails through the outbox: queued, never sent", async () => {
    const t = await h.createTenant();
    const c = await contact(t, "Gulf Retail LLC", { preferredLanguage: "ar" });
    const inv = await issued(t, { contactId: c.id });
    // The row action seeds the recurring editor from the invoice; it saves through the one
    // recurring-invoice route with email automatically on.
    const tpl = await t.as.post(`${base(t)}/recurring-invoices`, {
      contactId: c.id,
      customerName: "Gulf Retail LLC",
      frequency: "monthly",
      startDate: dubaiToday(),
      autoIssue: true,
      autoSend: true,
      sendToEmail: "ap@gulfretail.example",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
    });
    expect(tpl.status, tpl.text).toBe(200);
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    await generateDueRecurringInvoices();
    const [gen] = await h.sql<{ id: string; status: string; source: string }>(
      `SELECT id, status, source FROM invoices WHERE company_id = $1 AND id <> $2`,
      [t.company.id, inv.id]
    );
    expect(gen).toMatchObject({ status: "sent", source: "recurring" });
    const outbox = await h.sql<{
      status: string;
      to_address: string;
      category: string;
      html: string;
    }>(`SELECT status, to_address, category, html FROM email_outbox WHERE related_entity_id = $1`, [
      gen.id,
    ]);
    expect(outbox).toMatchObject([
      { status: "blocked_no_provider", to_address: "ap@gulfretail.example", category: "invoice" },
    ]);
    expect(outbox[0].html).toContain('<div dir="rtl" lang="ar"');
    expect(outbox[0].html).not.toContain('<div dir="ltr" lang="en"');
    const [row] = await h.sql<{ last_run_status: string; last_run_message: string }>(
      `SELECT last_run_status, last_run_message FROM recurring_invoices WHERE id = $1`,
      [tpl.body.id]
    );
    expect(row.last_run_status).toBe("issued_not_sent");
    expect(row.last_run_message).toMatch(/queued/);
    // The old 410 endpoint is gone.
    const old = await t.as.post(`${base(t)}/invoices/${inv.id}/set-recurring`, {});
    expect(old.status).toBe(404);
  });
});

describe("WQ1 cost centre on an invoice line (7.2i / 6.9)", () => {
  it("the revenue line carries the cost centre into the cost-centre P&L", async () => {
    const t = await h.createTenant();
    const cc = await t.as.post(`${base(t)}/cost-centers`, { code: "DXB", name: "Dubai branch" });
    expect(cc.status, cc.text).toBe(201);
    await issued(t, {
      customerName: "Gulf Retail LLC",
      lines: [
        {
          description: "Consulting",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0.05,
          costCenterId: cc.body.id,
        },
        { description: "Unallocated", quantity: 1, unitPrice: 300, vatRate: 0.05 },
      ],
    });
    const rows = await h.sql<{ code: string; credit: string }>(
      `SELECT a.code, SUM(jl.credit)::text AS credit FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
        WHERE jl.cost_center_id = $1 GROUP BY a.code`,
      [cc.body.id]
    );
    expect(rows).toEqual([{ code: "4020", credit: "1000.00" }]);
    const report = await t.as.get(`${base(t)}/cost-centers/${cc.body.id}/report`);
    expect(report.status, report.text).toBe(200);
    expect(JSON.stringify(report.body)).toMatch(/1000/);
  });
});

describe("WQ1 attachments, document language, sent / viewed log (7.2g, 7.21, 7.25)", () => {
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  it("stores, lists, downloads and removes a file; another tenant gets 404", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Gulf Retail LLC",
      date: DATE,
      placeOfSupplyEmirate: "dubai",
      notes: "Delivered to the Jebel Ali warehouse",
      dueDate: "2026-12-10",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(inv.body).toMatchObject({ notes: "Delivered to the Jebel Ali warehouse" });
    const up = await t.as.post(`/api/invoices/${inv.body.id}/attachments`, {
      fileName: "purchase-order.png",
      data: PNG,
    });
    expect(up.status, up.text).toBe(201);
    expect(up.body).toMatchObject({ fileName: "purchase-order.png", contentType: "image/png" });
    const list = await t.as.get(`/api/invoices/${inv.body.id}/attachments`);
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([up.body.id]);
    const file = await t.as.get(`/api/invoices/${inv.body.id}/attachments/${up.body.id}`);
    expect(file.status).toBe(200);
    expect(await other.as.get(`/api/invoices/${inv.body.id}/attachments`)).toMatchObject({
      status: 404,
    });
    expect(
      (await other.as.delete(`/api/invoices/${inv.body.id}/attachments/${up.body.id}`)).status
    ).toBe(404);
    const del = await t.as.delete(`/api/invoices/${inv.body.id}/attachments/${up.body.id}`);
    expect(del.status, del.text).toBe(200);
    expect((await t.as.get(`/api/invoices/${inv.body.id}/attachments`)).body).toEqual([]);
  });

  it("a viewer cannot attach a file", async () => {
    const t = await h.createTenant({ role: "viewer" });
    const [inv] = await h.sql<{ id: string }>(
      `INSERT INTO invoices (company_id, number, customer_name, date, status)
       VALUES ($1, 'INV-V-1', 'X', now(), 'draft') RETURNING id`,
      [t.company.id]
    );
    const up = await t.as.post(`/api/invoices/${inv.id}/attachments`, {
      fileName: "a.png",
      data: PNG,
    });
    expect(up.status).toBe(403);
  });

  it("an Arabic document stays Arabic after issue; the log shows the queued email and the view", async () => {
    const t = await h.createTenant();
    const c = await contact(t, "Gulf Retail LLC", { nameAr: "الخليج للتجزئة" });
    const inv = await issued(t, { contactId: c.id, documentLanguage: "ar" });
    const [row] = await h.sql<{ document_language: string }>(
      `SELECT document_language FROM invoices WHERE id = $1`,
      [inv.id]
    );
    expect(row.document_language).toBe("ar");
    const { invoicePdfOptions } = await import("../../server/routes/invoices.routes");
    const [full] = await h.sql(`SELECT * FROM invoices WHERE id = $1`, [inv.id]);
    const opts = await invoicePdfOptions({
      ...full,
      id: full.id,
      companyId: full.company_id,
      contactId: full.contact_id,
      templateId: full.template_id,
      invoiceType: full.invoice_type,
      documentLanguage: full.document_language,
    });
    expect(opts.locale).toBe("ar");
    expect(opts.customer?.displayName).toBe("الخليج للتجزئة");
    // Language may still change after issue (it does not change the supply or the tax).
    const en = await t.as.put(`/api/invoices/${inv.id}`, { documentLanguage: "en" });
    expect(en.status, en.text).toBe(200);
    expect(en.body.documentLanguage).toBe("en");

    const send = await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, {
      to: "ap@gulfretail.example",
    });
    expect(send.status, send.text).toBe(202);
    expect(send.body.sent).toBe(false);
    const share = await t.as.post(`/api/invoices/${inv.id}/share`, {});
    expect(share.status, share.text).toBe(200);
    expect((await h.anon.get(`/api/public/invoices/${share.body.token}`)).status).toBe(200);
    // A refresh within the throttle window is one view.
    expect((await h.anon.get(`/api/public/invoices/${share.body.token}`)).status).toBe(200);
    // The public route records views in the background.
    await vi.waitFor(
      async () => {
        const log = await t.as.get(`/api/invoices/${inv.id}/activity`);
        expect(log.status, log.text).toBe(200);
        expect(log.body.map((e: { kind: string }) => e.kind).sort()).toEqual(["emailed", "viewed"]);
        const emailed = log.body.find((e: { kind: string }) => e.kind === "emailed");
        expect(emailed).toMatchObject({
          recipient: "ap@gulfretail.example",
          status: "blocked_no_provider",
          sent: false,
        });
      },
      { timeout: 5000 }
    );
    const stranger = await h.createSecondTenant();
    expect((await stranger.as.get(`/api/invoices/${inv.id}/activity`)).status).toBe(404);
  });

  it("records just one view when invoice share requests overlap", async (ctx) => {
    if (!h.concurrencySupported) return ctx.skip();
    const t = await h.createTenant();
    const { id } = await issued(t, { customerName: "Gulf Retail LLC" });
    const { recordInvoiceView, VIEW_THROTTLE_MS } =
      await import("../../server/services/invoice-activity.service");
    const invoice = { id, companyId: t.company.id };
    const now = new Date();

    const recorded = await Promise.all(
      Array.from({ length: 8 }, () => recordInvoiceView(invoice, now))
    );
    expect(recorded.filter(Boolean)).toHaveLength(1);
    expect(await recordInvoiceView(invoice, new Date(now.getTime() + VIEW_THROTTLE_MS))).toBe(true);
    const views = await h.sql(
      "SELECT id FROM invoice_events WHERE invoice_id = $1 AND kind = 'viewed'",
      [id]
    );
    expect(views).toHaveLength(2);
  });
});

describe("WQ1 quote by email (7.5)", () => {
  it("queues the email with the PDF through the outbox and keeps the quote a draft without a provider", async () => {
    const t = await h.createTenant();
    const c = await contact(t);
    const q = await t.as.post(`${base(t)}/quotes`, {
      contactId: c.id,
      customerName: "Gulf Retail LLC",
      date: DATE,
      lines: [{ description: "Fit-out", quantity: 1, unitPrice: 5000, vatRate: 0.05 }],
    });
    expect(q.status, q.text).toBeLessThan(300);
    const send = await t.as.post(`/api/quotes/${q.body.id}/send-email`, {
      to: "ap@gulfretail.example",
    });
    expect(send.status, send.text).toBe(202);
    expect(send.body).toMatchObject({
      sent: false,
      status: "blocked_no_provider",
      quoteStatus: "draft",
    });
    const rows = await h.sql<{ category: string; files: string; text_body: string }>(
      `SELECT o.category, o.text_body,
              (SELECT string_agg(filename, ',') FROM email_outbox_attachments a WHERE a.outbox_id = o.id) AS files
         FROM email_outbox o WHERE o.related_entity_id = $1`,
      [q.body.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("quote");
    expect(rows[0].files).toMatch(/^quote-.*\.pdf$/);
    expect(rows[0].text_body).toMatch(/\/portal\/[0-9a-f]{64}/);
    const other = await h.createSecondTenant();
    expect(
      (await other.as.post(`/api/quotes/${q.body.id}/send-email`, { to: "x@example.com" })).status
    ).toBe(404);
  });
});
