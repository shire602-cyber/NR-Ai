import { createHash, randomBytes, randomUUID } from "node:crypto";
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

async function makeLegacy(
  backupId: string,
  change: (tables: Record<string, unknown[]>) => void = () => {}
) {
  const { openSnapshot, sealSnapshot } = await import("../../server/services/backup.service");
  const [row] = await h.sql<{ data_snapshot: string; checksum: string }>(
    "SELECT data_snapshot, checksum FROM backups WHERE id = $1",
    [backupId]
  );
  const snapshot = openSnapshot(row.data_snapshot, row.checksum).snapshot;
  if (!("tables" in snapshot)) throw new Error("Expected an accounting snapshot");
  change(snapshot.tables);
  const { sealed, checksum } = sealSnapshot({
    version: "2.0",
    companyId: snapshot.companyId,
    createdAt: snapshot.createdAt,
    tables: snapshot.tables,
  });
  await h.sql("UPDATE backups SET data_snapshot = $2, checksum = $3 WHERE id = $1", [
    backupId,
    sealed,
    checksum,
  ]);
}

function replace(t: Tenant, backup: { id: string; name: string }, key?: string) {
  return t.as.post(
    `/api/backups/${backup.id}/restore`,
    {
      mode: "replace",
      confirmRestore: true,
      confirmName: backup.name,
    },
    key ? { headers: { "Idempotency-Key": key } } : undefined
  );
}

async function seedPaymentLink(t: Tenant) {
  const token = randomBytes(24).toString("hex");
  const [invoice] = await h.sql<{ id: string }>(
    `INSERT INTO invoices (company_id, number, customer_name, date, total)
     VALUES ($1, 'AU7-LINK', 'Fixture customer', now(), 120) RETURNING id`,
    [t.company.id]
  );
  const [link] = await h.sql<{ id: string }>(
    `INSERT INTO payment_links (company_id, invoice_id, provider, token_hash, amount_fils, currency, expires_at)
     VALUES ($1, $2, 'stripe', $3, 12000, 'AED', now() + interval '1 day') RETURNING id`,
    [t.company.id, invoice.id, createHash("sha256").update(token).digest("hex")]
  );
  return { invoiceId: invoice.id, linkId: link.id, token };
}

