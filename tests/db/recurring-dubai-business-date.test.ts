/**
 * Recurring invoices run on the Dubai business day (UTC+4), not the UTC day.
 *
 * Between 00:00 and 04:00 Dubai the UTC day is still yesterday. The scheduler must select a
 * template whose next_run_date is the Dubai today, and date the generated invoice with that
 * Dubai day. The clock is frozen far in the future so the database's own now() (which cannot be
 * frozen from JS) is before the template's date: only a comparison against the Dubai day passes.
 */
import { describe, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";

const h = useHarness();

describe("recurring invoice scheduler uses the Dubai day", () => {
  it("runs a template due on the Dubai today at 01:30 Dubai and dates the invoice that day", async () => {
    const t = await h.createTenant();
    const created = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
      customerName: "Dubai Night LLC",
      frequency: "monthly",
      startDate: "2031-05-15",
      lines: [{ description: "Retainer", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
    });
    expect(created.status, created.text).toBe(200);
    await h.sql(`UPDATE recurring_invoices SET next_run_date = '2031-05-15' WHERE id = $1`, [
      created.body.id,
    ]);

    // 2031-05-14T21:30Z is 01:30 on 15 May in Dubai.
    const thaw = freezeTime("2031-05-14T21:30:00Z");
    try {
      const { generateDueRecurringInvoices } =
        await import("../../server/services/scheduler.service");
      await generateDueRecurringInvoices();
    } finally {
      thaw();
    }

    const invoices = await h.sql<{ date: string; source: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, source FROM invoices WHERE company_id = $1`,
      [t.company.id]
    );
    expect(invoices).toEqual([{ date: "2031-05-15", source: "recurring" }]);
    const [row] = await h.sql<{ next: string }>(
      `SELECT to_char(next_run_date, 'YYYY-MM-DD') AS next FROM recurring_invoices WHERE id = $1`,
      [created.body.id]
    );
    expect(row.next).toBe("2031-06-15");
  });

  it("does not run a template due the next Dubai day", async () => {
    const t = await h.createTenant();
    const created = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
      customerName: "Tomorrow LLC",
      frequency: "monthly",
      startDate: "2031-05-16",
      lines: [{ description: "Retainer", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
    });
    expect(created.status, created.text).toBe(200);
    await h.sql(`UPDATE recurring_invoices SET next_run_date = '2031-05-16' WHERE id = $1`, [
      created.body.id,
    ]);
    const thaw = freezeTime("2031-05-14T21:30:00Z");
    try {
      const { generateDueRecurringInvoices } =
        await import("../../server/services/scheduler.service");
      await generateDueRecurringInvoices();
    } finally {
      thaw();
    }
    const invoices = await h.sql(`SELECT id FROM invoices WHERE company_id = $1`, [t.company.id]);
    expect(invoices).toHaveLength(0);
  });
});
