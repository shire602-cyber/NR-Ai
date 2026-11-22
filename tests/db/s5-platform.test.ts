/**
 * S5 final sweep (commercial, platform and accounts residuals of W5-A / W5-B):
 *   - plan gates fail closed: every company has a Free subscription row (trigger + backfill)
 *   - a backup can be loaded into a different, empty company (clone / template)
 *   - the import wizard takes foreign-currency open invoices / bills (rate at document date)
 *   - report delivery artifacts go to object storage when it is configured
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

let restoreTime: (() => void) | null = null;
const originalFlag = process.env.BILLING_ENFORCEMENT;
afterEach(async () => {
  restoreTime?.();
  restoreTime = null;
  if (originalFlag === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = originalFlag;
  const { __setObjectStoreForTests } = await import("../../server/services/fileStorage");
  __setObjectStoreForTests(null);
});

function codeAt(secret: string, base: number, steps: number): string {
  restoreTime?.();
  const at = base + steps * 30_000;
  restoreTime = freezeTime(at);
  return generateSync({ secret, epoch: Math.floor(at / 1000) });
}

/** Enrol MFA and return a client whose token carries a fresh step-up. */
async function freshMfaClient(t: Tenant) {
  const base = Date.now();
  const start = await t.as.post("/api/auth/mfa/enroll", {});
  expect(start.status, start.text).toBe(200);
  const secret = start.body.secret as string;
  const confirm = await t.as.post("/api/auth/mfa/enroll/confirm", {
    code: codeAt(secret, base, 0),
  });
  expect(confirm.status, confirm.text).toBe(200);
  const stepUp = await t.as.post("/api/auth/mfa/step-up", { code: codeAt(secret, base, 1) });
  expect(stepUp.status, stepUp.text).toBe(200);
  return h.client(stepUp.body.token);
}

describe("S5 plan gates fail closed (W5-B FAIL-OPEN)", () => {
  it("[S5-1] every new company has exactly one Free subscription row, however it was created", async () => {
    const t = await h.createTenant();
    const own = await h.sql(`SELECT plan_id FROM subscriptions WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(own).toEqual([{ plan_id: "free" }]);

    const second = await t.as.post("/api/companies", { name: `Second Co ${Date.now()}` });
    expect([200, 201]).toContain(second.status);
    const viaApi = await h.sql(`SELECT plan_id FROM subscriptions WHERE company_id = $1`, [
      second.body.id,
    ]);
    expect(viaApi).toEqual([{ plan_id: "free" }]);

    const [raw] = await h.sql<{ id: string }>(
      `INSERT INTO companies (name, base_currency, locale) VALUES ('Raw SQL Co', 'AED', 'en') RETURNING id`
    );
    const viaSql = await h.sql(
      `SELECT plan_id, plan_name, status FROM subscriptions WHERE company_id = $1`,
      [raw.id]
    );
    expect(viaSql).toEqual([{ plan_id: "free", plan_name: "Free", status: "active" }]);
  });

  it("[S5-1] the 0113 backfill gives an existing company without a row the Free plan (idempotent)", async () => {
    const t = await h.createTenant();
    await h.sql(`DELETE FROM subscriptions WHERE company_id = $1`, [t.company.id]);
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "..", "migrations", "0113_s5_platform.sql"),
      "utf8"
    );
    await h.sql(sql);
    await h.sql(sql);
    const rows = await h.sql(`SELECT plan_id FROM subscriptions WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(rows).toEqual([{ plan_id: "free" }]);
  });

  it("[S5-1] with enforcement on, a company with NO subscription row is never upgraded: its trial runs from its creation, then workspace access is refused", async () => {
    process.env.BILLING_ENFORCEMENT = "true";
    const t = await h.createTenant();
    await h.sql(`DELETE FROM subscriptions WHERE company_id = $1`, [t.company.id]);
    // WQ7: within the company's first 14 days it is on the trial (every module open).
    const inTrial = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {});
    expect([402, 403]).not.toContain(inTrial.status);
    await h.sql(`UPDATE companies SET created_at = now() - interval '30 days' WHERE id = $1`, [
      t.company.id,
    ]);
    const central = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {});
    expect(central.status, central.text).toBe(402);
    expect(central.body).toMatchObject({ code: "PLAN_REQUIRED", currentTier: null });
    // Reads are refused too.
    const read = await t.as.get(`/api/companies/${t.company.id}/fixed-assets`);
    expect(read.status, read.text).toBe(402);

    const pro = await h.createTenant({ planId: "professional" });
    const ok = await pro.as.post(`/api/companies/${pro.company.id}/fixed-assets`, {});
    expect([402, 403]).not.toContain(ok.status);
  });

  it("[S5-1] route-level requireFeature also fails closed for a company without a row", async () => {
    process.env.BILLING_ENFORCEMENT = "true";
    const { requireFeature } = await import("../../server/middleware/featureGate");
    const t = await h.createTenant();
    await h.sql(`DELETE FROM subscriptions WHERE company_id = $1`, [t.company.id]);
    await h.sql(`UPDATE companies SET created_at = now() - interval '30 days' WHERE id = $1`, [
      t.company.id,
    ]);
    let status = 0;
    let body: any = null;
    let passed = false;
    const res = {
      status(s: number) {
        status = s;
        return this;
      },
      json(b: unknown) {
        body = b;
        return this;
      },
    };
    await requireFeature("quotes")(
      {
        method: "POST",
        headers: {},
        user: { id: t.user.id, isAdmin: false },
        params: { companyId: t.company.id },
        body: {},
      } as never,
      res as never,
      () => {
        passed = true;
      }
    );
    expect(passed).toBe(false);
    expect(status).toBe(402);
    expect(body).toMatchObject({ code: "PLAN_REQUIRED", feature: "quotes" });

    // NR-managed client books are firm-billed: an explicit, documented exemption.
    await h.sql(`UPDATE companies SET company_type = 'client' WHERE id = $1`, [t.company.id]);
    passed = false;
    await requireFeature("quotes")(
      {
        method: "POST",
        headers: {},
        user: { id: t.user.id, isAdmin: false },
        params: { companyId: t.company.id },
        body: {},
      } as never,
      res as never,
      () => {
        passed = true;
      }
    );
    expect(passed).toBe(true);
  });
});

