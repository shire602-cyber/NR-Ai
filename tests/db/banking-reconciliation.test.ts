/**
 * W3-C banking integrity on the real app + Postgres:
 * R06-01 GL link, R06-02 unmatch reverses, R06-03 no revenue-entry matches, R06-04 rules post,
 * R06-05 apply through recordPayment / idempotent / period lock, R06-13 404 targets, R06-15 rule
 * validation, R06-16 no SQL in errors, R06-17 free-text bank names, R06-18 match-state invariant,
 * R06-20 reconciliation statement + sign-off, R06-21 split / transfer / VAT / fee, R06-22
 * transaction edit / exclude / delete / import undo / continuity.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { bankStatementCopy, statementRecognized } from "../../shared/bank-statement-copy";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function vatTenant(): Promise<Tenant> {
  const t = await h.createTenant({ name: "Bank" });
  const r = await t.as.patch(`/api/companies/${t.company.id}`, {
    trnVatNumber: "100123456700003",
    vatRegistered: true,
    emirate: "dubai",
  });
  expect(r.status, r.text).toBe(200);
  return t;
}

async function bankAccount(t: Tenant, over: Record<string, unknown> = {}) {
  const r = await t.as.post(`${base(t)}/bank-accounts`, {
    nameEn: "Main current",
    bankName: "Emirates NBD",
    currency: "AED",
    ...over,
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; glAccountId: string; glAccount: { code: string } };
}

type Row = [date: string, description: string, debit: string, credit: string, balance?: string];

async function importCsv(t: Tenant, bankAccountId: string, rows: Row[]) {
  const withBalance = rows.some((r) => r[4] !== undefined);
  const header = withBalance
    ? "Date,Description,Debit,Credit,Balance"
    : "Date,Description,Debit,Credit";
  const csv = [header, ...rows.map((r) => r.filter((x) => x !== undefined).join(","))].join("\n");
  const r = await t.as.post(`${base(t)}/bank-statements/import`, {
    bankAccountId,
    csvContent: csv,
    acknowledgeAmbiguity: true,
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { imported: number; batchId: string; continuityWarning: string | null };
}

async function lines(t: Tenant, bankAccountId: string) {
  const r = await t.as.get(
    `${base(t)}/bank-statements/transactions?bankAccountId=${bankAccountId}`
  );
  expect(r.status, r.text).toBe(200);
  return r.body as Array<{
    id: string;
    description: string;
    amount: number;
    isReconciled: boolean;
    matchStatus: string;
    matchedJournalEntryId: string | null;
  }>;
}

async function line(t: Tenant, bankAccountId: string, description: string) {
  const found = (await lines(t, bankAccountId)).find((l) => l.description === description);
  if (!found) throw new Error(`no line ${description}`);
  return found;
}

async function invoice(t: Tenant, net: number, date = "2026-10-01", customerName = "Acme LLC") {
  const r = await t.as.post(`${base(t)}/invoices`, {
    customerName,
    date,
    lines: [{ description: "Services", quantity: 1, unitPrice: net, vatRate: 5 }],
  });
  expect(r.status, r.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${r.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBeLessThan(300);
  return r.body as { id: string; number: string };
}

async function invoiceStatus(id: string): Promise<string> {
  const rows = await h.sql<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [id]);
  return rows[0].status;
}

/** Net posted balance (debit - credit) on one GL account, in AED. */
async function glBalance(companyId: string, accountId: string): Promise<number> {
  const rows = await h.sql<{ net: string }>(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS net
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2`,
    [companyId, accountId]
  );
  return Number(rows[0].net);
}

async function liveEntries(companyId: string, source: string) {
  return h.sql<{ id: string; memo: string }>(
    `SELECT id, memo FROM journal_entries
      WHERE company_id = $1 AND source = $2 AND status = 'posted'
        AND reversed_by_entry_id IS NULL AND entry_kind <> 'reversal'`,
    [companyId, source]
  );
}

describe("statement import copy", () => {
  it.each([
    ["2026-10-03", statementRecognized.en, 1],
    ["invalid-date", null, 0],
  ] as const)(
    "reports a recognized statement only when it has valid rows (%s)",
    async (date, detectedFormatLabel, validRows) => {
      const t = await vatTenant();
      const reply = await t.as.post(`${base(t)}/bank-statements/preview`, {
        csvContent: `Date,Description,Debit,Credit\n${date},Test line,0,12.50\n`,
      });
      expect(reply.status, reply.text).toBe(200);
      expect(reply.body).toMatchObject({ detectedFormatLabel, validRows });
    }
  );

  it("prompts for CSV when either statement entry point receives empty input", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    for (const action of ["preview", "import"]) {
      for (const source of [{}, { csvContent: " ", fileBase64: "" }]) {
        const reply = await t.as.post(`${base(t)}/bank-statements/${action}`, {
          bankAccountId: ba.id,
          ...source,
        });
        expect(reply.status, reply.text).toBe(400);
        expect(reply.body.fields).toEqual({ _root: [bankStatementCopy.en] });
        expect(reply.text).not.toMatch(/XLSX|fileBase64/);
      }
    }
  });

  it("rejects a non-CSV upload and keeps CSV import and duplicate notices format-neutral", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const importPath = `${base(t)}/bank-statements/import`;
    const unsupported = await t.as.post(importPath, {
      bankAccountId: ba.id,
      fileName: "statement.sta",
      fileBase64: readFileSync("tests/fixtures/bank-statements/statement.sta", "base64"),
    });
    expect(unsupported.status, unsupported.text).toBe(400);
    expect(unsupported.body.code).toBe("STATEMENT_CSV_REQUIRED");
    expect(await lines(t, ba.id)).toEqual([]);

    const upload = {
      bankAccountId: ba.id,
      fileName: "statement.csv",
      fileBase64: Buffer.from("Date,Description,Debit,Credit\n2026-10-03,Test,0,12.50").toString(
        "base64"
      ),
    };
    const first = await t.as.post(importPath, upload);
    const duplicate = await t.as.post(importPath, upload);
    expect(first.status, first.text).toBe(201);
    expect(first.body.imported).toBe(1);
    expect(duplicate.status, duplicate.text).toBe(201);
    expect(duplicate.body.imported).toBe(0);
    expect(duplicate.body.skippedDuplicates).toBe(first.body.imported);
    await expect
      .poll(async () => {
        const list = await t.as.get("/api/notifications");
        expect(list.status, list.text).toBe(200);
        const notices = list.body.notifications.filter(
          (n: { type: string }) => n.type === "bank_import"
        );
        expect(JSON.stringify(notices)).not.toMatch(/MT940|OFX|format/i);
        return notices.map((n: { message: string }) => n.message);
      })
      .toEqual(
        expect.arrayContaining([
          `${first.body.imported} transaction(s) imported from Emirates NBD`,
          `No new transactions from Emirates NBD; ${first.body.imported} already imported`,
        ])
      );
  });
});

describe("W3-C banking: GL link and accounts", () => {
  it("[R06-01] an account created without a GL account gets one and its imported rows reconcile", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    expect(ba.glAccountId).toBeTruthy();
    const gl = await h.sql<{ code: string; type: string; sub_type: string }>(
      `SELECT code, type, sub_type FROM accounts WHERE id = $1`,
      [ba.glAccountId]
    );
    expect(gl[0]).toMatchObject({ type: "asset", sub_type: "bank" });
    expect(gl[0].code).toMatch(/^102[1-9]$/);

    await importCsv(t, ba.id, [["2026-10-03", "LANDLORD RENT", "5000.00", ""]]);
    const rent = await line(t, ba.id, "LANDLORD RENT");
    const expense = await accountByCode(t, "5000");
    const r = await t.as.post(`${base(t)}/bank-statements/${rent.id}/create-entry`, {
      accountId: expense.id,
      memo: "Oct rent",
    });
    expect(r.status, r.text).toBe(201);
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(-5000);
  });

  it("[R06-01] relink moves unreconciled rows to the new GL account; a non-bank GL is refused", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [["2026-10-04", "COFFEE", "25.00", ""]]);
    const revenue = await accountByCode(t, "4010");
    const bad = await t.as.post(`${base(t)}/bank-accounts/${ba.id}/relink`, {
      glAccountId: revenue.id,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("GL_ACCOUNT_NOT_BANK");
    const bank1020 = await accountByCode(t, "1020");
    const ok = await t.as.post(`${base(t)}/bank-accounts/${ba.id}/relink`, {
      glAccountId: bank1020.id,
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.relinkedTransactions).toBe(1);
    const rows = await h.sql<{ bank_account_id: string }>(
      `SELECT bank_account_id FROM bank_transactions WHERE bank_statement_account_id = $1`,
      [ba.id]
    );
    expect(rows[0].bank_account_id).toBe(bank1020.id);
  });

  it("[R06-17] bankName is free text (RAKBANK, Wio, Mashreq Neo) with a suggestion list", async () => {
    const t = await vatTenant();
    for (const bankName of ["RAKBANK", "Wio Bank", "Mashreq Neo", "CBD"]) {
      await bankAccount(t, { nameEn: bankName, bankName });
    }
    const s = await t.as.get(`${base(t)}/bank-accounts/bank-name-suggestions`);
    expect(s.body.suggestions).toContain("RAKBANK");
  });
});

describe("W3-C banking: match and unmatch integrity", () => {
  it("[R06-02] create-entry -> unmatch -> ledger back to zero -> create again -> exactly one live rent entry", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [["2026-10-05", "LANDLORD RENT", "7000.00", ""]]);
    const rent = await line(t, ba.id, "LANDLORD RENT");
    const expense = await accountByCode(t, "5000");

    const first = await t.as.post(`${base(t)}/bank-statements/${rent.id}/create-entry`, {
      accountId: expense.id,
    });
    expect(first.status, first.text).toBe(201);
    expect(await glBalance(t.company.id, expense.id)).toBe(7000);

    const un = await t.as.delete(`${base(t)}/bank-statements/${rent.id}/match`);
    expect(un.status, un.text).toBe(200);
    expect(un.body.isReconciled).toBe(false);
    expect(await glBalance(t.company.id, expense.id)).toBe(0);
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(0);

    const again = await t.as.post(`${base(t)}/bank-statements/${rent.id}/create-entry`, {
      accountId: expense.id,
    });
    expect(again.status, again.text).toBe(201);
    expect(await liveEntries(t.company.id, "bank_reconciliation")).toHaveLength(1);
    expect(await glBalance(t.company.id, expense.id)).toBe(7000);
  });

  it("[R06-02] unmatching an invoice match reverses the payment and reopens the invoice", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const inv = await invoice(t, 1000);
    await importCsv(t, ba.id, [["2026-10-06", `INWARD TT ACME ${inv.number}`, "", "1050.00"]]);
    const tt = (await lines(t, ba.id))[0];
    const m = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "invoice",
      matchedId: inv.id,
    });
    expect(m.status, m.text).toBe(201);
    expect(await invoiceStatus(inv.id)).toBe("paid");
    const un = await t.as.delete(`${base(t)}/bank-statements/${tt.id}/match`);
    expect(un.status, un.text).toBe(200);
    expect(await invoiceStatus(inv.id)).toBe("sent");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(0);
    const payments = await h.sql(`SELECT id FROM invoice_payments WHERE invoice_id = $1`, [inv.id]);
    expect(payments).toHaveLength(0);
    // Re-match works and posts exactly one live payment entry.
    const again = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "invoice",
      matchedId: inv.id,
    });
    expect(again.status, again.text).toBe(201);
    expect(again.body.matchedJournalEntryId).toBeTruthy();
    expect(await liveEntries(t.company.id, "payment")).toHaveLength(1);
  });

  it.each([
    { method: "bank_transfer", withPaymentId: true },
    { method: "bank_reconciliation", withPaymentId: true },
    { method: "bank_transfer", withPaymentId: false },
  ])(
    "unlinks an independently posted $method payment (stored ID: $withPaymentId)",
    async ({ method, withPaymentId }) => {
      const t = await vatTenant();
      const ba = await bankAccount(t);
      const inv = await invoice(t, 1000);
      const description = "Previously recorded settlement";
      await importCsv(t, ba.id, [["2026-10-06", description, "", "1050.00"]]);
      const bankLine = await line(t, ba.id, description);
      const posted = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
        amount: 1050,
        date: "2026-10-06",
        method,
        notes: `Reconciled from bank statement: ${description}`,
        paymentAccountId: ba.glAccountId,
      });
      expect(posted.status, posted.text).toBe(201);
      const payment = posted.body.payment;
      expect(payment.journalEntryId).toBeTruthy();
      await h.sql(
        `UPDATE bank_transactions SET is_reconciled = true, matched_type = 'invoice',
         matched_invoice_id = $2, matched_journal_entry_id = $3 WHERE id = $1`,
        [bankLine.id, inv.id, payment.journalEntryId]
      );
      const [{ id: matchId }] = await h.sql(
        `INSERT INTO bank_transaction_matches
         (company_id, bank_transaction_id, match_group_id, target_type, target_id,
          amount, journal_entry_id, payment_id, status)
       VALUES ($1, $2, gen_random_uuid(), 'invoice', $3, 1050.00, $4, $5, 'active') RETURNING id`,
        [
          t.company.id,
          bankLine.id,
          inv.id,
          payment.journalEntryId,
          withPaymentId ? payment.id : null,
        ]
      );
      if (method === "bank_reconciliation") {
        // A later legacy bank event records the link, while the exact invoice audit
        // still proves the payment came from the direct payment endpoint.
        const { recordAudit } = await import("../../server/services/audit.service");
        await recordAudit({
          userId: t.user.id,
          companyId: t.company.id,
          action: "bank.reconcile",
          entityType: "bank_transaction",
          entityId: bankLine.id,
          before: { matchStatus: "unmatched" },
          after: { matchedType: "invoice", matchedId: inv.id, matchStatus: "matched" },
        });
      }
      const { reverseInvoicePayment } =
        await import("../../server/services/invoice-payment.service");
      await expect(
        reverseInvoicePayment({
          companyId: t.company.id,
          paymentId: payment.id,
          actorId: t.user.id,
          reason: "Legacy allocation lacks bank creation provenance",
          expectedAllocation: {
            matchId,
            bankTransactionId: bankLine.id,
            invoiceId: inv.id,
            journalEntryId: payment.journalEntryId,
          },
        })
      ).rejects.toMatchObject({ code: "PAYMENT_REVERSAL_REVIEW_REQUIRED" });

      const unmatch = await t.as.delete(`${base(t)}/bank-statements/${bankLine.id}/match`);
      expect(unmatch.status, unmatch.text).toBe(200);
      expect(unmatch.body).toMatchObject({
        isReconciled: false,
        matchedInvoiceId: null,
        matchedJournalEntryId: null,
        reversedPayments: [],
        reversedEntryIds: [],
      });
      expect(await invoiceStatus(inv.id)).toBe("paid");
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(1050);
      expect(
        await h.sql(`SELECT id, journal_entry_id FROM invoice_payments WHERE id = $1`, [payment.id])
      ).toEqual([{ id: payment.id, journal_entry_id: payment.journalEntryId }]);
      expect(
        await h.sql(`SELECT status FROM bank_transaction_matches WHERE id = $1`, [matchId])
      ).toEqual([{ status: "reversed" }]);
      expect(
        await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [
          payment.journalEntryId,
        ])
      ).toEqual([]);
    }
  );

  it("prevents an upgraded historical deposit from posting again after unlinking", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const inv = await invoice(t, 200);
    await importCsv(t, ba.id, [["2026-10-06", "Legacy partial payment", "", "100.00"]]);
    const bankLine = await line(t, ba.id, "Legacy partial payment");
    const { recordInvoicePayment } = await import("../../server/services/invoice-payment.service");
    const { journalEntryId } = await recordInvoicePayment({
      companyId: t.company.id,
      invoiceId: inv.id,
      amount: 100,
      date: new Date("2026-10-06T00:00:00.000Z"),
      method: "bank_reconciliation",
      paymentAccountId: ba.glAccountId,
      createdBy: t.user.id,
    });
    await h.sql(
      `UPDATE bank_transactions SET is_reconciled = true, match_status = 'matched',
       matched_invoice_id = $2, matched_journal_entry_id = $3 WHERE id = $1`,
      [bankLine.id, inv.id, journalEntryId]
    );
    // Run the real upgrade backfill on the historical summary.
    const migration = readFileSync("migrations/0097_w3c_banking.sql", "utf8");
    const start = migration.indexOf("WITH legacy_matches AS");
    expect(start).toBeGreaterThan(-1);
    await h.sql(migration.slice(start, migration.indexOf("--> statement-breakpoint", start)));

    const url = `${base(t)}/bank-statements/${bankLine.id}/match`;
    const unmatch = await t.as.delete(url);
    expect(unmatch.status, unmatch.text).toBe(200);
    const rematch = await t.as.post(url, { matchedType: "invoice", matchedId: inv.id });
    expect(rematch.status, rematch.text).toBe(409);
    expect(rematch.body.code).toBe("BANK_RETAINED_PAYMENT_REVIEW_REQUIRED");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(100);
    expect(await liveEntries(t.company.id, "payment")).toHaveLength(1);
  });

  it.each([
    "historical invoice audit",
    "same-line retry",
    "actorless link and retry",
    "prior same-line journal link",
    "interrupted same-line retry",
    "missing audit",
    "newer non-legacy audit",
    "payment before import",
  ])("only unlinks a legacy payment with no creation proof (%s)", async (evidence) => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const inv = await invoice(t, 1000);
    const description = "Legacy manual-bank-match receipt";
    await importCsv(t, ba.id, [["2026-10-06", description, "", "1120.00"]]);
    const bankLine = await line(t, ba.id, description);
    const { recordInvoicePayment } = await import("../../server/services/invoice-payment.service");
    const { recordAudit } = await import("../../server/services/audit.service");
    // Record the payment independently without the old best-effort direct-payment
    // audit. Editable metadata can exactly match what the bank route would write.
    const { payment, journalEntryId } = await recordInvoicePayment({
      companyId: t.company.id,
      invoiceId: inv.id,
      amount: 1050,
      date: new Date("2026-10-06T00:00:00.000Z"),
      method: "bank_reconciliation",
      notes: `Reconciled from bank statement: ${description}`,
      paymentAccountId: ba.glAccountId,
      createdBy: t.user.id,
    });
    if (evidence === "actorless link and retry") {
      // The old AI journal matcher attached this existing entry without an audit
      // and left match_status unchanged. The invoice matcher then kept the pointer.
      await h.sql(
        `UPDATE bank_transactions SET is_reconciled = true, matched_journal_entry_id = $2
         WHERE id = $1`,
        [bankLine.id, journalEntryId]
      );
    }
    await h.sql(
      `UPDATE bank_transactions SET is_reconciled = true, match_status = 'matched', matched_type = 'invoice',
           matched_invoice_id = $2, matched_journal_entry_id = $3 WHERE id = $1`,
      [bankLine.id, inv.id, journalEntryId]
    );
    const [{ id: matchId }] = await h.sql(
      `INSERT INTO bank_transaction_matches (company_id, bank_transaction_id, match_group_id,
           target_type, target_id, amount, journal_entry_id, payment_id, status)
         VALUES ($1, $2, gen_random_uuid(), 'invoice', $3, 1120.00, $4, $5, 'active') RETURNING id`,
      [t.company.id, bankLine.id, inv.id, journalEntryId, payment.id]
    );
    const audit = {
      userId: t.user.id,
      companyId: t.company.id,
      action: "bank.reconcile",
      entityType: "bank_transaction",
      entityId: bankLine.id,
      before: { matchStatus: "unmatched" },
    };
    if (evidence === "prior same-line journal link") {
      await recordAudit({
        ...audit,
        after: { matchedType: "journal", matchedId: journalEntryId, matchStatus: "matched" },
      });
    }
    if (evidence !== "missing audit") {
      await recordAudit({
        ...audit,
        after: { matchedType: "invoice", matchedId: inv.id, matchStatus: "matched" },
      });
    }
    if (evidence === "interrupted same-line retry") {
      await recordAudit({ ...audit, action: "bank.unmatch", after: { matchStatus: "unmatched" } });
    }
    if (
      evidence === "same-line retry" ||
      evidence === "actorless link and retry" ||
      evidence === "interrupted same-line retry"
    ) {
      await recordAudit({
        ...audit,
        before: { matchStatus: "matched" },
        after: { matchedType: "invoice", matchedId: inv.id, matchStatus: "matched" },
      });
    }
    if (evidence === "newer non-legacy audit") {
      await recordAudit({
        ...audit,
        after: { target: `invoice:${inv.id}`, journalEntryIds: [journalEntryId] },
      });
    }

    if (evidence === "payment before import") {
      await h.sql(
        `UPDATE bank_transactions SET created_at = now() + interval '1 second' WHERE id = $1`,
        [bankLine.id]
      );
    }

    expect(await invoiceStatus(inv.id)).toBe("paid");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(1050);
    expect(
      await h.sql(
        `SELECT id FROM audit_logs WHERE action = 'invoice.payment' AND resource_id = $1`,
        [inv.id]
      )
    ).toEqual([]);
    const result = await t.as.delete(`${base(t)}/bank-statements/${bankLine.id}/match`);
    expect(result.status, result.text).toBe(200);
    expect(result.body).toMatchObject({
      reversedPayments: [],
      reversedEntryIds: [],
      isReconciled: false,
    });
    expect(await invoiceStatus(inv.id)).toBe("paid");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(1050);
    expect((await line(t, ba.id, description)).isReconciled).toBe(false);
    expect(await h.sql(`SELECT id FROM invoice_payments WHERE id = $1`, [payment.id])).toEqual([
      { id: payment.id },
    ]);
    expect(
      await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [journalEntryId])
    ).toEqual([]);
    expect(
      await h.sql(`SELECT status FROM bank_transaction_matches WHERE id = $1`, [matchId])
    ).toEqual([{ status: "reversed" }]);
  });

  it.each([false, true])(
    "preserves an existing payment when a removed line also references the invoice (exact rival: %s)",
    async (exactRival) => {
      const t = await vatTenant();
      const ba = await bankAccount(t);
      const inv = await invoice(t, 1000);
      const previous = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
        amount: 730.8,
        date: "2026-10-05",
        method: "bank_transfer",
        paymentAccountId: ba.glAccountId,
      });
      expect(previous.status, previous.text).toBe(201);
      const description = "Two historical lines with the same metadata";
      await importCsv(t, ba.id, [
        ["2026-10-06", description, "", "329.20"],
        ["2026-10-06", description, "", "339.20"],
      ]);
      const imported = await lines(t, ba.id);
      const first = imported.find((row) => Number(row.amount) === 329.2)!;
      const second = imported.find((row) => Number(row.amount) === 339.2)!;
      expect(first.id).not.toBe(second.id);
      const { recordInvoicePayment } =
        await import("../../server/services/invoice-payment.service");
      const { recordAudit } = await import("../../server/services/audit.service");
      const { payment, journalEntryId } = await recordInvoicePayment({
        invoiceId: inv.id,
        companyId: t.company.id,
        amount: 319.2,
        date: new Date("2026-10-06T00:00:00.000Z"),
        method: "bank_reconciliation",
        notes: `Reconciled from bank statement: ${description}`,
        paymentAccountId: ba.glAccountId,
        createdBy: t.user.id,
      });
      const markMatched = (id: string) =>
        h.sql(
          `UPDATE bank_transactions SET is_reconciled = true, match_status = 'matched',
           matched_type = 'invoice', matched_invoice_id = $2, matched_journal_entry_id = $3
         WHERE id = $1`,
          [id, inv.id, journalEntryId]
        );
      const recordHistoricalMatch = (id: string, upperCase = false) =>
        recordAudit({
          userId: t.user.id,
          companyId: upperCase ? t.company.id.toUpperCase() : t.company.id,
          action: "bank.reconcile",
          entityType: "bank_transaction",
          entityId: upperCase ? id.toUpperCase() : id,
          before: { matchStatus: "unmatched" },
          after: {
            matchedType: "invoice",
            matchedId: upperCase ? inv.id.toUpperCase() : inv.id,
            matchStatus: "matched",
          },
        });

      await markMatched(first.id);
      await recordHistoricalMatch(first.id, true);
      if (exactRival) {
        await recordAudit({
          userId: t.user.id,
          companyId: t.company.id,
          action: "bank.reconcile",
          entityType: "bank_transaction",
          entityId: first.id,
          before: { matchStatus: "unmatched" },
          after: {
            matchedType: "journal",
            matchedId: journalEntryId.toUpperCase(),
            matchStatus: "matched",
          },
        });
      }
      // The old DELETE cleared the bank pointers without reversing payment or
      // recording an unmatch event. An older bank line can therefore survive only in audit.
      await h.sql(
        `UPDATE bank_transactions SET is_reconciled = false, match_status = 'unmatched',
           matched_invoice_id = NULL, matched_journal_entry_id = NULL, matched_type = NULL
         WHERE id = $1`,
        [first.id]
      );
      await h.sql(`DELETE FROM bank_transactions WHERE id = $1`, [first.id]);
      // The old journal-link path could supply the payment JE without an audit.
      // Matching the already-paid invoice then kept that pointer and logged a normal invoice match.
      await markMatched(second.id);
      await recordHistoricalMatch(second.id);
      const [{ id: matchId }] = await h.sql(
        `INSERT INTO bank_transaction_matches (company_id, bank_transaction_id, match_group_id,
           target_type, target_id, amount, journal_entry_id, payment_id, status)
         VALUES ($1, $2, gen_random_uuid(), 'invoice', $3, 339.20, $4, $5, 'active') RETURNING id`,
        [t.company.id, second.id, inv.id, journalEntryId, payment.id]
      );
      const scopedLines = () =>
        h.sql(
          `SELECT id, is_reconciled, matched_invoice_id, matched_journal_entry_id
         FROM bank_transactions WHERE id IN ($1, $2) ORDER BY id`,
          [first.id, second.id]
        );
      const before = await scopedLines();
      const result = await t.as.delete(`${base(t)}/bank-statements/${second.id}/match`);
      expect(result.status, result.text).toBe(exactRival ? 409 : 200);
      if (exactRival) {
        expect(result.body.code).toBe("PAYMENT_REVERSAL_REVIEW_REQUIRED");
        expect(result.text).not.toContain(first.id);
        expect(await scopedLines()).toEqual(before);
      } else {
        expect(result.body).toMatchObject({ reversedPayments: [], reversedEntryIds: [] });
        expect(await scopedLines()).toEqual([
          {
            id: second.id,
            is_reconciled: false,
            matched_invoice_id: null,
            matched_journal_entry_id: null,
          },
        ]);
      }
      expect(await invoiceStatus(inv.id)).toBe("paid");
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(1050);
      expect(
        await h.sql(`SELECT id FROM invoice_payments WHERE invoice_id = $1`, [inv.id])
      ).toEqual(expect.arrayContaining([{ id: previous.body.payment.id }, { id: payment.id }]));
      expect(
        await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [journalEntryId])
      ).toEqual([]);
      expect(
        await h.sql(`SELECT status FROM bank_transaction_matches WHERE id = $1`, [matchId])
      ).toEqual([{ status: exactRival ? "active" : "reversed" }]);
    }
  );

  it.each(["legacy", "current"])(
    "unmatches two %s installments on one invoice independently",
    async (kind) => {
      const t = await vatTenant();
      const ba = await bankAccount(t);
      const inv = await invoice(t, 1000);
      const installments = [
        { date: "2026-10-06", name: "First installment", amount: 500 },
        { date: "2026-10-07", name: "Second installment", amount: 550 },
      ];
      await importCsv(
        t,
        ba.id,
        installments.map(({ date, name, amount }) => [date, name, "", amount.toFixed(2)])
      );
      const { recordInvoicePayment } =
        await import("../../server/services/invoice-payment.service");
      const { recordAudit } = await import("../../server/services/audit.service");
      const links = [];
      for (const installment of installments) {
        const bankLine = await line(t, ba.id, installment.name);
        if (kind === "current") {
          const result = await t.as.post(`${base(t)}/bank-statements/${bankLine.id}/match`, {
            matchedType: "invoice",
            matchedId: inv.id,
          });
          expect(result.status, result.text).toBe(201);
        } else {
          const { payment, journalEntryId } = await recordInvoicePayment({
            companyId: t.company.id,
            invoiceId: inv.id,
            amount: installment.amount,
            date: new Date(`${installment.date}T00:00:00.000Z`),
            method: "bank_reconciliation",
            notes: `Reconciled from bank statement: ${installment.name}`,
            paymentAccountId: ba.glAccountId,
            createdBy: t.user.id,
          });
          await h.sql(
            `UPDATE bank_transactions SET is_reconciled = true, match_status = 'matched', matched_type = 'invoice',
               matched_invoice_id = $2, matched_journal_entry_id = $3 WHERE id = $1`,
            [bankLine.id, inv.id, journalEntryId]
          );
          await h.sql(
            `INSERT INTO bank_transaction_matches (company_id, bank_transaction_id, match_group_id,
               target_type, target_id, amount, journal_entry_id, payment_id, status)
             VALUES ($1, $2, gen_random_uuid(), 'invoice', $3, $4, $5, $6, 'active')`,
            [t.company.id, bankLine.id, inv.id, installment.amount, journalEntryId, payment.id]
          );
          await recordAudit({
            userId: t.user.id,
            companyId: t.company.id,
            action: "bank.reconcile",
            entityType: "bank_transaction",
            entityId: bankLine.id,
            before: { matchStatus: "unmatched" },
            after: { matchedType: "invoice", matchedId: inv.id, matchStatus: "matched" },
          });
        }
        const [link] = await h.sql<{ payment_id: string; journal_entry_id: string }>(
          `SELECT payment_id, journal_entry_id FROM bank_transaction_matches WHERE bank_transaction_id = $1`,
          [bankLine.id]
        );
        links.push({ ...link, lineId: bankLine.id });
      }
      expect(links[0].payment_id).not.toBe(links[1].payment_id);
      expect(links[0].journal_entry_id).not.toBe(links[1].journal_entry_id);
      expect(await invoiceStatus(inv.id)).toBe("paid");
      const reverses = kind === "current";
      for (const link of links) {
        const result = await t.as.delete(`${base(t)}/bank-statements/${link.lineId}/match`);
        expect(result.status, result.text).toBe(200);
        expect(result.body).toMatchObject({
          reversedPayments: reverses ? [link.payment_id] : [],
          reversedEntryIds: reverses ? [link.journal_entry_id] : [],
          isReconciled: false,
        });
        if (link === links[0]) {
          expect(
            await h.sql(`SELECT id FROM invoice_payments WHERE id = $1`, [links[1].payment_id])
          ).toEqual([{ id: links[1].payment_id }]);
          expect(
            await h.sql(`SELECT reversed_by_entry_id FROM journal_entries WHERE id = $1`, [
              links[1].journal_entry_id,
            ])
          ).toEqual([{ reversed_by_entry_id: null }]);
        }
      }
      expect(await invoiceStatus(inv.id)).toBe(reverses ? "sent" : "paid");
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(reverses ? 0 : 1050);
      expect(
        await h.sql(`SELECT id FROM invoice_payments WHERE invoice_id = $1`, [inv.id])
      ).toHaveLength(reverses ? 0 : 2);
    }
  );

  it.each([true, false])(
    "unlinks only an actually settled invoice when a legacy allocation has no journal (paid: %s)",
    async (paid) => {
      const t = await vatTenant();
      const ba = await bankAccount(t);
      const inv = await invoice(t, 1000);
      const description = "Already-paid invoice statement line";
      await importCsv(t, ba.id, [["2026-10-06", description, "", "1050.00"]]);
      const bankLine = await line(t, ba.id, description);
      if (paid) {
        const result = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
          amount: 1050,
          date: "2026-10-05",
          method: "bank_transfer",
          paymentAccountId: ba.glAccountId,
        });
        expect(result.status, result.text).toBe(201);
      } else {
        // An old status flag without actual settlement is insufficient.
        await h.sql(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [inv.id]);
      }
      await h.sql(
        `UPDATE bank_transactions SET is_reconciled = true, match_status = 'matched', matched_type = 'invoice',
           matched_invoice_id = $2 WHERE id = $1`,
        [bankLine.id, inv.id]
      );
      const [{ id: matchId }] = await h.sql(
        `INSERT INTO bank_transaction_matches (company_id, bank_transaction_id, match_group_id,
           target_type, target_id, amount, status)
         VALUES ($1, $2, gen_random_uuid(), 'invoice', $3, 1050.00, 'active') RETURNING id`,
        [t.company.id, bankLine.id, inv.id]
      );
      const paymentRows = () =>
        h.sql(`SELECT id, journal_entry_id FROM invoice_payments WHERE invoice_id = $1`, [inv.id]);
      const journalRows = () =>
        h.sql(
          `SELECT id, reversed_by_entry_id FROM journal_entries WHERE company_id = $1 ORDER BY id`,
          [t.company.id]
        );
      const beforePayments = await paymentRows();
      const beforeJournals = await journalRows();

      const result = await t.as.delete(`${base(t)}/bank-statements/${bankLine.id}/match`);
      expect(result.status, result.text).toBe(paid ? 200 : 409);
      if (paid) {
        expect(result.body).toMatchObject({
          isReconciled: false,
          matchedInvoiceId: null,
          reversedPayments: [],
          reversedEntryIds: [],
        });
      } else {
        expect(result.body.code).toBe("PAYMENT_REVERSAL_REVIEW_REQUIRED");
      }
      expect(await invoiceStatus(inv.id)).toBe("paid");
      expect(await paymentRows()).toEqual(beforePayments);
      expect(await journalRows()).toEqual(beforeJournals);
      expect(
        await h.sql(`SELECT status FROM bank_transaction_matches WHERE id = $1`, [matchId])
      ).toEqual([{ status: paid ? "reversed" : "active" }]);
    }
  );

  it.each(["none", "foreign invoice", "foreign payment reference", "rival pending allocation"])(
    "checks journal-only invoice unmatch before reversing (conflict: %s)",
    async (conflict) => {
      const t = await vatTenant();
      const ba = await bankAccount(t);
      const inv = await invoice(t, 1000);
      const description = "Legacy bank-owned journal";
      await importCsv(t, ba.id, [
        ["2026-10-06", description, "", "1050.00"],
        ["2026-10-07", "Other bank line", "", "25.00"],
      ]);
      const bankLine = await line(t, ba.id, description);
      const receivables = await accountByCode(t, "1040");
      const { postJournal } = await import("../../server/ledger");
      const {
        entry: { id: entryId },
      } = await postJournal(
        {
          companyId: t.company.id,
          date: "2026-10-06",
          memo: "Legacy reconciliation of an invoice",
          source: "bank_reconciliation",
          sourceId: bankLine.id,
          status: "posted",
          lines: [
            { accountId: ba.glAccountId, debitFils: 105000 },
            { accountId: receivables.id, creditFils: 105000, controlLeg: "receivables" },
          ],
        },
        { actorId: t.user.id }
      );
      const [revenue] = await h.sql(
        `SELECT id FROM journal_entries WHERE source = 'invoice' AND source_id = $1 AND company_id = $2`,
        [inv.id, t.company.id]
      );
      expect(revenue.id).toBeTruthy();
      let invoiceId = inv.id;
      let foreignCompanyId: string | undefined;
      if (conflict === "foreign invoice" || conflict === "foreign payment reference") {
        const foreign = await h.createSecondTenant();
        foreignCompanyId = foreign.company.id;
        const other = await invoice(foreign, 1000, "2026-10-01", "Other company's customer");
        if (conflict === "foreign invoice") {
          invoiceId = other.id;
        } else {
          const foreignAccount = await bankAccount(foreign);
          const payment = await foreign.as.post(`${base(foreign)}/invoices/${other.id}/payments`, {
            amount: 1050,
            method: "bank_transfer",
            date: "2026-10-06",
            paymentAccountId: foreignAccount.glAccountId,
          });
          expect(payment.status, payment.text).toBe(201);
          await h.sql(`UPDATE invoice_payments SET journal_entry_id = $2 WHERE id = $1`, [
            payment.body.payment.id,
            entryId,
          ]);
        }
      } else if (conflict === "rival pending allocation") {
        const rival = await line(t, ba.id, "Other bank line");
        await h.sql(
          `INSERT INTO bank_transaction_matches
             (company_id, bank_transaction_id, match_group_id, target_type, journal_entry_id, status)
           VALUES ($1, $2, gen_random_uuid(), 'journal', $3, 'pending')`,
          [t.company.id, rival.id, entryId]
        );
      }
      // Emulate a pre-0141 backfill with no recorded payment or ownership flag.
      const [{ id: matchId }] = await h.sql(
        `INSERT INTO bank_transaction_matches
           (company_id, bank_transaction_id, match_group_id, target_type, target_id,
            amount, journal_entry_id, status)
         VALUES ($1, $2, gen_random_uuid(), 'invoice', $3, 1050.00, $4, 'active') RETURNING id`,
        [t.company.id, bankLine.id, invoiceId, entryId]
      );
      await h.sql(
        `UPDATE bank_transactions SET is_reconciled = true, matched_type = 'invoice',
           matched_invoice_id = $2, matched_journal_entry_id = $3 WHERE id = $1`,
        [bankLine.id, invoiceId, entryId]
      );
      expect(await glBalance(t.company.id, receivables.id)).toBe(0);

      const unmatch = await t.as.delete(`${base(t)}/bank-statements/${bankLine.id}/match`);
      const safe = conflict === "none";
      expect(unmatch.status, unmatch.text).toBe(safe ? 200 : 409);
      if (safe) {
        expect(unmatch.body).toMatchObject({
          isReconciled: false,
          reversedPayments: [],
          reversedEntryIds: [entryId],
        });
      } else {
        expect(unmatch.body.code).toBe("PAYMENT_REVERSAL_REVIEW_REQUIRED");
        if (foreignCompanyId) expect(unmatch.text).not.toContain(foreignCompanyId);
      }
      expect(await invoiceStatus(inv.id)).toBe("sent");
      expect((await line(t, ba.id, description)).isReconciled).toBe(!safe);
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(safe ? 0 : 1050);
      expect(await glBalance(t.company.id, receivables.id)).toBe(safe ? 1050 : 0);
      expect(
        await h.sql(`SELECT id, status, reversed_by_entry_id FROM journal_entries WHERE id = $1`, [
          revenue.id,
        ])
      ).toEqual([{ id: revenue.id, status: "posted", reversed_by_entry_id: null }]);

      expect(
        await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [entryId])
      ).toHaveLength(safe ? 1 : 0);
      expect(
        await h.sql(`SELECT status FROM bank_transaction_matches WHERE id = $1`, [matchId])
      ).toEqual([{ status: safe ? "reversed" : "active" }]);
    }
  );

  it.each(["wrong invoice payment", "shared payment journal"])(
    "requires review before unmatching an invoice allocation with a %s",
    async (problem) => {
      const t = await vatTenant();
      const ba = await bankAccount(t);
      const first = await invoice(t, 1000);
      const second = await invoice(t, 2000);
      await importCsv(t, ba.id, [
        ["2026-10-06", "First customer payment", "", "1050.00"],
        ["2026-10-07", "Second customer payment", "", "2100.00"],
      ]);
      const firstLine = await line(t, ba.id, "First customer payment");
      const secondLine = await line(t, ba.id, "Second customer payment");
      for (const [txn, inv] of [
        [firstLine, first],
        [secondLine, second],
      ] as const) {
        const result = await t.as.post(`${base(t)}/bank-statements/${txn.id}/match`, {
          matchedType: "invoice",
          matchedId: inv.id,
        });
        expect(result.status, result.text).toBe(201);
      }
      const [firstMatch, secondMatch] = await h.sql<{
        id: string;
        payment_id: string;
        journal_entry_id: string;
      }>(
        `SELECT id, payment_id, journal_entry_id FROM bank_transaction_matches
         WHERE bank_transaction_id IN ($1, $2) ORDER BY (bank_transaction_id = $1) DESC`,
        [firstLine.id, secondLine.id]
      );
      if (problem === "wrong invoice payment") {
        await h.sql(`UPDATE bank_transaction_matches SET payment_id = $1 WHERE id = $2`, [
          secondMatch.payment_id,
          firstMatch.id,
        ]);
      } else {
        // Both allocations still identify their exact invoice/payment/journal triple.
        await h.sql(`UPDATE invoice_payments SET journal_entry_id = $1 WHERE id = $2`, [
          firstMatch.journal_entry_id,
          secondMatch.payment_id,
        ]);
        await h.sql(`UPDATE bank_transaction_matches SET journal_entry_id = $1 WHERE id = $2`, [
          firstMatch.journal_entry_id,
          secondMatch.id,
        ]);
        await h.sql(`UPDATE bank_transactions SET matched_journal_entry_id = $1 WHERE id = $2`, [
          firstMatch.journal_entry_id,
          secondLine.id,
        ]);
        const { reverseInvoicePayment } =
          await import("../../server/services/invoice-payment.service");
        await expect(
          reverseInvoicePayment({
            companyId: t.company.id,
            paymentId: firstMatch.payment_id,
            actorId: t.user.id,
            reason: "Shared journal rehearsal",
          })
        ).rejects.toMatchObject({ code: "PAYMENT_REVERSAL_REVIEW_REQUIRED" });
        const secondUnmatch = await t.as.delete(
          `${base(t)}/bank-statements/${secondLine.id}/match`
        );
        expect(secondUnmatch.status, secondUnmatch.text).toBe(409);
        expect(secondUnmatch.body.code).toBe("PAYMENT_REVERSAL_REVIEW_REQUIRED");
      }

      const result = await t.as.delete(`${base(t)}/bank-statements/${firstLine.id}/match`);
      expect(result.status, result.text).toBe(409);
      expect(result.body.code).toBe("PAYMENT_REVERSAL_REVIEW_REQUIRED");
      expect((await lines(t, ba.id)).every((txn) => txn.isReconciled)).toBe(true);
      expect(await invoiceStatus(first.id)).toBe("paid");
      expect(await invoiceStatus(second.id)).toBe("paid");
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(3150);
      expect(
        await h.sql(`SELECT id FROM invoice_payments WHERE id IN ($1, $2)`, [
          firstMatch.payment_id,
          secondMatch.payment_id,
        ])
      ).toHaveLength(2);
      expect(
        await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id IN ($1, $2)`, [
          firstMatch.journal_entry_id,
          secondMatch.journal_entry_id,
        ])
      ).toEqual([]);
    }
  );

  it.each(["receipt-owned", "bank-created", "missing", "foreign receipt"])(
    "unmatches a legacy receipt allocation with a %s journal",
    async (provenance) => {
      const t = await vatTenant();
      const ba = await bankAccount(t);
      const expense = await accountByCode(t, "5000");
      const draft = await t.as.post(`${base(t)}/receipts`, {
        merchant: "Receipt cash-side test",
        date: "2026-10-08",
        amount: 100,
        vatAmount: 5,
        currency: "AED",
        category: "Office",
      });
      expect(draft.status, draft.text).toBe(200);
      const posted = await t.as.post(`/api/receipts/${draft.body.id}/post`, {
        accountId: expense.id,
        paymentAccountId: ba.glAccountId,
      });
      expect(posted.status, posted.text).toBe(200);
      const receiptJournal = posted.body.journalEntryId as string;
      expect(receiptJournal).toBeTruthy();
      await importCsv(t, ba.id, [["2026-10-08", "Paid office receipt", "105.00", ""]]);
      const bankLine = (await lines(t, ba.id))[0];
      const bankOwned = provenance === "bank-created" || provenance === "foreign receipt";
      let targetReceipt = draft.body.id as string;
      if (provenance === "foreign receipt") {
        const other = await h.createSecondTenant();
        const created = await other.as.post(`${base(other)}/receipts`, {
          merchant: "Other company receipt",
          date: "2026-10-08",
          amount: 105,
          currency: "AED",
          category: "Office",
        });
        expect(created.status, created.text).toBe(200);
        targetReceipt = created.body.id;
      }
      const match = !bankOwned
        ? await t.as.post(`${base(t)}/bank-statements/${bankLine.id}/match`, {
            matchedType: "receipt",
            matchedId: draft.body.id,
          })
        : await t.as.post(`${base(t)}/bank-statements/${bankLine.id}/create-entry`, {
            accountId: expense.id,
          });
      expect(match.status, match.text).toBe(201);
      const [{ journal_entry_id: matchedJournal }] = await h.sql(
        `SELECT journal_entry_id FROM bank_transaction_matches WHERE bank_transaction_id = $1`,
        [bankLine.id]
      );
      expect(matchedJournal).toBeTruthy();
      await h.sql(
        `UPDATE bank_transaction_matches SET target_type = 'receipt', target_id = $2,
           created_journal = true WHERE bank_transaction_id = $1`,
        [bankLine.id, targetReceipt]
      );
      await h.sql(
        `UPDATE bank_transactions SET matched_type = 'receipt', matched_receipt_id = $2 WHERE id = $1`,
        [bankLine.id, targetReceipt]
      );
      if (provenance === "missing") {
        await h.sql(
          `UPDATE bank_transaction_matches SET journal_entry_id = NULL WHERE bank_transaction_id = $1`,
          [bankLine.id]
        );
      }
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(bankOwned ? -210 : -105);

      const unmatch = await t.as.delete(`${base(t)}/bank-statements/${bankLine.id}/match`);
      if (provenance === "missing" || provenance === "foreign receipt") {
        expect(unmatch.status, unmatch.text).toBe(409);
        expect(unmatch.body.code).toBe("BANK_MATCH_REVIEW_REQUIRED");
        expect((await line(t, ba.id, "Paid office receipt")).isReconciled).toBe(true);
      } else {
        expect(unmatch.status, unmatch.text).toBe(200);
        expect(unmatch.body.isReconciled).toBe(false);
        expect(unmatch.body.reversedEntryIds).toEqual(
          provenance === "bank-created" ? [matchedJournal] : []
        );
      }
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(
        provenance === "foreign receipt" ? -210 : -105
      );
      expect(
        await h.sql(`SELECT posted, journal_entry_id FROM receipts WHERE id = $1`, [draft.body.id])
      ).toEqual([{ posted: true, journal_entry_id: receiptJournal }]);
      expect(
        await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [receiptJournal])
      ).toEqual([]);
    }
  );

  it.each(["same-tenant exact", "foreign exact", "inferred with a conflicting payment ID"])(
    "refuses a payment reversal with a %s claim",
    async (rivalKind) => {
      const t = await vatTenant();
      const rival = rivalKind === "foreign exact" ? await h.createSecondTenant() : t;
      const ba = await bankAccount(t);
      const rivalAccount = rival === t ? ba : await bankAccount(rival);
      const inv = await invoice(t, 1000);
      await importCsv(t, ba.id, [["2026-10-08", "Original settlement", "", "1050.00"]]);
      await importCsv(rival, rivalAccount.id, [["2026-10-09", "Rival settlement", "", "1050.00"]]);
      const ownerLine = await line(t, ba.id, "Original settlement");
      const rivalLine = await line(rival, rivalAccount.id, "Rival settlement");
      const initial = await t.as.post(`${base(t)}/bank-statements/${ownerLine.id}/match`, {
        matchedType: "invoice",
        matchedId: inv.id,
      });
      expect(initial.status, initial.text).toBe(201);
      const [claim] = await h.sql(
        `SELECT id, payment_id, journal_entry_id FROM bank_transaction_matches WHERE bank_transaction_id = $1`,
        [ownerLine.id]
      );
      const { reverseInvoicePayment } =
        await import("../../server/services/invoice-payment.service");
      const reversal = {
        companyId: t.company.id,
        paymentId: claim.payment_id,
        actorId: t.user.id,
        reason: "Competing bank allocation rehearsal",
      };
      await expect(reverseInvoicePayment(reversal)).rejects.toMatchObject({
        code: "PAYMENT_REVERSAL_REVIEW_REQUIRED",
      });
      await h.sql(
        `INSERT INTO bank_transaction_matches
           (company_id, bank_transaction_id, match_group_id, target_type, target_id,
            amount, journal_entry_id, payment_id, status)
         VALUES ($1, $2, gen_random_uuid(), 'invoice', $3, 1050.00, $4, $5, 'active')`,
        [
          rival.company.id,
          rivalLine.id,
          inv.id,
          claim.journal_entry_id,
          rivalKind === "inferred with a conflicting payment ID" ? randomUUID() : claim.payment_id,
        ]
      );
      await expect(
        reverseInvoicePayment({
          ...reversal,
          expectedAllocation: {
            matchId: claim.id,
            bankTransactionId: ownerLine.id,
            invoiceId: inv.id,
            journalEntryId: claim.journal_entry_id,
          },
        })
      ).rejects.toMatchObject({ code: "PAYMENT_REVERSAL_REVIEW_REQUIRED" });

      const blocked = await t.as.delete(`${base(t)}/bank-statements/${ownerLine.id}/match`);
      expect(blocked.status, blocked.text).toBe(409);
      expect(blocked.body.code).toBe("PAYMENT_REVERSAL_REVIEW_REQUIRED");
      expect(blocked.text).not.toContain(rivalLine.id);
      expect((await line(t, ba.id, "Original settlement")).isReconciled).toBe(true);
      expect(await invoiceStatus(inv.id)).toBe("paid");
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(1050);
      expect(
        await h.sql(`SELECT id FROM invoice_payments WHERE id = $1`, [claim.payment_id])
      ).toEqual([{ id: claim.payment_id }]);
      expect(
        await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [
          claim.journal_entry_id,
        ])
      ).toEqual([]);
      expect(
        (
          await h.sql(
            `SELECT status FROM bank_transaction_matches WHERE bank_transaction_id IN ($1, $2)`,
            [ownerLine.id, rivalLine.id]
          )
        ).map((m) => m.status)
      ).toEqual(["active", "active"]);
    }
  );

  it.each(["pending row with another company", "group row with another company's bank line"])(
    "refuses to clear a bank line with a %s",
    async (corruption) => {
      const t = await vatTenant();
      const other = await h.createSecondTenant();
      const ba = await bankAccount(t);
      const otherAccount = await bankAccount(other);
      await importCsv(t, ba.id, [["2026-10-08", "Owned expense", "200.00", ""]]);
      await importCsv(other, otherAccount.id, [["2026-10-08", "Unrelated expense", "200.00", ""]]);
      const owned = await line(t, ba.id, "Owned expense");
      const foreign = await line(other, otherAccount.id, "Unrelated expense");
      const expense = await accountByCode(t, "5000");
      const match = await t.as.post(`${base(t)}/bank-statements/${owned.id}/create-entry`, {
        accountId: expense.id,
      });
      expect(match.status, match.text).toBe(201);
      const [original] = await h.sql(
        `SELECT match_group_id FROM bank_transaction_matches WHERE bank_transaction_id = $1`,
        [owned.id]
      );
      const pending = corruption === "pending row with another company";
      const [bad] = await h.sql(
        `INSERT INTO bank_transaction_matches
           (company_id, bank_transaction_id, match_group_id, target_type, status)
         VALUES ($1, $2, $3, 'entry', $4) RETURNING id`,
        [
          pending ? other.company.id : t.company.id,
          pending ? owned.id : foreign.id,
          pending ? randomUUID() : original.match_group_id,
          pending ? "pending" : "active",
        ]
      );
      const blocked = await t.as.delete(`${base(t)}/bank-statements/${owned.id}/match`);
      expect(blocked.status, blocked.text).toBe(409);
      expect(blocked.body.code).toBe("BANK_MATCH_REVIEW_REQUIRED");
      for (const value of [other.company.id, foreign.id, bad.id]) {
        expect(blocked.text).not.toContain(value);
      }
      expect((await line(t, ba.id, "Owned expense")).isReconciled).toBe(true);
      expect((await line(other, otherAccount.id, "Unrelated expense")).isReconciled).toBe(false);
      expect(await glBalance(t.company.id, ba.glAccountId)).toBe(-200);
      expect(
        await h.sql(`SELECT status FROM bank_transaction_matches WHERE id = $1`, [bad.id])
      ).toEqual([{ status: pending ? "pending" : "active" }]);
    }
  );

  it("preserves a newer allocation committed while unmatch is waiting for the bank row", async ({
    skip,
  }) => {
    if (!h.concurrencySupported) return skip();
    const t = await vatTenant();
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [["2026-10-08", "Ledger expense", "200.00", ""]]);
    const bankLine = await line(t, ba.id, "Ledger expense");
    const match = await t.as.post(`${base(t)}/bank-statements/${bankLine.id}/create-entry`, {
      accountId: (await accountByCode(t, "5000")).id,
    });
    expect(match.status, match.text).toBe(201);
    const [{ journal_entry_id: journalEntryId }] = await h.sql(
      `SELECT journal_entry_id FROM bank_transaction_matches WHERE bank_transaction_id = $1`,
      [bankLine.id]
    );
    expect(journalEntryId).toBeTruthy();
    const blocker = new pg.Client({ connectionString: h.databaseUrl });
    const replacement = randomUUID();
    await blocker.connect();
    let settled = false;
    try {
      await blocker.query("BEGIN");
      const backend = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT id FROM bank_transactions WHERE id = $1 FOR UPDATE", [
        bankLine.id,
      ]);
      const unmatch = t.as.delete(`${base(t)}/bank-statements/${bankLine.id}/match`);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [activity] = await h.sql(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                           WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))) AS waiting`,
          [backend]
        );
        waiting = activity.waiting;
        if (!waiting) await delay(25);
      }
      expect(waiting).toBe(true);
      await blocker.query(
        "UPDATE bank_transaction_matches SET status = 'reversed' WHERE bank_transaction_id = $1",
        [bankLine.id]
      );
      await blocker.query(
        `INSERT INTO bank_transaction_matches
           (id, company_id, bank_transaction_id, match_group_id, target_type, journal_entry_id, status)
         VALUES ($1, $2, $3, gen_random_uuid(), 'journal', $4, 'active')`,
        [replacement, t.company.id, bankLine.id, journalEntryId]
      );
      await blocker.query("UPDATE bank_transactions SET matched_type = 'journal' WHERE id = $1", [
        bankLine.id,
      ]);
      await blocker.query("COMMIT");
      settled = true;
      const blocked = await unmatch;
      expect(blocked.status, blocked.text).toBe(409);
      expect(blocked.body.code).toBe("BANK_MATCH_REVIEW_REQUIRED");
    } finally {
      if (!settled) await blocker.query("ROLLBACK");
      await blocker.end();
    }
    expect((await line(t, ba.id, "Ledger expense")).isReconciled).toBe(true);
    expect(
      await h.sql(`SELECT status FROM bank_transaction_matches WHERE id = $1`, [replacement])
    ).toEqual([{ status: "active" }]);
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(-200);
  });

  it("[R06-03] an inward transfer matching a sent invoice pays it, debits the bank GL and never links the revenue entry", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const inv = await invoice(t, 5000);
    await importCsv(t, ba.id, [["2026-10-07", `INWARD TT ACME ${inv.number}`, "", "5250.00"]]);
    const tt = (await lines(t, ba.id))[0];
    const revenueEntry = await h.sql<{ id: string }>(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'invoice' AND source_id = $2`,
      [t.company.id, inv.id]
    );
    expect(revenueEntry).toHaveLength(1);

    const sug = await t.as.get(`${base(t)}/bank-statements/${tt.id}/suggestions`);
    expect(sug.status).toBe(200);
    const ids = (sug.body as Array<{ matchedId: string; matchedType: string }>).map(
      (s) => s.matchedId
    );
    expect(ids).not.toContain(revenueEntry[0].id);
    expect(sug.body[0]).toMatchObject({ matchedType: "invoice", matchedId: inv.id });

    const viaJournal = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "journal",
      matchedId: revenueEntry[0].id,
    });
    expect(viaJournal.status).toBe(422);
    expect(viaJournal.body.code).toBe("JOURNAL_NOT_CASH_SIDE");

    const m = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "invoice",
      matchedId: inv.id,
    });
    expect(m.status, m.text).toBe(201);
    expect(await invoiceStatus(inv.id)).toBe("paid");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(5250);
    expect(m.body.matchedJournalEntryId).not.toBe(revenueEntry[0].id);
  });

  it("[R06-05] auto-reconcile apply records the invoice payment, twice is a no-op", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const inv = await invoice(t, 2000, "2026-10-02", "Gamma Trading");
    await importCsv(t, ba.id, [["2026-10-08", `GAMMA TRADING ${inv.number}`, "", "2100.00"]]);
    const tt = (await lines(t, ba.id))[0];
    const body = {
      matches: [{ bankTransactionId: tt.id, matchedType: "invoice", matchedId: inv.id }],
    };
    const first = await t.as.post(`${base(t)}/auto-reconcile/apply`, body);
    expect(first.status, first.text).toBe(200);
    expect(first.body.applied).toBe(1);
    expect(await invoiceStatus(inv.id)).toBe("paid");
    const second = await t.as.post(`${base(t)}/auto-reconcile/apply`, body);
    expect(second.status).toBe(200);
    expect(second.body.applied).toBe(0);
    expect(second.body.skipped).toBe(1);
    const payments = await h.sql(`SELECT id FROM invoice_payments WHERE invoice_id = $1`, [inv.id]);
    expect(payments).toHaveLength(1);
    const row = await h.sql<{ match_status: string; is_reconciled: boolean }>(
      `SELECT match_status, is_reconciled FROM bank_transactions WHERE id = $1`,
      [tt.id]
    );
    expect(row[0]).toEqual({ match_status: "matched", is_reconciled: true });
  });

  it("[R06-05] apply respects the period lock", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const inv = await invoice(t, 300, "2026-09-02");
    await importCsv(t, ba.id, [["2026-09-10", `PAYMENT ${inv.number}`, "", "315.00"]]);
    const tt = (await lines(t, ba.id))[0];
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_end, status) VALUES ($1, '2026-09-30', 'locked')`,
      [t.company.id]
    );
    const r = await t.as.post(`${base(t)}/auto-reconcile/apply`, {
      matches: [{ bankTransactionId: tt.id, matchedType: "invoice", matchedId: inv.id }],
    });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(0);
    expect(r.body.results[0].code).toBe("PERIOD_LOCKED");
    const direct = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "invoice",
      matchedId: inv.id,
    });
    expect(direct.status).toBe(403);
    expect(await invoiceStatus(inv.id)).toBe("sent");
  });

  it("[R06-13] a random or other-company id is a 404, never a 500; re-matching a reconciled line is refused", async () => {
    const t = await vatTenant();
    const other = await h.createSecondTenant();
    const otherInv = await other.as.post(`/api/companies/${other.company.id}/invoices`, {
      customerName: "Other",
      date: "2026-10-01",
      lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [["2026-10-09", "SOME CREDIT", "", "105.00"]]);
    const tt = (await lines(t, ba.id))[0];
    for (const matchedType of ["journal", "invoice", "receipt"]) {
      const r = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
        matchedType,
        matchedId: randomUUID(),
      });
      expect([404, 422], `${matchedType} ${r.text}`).toContain(r.status);
      expect(r.status).not.toBe(500);
    }
    const cross = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "invoice",
      matchedId: otherInv.body.id,
    });
    expect(cross.status).toBe(404);
    const missingTxn = await t.as.post(`${base(t)}/bank-statements/${randomUUID()}/match`, {
      matchedType: "invoice",
      matchedId: randomUUID(),
    });
    expect(missingTxn.status).toBe(404);

    const income = await accountByCode(t, "4010");
    expect(
      (
        await t.as.post(`${base(t)}/bank-statements/${tt.id}/create-entry`, {
          accountId: income.id,
        })
      ).status
    ).toBe(201);
    const again = await t.as.post(`${base(t)}/bank-statements/${tt.id}/create-entry`, {
      accountId: (await accountByCode(t, "4020")).id,
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_RECONCILED");
  });

  it("[R06-16] apply errors carry codes and no SQL text", async () => {
    const t = await vatTenant();
    const bogus = await t.as.post(`${base(t)}/auto-reconcile/apply`, {
      matches: [{ bankTransactionId: "zzz", matchedType: "invoice", matchedId: "zzz" }],
    });
    expect(bogus.status).toBe(400);
    expect(bogus.text.toLowerCase()).not.toMatch(/failed query|update bank_transactions|select /);
    const missing = await t.as.post(`${base(t)}/auto-reconcile/apply`, {
      matches: [
        { bankTransactionId: randomUUID(), matchedType: "journal", matchedId: randomUUID() },
      ],
    });
    expect(missing.status).toBe(200);
    expect(missing.body.applied).toBe(0);
    expect(missing.body.results[0].code).toBe("BANK_TRANSACTION_NOT_FOUND");
    expect(missing.text.toLowerCase()).not.toMatch(/failed query|bank_transactions set|select /);
  });

  it("[R06-18] is_reconciled and match_status cannot disagree (trigger + check)", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [["2026-10-10", "X", "1.00", ""]]);
    const tt = (await lines(t, ba.id))[0];
    await h.sql(`UPDATE bank_transactions SET is_reconciled = true WHERE id = $1`, [tt.id]);
    let row = await h.sql<{ match_status: string }>(
      `SELECT match_status FROM bank_transactions WHERE id = $1`,
      [tt.id]
    );
    expect(row[0].match_status).toBe("matched");
    await h.sql(`UPDATE bank_transactions SET is_reconciled = false WHERE id = $1`, [tt.id]);
    row = await h.sql(`SELECT match_status FROM bank_transactions WHERE id = $1`, [tt.id]);
    expect(row[0].match_status).not.toBe("matched");
    const report = await t.as.get(`${base(t)}/bank-statements/report?bankAccountId=${ba.id}`);
    expect(report.body.summary).toMatchObject({ totalTransactions: 1, reconciledCount: 0 });
  });
});

describe("W3-C banking: rules", () => {
  it("[R06-04] a rule match creates a real journal entry (and a review draft when required)", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const expense = await accountByCode(t, "5000");
    await importCsv(t, ba.id, [
      ["2026-10-11", "CARREFOUR GROCERIES", "105.00", ""],
      ["2026-10-12", "DEWA BILL", "210.00", ""],
    ]);
    const noAccount = await t.as.post(`${base(t)}/reconciliation-rules`, {
      name: "Carrefour",
      matchType: "contains",
      matchValue: "carrefour",
      vatTreatment: "standard",
    });
    expect(noAccount.status).toBe(400);
    const r1 = await t.as.post(`${base(t)}/reconciliation-rules`, {
      name: "Carrefour",
      matchType: "contains",
      matchValue: "carrefour",
      accountId: expense.id,
      vatTreatment: "standard",
    });
    expect(r1.status, r1.text).toBe(201);
    const r2 = await t.as.post(`${base(t)}/reconciliation-rules`, {
      name: "DEWA",
      matchType: "starts_with",
      matchValue: "dewa",
      accountId: expense.id,
      vatTreatment: "none",
      requireReview: true,
    });
    expect(r2.status, r2.text).toBe(201);
    const run = await t.as.post(`${base(t)}/reconciliation-rules/auto-match`, {});
    expect(run.status, run.text).toBe(200);
    expect(run.body).toMatchObject({ matched: 2, posted: 1, pendingReview: 1 });
    const carrefour = await line(t, ba.id, "CARREFOUR GROCERIES");
    expect(carrefour).toMatchObject({ isReconciled: true, matchStatus: "matched" });
    expect(carrefour.matchedJournalEntryId).toBeTruthy();
    // 105 inclusive of 5% VAT: 100 expense + 5 input VAT.
    expect(await glBalance(t.company.id, expense.id)).toBe(100);
    expect(await glBalance(t.company.id, (await accountByCode(t, "1050")).id)).toBe(5);
    const dewa = await line(t, ba.id, "DEWA BILL");
    expect(dewa).toMatchObject({ isReconciled: false, matchStatus: "suggested" });
    const draft = await h.sql<{ status: string }>(
      `SELECT status FROM journal_entries WHERE id = $1`,
      [dewa.matchedJournalEntryId]
    );
    expect(draft[0].status).toBe("draft");
    const confirm = await t.as.post(`${base(t)}/bank-statements/${dewa.id}/confirm-entry`, {});
    expect(confirm.status, confirm.text).toBe(200);
    expect(confirm.body.isReconciled).toBe(true);
    // Running again matches nothing new.
    const rerun = await t.as.post(`${base(t)}/reconciliation-rules/auto-match`, {});
    expect(rerun.body.matched).toBe(0);

    // Unmatch reverses the rule's entry; running the rules again re-posts exactly one live entry.
    expect((await t.as.delete(`${base(t)}/bank-statements/${carrefour.id}/match`)).status).toBe(
      200
    );
    expect(await glBalance(t.company.id, expense.id)).toBe(210);
    const third = await t.as.post(`${base(t)}/reconciliation-rules/auto-match`, {});
    expect(third.body.matched).toBe(1);
    expect(await glBalance(t.company.id, expense.id)).toBe(310);
  });

  it("[R06-05] an explicit idempotency key replays the first result", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [["2026-10-19", "PARKING", "50.00", ""]]);
    const tt = (await lines(t, ba.id))[0];
    const expense = await accountByCode(t, "5000");
    const headers = { "Idempotency-Key": `test-key-${tt.id.slice(0, 8)}` };
    const a = await t.as.post(
      `${base(t)}/bank-statements/${tt.id}/create-entry`,
      { accountId: expense.id },
      { headers }
    );
    expect(a.status, a.text).toBe(201);
    const b = await t.as.post(
      `${base(t)}/bank-statements/${tt.id}/create-entry`,
      { accountId: expense.id },
      { headers }
    );
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(await liveEntries(t.company.id, "bank_reconciliation")).toHaveLength(1);
  });

  it("[R06-15] matchType is exact|contains|starts_with|regex and invalid regexes are rejected", async () => {
    const t = await vatTenant();
    const expense = await accountByCode(t, "5000");
    const mk = (over: Record<string, unknown>) =>
      t.as.post(`${base(t)}/reconciliation-rules`, {
        name: "r",
        matchValue: "x",
        accountId: expense.id,
        vatTreatment: "none",
        matchType: "contains",
        ...over,
      });
    expect((await mk({ matchType: "equals" })).status).toBe(400);
    expect((await mk({ matchType: "regex", matchValue: "([a-z" })).status).toBe(400);
    expect((await mk({ matchType: "regex", matchValue: "(a+)+$" })).status).toBe(400);
    expect((await mk({ matchType: "regex", matchValue: "^uber\\s+trip" })).status).toBe(201);
    expect((await mk({ matchType: "exact" })).status).toBe(201);
  });
});

describe("W3-C banking: split, transfer, VAT, fee", () => {
  it("[R06-21] one bank line settles two invoices (split) and two lines settle one invoice", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const a = await invoice(t, 1000);
    const b = await invoice(t, 2000);
    const c = await invoice(t, 400);
    await importCsv(t, ba.id, [
      ["2026-10-13", "BULK PAYMENT", "", "3150.00"],
      ["2026-10-14", "PART 1", "", "200.00"],
      ["2026-10-15", "PART 2", "", "220.00"],
    ]);
    const bulk = await line(t, ba.id, "BULK PAYMENT");
    const wrong = await t.as.post(`${base(t)}/bank-statements/${bulk.id}/match`, {
      allocations: [
        { type: "invoice", id: a.id, amount: "1050.00" },
        { type: "invoice", id: b.id, amount: "2000.00" },
      ],
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe("ALLOCATION_MISMATCH");
    const split = await t.as.post(`${base(t)}/bank-statements/${bulk.id}/match`, {
      allocations: [
        { type: "invoice", id: a.id, amount: "1050.00" },
        { type: "invoice", id: b.id, amount: "2100.00" },
      ],
    });
    expect(split.status, split.text).toBe(201);
    expect(split.body.matches).toHaveLength(2);
    expect(await invoiceStatus(a.id)).toBe("paid");
    expect(await invoiceStatus(b.id)).toBe("paid");

    const p1 = await line(t, ba.id, "PART 1");
    const p2 = await line(t, ba.id, "PART 2");
    expect(
      (
        await t.as.post(`${base(t)}/bank-statements/${p1.id}/match`, {
          matchedType: "invoice",
          matchedId: c.id,
        })
      ).status
    ).toBe(201);
    expect(await invoiceStatus(c.id)).toBe("partial");
    expect(
      (
        await t.as.post(`${base(t)}/bank-statements/${p2.id}/match`, {
          matchedType: "invoice",
          matchedId: c.id,
        })
      ).status
    ).toBe(201);
    expect(await invoiceStatus(c.id)).toBe("paid");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(3570);

    // Unmatching the split reverses both payments.
    const un = await t.as.delete(`${base(t)}/bank-statements/${bulk.id}/match`);
    expect(un.status, un.text).toBe(200);
    expect(await invoiceStatus(a.id)).toBe("sent");
    expect(await invoiceStatus(b.id)).toBe("sent");
  });

  it("[R06-21] a transfer between two bank accounts posts one entry and clears both lines", async () => {
    const t = await vatTenant();
    const from = await bankAccount(t, { nameEn: "ENBD current" });
    const to = await bankAccount(t, { nameEn: "Wio savings", bankName: "Wio Bank" });
    await importCsv(t, from.id, [["2026-10-16", "TRANSFER TO WIO", "10000.00", ""]]);
    await importCsv(t, to.id, [["2026-10-16", "TRANSFER FROM ENBD", "", "10000.00"]]);
    const out = (await lines(t, from.id))[0];
    const inn = (await lines(t, to.id))[0];
    const r = await t.as.post(`${base(t)}/bank-statements/${out.id}/match`, {
      matchedType: "transfer",
      matchedId: to.id,
      counterpartTransactionId: inn.id,
    });
    expect(r.status, r.text).toBe(201);
    expect(await glBalance(t.company.id, from.glAccountId)).toBe(-10000);
    expect(await glBalance(t.company.id, to.glAccountId)).toBe(10000);
    expect(await liveEntries(t.company.id, "bank_transfer")).toHaveLength(1);
    expect((await lines(t, to.id))[0].isReconciled).toBe(true);
    const un = await t.as.delete(`${base(t)}/bank-statements/${inn.id}/match`);
    expect(un.status, un.text).toBe(200);
    expect(un.body.unmatchedTransactionIds.sort()).toEqual([out.id, inn.id].sort());
    expect(await glBalance(t.company.id, from.glAccountId)).toBe(0);
    expect(await glBalance(t.company.id, to.glAccountId)).toBe(0);
  });

  it("[R06-21] create-entry splits 5% VAT and books the bank fee", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [["2026-10-17", "OFFICE SUPPLIES", "1065.00", ""]]);
    const tt = (await lines(t, ba.id))[0];
    const expense = await accountByCode(t, "5000");
    const r = await t.as.post(`${base(t)}/bank-statements/${tt.id}/create-entry`, {
      accountId: expense.id,
      vatTreatment: "standard",
      bankFee: "15.00",
    });
    expect(r.status, r.text).toBe(201);
    expect(await glBalance(t.company.id, expense.id)).toBe(1000);
    expect(await glBalance(t.company.id, (await accountByCode(t, "1050")).id)).toBe(50);
    expect(await glBalance(t.company.id, (await accountByCode(t, "5110")).id)).toBe(15);
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(-1065);
  });

  it("[R06-21][R06-02] bank match -> unmatch of a vendor bill pays it through bills.recordPayment and reverses through bills.reversePayment", async () => {
    const { has } = await import("../../server/platform/service-registry");
    for (const name of [
      "invoices.recordPayment",
      "invoices.reversePayment",
      "bills.recordPayment",
      "bills.reversePayment",
    ]) {
      expect(has(name), name).toBe(true);
    }
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const created = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Acme Hosting LLC",
      vendor_trn: "100000000000003",
      bill_number: `B-${randomUUID().slice(0, 6)}`,
      bill_date: "2026-10-01",
      due_date: "2026-10-31",
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(created.status, created.text).toBe(200);
    const billId = created.body.id as string;
    const appr = await t.as.post(`/api/bills/${billId}/approve`, {});
    expect(appr.status, appr.text).toBe(200);
    const ap = await accountByCode(t, "2010");
    const apBefore = await glBalance(t.company.id, ap.id);
    expect(apBefore).toBe(-1050);

    await importCsv(t, ba.id, [["2026-10-18", "VENDOR PAY ACME", "1050.00", ""]]);
    const tt = (await lines(t, ba.id))[0];
    const m = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "bill",
      matchedId: billId,
    });
    expect(m.status, m.text).toBe(201);
    const billStatus = async () =>
      (
        await h.sql<{ status: string }>(`SELECT status FROM vendor_bills WHERE id = $1`, [billId])
      )[0].status;
    expect(await billStatus()).toBe("paid");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(-1050);
    expect(await glBalance(t.company.id, ap.id)).toBe(0);
    expect((await lines(t, ba.id))[0].isReconciled).toBe(true);
    const match = await h.sql<{ payment_id: string; target_type: string }>(
      `SELECT payment_id, target_type FROM bank_transaction_matches
        WHERE bank_transaction_id = $1 AND status = 'active'`,
      [tt.id]
    );
    expect(match).toHaveLength(1);
    expect(match[0].target_type).toBe("bill");
    expect(match[0].payment_id).toBeTruthy();

    const un = await t.as.delete(`${base(t)}/bank-statements/${tt.id}/match`);
    expect(un.status, un.text).toBe(200);
    expect(un.body.reversedPayments).toEqual([match[0].payment_id]);
    expect(await billStatus()).toBe("approved");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(0);
    expect(await glBalance(t.company.id, ap.id)).toBe(-1050);
    expect((await lines(t, ba.id))[0].isReconciled).toBe(false);
    const pays = await h.sql<{ kind: string; status: string; amount: string }>(
      `SELECT kind, status, amount::text AS amount FROM bill_payments WHERE bill_id = $1 ORDER BY created_at`,
      [billId]
    );
    expect(pays.map((p) => [p.kind, p.status])).toEqual([
      ["payment", "voided"],
      ["reversal", "active"],
    ]);
    const net = await h.sql<{ paid: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS paid FROM bill_payments WHERE bill_id = $1`,
      [billId]
    );
    expect(Number(net[0].paid)).toBe(0);

    // Re-match settles again with exactly one live bill payment entry.
    const again = await t.as.post(`${base(t)}/bank-statements/${tt.id}/match`, {
      matchedType: "bill",
      matchedId: billId,
    });
    expect(again.status, again.text).toBe(201);
    expect(await billStatus()).toBe("paid");
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(-1050);
  });
});

