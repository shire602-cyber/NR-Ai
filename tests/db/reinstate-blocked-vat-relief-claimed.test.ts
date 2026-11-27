/**
 * Owner decision (27 Nov 2026): a MANUAL bad-debt reinstatement is refused while an active VAT
 * bad-debt relief claim (FDL 8/2017 Art. 64) exists for the invoice. No automatic relief
 * reversal is posted. A receipt that reinstates the write-off is not blocked.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

const ISSUED = "2026-01-10";
const WRITTEN_OFF = "2026-08-18";
const CLAIMED = "2026-08-20";
const REINSTATED = "2026-09-01";

async function setup(name: string) {
  const t = await h.createTenant({ name, planId: "professional" });
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Acme LLC",
    email: "ap@acme.example",
  });
  expect(c.status, c.text).toBeLessThan(300);
  const i = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId: c.body.id,
    placeOfSupplyEmirate: "dubai",
    date: ISSUED,
    lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(i.status, i.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${i.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  const w = await t.as.post(`/api/companies/${t.company.id}/invoices/${i.body.id}/write-off`, {
    date: WRITTEN_OFF,
    reason: "Insolvency",
  });
  expect(w.status, w.text).toBe(201);
  return { t, invoiceId: i.body.id as string };
}

async function claim(t: Tenant, invoiceId: string) {
  const r = await t.as.post(`/api/companies/${t.company.id}/vat/bad-debt-relief`, {
    invoiceId,
    claimDate: CLAIMED,
    writtenOff: true,
    customerNotified: true,
    customerNotifiedAt: "2026-08-19",
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

function reinstate(t: Tenant, invoiceId: string) {
  return t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/write-off/reinstate`, {
    date: REINSTATED,
    reason: "Wrong write-off",
  });
}

async function state(t: Tenant, invoiceId: string) {
  const pays = await h.sql(
    `SELECT id, method, amount::text, journal_entry_id FROM invoice_payments
      WHERE invoice_id = $1 ORDER BY created_at, id`,
    [invoiceId]
  );
  const je = await h.sql(
    `SELECT id, status, reversed_by_entry_id FROM journal_entries WHERE company_id = $1 ORDER BY id`,
    [t.company.id]
  );
  const claims = await h.sql(
    `SELECT id, status, vat_amount::text, reversal_entry_id FROM bad_debt_relief_claims
      WHERE company_id = $1 ORDER BY id`,
    [t.company.id]
  );
  const aging = await t.as.get(
    `/api/companies/${t.company.id}/reports/aged-receivables?asOf=${REINSTATED}`
  );
  expect(aging.status, aging.text).toBe(200);
  return { pays, je, claims, aging: JSON.stringify(aging.body.totals) };
}

describe("manual reinstatement is blocked by an active VAT bad-debt relief claim", () => {
  it("(a) refuses with 409 REINSTATE_BLOCKED_VAT_RELIEF_CLAIMED and changes nothing", async () => {
    const { t, invoiceId } = await setup("RB-block");
    await claim(t, invoiceId);
    const before = await state(t, invoiceId);
    const r = await reinstate(t, invoiceId);
    expect(r.status, r.text).toBe(409);
    expect(r.body.code).toBe("REINSTATE_BLOCKED_VAT_RELIEF_CLAIMED");
    expect(await state(t, invoiceId)).toEqual(before);
  });

  it("(b) succeeds once the claim is reversed", async () => {
    const { t, invoiceId } = await setup("RB-after-reverse");
    const c = await claim(t, invoiceId);
    expect((await reinstate(t, invoiceId)).status).toBe(409);
    const rev = await t.as.post(
      `/api/companies/${t.company.id}/vat/bad-debt-relief/${c.id}/reverse`,
      { date: "2026-08-25", reason: "Reinstating the debt" }
    );
    expect(rev.status, rev.text).toBe(200);
    const r = await reinstate(t, invoiceId);
    expect(r.status, r.text).toBe(200);
    expect(r.body.reinstated).toBe(1050);
  });

  it("(c) with no claim, manual reinstatement works as before", async () => {
    const { t, invoiceId } = await setup("RB-no-claim");
    const r = await reinstate(t, invoiceId);
    expect(r.status, r.text).toBe(200);
    expect(r.body.reinstated).toBe(1050);
  });

  it("(d) a customer receipt still reinstates the write-off while a claim is active", async () => {
    const { t, invoiceId } = await setup("RB-receipt");
    await claim(t, invoiceId);
    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
      amount: 300,
      date: REINSTATED,
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const rows = await h.sql<{ method: string; amount: string }>(
      `SELECT method, amount::text FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at`,
      [invoiceId]
    );
    expect(rows.map((r) => [r.method, Number(r.amount)])).toEqual([
      ["write_off", 1050],
      ["write_off_reinstatement", -1050],
      ["bank", 300],
    ]);
  });

  it("(e) reversing a write_off row through invoices.reversePayment is blocked the same way", async () => {
    const { t, invoiceId } = await setup("RB-reversePayment");
    const c = await claim(t, invoiceId);
    const [row] = await h.sql<{ id: string }>(
      `SELECT id FROM invoice_payments WHERE invoice_id = $1 AND method = 'write_off'`,
      [invoiceId]
    );
    const { reverseInvoicePayment } = await import("../../server/services/invoice-payment.service");
    const input = {
      companyId: t.company.id,
      paymentId: row.id,
      actorId: t.user.id,
      reason: "undo",
      date: REINSTATED,
    };
    const before = await state(t, invoiceId);
    await expect(reverseInvoicePayment(input)).rejects.toMatchObject({
      code: "REINSTATE_BLOCKED_VAT_RELIEF_CLAIMED",
      statusCode: 409,
    });
    expect(await state(t, invoiceId)).toEqual(before);
    const rev = await t.as.post(
      `/api/companies/${t.company.id}/vat/bad-debt-relief/${c.id}/reverse`,
      { date: "2026-08-25", reason: "Reinstating the debt" }
    );
    expect(rev.status, rev.text).toBe(200);
    await expect(reverseInvoicePayment(input)).resolves.toMatchObject({ reversed: true });
  });
});