describe("AU7 accounting backup integrity", () => {
  it("keeps a cancelled public payment link inactive when restoring a legacy snapshot", async () => {
    const t = await h.createTenant();
    const { linkId, token } = await seedPaymentLink(t);
    const backup = await snapshot(t);
    const [active] = await h.sql<{ data: unknown }>(
      "SELECT to_jsonb(l) AS data FROM payment_links l WHERE id = $1",
      [linkId]
    );
    await makeLegacy(backup.id, (tables) => {
      expect(tables).not.toHaveProperty("payment_links");
      tables.payment_links = [active.data];
    });
    const { cancelPaymentLink } = await import("../../server/services/payments");
    expect(await cancelPaymentLink(t.company.id, linkId)).toBe(true);

    const response = await replace(t, backup);
    expect(response.status, response.text).toBe(200);
    const checkout = await h.anon.get(`/api/portal/pay/${token}`);
    expect(checkout.status, checkout.text).toBe(410);
    expect(checkout.body.code).toBe("PAYMENT_LINK_INACTIVE");
    expect(await h.sql("SELECT status FROM payment_links WHERE id = $1", [linkId])).toEqual([
      { status: "cancelled" },
    ]);
  });

  it("keeps a payment gateway receipt, its link and its invoice through replace", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const { invoiceId, linkId } = await seedPaymentLink(t);
    const eventId = randomUUID();
    await h.sql(
      `INSERT INTO payment_gateway_events (provider, event_id, type, payment_link_id)
       VALUES ('stripe', $1, 'checkout.session.completed', $2)`,
      [eventId, linkId]
    );

    const response = await replace(t, backup);
    expect(response.status, response.text).toBe(200);
    expect(await h.sql("SELECT id FROM invoices WHERE id = $1", [invoiceId])).toEqual([
      { id: invoiceId },
    ]);
    expect(await h.sql("SELECT invoice_id FROM payment_links WHERE id = $1", [linkId])).toEqual([
      { invoice_id: invoiceId },
    ]);
    expect(
      await h.sql("SELECT payment_link_id FROM payment_gateway_events WHERE event_id = $1", [
        eventId,
      ])
    ).toEqual([{ payment_link_id: linkId }]);
  });

  it("keeps a payslip token and its payroll run through replace", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const [employee] = await h.sql(
      `INSERT INTO employees (company_id, full_name) VALUES ($1, 'Fixture employee') RETURNING id`,
      [t.company.id]
    );
    const [run] = await h.sql(
      `INSERT INTO payroll_runs (company_id, period_month, period_year)
       VALUES ($1, 1, 2025), ($1, 2, 2025) RETURNING id`,
      [t.company.id]
    );
    const [item] = await h.sql(
      `INSERT INTO payroll_items (payroll_run_id, employee_id) VALUES ($1, $2) RETURNING id`,
      [run.id, employee.id]
    );
    const [token] = await h.sql(
      `INSERT INTO payslip_tokens (company_id, payroll_item_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING *`,
      [t.company.id, item.id, randomUUID()]
    );

    const restored = await replace(t, backup);
    expect(restored.status, restored.text).toBe(200);
    expect(await h.sql("SELECT * FROM payslip_tokens WHERE id = $1", [token.id])).toEqual([token]);
    expect(await h.sql("SELECT id FROM payroll_items WHERE id = $1", [item.id])).toEqual([item]);
    expect(
      await h.sql("SELECT id FROM payroll_runs WHERE company_id = $1", [t.company.id])
    ).toEqual([run]);
    expect(await h.sql("SELECT id FROM employees WHERE id = $1", [employee.id])).toEqual([
      employee,
    ]);
  });

  it("rejects replace that would remove an invoice with e-invoice transmission history", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const [invoice] = await h.sql(
      `INSERT INTO invoices (company_id, number, customer_name, date, total)
       VALUES ($1, 'AU7-TRANSMITTED', 'Fixture customer', now(), 120) RETURNING id`,
      [t.company.id]
    );
    const [document] = await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, provider_message_id)
       VALUES ($1, $2, 'submitted', 'au7-transmission') RETURNING *`,
      [t.company.id, invoice.id]
    );

    for (const response of [
      await t.as.post(`/api/backups/${backup.id}/restore-preview`, { mode: "replace" }),
      await replace(t, backup),
    ]) {
      expect(response.status, response.text).toBe(409);
      expect(response.body).toMatchObject({
        code: "BACKUP_RESTORE_CONFLICT",
        details: { table: "invoices" },
      });
    }
    expect(await h.sql("SELECT id FROM invoices WHERE id = $1", [invoice.id])).toEqual([invoice]);
    expect(await h.sql("SELECT * FROM einvoice_documents WHERE id = $1", [document.id])).toEqual([
      document,
    ]);
  });

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
    await expect(result).rejects.toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY" });
    expect(await h.sql("SELECT id FROM purchase_orders WHERE id = $1", [order.id])).toHaveLength(1);
  });

  it.each([
    [
      "tax_return_archive",
      `INSERT INTO tax_return_archive (company_id, return_type, period_label, period_start, period_end, filing_date)
       VALUES ($1, 'VAT', 'Q1', '2025-01-01', '2025-03-31', '2025-04-15')`,
    ],
    [
      "einvoice_archive",
      `INSERT INTO einvoice_archive (company_id, direction, kind, document_number, xml, sha256, retain_until)
       VALUES ($1, 'outbound', 'submitted', 'ARCHIVE-1', '<Invoice/>', repeat('a', 64), '2035-01-01')`,
    ],
    [
      "einvoice_documents",
      `INSERT INTO einvoice_documents (company_id, invoice_id, status)
       VALUES ($1, gen_random_uuid(), 'submitted')`,
    ],
    [
      "einvoice_document_events",
      `INSERT INTO einvoice_document_events (company_id, invoice_id, track, to_status)
       VALUES ($1, gen_random_uuid(), 'delivery', 'submitted')`,
    ],
  ])("clone refuses a target with only seeded accounts and %s history", async (table, insert) => {
    const t = await h.createTenant();
    const target = await t.as.post("/api/companies", { name: "AU7 archive target" });
    expect([200, 201]).toContain(target.status);
    await h.sql(insert, [target.body.id]);
    const backup = await snapshot(t);
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    for (const dryRun of [true, false]) {
      await expect(
        restoreBackupIntoCompany({
          backupId: backup.id,
          sourceCompanyId: t.company.id,
          targetCompanyId: target.body.id,
          userId: t.user.id,
          dryRun,
        })
      ).rejects.toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY", details: { table, rows: 1 } });
    }
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres").each([
    ["base_currency = 'USD'", "BASE_CURRENCY_MISMATCH"],
    ["deleted_at = now()", "NOT_FOUND"],
  ])("clone checks target state after a concurrent update to %s", async (update, code) => {
    const t = await h.createTenant();
    const target = await t.as.post("/api/companies", { name: "AU7 concurrent company target" });
    expect([200, 201]).toContain(target.status);
    const backup = await snapshot(t);
    const { pool } = await import("../../server/db");
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    const writer = await pool.connect();
    let clone: Promise<unknown> | undefined;
    try {
      await writer.query("BEGIN");
      const {
        rows: [{ pid }],
      } = await writer.query<{ pid: number }>(
        `UPDATE companies SET ${update} WHERE id = $1 RETURNING pg_backend_pid() AS pid`,
        [target.body.id]
      );
      clone = restoreBackupIntoCompany({
        backupId: backup.id,
        sourceCompanyId: t.company.id,
        targetCompanyId: target.body.id,
        userId: t.user.id,
        dryRun: false,
      }).catch((error: unknown) => error);
      await expect
        .poll(
          async () => {
            const [row] = await h.sql<{ waiting: boolean }>(
              `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
             WHERE query LIKE '%FROM companies WHERE id = $1%FOR UPDATE%'
               AND $1::int = ANY(pg_blocking_pids(pid))) AS waiting`,
              [pid]
            );
            return row.waiting;
          },
          { timeout: 15000 }
        )
        .toBe(true);
      await writer.query("COMMIT");
      expect(await clone).toMatchObject({ code });
      expect(await h.sql("SELECT id FROM backups WHERE company_id = $1", [target.body.id])).toEqual(
        []
      );
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      await clone;
    }
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "waits for the first target write even in a table without a company FK",
    async () => {
      const t = await h.createTenant();
      const target = await t.as.post("/api/companies", { name: "AU7 concurrent target" });
      expect([200, 201]).toContain(target.status);
      const backup = await snapshot(t);
      await h.sql(`CREATE TABLE au7_unlinked_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL
      )`);
      const { pool } = await import("../../server/db");
      const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
      const ordinaryWriter = await pool.connect();
      let clone: Promise<unknown> | undefined;
      try {
        await ordinaryWriter.query("BEGIN");
        await ordinaryWriter.query("INSERT INTO au7_unlinked_orders (company_id) VALUES ($1)", [
          target.body.id,
        ]);
        clone = restoreBackupIntoCompany({
          backupId: backup.id,
          sourceCompanyId: t.company.id,
          targetCompanyId: target.body.id,
          userId: t.user.id,
          dryRun: false,
        }).catch((error: unknown) => error);
        await expect
          .poll(
            async () => {
              const [row] = await h.sql<{ waiting: boolean }>(`
            SELECT EXISTS (SELECT 1 FROM pg_locks WHERE relation = 'au7_unlinked_orders'::regclass
                           AND mode = 'ShareRowExclusiveLock' AND NOT granted) AS waiting
          `);
              return row.waiting;
            },
            { timeout: 15000 }
          )
          .toBe(true);
        await ordinaryWriter.query("COMMIT");
        expect(await clone).toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY" });
        expect(
          await h.sql("SELECT id FROM au7_unlinked_orders WHERE company_id = $1", [target.body.id])
        ).toHaveLength(1);
      } finally {
        await ordinaryWriter.query("ROLLBACK");
        ordinaryWriter.release();
        await clone;
        await h.sql("DROP TABLE au7_unlinked_orders");
      }
    }
  );

  it("replace preserves data in a table introduced after the snapshot", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    await makeLegacy(backup.id);
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
      const response = await replace(t, backup);
      expect(response.status, response.text).toBe(200);
      expect(
        await h.sql("SELECT amount::text AS amount FROM au7_project_charges WHERE id = $1", [
          charge.id,
        ])
      ).toEqual([{ amount: "125.00" }]);
    } finally {
      await h.sql("DROP TABLE au7_project_charges");
    }
  });

  it("uses a new column's database default on insert and retains existing values", async () => {
    const t = await h.createTenant();
    const contacts = await h.sql<{ id: string }>(
      `INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'First'), ($1, 'Second')
       RETURNING id`,
      [t.company.id]
    );
    const backup = await snapshot(t);
    await makeLegacy(backup.id);
    await h.sql(
      "ALTER TABLE customer_contacts ADD COLUMN au7_category text NOT NULL DEFAULT 'new'"
    );
    try {
      await h.sql("UPDATE customer_contacts SET au7_category = 'current' WHERE id = $1", [
        contacts[0].id,
      ]);
      await h.sql("DELETE FROM customer_contacts WHERE id = $1", [contacts[1].id]);
      const preview = await t.as.post(`/api/backups/${backup.id}/restore-preview`, {
        mode: "replace",
      });
      expect(preview.status, preview.text).toBe(200);
      const response = await replace(t, backup);
      expect(response.status, response.text).toBe(200);
      expect(
        await h.sql(
          "SELECT name, au7_category FROM customer_contacts WHERE company_id = $1 ORDER BY name",
          [t.company.id]
        )
      ).toEqual([
        { name: "First", au7_category: "current" },
        { name: "Second", au7_category: "new" },
      ]);

      await makeLegacy(backup.id, (tables) => {
        tables.customer_contacts = tables.customer_contacts.map((row) => ({
          ...(row as object),
          au7_category: null,
        }));
      });
      for (const result of [
        await t.as.post(`/api/backups/${backup.id}/restore-preview`, { mode: "replace" }),
        await replace(t, backup),
      ]) {
        expect(result.status, result.text).toBe(422);
        expect(result.body.code).toBe("BACKUP_SCHEMA_INCOMPATIBLE");
      }
    } finally {
      await h.sql("ALTER TABLE customer_contacts DROP COLUMN au7_category");
    }
  });

  it("keeps delivery receipts and live portal grants while ignoring legacy records on replace and clone", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const company = t.company.id;
    const target = await t.as.post("/api/companies", { name: "AU7 portal clone target" });
    expect([200, 201]).toContain(target.status);
    const [contact] = await h.sql<{ id: string }>(
      "INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'Live portal contact') RETURNING id",
      [company]
    );
    const [grant] = await h.sql(
      `INSERT INTO customer_portal_accounts (company_id, contact_id, user_id, revoked_at)
       VALUES ($1, $2, $3, now()) RETURNING *`,
      [company, contact.id, t.user.id]
    );
    const [invite] = await h.sql(
      `INSERT INTO customer_portal_invitations (company_id, contact_id, email, token_hash, status, expires_at)
       VALUES ($1, $2, 'au7@example.test', $3, 'revoked', now()) RETURNING *`,
      [company, contact.id, randomUUID()]
    );
    const [event] = await h.sql(
      `INSERT INTO domain_event_outbox (company_id, event_type, entity_id, payload, status)
       VALUES ($1, 'au7.fixture', $2, '{}', 'dispatched') RETURNING *`,
      [company, contact.id]
    );
    await h.sql(
      "INSERT INTO domain_event_deliveries (event_id, handler) VALUES ($1, 'au7-handler')",
      [event.id]
    );
    await makeLegacy(backup.id, (tables) => {
      tables.customer_portal_accounts = [{ ...grant, revoked_at: null }];
      tables.customer_portal_invitations = [{ ...invite, status: "pending" }];
      tables.domain_event_outbox = [{ ...event, status: "pending" }];
      tables.domain_event_deliveries = [];
    });
    const restored = await replace(t, backup);
    expect(restored.status, restored.text).toBe(200);
    expect(await h.sql("SELECT id FROM customer_contacts WHERE id = $1", [contact.id])).toEqual([
      contact,
    ]);
    expect(await h.sql("SELECT * FROM customer_portal_accounts WHERE id = $1", [grant.id])).toEqual(
      [grant]
    );
    expect(
      await h.sql("SELECT * FROM customer_portal_invitations WHERE id = $1", [invite.id])
    ).toEqual([invite]);
    expect(await h.sql("SELECT status FROM domain_event_outbox WHERE id = $1", [event.id])).toEqual(
      [{ status: "dispatched" }]
    );
    expect(
      await h.sql("SELECT handler FROM domain_event_deliveries WHERE event_id = $1", [event.id])
    ).toEqual([{ handler: "au7-handler" }]);
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    await restoreBackupIntoCompany({
      backupId: backup.id,
      sourceCompanyId: company,
      targetCompanyId: target.body.id,
      userId: t.user.id,
      dryRun: false,
    });
    for (const table of [
      "customer_portal_accounts",
      "customer_portal_invitations",
      "domain_event_outbox",
    ]) {
      expect(
        await h.sql(`SELECT id FROM ${table} WHERE company_id = $1`, [target.body.id])
      ).toEqual([]);
    }
  });

  it("preserves both legs of a group elimination and the intercompany account map on member replace", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const backup = await snapshot(t);
    const company = t.company.id;
    const [account] = await h.sql<{ id: string }>(
      "INSERT INTO accounts (company_id, code, name_en, type) VALUES ($1, 'AU7', 'AU7 account', 'asset') RETURNING id",
      [company]
    );
    const [otherAccount] = await h.sql<{ id: string }>(
      "INSERT INTO accounts (company_id, code, name_en, type) VALUES ($1, 'AU7', 'AU7 counterparty', 'liability') RETURNING id",
      [other.company.id]
    );
    const [group] = await h.sql<{ id: string }>(
      "INSERT INTO company_groups (name, parent_company_id) VALUES ('AU7 group', $1) RETURNING id",
      [other.company.id]
    );
    const [entry] = await h.sql<{ id: string }>(
      "INSERT INTO elimination_journals (group_id, date) VALUES ($1, CURRENT_DATE) RETURNING id",
      [group.id]
    );
    await h.sql(
      `INSERT INTO elimination_lines (journal_id, company_id, account_id, debit_minor, credit_minor)
       VALUES ($1, $2, $3, 12500, 0), ($1, $4, $5, 0, 12500)`,
      [entry.id, company, account.id, other.company.id, otherAccount.id]
    );
    const [map] = await h.sql<{ id: string }>(
      `INSERT INTO intercompany_account_maps (group_id, kind, company_a_id, account_a_id, company_b_id, account_b_id)
       VALUES ($1, 'receivable_payable', $2, $3, $4, $5) RETURNING id`,
      [group.id, company, account.id, other.company.id, otherAccount.id]
    );
    await makeLegacy(backup.id, (tables) => {
      tables.elimination_lines = [];
      tables.intercompany_account_maps = [];
    });
    const response = await replace(t, backup);
    expect(response.status, response.text).toBe(200);
    expect(
      await h.sql(
        `SELECT count(*)::int AS legs, sum(debit_minor - credit_minor)::text AS balance
       FROM elimination_lines WHERE journal_id = $1`,
        [entry.id]
      )
    ).toEqual([{ legs: 2, balance: "0" }]);
    expect(await h.sql("SELECT id FROM intercompany_account_maps WHERE id = $1", [map.id])).toEqual(
      [map]
    );
  });

  it("rolls back on mandatory audit failure and returns the committed receipt on retry", async () => {
    const t = await h.createTenant();
    const [contact] = await h.sql<{ id: string }>(
      "INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'Snapshot') RETURNING id",
      [t.company.id]
    );
    const backup = await snapshot(t);
    await h.sql("UPDATE customer_contacts SET name = 'Current' WHERE id = $1", [contact.id]);
    const key = randomUUID();
    await h.sql(
      "ALTER TABLE audit_logs ADD CONSTRAINT au7_reject_restore CHECK (action <> 'backup.restore') NOT VALID"
    );
    try {
      const failed = await replace(t, backup, key);
      expect(failed.status, failed.text).toBeGreaterThanOrEqual(400);
      expect(await h.sql("SELECT name FROM customer_contacts WHERE id = $1", [contact.id])).toEqual(
        [{ name: "Current" }]
      );
      expect(
        await h.sql("SELECT last_restored_at FROM backups WHERE id = $1", [backup.id])
      ).toEqual([{ last_restored_at: null }]);
      expect(
        await h.sql(
          "SELECT id FROM backups WHERE company_id = $1 AND backup_type = 'pre_restore'",
          [t.company.id]
        )
      ).toEqual([]);
    } finally {
      await h.sql("ALTER TABLE audit_logs DROP CONSTRAINT au7_reject_restore");
    }
    const completed = await replace(t, backup, key);
    expect(completed.status, completed.text).toBe(200);
    await h.sql("UPDATE customer_contacts SET name = 'After success' WHERE id = $1", [contact.id]);
    const retried = await replace(t, backup, key);
    expect(retried.status, retried.text).toBe(200);
    expect(retried.body).toEqual(completed.body);
    expect(await h.sql("SELECT name FROM customer_contacts WHERE id = $1", [contact.id])).toEqual([
      { name: "After success" },
    ]);
    expect(
      await h.sql(
        "SELECT id FROM audit_logs WHERE action = 'backup.restore' AND resource_id = $1",
        [backup.id]
      )
    ).toHaveLength(1);
  });
});
