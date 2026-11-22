/**
 * E2 (J3-r2): the VAT filing flow on the Returns side. A return marked ready is recorded as filed
 * with the EmaraTax reference and filing date, then its payment (or refund) is recorded through
 * the settlement seam; the return's payment fields, the calendar and the ledger agree, and a
 * reversal returns it to unpaid. Payment status is not hand-editable.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function vatTenant() {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: "100000000000003",
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function activity(t: Tenant, sales: number, purchases: number) {
  const inv = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date: "2026-02-01",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Job", quantity: 1, unitPrice: sales, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  const bill = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Supplier LLC",
    vendor_trn: "100000000000029",
    bill_number: `B-E2-${purchases}`,
    bill_date: "2026-03-10",
    due_date: "2026-12-31",
    line_items: [{ description: "Supplies", quantity: 1, unit_price: purchases, vat_rate: 5 }],
  });
  expect(bill.status, bill.text).toBe(200);
  const ap = await t.as.post(`/api/bills/${bill.body.id}/approve`, {});
  expect(ap.status, ap.text).toBe(200);
}

async function readyReturn(t: Tenant) {
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });
  expect(gen.status, gen.text).toBe(201);
  const ready = await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {});
  expect(ready.status, ready.text).toBe(200);
  expect(ready.body.status).toBe("ready");
  return gen.body.id as string;
}

async function addMember(t: Tenant, role: string, name: string): Promise<Tenant> {
  const m = await h.createSecondTenant({ name });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    t.company.id,
    m.user.id,
    role,
  ]);
  return m;
}

async function returnRow(t: Tenant, id: string) {
  const r = await t.as.get(`/api/vat-returns/${id}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
}

describe("E2 (J3-r2) VAT return: ready -> filed -> paid", () => {
  it("records the filing with the EmaraTax reference and date, then the payment, then reverses it", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    await activity(t, 2000, 400);
    const id = await readyReturn(t);
    const submit = (body: object) => t.as.post(`/api/vat-returns/${id}/submit`, body);

    // The filing date is never in the future, never inside the period, and needs a reference.
    const future = await submit({ ftaReferenceNumber: "ET-1", filedOn: "2027-06-01" });
    expect(future.status, future.text).toBe(422);
    expect(future.body.code).toBe("VAT_FILED_ON_FUTURE");
    const inPeriod = await submit({ ftaReferenceNumber: "ET-1", filedOn: "2026-03-31" });
    expect(inPeriod.status, inPeriod.text).toBe(422);
    expect(inPeriod.body.code).toBe("VAT_FILED_ON_IN_PERIOD");
    const noRef = await submit({ filedOn: "2026-04-20" });
    expect(noRef.status, noRef.text).toBe(400);
    expect((await returnRow(t, id)).status).toBe("ready");

    const filed = await submit({ ftaReferenceNumber: "ET-2026-Q1-001", filedOn: "2026-04-20" });
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body).toMatchObject({ status: "filed", ftaReferenceNumber: "ET-2026-Q1-001" });
    expect(String(filed.body.submittedAt).slice(0, 10)).toBe("2026-04-20");
    expect(filed.body.paymentStatus ?? "unpaid").toBe("unpaid");

    // Payment status follows the settlement only.
    const hand = await t.as.patch(`/api/vat-returns/${id}`, { paymentStatus: "paid" });
    expect(hand.status, hand.text).toBe(400);

    const url = `/api/vat-returns/${id}/settlement`;
    expect((await t.as.get(url)).body.settlement).toBeNull();
    const paid = await t.as.post(url, {
      date: "2026-04-25",
      paymentAccountId: bank.id,
      reference: "PAY-1",
    });
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body.netPayable).toBe(80);
    const got = (await t.as.get(url)).body.settlement;
    expect(got).toMatchObject({
      id: paid.body.journalEntryId,
      date: "2026-04-25",
      reference: "PAY-1",
      netPayable: 80,
      kind: "payment",
    });
    const afterPay = await returnRow(t, id);
    expect(afterPay.paymentStatus).toBe("paid");
    expect(Number(afterPay.paymentAmount)).toBe(80);
    expect(String(afterPay.paymentDate).slice(0, 10)).toBe("2026-04-25");

    const rev = await t.as.post(`${url}/reverse`, { date: "2026-04-26", reason: "Wrong bank" });
    expect(rev.status, rev.text).toBe(200);
    expect((await t.as.get(url)).body.settlement).toBeNull();
    const afterRev = await returnRow(t, id);
    expect(afterRev.paymentStatus).toBe("unpaid");
    expect(afterRev.paymentAmount).toBeNull();
  });

  it("a refund return records the refund received (Dr bank) and reads back as a refund", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    await activity(t, 200, 4000);
    const id = await readyReturn(t);
    const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-REF-1",
      filedOn: "2026-04-10",
    });
    expect(filed.status, filed.text).toBe(200);
    expect(Number(filed.body.box14PayableTax)).toBeLessThan(0);
    const url = `/api/vat-returns/${id}/settlement`;
    const refund = await t.as.post(url, { date: "2026-05-30", paymentAccountId: bank.id });
    expect(refund.status, refund.text).toBe(201);
    expect(refund.body.netPayable).toBe(-190);
    expect((await t.as.get(url)).body.settlement).toMatchObject({
      kind: "refund",
      netPayable: -190,
    });
    expect((await returnRow(t, id)).paymentStatus).toBe("paid");
  });

  it("a viewer cannot record the filing or the payment", async () => {
    const t = await vatTenant();
    await activity(t, 2000, 400);
    const id = await readyReturn(t);
    const viewer = await addMember(t, "viewer", "E2Viewer");
    const res = await viewer.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-X",
      filedOn: "2026-04-20",
    });
    expect(res.status).toBe(403);
  });
});

describe("INTEGRATE-G: the compliance calendar follows the filed VAT return", () => {
  it.each([false, true])(
    "keeps the deadline until EmaraTax filing is recorded (nil return: %s)",
    async (nil) => {
      const t = await vatTenant();
      if (!nil) await activity(t, 2000, 400);
      const id = await readyReturn(t);
      const calRow = async () => {
        const cal = await t.as.get(`${base(t)}/compliance-calendar?from=2026-01-01&to=2026-12-31`);
        expect(cal.status, cal.text).toBe(200);
        return (cal.body as Array<Record<string, unknown>>).find(
          (r) => r.obligationKey === "vat:2026-03-31"
        );
      };
      // Before filing the return is matched to its own period (not 1 Apr) and is not completed.
      const before = await calRow();
      expect(before, "obligation for the 31 Mar period").toBeTruthy();
      expect(before).toMatchObject({ periodEnd: "2026-03-31", relatedEntityId: id });
      expect(before!.status).not.toBe("completed");
      const prepared = await t.as.post(`/api/vat-returns/${id}/submit`, {});
      expect(prepared.status, prepared.text).toBe(200);
      expect(prepared.body).toMatchObject({
        status: "submitted",
        submittedAt: null,
        filing: { channel: "none" },
      });
      expect(Number(prepared.body.box14PayableTax) === 0).toBe(nil);
      expect((await calRow())?.status).not.toBe("completed");
      const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
        ftaReferenceNumber: "ET-2026-Q1-CAL",
        filedOn: "2026-04-20",
      });
      expect(filed.status, filed.text).toBe(200);
      const after = await calRow();
      expect(after).toMatchObject({
        status: "completed",
        statusDerived: true,
        relatedEntityId: id,
      });
    }
  );
});
