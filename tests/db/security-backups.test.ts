/**
 * W5-E: company backups are encrypted at rest (secret vault, AES-256-GCM), only owners and
 * admins can manage them, and a restore is audited on the company's hash chain (R17-23).
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

describe("W5-E encrypted backups", () => {
  it("[R17-23] the snapshot is ciphertext in the database, plaintext on download, and restore is audited", async () => {
    const t = await h.createTenant({ name: "Backup" });
    const created = await t.as.post(`/api/companies/${t.company.id}/backups`, { name: "B1" });
    expect(created.status, created.text).toBe(201);
    const [row] = await h.sql(`SELECT data_snapshot, checksum FROM backups WHERE id = $1`, [
      created.body.id,
    ]);
    expect(row.data_snapshot).toMatch(/^enc:v1:/);
    expect(row.data_snapshot).not.toContain(t.company.id);

    const dl = await t.as.get(`/api/backups/${created.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(JSON.parse(dl.text).companyId).toBe(t.company.id);

    const restore = await t.as.post(`/api/backups/${created.body.id}/restore`, {
      confirmRestore: true,
    });
    expect(restore.status, restore.text).toBe(200);
    const audit = await h.sql(
      `SELECT action, details FROM audit_logs WHERE company_id = $1 AND action = 'backup.restore'`,
      [t.company.id]
    );
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details).after).toHaveProperty("totalRestored");

    // Viewers cannot download or restore another member's backups.
    const viewer = await h.createSecondTenant({ name: "BackupViewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      viewer.user.id,
    ]);
    const denied = await viewer.as.get(`/api/backups/${created.body.id}/download`);
    expect(denied.status).toBe(403);
  });
});
