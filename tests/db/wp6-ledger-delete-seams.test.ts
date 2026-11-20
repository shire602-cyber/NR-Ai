/**
 * WP6 (code audit §3.1): journal entries are deleted only through the ledger
 * kernel's audited `deleteDraft`. Two call sites used to `db.delete(journalEntries)`
 * directly: `DELETE /api/journal/:id` and `storage.safeDeleteInvoice` (reached
 * through `DELETE /api/credit-notes/:id`). Posted entries are never deleted:
 * both paths answer 409 and leave the books untouched.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

let t: Tenant;
let cash: string;
let capital: string;

async function journal(status: "draft" | "posted", amount = 100) {
  const r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
    date: today(),
    memo: `wp6 ${status}`,
    status,
    lines: [
      { accountId: cash, debit: amount, credit: 0 },
      { accountId: capital, debit: 0, credit: amount },
    ],
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body as { id: string; status: string };
}

async function entryRows(id: string) {
  const entries = await h.sql<{ status: string }>(
    `SELECT status FROM journal_entries WHERE id = $1`,
    [id]
  );
  const lines = await h.sql<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM journal_lines WHERE entry_id = $1`,
    [id]
  );
  return { entries, lines: lines[0].n };
}

async function kernelAudit(id: string) {
  return h.sql<{ action: string }>(
    `SELECT action FROM audit_logs WHERE resource_type = 'journal_entry' AND resource_id = $1
      ORDER BY created_at`,
    [id]
  );
}

/** The journal delete route also enforces the 5-year retention window. */
async function ageEntry(id: string) {
  await h.sql(`UPDATE journal_entries SET created_at = now() - interval '6 years' WHERE id = $1`, [
    id,
  ]);
}

async function draftCreditNote() {
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    date: today(),
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  const cn = await t.as.post(`/api/companies/${t.company.id}/credit-notes`, {
    invoiceId: inv.body.id,
    lines: [{ description: "Damaged", quantity: 1, unitPrice: 100, vatRate: 5 }],
    reason: "Damaged goods",
  });
  expect(cn.status, cn.text).toBe(201);
  expect(cn.body.status).toBe("draft");
  return cn.body.id as string;
}

beforeAll(async () => {
  t = await h.createTenant({ name: "Wp6" });
  cash = (await accountByCode(t, "1020")).id;
  capital = (await accountByCode(t, "3010")).id;
});

describe("WP6 DELETE /api/journal/:id goes through the kernel deleteDraft", () => {
  it("WP6: a draft is deleted with its lines and a kernel journal.delete_draft audit row", async () => {
    const d = await journal("draft");
    await ageEntry(d.id);
    const del = await t.as.delete(`/api/journal/${d.id}`);
    expect(del.status, del.text).toBe(200);
    const after = await entryRows(d.id);
    expect(after.entries).toEqual([]);
    expect(after.lines).toBe(0);
    expect((await kernelAudit(d.id)).map((r) => r.action)).toContain("journal.delete_draft");
  });

  it("WP6: a posted entry is a 409 ENTRY_POSTED and stays on the books", async () => {
    const p = await journal("posted", 250);
    await ageEntry(p.id);
    const del = await t.as.delete(`/api/journal/${p.id}`);
    expect(del.status, del.text).toBe(409);
    expect(del.body.code).toBe("ENTRY_POSTED");
    const after = await entryRows(p.id);
    expect(after.entries).toEqual([{ status: "posted" }]);
    expect(after.lines).toBe(2);
  });

  it("WP6: another tenant's draft is a 404 and is not deleted", async () => {
    const d = await journal("draft");
    await ageEntry(d.id);
    const other = await h.createSecondTenant();
    const del = await other.as.delete(`/api/journal/${d.id}`);
    expect(del.status, del.text).toBe(404);
    expect((await entryRows(d.id)).entries).toEqual([{ status: "draft" }]);
  });
});

describe("WP6 DELETE /api/credit-notes/:id (safeDeleteInvoice) uses deleteDraft", () => {
  it("WP6: deleting a draft credit note drops its draft journal entry through the kernel", async () => {
    const cnId = await draftCreditNote();
    const d = await journal("draft", 105);
    await h.sql(`UPDATE journal_entries SET source = 'credit_note', source_id = $2 WHERE id = $1`, [
      d.id,
      cnId,
    ]);
    const del = await t.as.delete(`/api/credit-notes/${cnId}`);
    expect(del.status, del.text).toBe(200);
    expect(await h.sql(`SELECT 1 FROM invoices WHERE id = $1`, [cnId])).toEqual([]);
    const after = await entryRows(d.id);
    expect(after.entries).toEqual([]);
    expect(after.lines).toBe(0);
    expect((await kernelAudit(d.id)).map((r) => r.action)).toContain("journal.delete_draft");
  });

  it("WP6: a draft credit note with a posted journal entry is a 409 and nothing is deleted", async () => {
    const cnId = await draftCreditNote();
    const p = await journal("posted", 105);
    const d = await journal("draft", 105);
    await h.sql(
      `UPDATE journal_entries SET source = 'credit_note', source_id = $3 WHERE id IN ($1, $2)`,
      [p.id, d.id, cnId]
    );
    const del = await t.as.delete(`/api/credit-notes/${cnId}`);
    expect(del.status, del.text).toBe(409);
    expect(del.body.code).toBe("INVOICE_HAS_POSTED_JE");
    expect(await h.sql(`SELECT status FROM invoices WHERE id = $1`, [cnId])).toEqual([
      { status: "draft" },
    ]);
    expect((await entryRows(p.id)).entries).toEqual([{ status: "posted" }]);
    // The transaction rolled back: the draft entry is still there too.
    expect((await entryRows(d.id)).entries).toEqual([{ status: "draft" }]);
  });
});
