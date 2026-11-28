/**
 * A recurring template that fell behind issues one invoice per missed period (each dated its own
 * run date) up to and including the end date, instead of dropping the periods after the first when
 * the end date has passed. A missed period inside a filed VAT return is skipped with a recorded
 * reason, never posted into and never dropped silently.
 */
import { describe, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";

const h = useHarness();

async function setup(nextRun: string, endDate: string | null, frequency = "monthly") {
  const t = await h.createTenant();
  const created = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
    customerName: "Catch Up LLC",
    frequency,
    startDate: nextRun,
    ...(endDate ? { endDate } : {}),
    lines: [{ description: "Retainer", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
  });
  expect(created.status, created.text).toBe(200);
  await h.sql(`UPDATE recurring_invoices SET next_run_date = $2 WHERE id = $1`, [
    created.body.id,
    nextRun,
  ]);
  return { t, id: created.body.id as string };
}

async function tickAt(iso: string, times = 1) {
  const thaw = freezeTime(iso);
  try {
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    if (times === 1) return await generateDueRecurringInvoices();
    return await Promise.all(Array.from({ length: times }, () => generateDueRecurringInvoices()));
  } finally {
    thaw();
  }
}

const datesOf = async (companyId: string) =>
  (
    await h.sql<{ date: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM invoices WHERE company_id = $1 ORDER BY date`,
      [companyId]
    )
  ).map((r) => r.date);

const templateRow = async (id: string) =>
  (
    await h.sql<{
      is_active: boolean;
      next: string;
      status: string;
      message: string;
      total: number;
    }>(
      `SELECT is_active, to_char(next_run_date, 'YYYY-MM-DD') AS next, last_run_status AS status,
              last_run_message AS message, total_generated AS total
         FROM recurring_invoices WHERE id = $1`,
      [id]
    )
  )[0];

describe("recurring catch-up up to the end date", () => {
  it("issues every in-range missed period, dated per period, then ends", async () => {
    const { t, id } = await setup("2031-01-15", "2031-03-31");
    await tickAt("2031-06-10T06:00:00Z");
    expect(await datesOf(t.company.id)).toEqual(["2031-01-15", "2031-02-15", "2031-03-15"]);
    const row = await templateRow(id);
    expect(row.is_active).toBe(false);
    expect(Number(row.total)).toBe(3);
    // No fourth invoice on a later tick.
    await tickAt("2031-06-11T06:00:00Z");
    expect(await datesOf(t.company.id)).toHaveLength(3);
  });

  it("includes a period that falls exactly on the end date", async () => {
    const { t } = await setup("2031-01-15", "2031-03-15");
    await tickAt("2031-06-10T06:00:00Z");
    expect(await datesOf(t.company.id)).toEqual(["2031-01-15", "2031-02-15", "2031-03-15"]);
  });

  it("with no end date catches up to today only and stays active", async () => {
    const { t, id } = await setup("2031-01-15", null);
    await tickAt("2031-03-20T06:00:00Z");
    expect(await datesOf(t.company.id)).toEqual(["2031-01-15", "2031-02-15", "2031-03-15"]);
    const row = await templateRow(id);
    expect(row.is_active).toBe(true);
    expect(row.next).toBe("2031-04-15");
  });

  it("caps catch-up per tick and continues on the next tick", async () => {
    const { t, id } = await setup("2031-01-01", null, "weekly");
    await tickAt("2032-01-01T06:00:00Z");
    expect(await datesOf(t.company.id)).toHaveLength(24);
    expect((await templateRow(id)).is_active).toBe(true);
    await tickAt("2032-01-01T07:00:00Z");
    expect(await datesOf(t.company.id)).toHaveLength(48);
    await tickAt("2032-01-01T08:00:00Z");
    expect(await datesOf(t.company.id)).toHaveLength(53);
  });

  it("skips a period inside a filed VAT return with a visible reason, issues the rest", async () => {
    const { t, id } = await setup("2031-01-15", "2031-03-31");
    await h.sql(
      `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, fta_reference_number, created_by)
       VALUES ($1, '2031-02-01', '2031-02-28', '2031-03-28', 'filed', 'EMT-FILED', $2)`,
      [t.company.id, t.user.id]
    );
    await tickAt("2031-06-10T06:00:00Z");
    expect(await datesOf(t.company.id)).toEqual(["2031-01-15", "2031-03-15"]);
    const row = await templateRow(id);
    expect(row.is_active).toBe(false);
    expect(row.message).toContain("Skipped the 2031-02-15 invoice");
    const audit = await h.sql<{ details: string }>(
      `SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'recurring_invoice.period_skipped' AND resource_id = $2`,
      [t.company.id, id]
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toContain("2031-02-15");
  });

  it("two parallel ticks issue each period exactly once", async () => {
    const { t, id } = await setup("2031-01-15", "2031-03-31");
    await tickAt("2031-06-10T06:00:00Z", 2);
    expect(await datesOf(t.company.id)).toEqual(["2031-01-15", "2031-02-15", "2031-03-15"]);
    expect(Number((await templateRow(id)).total)).toBe(3);
  });

  it("uses the Dubai day at the boundary: 21:30Z on the end-date eve issues the 15th, not the 16th", async () => {
    const { t, id } = await setup("2031-05-15", "2031-05-16");
    // 2031-05-15T21:30Z is 01:30 on 16 May in Dubai: the 15th is due, the next run is 15 June.
    await tickAt("2031-05-15T21:30:00Z");
    expect(await datesOf(t.company.id)).toEqual(["2031-05-15"]);
    const row = await templateRow(id);
    expect(row.next).toBe("2031-06-15");
    expect(row.is_active).toBe(false);
  });

  it("does not issue a period that is still in the future in Dubai", async () => {
    const { t } = await setup("2031-05-16", "2031-08-31");
    await tickAt("2031-05-15T19:59:00Z"); // 23:59 on the 15th in Dubai
    expect(await datesOf(t.company.id)).toEqual([]);
  });
});
