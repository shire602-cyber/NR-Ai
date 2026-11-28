/**
 * A recurring template that fell behind creates the CURRENT period as before (dated today, issued
 * when the template auto-issues) and every OLDER missed period up to the end date as a DRAFT dated
 * today with supply_date = the period: nothing is backdated, posted, given an old-series number or
 * emailed (drafts take current-series numbers at creation), so period locks, filed VAT and missing FX history cannot stall it.
 */
import { describe, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";

const h = useHarness();

async function setup(
  nextRun: string,
  endDate: string | null,
  frequency = "monthly",
  extra: Record<string, unknown> = {}
) {
  const t = await h.createTenant();
  const created = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
    customerName: "Catch Up LLC",
    frequency,
    startDate: nextRun,
    ...extra,
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

const invoiceRows = async (companyId: string) =>
  h.sql<{
    date: string;
    supply: string | null;
    status: string;
    number: string;
    notes: string | null;
  }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, to_char(supply_date, 'YYYY-MM-DD') AS supply,
            status, number, notes
       FROM invoices WHERE company_id = $1 ORDER BY supply_date NULLS LAST, number`,
    [companyId]
  );

const journalCount = async (companyId: string) =>
  Number(
    (
      await h.sql<{ n: string }>(
        `SELECT count(*) AS n FROM journal_entries WHERE company_id = $1`,
        [companyId]
      )
    )[0].n
  );

const outboxCount = async (companyId: string) =>
  Number(
    (
      await h.sql<{ n: string }>(`SELECT count(*) AS n FROM email_outbox WHERE company_id = $1`, [
        companyId,
      ])
    )[0].n
  );

const draftIds = async (companyId: string) =>
  (
    await h.sql<{ id: string }>(
      `SELECT id FROM invoices WHERE company_id = $1 AND status = 'draft'`,
      [companyId]
    )
  ).map((r) => r.id);

const TODAY = "2031-06-10";

describe("recurring catch-up: drafts for missed periods, the current period as before", () => {
  it("3 missed monthly periods: 2 supply-dated drafts and 1 issued current invoice, then ends", async () => {
    const { t, id } = await setup("2031-04-10", "2031-06-30", "monthly", { autoIssue: true });
    await tickAt(`${TODAY}T06:00:00Z`);
    const rows = await invoiceRows(t.company.id);
    expect(rows).toHaveLength(3);
    const drafts = rows.filter((r) => r.supply !== null);
    expect(drafts.map((r) => r.supply)).toEqual(["2031-04-10", "2031-05-10"]);
    for (const d of drafts) {
      expect(d.date).toBe(TODAY);
      expect(d.status).toBe("draft");
      // Customer-safe: no template id and no internal instruction (the note reaches the UBL).
      expect(d.notes).toBe(`Services for the period starting ${d.supply}`);
      expect(d.notes).not.toContain(id);
      expect(d.notes).not.toContain("Review and issue");
    }
    const current = rows.find((r) => r.supply === null)!;
    expect(current.date).toBe(TODAY);
    expect(current.status).not.toBe("draft");
    // Only the current invoice posted: one revenue entry, nothing for the drafts.
    expect(await journalCount(t.company.id)).toBeGreaterThan(0);
    const draftEntries = await h.sql(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND source_id = ANY($2::uuid[])`,
      [t.company.id, await draftIds(t.company.id)]
    );
    expect(draftEntries).toHaveLength(0);
    expect(await outboxCount(t.company.id)).toBe(0);
    const row = await templateRow(id);
    expect(row.is_active).toBe(false);
    expect(Number(row.total)).toBe(3);
    expect(row.message).toContain(
      "Created 2 draft invoices for missed periods 2031-04-10, 2031-05-10"
    );
    expect(row.message).toContain("review and issue them");
    const audit = await h.sql<{ details: string }>(
      `SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'recurring_invoice.catch_up_drafts' AND resource_id = $2`,
      [t.company.id, id]
    );
    // One audit row per draft, written inside that period's transaction.
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.details).join(" ")).toContain("2031-04-10");
    expect(audit.map((a) => a.details).join(" ")).toContain("2031-05-10");
    // A later tick creates nothing more.
    await tickAt("2031-06-11T06:00:00Z");
    expect(await invoiceRows(t.company.id)).toHaveLength(3);
  });

  it("a locked past month does not stall the template: drafts are created and next run advances", async () => {
    const { t, id } = await setup("2031-02-15", null);
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_end, status, lock_type, lock_scope)
       VALUES ($1, '2031-03-31', 'locked', 'hard', 'through')`,
      [t.company.id]
    );
    await tickAt("2031-06-10T06:00:00Z");
    const rows = await invoiceRows(t.company.id);
    expect(rows.filter((r) => r.supply !== null).map((r) => r.supply)).toEqual([
      "2031-02-15",
      "2031-03-15",
      "2031-04-15",
    ]);
    expect(rows).toHaveLength(4);
    const row = await templateRow(id);
    expect(row.next).toBe("2031-06-15");
    expect(row.is_active).toBe(true);
  });

  it("a past period inside a filed VAT return becomes a draft, never posted", async () => {
    const { t, id } = await setup("2031-01-15", "2031-03-31", "monthly", { autoIssue: true });
    await h.sql(
      `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, fta_reference_number, created_by)
       VALUES ($1, '2031-02-01', '2031-02-28', '2031-03-28', 'filed', 'EMT-FILED', $2)`,
      [t.company.id, t.user.id]
    );
    await tickAt("2031-06-10T06:00:00Z");
    const rows = await invoiceRows(t.company.id);
    expect(rows.filter((r) => r.status === "draft").map((r) => r.supply)).toEqual([
      "2031-01-15",
      "2031-02-15",
    ]);
    expect(rows).toHaveLength(3);
    expect(await outboxCount(t.company.id)).toBe(0);
    expect((await templateRow(id)).is_active).toBe(false);
  });

  it("two parallel ticks create each period exactly once", async () => {
    const { t, id } = await setup("2031-01-15", "2031-03-31");
    await tickAt("2031-06-10T06:00:00Z", 2);
    const rows = await invoiceRows(t.company.id);
    expect(rows.map((r) => r.supply ?? "current").sort()).toEqual([
      "2031-01-15",
      "2031-02-15",
      "current",
    ]);
    expect(Number((await templateRow(id)).total)).toBe(3);
  });

  it("caps catch-up per tick and continues on the next tick", async () => {
    const { t, id } = await setup("2031-01-01", null, "weekly");
    await tickAt("2032-01-01T06:00:00Z");
    expect(await invoiceRows(t.company.id)).toHaveLength(24);
    expect((await templateRow(id)).is_active).toBe(true);
    await tickAt("2032-01-01T07:00:00Z");
    expect(await invoiceRows(t.company.id)).toHaveLength(48);
    await tickAt("2032-01-01T08:00:00Z");
    const rows = await invoiceRows(t.company.id);
    expect(rows).toHaveLength(53);
    // Exactly one current (non-draft-by-catch-up) invoice, the rest are supply-dated drafts.
    expect(rows.filter((r) => r.supply === null)).toHaveLength(1);
    // Only the current invoice posts (the template auto-issues by default); no draft does.
    expect(await journalCount(t.company.id)).toBe(1);
  });

  it("with no end date catches up to today only and stays active", async () => {
    const { t, id } = await setup("2031-01-15", null);
    await tickAt("2031-03-20T06:00:00Z");
    expect(await invoiceRows(t.company.id)).toHaveLength(3);
    const row = await templateRow(id);
    expect(row.is_active).toBe(true);
    expect(row.next).toBe("2031-04-15");
  });

  it("a period exactly on the end date is the current one when it is the latest due", async () => {
    const { t, id } = await setup("2031-01-15", "2031-03-15");
    await tickAt("2031-06-10T06:00:00Z");
    const rows = await invoiceRows(t.company.id);
    expect(rows.map((r) => r.supply)).toEqual(["2031-01-15", "2031-02-15", null]);
    expect((await templateRow(id)).is_active).toBe(false);
  });

  it("uses the Dubai day at the boundary: 21:30Z on the end-date eve issues the 15th, not the 16th", async () => {
    const { t, id } = await setup("2031-05-15", "2031-05-16");
    await tickAt("2031-05-15T21:30:00Z");
    const rows = await invoiceRows(t.company.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2031-05-16");
    const row = await templateRow(id);
    expect(row.next).toBe("2031-06-15");
    expect(row.is_active).toBe(false);
  });

  it("does not issue a period that is still in the future in Dubai", async () => {
    const { t } = await setup("2031-05-16", "2031-08-31");
    await tickAt("2031-05-15T19:59:00Z");
    expect(await invoiceRows(t.company.id)).toEqual([]);
  });
});

describe("issuing a catch-up draft: the tax point is the supply-date VAT period", () => {
  // The drafts are dated 2031-06-10, so the whole scenario runs with the clock frozen on that
  // day (tokens are minted after freezing, so they do not expire).
  const onTheDay = async (fn: () => Promise<void>) => {
    const thaw = freezeTime(`${TODAY}T06:00:00Z`);
    try {
      await fn();
    } finally {
      thaw();
    }
  };
  const tickNow = async () => {
    const { generateDueRecurringInvoices } =
      await import("../../server/services/scheduler.service");
    await generateDueRecurringInvoices();
  };
  const issue = (t: Awaited<ReturnType<typeof setup>>["t"], invoiceId: string) =>
    t.as.patch(`/api/invoices/${invoiceId}/status`, { status: "sent" });

  const firstDraft = async (companyId: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT id FROM invoices WHERE company_id = $1 AND status = 'draft' ORDER BY supply_date LIMIT 1`,
        [companyId]
      )
    )[0].id;

  it("refuses with 409 VAT_PERIOD_FILED when the supply date falls in a filed VAT period", async () => {
    await onTheDay(async () => {
      const { t } = await setup("2031-02-15", "2031-04-30", "monthly", { autoIssue: true });
      await h.sql(
        `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, fta_reference_number, created_by)
       VALUES ($1, '2031-02-01', '2031-02-28', '2031-03-28', 'filed', 'EMT-FILED', $2)`,
        [t.company.id, t.user.id]
      );
      await tickNow();
      const id = await firstDraft(t.company.id);
      const res = await issue(t, id);
      expect(res.status, res.text).toBe(409);
      expect(res.body.code).toBe("VAT_PERIOD_FILED");
      const [row] = await h.sql<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [
        id,
      ]);
      expect(row.status).toBe("draft");
    });
  });

  it("books the VAT in the supply-date period when that period is open, and the UBL has no internal text", async () => {
    await onTheDay(async () => {
      const { t, id: templateId } = await setup("2031-04-10", "2031-06-30", "monthly", {
        autoIssue: true,
      });
      await tickNow();
      const draft = await firstDraft(t.company.id); // supply 2031-04-10
      const res = await issue(t, draft);
      expect(res.status, res.text).toBe(200);
      const { computeVat201 } = await import("../../server/tax/vat-engine");
      const april = await computeVat201({
        companyId: t.company.id,
        from: "2031-04-01",
        to: "2031-04-30",
        allowIncomplete: true,
      });
      expect(april.boxesFils.box12TotalDueTax).toBe(500);
      const may = await computeVat201({
        companyId: t.company.id,
        from: "2031-05-01",
        to: "2031-05-31",
        allowIncomplete: true,
      });
      expect(may.boxesFils.box12TotalDueTax).toBe(0);

      // The UBL is built from the stored rows; the note must be the customer-safe one.
      const { db } = await import("../../server/db");
      const { invoices, invoiceLines, companies } = await import("../../shared/schema");
      const { eq } = await import("drizzle-orm");
      const { generateEInvoiceXML } = await import("../../server/services/einvoice.service");
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, draft));
      const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, draft));
      const [co] = await db.select().from(companies).where(eq(companies.id, t.company.id));
      const row = { einvoice_xml: generateEInvoiceXML(inv, lines, co).xml };
      expect(row.einvoice_xml).toContain("Services for the period starting 2031-04-10");
      expect(row.einvoice_xml).not.toContain(templateId);
      expect(row.einvoice_xml).not.toContain("Review and issue");
    });
  });
});
