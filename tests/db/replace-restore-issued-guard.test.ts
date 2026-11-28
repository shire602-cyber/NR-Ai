/**
 * LOOP2-REPLACE-RESTORE: a "replace" restore must never delete issued tax documents or reuse
 * their numbers. It is refused (409 BACKUP_REPLACE_ISSUED_DOCUMENTS, with per-category counts)
 * when the live company has issued/sent/posted/filed/locked records newer than the backup, and
 * it never lowers a document number counter when it is allowed (drafts only).
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

async function createInvoice(t: Tenant, customerName: string) {
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName,
    date: today(),
    lines: [{ description: "Line", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  return inv.body as { id: string; number: string };
}

async function backup(t: Tenant, name = "Guard backup") {
  const r = await t.as.post(`/api/companies/${t.company.id}/backups`, { name });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; name: string };
}

const replace = (t: Tenant, b: { id: string; name: string }) =>
  t.as.post(`/api/backups/${b.id}/restore`, {
    mode: "replace",
    confirmRestore: true,
    confirmName: b.name,
  });

type ApiBody = { code?: string; details?: unknown; error?: { code?: string; details?: unknown } };
const errCode = (b: ApiBody) => b.code ?? (b.error ? b.error.code : undefined);
const errCategories = (b: ApiBody) =>
  ((b.details ?? (b.error ? b.error.details : undefined)) as { categories: Record<string, number> })
    .categories;

const counters = (t: Tenant) =>
  h.sql(
    `SELECT doc_type, year, last_value::int AS last_value FROM invoice_number_sequences
      WHERE company_id = $1 ORDER BY doc_type, year`,
    [t.company.id]
  );

describe("LOOP2-REPLACE-RESTORE replace restore keeps issued documents and numbers", () => {
  it("(a) refuses replace when an invoice was issued and posted after the backup", async () => {
    const t = await h.createTenant();
    await createInvoice(t, "Before backup");
    const b = await backup(t);
    const issued = await createInvoice(t, "Issued after backup");
    const sent = await t.as.patch(`/api/invoices/${issued.id}/status`, { status: "sent" });
    expect(sent.status, sent.text).toBe(200);
    const sequencesBefore = await counters(t);

    const r = await replace(t, b);
    expect(r.status, r.text).toBe(409);
    expect(errCode(r.body)).toBe("BACKUP_REPLACE_ISSUED_DOCUMENTS");
    const categories = errCategories(r.body);
    expect(categories.invoices).toBe(1);
    expect(categories.journal_entries).toBeGreaterThanOrEqual(1);

    const rows = await h.sql(`SELECT number, status FROM invoices WHERE id = $1`, [issued.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].number).toBe(issued.number);
    expect(rows[0].status).not.toBe("draft");
    expect(await counters(t)).toEqual(sequencesBefore);
    // Nothing was rewound or deleted: no restore audit and no pre-restore backup.
    const pre = await h.sql(
      `SELECT count(*)::int AS n FROM backups WHERE company_id = $1 AND backup_type = 'pre_restore'`,
      [t.company.id]
    );
    expect(pre[0].n).toBe(0);
  });

  it("(b) refuses replace when a VAT return was filed or a period locked after the backup", async () => {
    const t = await h.createTenant();
    const b = await backup(t);
    await h.sql(
      `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, created_by)
       VALUES ($1, '2026-01-01', '2026-03-31', '2026-04-28', 'filed', $2)`,
      [t.company.id, t.user.id]
    );
    const filed = await replace(t, b);
    expect(filed.status, filed.text).toBe(409);
    expect(errCategories(filed.body).vat_returns).toBe(1);

    await h.sql(`DELETE FROM vat_returns WHERE company_id = $1`, [t.company.id]);
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_end, status, lock_type, lock_scope)
       VALUES ($1, '2026-01-31', 'locked', 'hard', 'through')`,
      [t.company.id]
    );
    const locked = await replace(t, b);
    expect(locked.status, locked.text).toBe(409);
    expect(errCategories(locked.body).locked_periods).toBe(1);
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM month_end_close WHERE company_id = $1`, [
          t.company.id,
        ])
      )[0].n
    ).toBe(1);
  });

  it("(c) allows replace when only drafts were added, and never lowers a counter", async () => {
    const t = await h.createTenant();
    await createInvoice(t, "Before backup");
    const b = await backup(t);
    const draft = await createInvoice(t, "Draft after backup");
    await h.sql(
      `UPDATE invoice_number_sequences SET last_value = last_value + 5 WHERE company_id = $1`,
      [t.company.id]
    );
    const live = await counters(t);
    expect(live.length).toBeGreaterThan(0);

    const r = await replace(t, b);
    expect(r.status, r.text).toBe(200);
    expect(
      (await h.sql(`SELECT count(*)::int AS n FROM invoices WHERE id = $1`, [draft.id]))[0].n
    ).toBe(0);
    const after = await counters(t);
    for (const row of live) {
      const kept = after.find((a) => a.doc_type === row.doc_type && a.year === row.year);
      expect(kept?.last_value, `${row.doc_type} ${row.year}`).toBeGreaterThanOrEqual(
        row.last_value
      );
    }
  });

  it("(d) the next invoice after an allowed replace does not reuse a number", async () => {
    const t = await h.createTenant();
    const first = await createInvoice(t, "Before backup");
    const b = await backup(t);
    const draft = await createInvoice(t, "Draft after backup");
    expect(draft.number).not.toBe(first.number);

    const r = await replace(t, b);
    expect(r.status, r.text).toBe(200);
    const next = await createInvoice(t, "After restore");
    expect(next.number).not.toBe(first.number);
    expect(next.number).not.toBe(draft.number);
  });

  async function journal(t: Tenant, status: "draft" | "posted") {
    const bank = await accountByCode(t, "1020");
    const capital = await accountByCode(t, "3010");
    const r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      status,
      lines: [
        { accountId: bank.id, debit: 100 },
        { accountId: capital.id, credit: 100, vatTreatment: "out_of_scope" },
      ],
    });
    expect(r.status, r.text).toBe(200);
    return r.body as { id: string };
  }

  it("(e) refuses replace when a draft journal in the backup was posted in place", async () => {
    const t = await h.createTenant();
    const draft = await journal(t, "draft");
    const b = await backup(t);
    const posted = await t.as.post(`/api/journal/${draft.id}/post`, {});
    expect(posted.status, posted.text).toBe(200);

    const r = await replace(t, b);
    expect(r.status, r.text).toBe(409);
    expect(errCode(r.body)).toBe("BACKUP_REPLACE_ISSUED_DOCUMENTS");
    expect(errCategories(r.body).journal_entries).toBe(1);
    expect(await h.sql("SELECT status FROM journal_entries WHERE id = $1", [draft.id])).toEqual([
      { status: "posted" },
    ]);
  });

  it("(f) refuses replace when a posted journal in the backup was voided after it", async () => {
    const t = await h.createTenant();
    const entry = await journal(t, "posted");
    const b = await backup(t);
    const voided = await t.as.post(`/api/journal/${entry.id}/void`, { reason: "Wrong entry" });
    expect(voided.status, voided.text).toBe(200);

    const r = await replace(t, b);
    expect(r.status, r.text).toBe(409);
    expect(errCode(r.body)).toBe("BACKUP_REPLACE_ISSUED_DOCUMENTS");
    expect(errCategories(r.body).journal_entries).toBeGreaterThanOrEqual(1);
    // The void adds a reversing entry the backup does not have; the original is untouched.
    expect(
      (
        await h.sql("SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1", [
          t.company.id,
        ])
      )[0].n
    ).toBe(2);
  });

  it("(g) refuses replace when a draft invoice in the backup was issued in place", async () => {
    const t = await h.createTenant();
    const draft = await createInvoice(t, "Draft in backup");
    const b = await backup(t);
    const sent = await t.as.patch(`/api/invoices/${draft.id}/status`, { status: "sent" });
    expect(sent.status, sent.text).toBe(200);

    const r = await replace(t, b);
    expect(r.status, r.text).toBe(409);
    expect(errCode(r.body)).toBe("BACKUP_REPLACE_ISSUED_DOCUMENTS");
    expect(errCategories(r.body).invoices).toBe(1);
    expect(await h.sql("SELECT status FROM invoices WHERE id = $1", [draft.id])).toEqual([
      { status: "sent" },
    ]);
  });
});
