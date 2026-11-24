import { describe, expect, it, vi } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function vatTenant(currency = "AED", trn = "100000000000003") {
  return h.createTenant({
    companyColumns: {
      base_currency: currency,
      trn_vat_number: trn,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
}

async function issueService(t: Tenant, date: string, supplyDate: string, currency = "AED") {
  const draft = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Service customer",
    placeOfSupplyEmirate: "dubai",
    date,
    supplyDate,
    currency,
    lines: [{ description: "Completed service", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  const issue = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issue.status, issue.text).toBe(200);
  return draft.body.id as string;
}

async function vatReturn(t: Tenant, from: string, to: string) {
  const r = await t.as.get(`/api/companies/${t.company.id}/vat/compute?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function vatBoxes(t: Tenant, from: string, to: string) {
  return (await vatReturn(t, from, to)).boxes;
}

async function fileQ1(t: Tenant) {
  const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, {
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });
  expect(gen.status, gen.text).toBe(201);
  const filed = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
    ftaReferenceNumber: "AUDIT-TAX-POINT",
    filedOn: "2026-04-03",
  });
  expect(filed.status, filed.text).toBe(200);
}

async function deposit(t: Tenant) {
  const bank = await accountByCode(t, "1020");
  const dep = await t.as.post(`/api/companies/${t.company.id}/customer-deposits`, {
    customerName: "Service customer",
    date: "2026-03-05",
    amount: 105,
    vatTreatment: "standard",
    paymentAccountId: bank.id,
  });
  expect(dep.status, dep.text).toBe(201);
  return dep.body.creditId as string;
}

async function writtenOffInvoice(t: Tenant) {
  const base = `/api/companies/${t.company.id}`;
  const invoiceId = await issueService(t, "2026-01-05", "2026-01-05");
  const writeOff = await t.as.post(`${base}/invoices/${invoiceId}/write-off`, {
    date: "2026-08-18",
    reason: "Insolvency",
  });
  expect(writeOff.status, writeOff.text).toBe(201);
  return invoiceId;
}

async function claimRelief(t: Tenant, invoiceId: string, expectedVat = 50) {
  const claim = await t.as.post(`/api/companies/${t.company.id}/vat/bad-debt-relief`, {
    invoiceId,
    claimDate: "2026-08-20",
    writtenOff: true,
    customerNotified: true,
    customerNotifiedAt: "2026-08-19",
  });
  expect(claim.status, claim.text).toBe(201);
  expect(Number(claim.body.vatAmount)).toBe(expectedVat);
  return claim.body.id as string;
}

async function claimedInvoice(t: Tenant) {
  const invoiceId = await writtenOffInvoice(t);
  return { invoiceId, claimId: await claimRelief(t, invoiceId) };
}

async function fileQ3(t: Tenant) {
  const generated = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, {
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
  });
  expect(generated.status, generated.text).toBe(201);
  const filed = await t.as.post(`/api/vat-returns/${generated.body.id}/submit`, {
    ftaReferenceNumber: "AUDIT-RECOVERY-Q3",
    filedOn: "2026-10-01",
  });
  expect(filed.status, filed.text).toBe(200);
}

async function unprocessedReceipt(t: Tenant, invoiceId: string) {
  const { reinstateWriteOffs } = await import("../../server/services/invoice-payment.service");
  const { storage } = await import("../../server/storage");
  const companyId = t.company.id;
  const bank = await accountByCode(t, "1020");
  const ar = await accountByCode(t, "1040");
  await reinstateWriteOffs({
    invoiceId,
    companyId,
    date: "2026-09-15",
    reason: "Bad debt recovered",
    userId: t.user.id,
  });
  return (amount: number, date = "2026-09-15") =>
    storage.recordInvoicePayment({
      companyId,
      invoiceId,
      amount,
      date: new Date(date),
      method: "bank",
      paymentAccountId: bank.id,
      receivableAccountId: ar.id,
      createdBy: t.user.id,
    });
}

describe("Accounting audit — VAT 201", () => {
  it("assigns an unpaid service completed on 31 March to Q1 when invoiced on 2 April", async () => {
    const t = await vatTenant();
    await issueService(t, "2026-04-02", "2026-03-31");

    const q1 = await vatBoxes(t, "2026-01-01", "2026-03-31");
    const q2 = await vatBoxes(t, "2026-04-01", "2026-06-30");
    expect([q1.box1bDubaiVat, q2.box1bDubaiVat]).toEqual([50, 0]);

    const base = `/api/companies/${t.company.id}`;
    await fileQ1(t);

    const late = await t.as.post(`${base}/invoices`, {
      customerName: "Late service customer",
      placeOfSupplyEmirate: "dubai",
      date: "2026-04-04",
      supplyDate: "2026-03-31",
      lines: [{ description: "Completed service", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(late.status, late.text).toBe(200);
    const issue = await t.as.patch(`/api/invoices/${late.body.id}/status`, { status: "sent" });
    expect(issue.status, issue.text).toBe(409);
    expect(issue.body.code).toBe("VAT_PERIOD_FILED");
  });

  it("offsets the March advance in the March tax period when applied in April", async () => {
    const t = await vatTenant();
    const base = `/api/companies/${t.company.id}`;
    const creditId = await deposit(t);
    const invoiceId = await issueService(t, "2026-04-02", "2026-03-31");
    const apply = (id: string) =>
      t.as.post(`${base}/customer-credits/${id}/apply`, {
        invoiceId,
        amount: 105,
        date: "2026-04-02",
      });
    const applied = await apply(creditId);
    expect(applied.status, applied.text).toBe(201);
    const q1 = await vatReturn(t, "2026-01-01", "2026-03-31");
    const q2 = await vatReturn(t, "2026-04-01", "2026-06-30");
    expect([q1.boxes.box1bDubaiVat, q2.boxes.box1bDubaiVat]).toEqual([50, 0]);
    expect([q1.reconciliation.ledgerOutputVatFils, q2.reconciliation.ledgerOutputVatFils]).toEqual([
      5000, 0,
    ]);
    const secondCredit = await deposit(t);
    await fileQ1(t);
    const refused = await apply(secondCredit);
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("VAT_PERIOD_FILED");
  });

  it("keeps an April sale in April when a backdated receipt mostly becomes customer credit", async () => {
    const t = await vatTenant();
    const base = `/api/companies/${t.company.id}`;
    const invoiceId = await issueService(t, "2026-04-02", "2026-04-02");
    const bank = await accountByCode(t, "1020");
    const pay = (amount: number, date: string, allowCredit = false) =>
      t.as.post(`${base}/invoices/${invoiceId}/payments`, {
        amount,
        date,
        paymentAccountId: bank.id,
        allowCredit,
      });
    const partial = await pay(1000, "2026-04-05");
    expect(partial.status, partial.text).toBe(201);
    await fileQ1(t);
    const excess = await pay(1050, "2026-03-31", true);
    expect(excess.status, excess.text).toBe(201);
    const [credit] = await h.sql<{ amount: string }>(
      "SELECT amount FROM customer_credits WHERE company_id = $1 AND source_id = $2",
      [t.company.id, excess.body.payment.id]
    );
    expect(Number(credit.amount)).toBe(1000);
    const q1 = await vatBoxes(t, "2026-01-01", "2026-03-31");
    const q2 = await vatBoxes(t, "2026-04-01", "2026-06-30");
    expect([q1.box1bDubaiVat, q2.box1bDubaiVat]).toEqual([0, 50]);
    const fullInvoice = await issueService(t, "2026-04-02", "2026-04-02");
    const refused = await t.as.post(`${base}/invoices/${fullInvoice}/payments`, {
      amount: 1050,
      date: "2026-03-31",
      paymentAccountId: bank.id,
    });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("VAT_PERIOD_FILED");
  });

  it("prevents filing an obsolete generated amount after another supply is posted", async () => {
    const t = await vatTenant();
    const base = `/api/companies/${t.company.id}`;
    await issueService(t, "2026-01-15", "2026-01-15");
    const gen = await t.as.post(`${base}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(gen.status, gen.text).toBe(201);
    expect(Number(gen.body.box14PayableTax)).toBe(50);
    await issueService(t, "2026-02-15", "2026-02-15");
    const current = await vatBoxes(t, "2026-01-01", "2026-03-31");
    expect(current.box14PayableTax).toBe(100);
    const submit = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {});
    expect([200, 409]).toContain(submit.status);
    // A submission may ask the accountant to regenerate, or store the complete recomputed return.
    if (submit.status === 409) {
      expect(submit.body.code).toBe("VAT_RETURN_STALE");
    } else {
      expect(Number(submit.body.box14PayableTax)).toBe(100);
    }
  });

  it("waits for the filing lock before taking the quarter-end payment journal number", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const t = await vatTenant();
    const companyId = t.company.id;
    const invoiceId = await issueService(t, "2026-04-02", "2026-04-02");
    const bank = await accountByCode(t, "1020");
    const { withLedgerTx } = await import("../../server/ledger");
    const { allocateEntryNumber } = await import("../../server/ledger/numbering");
    const { ledgerQueryable } = await import("../../server/ledger/tx");
    const { lockVatReturns } = await import("../../server/ledger/vat-lock");
    const { lockPeriodPolicy } = await import("../../server/services/period-lock.service");
    let payment: ReturnType<Tenant["as"]["post"]> | undefined;
    try {
      await withLedgerTx(async (tx) => {
        const q = ledgerQueryable(tx);
        const {
          rows: [blocker],
        } = await q.query("SELECT pg_backend_pid() AS pid");
        await lockPeriodPolicy(tx, companyId, "shared");
        await lockVatReturns(tx, companyId);
        payment = t.as.post(`/api/companies/${companyId}/invoices/${invoiceId}/payments`, {
          amount: 1050,
          date: "2026-03-31",
          paymentAccountId: bank.id,
        });
        await vi.waitFor(
          async () => {
            const waiting = await h.sql(
              "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1::int = ANY(pg_blocking_pids(pid))",
              [blocker.pid]
            );
            expect(waiting).toHaveLength(1);
          },
          { timeout: 8000, interval: 25 }
        );
        // This is the number a period-end partial-exemption posting must be able to take.
        await q.query("SET LOCAL lock_timeout = '500ms'");
        expect(await allocateEntryNumber(tx, companyId, new Date("2026-03-31"))).toMatch(
          /^JE-20260331-/
        );
      });
    } finally {
      await payment;
    }
    const result = await payment!;
    expect(result.status, result.text).toBe(201);
  });

  it("settles an AED return in a USD ledger at the unchanged 4 AED per USD rate", async () => {
    const t = await vatTenant("USD");
    const base = `/api/companies/${t.company.id}`;
    const bank = await accountByCode(t, "1020");
    const rate = await t.as.post(`${base}/exchange-rates`, {
      fromCurrency: "AED",
      rate: 0.25,
      effectiveDate: "2026-03-24",
    });
    expect(rate.status, rate.text).toBe(201);
    await issueService(t, "2026-03-25", "2026-03-25", "USD");
    const gen = await t.as.post(`${base}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(gen.status, gen.text).toBe(201);
    expect(Number(gen.body.box14PayableTax)).toBe(200);
    const url = `/api/vat-returns/${gen.body.id}`;
    const ready = await t.as.post(`${url}/ready`, {});
    expect(ready.status, ready.text).toBe(200);
    const filed = await t.as.post(`${url}/submit`, {
      ftaReferenceNumber: "AUDIT-Q1",
      filedOn: "2026-04-01",
    });
    expect(filed.status, filed.text).toBe(200);
    const paid = await t.as.post(`${url}/settlement`, {
      date: "2026-04-02",
      paymentAccountId: bank.id,
    });
    expect(paid.status, paid.text).toBe(201);
    const rows = await h.sql<{ code: string; net: string }>(
      `SELECT a.code, SUM(jl.debit - jl.credit)::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND a.code IN ('1020', '2020')
        GROUP BY a.code`,
      [t.company.id]
    );
    // USD 50 of tax arose. Paying AED 200 at the unchanged rate clears USD 50 from bank and VAT.
    expect(Object.fromEntries(rows.map((r) => [r.code, Number(r.net)]))).toEqual({
      "1020": -50,
      "2020": 0,
    });
  });

  it("clears the member's VAT liability when the representative settles the group return", async () => {
    const rep = await vatTenant();
    const member = await vatTenant("AED", "100000000000011");
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
      member.company.id,
      rep.user.id,
    ]);
    const base = `/api/companies/${rep.company.id}`;
    const group = await rep.as.put(`${base}/vat/group`, {
      name: "Audit VAT group",
      groupTrn: "100000000000029",
      memberCompanyIds: [member.company.id],
    });
    expect(group.status, group.text).toBe(200);
    await issueService(member, "2026-03-25", "2026-03-25");
    const gen = await rep.as.post(`${base}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(gen.status, gen.text).toBe(201);
    expect(Number(gen.body.box14PayableTax)).toBe(50);
    const url = `/api/vat-returns/${gen.body.id}`;
    const filed = await rep.as.post(`${url}/submit`, {
      ftaReferenceNumber: "GROUP-Q1",
      filedOn: "2026-04-01",
    });
    expect(filed.status, filed.text).toBe(200);
    const bank = await accountByCode(rep, "1020");
    const paid = await rep.as.post(`${url}/settlement`, {
      date: "2026-04-02",
      paymentAccountId: bank.id,
    });
    expect(paid.status, paid.text).toBe(201);
    const rows = await h.sql<{ company_id: string; net: string }>(
      `SELECT je.company_id, SUM(jl.debit - jl.credit)::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id IN ($1, $2) AND je.status = 'posted' AND a.code = '2020'
        GROUP BY je.company_id`,
      [rep.company.id, member.company.id]
    );
    const balances = new Map(rows.map((r) => [r.company_id, Number(r.net)]));
    // Only the member made a taxable sale. The FTA was paid in full, so any outstanding
    // amount between the companies belongs in their intercompany accounts.
    expect({
      representative: balances.get(rep.company.id) ?? 0,
      member: balances.get(member.company.id) ?? 0,
    }).toEqual({ representative: 0, member: 0 });
  });

  it("reinstates only the VAT included in a partial recovery of a written-off invoice", async () => {
    const t = await vatTenant();
    const base = `/api/companies/${t.company.id}`;
    const { invoiceId } = await claimedInvoice(t);
    const bank = await accountByCode(t, "1020");
    const partial = await t.as.post(`${base}/invoices/${invoiceId}/payments`, {
      amount: 105,
      date: "2026-10-05",
      method: "bank",
      paymentAccountId: bank.id,
    });
    expect(partial.status, partial.text).toBe(201);
    const q4 = await vatBoxes(t, "2026-10-01", "2026-12-31");
    expect(q4.box1bDubaiAdj).toBe(5);
    expect(partial.body.badDebtReliefReversal).toMatchObject({ remainingVatFils: 4_500 });

    const remainder = await t.as.post(`${base}/invoices/${invoiceId}/payments`, {
      amount: 945,
      date: "2026-10-06",
      method: "bank",
      paymentAccountId: bank.id,
    });
    expect(remainder.status, remainder.text).toBe(201);
    expect(remainder.body.badDebtReliefReversal).toMatchObject({ remainingVatFils: 0 });
    expect((await vatBoxes(t, "2026-10-01", "2026-12-31")).box1bDubaiAdj).toBe(50);
  });

  it("posts each committed bad-debt receipt in its own quarter when the later callback runs first", async () => {
    const t = await vatTenant();
    const { invoiceId, claimId } = await claimedInvoice(t);
    const { reverseInvoicePayment } = await import("../../server/services/invoice-payment.service");
    const { reverseReliefOnPayment } = await import("../../server/tax/vat-adjustments.service");
    const companyId = t.company.id;
    // Use the storage seam to commit the cash receipts before invoking their callbacks.
    const pay = await unprocessedReceipt(t, invoiceId);
    const september = await pay(105, "2026-09-15");
    const october = await pay(945, "2026-10-05");
    const recover = (paymentId: string) =>
      reverseReliefOnPayment({ companyId, invoiceId, paymentId });
    expect(await recover(october.payment.id)).toMatchObject({ claimId, remainingVatFils: 0 });
    expect(await recover(september.payment.id)).toBeNull();
    expect(await recover(october.payment.id)).toBeNull();
    expect((await vatBoxes(t, "2026-07-01", "2026-09-30")).box1bDubaiAdj).toBe(-45);
    expect((await vatBoxes(t, "2026-10-01", "2026-12-31")).box1bDubaiAdj).toBe(45);

    await fileQ3(t);
    const reversal = {
      companyId,
      paymentId: september.payment.id,
      actorId: t.user.id,
      reason: "Payment returned",
    };
    await expect(reverseInvoicePayment({ ...reversal, date: "2026-09-15" })).rejects.toMatchObject({
      code: "VAT_PERIOD_FILED",
    });
    expect((await reverseInvoicePayment({ ...reversal, date: "2026-10-06" })).reversed).toBe(true);
    expect((await vatBoxes(t, "2026-07-01", "2026-09-30")).box1bDubaiAdj).toBe(-45);
    expect((await vatBoxes(t, "2026-10-01", "2026-12-31")).box1bDubaiAdj).toBe(40);
  });

  it("recovers a receipt whose transaction started before the claim acquired the invoice lock", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const t = await vatTenant();
    const invoiceId = await writtenOffInvoice(t);
    const companyId = t.company.id;
    const bank = await accountByCode(t, "1020");
    const ar = await accountByCode(t, "1040");
    const { withLedgerTx } = await import("../../server/ledger");
    const { ledgerQueryable } = await import("../../server/ledger/tx");
    const { reinstateWriteOffs } = await import("../../server/services/invoice-payment.service");
    const { storage } = await import("../../server/storage");
    const { reverseReliefOnPayment } = await import("../../server/tax/vat-adjustments.service");

    const { claimId, paymentId } = await withLedgerTx(async (tx) => {
      const q = ledgerQueryable(tx);
      await q.query("SELECT transaction_timestamp()");
      const claimId = await claimRelief(t, invoiceId);
      const {
        rows: [order],
      } = await q.query(
        "SELECT transaction_timestamp() < created_at AS started_before_claim FROM bad_debt_relief_claims WHERE id = $1",
        [claimId]
      );
      expect(order.started_before_claim).toBe(true);
      await reinstateWriteOffs({
        companyId,
        invoiceId,
        date: "2026-10-05",
        reason: "Bad debt recovered",
        userId: t.user.id,
        tx,
      });
      const { payment } = await storage.recordInvoicePayment({
        companyId,
        invoiceId,
        amount: 105,
        date: new Date("2026-10-05"),
        method: "bank",
        paymentAccountId: bank.id,
        receivableAccountId: ar.id,
        createdBy: t.user.id,
        tx,
      });
      return { claimId, paymentId: payment.id };
    });
    expect(await reverseReliefOnPayment({ companyId, invoiceId, paymentId })).toMatchObject({
      claimId,
      remainingVatFils: 4500,
    });
    expect(await reverseReliefOnPayment({ companyId, invoiceId, paymentId })).toBeNull();
    expect((await vatBoxes(t, "2026-10-01", "2026-12-31")).box1bDubaiAdj).toBe(5);
  });

  it.each([false, true])(
    "does not recover VAT on a receipt included in the claim calculation (historical: %s)",
    async (historical) => {
      const t = await vatTenant();
      const companyId = t.company.id;
      const invoiceId = await issueService(t, "2026-01-05", "2026-01-05");
      const bank = await accountByCode(t, "1020");
      const pay = async (date: string) => {
        const response = await t.as.post(
          `/api/companies/${companyId}/invoices/${invoiceId}/payments`,
          {
            amount: 105,
            date,
            paymentAccountId: bank.id,
          }
        );
        expect(response.status, response.text).toBe(201);
        return response.body;
      };
      const beforeClaim = await pay("2026-08-17");
      const writeOff = await t.as.post(
        `/api/companies/${companyId}/invoices/${invoiceId}/write-off`,
        {
          date: "2026-08-18",
          reason: "Insolvency",
        }
      );
      expect(writeOff.status, writeOff.text).toBe(201);
      const claimId = await claimRelief(t, invoiceId, 45);
      if (historical) {
        // Model a claim transaction that started before the receipt but read settlement after it.
        await h.sql(
          `UPDATE bad_debt_relief_claims SET created_at = (
             SELECT created_at - interval '1 second' FROM invoice_payments WHERE id = $2
           ) WHERE id = $1`,
          [claimId, beforeClaim.payment.id]
        );
        await h.sql(
          `UPDATE journal_entries SET memo_params = memo_params - 'receiptOrder'
            WHERE id = (SELECT journal_entry_id FROM bad_debt_relief_claims WHERE id = $1)`,
          [claimId]
        );
      }

      const afterClaim = await pay("2026-10-05");
      expect(afterClaim.badDebtReliefReversal).toMatchObject(
        historical
          ? { status: "failed", code: "BAD_DEBT_RECOVERY_REVIEW_REQUIRED" }
          : { status: "reversed", remainingVatFils: 4000 }
      );
      expect((await vatBoxes(t, "2026-07-01", "2026-09-30")).box1bDubaiAdj).toBe(-45);
      expect((await vatBoxes(t, "2026-10-01", "2026-12-31")).box1bDubaiAdj).toBe(
        historical ? 0 : 5
      );
    }
  );

  it.each([false, true])(
    "checks legacy VAT recovery attribution before reversing a receipt (ambiguous: %s)",
    async (ambiguous) => {
      const t = await vatTenant();
      const { invoiceId, claimId } = await claimedInvoice(t);
      const companyId = t.company.id;
      const { reverseBadDebtReliefClaim } =
        await import("../../server/tax/vat-adjustments.service");
      const { reverseInvoicePayment } =
        await import("../../server/services/invoice-payment.service");
      const pay = await unprocessedReceipt(t, invoiceId);
      const { payment } = await pay(105);
      if (ambiguous) await pay(105);
      // Reproduce the older callback's full reversal, with no journal key identifying the receipt.
      const legacy = await reverseBadDebtReliefClaim({
        companyId,
        claimId,
        userId: t.user.id,
        date: "2026-09-15",
        reason: "Payment received after bad-debt relief was claimed",
      });
      expect(legacy.reversalEntryId).toBeTruthy();
      expect((await vatBoxes(t, "2026-07-01", "2026-09-30")).box1bDubaiAdj).toBe(0);
      const reverse = (date: string) =>
        reverseInvoicePayment({
          companyId,
          paymentId: payment.id,
          actorId: t.user.id,
          reason: "Payment returned",
          date,
        });
      if (ambiguous) {
        await expect(reverse("2026-10-06")).rejects.toMatchObject({
          code: "BAD_DEBT_RECOVERY_REVIEW_REQUIRED",
        });
        expect(
          await h.sql("SELECT id FROM invoice_payments WHERE id = $1", [payment.id])
        ).toHaveLength(1);
        return;
      }

      await fileQ3(t);
      await expect(reverse("2026-09-15")).rejects.toMatchObject({ code: "VAT_PERIOD_FILED" });
      expect((await reverse("2026-10-06")).reversed).toBe(true);
      expect(
        await h.sql("SELECT status, reversal_entry_id FROM bad_debt_relief_claims WHERE id = $1", [
          claimId,
        ])
      ).toEqual([{ status: "claimed", reversal_entry_id: null }]);
      const q3 = await vatReturn(t, "2026-07-01", "2026-09-30");
      const q4 = await vatReturn(t, "2026-10-01", "2026-12-31");
      expect([q3.boxes.box1bDubaiAdj, q4.boxes.box1bDubaiAdj]).toEqual([0, -50]);
      expect(q3.reconciliation.hasUnexplainedDifference).toBe(false);
      expect(q4.reconciliation.hasUnexplainedDifference).toBe(false);
    }
  );

  it.each([false, true])(
    "rebalances the VAT rounding in the reversal quarter (receipt quarter filed: %s)",
    async (filed) => {
      const t = await vatTenant();
      const { invoiceId } = await claimedInvoice(t);
      const companyId = t.company.id;
      const bank = await accountByCode(t, "1020");
      const { reverseInvoicePayment } =
        await import("../../server/services/invoice-payment.service");
      const pay = async (amount: number, date: string) => {
        const response = await t.as.post(
          `/api/companies/${companyId}/invoices/${invoiceId}/payments`,
          {
            amount,
            date,
            paymentAccountId: bank.id,
          }
        );
        expect(response.status, response.text).toBe(201);
        return response.body;
      };
      const first = await pay(105.1, "2026-09-15");
      const second = await pay(105.01, "2026-09-16");
      expect(first.badDebtReliefReversal.remainingVatFils).toBe(4500);
      expect(second.badDebtReliefReversal.remainingVatFils).toBe(3999);
      if (filed) await fileQ3(t);
      const reversal = await reverseInvoicePayment({
        companyId,
        paymentId: first.payment.id,
        actorId: t.user.id,
        reason: "Payment returned",
        date: "2026-10-06",
      });
      expect(reversal.reversed).toBe(true);
      expect((await vatBoxes(t, "2026-07-01", "2026-09-30")).box1bDubaiAdj).toBe(-39.99);
      expect((await vatBoxes(t, "2026-10-01", "2026-12-31")).box1bDubaiAdj).toBe(-5.01);
      const replacement = await pay(105.1, "2026-10-07");
      expect(replacement.badDebtReliefReversal.remainingVatFils).toBe(3999);
      const q4 = await vatReturn(t, "2026-10-01", "2026-12-31");
      expect(q4.boxes.box1bDubaiAdj).toBe(0);
      expect(q4.reconciliation.hasUnexplainedDifference).toBe(false);
    }
  );

  it("reopens a fully recovered claim when its AED 105 receipt is reversed and restores VAT on repayment", async () => {
    const t = await vatTenant();
    const { invoiceId, claimId } = await claimedInvoice(t);
    const companyId = t.company.id;
    const bank = await accountByCode(t, "1020");
    const { reverseInvoicePayment } = await import("../../server/services/invoice-payment.service");
    const pay = (amount: number) =>
      t.as.post(`/api/companies/${companyId}/invoices/${invoiceId}/payments`, {
        amount,
        date: "2026-10-05",
        paymentAccountId: bank.id,
      });
    const remainder = await pay(945);
    expect(remainder.status, remainder.text).toBe(201);
    const last = await pay(105);
    expect(last.status, last.text).toBe(201);
    expect(last.body.badDebtReliefReversal).toMatchObject({ remainingVatFils: 0 });
    const reversed = await reverseInvoicePayment({
      companyId,
      paymentId: last.body.payment.id,
      actorId: t.user.id,
      reason: "Payment returned",
    });
    expect(reversed.reversed).toBe(true);
    const [claim] = await h.sql(
      "SELECT status, reversed_at FROM bad_debt_relief_claims WHERE id = $1",
      [claimId]
    );
    expect(claim).toMatchObject({ status: "claimed", reversed_at: null });
    const q4 = await vatReturn(t, "2026-10-01", "2026-12-31");
    expect(q4.boxes.box1bDubaiAdj).toBe(45);
    expect(q4.reconciliation.hasUnexplainedDifference).toBe(false);
    const replacement = await pay(105);
    expect(replacement.status, replacement.text).toBe(201);
    expect(replacement.body.badDebtReliefReversal).toMatchObject({ remainingVatFils: 0 });
    expect((await vatBoxes(t, "2026-10-01", "2026-12-31")).box1bDubaiAdj).toBe(50);
  });
});
