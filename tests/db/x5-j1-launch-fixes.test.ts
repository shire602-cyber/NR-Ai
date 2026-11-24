/**
 * X5: launch fixes from the J1 end-to-end journey (new UAE SME owner, zero to month-end).
 * Defect ids from scratchpad/council/e2e/J1.json: D1 bank default, D2 invoice currency / payment
 * FX, D3 soft-lock reason, D4 filing pulse, D5 bank vs GL, D6 AI inbox, D7 VAT preview,
 * L1 service revenue, L4 draft delete, PDF exports.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, ledgerTotals, postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function bankAccount(t: Tenant, nameEn = "Emirates NBD") {
  const r = await t.as.post(`${base(t)}/bank-accounts`, { nameEn, bankName: "Emirates NBD" });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; glAccountId: string; glAccount: { id: string; code: string } };
}

async function approvedBill(t: Tenant, amount = 1000) {
  const b = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Emirates Office Supplies",
    vendor_trn: TRN,
    bill_number: `EOS-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: "2026-11-10",
    due_date: "2026-12-10",
    line_items: [{ description: "Stationery", quantity: 1, unit_price: amount, vat_rate: 5 }],
  });
  expect(b.status, b.text).toBe(200);
  const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(a.status, a.text).toBe(200);
  return a.body as { id: string };
}

/** Credit lines of bill payment journals, by account code. */
async function billPaymentCredits(t: Tenant) {
  return h.sql<{ code: string; credit: string }>(
    `SELECT a.code, SUM(jl.credit)::text AS credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'bill_payment' AND je.status = 'posted'
        AND jl.credit > 0
      GROUP BY a.code ORDER BY a.code`,
    [t.company.id]
  );
}

async function issuedInvoice(t: Tenant, body: Record<string, unknown>) {
  const r = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Gulf Retail LLC",
    date: "2026-11-10",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    ...body,
  });
  expect(r.status, r.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${r.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBeLessThan(300);
  return r.body as { id: string; number: string };
}

async function postedRevenueCredits(t: Tenant, invoiceId: string) {
  return h.sql<{ code: string; credit: string }>(
    `SELECT a.code, SUM(jl.credit)::text AS credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'invoice' AND je.source_id = $2
        AND je.status = 'posted' AND a.type = 'income' AND jl.credit > 0
      GROUP BY a.code ORDER BY a.code`,
    [t.company.id, invoiceId]
  );
}

describe("[J1-D1] payments land on the real bank account", () => {
  it("a bill paid with no account chosen credits the bank account's GL, not 1020", async () => {
    const t = await h.createTenant({ name: "LaylaD1" });
    const bank = await bankAccount(t);
    expect(bank.glAccount.code).toBe("1021");
    const bill = await approvedBill(t);
    const pay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-11-12",
      amount: 400,
    });
    expect(pay.status, pay.text).toBeLessThan(300);
    expect(await billPaymentCredits(t)).toEqual([{ code: "1021", credit: "400.00" }]);
  });

  it("1020 becomes a header once a bank account exists; the kernel refuses postings to it", async () => {
    const t = await h.createTenant({ name: "LaylaHeader" });
    const bank = await bankAccount(t);
    const generic = await accountByCode(t, "1020");
    const child = await h.sql<{ parent_id: string }>(
      `SELECT parent_id FROM accounts WHERE id = $1`,
      [bank.glAccountId]
    );
    expect(child[0].parent_id).toBe(generic.id);

    const bill = await approvedBill(t);
    const explicit = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-11-12",
      amount: 100,
      payment_account_id: generic.id,
    });
    expect(explicit.status).toBe(422);
    expect(explicit.body.code).toBe("ACCOUNT_IS_HEADER");

    const journal = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-12",
      description: "to the header",
      status: "posted",
      lines: [
        { accountId: generic.id, debit: 10, credit: 0 },
        { accountId: (await accountByCode(t, "3010")).id, debit: 0, credit: 10 },
      ],
    });
    expect(journal.status).toBe(422);
    expect(journal.body.code).toBe("ACCOUNT_IS_HEADER");

    const inv = await issuedInvoice(t, {});
    const invPay = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
      amount: 100,
      date: "2026-11-12",
      paymentAccountId: generic.id,
    });
    expect(invPay.status).toBe(422);
    expect(invPay.body.code).toBe("ACCOUNT_IS_HEADER");
  });

  it("the repair finder lists a legacy 1020 payment and the reclass moves it to the bank GL", async () => {
    const t = await h.createTenant({ name: "LaylaRepair" });
    const bill = await approvedBill(t);
    const generic = await accountByCode(t, "1020");
    // Legacy: paid to 1020 before the managed bank account existed (1020 then keeps its lines,
    // so it is not adopted as a header and only the finder can spot the problem).
    const legacy = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-11-12",
      amount: 1050,
      payment_account_id: generic.id,
    });
    expect(legacy.status, legacy.text).toBeLessThan(300);
    const bank = await bankAccount(t);

    const { findMispostedPayments, repairMispostedPayments } =
      await import("../../server/services/payment-account-repair.service");
    const found = await findMispostedPayments(t.company.id);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "bill_payment",
      postedAccountCode: "1020",
      reason: "generic_bank_account",
      targetAccountId: bank.glAccountId,
      matched: false,
    });
    const outcomes = await repairMispostedPayments(found, { actorId: t.user.id });
    expect(outcomes).toEqual([expect.objectContaining({ status: "repaired" })]);
    expect(await findMispostedPayments(t.company.id)).toHaveLength(0);

    const net = await h.sql<{ code: string; net: string }>(
      `SELECT a.code, SUM(jl.debit - jl.credit)::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND a.code IN ('1020', '1021', '2010')
        GROUP BY a.code ORDER BY a.code`,
      [t.company.id]
    );
    expect(net).toEqual([
      { code: "1020", net: "0.00" },
      { code: "1021", net: "-1050.00" },
      { code: "2010", net: "0.00" },
    ]);
    const status = await h.sql<{ status: string }>(
      `SELECT status FROM vendor_bills WHERE id = $1`,
      [bill.id]
    );
    expect(status[0].status).toBe("paid");
    const totals = await ledgerTotals(t.company.id);
    expect(totals.debit).toBe(totals.credit);
  });
});

