/**
 * Accounting round A integration:
 *  - VAT return settlement (POST /api/vat-returns/:id/settlement): paying the FTA for a filed
 *    return clears 2020 / 1050 through a service, without the reasoned control-account
 *    adjustment A2's H8 rule requires of a manual journal, and the payment is not reported as a
 *    VAT adjustment of the period it is dated in.
 *  - A4 customer deposits x A1 filed-period lock: applying a deposit (even a zero-rated one that
 *    posts no VAT line) in a filed VAT period is refused 409 VAT_PERIOD_FILED.
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

async function glBalance(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0].n) / 100;
}

async function linesOf(entryId: string) {
  const rows = await h.sql<{ code: string; d: string; c: string }>(
    `SELECT a.code, SUM(jl.debit)::text AS d, SUM(jl.credit)::text AS c
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 GROUP BY a.code ORDER BY a.code`,
    [entryId]
  );
  return Object.fromEntries(rows.map((r) => [r.code, [Number(r.d), Number(r.c)]]));
}

async function quarterWithActivity(t: Tenant) {
  const inv = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date: "2026-02-01",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Job", quantity: 1, unitPrice: 2000, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  const bill = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Supplier LLC",
    vendor_trn: "100000000000029",
    bill_number: "B-SETTLE-1",
    bill_date: "2026-03-10",
    due_date: "2026-12-31",
    line_items: [{ description: "Supplies", quantity: 1, unit_price: 400, vat_rate: 5 }],
  });
  expect(bill.status, bill.text).toBe(200);
  const ap = await t.as.post(`/api/bills/${bill.body.id}/approve`, {});
  expect(ap.status, ap.text).toBe(200);
}

async function generate(t: Tenant, periodStart: string, periodEnd: string) {
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, { periodStart, periodEnd });
  expect(gen.status, gen.text).toBe(201);
  return gen.body as { id: string };
}

async function submit(id: string, t: Tenant) {
  const sub = await t.as.post(`/api/vat-returns/${id}/submit`, { ftaReferenceNumber: "FTA-1" });
  expect(sub.status, sub.text).toBe(200);
}

describe("VAT return settlement", () => {
  it("pays a filed return through its own seam: Dr 2020 / Cr 1050 / Cr bank, no adjustment", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    await quarterWithActivity(t);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    const url = `/api/vat-returns/${ret.id}/settlement`;

    // Not before the return is submitted.
    const early = await t.as.post(url, { date: "2026-04-20", paymentAccountId: bank.id });
    expect(early.status, early.text).toBe(409);
    expect(early.body.code).toBe("VAT_RETURN_NOT_SUBMITTED");
    await submit(ret.id, t);

    // A manual journal on 2020 is still refused without a reason (A2 H8): this route is the path.
    const manual = await t.as.post(`${base(t)}/journal`, {
      date: "2026-04-20",
      status: "posted",
      lines: [
        { accountId: (await accountByCode(t, "2020")).id, debit: 80, credit: 0 },
        { accountId: bank.id, debit: 0, credit: 80 },
      ],
    });
    expect(manual.status, manual.text).toBe(422);
    expect(manual.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");

    const inPeriod = await t.as.post(url, { date: "2026-03-31", paymentAccountId: bank.id });
    expect(inPeriod.status, inPeriod.text).toBe(422);
    expect(inPeriod.body.code).toBe("VAT_SETTLEMENT_DATE_IN_PERIOD");
    const ar = await accountByCode(t, "1040");
    const notBank = await t.as.post(url, { date: "2026-04-20", paymentAccountId: ar.id });
    expect(notBank.status, notBank.text).toBe(422);
    expect(notBank.body.code).toBe("PAYMENT_ACCOUNT_INVALID");

    const paid = await t.as.post(url, {
      date: "2026-04-20",
      paymentAccountId: bank.id,
      reference: "FTA-PAY-1",
    });
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body).toMatchObject({ outputVat: 100, inputVat: 20, netPayable: 80 });
    expect(await linesOf(paid.body.journalEntryId)).toEqual({
      "1020": [0, 80],
      "1050": [0, 20],
      "2020": [100, 0],
    });
    expect(await glBalance(t, "2020")).toBe(0);
    expect(await glBalance(t, "1050")).toBe(0);
    const again = await t.as.post(url, { date: "2026-04-21", paymentAccountId: bank.id });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("VAT_RETURN_ALREADY_SETTLED");
    expect((await t.as.get(url)).body.settlement.id).toBe(paid.body.journalEntryId);

    // The payment is not a VAT transaction of Q2: no boxes, no manual adjustment, reconciled.
    const q2 = await t.as.get(`${base(t)}/vat/compute?from=2026-04-01&to=2026-06-30`);
    expect(q2.status, q2.text).toBe(200);
    expect(q2.body.boxes.box14PayableTax).toBe(0);
    expect(q2.body.reconciliation.hasUnexplainedDifference).toBe(false);

    const rev = await t.as.post(`${url}/reverse`, { date: "2026-04-25", reason: "Bank rejected" });
    expect(rev.status, rev.text).toBe(200);
    expect(await glBalance(t, "2020")).toBe(-100);
    expect(await glBalance(t, "1050")).toBe(20);
    expect((await t.as.get(url)).body.settlement).toBeNull();
  });

  it("a viewer cannot record the VAT payment", async () => {
    const t = await vatTenant();
    await quarterWithActivity(t);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await submit(ret.id, t);
    await h.sql(`UPDATE company_users SET role = 'viewer' WHERE company_id = $1`, [t.company.id]);
    const bank = await accountByCode(t, "1020");
    const r = await t.as.post(`/api/vat-returns/${ret.id}/settlement`, {
      date: "2026-04-20",
      paymentAccountId: bank.id,
    });
    expect(r.status, r.text).toBe(403);
  });
});

describe("A4 deposits x A1 filed-period lock", () => {
  it("applying a zero-rated deposit inside a filed VAT period is refused", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    const dep = await t.as.post(`${base(t)}/customer-deposits`, {
      customerName: "Export Customer LLC",
      date: "2026-02-05",
      amount: 1000,
      vatTreatment: "zero_rated",
      paymentAccountId: bank.id,
    });
    expect(dep.status, dep.text).toBe(201);
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Export Customer LLC",
      date: "2026-03-01",
      placeOfSupplyEmirate: "dubai",
      lines: [
        {
          description: "Export",
          quantity: 1,
          unitPrice: 3000,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await submit(ret.id, t);

    const refused = await t.as.post(`${base(t)}/customer-credits/${dep.body.creditId}/apply`, {
      invoiceId: inv.body.id,
      amount: 1000,
      date: "2026-03-15",
    });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("VAT_PERIOD_FILED");
    const ok = await t.as.post(`${base(t)}/customer-credits/${dep.body.creditId}/apply`, {
      invoiceId: inv.body.id,
      amount: 1000,
      date: "2026-04-02",
    });
    expect(ok.status, ok.text).toBe(201);
  });
});