async function seedBooks(t: Tenant) {
  const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Clone Contact LLC",
  });
  expect([200, 201]).toContain(contact.status);
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Clone Customer",
    contactId: contact.body.id,
    date: today(),
    lines: [{ description: "Template line", quantity: 2, unitPrice: 150, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  return { invoiceId: inv.body.id as string, contactId: contact.body.id as string };
}

describe("S5 backup restore into a different company (W5-B, R19-17)", () => {
  it("keeps target webhook settings, messaging credentials and firm grants when cloning", async () => {
    const t = await h.createTenant();
    const staff = await h.createSecondTenant();
    const { NR_FIRM_ID } = await import("../../server/services/firm/scope");
    const target = await t.as.post("/api/companies", { name: "Target integration settings" });
    expect([200, 201]).toContain(target.status);
    const targetId = target.body.id as string;
    await seedBooks(t);
    for (const [companyId, label] of [
      [t.company.id, "source"],
      [targetId, "target"],
    ]) {
      await h.sql(
        `INSERT INTO webhook_endpoints (company_id, url, secret, events, is_active)
         VALUES ($1, $2, $3, 'invoice.issued', false)`,
        [companyId, `https://${label}.example.test/webhook`, `${label}-signing`]
      );
      await h.sql(
        `INSERT INTO whatsapp_configs (
           company_id, phone_number_id, access_token, webhook_verify_token, is_active
         ) VALUES ($1, $2, $3, $4, false)`,
        [companyId, `${label}-phone`, `${label}-access`, `${label}-verify`]
      );
    }
    const [link] = await h.sql<{ id: string }>(
      `INSERT INTO firm_client_links (company_id, firm_id, status)
       VALUES ($1, $2, 'active') RETURNING id`,
      [targetId, NR_FIRM_ID]
    );
    const [grant] = await h.sql<{ id: string }>(
      `INSERT INTO firm_company_grants (company_id, firm_id, user_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [targetId, NR_FIRM_ID, staff.user.id]
    );
    for (const [companyId, recipient] of [
      [t.company.id, "source@example.test"],
      [targetId, "target@example.test"],
    ]) {
      await h.sql(
        `INSERT INTO company_report_delivery_subscriptions
           (company_id, subscription_id, enabled, recipients_override)
         VALUES ($1, 'clone-fixture', true, $2)`,
        [companyId, recipient]
      );
    }
    const tables = [
      "webhook_endpoints",
      "whatsapp_configs",
      "firm_client_links",
      "firm_company_grants",
      "company_report_delivery_subscriptions",
    ];
    const targetState = () =>
      Promise.all(
        tables.map((table) => h.sql(`SELECT * FROM ${table} WHERE company_id = $1`, [targetId]))
      );
    const before = await targetState();
    expect(before[2]).toMatchObject([{ id: link.id, status: "active" }]);
    expect(before[3]).toMatchObject([{ id: grant.id, user_id: staff.user.id }]);
    const backup = await t.as.post(`/api/companies/${t.company.id}/backups`, {
      name: "Source settings",
    });
    expect(backup.status, backup.text).toBe(201);
    const fresh = await freshMfaClient(t);
    const clone = await fresh.post(`/api/backups/${backup.body.id}/clone`, {
      targetCompanyId: targetId,
      confirmRestore: true,
      confirmTargetName: target.body.name,
    });
    expect(clone.status, clone.text).toBe(200);
    expect(clone.body.skippedTables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "webhook_endpoints", rows: 1 }),
        expect.objectContaining({ table: "whatsapp_configs", rows: 1 }),
      ])
    );
    expect(await targetState()).toEqual(before);
  });

  it.each([
    ["quotes", "customer_name"],
    ["purchase_orders", "vendor_name"],
  ] as const)(
    "rejects a target containing only a row in %s in preview and apply",
    async (table, nameColumn) => {
      const t = await h.createTenant();
      const backup = await t.as.post(`/api/companies/${t.company.id}/backups`, { name: "Source" });
      expect(backup.status, backup.text).toBe(201);
      const target = await t.as.post("/api/companies", { name: "Target with a draft" });
      expect([200, 201]).toContain(target.status);
      const targetCompanyId = target.body.id;
      const [document] = await h.sql(
        `INSERT INTO ${table} (company_id, number, ${nameColumn}, date)
       VALUES ($1, 'DRAFT-1', 'Counterparty', now()) RETURNING id`,
        [targetCompanyId]
      );
      const fresh = await freshMfaClient(t);
      const path = `/api/backups/${backup.body.id}/clone`;
      const preview = await fresh.post(`${path}-preview`, { targetCompanyId });
      const apply = await fresh.post(path, {
        targetCompanyId,
        confirmRestore: true,
        confirmTargetName: target.body.name,
      });
      for (const result of [preview, apply]) {
        expect(result.status, result.text).toBe(409);
        expect(result.body.code).toBe("CLONE_TARGET_NOT_EMPTY");
      }
      expect(
        await h.sql(`SELECT id FROM ${table} WHERE company_id = $1`, [targetCompanyId])
      ).toEqual([document]);
    }
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "blocks ordinary invoice writes while a clone checks and replaces the target",
    async () => {
      const t = await h.createTenant();
      const backup = await t.as.post(`/api/companies/${t.company.id}/backups`, { name: "Source" });
      expect(backup.status, backup.text).toBe(201);
      const target = await t.as.post("/api/companies", { name: "Target with concurrent invoice" });
      expect([200, 201]).toContain(target.status);
      const targetCompanyId = target.body.id;
      const fresh = await freshMfaClient(t);
      const { pool } = await import("../../server/db");
      const blocker = await pool.connect();
      const waiting = async (condition: string) => {
        const [row] = await h.sql<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_locks
             WHERE NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
               AND ${condition}
           ) AS waiting`
        );
        return row.waiting;
      };
      let clone;
      let invoice;
      let earlyResponse: string | undefined;
      try {
        await blocker.query("BEGIN");
        // Pause the clone after its emptiness check, at the safety snapshot insert.
        await blocker.query("LOCK TABLE backups IN SHARE MODE");
        clone = fresh.post(`/api/backups/${backup.body.id}/clone`, {
          targetCompanyId,
          confirmRestore: true,
          confirmTargetName: target.body.name,
        });
        await expect
          .poll(() => waiting("relation = 'backups'::regclass AND mode = 'RowExclusiveLock'"))
          .toBe(true);
        invoice = fresh
          .post(`/api/companies/${targetCompanyId}/invoices`, {
            customerName: "Concurrent customer",
            date: today(),
            lines: [
              {
                description: "Service",
                quantity: 1,
                unitPrice: 150,
                vatRate: 0,
                vatSupplyType: "out_of_scope",
              },
            ],
          })
          .then((response) => {
            earlyResponse = `${response.status} ${response.text}`;
            return response;
          });
        await expect
          .poll(
            async () => {
              expect(earlyResponse).toBeUndefined();
              return waiting("relation <> 'backups'::regclass AND mode = 'RowExclusiveLock'");
            },
            { timeout: 12000 }
          )
          .toBe(true);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.allSettled([clone, invoice]);
      }
      const [cloned, created] = await Promise.all([clone!, invoice!]);
      expect(cloned.status, cloned.text).toBe(200);
      expect(created.status, created.text).toBe(200);
      expect(
        await h.sql("SELECT id FROM invoices WHERE company_id = $1", [targetCompanyId])
      ).toEqual([{ id: created.body.id }]);
    }
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "checks whether the target is empty while holding its lock for concurrent clones",
    async () => {
      const t = await h.createTenant();
      await seedBooks(t);
      const backup = await t.as.post(`/api/companies/${t.company.id}/backups`, {
        name: "Concurrent source",
      });
      expect(backup.status, backup.text).toBe(201);
      const target = await t.as.post("/api/companies", { name: "Concurrent clone target" });
      expect([200, 201]).toContain(target.status);
      const targetId = target.body.id as string;
      const fresh = await freshMfaClient(t);
      const { pool } = await import("../../server/db");
      const blocker = await pool.connect();
      const clone = () =>
        fresh.post(`/api/backups/${backup.body.id}/clone`, {
          targetCompanyId: targetId,
          confirmRestore: true,
          confirmTargetName: target.body.name,
        });
      let pending: ReturnType<typeof clone>[] = [];
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `backup-restore:${targetId}`,
        ]);
        pending = [clone(), clone()];
        // Both requests must reach the target lock before either can change the target.
        await expect
          .poll(
            async () => {
              const [locks] = await h.sql<{ count: number }>(
                `SELECT count(*)::int AS count FROM pg_locks
             WHERE locktype = 'advisory' AND NOT granted
               AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`
              );
              return locks.count;
            },
            { timeout: 15000 }
          )
          .toBe(2);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const results = await Promise.all(pending);
      expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(results.find(({ status }) => status === 409)?.body.code).toBe(
        "CLONE_TARGET_NOT_EMPTY"
      );
      expect(
        await h.sql(
          "SELECT count(*)::int AS count FROM backups WHERE company_id = $1 AND backup_type = 'pre_restore'",
          [targetId]
        )
      ).toEqual([{ count: 1 }]);
    }
  );

  it("[S5-2] loads a backup into a new empty company with fresh ids; the source is untouched; audited in both", async () => {
    const t = await h.createTenant();
    const { invoiceId } = await seedBooks(t);
    const b = await t.as.post(`/api/companies/${t.company.id}/backups`, { name: "Template A" });
    expect(b.status, b.text).toBe(201);
    const targetName = `Clone Target ${Date.now()}`;
    const target = await t.as.post("/api/companies", { name: targetName });
    expect([200, 201]).toContain(target.status);
    const targetId = target.body.id as string;

    const preview = await t.as.post(`/api/backups/${b.body.id}/clone-preview`, {
      targetCompanyId: targetId,
    });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.dryRun).toBe(true);
    expect(preview.body.tables.find((x: { table: string }) => x.table === "invoices")).toEqual({
      table: "invoices",
      rows: 1,
    });
    expect(
      (await h.sql(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [targetId]))[0]
        .n
    ).toBe(0);

    // Without MFA the clone is refused even for the owner of both companies.
    const noMfa = await t.as.post(`/api/backups/${b.body.id}/clone`, {
      targetCompanyId: targetId,
      confirmRestore: true,
      confirmTargetName: targetName,
    });
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.code).toBe("MFA_ENROLLMENT_REQUIRED");

    const fresh = await freshMfaClient(t);
    const wrongName = await fresh.post(`/api/backups/${b.body.id}/clone`, {
      targetCompanyId: targetId,
      confirmRestore: true,
      confirmTargetName: "nope",
    });
    expect(wrongName.status).toBe(400);

    const clone = await fresh.post(`/api/backups/${b.body.id}/clone`, {
      targetCompanyId: targetId,
      confirmRestore: true,
      confirmTargetName: targetName,
    });
    expect(clone.status, clone.text).toBe(200);
    expect(clone.body.preRestoreBackupId).toBeTruthy();

    const src = await h.sql(
      `SELECT id, number, total::text AS total FROM invoices WHERE company_id = $1`,
      [t.company.id]
    );
    const dst = await h.sql<{ id: string; number: string; total: string; contact_id: string }>(
      `SELECT id, number, total::text AS total, contact_id FROM invoices WHERE company_id = $1`,
      [targetId]
    );
    expect(dst).toHaveLength(1);
    expect(dst[0].id).not.toBe(invoiceId);
    expect(dst[0]).toMatchObject({ number: src[0].number, total: src[0].total });
    // FKs point at the target's own rows.
    const [contact] = await h.sql(`SELECT company_id FROM customer_contacts WHERE id = $1`, [
      dst[0].contact_id,
    ]);
    expect(contact.company_id).toBe(targetId);
    const lines = await h.sql(
      `SELECT il.id FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id WHERE i.company_id = $1`,
      [targetId]
    );
    expect(lines.length).toBe(1);
    const ledger = await h.sql<{ d: string; c: string; n: number }>(
      `SELECT COALESCE(SUM(jl.debit),0)::text AS d, COALESCE(SUM(jl.credit),0)::text AS c,
              count(DISTINCT je.id)::int AS n
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND a.company_id = $1`,
      [targetId]
    );
    expect(ledger[0].n).toBeGreaterThan(0);
    expect(ledger[0].d).toBe(ledger[0].c);
    // Every journal line of the target uses the target's accounts.
    const foreign = await h.sql(
      `SELECT count(*)::int AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND a.company_id <> $1`,
      [targetId]
    );
    expect(foreign[0].n).toBe(0);
    // Source untouched.
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [t.company.id])
      )[0].n
    ).toBe(1);
    const audits = await h.sql<{ company_id: string }>(
      `SELECT company_id FROM audit_logs WHERE action = 'backup.clone' AND resource_id = $1`,
      [b.body.id]
    );
    expect(audits.map((a) => a.company_id).sort()).toEqual([t.company.id, targetId].sort());

    // A company with activity is not a clone target (now the target itself).
    const again = await fresh.post(`/api/backups/${b.body.id}/clone-preview`, {
      targetCompanyId: targetId,
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("CLONE_TARGET_NOT_EMPTY");
  });

  it("[S5-2] another tenant's company is not a target (404) and the source cannot be its own target", async () => {
    const t = await h.createTenant();
    await seedBooks(t);
    const b = await t.as.post(`/api/companies/${t.company.id}/backups`, { name: "Template B" });
    expect(b.status).toBe(201);
    const other = await h.createSecondTenant();
    const cross = await t.as.post(`/api/backups/${b.body.id}/clone-preview`, {
      targetCompanyId: other.company.id,
    });
    expect(cross.status).toBe(404);
    const self = await t.as.post(`/api/backups/${b.body.id}/clone-preview`, {
      targetCompanyId: t.company.id,
    });
    expect(self.status).toBe(422);
    expect(self.body.code).toBe("CLONE_TARGET_IS_SOURCE");
    // The other tenant cannot load t's backup anywhere.
    const steal = await other.as.post(`/api/backups/${b.body.id}/clone-preview`, {
      targetCompanyId: other.company.id,
    });
    expect(steal.status).toBe(404);
  });
});

