/**
 * W5-B backups (R19-06, R19-07, R17-08, R17-22, R19-17): full-company,
 * encrypted, permissioned snapshots with merge / replace restore.
 */
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
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
    expect(dl.headers.get("x-backup-export-sha256")).toBe(sha256(dl.text));
    expect(dl.body.tables.vendor_bills[0].vendor_name).toBe("Raw SQL Vendor");
    expect(dl.body.companyId).toBe(t.company.id);
    const sealed = await t.as.get(`/api/backups/${b.id}/download?format=encrypted`);
    expect(sealed.status, sealed.text).toBe(200);
    expect(sealed.text).toBe(row.data_snapshot);
    const { openSnapshot } = await import("../../server/services/backup.service");
    expect(dl.text).toBe(openSnapshot(row.data_snapshot, row.checksum).json);
  });

  it.each([
    { version: "1.0", hasFindings: false },
    { version: "1.0", hasFindings: true },
    { version: "2.0", hasFindings: false },
    { version: "2.0", hasFindings: true },
  ])(
    "seals plaintext v$version downloads on request (findings: $hasFindings)",
    async ({ version, hasFindings }) => {
      const owner = await h.createTenant();
      const b = await backup(owner);
      const dataKey = version === "1.0" ? "data" : "tables";
      const tables = { invoices: [{ customer_name: "Archived customer عميل" }] };
      const snapshot = { version, companyId: owner.company.id, [dataKey]: tables };
      const archived = JSON.stringify(
        hasFindings
          ? {
              ...snapshot,
              [dataKey]: {
                ...tables,
                bank_gl_migration_findings: [{ details: { statement_company_id: randomUUID() } }],
              },
            }
          : snapshot,
        null,
        2
      );
      const checksum = createHash("sha256").update(archived).digest("hex");
      await h.sql(
        `UPDATE backups SET data_snapshot = $2, checksum = $3, encrypted = false, format_version = $4
       WHERE id = $1`,
        [b.id, archived, checksum, version]
      );

      const json = await owner.as.get(`/api/backups/${b.id}/download`);
      expect(json.status, json.text).toBe(200);
      expect(json.text).toBe(hasFindings ? JSON.stringify(snapshot) : archived);
      const digest = createHash("sha256").update(json.text).digest("base64");
      expect(json.headers.get("Content-Digest")).toBe(hasFindings ? `sha-256=:${digest}:` : null);
      const encrypted = await owner.as.get(`/api/backups/${b.id}/download?format=encrypted`);
      expect(encrypted.status, encrypted.text).toBe(200);
      expect(encrypted.headers.get("Content-Type")).toContain("application/octet-stream");
      expect(encrypted.headers.get("Content-Disposition")).toMatch(/\.muhbak"$/);
      expect(encrypted.headers.get("Content-Digest")).toBeNull();
      expect(encrypted.text).toMatch(/^enc:v1:/);
      expect(encrypted.text).not.toContain("Archived customer");
      const { openSnapshot } = await import("../../server/services/backup.service");
      const exportedChecksum = createHash("sha256").update(json.text).digest("hex");
      expect(openSnapshot(encrypted.text, exportedChecksum).json).toBe(json.text);

      const [record] = await h.sql(
        `SELECT data_snapshot, checksum, encrypted, format_version FROM backups WHERE id = $1`,
        [b.id]
      );
      expect(record).toEqual({
        data_snapshot: archived,
        checksum,
        encrypted: false,
        format_version: version,
      });
      const [audit] = await h.sql(
        `SELECT count(*)::int AS count FROM activity_logs
       WHERE company_id = $1 AND entity_type = 'backup' AND entity_id = $2
         AND description = $3`,
        [owner.company.id, b.id, `Downloaded backup (encrypted): ${b.name}`]
      );
      expect(audit.count).toBe(1);
    }
  );

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

  it("filters excluded table counts from historical backup list and detail metadata", async () => {
    const owner = await h.createTenant();
    await seed(owner);
    const b = await backup(owner);
    const archivedCounts = JSON.stringify({ ...b.tableCounts, bank_gl_migration_findings: 2 });
    await h.sql(`UPDATE backups SET table_counts = $2 WHERE id = $1`, [b.id, archivedCounts]);

    const list = await owner.as.get(`/api/companies/${owner.company.id}/backups`);
    expect(list.status, list.text).toBe(200);
    expect(list.body).toContainEqual(expect.objectContaining(b));
    const detail = await owner.as.get(`/api/backups/${b.id}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body).toMatchObject(b);
    expect(detail.body.tableCounts).toEqual(b.tableCounts);

    const [archived] = await h.sql(`SELECT table_counts FROM backups WHERE id = $1`, [b.id]);
    expect(archived.table_counts).toBe(archivedCounts);
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
    const expectedDigest = createHash("sha256").update(jsonExport.text).digest("base64");
    const archivedDigest = Buffer.from(snapshot.checksum, "hex").toString("base64");
    expect(jsonExport.headers.get("Content-Digest")).toBe(`sha-256=:${expectedDigest}:`);
    expect(expectedDigest).not.toBe(archivedDigest);
    expect(jsonExport.headers.get("Cache-Control")).toContain("no-transform");
    const encryptedExport = await owner.as.get(`/api/backups/${b.id}/download?format=encrypted`);
    expect(encryptedExport.status, encryptedExport.text).toBe(200);
    expect(encryptedExport.text).toMatch(/^enc:v1:/);
    expect(encryptedExport.headers.get("Content-Digest")).toBeNull();
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

  it("requires current firm scope for backup downloads and clone targets with customer-type link history", async () => {
    const { NR_FIRM_ID } = await import("../../server/services/firm/scope");
    const staff = await h.createTenant({ firmRole: "firm_admin" });
    const customer = await h.createSecondTenant({ companyColumns: { company_type: "customer" } });
    const own = await backup(staff);
    const customerBackup = await backup(customer);
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'admin')`, [
      customer.company.id,
      staff.user.id,
    ]);
    const [link] = await h.sql<{ id: string }>(
      `INSERT INTO firm_client_links (company_id, firm_id, status)
       VALUES ($1, $2, 'active') RETURNING id`,
      [customer.company.id, NR_FIRM_ID]
    );
    const download = `/api/backups/${customerBackup.id}/download`;
    const clone = `/api/backups/${own.id}/clone-preview`;
    const target = { targetCompanyId: customer.company.id };
    expect((await staff.as.get(download)).status).toBe(200);
    expect((await staff.as.post(clone, target)).status).toBe(200);

    // An independently granted company role may still be present after a firm link ends.
    await h.sql("UPDATE firm_client_links SET status = 'revoked' WHERE id = $1", [link.id]);
    expect((await staff.as.get(download)).status).toBe(404);
    expect((await staff.as.post(clone, target)).status).toBe(404);
    expect((await customer.as.get(download)).status).toBe(200);
  });

  it("excludes firm access tables and preserves current links and grants on historical backup restore", async () => {
    const { NR_FIRM_ID } = await import("../../server/services/firm/scope");
    const { sealSnapshot } = await import("../../server/services/backup.service");
    const owner = await h.createTenant();
    const former = await h.createSecondTenant();
    const current = await h.createSecondTenant();
    const [link] = await h.sql<{ id: string }>(
      `INSERT INTO firm_client_links (company_id, firm_id, status)
       VALUES ($1, $2, 'active') RETURNING id`,
      [owner.company.id, NR_FIRM_ID]
    );
    const makeGrant = (userId: string) =>
      h.sql<{ id: string }>(
        `INSERT INTO firm_company_grants (company_id, firm_id, user_id)
       VALUES ($1, $2, $3) RETURNING id`,
        [owner.company.id, NR_FIRM_ID, userId]
      );
    const [formerGrant] = await makeGrant(former.user.id);
    const saved = await backup(owner);
    const downloaded = await owner.as.get(`/api/backups/${saved.id}/download`);
    expect(downloaded.status, downloaded.text).toBe(200);
    const snapshot = downloaded.body;
    expect(snapshot.tables).not.toHaveProperty("firm_client_links");
    expect(snapshot.tables).not.toHaveProperty("firm_company_grants");

    snapshot.tables.firm_client_links = await h.sql(
      "SELECT * FROM firm_client_links WHERE id = $1",
      [link.id]
    );
    snapshot.tables.firm_company_grants = await h.sql(
      "SELECT * FROM firm_company_grants WHERE id = $1",
      [formerGrant.id]
    );
    const old = sealSnapshot(snapshot);
    await h.sql("UPDATE backups SET data_snapshot = $2, checksum = $3 WHERE id = $1", [
      saved.id,
      old.sealed,
      old.checksum,
    ]);
    await h.sql("UPDATE firm_client_links SET status = 'revoked' WHERE id = $1", [link.id]);
    await h.sql("DELETE FROM firm_company_grants WHERE id = $1", [formerGrant.id]);
    const [currentGrant] = await makeGrant(current.user.id);

    for (const mode of ["merge", "replace"]) {
      const restored = await owner.as.post(`/api/backups/${saved.id}/restore`, {
        mode,
        confirmRestore: true,
        ...(mode === "replace" ? { confirmName: saved.name } : {}),
      });
      expect(restored.status, restored.text).toBe(200);
      expect(await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [link.id])).toEqual([
        { status: "revoked" },
      ]);
      expect(
        await h.sql("SELECT id, user_id FROM firm_company_grants WHERE company_id = $1", [
          owner.company.id,
        ])
      ).toEqual([{ id: currentGrant.id, user_id: current.user.id }]);
    }
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
    clean.tables.bank_gl_migration_findings = [{
      details: { statement_company_id: randomUUID() },
    }];
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
    expect(download.body.tables).not.toHaveProperty("bank_gl_migration_findings");
    const digest = createHash("sha256").update(download.text).digest("base64");
    expect(download.headers.get("Content-Digest")).toBe(`sha-256=:${digest}:`);
    const encrypted = await t.as.get(`/api/backups/${b.id}/download?format=encrypted`);
    expect(encrypted.status, encrypted.text).toBe(200);
    expect(encrypted.headers.get("x-backup-export-sha256")).toBe(sha256(encrypted.text));
    const exported = readSealed(encrypted.text);
    expect(exported.tables.bank_connections[0]).toMatchObject(stripped);
    expect(exported.tables).not.toHaveProperty("bank_gl_migration_findings");

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
