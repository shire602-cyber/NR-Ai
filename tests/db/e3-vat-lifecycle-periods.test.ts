/**
 * E3 (J3-r3 Medium): after a Q3 return was filed and paid on the Returns tab, the VAT Periods tab
 * still showed the quarter as Overdue / Draft / 0.00 with "Prepare", and the "VAT deadlines" card
 * said "21d late | Draft". The return lifecycle (vat_returns) is now the one status source for the
 * Periods tab, the deadlines card and the compliance calendar.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

it.each(["filed", "amended"])(
  "PR #178 keeps a %s predecessor effective while its amendment is open",
  async (storedStatus) => {
    const t = await h.createTenant();
    const [original] = await h.sql<{ id: string }>(
      `INSERT INTO vat_returns
        (company_id, period_start, period_end, due_date, status, fta_reference_number, created_by)
       VALUES ($1, '2026-07-01', '2026-09-30', '2026-10-28', $3, 'ET-ORIGINAL', $2)
       RETURNING id`,
      [t.company.id, t.user.id, storedStatus]
    );
    const [draft] = await h.sql<{ id: string }>(
      `INSERT INTO vat_returns
        (company_id, period_start, period_end, due_date, status, amends_return_id, created_by)
       VALUES ($1, '2026-07-01', '2026-09-30 23:59:59.999', '2026-10-28', 'draft', $3, $2)
       RETURNING id`,
      [t.company.id, t.user.id, original.id]
    );

    const list = await t.as.get(`${base(t)}/vat-returns`);
    expect(list.status, list.text).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, status: storedStatus }),
        expect.objectContaining({ id: draft.id, status: "draft" }),
      ])
    );
    const { getClientStats } = await import("../../server/routes/firm/shared");
    expect((await getClientStats(t.company.id)).vatStatus).toMatchObject({
      status: "filed",
      filingRecorded: true,
    });
    const { loadReturnLifecycle } = await import("../../server/services/vat-autopilot.service");
    const period = (await loadReturnLifecycle([t.company.id])).get(t.company.id)?.get("2026-09-30");
    expect(period).toMatchObject({ returnId: original.id, filed: true });
  }
);

async function q3Activity(t: Tenant) {
  const inv = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date: "2026-08-01",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Job", quantity: 1, unitPrice: 30000, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  const bill = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Supplier LLC",
    vendor_trn: "100000000000029",
    bill_number: "B-E3-Q3",
    bill_date: "2026-08-10",
    due_date: "2026-12-31",
    line_items: [{ description: "Supplies", quantity: 1, unit_price: 4000, vat_rate: 5 }],
  });
  expect(bill.status, bill.text).toBe(200);
  expect((await t.as.post(`/api/bills/${bill.body.id}/approve`, {})).status).toBe(200);
}

describe("E3 (J3-r3) VAT periods and deadlines follow the return lifecycle", () => {
  it("a filed and paid Q3 reads Paid with its figures on Periods; the deadlines card moves on", async () => {
    const t = await h.createTenant({
      companyColumns: {
        trn_vat_number: "100000000000003",
        emirate: "dubai",
        vat_filing_frequency: "Quarterly",
        vat_period_start_month: 1,
      },
    });
    await q3Activity(t);
    const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(gen.status, gen.text).toBe(201);
    const id = gen.body.id as string;

    const q3 = async () => {
      const r = await t.as.get(`/api/vat/autopilot/periods/${t.company.id}`);
      expect(r.status, r.text).toBe(200);
      return (r.body as any[]).find((p) => p.periodEnd.slice(0, 10) === "2026-09-30");
    };
    const card = async () => {
      const r = await t.as.get(`/api/vat/autopilot/due-dates?companyId=${t.company.id}`);
      expect(r.status, r.text).toBe(200);
      expect(r.body).toHaveLength(1);
      return r.body[0];
    };

    // A draft return: still to file, and late (28 Oct 2026 has passed).
    const draft = await q3();
    expect(draft.status).toBe("draft");
    expect(draft.lifecycle).toMatchObject({ returnId: id, stage: "draft", filed: false });
    expect(draft.outputVat).toBe(1500);
    expect(draft.inputVat).toBe(200);
    expect(draft.netVatPayable).toBe(1300);
    const lateCard = await card();
    expect(lateCard.periodEnd.slice(0, 10)).toBe("2026-09-30");

    expect((await t.as.post(`/api/vat-returns/${id}/ready`, {})).status).toBe(200);
    const prepared = await t.as.post(`/api/vat-returns/${id}/submit`, {});
    expect(prepared.status, prepared.text).toBe(200);
    expect((await q3()).lifecycle).toMatchObject({ stage: "ready", filed: false });
    expect((await card()).periodEnd.slice(0, 10)).toBe("2026-09-30");
    const bank = await accountByCode(t, "1020");
    const payment = { date: "2026-10-27", paymentAccountId: bank.id };
    const blocked = await t.as.post(`/api/vat-returns/${id}/settlement`, payment);
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.body.code).toBe("VAT_RETURN_NOT_SUBMITTED");
    const journals = await h.sql(
      `SELECT id FROM journal_entries WHERE source_id = $1 AND source = 'vat_return_settlement'`,
      [id]
    );
    expect(journals).toHaveLength(0);
    const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-2026-Q3-77",
      filedOn: "2026-10-20",
    });
    expect(filed.status, filed.text).toBe(200);

    const afterFiling = await q3();
    expect(afterFiling.status).toBe("filed");
    expect(afterFiling.lifecycle).toMatchObject({ stage: "filed", filed: true });
    expect(afterFiling.deadline).toMatchObject({ isOverdue: false, level: "ok" });

    const paid = await t.as.post(`/api/vat-returns/${id}/settlement`, payment);
    expect(paid.status, paid.text).toBe(201);

    const done = await q3();
    expect(done.status).toBe("paid");
    expect(done.lifecycle).toMatchObject({ stage: "paid", filed: true });
    expect(done.lifecycle.paymentDate).toBe("2026-10-27");
    expect(done.deadline.isOverdue).toBe(false);
    expect(done.outputVat).toBe(1500);
    expect(done.inputVat).toBe(200);
    expect(done.netVatPayable).toBe(1300);

    // The deadlines card names the next return (the quarter in progress), not the filed one.
    const next = await card();
    expect(next.periodEnd.slice(0, 10)).toBe("2026-12-31");
    expect(next.dueDate.slice(0, 10)).toBe("2027-01-28");
    expect(next.status).toBe("draft");
    expect(next.level).not.toBe("overdue");
  });
});

it("reminds for the active prepared return and omits superseded and recorded returns", async () => {
  const { scanVatDeadlines } = await import("../../server/services/notification-engine.service");
  const t = await h.createTenant();
  await h.sql(
    `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, fta_reference_number, created_by)
    VALUES ($1, '2026-01-01', '2026-03-31', '2026-04-28', 'amended', NULL, $2),
           ($1, '2026-04-01', '2026-06-30', '2026-07-28', 'filed', 'EMT-FILED', $2),
           ($1, '2026-07-01', '2026-09-30', '2026-10-28', 'submitted', NULL, $2)`,
    [t.company.id, t.user.id]
  );
  const { db } = await import("../../server/db");
  const { vatReturns } = await import("../../shared/schema");
  const { and, eq } = await import("drizzle-orm");
  const { vatFilingOutstandingFilter } = await import("../../server/tax/vat-filing-filter");
  const firmQueue = await db
    .select({ status: vatReturns.status })
    .from(vatReturns)
    .where(and(eq(vatReturns.companyId, t.company.id), vatFilingOutstandingFilter));
  expect(firmQueue).toEqual([{ status: "submitted" }]);
  expect(await scanVatDeadlines(new Date("2026-10-25T12:00:00Z"))).toBe(1);
});
