import { expect, it, vi } from "vitest";
import { freezeTime, useHarness } from "./harness";

const h = useHarness();
const date = "2026-06-30";
const lines = [{ description: "Subscription", quantity: 1, unitPrice: 100, vatRate: 5 }];

async function assertNoNumberAllocated(companyId: string) {
  const [row] = await h.sql<{ invoices: number; series: number }>(
    `SELECT
        (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1) AS invoices,
        (SELECT COUNT(*)::int FROM invoice_number_sequences WHERE company_id = $1) AS series`,
    [companyId]
  );
  expect(row).toEqual({ invoices: 0, series: 0 });
}

it("refuses a public API draft dated in a closed fiscal year without consuming a number", async () => {
  const tenant = await h.createTenant({ name: "Public draft period", planId: "enterprise" });
  const companyId = tenant.company.id;
  const key = await tenant.as.post(`/api/companies/${companyId}/api-keys`, {
    name: "Test invoice writer",
    scopes: ["write:invoices"],
  });
  expect(key.status).toBe(201);
  const { closeFiscalYear } = await import("../../server/services/month-end.service");
  await closeFiscalYear(companyId, "2025-12-31", tenant.user.id, { hardClose: true });

  const postDraft = (invoiceDate: string) =>
    h.anon.post(
      "/api/v1/invoices",
      { customerName: "Test customer", date: invoiceDate, lines },
      {
        token: null,
        headers: { Authorization: `ApiKey ${key.body.key}` },
      }
    );
  const refused = await postDraft("2025-12-15");
  expect(refused.status, refused.text).toBe(403);
  expect(refused.body.code).toBe("PERIOD_LOCKED");
  await assertNoNumberAllocated(companyId);

  const accepted = await postDraft("2026-01-15");
  expect(accepted.status, accepted.text).toBe(201);
  expect(accepted.body).toMatchObject({ status: "draft", number: "INV-2026-00001" });
});

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "a recurring draft waits for an in-flight monthly lock and retries without skipping a number",
  async () => {
    const tenant = await h.createTenant({ name: "Recurring draft period", planId: "enterprise" });
    const companyId = tenant.company.id;
    const template = await tenant.as.post(`/api/companies/${companyId}/recurring-invoices`, {
      customerName: "Test customer",
      startDate: "2026-06-01",
      frequency: "monthly",
      autoIssue: false,
      autoSend: false,
      lines,
    });
    expect(template.status, template.text).toBe(200);
    const { withLedgerTx } = await import("../../server/ledger/tx");
    const { lockPeriod, unlockPeriod } = await import("../../server/services/month-end.service");
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    const inserted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const restoreTime = freezeTime(`${date}T12:00:00Z`);
    let generating: Promise<number> | undefined;
    const closing = withLedgerTx(async (tx) => {
      await lockPeriod(companyId, date, tenant.user.id, { lockScope: "month" }, tx);
      inserted.resolve();
      await release.promise;
    });
    try {
      await Promise.race([inserted.promise, closing]);
      let completed = false;
      generating = generateDueRecurringInvoices().finally(() => {
        completed = true;
      });
      await vi.waitFor(
        async () => {
          const [row] = await h.sql<{ waiting: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
             WHERE locktype = 'advisory' AND mode = 'ShareLock' AND NOT granted
               AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          ) AS waiting`);
          expect(row.waiting || completed).toBe(true);
        },
        { timeout: 6000 }
      );
      release.resolve();
      await closing;
      await generating;
      await assertNoNumberAllocated(companyId);
      const [retry] = await h.sql<{
        next_run: string;
        last_run_status: string;
        total_generated: number;
      }>(
        "SELECT next_run_date::date::text AS next_run, last_run_status, total_generated FROM recurring_invoices WHERE id = $1",
        [template.body.id]
      );
      expect(retry).toEqual({
        next_run: "2026-06-01",
        last_run_status: "period_locked",
        total_generated: 0,
      });

      await unlockPeriod(companyId, date);
      expect(await generateDueRecurringInvoices()).toBe(1);
      const invoices = await h.sql("SELECT number, status FROM invoices WHERE company_id = $1", [
        companyId,
      ]);
      expect(invoices).toEqual([{ number: "INV-2026-00001", status: "draft" }]);
    } finally {
      release.resolve();
      try {
        await Promise.allSettled([closing, generating]);
        await h.sql("UPDATE recurring_invoices SET is_active = false WHERE id = $1", [
          template.body.id,
        ]);
      } finally {
        restoreTime();
      }
    }
  }
);

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "a hard monthly close waits for a numbered recurring draft and then sees it in the checklist",
  async () => {
    const tenant = await h.createTenant({
      name: "Recurring writer first",
      planId: "enterprise",
      vatRegistered: false,
      companyColumns: { tax_registration_type: "Non-registered" },
    });
    const companyId = tenant.company.id;
    const template = await tenant.as.post(`/api/companies/${companyId}/recurring-invoices`, {
      customerName: "Test customer",
      startDate: "2026-06-01",
      frequency: "monthly",
      autoIssue: false,
      autoSend: false,
      lines: [{ ...lines[0], vatRate: 0, vatSupplyType: "out_of_scope" }],
    });
    expect(template.status, template.text).toBe(200);
    const { pool } = await import("../../server/db");
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    const blocker = await pool.connect();
    const restoreTime = freezeTime(`${date}T12:00:00Z`);
    let generating: Promise<number> | undefined;
    let closing: ReturnType<typeof tenant.as.post> | undefined;
    try {
      await blocker.query("BEGIN");
      // Pause the scheduler on its line insert, after it allocated the number and wrote the draft.
      await blocker.query("LOCK TABLE invoice_lines IN SHARE MODE");
      generating = generateDueRecurringInvoices();
      await vi.waitFor(
        async () => {
          const [state] = await h.sql<{ waiting: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks WHERE locktype = 'relation'
              AND relation = 'invoice_lines'::regclass AND mode = 'RowExclusiveLock' AND NOT granted
          ) AS waiting`);
          expect(state.waiting).toBe(true);
        },
        { timeout: 6000 }
      );

      let closed = false;
      closing = tenant.as
        .post(`/api/companies/${companyId}/month-end/lock-period`, {
          periodEnd: date,
          lockType: "hard",
          lockScope: "month",
        })
        .finally(() => {
          closed = true;
        });
      await vi.waitFor(
        async () => {
          const [state] = await h.sql<{ waiting: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event = 'advisory'
               AND query LIKE '%ledger-period:%' AND pid <> pg_backend_pid()
          ) AS waiting`);
          expect(state.waiting || closed).toBe(true);
        },
        { timeout: 6000 }
      );
      expect(closed).toBe(false);
      await blocker.query("COMMIT");
      expect(await generating).toBe(1);

      const response = await closing;
      expect(response.status, response.text).toBe(422);
      expect(response.body.code).toBe("CLOSE_CHECKLIST_INCOMPLETE");
      expect(response.body.details.incomplete).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 2 })])
      );
      const drafts = await h.sql("SELECT number, status FROM invoices WHERE company_id = $1", [
        companyId,
      ]);
      expect(drafts).toEqual([{ number: "INV-2026-00001", status: "draft" }]);
    } finally {
      try {
        await blocker.query("ROLLBACK");
        await Promise.allSettled([generating, closing]);
      } finally {
        blocker.release();
        restoreTime();
      }
    }
  }
);
