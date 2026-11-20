import { describe, expect, it } from "vitest";
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

async function vatBoxes(t: Tenant, from: string, to: string) {
  const r = await t.as.get(`/api/companies/${t.company.id}/vat/compute?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return r.body.boxes;
}

describe("Accounting audit — VAT 201", () => {
  it("assigns an unpaid service completed on 31 March to Q1 when invoiced on 2 April", async () => {
    const t = await vatTenant();
    await issueService(t, "2026-04-02", "2026-03-31");

    const q1 = await vatBoxes(t, "2026-01-01", "2026-03-31");
    const q2 = await vatBoxes(t, "2026-04-01", "2026-06-30");
    expect([q1.box1bDubaiVat, q2.box1bDubaiVat]).toEqual([50, 0]);
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
    const invoiceId = await issueService(t, "2026-01-05", "2026-01-05");
    const writeOff = await t.as.post(`${base}/invoices/${invoiceId}/write-off`, {
      date: "2026-08-18",
      reason: "Insolvency",
    });
    expect(writeOff.status, writeOff.text).toBe(201);
    const claim = await t.as.post(`${base}/vat/bad-debt-relief`, {
      invoiceId,
      claimDate: "2026-08-20",
      writtenOff: true,
      customerNotified: true,
      customerNotifiedAt: "2026-08-19",
    });
    expect(claim.status, claim.text).toBe(201);
    expect(Number(claim.body.vatAmount)).toBe(50);
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
  });
});