async function runImport(t: Tenant, body: Record<string, unknown>) {
  const p = await t.as.post(`/api/companies/${t.company.id}/imports/preview`, body);
  expect(p.status, p.text).toBe(201);
  const v = await t.as.post(`/api/companies/${t.company.id}/imports/${p.body.id}/validate`);
  expect(v.status, v.text).toBe(200);
  return { id: p.body.id as string, validated: v.body };
}

async function accountId(t: Tenant, code: string): Promise<string> {
  const [a] = await h.sql<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2`,
    [t.company.id, code]
  );
  return a.id;
}

async function fxBalance(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ net: string }>(
    `SELECT (COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0))::text AS net
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0]?.net ?? 0);
}

describe("S5 import wizard: foreign-currency open documents (W5-B)", () => {
  const CUT_OVER = "2025-12-31";

  it("[S5-3] a USD open invoice imports at the document-date rate and settles with realised FX", async () => {
    const t = await h.createTenant();
    const rate = await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
      fromCurrency: "USD",
      rate: 3.6725,
      effectiveDate: "2025-12-01",
    });
    expect([200, 201], rate.text).toContain(rate.status);
    const csv = [
      "ContactName,InvoiceNumber,InvoiceDate,DueDate,Total,AmountDue,Currency",
      "Boston Client Inc,USD-001,02/12/2025,01/01/2026,1000.00,1000.00,USD",
      "Gulf Retail LLC,AED-001,05/12/2025,04/01/2026,500.00,500.00,AED",
    ].join("\n");
    const imp = await runImport(t, {
      kind: "open_invoices",
      sourceSystem: "xero",
      csv,
      cutOverDate: CUT_OVER,
    });
    expect(imp.validated.status, JSON.stringify(imp.validated.issues)).toBe("validated");
    expect(imp.validated.summary.controlTotalFils).toBe(367250 + 50000);
    const c = await t.as.post(`/api/companies/${t.company.id}/imports/${imp.id}/commit`);
    expect(c.status, c.text).toBe(200);
    expect(c.body.result).toMatchObject({ documentsCreated: 2, controlTotalFils: 417250 });

    const [usd] = await h.sql(
      `SELECT id, currency, exchange_rate::text AS rate, total::text AS total,
              base_currency_amount::text AS base FROM invoices WHERE company_id = $1 AND number = 'USD-001'`,
      [t.company.id]
    );
    expect(usd).toMatchObject({
      currency: "USD",
      rate: "3.672500",
      total: "1000.00",
      base: "3672.50",
    });
    expect(await fxBalance(t, "1040")).toBe(4172.5);
    const [line] = await h.sql(
      `SELECT jl.foreign_currency, jl.foreign_debit::text AS fd FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1 AND je.source_id = $2 AND jl.debit > 0`,
      [t.company.id, usd.id]
    );
    expect(line).toMatchObject({ foreign_currency: "USD", fd: "1000.00" });

    // Settled later at 3.70: realised FX gain of 27.50 AED.
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${usd.id}/payments`, {
      amount: 1000,
      date: today(),
      paymentAccountId: await accountId(t, "1020"),
      exchangeRate: 3.7,
    });
    expect(pay.status, pay.text).toBe(201);
    expect(await fxBalance(t, "1040")).toBe(500);
    expect(await fxBalance(t, "4090")).toBe(-27.5);
  });

  it("[S5-3] a EUR open bill uses the file's rate column; a currency without any rate is refused", async () => {
    const t = await h.createTenant();
    const csv = [
      "Date,Num,Vendor,Due Date,Amount,Open Balance,Currency,Exchange Rate",
      "12/01/2025,EU-77,Berlin GmbH,12/31/2025,200.00,200.00,EUR,4.000000",
    ].join("\n");
    const imp = await runImport(t, {
      kind: "open_bills",
      sourceSystem: "quickbooks",
      csv,
      cutOverDate: CUT_OVER,
    });
    expect(imp.validated.status, JSON.stringify(imp.validated.issues)).toBe("validated");
    const c = await t.as.post(`/api/companies/${t.company.id}/imports/${imp.id}/commit`);
    expect(c.status, c.text).toBe(200);
    expect(c.body.result).toMatchObject({ documentsCreated: 1, controlTotalFils: 80000 });
    const [bill] = await h.sql(
      `SELECT id, currency, exchange_rate::text AS rate, total_amount::text AS total FROM vendor_bills
        WHERE company_id = $1 AND origin_ref = 'EU-77'`,
      [t.company.id]
    );
    expect(bill).toMatchObject({ currency: "EUR", rate: "4.000000", total: "200.00" });
    expect(await fxBalance(t, "2010")).toBe(-800);
    // Paid at 3.9: realised gain 20.00 AED.
    const pay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: today(),
      amount: 200,
      exchange_rate: 3.9,
    });
    expect(pay.status, pay.text).toBe(200);
    expect(await fxBalance(t, "2010")).toBe(0);
    expect(await fxBalance(t, "4090")).toBe(-20);

    const missing = await runImport(t, {
      kind: "open_bills",
      sourceSystem: "quickbooks",
      csv: [
        "Date,Num,Vendor,Due Date,Amount,Open Balance,Currency",
        "12/01/2025,JP-1,Tokyo KK,12/31/2025,1000.00,1000.00,JPY",
      ].join("\n"),
      cutOverDate: CUT_OVER,
    });
    expect(missing.validated.status).toBe("previewed");
    expect(missing.validated.issues.map((i: { code: string }) => i.code)).toContain(
      "V_NO_EXCHANGE_RATE"
    );
  });
});

describe("S5 report delivery artifacts in object storage (W5-A)", () => {
  it("[S5-4] with object storage configured the bytes go to the bucket, the row keeps only the key, download works", async () => {
    const { __setObjectStoreForTests } = await import("../../server/services/fileStorage");
    const bucket = new Map<string, { buffer: Buffer; contentType: string }>();
    __setObjectStoreForTests({
      put: async (key, buffer, contentType) => {
        bucket.set(key, { buffer, contentType });
        return key;
      },
      get: async (key) => bucket.get(key) ?? null,
      del: async (key) => {
        bucket.delete(key);
      },
    });
    const t = await h.createTenant();
    const r = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`,
      {}
    );
    expect(r.status, r.text).toBe(201);
    const rows = await h.sql<{ id: string; storage_key: string | null; has_content: boolean }>(
      `SELECT id, storage_key, content IS NOT NULL AS has_content
         FROM company_report_delivery_artifacts WHERE run_id = $1 ORDER BY kind`,
      [r.body.run.id]
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.has_content).toBe(false);
      expect(row.storage_key).toMatch(/^report-artifacts\//);
      expect(bucket.has(row.storage_key!)).toBe(true);
    }
    const dl = await t.as.get(
      `/api/companies/${t.company.id}/report-delivery/runs/${r.body.run.id}/artifacts/${rows[0].id}`
    );
    expect(dl.status).toBe(200);
    expect(Number(dl.headers.get("content-length") ?? dl.text.length)).toBeGreaterThan(1000);

    // A tampered object is refused rather than served.
    const key = rows[0].storage_key!;
    bucket.set(key, { buffer: Buffer.from("tampered"), contentType: "application/pdf" });
    const bad = await t.as.get(
      `/api/companies/${t.company.id}/report-delivery/runs/${r.body.run.id}/artifacts/${rows[0].id}`
    );
    expect(bad.status).toBe(409);
  });

  it("[S5-4] without object storage (dev/test) the bytes stay in the database", async () => {
    const t = await h.createTenant();
    const r = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`,
      {}
    );
    expect(r.status, r.text).toBe(201);
    const rows = await h.sql(
      `SELECT storage_key, content IS NOT NULL AS has_content FROM company_report_delivery_artifacts WHERE run_id = $1`,
      [r.body.run.id]
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.storage_key === null && x.has_content === true)).toBe(true);
  });
});
