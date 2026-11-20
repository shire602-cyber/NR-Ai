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
    const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-2026-Q3-77",
      filedOn: "2026-10-20",
    });
    expect(filed.status, filed.text).toBe(200);

    const afterFiling = await q3();
    expect(afterFiling.status).toBe("submitted");
    expect(afterFiling.lifecycle).toMatchObject({ stage: "filed", filed: true });
    expect(afterFiling.deadline).toMatchObject({ isOverdue: false, level: "ok" });

    const bank = await accountByCode(t, "1020");
    const paid = await t.as.post(`/api/vat-returns/${id}/settlement`, {
      date: "2026-10-27",
      paymentAccountId: bank.id,
    });
    expect(paid.status, paid.text).toBe(201);

    const done = await q3();
    expect(done.status).toBe("accepted");
    expect(done.lifecycle).toMatchObject({ stage: "paid", filed: true });
    expect(String(done.lifecycle.paymentDate).slice(0, 10)).toBe("2026-10-27");
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
