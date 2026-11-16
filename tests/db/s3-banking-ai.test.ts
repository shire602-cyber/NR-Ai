/**
 * S3 final sweep — banking, AI and ledger-kernel residuals on the real app + Postgres.
 *
 * [S3-02] AI GL drafts/posts through the ledger kernel (no storage.createJournalEntry).
 * [S3-03] AI GL reconciles bank lines through bank-reconciliation.service applyMatch, so the
 *         allocation row exists and "Unmatch" reverses exactly what the AI created.
 * [S3-04] POST /api/companies/:id/bank-transactions goes through the shared import pipeline.
 * [S3-05] Auto-reconcile only suggests bills a payment can be recorded against.
 * [S3-08] Stored cash-flow forecasts from the old fabricated model are flagged and regenerated.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const TRN = "100000000000003";

async function bankAccount(t: Tenant) {
  const r = await t.as.post(`${base(t)}/bank-accounts`, {
    nameEn: "Main current",
    bankName: "Emirates NBD",
    currency: "AED",
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; glAccountId: string };
}

async function importLine(t: Tenant, bankAccountId: string, row: string) {
  const r = await t.as.post(`${base(t)}/bank-statements/import`, {
    bankAccountId,
    csvContent: ["Date,Description,Debit,Credit", row].join("\n"),
    acknowledgeAmbiguity: true,
  });
  expect(r.status, r.text).toBe(201);
  const lines = await h.sql<{ id: string; description: string }>(
    `SELECT id, description FROM bank_transactions WHERE company_id = $1 AND bank_statement_account_id = $2
      ORDER BY created_at DESC`,
    [t.company.id, bankAccountId]
  );
  return lines[0].id;
}

async function glBalance(companyId: string, accountId: string): Promise<number> {
  const rows = await h.sql<{ net: string }>(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS net
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2`,
    [companyId, accountId]
  );
  return Number(rows[0].net);
}

async function bankLine(id: string) {
  const rows = await h.sql<{ is_reconciled: boolean; match_status: string }>(
    `SELECT is_reconciled, match_status FROM bank_transactions WHERE id = $1`,
    [id]
  );
  return rows[0];
}

async function matchRows(txnId: string) {
  return h.sql<{ status: string; journal_entry_id: string | null; account_id: string | null }>(
    `SELECT status, journal_entry_id, account_id FROM bank_transaction_matches
      WHERE bank_transaction_id = $1 ORDER BY created_at`,
    [txnId]
  );
}

async function queueItem(
  t: Tenant,
  txnId: string | null,
  accountId: string,
  amount = 7000,
  description = "OFFICE RENT"
) {
  const rows = await h.sql<{ id: string }>(
    `INSERT INTO ai_gl_queue (company_id, bank_transaction_id, description, amount, transaction_date,
                              suggested_account_id, suggested_category, ai_confidence, ai_reason, status)
     VALUES ($1, $2, $3, $4, '2026-10-05', $5, 'expense', 0.95, 'rule match', 'pending_review')
     RETURNING id`,
    [t.company.id, txnId, description, amount, accountId]
  );
  return rows[0].id;
}

async function entry(id: string) {
  const rows = await h.sql<{ status: string; source: string }>(
    `SELECT status, source FROM journal_entries WHERE id = $1`,
    [id]
  );
  return rows[0];
}

async function otherExpenseAccount(t: Tenant, notId: string) {
  const rows = await h.sql<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND type = 'expense' AND is_active = true
        AND id <> $2 ORDER BY code LIMIT 1`,
    [t.company.id, notId]
  );
  return rows[0].id;
}

describe("S3 AI GL through the ledger kernel and the bank match service", () => {
  it("[S3-02][S3-03] autopilot drafts a pending match; accept posts + reconciles; unmatch reverses it", async () => {
    const t = await h.createTenant({ name: "AiGl" });
    const ba = await bankAccount(t);
    const txnId = await importLine(t, ba.id, "2026-10-05,OFFICE RENT,7000.00,");
    const expense = await accountByCode(t, "5000");
    const qid = await queueItem(t, txnId, expense.id);

    const { autoPostHighConfidence } = await import("../../server/services/autonomous-gl.service");
    const auto = await autoPostHighConfidence(t.company.id);
    expect(auto.errors).toEqual([]);
    expect(auto.posted).toBe(1);

    const [q] = await h.sql<{ status: string; journal_entry_id: string }>(
      `SELECT status, journal_entry_id FROM ai_gl_queue WHERE id = $1`,
      [qid]
    );
    expect(q.status).toBe("auto_posted");
    expect((await entry(q.journal_entry_id)).status).toBe("draft");
    // The draft is a PENDING allocation; the line is not reconciled until a human posts it.
    expect(await matchRows(txnId)).toEqual([
      { status: "pending", journal_entry_id: q.journal_entry_id, account_id: expense.id },
    ]);
    expect((await bankLine(txnId)).is_reconciled).toBe(false);
    expect(await glBalance(t.company.id, expense.id)).toBe(0);

    const acc = await t.as.post(`${base(t)}/ai-gl/queue/${qid}/accept`, {});
    expect(acc.status, acc.text).toBe(200);
    expect((await entry(q.journal_entry_id)).status).toBe("posted");
    expect(await matchRows(txnId)).toMatchObject([{ status: "active" }]);
    expect(await bankLine(txnId)).toEqual({ is_reconciled: true, match_status: "matched" });
    expect(await glBalance(t.company.id, expense.id)).toBe(7000);
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(-7000);

    // Unmatch on the Banking page now reverses exactly what the AI created.
    const un = await t.as.delete(`${base(t)}/bank-statements/${txnId}/match`);
    expect(un.status, un.text).toBe(200);
    expect(un.body.isReconciled).toBe(false);
    expect(await glBalance(t.company.id, expense.id)).toBe(0);
    expect(await glBalance(t.company.id, ba.glAccountId)).toBe(0);
    expect(await matchRows(txnId)).toMatchObject([{ status: "reversed" }]);
  });

  it("[S3-03] accepting a suggestion without a draft posts through applyMatch with an allocation row", async () => {
    const t = await h.createTenant({ name: "AiGlAccept" });
    const ba = await bankAccount(t);
    const txnId = await importLine(t, ba.id, "2026-10-06,STATIONERY,120.00,");
    const expense = await accountByCode(t, "5000");
    const qid = await queueItem(t, txnId, expense.id, 120, "STATIONERY");

    const acc = await t.as.post(`${base(t)}/ai-gl/queue/${qid}/accept`, {});
    expect(acc.status, acc.text).toBe(200);
    const matches = await matchRows(txnId);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ status: "active", account_id: expense.id });
    expect((await entry(matches[0].journal_entry_id!)).status).toBe("posted");
    expect(await bankLine(txnId)).toEqual({ is_reconciled: true, match_status: "matched" });
    expect(await glBalance(t.company.id, expense.id)).toBe(120);
  });

  it("[S3-03] correcting an autopilot draft discards it and posts the chosen account once", async () => {
    const t = await h.createTenant({ name: "AiGlCorrect" });
    const ba = await bankAccount(t);
    const txnId = await importLine(t, ba.id, "2026-10-07,FUEL STATION,300.00,");
    const expense = await accountByCode(t, "5000");
    const other = await otherExpenseAccount(t, expense.id);
    const qid = await queueItem(t, txnId, expense.id, 300, "FUEL STATION");
    const { autoPostHighConfidence } = await import("../../server/services/autonomous-gl.service");
    expect((await autoPostHighConfidence(t.company.id)).posted).toBe(1);
    const [{ journal_entry_id: draftId }] = await h.sql<{ journal_entry_id: string }>(
      `SELECT journal_entry_id FROM ai_gl_queue WHERE id = $1`,
      [qid]
    );

    const r = await t.as.post(`${base(t)}/ai-gl/queue/${qid}/correct`, { accountId: other });
    expect(r.status, r.text).toBe(200);
    expect(await h.sql(`SELECT id FROM journal_entries WHERE id = $1`, [draftId])).toHaveLength(0);
    const live = (await matchRows(txnId)).filter((m) => m.status === "active");
    expect(live).toHaveLength(1);
    expect(live[0].account_id).toBe(other);
    expect(await glBalance(t.company.id, other)).toBe(300);
    expect(await glBalance(t.company.id, expense.id)).toBe(0);
    expect((await bankLine(txnId)).is_reconciled).toBe(true);
  });

  it("[S3-03] rejecting an autopilot draft removes it and leaves the line unmatched", async () => {
    const t = await h.createTenant({ name: "AiGlReject" });
    const ba = await bankAccount(t);
    const txnId = await importLine(t, ba.id, "2026-10-08,UNKNOWN VENDOR,55.00,");
    const expense = await accountByCode(t, "5000");
    const qid = await queueItem(t, txnId, expense.id, 55, "UNKNOWN VENDOR");
    const { autoPostHighConfidence } = await import("../../server/services/autonomous-gl.service");
    expect((await autoPostHighConfidence(t.company.id)).posted).toBe(1);

    const r = await t.as.post(`${base(t)}/ai-gl/queue/${qid}/reject`, {});
    expect(r.status, r.text).toBe(200);
    const drafts = await h.sql(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND status = 'draft'`,
      [t.company.id]
    );
    expect(drafts).toHaveLength(0);
    expect(await matchRows(txnId)).toMatchObject([{ status: "reversed" }]);
    expect(await bankLine(txnId)).toMatchObject({ is_reconciled: false });
  });

  it("[S3-02] an item without a bank line is posted by the kernel (source ai_gl, numbered)", async () => {
    const t = await h.createTenant({ name: "AiGlNoBank" });
    const expense = await accountByCode(t, "5000");
    const qid = await queueItem(t, null, expense.id, 80, "PETTY CASH");
    const acc = await t.as.post(`${base(t)}/ai-gl/queue/${qid}/accept`, {});
    expect(acc.status, acc.text).toBe(200);
    const rows = await h.sql<{ status: string; source: string; entry_number: string }>(
      `SELECT je.status, je.source, je.entry_number FROM journal_entries je
         JOIN ai_gl_queue q ON q.journal_entry_id = je.id WHERE q.id = $1`,
      [qid]
    );
    expect(rows[0]).toMatchObject({ status: "posted", source: "ai_gl" });
    expect(rows[0].entry_number).toBeTruthy();
    expect(await glBalance(t.company.id, expense.id)).toBe(80);
  });

  it("[S3-02] the ledger-writes ratchet is burned to zero", () => {
    const baseline = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "scripts/guard-baselines/ledger-writes.json"), "utf8")
    );
    expect(baseline.total).toBe(0);
    expect(baseline.files).toEqual({});
  });
});

describe("S3 manual bank line goes through the shared import pipeline [S3-04]", () => {
  it("[S3-04] strict body, managed account, import batch, dedupe, no client reconciliation state", async () => {
    const t = await h.createTenant({ name: "ManualLine" });
    const ba = await bankAccount(t);
    const url = `${base(t)}/bank-transactions`;
    const good = {
      bankAccountId: ba.id,
      transactionDate: "2026-10-09",
      description: "Cash deposit",
      amount: 250.5,
    };

    // Client-owned reconciliation state and unknown fields are rejected, not stored.
    const raw = await t.as.post(url, { ...good, isReconciled: true });
    expect(raw.status, raw.text).toBe(400);
    const noAccount = await t.as.post(url, { ...good, bankAccountId: undefined });
    expect(noAccount.status).toBe(400);
    const nan = await t.as.post(url, { ...good, amount: "abc" });
    expect(nan.status, nan.text).toBe(400);
    expect(nan.body.code).toBe("INVALID_BANK_TRANSACTION");
    expect(
      await h.sql(`SELECT id FROM bank_transactions WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(0);

    const created = await t.as.post(url, good);
    expect(created.status, created.text).toBe(201);
    expect(created.body.batchId).toBeTruthy();
    const [row] = await h.sql<{
      is_reconciled: boolean;
      bank_statement_account_id: string;
      import_batch_id: string;
      amount: string;
    }>(
      `SELECT is_reconciled, bank_statement_account_id, import_batch_id, amount::text
         FROM bank_transactions WHERE id = $1`,
      [created.body.id]
    );
    expect(row).toMatchObject({
      is_reconciled: false,
      bank_statement_account_id: ba.id,
      import_batch_id: created.body.batchId,
    });
    expect(Number(row.amount)).toBe(250.5);

    const dup = await t.as.post(url, good);
    expect(dup.status, dup.text).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE_BANK_TRANSACTION");
    const again = await t.as.post(url, { ...good, allowDuplicates: true });
    expect(again.status, again.text).toBe(201);
  });

  it("[S3-04] another tenant's bank account is 404 and writes nothing", async () => {
    const a = await h.createTenant({ name: "LineA" });
    const b = await h.createSecondTenant();
    const baB = await bankAccount(b);
    const r = await a.as.post(`${base(a)}/bank-transactions`, {
      bankAccountId: baB.id,
      transactionDate: "2026-10-09",
      description: "x",
      amount: 10,
    });
    expect(r.status, r.text).toBe(404);
    expect(
      await h.sql(`SELECT id FROM bank_transactions WHERE company_id = $1`, [a.company.id])
    ).toHaveLength(0);
  });
});

describe("S3 auto-reconcile only suggests payable bills [S3-05]", () => {
  async function bill(t: Tenant, total: number, approve: boolean) {
    const b = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Acme Hosting LLC",
      vendor_trn: TRN,
      bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
      bill_date: "2026-10-01",
      due_date: "2026-10-31",
      line_items: [{ description: "Hosting", quantity: 1, unit_price: total, vat_rate: 0 }],
    });
    expect(b.status, b.text).toBe(200);
    if (approve) {
      const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
      expect(a.status, a.text).toBe(200);
    }
    return b.body.id as string;
  }

  it("[S3-05] a bill pending approval is never suggested; once approved it is", async () => {
    const t = await h.createTenant({ name: "AutoRec" });
    const ba = await bankAccount(t);
    const txnId = await importLine(t, ba.id, "2026-10-10,ACME HOSTING LLC,1300.00,");
    const pendingId = await bill(t, 1300, false);
    const [{ status }] = await h.sql<{ status: string }>(
      `SELECT status FROM vendor_bills WHERE id = $1`,
      [pendingId]
    );
    expect(status).toBe("pending");

    const before = await t.as.post(`${base(t)}/auto-reconcile`, {});
    expect(before.status, before.text).toBe(200);
    expect(
      (before.body.matches as Array<{ matchedId: string }>).some((m) => m.matchedId === pendingId)
    ).toBe(false);

    // Applying the pending bill anyway is refused by the payment seam (409), nothing is written.
    const forced = await t.as.post(`${base(t)}/auto-reconcile/apply`, {
      matches: [{ bankTransactionId: txnId, matchedType: "bill", matchedId: pendingId }],
    });
    expect(forced.status, forced.text).toBe(200);
    expect(forced.body.applied).toBe(0);
    expect(forced.body.results[0]).toMatchObject({ status: "error", code: "BILL_NOT_PAYABLE" });
    expect((await bankLine(txnId)).is_reconciled).toBe(false);

    const approvedId = await bill(t, 1300, true);
    const after = await t.as.post(`${base(t)}/auto-reconcile`, {});
    const billMatch = (
      after.body.matches as Array<{ matchedType: string; matchedId: string }>
    ).find((m) => m.bankTransactionId === txnId);
    expect(billMatch).toMatchObject({ matchedType: "bill", matchedId: approvedId });
  });
});

describe("S3 stored cash-flow forecasts [S3-08]", () => {
  it("[S3-08] migration 0112 flags pre-0112 rows as legacy_model and keeps generator rows", async () => {
    const t = await h.createTenant({ name: "FcMig" });
    await h.sql(
      `INSERT INTO cash_flow_forecasts (company_id, forecast_date, forecast_type, predicted_inflow,
          predicted_outflow, predicted_balance, confidence_level, factors, basis)
       VALUES ($1, '2026-12-01', 'monthly', 50000, 35000, 15000, 0.85, NULL, NULL),
              ($1, '2027-01-01', 'monthly', 10, 5, 5, NULL, '{"basis":"documents_and_scheduled_items"}', NULL)`,
      [t.company.id]
    );
    const sqlText = fs.readFileSync(
      path.join(repoRoot, "migrations/0112_s3_banking_ai.sql"),
      "utf8"
    );
    await h.sql(sqlText);
    await h.sql(sqlText); // idempotent
    const rows = await h.sql<{ basis: string; forecast_date: Date }>(
      `SELECT basis, forecast_date FROM cash_flow_forecasts WHERE company_id = $1 ORDER BY forecast_date`,
      [t.company.id]
    );
    expect(rows.map((r) => r.basis)).toEqual(["legacy_model", "documents_and_scheduled_items"]);
  });

  it("[S3-08] legacy rows are never served: they are discarded and regenerated from documents", async () => {
    const t = await h.createTenant({ name: "FcRead" });
    await h.sql(
      `INSERT INTO cash_flow_forecasts (company_id, forecast_date, forecast_type, predicted_inflow,
          predicted_outflow, predicted_balance, confidence_level, basis)
       VALUES ($1, '2026-12-01', 'monthly', 50000, 35000, 15000, 0.85, 'legacy_model')`,
      [t.company.id]
    );
    // Empty books: nothing to forecast -> the fabricated row is gone and nothing replaces it.
    const empty = await t.as.get(`${base(t)}/forecasts`);
    expect(empty.status, empty.text).toBe(200);
    expect(empty.body).toEqual([]);
    expect(
      await h.sql(`SELECT id FROM cash_flow_forecasts WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(0);

    // With an open invoice the forecast is regenerated from documents on read.
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Acme LLC",
      date: "2026-11-01",
      dueDate: "2026-12-15",
      lines: [
        {
          description: "Services",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0,
          vatSupplyType: "out_of_scope",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    expect(sent.status, sent.text).toBeLessThan(300);
    await h.sql(
      `INSERT INTO cash_flow_forecasts (company_id, forecast_date, forecast_type, predicted_inflow,
          predicted_outflow, predicted_balance, basis)
       VALUES ($1, '2026-12-01', 'monthly', 99999, 1, 99998, 'legacy_model')`,
      [t.company.id]
    );
    const regen = await t.as.get(`/api/analytics/forecasts?companyId=${t.company.id}`);
    expect(regen.status, regen.text).toBe(200);
    expect(regen.body.length).toBeGreaterThan(0);
    for (const f of regen.body) expect(f.basis).toBe("documents_and_scheduled_items");
    expect(
      regen.body.some((f: { predictedInflow: number }) => Number(f.predictedInflow) === 99999)
    ).toBe(false);
  });

  it("[S3-08] the AI forecast endpoint stores document-driven figures, not model predictions", async () => {
    const t = await h.createTenant({ name: "FcAi" });
    const empty = await t.as.post(`/api/ai/forecast-cashflow`, {
      companyId: t.company.id,
      forecastMonths: 3,
    });
    expect(empty.status, empty.text).toBe(400);
    expect(empty.body.code).toBe("INSUFFICIENT_DATA");

    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Acme LLC",
      date: "2026-11-01",
      dueDate: "2026-12-15",
      lines: [
        {
          description: "Services",
          quantity: 1,
          unitPrice: 2000,
          vatRate: 0,
          vatSupplyType: "out_of_scope",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const r = await t.as.post(`/api/ai/forecast-cashflow`, {
      companyId: t.company.id,
      forecastMonths: 3,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.basis).toBe("documents_and_scheduled_items");
    const stored = await h.sql<{ basis: string; confidence_level: number | null }>(
      `SELECT basis, confidence_level FROM cash_flow_forecasts WHERE company_id = $1`,
      [t.company.id]
    );
    expect(stored.length).toBeGreaterThan(0);
    for (const s of stored) {
      expect(s.basis).toBe("documents_and_scheduled_items");
      expect(s.confidence_level).toBeNull();
    }
    const totalInflow = await h.sql<{ v: string }>(
      `SELECT COALESCE(SUM(predicted_inflow),0)::text AS v FROM cash_flow_forecasts WHERE company_id = $1`,
      [t.company.id]
    );
    expect(Number(totalInflow[0].v)).toBe(2000);
  });
});