describe("[J1-D2] foreign-currency invoice from the invoice form", () => {
  it("a USD invoice at 3.6725 paid at 3.70 books the realised FX gain", async () => {
    const t = await h.createTenant({ name: "LaylaFx", companyColumns: { trn_vat_number: TRN } });
    const bank = await bankAccount(t);
    const inv = await issuedInvoice(t, {
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
    const pay = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
      amount: 1000,
      date: "2026-11-14",
      paymentAccountId: bank.glAccountId,
      exchangeRate: 3.7,
    });
    expect(pay.status, pay.text).toBe(201);
    const fx = await h.sql<{ code: string; credit: string; debit: string }>(
      `SELECT a.code, SUM(jl.credit)::text AS credit, SUM(jl.debit)::text AS debit
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND a.code IN ('1021', '1040', '4090')
          AND je.source <> 'invoice'
        GROUP BY a.code ORDER BY a.code`,
      [t.company.id]
    );
    expect(fx).toEqual([
      { code: "1021", credit: "0.00", debit: "3700.00" },
      { code: "1040", credit: "3672.50", debit: "0.00" },
      { code: "4090", credit: "27.50", debit: "0.00" },
    ]);
  });
});

describe("[J1-D3] soft-locked period: the refusal says whether a reason is accepted", () => {
  it("owner gets canOverride and can post with a URI-encoded Arabic reason", async () => {
    const t = await h.createTenant({ name: "LaylaLock" });
    const lock = await t.as.post(`${base(t)}/month-end/lock-period`, {
      periodEnd: "2026-10-31",
      overrideChecklist: true,
      lockType: "soft",
      reason: "October closed",
    });
    expect(lock.status, lock.text).toBe(200);
    const entry = {
      date: "2026-10-15",
      description: "late accrual",
      status: "posted",
      lines: [
        { accountId: (await accountByCode(t, "5030")).id, debit: 80, credit: 0 },
        { accountId: (await accountByCode(t, "2040")).id, debit: 0, credit: 80 },
      ],
    };
    const refused = await t.as.post(`${base(t)}/journal`, entry);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("PERIOD_SOFT_LOCKED");
    expect(refused.body.details).toMatchObject({ canOverride: true, lockedThrough: "2026-10-31" });
    expect(refused.body.message).not.toMatch(/X-Period-Lock-Reason|header/i);

    const ok = await t.as.post(`${base(t)}/journal`, entry, {
      headers: { "X-Period-Lock-Reason": encodeURIComponent("فاتورة مورد متأخرة") },
    });
    expect(ok.status, ok.text).toBeLessThan(300);
    const audit = await h.sql<{ details: string }>(
      `SELECT details FROM audit_logs WHERE action = 'period.soft_lock_override' AND user_id = $1`,
      [t.user.id]
    );
    expect(JSON.parse(audit[0].details).after.reason).toBe("فاتورة مورد متأخرة");
  });

  it("a member who may not override is told so (canOverride false)", async () => {
    const t = await h.createTenant({ name: "LaylaLock2", role: "employee" });
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_start, period_end, status, lock_type, lock_scope)
       VALUES ($1, '2026-10-01', '2026-10-31', 'locked', 'soft', 'through')`,
      [t.company.id]
    );
    const { assertPeriodNotLocked, withPeriodLockRequest } =
      await import("../../server/services/period-lock.service");
    const req = { header: () => undefined, user: { id: t.user.id } } as never;
    const err = await withPeriodLockRequest(req, () =>
      assertPeriodNotLocked(t.company.id, "2026-10-10")
    ).catch((e) => e);
    expect(err.code).toBe("PERIOD_SOFT_LOCKED");
    expect(err.details).toMatchObject({ canOverride: false });
  });
});

describe("[J1-D4] filing pulse for a brand-new company", () => {
  it("shows no overdue VAT or corporate tax return for periods before the books start", async () => {
    const t = await h.createTenant({
      name: "LaylaNew",
      companyColumns: { trn_vat_number: TRN, vat_filing_frequency: "Quarterly" },
    });
    const overview = await t.as.get(`${base(t)}/compliance/overview`);
    expect(overview.status, overview.text).toBe(200);
    expect(overview.body.vatStatus.filingStatus).not.toBe("overdue");
    expect(overview.body.corporateTaxStatus.status).not.toBe("overdue");
    const today = new Date().toISOString().slice(0, 10);
    if (overview.body.vatStatus.nextDue) {
      expect(overview.body.vatStatus.nextDue >= today).toBe(true);
    }
  });

  it("a back-dated period with books still shows its return as due", async () => {
    const t = await h.createTenant({
      name: "LaylaBack",
      companyColumns: {
        trn_vat_number: TRN,
        vat_filing_frequency: "Quarterly",
        created_at: "2026-11-17T08:00:00Z",
      },
    });
    await postJournalEntry(t, {
      date: "2026-02-10",
      lines: [
        { code: "1020", debit: 100 },
        { code: "3010", credit: 100 },
      ],
    });
    const cal = await t.as.get(`${base(t)}/compliance-calendar?from=2026-01-01&to=2027-12-31`);
    expect(cal.status, cal.text).toBe(200);
    const vat = (cal.body as Array<{ obligationType: string; periodEnd: string }>).filter(
      (r) => r.obligationType === "vat_return"
    );
    expect(vat.map((r) => r.periodEnd)).toContain("2026-03-31");
    expect(vat.map((r) => r.periodEnd)).not.toContain("2025-12-31");
  });
});

describe("[J1-D5] bank statement vs GL after full reconciliation", () => {
  it("same-day statement lines resolve to the chain-end balance, difference 0", async () => {
    const t = await h.createTenant({ name: "LaylaBank" });
    const bank = await bankAccount(t);
    await postJournalEntry(t, {
      date: "2026-11-01",
      lines: [
        { accountId: bank.glAccountId, debit: 100000 },
        { code: "3010", credit: 100000 },
      ],
    });
    await postJournalEntry(t, {
      date: "2026-11-17",
      lines: [
        { accountId: bank.glAccountId, debit: 5725 },
        { code: "4010", credit: 5725 },
      ],
    });
    const rows: Array<[string, number, number]> = [
      ["Fee", -105, 105725],
      ["Receipt A", 5250, 105250],
      ["Receipt B", 580, 105830],
    ];
    // All on one date with one created_at: the stored order says nothing about the chain.
    await h.sql(
      `INSERT INTO bank_transactions (company_id, bank_statement_account_id, bank_account_id,
              transaction_date, description, amount, balance, import_source, created_at)
       SELECT $1, $2, $3, '2026-11-17', d, a, b, 'csv', '2026-11-17T10:00:00Z'
         FROM unnest($4::text[], $5::numeric[], $6::numeric[]) AS x(d, a, b)`,
      [
        t.company.id,
        bank.id,
        bank.glAccountId,
        rows.map((r) => r[0]),
        rows.map((r) => r[1]),
        rows.map((r) => r[2]),
      ]
    );
    await h.sql(`UPDATE bank_accounts SET opening_balance = 100000 WHERE id = $1`, [bank.id]);
    const stats = await t.as.get(`${base(t)}/dashboard/stats`);
    expect(stats.status, stats.text).toBe(200);
    const acct = stats.body.bankVsGl.accounts.find(
      (a: { bankAccountId: string }) => a.bankAccountId === bank.id
    );
    expect(acct).toMatchObject({
      statementBalance: 105725,
      glBalance: 105725,
      difference: 0,
      statementDate: "2026-11-17",
    });
  });
});

describe("[J1-D6] AI inbox ignores reconciled bank lines", () => {
  it("a suggestion for a matched line is not pending and does not block month-end", async () => {
    const t = await h.createTenant({ name: "LaylaInbox" });
    const bank = await bankAccount(t);
    const [open, done] = await h.sql<{ id: string }>(
      `INSERT INTO bank_transactions (company_id, bank_statement_account_id, bank_account_id,
              transaction_date, description, amount, match_status, is_reconciled)
       VALUES ($1, $2, $3, '2026-11-05', 'Open line', -50, 'unmatched', false),
              ($1, $2, $3, '2026-11-06', 'Reconciled line', -70, 'matched', true)
       RETURNING id`,
      [t.company.id, bank.id, bank.glAccountId]
    );
    for (const tx of [open, done]) {
      await h.sql(
        `INSERT INTO ai_gl_queue (company_id, bank_transaction_id, description, amount,
                transaction_date, ai_confidence, ai_reason, few_shot_examples_used, status)
         VALUES ($1, $2, 'line', 50, '2026-11-05', 0, 'OpenAI not configured', 0, 'pending_review')`,
        [t.company.id, tx.id]
      );
    }
    const queue = await t.as.get(`${base(t)}/ai-gl/queue?status=pending_review`);
    expect(queue.status).toBe(200);
    expect(queue.body.map((q: { bank_transaction_id: string }) => q.bank_transaction_id)).toEqual([
      open.id,
    ]);
    const checklist = await t.as.get(`${base(t)}/month-end/checklist?period=2026-11`);
    const inbox = checklist.body.checklist.find((c: { id: number }) => c.id === 5);
    expect(inbox.details).toMatch(/^1 /);

    await h.sql(
      `UPDATE bank_transactions SET match_status = 'matched', is_reconciled = true WHERE id = $1`,
      [open.id]
    );
    const after = await t.as.get(`${base(t)}/month-end/checklist?period=2026-11`);
    expect(after.body.checklist.find((c: { id: number }) => c.id === 5).status).toBe("complete");
  });
});

describe("[J1-D7] VAT 201 for a period that has not ended", () => {
  it("generation explains the period is still open; the live preview computes it", async () => {
    const t = await h.createTenant({
      name: "LaylaVat",
      companyColumns: { trn_vat_number: TRN, vat_filing_frequency: "Quarterly", emirate: "dubai" },
    });
    const year = new Date().getUTCFullYear() + 1;
    const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-03-31`,
    });
    expect(gen.status).toBe(422);
    expect(gen.body.code).toBe("PERIOD_IN_FUTURE");
    expect(gen.body.details).toMatchObject({ previewAvailable: true, periodEnd: `${year}-03-31` });
    const preview = await t.as.get(`${base(t)}/vat/compute?from=${year}-01-01&to=${year}-03-31`);
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.boxes).toHaveProperty("box14PayableTax");
  });
});