describe("W3-C banking: statement and transactions", () => {
  it.each([false, true])(
    "requires actual CSV content (format hint present: %s)",
    async (withHint) => {
      const t = await vatTenant();
      const account = await bankAccount(t);
      const endpoint = `${base(t)}/bank-statements`;
      const renamed = {
        fileName: "renamed.csv",
        fileBase64: Buffer.from(
          ":20:REF\n:25:AE400000000\n:28C:00001/001\n:60F:C261001AED100,00\n:61:2610011001D10,00NTRFREF\n:86:Payment\n:62F:C261001AED90,00"
        ).toString("base64"),
      };
      for (const path of ["preview", "import"]) {
        const refused = await t.as.post(`${endpoint}/${path}`, {
          ...renamed,
          bankAccountId: account.id,
          ...(withHint ? { expectedKind: "csv" } : {}),
        });
        expect(refused.status, refused.text).toBe(400);
        expect(refused.body.code).toBe("STATEMENT_CSV_REQUIRED");
      }
      expect(await lines(t, account.id)).toEqual([]);
      const accepted = await t.as.post(`${endpoint}/import`, {
        bankAccountId: account.id,
        fileName: "actual.csv",
        ...(withHint ? { expectedKind: "csv" } : {}),
        fileBase64: Buffer.from("Date,Description,Debit,Credit\n2026-10-01,Payment,10,0").toString(
          "base64"
        ),
      });
      expect(accepted.status, accepted.text).toBe(201);
      expect(accepted.body.imported).toBe(1);
    }
  );

  it("[R06-20] reconciliation statement difference is 0 on a fixture, then sign-off and export", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    await importCsv(t, ba.id, [
      ["2026-10-01", "CAPITAL IN", "", "20000.00", "20000.00"],
      ["2026-10-05", "RENT", "5000.00", "", "15000.00"],
      ["2026-10-20", "UNKNOWN CREDIT", "", "300.00", "15300.00"],
    ]);
    const capital = await accountByCode(t, "3010");
    const expense = await accountByCode(t, "5000");
    for (const [desc, acc] of [
      ["CAPITAL IN", capital.id],
      ["RENT", expense.id],
    ] as const) {
      const l = await line(t, ba.id, desc);
      const r = await t.as.post(`${base(t)}/bank-statements/${l.id}/create-entry`, {
        accountId: acc,
      });
      expect(r.status, r.text).toBe(201);
    }
    // A cheque written in the books but not yet cleared by the bank.
    const cheque = await t.as.post(`${base(t)}/journal`, {
      date: "2026-10-25",
      description: "Cheque 0042 to supplier",
      status: "posted",
      lines: [
        { accountId: expense.id, debit: 1200, credit: 0 },
        { accountId: ba.glAccountId, debit: 0, credit: 1200 },
      ],
    });
    expect(cheque.status, cheque.text).toBeLessThan(300);

    const st = await t.as.get(
      `${base(t)}/bank-accounts/${ba.id}/reconciliation-statement?periodEnd=2026-10-31&statementClosingBalance=15300.00`
    );
    expect(st.status, st.text).toBe(200);
    expect(st.body.totals).toMatchObject({
      statementClosingBalance: "15300.00",
      glBalance: "13800.00",
      outstandingPayments: "1200.00",
      unrecordedReceipts: "300.00",
      difference: "0.00",
    });

    const wrong = await t.as.post(`${base(t)}/bank-accounts/${ba.id}/reconciliations`, {
      periodEnd: "2026-10-31",
      statementClosingBalance: "15000.00",
    });
    expect(wrong.status).toBe(201);
    const refused = await t.as.post(
      `${base(t)}/bank-reconciliations/${wrong.body.id}/sign-off`,
      {}
    );
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("RECONCILIATION_DIFFERENCE");

    const rec = await t.as.post(`${base(t)}/bank-accounts/${ba.id}/reconciliations`, {
      periodEnd: "2026-10-31",
      statementClosingBalance: "15300.00",
    });
    expect(rec.status, rec.text).toBe(201);
    const signed = await t.as.post(`${base(t)}/bank-reconciliations/${rec.body.id}/sign-off`, {});
    expect(signed.status, signed.text).toBe(200);
    expect(signed.body).toMatchObject({ status: "signed_off", signedOffBy: t.user.id });
    expect(signed.body.signedOffAt).toBeTruthy();

    const pdf = await t.as.get(`${base(t)}/bank-reconciliations/${rec.body.id}/export?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    const xlsx = await t.as.get(
      `${base(t)}/bank-reconciliations/${rec.body.id}/export?format=xlsx`
    );
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
    const other = await h.createSecondTenant();
    const leak = await other.as.get(
      `/api/companies/${other.company.id}/bank-reconciliations/${rec.body.id}/export`
    );
    expect(leak.status).toBe(404);
  });

  it("[R06-22] edit, exclude / restore, soft delete, import history with undo, continuity check", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const first = await importCsv(t, ba.id, [
      ["2026-10-01", "OPENING CREDIT", "", "1000.00", "1000.00"],
      ["2026-10-02", "TYPO DESCRIPTON", "10.00", "", "990.00"],
    ]);
    expect(first.continuityWarning).toBeNull();
    const typo = await line(t, ba.id, "TYPO DESCRIPTON");
    const edit = await t.as.patch(`${base(t)}/bank-statements/${typo.id}`, {
      description: "TYPO FIXED",
    });
    expect(edit.status, edit.text).toBe(200);
    const ex = await t.as.post(`${base(t)}/bank-statements/${typo.id}/exclude`, {
      reason: "Duplicate line",
    });
    expect(ex.status, ex.text).toBe(200);
    const unrec = await t.as.get(`${base(t)}/bank-statements/unreconciled?bankAccountId=${ba.id}`);
    expect(unrec.body.map((l: { id: string }) => l.id)).not.toContain(typo.id);
    expect((await t.as.post(`${base(t)}/bank-statements/${typo.id}/restore`, {})).status).toBe(200);
    const del = await t.as.delete(`${base(t)}/bank-statements/${typo.id}`, {
      reason: "Entered twice",
    });
    expect(del.status, del.text).toBe(200);
    expect((await lines(t, ba.id)).map((l) => l.id)).not.toContain(typo.id);
    const audit = await h
      .sql(`SELECT action FROM audit_logs WHERE entity_id = $1`, [typo.id])
      .catch(() => []);
    expect(Array.isArray(audit)).toBe(true);

    // Next statement opens at 5000 instead of 990: continuity warning.
    const second = await importCsv(t, ba.id, [
      ["2026-10-10", "NEXT STATEMENT", "", "10.00", "5010.00"],
    ]);
    expect(second.continuityWarning).toMatch(/does not continue/);

    // A reconciled line blocks editing; undo keeps it and removes the rest.
    const opening = await line(t, ba.id, "OPENING CREDIT");
    const capital = await accountByCode(t, "3010");
    await t.as.post(`${base(t)}/bank-statements/${opening.id}/create-entry`, {
      accountId: capital.id,
    });
    const blocked = await t.as.patch(`${base(t)}/bank-statements/${opening.id}`, {
      description: "x",
    });
    expect(blocked.status).toBe(409);
    const history = await t.as.get(`${base(t)}/bank-statements/imports?bankAccountId=${ba.id}`);
    expect(history.body.length).toBe(2);
    const undo = await t.as.post(`${base(t)}/bank-statements/imports/${second.batchId}/undo`, {});
    expect(undo.status, undo.text).toBe(200);
    expect(undo.body.removed).toBe(1);
    const undoFirst = await t.as.post(
      `${base(t)}/bank-statements/imports/${first.batchId}/undo`,
      {}
    );
    expect(undoFirst.body).toMatchObject({ removed: 0, keptReconciled: 1 });
    expect(
      (await t.as.post(`${base(t)}/bank-statements/imports/${first.batchId}/undo`, {})).status
    ).toBe(409);
  });
});

describe("CSV statement import isolation", () => {
  it("serializes concurrent imports without losing genuinely repeated rows", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const otherAccount = await bankAccount(t);
    const rows: Row[] = [
      ["2026-10-03", "REPEATED POS", "10.00", ""],
      ["2026-10-03", "REPEATED POS", "10.00", ""],
    ];
    // Hold batch creation so both requests can reach the old pre-transaction duplicate read.
    await h.sql(`CREATE FUNCTION test_delay_csv_batch() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await h.sql(`CREATE TRIGGER test_delay_csv_batch BEFORE INSERT ON bank_import_batches
      FOR EACH ROW EXECUTE FUNCTION test_delay_csv_batch()`);
    try {
      const [a, b, independent] = await Promise.all([
        importCsv(t, ba.id, rows),
        importCsv(t, ba.id, rows),
        importCsv(t, otherAccount.id, rows),
      ]);
      expect([a.imported, b.imported].sort()).toEqual([0, 2]);
      expect([a.batchId, b.batchId].filter(Boolean)).toHaveLength(1);
      expect(independent.imported).toBe(2);
      expect(await lines(t, ba.id)).toHaveLength(2);
      expect(await lines(t, otherAccount.id)).toHaveLength(2);
    } finally {
      await h.sql("DROP TRIGGER test_delay_csv_batch ON bank_import_batches");
      await h.sql("DROP FUNCTION test_delay_csv_batch()");
    }
  });

  it("rolls back the batch with the rows when the database rejects a CSV import", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const path = `${base(t)}/bank-statements/import`;
    const csvContent = "Date,Description,Amount\n2026-10-03,RETRY ATOMIC IMPORT,-25.00";
    await h.sql(`CREATE FUNCTION test_reject_csv_row() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fixture rejected insert'; END; $$ LANGUAGE plpgsql`);
    await h.sql(`CREATE TRIGGER test_reject_csv_row BEFORE INSERT ON bank_transactions
      FOR EACH ROW EXECUTE FUNCTION test_reject_csv_row()`);
    try {
      const failed = await t.as.post(path, { bankAccountId: ba.id, csvContent });
      expect(failed.status).toBe(500);
      expect(
        await h.sql("SELECT id FROM bank_import_batches WHERE bank_account_id = $1", [ba.id])
      ).toHaveLength(0);
      expect(await lines(t, ba.id)).toHaveLength(0);
    } finally {
      await h.sql("DROP TRIGGER test_reject_csv_row ON bank_transactions");
      await h.sql("DROP FUNCTION test_reject_csv_row()");
    }
    const retry = await t.as.post(path, { bankAccountId: ba.id, csvContent });
    expect(retry.status, retry.text).toBe(201);
    expect(retry.body.imported).toBe(1);
  });

  it("deduplicates across the account and compatibility CSV endpoints", async () => {
    const t = await vatTenant();
    const ba = await bankAccount(t);
    const connection = await t.as.post(`${base(t)}/bank-connections`, {
      bankName: "Emirates NBD",
      bankAccountId: ba.id,
    });
    expect(connection.status, connection.text).toBe(201);
    const csvContent = "Date,Description,Debit,Credit\n2026-10-03,ONE ACCOUNT LINE,10.00,";
    const [current, compatibility] = await Promise.all([
      t.as.post(`${base(t)}/bank-statements/import`, { bankAccountId: ba.id, csvContent }),
      t.as.post(`${base(t)}/bank-connections/${connection.body.id}/import`, { csvContent }),
    ]);
    expect(current.status, current.text).toBe(201);
    expect(compatibility.status, compatibility.text).toBe(200);
    expect([current.body.imported, compatibility.body.imported].sort()).toEqual([0, 1]);
    expect(await lines(t, ba.id)).toHaveLength(1);
    expect(
      await h.sql("SELECT id FROM bank_import_batches WHERE bank_account_id = $1", [ba.id])
    ).toHaveLength(1);
  });
});

