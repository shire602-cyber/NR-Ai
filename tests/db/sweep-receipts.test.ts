/**
 * W2-D receipts sweep: R05-01, R05-02, R05-03, R05-05, R05-19b, R17-02.
 * A receipt is validated on the way in, immutable once posted, posts exactly once, and is
 * corrected only through /revise (reverse + re-post).
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function receipt(t: Tenant, over: Record<string, unknown> = {}) {
  const r = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
    merchant: "Stationery LLC",
    date: "2026-01-15",
    amount: 100,
    vatAmount: 5,
    currency: "AED",
    category: "Office",
    ...over,
  });
  return r;
}

async function accounts(t: Tenant) {
  return {
    expense: await accountByCode(t, "5000"),
    expense2: await accountByCode(t, "5010"),
    bank: await accountByCode(t, "1020"),
  };
}

async function entryLines(entryId: string) {
  return h.sql<{ account_id: string; debit: string; credit: string; code: string }>(
    `SELECT jl.account_id, jl.debit::text AS debit, jl.credit::text AS credit, a.code
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 ORDER BY a.code`,
    [entryId]
  );
}

describe("W2-D receipts", () => {
  it("[R05-03] create rejects server-owned fields (posted, autoPosted, journalEntryId, companyId, uploadedBy)", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    for (const extra of [
      { posted: true },
      { autoPosted: true },
      { journalEntryId: "00000000-0000-0000-0000-000000000001" },
      { companyId: b.company.id },
      { uploadedBy: b.user.id },
      { imagePath: "uploads/x.png" },
    ]) {
      const r = await receipt(a, extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.body.code).toBe("VALIDATION_ERROR");
    }
    const rows = await h.sql("SELECT count(*)::int AS n FROM receipts WHERE company_id = $1", [
      a.company.id,
    ]);
    expect(rows[0].n).toBe(0);
  });

  it("[R05-05] create rejects negative / zero / null amounts and VAT greater than the amount", async () => {
    const a = await h.createTenant();
    for (const over of [
      { amount: -10 },
      { amount: 0 },
      { amount: null },
      { amount: "abc" },
      { amount: 10, vatAmount: 11 },
      { vatAmount: -1 },
      { date: "2026-02-31" },
      { date: "1850-01-01" },
      { currency: "ZZZ" },
    ]) {
      const r = await receipt(a, over);
      expect(r.status, JSON.stringify(over)).toBe(400);
    }
    expect((await receipt(a)).status).toBe(200);
  });

  it("[R17-02] PUT with another companyId is rejected and the receipt does not move", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const created = await receipt(a);
    expect(created.status).toBe(200);
    const r = await a.as.put(`/api/receipts/${created.body.id}`, { companyId: b.company.id });
    expect(r.status).toBe(400);
    const rows = await h.sql("SELECT company_id FROM receipts WHERE id = $1", [created.body.id]);
    expect(rows[0].company_id).toBe(a.company.id);
    // tenant B cannot see or edit it either
    const other = await b.as.put(`/api/receipts/${created.body.id}`, { merchant: "x" });
    expect(other.status).toBe(404);
  });

  it("[R05-01] a posted receipt is immutable (409 RECEIPT_POSTED); an unposted one can be edited; posted/journalEntryId cannot be un-flagged", async () => {
    const a = await h.createTenant();
    const acc = await accounts(a);
    const created = await receipt(a);
    const edit = await a.as.put(`/api/receipts/${created.body.id}`, { amount: 120, vatAmount: 6 });
    expect(edit.status).toBe(200);
    expect(Number(edit.body.amount)).toBe(120);

    const posted = await a.as.post(`/api/receipts/${created.body.id}/post`, {
      accountId: acc.expense.id,
      paymentAccountId: acc.bank.id,
    });
    expect(posted.status).toBe(200);
    expect(posted.body.posted).toBe(true);

    const put = await a.as.put(`/api/receipts/${created.body.id}`, { amount: 5 });
    expect(put.status).toBe(409);
    expect(put.body.code).toBe("RECEIPT_POSTED");
    const unflag = await a.as.put(`/api/receipts/${created.body.id}`, { posted: false });
    expect(unflag.status).toBe(400);
    const del = await a.as.delete(`/api/receipts/${created.body.id}`);
    expect(del.status).toBe(409);

    const row = await h.sql("SELECT amount::text AS amount, posted FROM receipts WHERE id = $1", [
      created.body.id,
    ]);
    expect(Number(row[0].amount)).toBe(120);
    expect(row[0].posted).toBe(true);
  });

  it("[R05-01] PUT into a locked period is refused", async () => {
    const a = await h.createTenant();
    const created = await receipt(a, { date: "2026-03-10" });
    expect(created.status).toBe(200);
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_end, status) VALUES ($1, '2026-03-31', 'locked')`,
      [a.company.id]
    );
    const r = await a.as.put(`/api/receipts/${created.body.id}`, { merchant: "Changed" });
    expect(r.status).toBe(403);
    const moved = await receipt(a, { date: "2026-03-20" });
    expect(moved.status).toBe(403);
  });

  it("[R05-02] posting is once-only: 10 parallel posts produce exactly one journal entry", async () => {
    const a = await h.createTenant();
    const acc = await accounts(a);
    const created = await receipt(a);
    const body = { accountId: acc.expense.id, paymentAccountId: acc.bank.id };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => a.as.post(`/api/receipts/${created.body.id}/post`, body))
    );
    const ok = results.filter((r) => r.status === 200);
    const conflict = results.filter((r) => r.status === 409);
    expect(ok.length).toBe(1);
    expect(conflict.length).toBe(9);
    const entries = await h.sql(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'receipt' AND source_id = $2`,
      [a.company.id, created.body.id]
    );
    expect(entries.length).toBe(1);
    const again = await a.as.post(`/api/receipts/${created.body.id}/post`, body);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("RECEIPT_POSTED");
  });

  it("[R05-02] a failed post leaves the receipt unposted (claim rolls back with the journal)", async () => {
    const a = await h.createTenant();
    const acc = await accounts(a);
    const created = await receipt(a);
    // payment account that is not an asset
    const bad = await a.as.post(`/api/receipts/${created.body.id}/post`, {
      accountId: acc.expense.id,
      paymentAccountId: acc.expense2.id,
    });
    expect(bad.status).toBe(400);
    const row = await h.sql("SELECT posted FROM receipts WHERE id = $1", [created.body.id]);
    expect(row[0].posted).toBe(false);
  });

  it("[R05-01] /revise reverses the original entry and re-posts: books equal the new amount", async () => {
    const a = await h.createTenant();
    const acc = await accounts(a);
    const created = await receipt(a, { amount: 100, vatAmount: 5 });
    const posted = await a.as.post(`/api/receipts/${created.body.id}/post`, {
      accountId: acc.expense.id,
      paymentAccountId: acc.bank.id,
    });
    expect(posted.status).toBe(200);
    const originalEntry = posted.body.journalEntryId as string;

    const revised = await a.as.post(`/api/receipts/${created.body.id}/revise`, {
      amount: 200,
      vatAmount: 10,
      reason: "wrong total",
    });
    expect(revised.status).toBe(200);
    expect(Number(revised.body.amount)).toBe(200);
    expect(revised.body.journalEntryId).not.toBe(originalEntry);

    const entries = await h.sql<{ id: string; source: string; reversed_entry_id: string | null }>(
      `SELECT id, source, reversed_entry_id FROM journal_entries WHERE company_id = $1 ORDER BY created_at`,
      [a.company.id]
    );
    expect(entries.length).toBe(3);
    const reversal = entries.find((e) => e.source === "reversal");
    expect(reversal?.reversed_entry_id).toBe(originalEntry);

    // Net effect on the expense account equals the NEW net amount (200), cash credit 210.
    const net = await h.sql<{ code: string; net: string }>(
      `SELECT a.code, SUM(jl.debit - jl.credit)::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 GROUP BY a.code`,
      [a.company.id]
    );
    const byCode = Object.fromEntries(net.map((r) => [r.code, Number(r.net)]));
    expect(byCode["5000"]).toBe(200);
    expect(byCode["1020"]).toBe(-210);

    // Unposted receipts cannot be "revised"; they are edited.
    const fresh = await receipt(a);
    const notPosted = await a.as.post(`/api/receipts/${fresh.body.id}/revise`, { amount: 3 });
    expect(notPosted.status).toBe(409);
    expect(notPosted.body.code).toBe("RECEIPT_NOT_POSTED");
  });

  it("[R05-19b] split lines post as ONE balanced multi-account entry with cost centers", async () => {
    const a = await h.createTenant();
    const acc = await accounts(a);
    const cc = await a.as.post(`/api/companies/${a.company.id}/cost-centers`, {
      code: "OPS",
      name: "Operations",
    });
    const costCenterId = cc.status < 300 ? cc.body.id : null;
    const created = await receipt(a, {
      amount: undefined,
      vatAmount: undefined,
      lines: [
        {
          accountId: acc.expense.id,
          amount: 60,
          vatAmount: 3,
          ...(costCenterId ? { costCenterId } : {}),
        },
        { accountId: acc.expense2.id, amount: 40, vatAmount: 2 },
      ],
    });
    expect(created.status).toBe(200);
    expect(Number(created.body.amount)).toBe(100);
    expect(Number(created.body.vatAmount)).toBe(5);

    const posted = await a.as.post(`/api/receipts/${created.body.id}/post`, {
      paymentAccountId: acc.bank.id,
    });
    expect(posted.status).toBe(200);
    const lines = await entryLines(posted.body.journalEntryId);
    const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debit).toBe(105);
    expect(credit).toBe(105);
    expect(lines.map((l) => l.code).sort()).toEqual(["1020", "1050", "5000", "5010"]);

    // lines pointing at someone else's account are refused
    const b = await h.createSecondTenant();
    const foreign = await accountByCode(b, "5000");
    const bad = await receipt(a, {
      amount: undefined,
      lines: [{ accountId: foreign.id, amount: 10 }],
    });
    expect(bad.status).toBe(404);
  });

  it("[R05-19b] a multi-receipt upload can be split into separate receipts", async () => {
    const a = await h.createTenant();
    const created = await receipt(a, { amount: 300, vatAmount: 15, merchant: "Combined scan" });
    const split = await a.as.post(`/api/receipts/${created.body.id}/split`, {
      parts: [
        { merchant: "Shop A", amount: 100, vatAmount: 5 },
        { merchant: "Shop B", amount: 120, vatAmount: 6 },
        { merchant: "Shop C", amount: 80, vatAmount: 4 },
      ],
    });
    expect(split.status).toBe(201);
    expect(split.body.receipts).toHaveLength(3);
    const rows = await h.sql<{ merchant: string }>(
      "SELECT merchant FROM receipts WHERE company_id = $1 ORDER BY merchant",
      [a.company.id]
    );
    expect(rows.map((r) => r.merchant)).toEqual(["Shop A", "Shop B", "Shop C"]);
    const tooFew = await a.as.post(`/api/receipts/${split.body.receipts[0].id}/split`, {
      parts: [{ amount: 1 }],
    });
    expect(tooFew.status).toBe(400);
  });
});
