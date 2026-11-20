/**
 * W5-B backups (R19-06, R19-07, R17-08, R17-22, R19-17): full-company,
 * encrypted, permissioned snapshots with merge / replace restore.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

async function seed(t: Tenant) {
  const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Backup Contact LLC",
  });
  expect([200, 201]).toContain(contact.status);
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Snapshot Customer",
    date: today(),
    lines: [{ description: "Original line", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  await h.sql(
    `INSERT INTO vendor_bills (company_id, vendor_name, bill_date, total_amount, status)
     VALUES ($1, 'Raw SQL Vendor', now(), 50, 'draft')`,
    [t.company.id]
  );
  return { contactId: contact.body.id as string, invoiceId: inv.body.id as string };
}

async function backup(t: Tenant, name = "Snapshot A") {
  const r = await t.as.post(`/api/companies/${t.company.id}/backups`, { name });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; name: string; tableCounts: Record<string, number> };
}

async function seedBankFinding(company: Tenant, referencedCompany: Tenant) {
  const [row] = await h.sql(
    `INSERT INTO bank_gl_migration_findings (bank_transaction_id, company_id, kind, details)
     VALUES (gen_random_uuid(), $1, 'statement_company_mismatch',
             jsonb_build_object('statement_company_id', $2::uuid))
     RETURNING *`,
    [company.company.id, referencedCompany.company.id]
  );
  return row;
}

describe("W5-B backups", () => {
  it("[R19-06] the manifest captures every company-scoped table or excludes it with a reason", async () => {
    const svc = await import("../../server/services/backup.service");
    const manifest = await svc.buildBackupManifest();
    const captured = new Set(manifest.tables.map((t) => t.name));
    const missing = (await svc.companyScopedTables()).filter(
      (t) => !captured.has(t) && !svc.exclusionReason(t)
    );
    expect(missing).toEqual([]);
    for (const t of [
      "accounts",
      "journal_entries",
      "journal_lines",
      "invoices",
      "invoice_lines",
      "receipts",
      "customer_contacts",
      "vendors",
      "vendor_bills",
      "bill_line_items",
      "bill_payments",
      "invoice_payments",
      "products",
      "bank_transactions",
      "employees",
      "payroll_runs",
      "payroll_items",
      "fixed_assets",
      "budget_plans",
      "budget_lines",
      "expense_claims",
      "expense_claim_items",
      "vat_returns",
      "credit_notes",
      "quotes",
      "purchase_orders",
    ]) {
      expect(captured, t).toContain(t);
    }
    // Parents come before children.
    const order = manifest.tables.map((t) => t.name);
    expect(order.indexOf("journal_entries")).toBeLessThan(order.indexOf("journal_lines"));
    expect(order.indexOf("invoices")).toBeLessThan(order.indexOf("invoice_lines"));
    expect(order.indexOf("payroll_runs")).toBeLessThan(order.indexOf("payroll_items"));
  });

  it("[R17-22] snapshots are encrypted and checksummed; the download is the full decrypted export", async () => {
    const t = await h.createTenant();
    await seed(t);
    const b = await backup(t);
    expect(b.tableCounts.vendor_bills).toBe(1);
    expect(b.tableCounts.customer_contacts).toBe(1);
    const [row] = await h.sql(
      `SELECT data_snapshot, checksum, encrypted FROM backups WHERE id = $1`,
      [b.id]
    );
    expect(row.encrypted).toBe(true);
    expect(row.data_snapshot).toMatch(/^enc:v1:/);
    expect(row.data_snapshot).not.toContain("Snapshot Customer");
    expect(row.data_snapshot).not.toContain("Backup Contact");
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    const list = await t.as.get(`/api/companies/${t.company.id}/backups`);
    expect(JSON.stringify(list.body)).not.toContain("enc:v1");
    const dl = await t.as.get(`/api/backups/${b.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.body.tables.vendor_bills[0].vendor_name).toBe("Raw SQL Vendor");
    expect(dl.body.companyId).toBe(t.company.id);
    const sealed = await t.as.get(`/api/backups/${b.id}/download?format=encrypted`);
    expect(sealed.status, sealed.text).toBe(200);
    expect(sealed.text).toBe(row.data_snapshot);
    const { openSnapshot } = await import("../../server/services/backup.service");
    expect(dl.text).toBe(openSnapshot(row.data_snapshot, row.checksum).json);
  });

  it("excludes operator bank migration findings from tenant exports", async () => {
    const owner = await h.createTenant();
    const other = await h.createSecondTenant();
    await seedBankFinding(owner, other);

    const b = await backup(owner);
    expect(b.tableCounts).not.toHaveProperty("bank_gl_migration_findings");
    const dl = await owner.as.get(`/api/backups/${b.id}/download`);
    expect(dl.status, dl.text).toBe(200);
    expect(dl.body.tables).not.toHaveProperty("bank_gl_migration_findings");
    expect(dl.text).not.toContain(other.company.id);
  });

  it("filters historical bank migration findings from downloads and ignores them on restore", async () => {
    const owner = await h.createTenant();
    const other = await h.createSecondTenant();
    const { invoiceId } = await seed(owner);
    const ownFinding = await seedBankFinding(owner, other);
    const foreignFinding = await seedBankFinding(other, owner);
    const b = await backup(owner);
    const dl = await owner.as.get(`/api/backups/${b.id}/download`);
    expect(dl.status, dl.text).toBe(200);

    // Give the restore a validly sealed snapshot containing an excluded table.
    const injectedId = randomUUID();
    const { openSnapshot, sealSnapshot } = await import("../../server/services/backup.service");
    const snapshot = sealSnapshot({
      ...dl.body,
      tables: {
        ...dl.body.tables,
        bank_gl_migration_findings: [
          {
            bank_transaction_id: injectedId,
            company_id: owner.company.id,
            kind: ownFinding.kind,
            details: { ...ownFinding.details, suppliedBySnapshot: true },
            found_at: ownFinding.found_at,
          },
          { ...foreignFinding, details: { suppliedBySnapshot: true } },
        ],
      },
    });
    await h.sql(`UPDATE backups SET data_snapshot = $2, checksum = $3 WHERE id = $1`, [
      b.id,
      snapshot.sealed,
      snapshot.checksum,
    ]);

    const jsonExport = await owner.as.get(`/api/backups/${b.id}/download`);
    expect(jsonExport.status, jsonExport.text).toBe(200);
    expect(jsonExport.body).toEqual(dl.body);
    const encryptedExport = await owner.as.get(`/api/backups/${b.id}/download?format=encrypted`);
    expect(encryptedExport.status, encryptedExport.text).toBe(200);
    expect(encryptedExport.text).toMatch(/^enc:v1:/);
    expect(openSnapshot(encryptedExport.text, null).snapshot).toEqual(dl.body);
    const [archived] = await h.sql(`SELECT data_snapshot, checksum FROM backups WHERE id = $1`, [
      b.id,
    ]);
    expect(archived).toEqual({ data_snapshot: snapshot.sealed, checksum: snapshot.checksum });

    await h.sql(`UPDATE invoices SET customer_name = 'EDITED AFTER BACKUP' WHERE id = $1`, [
      invoiceId,
    ]);

    const restore = await owner.as.post(`/api/backups/${b.id}/restore`, {
      mode: "replace",
      confirmRestore: true,
      confirmName: b.name,
    });
    expect(restore.status, restore.text).toBe(200);
    expect(restore.body.tables.map((row: { table: string }) => row.table)).not.toContain(
      "bank_gl_migration_findings"
    );
    const [invoice] = await h.sql(`SELECT customer_name FROM invoices WHERE id = $1`, [invoiceId]);
    expect(invoice.customer_name).toBe("Snapshot Customer");

    const findings = await h.sql(
      `SELECT * FROM bank_gl_migration_findings WHERE company_id IN ($1, $2)
         OR bank_transaction_id = $3`,
      [owner.company.id, other.company.id, injectedId]
    );
    expect(findings).toHaveLength(2);
    expect(findings).toEqual(expect.arrayContaining([ownFinding, foreignFinding]));
  });

  it("[R19-07] replace mode reverts an edited invoice, brings back a deleted contact and removes later rows", async () => {
    const t = await h.createTenant();
    const { contactId, invoiceId } = await seed(t);
    const b = await backup(t);

    await h.sql(`UPDATE invoices SET customer_name = 'EDITED AFTER BACKUP' WHERE id = $1`, [
      invoiceId,
    ]);
    await h.sql(`DELETE FROM customer_contacts WHERE id = $1`, [contactId]);
    const later = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Created Later",
    });
    expect([200, 201]).toContain(later.status);

    const preview = await t.as.post(`/api/backups/${b.id}/restore-preview`, { mode: "replace" });
    expect(preview.status, preview.text).toBe(200);
    const contacts = preview.body.tables.find(
      (x: { table: string }) => x.table === "customer_contacts"
    );
    expect(contacts).toMatchObject({ insert: 1, delete: 1 });
    expect(
      preview.body.tables.find((x: { table: string }) => x.table === "invoices")
    ).toMatchObject({ update: 1 });
    // Dry run changed nothing.
    expect(
      (await h.sql(`SELECT customer_name FROM invoices WHERE id = $1`, [invoiceId]))[0]
        .customer_name
    ).toBe("EDITED AFTER BACKUP");

    const noConfirm = await t.as.post(`/api/backups/${b.id}/restore`, {
      mode: "replace",
      confirmRestore: true,
    });
    expect(noConfirm.status).toBe(400);
    const r = await t.as.post(`/api/backups/${b.id}/restore`, {
      mode: "replace",
      confirmRestore: true,
      confirmName: b.name,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.preRestoreBackupId).toBeTruthy();
    expect(
      (await h.sql(`SELECT customer_name FROM invoices WHERE id = $1`, [invoiceId]))[0]
        .customer_name
    ).toBe("Snapshot Customer");
    const names = (
      await h.sql(`SELECT name FROM customer_contacts WHERE company_id = $1`, [t.company.id])
    ).map((x) => x.name);
    expect(names).toEqual(["Backup Contact LLC"]);
    const audit = await h.sql(
      `SELECT description, metadata FROM activity_logs WHERE company_id = $1 AND entity_type = 'backup' AND description LIKE 'Restored%'`,
      [t.company.id]
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].description).toContain("replace mode");
    expect(JSON.parse(audit[0].metadata).mode).toBe("replace");
    // The pre-restore backup holds the edited state.
    const pre = await t.as.get(`/api/backups/${r.body.preRestoreBackupId}/download`);
    expect(pre.body.tables.invoices[0].customer_name).toBe("EDITED AFTER BACKUP");
  });

  it("[R19-07] merge mode adds missing rows but leaves edited rows as they are", async () => {
    const t = await h.createTenant();
    const { contactId, invoiceId } = await seed(t);
    const b = await backup(t);
    await h.sql(`UPDATE invoices SET customer_name = 'EDITED' WHERE id = $1`, [invoiceId]);
    await h.sql(`DELETE FROM customer_contacts WHERE id = $1`, [contactId]);
    const r = await t.as.post(`/api/backups/${b.id}/restore`, {
      mode: "merge",
      confirmRestore: true,
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.totals).toMatchObject({ update: 0, delete: 0 });
    expect(
      (await h.sql(`SELECT customer_name FROM invoices WHERE id = $1`, [invoiceId]))[0]
        .customer_name
    ).toBe("EDITED");
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM customer_contacts WHERE id = $1`, [contactId])
      )[0].n
    ).toBe(1);
  });

  it("[R19-07] a failed restore (checksum mismatch) changes nothing and writes no success audit", async () => {
    const t = await h.createTenant();
    const { invoiceId } = await seed(t);
    const b = await backup(t);
    await h.sql(`UPDATE invoices SET customer_name = 'AFTER' WHERE id = $1`, [invoiceId]);
    await h.sql(`UPDATE backups SET checksum = repeat('0', 64) WHERE id = $1`, [b.id]);
    const r = await t.as.post(`/api/backups/${b.id}/restore`, {
      mode: "replace",
      confirmRestore: true,
      confirmName: b.name,
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("BACKUP_INTEGRITY_FAILED");
    expect(
      (await h.sql(`SELECT customer_name FROM invoices WHERE id = $1`, [invoiceId]))[0]
        .customer_name
    ).toBe("AFTER");
    const audit = await h.sql(
      `SELECT 1 FROM activity_logs WHERE company_id = $1 AND description LIKE 'Restored%'`,
      [t.company.id]
    );
    expect(audit).toHaveLength(0);
  });

  it("[R17-08] a viewer cannot create, list or restore backups; another tenant gets 404", async () => {
    const owner = await h.createTenant();
    const b = await backup(owner);
    const viewer = await h.createTenant({ role: "viewer" });
    expect((await viewer.as.post(`/api/companies/${viewer.company.id}/backups`, {})).status).toBe(
      403
    );
    expect((await viewer.as.get(`/api/companies/${viewer.company.id}/backups`)).status).toBe(403);
    const other = await h.createSecondTenant();
    const steal = await other.as.get(`/api/backups/${b.id}/download`);
    expect([403, 404]).toContain(steal.status);
    const restore = await other.as.post(`/api/backups/${b.id}/restore`, {
      mode: "merge",
      confirmRestore: true,
    });
    expect([403, 404]).toContain(restore.status);
  });

  it("[R19-17] scheduled backups run from the job registry and the manifest endpoint documents PITR as external", async () => {
    const t = await h.createTenant();
    const s = await t.as.put(`/api/companies/${t.company.id}/backups/schedule`, {
      frequency: "daily",
      retentionDays: 30,
    });
    expect(s.status, s.text).toBe(200);
    const { listJobs } = await import("../../server/platform/job-registry");
    expect(listJobs().map((j) => j.name)).toContain("backups.scheduled");
    const { runScheduledBackups } = await import("../../server/services/backup.service");
    expect(await runScheduledBackups()).toBeGreaterThanOrEqual(1);
    const rows = await h.sql(`SELECT backup_type, status FROM backups WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(rows).toEqual([{ backup_type: "scheduled", status: "completed" }]);
    expect(await runScheduledBackups()).toBe(0); // not due again today
    const m = await t.as.get(`/api/companies/${t.company.id}/backups/manifest`);
    expect(m.body.pointInTimeRecovery.status).toBe("requires_external");
  });
});
