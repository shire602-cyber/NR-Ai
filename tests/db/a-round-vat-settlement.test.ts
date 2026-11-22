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

async function vatTenant(baseCurrency = "AED") {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: "100000000000003",
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      base_currency: baseCurrency,
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

async function setAedRate(t: Tenant, currency: string, rate: number, date = "2026-01-01") {
  const res = await t.as.post(`${base(t)}/exchange-rates`, {
    fromCurrency: "AED",
    toCurrency: currency,
    rate,
    effectiveDate: date,
    confirmLargeMove: true,
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

async function foreignSale(t: Tenant, currency: string, amount: number, date = "2026-02-01") {
  const invoice = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Customer",
    currency,
    date,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Taxable sale", quantity: 1, unitPrice: amount, vatRate: 5 }],
  });
  expect(invoice.status, invoice.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${invoice.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  return invoice.body.id as string;
}

async function getSettledReturn(t: Tenant, id: string) {
  const result = await t.as.get(`/api/vat-returns/${id}`);
  expect(result.status, result.text).toBe(200);
  return result.body;
}

async function vatGroup(representative: Tenant, member: Tenant) {
  await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
    member.company.id,
    representative.user.id,
  ]);
  const group = await representative.as.put(`${base(representative)}/vat/group`, {
    name: "VAT group",
    groupTrn: "100000000000029",
    memberCompanyIds: [member.company.id],
  });
  expect(group.status, group.text).toBe(200);
}

describe("VAT return settlement", () => {
  it("clears each USD member's own controls and translates group cash at the settlement rate", async () => {
    const representative = await vatTenant("USD");
    const member = await vatTenant("USD");
    for (const company of [representative, member]) await setAedRate(company, "USD", 0.25);
    await foreignSale(representative, "USD", 1000);
    await foreignSale(member, "USD", 200);
    await vatGroup(representative, member);
    const ret = await generate(representative, "2026-01-01", "2026-03-31");
    await submit(ret.id, representative);
    for (const company of [representative, member])
      await setAedRate(company, "USD", 0.3, "2026-04-20");
    const bank = await accountByCode(representative, "1020");
    const url = `/api/vat-returns/${ret.id}/settlement`;
    const payment = { date: "2026-04-20", paymentAccountId: bank.id, reference: "GROUP-1" };
    const paid = await representative.as.post(url, payment);
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body).toMatchObject({ outputVat: 240, inputVat: 0, netPayable: 240 });
    expect(await linesOf(paid.body.journalEntryId)).toEqual({
      "2020": [50, 0],
      "1087": [12, 0],
      "1020": [0, 72],
      "5140": [10, 0],
    });
    const [memberEntry] = await h.sql<{ id: string }>(
      "SELECT id FROM journal_entries WHERE company_id=$1 AND source_id=$2 AND source='vat_return_settlement'",
      [member.company.id, ret.id]
    );
    expect(await linesOf(memberEntry.id)).toEqual({
      "2020": [10, 0],
      "2087": [0, 12],
      "5140": [2, 0],
    });
    expect(await glBalance(representative, "2020")).toBe(0);
    expect(await glBalance(member, "2020")).toBe(0);
    const replay = await representative.as.post(url, payment);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body).toEqual(paid.body);

    const amendment = await representative.as.post(`/api/vat-returns/${ret.id}/amend`, {
      reason: "Include the member's additional sale",
    });
    expect(amendment.status, amendment.text).toBe(201);
    await foreignSale(member, "USD", 200, "2026-02-10");
    const amendmentId = amendment.body.id as string;
    expect(await generate(representative, "2026-01-01", "2026-03-31")).toMatchObject({
      id: amendmentId,
    });
    await submit(amendmentId, representative);
    const amendmentUrl = `/api/vat-returns/${amendmentId}/settlement`;
    const amended = await representative.as.post(amendmentUrl, {
      ...payment,
      reference: "GROUP-2",
      date: "2026-04-21",
    });
    expect(amended.status, amended.text).toBe(201);
    expect(amended.body).toMatchObject({ netPayable: 40, previouslySettled: { netPaid: 240 } });
    expect(await linesOf(amended.body.journalEntryId)).toEqual({
      "1087": [12, 0],
      "1020": [0, 12],
    });
    const wrongOrder = await representative.as.post(`${url}/reverse`, {
      date: "2026-04-22",
      reason: "Reverse settlements",
    });
    expect(wrongOrder.status, wrongOrder.text).toBe(409);
    expect(wrongOrder.body.code).toBe("VAT_SETTLEMENT_COUNTED_BY_AMENDMENT");
    const reversedAmendment = await representative.as.post(`${amendmentUrl}/reverse`, {
      date: "2026-04-22",
      reason: "Reverse amendment",
    });
    expect(reversedAmendment.status, reversedAmendment.text).toBe(200);

    const reversed = await representative.as.post(`${url}/reverse`, {
      date: "2026-04-21",
      reason: "Reverse group remittance",
    });
    expect(reversed.status, reversed.text).toBe(200);
    expect(await glBalance(representative, "2020")).toBe(-50);
    expect(await glBalance(member, "2020")).toBe(-20);
    expect((await representative.as.get(url)).body.settlement).toBeNull();
  });

  it("tracks and reverses member-only control journals when the representative has no lines", async () => {
    const representative = await vatTenant();
    const member = await vatTenant();
    await foreignSale(member, "AED", 1000);
    const bill = await member.as.post(`${base(member)}/bills`, {
      vendor_name: "External supplier",
      vendor_trn: "100000000000011",
      bill_number: "GROUP-NET-0",
      bill_date: "2026-02-20",
      due_date: "2026-03-31",
      currency: "AED",
      line_items: [{ description: "Taxable purchase", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    const approved = await member.as.post(`/api/bills/${bill.body.id}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    await vatGroup(representative, member);
    const ret = await generate(representative, "2026-01-01", "2026-03-31");
    await submit(ret.id, representative);
    const bank = await accountByCode(representative, "1020");
    const url = `/api/vat-returns/${ret.id}/settlement`;
    const payment = { date: "2026-04-20", paymentAccountId: bank.id };
    const paid = await representative.as.post(url, payment);
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body).toMatchObject({ outputVat: 50, inputVat: 50, netPayable: 0 });
    const entries = await h.sql(
      "SELECT id,company_id FROM journal_entries WHERE source='vat_return_settlement' AND source_id=$1",
      [ret.id]
    );
    expect(entries).toEqual([{ id: paid.body.journalEntryId, company_id: member.company.id }]);
    expect(await linesOf(paid.body.journalEntryId)).toEqual({ "2020": [50, 0], "1050": [0, 50] });
    expect((await representative.as.get(url)).body.settlement).toMatchObject({
      id: paid.body.journalEntryId,
      kind: "none",
    });
    const replay = await representative.as.post(url, payment);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body).toEqual(paid.body);
    const reversed = await representative.as.post(`${url}/reverse`, {
      date: "2026-04-21",
      reason: "Undo settlement",
    });
    expect(reversed.status, reversed.text).toBe(200);
    expect(await glBalance(member, "2020")).toBe(-50);
    expect(await glBalance(member, "1050")).toBe(50);
  });

  it("requires posted evidence before settling USD workpaper figures with no VAT controls", async () => {
    const t = await vatTenant("USD");
    await setAedRate(t, "USD", 0.25);
    const bank = await accountByCode(t, "1020");
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    // Workpaper generation writes the approved aggregate boxes without an engine version.
    await h.sql(
      `UPDATE vat_returns SET status = 'pending_review', engine_version = NULL,
               box12_total_due_tax = 50, box14_payable_tax = 50 WHERE id = $1`,
      [ret.id]
    );
    await submit(ret.id, t);
    const url = `/api/vat-returns/${ret.id}/settlement`;
    const paid = await t.as.post(url, { date: "2026-04-20", paymentAccountId: bank.id });
    expect(paid.status, paid.text).toBe(409);
    expect(paid.body.code).toBe("VAT_SETTLEMENT_RECONCILIATION_REQUIRED");
    expect((await t.as.get(url)).body.settlement).toBeNull();
    expect((await getSettledReturn(t, ret.id)).paymentAmount).toBeNull();
  });

  it("requires evidence for an older filed AED return linked to a workpaper", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await h.sql(
      `UPDATE vat_returns SET status='filed', engine_version=NULL, reconciliation_snapshot=NULL,
         box12_total_due_tax=50, box14_payable_tax=50 WHERE id=$1`,
      [ret.id]
    );
    await h.sql(
      `INSERT INTO vat_workpapers (company_id, period_start, period_end, due_date, status, generated_vat_return_id, created_by)
       SELECT company_id, period_start, period_end, due_date, 'filed', id, $2 FROM vat_returns WHERE id=$1`,
      [ret.id, t.user.id]
    );
    const url = `/api/vat-returns/${ret.id}/settlement`;
    const paid = await t.as.post(url, { date: "2026-04-20", paymentAccountId: bank.id });
    expect(paid.status, paid.text).toBe(409);
    expect(paid.body.code).toBe("VAT_SETTLEMENT_RECONCILIATION_REQUIRED");
    expect((await t.as.get(url)).body.settlement).toBeNull();
  });

  it("retains the ready override and settles current carrying values with unchanged AED VAT", async () => {
    const t = await vatTenant("USD");
    await setAedRate(t, "USD", 0.25);
    const bank = await accountByCode(t, "1020");
    const output = await accountByCode(t, "2020");
    const invoice = await foreignSale(t, "USD", 1000);
    const { postJournal } = await import("../../server/ledger");
    await postJournal(
      {
        companyId: t.company.id,
        date: "2026-02-05",
        source: "invoice",
        status: "posted",
        lines: [
          { accountId: bank.id, debitFils: 500 },
          { accountId: output.id, creditFils: 500, systemVat: true },
        ],
      },
      { actorId: t.user.id }
    );
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    const ready = await t.as.post(`/api/vat-returns/${ret.id}/ready`, {
      overrideReason: "Reviewed the remaining ledger-only VAT movement",
    });
    expect(ready.status, ready.text).toBe(200);
    expect(ready.body.reconciliationSnapshot).toMatchObject({
      returnOutputVatFils: 5000,
      unexplainedOutputFils: -500,
    });
    const voided = await t.as.patch(`/api/invoices/${invoice}/status`, { status: "void" });
    expect(voided.status, voided.text).toBe(200);
    await setAedRate(t, "USD", 0.2, "2026-03-01");
    await foreignSale(t, "USD", 800, "2026-03-01");
    await submit(ret.id, t);
    const filed = await getSettledReturn(t, ret.id);
    expect(filed.reconciliationSnapshot).toMatchObject({
      returnOutputVatFils: 5000,
      unexplainedOutputFils: -500,
    });
    const url = `/api/vat-returns/${ret.id}/settlement`;
    const payment = { date: "2026-04-20", paymentAccountId: bank.id };
    await h.sql(
      "UPDATE vat_returns SET reconciliation_snapshot = reconciliation_snapshot - 'filingReconciliation' WHERE id=$1",
      [ret.id]
    );
    const legacy = await t.as.post(url, payment);
    expect(legacy.status, legacy.text).toBe(409);
    expect(legacy.body.code).toBe("VAT_SETTLEMENT_RECONCILIATION_REQUIRED");
    await h.sql("UPDATE vat_returns SET reconciliation_snapshot=$2::jsonb WHERE id=$1", [
      ret.id,
      JSON.stringify(filed.reconciliationSnapshot),
    ]);
    const paid = await t.as.post(`/api/vat-returns/${ret.id}/settlement`, {
      date: "2026-04-20",
      paymentAccountId: bank.id,
    });
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body.netPayable).toBe(200);
    expect(await linesOf(paid.body.journalEntryId)).toEqual({ "1020": [0, 40], "2020": [40, 0] });
  });

  it("rejects an incomplete workpaper computation before accepting an override", async () => {
    const t = await vatTenant("EUR");
    const rateId = await setAedRate(t, "EUR", 0.25);
    await foreignSale(t, "EUR", 1000);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await h.sql("UPDATE vat_returns SET engine_version = NULL WHERE id = $1", [ret.id]);
    await h.sql("DELETE FROM exchange_rates WHERE id = $1 AND company_id = $2", [
      rateId,
      t.company.id,
    ]);
    const filed = await t.as.post(`/api/vat-returns/${ret.id}/submit`, {
      ftaReferenceNumber: "FTA-INCOMPLETE",
      reconciliationOverrideReason: "An override cannot fill missing exchange-rate evidence",
    });
    expect(filed.status, filed.text).toBe(422);
    expect(filed.body.code).toBe("NO_EXCHANGE_RATE");
    expect((await getSettledReturn(t, ret.id)).status).toBe("draft");
    await h.sql("UPDATE vat_returns SET status='submitted' WHERE id=$1", [ret.id]);
    const olderSubmission = await t.as.post(`/api/vat-returns/${ret.id}/submit`, {
      ftaReferenceNumber: "FTA-INCOMPLETE",
    });
    expect(olderSubmission.status, olderSubmission.text).toBe(422);
    expect(olderSubmission.body.code).toBe("NO_EXCHANGE_RATE");
    expect((await getSettledReturn(t, ret.id)).status).toBe("submitted");
  });

  it("pays AED 200 from a USD ledger as USD 50 at the configured rate", async () => {
    const t = await vatTenant("USD");
    const bank = await accountByCode(t, "1020");
    await setAedRate(t, "USD", 0.25);
    await foreignSale(t, "USD", 1000);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await submit(ret.id, t);

    const url = `/api/vat-returns/${ret.id}/settlement`;
    const payment = { date: "2026-04-20", paymentAccountId: bank.id };
    const paid = await t.as.post(url, payment);
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body).toMatchObject({ outputVat: 200, inputVat: 0, netPayable: 200 });
    expect(await linesOf(paid.body.journalEntryId)).toEqual({
      "1020": [0, 50],
      "2020": [50, 0],
    });
    expect(await glBalance(t, "2020")).toBe(0);
    expect(Number((await getSettledReturn(t, ret.id)).paymentAmount)).toBe(200);

    await setAedRate(t, "USD", 0.2, payment.date);
    const replay = await t.as.post(url, payment);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body).toEqual(paid.body);
    expect((await t.as.get(url)).body.settlement).toMatchObject({
      kind: "payment",
      netPayable: 200,
    });

    const amendment = await t.as.post(`/api/vat-returns/${ret.id}/amend`, {
      reason: "Report the remaining taxable supply",
    });
    expect(amendment.status, amendment.text).toBe(201);
    await foreignSale(t, "USD", 200, "2026-03-01");
    expect(await generate(t, "2026-01-01", "2026-03-31")).toEqual(
      expect.objectContaining({ id: amendment.body.id })
    );
    await submit(amendment.body.id, t);
    const amendmentUrl = `/api/vat-returns/${amendment.body.id}/settlement`;
    const difference = await t.as.post(amendmentUrl, {
      ...payment,
      date: "2026-04-21",
    });
    expect(difference.status, difference.text).toBe(201);
    expect(difference.body).toMatchObject({
      outputVat: 40,
      inputVat: 0,
      netPayable: 40,
      previouslySettled: { returnIds: [ret.id], outputVat: 200, inputVat: 0, netPaid: 200 },
    });
    expect(await linesOf(difference.body.journalEntryId)).toEqual({
      "1020": [0, 8],
      "2020": [10, 0],
      "4090": [0, 2],
    });
    expect(await glBalance(t, "2020")).toBe(0);
  });

  it("settles and reverses a USD carrying-value change with unchanged AED VAT and no cash", async () => {
    const t = await vatTenant("USD");
    const bank = await accountByCode(t, "1020");
    await setAedRate(t, "USD", 0.25);
    const originalInvoice = await foreignSale(t, "USD", 1000);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await submit(ret.id, t);
    const payment = { date: "2026-04-20", paymentAccountId: bank.id };
    const paid = await t.as.post(`/api/vat-returns/${ret.id}/settlement`, payment);
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body.netPayable).toBe(200);

    const amendment = await t.as.post(`/api/vat-returns/${ret.id}/amend`, {
      reason: "Replace the original invoice with the corrected sale",
    });
    expect(amendment.status, amendment.text).toBe(201);
    const voided = await t.as.patch(`/api/invoices/${originalInvoice}/status`, { status: "void" });
    expect(voided.status, voided.text).toBe(200);
    await setAedRate(t, "USD", 0.2, "2026-03-01");
    await foreignSale(t, "USD", 800, "2026-03-01");
    const id = amendment.body.id as string;
    expect(await generate(t, "2026-01-01", "2026-03-31")).toMatchObject({ id });
    await submit(id, t);
    expect(await glBalance(t, "2020")).toBe(10);

    const url = `/api/vat-returns/${id}/settlement`;
    const correction = { ...payment, date: "2026-04-21" };
    const settled = await t.as.post(url, correction);
    expect(settled.status, settled.text).toBe(201);
    expect(settled.body).toMatchObject({
      outputVat: 0,
      inputVat: 0,
      netPayable: 0,
      previouslySettled: { returnIds: [ret.id], outputVat: 200, netPaid: 200 },
    });
    expect(await linesOf(settled.body.journalEntryId)).toEqual({
      "2020": [0, 10],
      "5140": [10, 0],
    });
    expect(await glBalance(t, "2020")).toBe(0);
    expect((await t.as.get(url)).body.settlement).toMatchObject({ kind: "none", netPayable: 0 });
    expect(Number((await getSettledReturn(t, id)).paymentAmount)).toBe(0);
    const replay = await t.as.post(url, correction);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body).toEqual(settled.body);

    const reverse = await t.as.post(`${url}/reverse`, {
      date: "2026-04-22",
      reason: "Undo the adjustment",
    });
    expect(reverse.status, reverse.text).toBe(200);
    expect(await glBalance(t, "2020")).toBe(10);
    expect((await t.as.get(url)).body.settlement).toBeNull();
    expect((await getSettledReturn(t, id)).paymentAmount).toBeNull();
  });

  it("refunds at the dated rate, clears the USD carrying amount, and reverses both currencies", async () => {
    const t = await vatTenant("USD");
    const bank = await accountByCode(t, "1020");
    await h.sql(
      `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
       VALUES ($1, 'AED current account', 'FAB', 'AED', $2)`,
      [t.company.id, bank.id]
    );
    await setAedRate(t, "USD", 0.25);
    const bill = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Supplier",
      vendor_trn: "100000000000029",
      bill_number: "USD-BILL-1",
      bill_date: "2026-03-10",
      due_date: "2026-12-31",
      currency: "USD",
      line_items: [{ description: "Taxable purchase", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    const approved = await t.as.post(`/api/bills/${bill.body.id}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await submit(ret.id, t);

    await setAedRate(t, "USD", 0.3, "2026-04-20");
    await setAedRate(t, "USD", 0.2, "2026-04-21");
    const url = `/api/vat-returns/${ret.id}/settlement`;
    const refunded = await t.as.post(url, { date: "2026-04-20", paymentAccountId: bank.id });
    expect(refunded.status, refunded.text).toBe(201);
    expect(refunded.body).toMatchObject({ outputVat: 0, inputVat: 200, netPayable: -200 });
    expect(await linesOf(refunded.body.journalEntryId)).toEqual({
      "1020": [60, 0],
      "1050": [0, 50],
      "4090": [0, 10],
    });
    expect(await glBalance(t, "1050")).toBe(0);
    expect(Number((await getSettledReturn(t, ret.id)).paymentAmount)).toBe(-200);
    expect((await t.as.get(url)).body.settlement).toMatchObject({
      kind: "refund",
      netPayable: -200,
    });

    const reversed = await t.as.post(`${url}/reverse`, {
      date: "2026-04-22",
      reason: "Refund returned",
    });
    expect(reversed.status, reversed.text).toBe(200);
    const [entries] = await h.sql<{ reversed_by_entry_id: string }>(
      "SELECT reversed_by_entry_id FROM journal_entries WHERE id = $1",
      [refunded.body.journalEntryId]
    );
    expect(await linesOf(entries.reversed_by_entry_id)).toEqual({
      "1020": [0, 60],
      "1050": [50, 0],
      "4090": [10, 0],
    });
    const tags = await h.sql(
      `SELECT foreign_currency AS currency, foreign_debit::text AS debit,
              foreign_credit::text AS credit, exchange_rate::text AS rate
         FROM journal_lines WHERE entry_id IN ($1, $2) AND account_id = $3
        ORDER BY foreign_debit DESC`,
      [refunded.body.journalEntryId, entries.reversed_by_entry_id, bank.id]
    );
    expect(tags).toEqual([
      { currency: "AED", debit: "200.00", credit: "0.00", rate: "0.300000" },
      { currency: "AED", debit: "0.00", credit: "200.00", rate: "0.300000" },
    ]);
    expect((await t.as.get(url)).body.settlement).toBeNull();
    expect((await getSettledReturn(t, ret.id)).paymentAmount).toBeNull();

    const retried = await t.as.post(url, { date: "2026-04-23", paymentAccountId: bank.id });
    expect(retried.status, retried.text).toBe(201);
    expect(retried.body.journalEntryId).not.toBe(refunded.body.journalEntryId);
    expect(retried.body.netPayable).toBe(-200);
    expect(await linesOf(retried.body.journalEntryId)).toEqual({
      "1020": [40, 0],
      "1050": [0, 50],
      "5140": [10, 0],
    });
    expect(await glBalance(t, "1050")).toBe(0);
  });

  it("rounds the net AED remittance and clears the frozen gross USD controls", async () => {
    const t = await vatTenant("USD");
    const bank = await accountByCode(t, "1020");
    await setAedRate(t, "USD", 0.25);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    // Snapshot fixture carries both controls in USD, even when a gross AED amount
    // is too small to translate to a cent at the later settlement rate.
    const setFiledAmounts = (outputAedFils: number) =>
      h.sql(
        `UPDATE vat_returns SET status = 'filed', reconciliation_snapshot = $2::jsonb,
               box12_total_due_tax = $3, box13_recoverable_tax = 0.01, box14_payable_tax = $4
         WHERE id = $1`,
        [
          ret.id,
          JSON.stringify({
            filingReconciliation: {
              outputAedFils,
              inputAedFils: 1,
              members: [
                {
                  companyId: t.company.id,
                  baseCurrency: "USD",
                  outputAedFils,
                  inputAedFils: 1,
                  outputBaseFils: 2,
                  inputBaseFils: 1,
                  ledgerOutputBaseFils: 2,
                  ledgerInputBaseFils: 1,
                },
              ],
            },
          }),
          outputAedFils / 100,
          (outputAedFils - 1) / 100,
        ]
      );
    await setFiledAmounts(2);
    const url = `/api/vat-returns/${ret.id}/settlement`;
    const payment = { date: "2026-04-20", paymentAccountId: bank.id };
    const tooSmall = await t.as.post(url, payment);
    expect(tooSmall.status, tooSmall.text).toBe(422);
    expect(tooSmall.body.code).toBe("VAT_SETTLEMENT_ROUNDS_TO_ZERO");
    expect((await t.as.get(url)).body.settlement).toBeNull();

    await setFiledAmounts(6);
    const paid = await t.as.post(url, payment);
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body).toMatchObject({ outputVat: 0.06, inputVat: 0.01, netPayable: 0.05 });
    expect(await linesOf(paid.body.journalEntryId)).toEqual({
      "1020": [0, 0.01],
      "2020": [0.02, 0],
      "1050": [0, 0.01],
    });
    const replay = await t.as.post(url, payment);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body).toEqual(paid.body);
    expect((await t.as.get(url)).body.settlement.netPayable).toBe(0.05);
  });

  it("keeps the return unpaid and writes no journal when the effective settlement rate is missing", async () => {
    const t = await vatTenant("EUR");
    const bank = await accountByCode(t, "1020");
    const historicalRateId = await setAedRate(t, "EUR", 0.25);
    await foreignSale(t, "EUR", 1000);
    const ret = await generate(t, "2026-01-01", "2026-03-31");
    await submit(ret.id, t);
    await h.sql("DELETE FROM exchange_rates WHERE id = $1 AND company_id = $2", [
      historicalRateId,
      t.company.id,
    ]);
    await setAedRate(t, "EUR", 0.25, "2026-04-21");

    const url = `/api/vat-returns/${ret.id}/settlement`;
    const payment = { date: "2026-04-20", paymentAccountId: bank.id };
    const missing = await t.as.post(url, payment);
    expect(missing.status, missing.text).toBe(422);
    expect(missing.body).toMatchObject({
      code: "NO_EXCHANGE_RATE",
      details: { from: "AED", to: "EUR", date: "2026-04-20" },
    });
    expect((await t.as.get(url)).body.settlement).toBeNull();
    expect(
      await h.sql("SELECT id FROM journal_entries WHERE company_id = $1 AND source_id = $2", [
        t.company.id,
        ret.id,
      ])
    ).toEqual([]);
    const unpaid = await getSettledReturn(t, ret.id);
    expect(unpaid.paymentStatus ?? "unpaid").toBe("unpaid");
    expect(unpaid.paymentAmount).toBeNull();

    await setAedRate(t, "EUR", 0.25, payment.date);
    const posted = await t.as.post(url, payment);
    expect(posted.status, posted.text).toBe(201);
    expect(posted.body.netPayable).toBe(200);
    expect(await linesOf(posted.body.journalEntryId)).toEqual({
      "1020": [0, 50],
      "2020": [50, 0],
    });
  });

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
