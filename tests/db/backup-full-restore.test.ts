/**
 * W5-B backups (R19-06, R19-07, R17-08, R17-22, R19-17): full-company,
 * encrypted, permissioned snapshots with merge / replace restore.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

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
    expect(dl.headers.get("x-backup-export-sha256")).toBe(sha256(dl.text));
    expect(dl.body.tables.vendor_bills[0].vendor_name).toBe("Raw SQL Vendor");
    expect(dl.body.companyId).toBe(t.company.id);
  });

  it("seals an encrypted download of a legacy plaintext backup and returns an export checksum", async () => {
    const t = await h.createTenant();
    const b = await backup(t, "Legacy snapshot");
    const snapshot = {
      version: "1.0",
      companyId: t.company.id,
      data: { accounts: [{ nameEn: "Private legacy account" }] },
    };
    const plaintext = JSON.stringify(snapshot);
    await h.sql(
      `UPDATE backups SET data_snapshot = $2, checksum = $3, format_version = '1.0',
                         encrypted = false WHERE id = $1`,
      [b.id, plaintext, sha256(plaintext)]
    );
    const response = await t.as.get(`/api/backups/${b.id}/download?format=encrypted`);
    expect(response.status, response.text).toBe(200);
    expect(response.text).toMatch(/^enc:v1:/);
    expect(response.text).not.toContain("Private legacy account");
    expect(response.headers.get("content-disposition")).toMatch(/\.muhbak"/);
    expect(response.headers.get("x-backup-export-sha256")).toBe(sha256(response.text));
    const { openSnapshot } = await import("../../server/services/backup.service");
    expect(openSnapshot(response.text, sha256(plaintext)).snapshot).toEqual(snapshot);
    const metadata = await t.as.get(`/api/backups/${b.id}`);
    expect(metadata.body.checksum).toBe(sha256(plaintext));
  });

  it("enforces client scope and company backup permissions for NR firm administrators", async () => {
    const staff = await h.createTenant({ firmRole: "firm_admin" });
    const client = await h.createSecondTenant({ companyColumns: { company_type: "client" } });
    const own = await backup(staff);
    const clientBackup = await backup(client);
    const companyUrl = `/api/companies/${client.company.id}/backups`;
    const backupUrl = `/api/backups/${clientBackup.id}`;
    const cloneUrl = `/api/backups/${own.id}/clone`;
    const target = { targetCompanyId: client.company.id };
    for (const path of [companyUrl, `${companyUrl}/manifest`, `${companyUrl}/schedule`]) {
      expect((await staff.as.get(path)).status, path).toBe(403);
    }
    for (const path of [backupUrl, `${backupUrl}/download`]) {
      expect((await staff.as.get(path)).status, path).toBe(404);
    }
    expect((await staff.as.post(`${backupUrl}/restore-preview`, { mode: "merge" })).status).toBe(
      404
    );
    expect((await staff.as.post(`${cloneUrl}-preview`, target)).status).toBe(404);
    expect(
      (
        await staff.as.post(cloneUrl, {
          ...target,
          confirmRestore: true,
          confirmTargetName: client.company.name,
        })
      ).status
    ).toBe(404);

    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')`,
      [client.company.id, staff.user.id]
    );
    const insufficient = await staff.as.get(`${backupUrl}/download`);
    expect(insufficient.status).toBe(403);
    expect(insufficient.body.code).toBe("PERMISSION_DENIED");
    expect((await staff.as.post(`${cloneUrl}-preview`, target)).status).toBe(403);

    await h.sql(`UPDATE company_users SET role = 'admin' WHERE company_id = $1 AND user_id = $2`, [
      client.company.id,
      staff.user.id,
    ]);
    expect((await staff.as.get(`${backupUrl}/download`)).status).toBe(200);
    const allowed = await staff.as.post(`${cloneUrl}-preview`, target);
    expect(allowed.status, allowed.text).toBe(200);

    const { NR_FIRM_ID } = await import("../../server/services/firm/scope");
    await h.sql(
      `INSERT INTO firm_client_links (company_id, firm_id, status) VALUES ($1, $2, 'revoked')`,
      [client.company.id, NR_FIRM_ID]
    );
    expect((await staff.as.get(`${backupUrl}/download`)).status).toBe(404);
    expect((await staff.as.post(`${cloneUrl}-preview`, target)).status).toBe(404);
  });

  it("strips retired connection credentials when capturing, downloading, or restoring backups", async () => {
    const t = await h.createTenant();
    const { encryptSecret, decryptSecret } = await import("../../server/services/secret-vault");
    const [connection] = await h.sql<{ id: string }>(
      `INSERT INTO bank_connections (
        company_id, provider, connection_type, access_token, refresh_token,
        token_expires_at, consent_id, auto_sync, account_name
      ) VALUES ($1, 'lean', 'open_banking', $2, $3, now(), 'old-consent', true, 'Operating')
      RETURNING id`,
      [t.company.id, encryptSecret("old-access"), encryptSecret("old-refresh")]
    );
    const b = await backup(t);
    const [newBackup] = await h.sql<{ data_snapshot: string }>(
      "SELECT data_snapshot FROM backups WHERE id = $1",
      [b.id]
    );
    const readSealed = (sealed: string) =>
      JSON.parse(gunzipSync(Buffer.from(decryptSecret(sealed)!.slice(4), "base64")).toString());
    const stripped = {
      id: connection.id,
      account_name: "Operating",
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      consent_id: null,
      auto_sync: false,
    };
    const clean = readSealed(newBackup.data_snapshot);
    expect(clean.tables.bank_connections[0]).toMatchObject(stripped);

    const [originalConnection] = await h.sql("SELECT * FROM bank_connections WHERE id = $1", [
      connection.id,
    ]);
    clean.tables.bank_connections[0] = originalConnection;
    const oldJson = JSON.stringify(clean);
    await h.sql("UPDATE backups SET data_snapshot = $2, checksum = $3 WHERE id = $1", [
      b.id,
      encryptSecret(oldJson),
      createHash("sha256").update(oldJson).digest("hex"),
    ]);
    const download = await t.as.get(`/api/backups/${b.id}/download`);
    expect(download.status, download.text).toBe(200);
    expect(download.headers.get("x-backup-export-sha256")).toBe(sha256(download.text));
    expect(sha256(download.text)).not.toBe(sha256(oldJson));
    expect(download.body.tables.bank_connections[0]).toMatchObject(stripped);
    const encrypted = await t.as.get(`/api/backups/${b.id}/download?format=encrypted`);
    expect(encrypted.status, encrypted.text).toBe(200);
    expect(encrypted.headers.get("x-backup-export-sha256")).toBe(sha256(encrypted.text));
    expect(readSealed(encrypted.text).tables.bank_connections[0]).toMatchObject(stripped);

    await h.sql("DELETE FROM bank_connections WHERE id = $1", [connection.id]);
    const restored = await t.as.post(`/api/backups/${b.id}/restore`, {
      mode: "merge",
      confirmRestore: true,
    });
    expect(restored.status, restored.text).toBe(200);
    const [row] = await h.sql("SELECT * FROM bank_connections WHERE id = $1", [connection.id]);
    expect(row).toMatchObject(stripped);
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