describe("[J1-L1] service lines post to service revenue", () => {
  it("service products and free-text lines credit 4020, while goods credit 4010", async () => {
    const t = await h.createTenant({
      name: "LaylaSvc",
      companyColumns: { trn_vat_number: TRN, emirate: "dubai" },
    });
    const [svc] = await h.sql<{ id: string }>(
      `INSERT INTO products (company_id, name, unit_price, vat_rate, product_type, track_inventory)
       VALUES ($1, 'Consulting Services', 500, 0.05, 'service', false) RETURNING id`,
      [t.company.id]
    );
    const [goods] = await h.sql<{ id: string }>(
      `INSERT INTO products (company_id, name, unit_price, vat_rate, product_type, track_inventory)
       VALUES ($1, 'Printed brochure', 100, 0.05, 'inventory', false) RETURNING id`,
      [t.company.id]
    );
    const inv = await issuedInvoice(t, {
      lines: [
        { description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 5, productId: svc.id },
        { description: "Installation", quantity: 1, unitPrice: 250, vatRate: 5 },
        {
          description: "Printed brochure",
          quantity: 1,
          unitPrice: 100,
          vatRate: 5,
          productId: goods.id,
        },
      ],
    });
    expect(await postedRevenueCredits(t, inv.id)).toEqual([
      { code: "4010", credit: "100.00" },
      { code: "4020", credit: "1250.00" },
    ]);
    const credit = await t.as.post(`${base(t)}/invoices/${inv.id}/credit-note`, {});
    expect(credit.status, credit.text).toBeLessThan(300);
    const net = await h.sql<{ code: string; net: string }>(
      `SELECT a.code, SUM(jl.credit - jl.debit)::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND a.code IN ('4010', '4020')
        GROUP BY a.code ORDER BY a.code`,
      [t.company.id]
    );
    expect(net).toEqual([
      { code: "4010", net: "0.00" },
      { code: "4020", net: "0.00" },
    ]);
  });
});

