/**
 * A recurring template's end date is a calendar day (inclusive): a template due ON its end date
 * issues its last invoice whatever time of day the job runs, then deactivates. The check compares
 * Dubai days, not instants (the cron at 06:00Z used to disable it without an invoice).
 */
import { describe, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";

const h = useHarness();

async function setup(nextRun: string, endDate: string) {
  const t = await h.createTenant();
  const created = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
    customerName: "End Date LLC",
    frequency: "monthly",
    startDate: nextRun,
    endDate,
    lines: [{ description: "Retainer", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
  });
  expect(created.status, created.text).toBe(200);
  await h.sql(`UPDATE recurring_invoices SET next_run_date = $2 WHERE id = $1`, [
    created.body.id,
    nextRun,
  ]);
  return { t, id: created.body.id as string };
}

async function runAt(iso: string) {
  const thaw = freezeTime(iso);
  try {
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    await generateDueRecurringInvoices();
  } finally {
    thaw();
  }
}

describe("recurring end date is inclusive by Dubai day", () => {
  it.each(["2031-05-15T06:00:00Z", "2031-05-15T21:30:00Z"])(
    "issues the end-date invoice when the job runs at %s, then deactivates",
    async (at) => {
      // 21:30Z on the 15th is 01:30 on the 16th in Dubai, so use the matching Dubai day.
      const dubaiDay = at.includes("21:30") ? "2031-05-16" : "2031-05-15";
      const { t, id } = await setup(dubaiDay, dubaiDay);
      await runAt(at);
      const invoices = await h.sql<{ date: string }>(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM invoices WHERE company_id = $1`,
        [t.company.id]
      );
      expect(invoices).toEqual([{ date: dubaiDay }]);
      const [row] = await h.sql<{ is_active: boolean }>(
        `SELECT is_active FROM recurring_invoices WHERE id = $1`,
        [id]
      );
      expect(row.is_active).toBe(false);
    }
  );

  it("issues nothing and disables a template whose end date was yesterday in Dubai", async () => {
    const { t, id } = await setup("2031-05-14", "2031-05-14");
    // 2031-05-14T21:30Z is 01:30 on 15 May in Dubai: the end date (14th) is yesterday.
    await runAt("2031-05-14T21:30:00Z");
    const invoices = await h.sql(`SELECT id FROM invoices WHERE company_id = $1`, [t.company.id]);
    expect(invoices).toHaveLength(0);
    const [row] = await h.sql<{ is_active: boolean; last_run_status: string }>(
      `SELECT is_active, last_run_status FROM recurring_invoices WHERE id = $1`,
      [id]
    );
    expect(row.is_active).toBe(false);
    expect(row.last_run_status).toBe("ended");
  });

  it("keeps a template active while later runs remain before the end date", async () => {
    const { id } = await setup("2031-05-15", "2031-08-31");
    await runAt("2031-05-15T06:00:00Z");
    const [row] = await h.sql<{ is_active: boolean }>(
      `SELECT is_active FROM recurring_invoices WHERE id = $1`,
      [id]
    );
    expect(row.is_active).toBe(true);
  });
});
