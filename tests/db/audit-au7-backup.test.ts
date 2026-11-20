import { describe, expect, it } from "vitest";
import { type Tenant, useHarness } from "./harness";

const h = useHarness();

async function snapshot(t: Tenant) {
  const response = await t.as.post(`/api/companies/${t.company.id}/backups`, {
    name: "AU7 accounting snapshot",
  });
  expect(response.status, response.text).toBe(201);
  return response.body as { id: string; name: string };
}

describe("AU7 accounting backup integrity", () => {
  it("merge preserves a bank transaction's invoice match made after the snapshot", async () => {
    const t = await h.createTenant();
    const [invoice] = await h.sql<{ id: string }>(
      `INSERT INTO invoices (company_id, number, customer_name, date, total)
       VALUES ($1, 'AU7-1', 'Fixture customer', now(), 120) RETURNING id`,
      [t.company.id]
    );
    const [bank] = await h.sql<{ id: string }>(
      `INSERT INTO bank_transactions (company_id, transaction_date, description, amount)
       VALUES ($1, now(), 'Fixture payment', 120) RETURNING id`,
      [t.company.id]
    );
    const backup = await snapshot(t);
    await h.sql("UPDATE bank_transactions SET matched_invoice_id = $1 WHERE id = $2", [
      invoice.id,
      bank.id,
    ]);

    const response = await t.as.post(`/api/backups/${backup.id}/restore`, {
      mode: "merge",
      confirmRestore: true,
    });
    expect(response.status, response.text).toBe(200);
    expect(response.body.totals.update).toBe(0);
    const [stored] = await h.sql("SELECT matched_invoice_id FROM bank_transactions WHERE id = $1", [
      bank.id,
    ]);
    expect(stored.matched_invoice_id).toBe(invoice.id);
  });

  it("clone refuses a target with a purchase order and preserves the order", async () => {
    const t = await h.createTenant();
    const target = await t.as.post("/api/companies", { name: "AU7 purchase order target" });
    expect([200, 201]).toContain(target.status);
    const [order] = await h.sql<{ id: string }>(
      `INSERT INTO purchase_orders (company_id, number, vendor_name, date)
       VALUES ($1, 'AU7-PO', 'Fixture vendor', now()) RETURNING id`,
      [target.body.id]
    );
    const backup = await snapshot(t);
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    const result = restoreBackupIntoCompany({
      backupId: backup.id,
      sourceCompanyId: t.company.id,
      targetCompanyId: target.body.id,
      userId: t.user.id,
      dryRun: false,
    });
    await expect.soft(result).rejects.toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY" });
    expect(await h.sql("SELECT id FROM purchase_orders WHERE id = $1", [order.id])).toHaveLength(1);
  });

  it("replace preserves data in a table introduced after the snapshot or refuses the restore", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    // Simulate a forward migration in this test file's disposable database.
    await h.sql(`CREATE TABLE au7_project_charges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies(id),
      amount numeric(15, 2) NOT NULL
    )`);
    try {
      const [charge] = await h.sql<{ id: string }>(
        "INSERT INTO au7_project_charges (company_id, amount) VALUES ($1, 125) RETURNING id",
        [t.company.id]
      );
      const response = await t.as.post(`/api/backups/${backup.id}/restore`, {
        mode: "replace",
        confirmRestore: true,
        confirmName: backup.name,
      });
      expect(response.status < 500, response.text).toBe(true);
      expect(
        await h.sql("SELECT amount::text AS amount FROM au7_project_charges WHERE id = $1", [
          charge.id,
        ])
      ).toEqual([{ amount: "125.00" }]);
    } finally {
      await h.sql("DROP TABLE au7_project_charges");
    }
  });
});