describe("[J1-L4] removing a draft invoice keeps numbering gap-free", () => {
  it("the latest draft is deleted and its number reused; an earlier one is cancelled", async () => {
    const t = await h.createTenant({ name: "LaylaDraft" });
    const mk = async () => {
      const r = await t.as.post(`${base(t)}/invoices`, {
        customerName: "Draft Customer",
        date: "2026-11-10",
        lines: [{ description: "Item", quantity: 1, unitPrice: 100, vatRate: 5 }],
      });
      expect(r.status, r.text).toBe(200);
      return r.body as { id: string; number: string };
    };
    const first = await mk();
    const second = await mk();
    const del = await t.as.delete(`/api/invoices/${second.id}`);
    expect(del.status, del.text).toBe(200);
    expect(del.body.outcome).toBe("deleted");
    const third = await mk();
    expect(third.number).toBe(second.number);

    const cancel = await t.as.delete(`/api/invoices/${first.id}`);
    expect(cancel.status, cancel.text).toBe(200);
    expect(cancel.body.outcome).toBe("cancelled");
    const rows = await h.sql<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [
      first.id,
    ]);
    expect(rows[0].status).toBe("cancelled");

    const issued = await issuedInvoice(t, {});
    const refused = await t.as.delete(`/api/invoices/${issued.id}`);
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });
});

describe("[J1 exports] aging and general ledger as PDF", () => {
  it.each(["ar-aging", "ap-aging", "general-ledger"])("%s downloads as a PDF", async (kind) => {
    const t = await h.createTenant({ name: "LaylaPdf" });
    const r = await t.as.get(
      `${base(t)}/reports/statements/${kind}?format=pdf&from=2026-01-01&to=2026-11-17`
    );
    expect(r.status, r.text?.slice(0, 200)).toBe(200);
    expect(String(r.headers.get("content-type"))).toContain("application/pdf");
    expect(r.text.startsWith("%PDF")).toBe(true);
  });
});