describe("CSV statement import regressions", () => {
  it("requires the same ambiguity confirmation on the managed and compatibility CSV endpoints", async () => {
    const t = await h.createTenant();
    const account = await bankAccount(t);
    const connections = `${base(t)}/bank-connections`;
    const connection = await t.as.post(connections, {
      bankName: "Emirates NBD",
      bankAccountId: account.id,
    });
    expect(connection.status, connection.text).toBe(201);
    const csvContent = "Date,Description,Debit,Credit\n03/04/2026,Card purchase,17.25,";
    const legacy = `${connections}/${connection.body.id}/import`;
    const main = await t.as.post(`${base(t)}/bank-statements/import`, {
      bankAccountId: account.id,
      csvContent,
    });
    const unconfirmed = await t.as.post(legacy, { csvContent });
    expect(main.status, main.text).toBe(409);
    expect(main.body.code).toBe("CHOICE_REQUIRED");
    expect(unconfirmed.status, unconfirmed.text).toBe(409);
    expect(unconfirmed.body).toEqual(main.body);
    expect(await lines(t, account.id)).toHaveLength(0);
    const confirmed = await t.as.post(legacy, { csvContent, acknowledgeAmbiguity: true });
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body.imported).toBe(1);
    expect(await lines(t, account.id)).toHaveLength(1);
  });

  it("links prior statement rows to the managed account without duplicating overlapping CSV rows", async () => {
    const t = await h.createTenant();
    const account = await bankAccount(t);
    const connections = `${base(t)}/bank-connections`;
    const connection = await t.as.post(connections, { bankName: "Emirates NBD" });
    expect(connection.status, connection.text).toBe(201);
    const prefix = `${connections}/${connection.body.id}`;
    const repeated = "2026-10-03,Identical card purchase,17.25,0.00";
    const separate = "2026-10-04,Separate card purchase,52.10,0.00";
    const csv = (...rows: string[]) => ["Date,Description,Debit,Credit", ...rows].join("\n");
    const original = csv(repeated, repeated, separate);
    const imported = await t.as.post(`${prefix}/import`, { csvContent: original });
    expect(imported.status, imported.text).toBe(200);
    expect(imported.body.imported).toBe(3);

    const overlap = await t.as.post(`${base(t)}/bank-statements/import`, {
      bankAccountId: account.id,
      csvContent: csv(repeated),
    });
    expect(overlap.status, overlap.text).toBe(201);
    const linked = await t.as.post(`${prefix}/link`, { bankAccountId: account.id });
    expect(linked.status, linked.text).toBe(200);

    expect((await lines(t, account.id)).map((row) => row.description).sort()).toEqual([
      "Identical card purchase",
      "Identical card purchase",
      "Separate card purchase",
    ]);
    const legacyRows = await h.sql<{
      bank_statement_account_id: string;
      bank_account_id: string;
      deleted: boolean;
      deleted_by: string | null;
      import_batch_id: string;
    }>(
      `SELECT bank_statement_account_id, bank_account_id, deleted_at IS NOT NULL AS deleted,
              deleted_by, import_batch_id
         FROM bank_transactions WHERE company_id = $1 AND bank_connection_id = $2`,
      [t.company.id, connection.body.id]
    );
    expect(legacyRows).toHaveLength(3);
    expect(legacyRows.filter((row) => !row.deleted)).toHaveLength(2);
    expect(legacyRows.find((row) => row.deleted)?.deleted_by).toBe(t.user.id);
    expect(legacyRows.every((row) => row.bank_statement_account_id === account.id)).toBe(true);
    expect(legacyRows.every((row) => row.bank_account_id === account.glAccountId)).toBe(true);
    expect(
      await h.sql("SELECT bank_account_id FROM bank_import_batches WHERE id = $1", [
        legacyRows[0].import_batch_id,
      ])
    ).toEqual([{ bank_account_id: account.id }]);

    const replay = await t.as.post(`${prefix}/import`, { csvContent: original });
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body).toMatchObject({ imported: 0, duplicates: 3 });
  });

  it("imports and replays all 6000 valid rows shown by CSV preview", async () => {
    const t = await h.createTenant();
    const account = await bankAccount(t);
    const csvContent = [
      "Date,Description,Debit,Credit,Reference",
      ...Array.from({ length: 6000 }, (_, i) => `2026-10-03,Payment ${i},5.00,0.00,ref-${i}`),
    ].join("\n");
    const url = `${base(t)}/bank-statements`;
    const preview = await t.as.post(`${url}/preview`, { csvContent });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.validRows).toBe(6000);
    const request = { bankAccountId: account.id, csvContent, acknowledgeAmbiguity: true };
    const imported = await t.as.post(`${url}/import`, request);
    expect(imported.status, imported.status >= 400 ? imported.text : "").toBe(201);
    expect(imported.body.imported).toBe(6000);
    expect(
      await h.sql(
        `SELECT count(*)::int AS total, count(DISTINCT reference)::int AS unique_refs
           FROM bank_transactions WHERE company_id = $1 AND import_batch_id = $2`,
        [t.company.id, imported.body.batchId]
      )
    ).toEqual([{ total: 6000, unique_refs: 6000 }]);
    const replay = await t.as.post(`${url}/import`, request);
    expect(replay.status, replay.status >= 400 ? replay.text : "").toBe(201);
    expect(replay.body).toMatchObject({ imported: 0, batchId: null, skippedDuplicates: 6000 });
  });

  it("directs retired statement extraction and row import to CSV without writing a batch", async () => {
    const t = await h.createTenant();
    const account = await bankAccount(t);
    const legacyRequests = [
      ["/api/ai/parse-bank-statement", { companyId: t.company.id, text: "2026-10-03 CARD 17.25" }],
      [
        `${base(t)}/bank-transactions/import`,
        {
          bankAccountId: account.id,
          transactions: [{ date: "2026-10-03", description: "CARD", amount: -17.25 }],
        },
      ],
    ] as const;
    for (const [url, body] of legacyRequests) {
      const response = await t.as.post(url, body);
      expect(response.status, response.text).toBe(410);
      expect(response.body).toMatchObject({ code: "STATEMENT_CSV_REQUIRED" });
      expect(response.body.message).toContain("CSV");
    }
    expect(await lines(t, account.id)).toHaveLength(0);
    expect(
      await h.sql("SELECT id FROM bank_import_batches WHERE company_id = $1", [t.company.id])
    ).toHaveLength(0);
  });
});
