/**
 * A4 accounting audit (payroll / corporate tax / period end) against real Postgres. Every
 * scenario posts through the public API and asserts the exact journal lines and figures:
 *
 *  M10  first payroll run: opening gratuity provision required, only the month is expensed
 *  M11  Abu Dhabi Pension Fund (employee 5% / employer 15%) next to GPSSA (5% / 12.5%)
 *  M14  pension contribution payment per fund (Dr 2032 / Cr bank), capped at the liability
 *  M12  month-end control-account ties (pension, gratuity, AR) open the close step
 *  M2   year-end CT accrual, true-up on filing (period open / locked), deferred tax journal
 *  M13  tax losses brought forward from a return filed outside Muhasib
 *  M1   customer deposit: VAT on receipt, applied to the invoice without double VAT
 *  L1 L3 L4 L5 L6 L8  low findings
 */
import { describe, expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const TRN = "100000000000003";

async function bal(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0].n);
}

async function linesOf(entryId: string) {
  const rows = await h.sql<{ code: string; debit: string; credit: string; fc: string | null }>(
    `SELECT a.code, jl.debit::text, jl.credit::text, jl.foreign_currency AS fc
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 ORDER BY a.code, jl.debit DESC`,
    [entryId]
  );
  return rows.map((r) => ({
    code: r.code,
    debit: Number(r.debit),
    credit: Number(r.credit),
    fc: r.fc,
  }));
}

async function entryOf(t: Tenant, source: string, sourceId: string) {
  return h.sql<{ id: string; date: string; entry_kind: string }>(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, entry_kind FROM journal_entries
      WHERE company_id = $1 AND source = $2 AND source_id = $3 ORDER BY created_at`,
    [t.company.id, source, sourceId]
  );
}

async function employee(t: Tenant, body: Record<string, unknown>) {
  const r = await t.as.post(`/api/companies/${t.company.id}/employees`, body);
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

async function runFor(t: Tenant, month: number, year = 2026) {
  const r = await t.as.post(`/api/companies/${t.company.id}/payroll-runs`, {
    periodMonth: month,
    periodYear: year,
  });
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
}

// ─── Payroll ────────────────────────────────────────────────────────────────

describe("[A4][M10] first payroll run and the opening gratuity provision", () => {
  it("refuses the first run until the opening provision is entered, then expenses only the month", async () => {
    const t = await h.createTenant({ name: "A4Grat" });
    const emp = await employee(t, {
      fullName: "Long Service",
      nationality: "IN",
      joinDate: "2021-01-01",
      basicSalary: "10000.00",
    });
    const run = await runFor(t, 10);
    const refused = await t.as.post(`/api/payroll-runs/${run}/calculate`, {});
    expect(refused.status, refused.text).toBe(422);
    expect(refused.body.code).toBe("OPENING_GRATUITY_REQUIRED");
    const gap = refused.body.details.employees[0];
    expect(gap).toMatchObject({ employeeId: emp.id, asOf: "2026-09-30" });
    // 5 years x 21 days + 273/365 of a 30-day year, at basic / 30 (Art. 51). C2 (NL7): 1 Jan to
    // 30 Sep is 273 days of service, the last day included.
    const expected = Math.round((5 * 21 + (273 / 365) * 30) * (10000 / 30) * 100) / 100;
    expect(Number(gap.suggestedOpeningProvision)).toBeCloseTo(expected, 1);

    const set = await t.as.patch(`/api/employees/${emp.id}`, {
      openingGratuityProvision: gap.suggestedOpeningProvision,
      openingGratuityAsOf: "2026-09-30",
    });
    expect(set.status, set.text).toBe(200);
    const calc = await t.as.post(`/api/payroll-runs/${run}/calculate`, {});
    expect(calc.status, calc.text).toBe(200);
    const [item] = await h.sql<{ gratuity_accrual: string }>(
      `SELECT gratuity_accrual FROM payroll_items WHERE payroll_run_id = $1`,
      [run]
    );
    // October movement only: 31/365 x 30 days x 333.33 = 849.32 (not 5y9m of history).
    expect(Number(item.gratuity_accrual)).toBe(849.32);
    const approved = await t.as.post(`/api/payroll-runs/${run}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    const lines = await linesOf(approved.body.journal_entry_id ?? approved.body.journalEntryId);
    expect(lines.find((l) => l.code === "5028")?.debit).toBe(849.32);
    expect(lines.find((l) => l.code === "2036")?.credit).toBe(849.32);
  });

  it("an explicit nil opening provision keeps the documented full catch-up", async () => {
    const t = await h.createTenant({ name: "A4GratNil" });
    await employee(t, {
      fullName: "No Provision",
      nationality: "IN",
      joinDate: "2021-01-01",
      basicSalary: "10000.00",
      openingGratuityProvision: "0.00",
    });
    const run = await runFor(t, 10);
    const calc = await t.as.post(`/api/payroll-runs/${run}/calculate`, {});
    expect(calc.status, calc.text).toBe(200);
    const [item] = await h.sql<{ gratuity_accrual: string }>(
      `SELECT gratuity_accrual FROM payroll_items WHERE payroll_run_id = $1`,
      [run]
    );
    expect(Number(item.gratuity_accrual)).toBeGreaterThan(40_000);
  });
});

describe("[A4][M11][M14][M12] ADPF, pension payments and payroll control ties", () => {
  it("ADPF members contribute 5% / 15%; each fund is paid from the bank; ties flag a manual 2032 journal", async () => {
    const t = await h.createTenant({ name: "A4Pension" });
    const c = `/api/companies/${t.company.id}`;
    const adpf = await employee(t, {
      fullName: "Abu Dhabi National",
      nationality: "AE",
      joinDate: "2022-01-01",
      basicSalary: "20000.00",
      housingAllowance: "5000.00",
      pensionScheme: "adpf",
    });
    await employee(t, {
      fullName: "Dubai National",
      nationality: "AE",
      joinDate: "2022-01-01",
      basicSalary: "20000.00",
      housingAllowance: "5000.00",
    });
    const run = await runFor(t, 9);
    expect((await t.as.post(`/api/payroll-runs/${run}/calculate`, {})).status).toBe(200);
    const items = await h.sql<{
      employee_id: string;
      pension_employee: string;
      pension_employer: string;
      pension_fund: string;
    }>(
      `SELECT employee_id, pension_employee, pension_employer, pension_fund
          FROM payroll_items WHERE payroll_run_id = $1`,
      [run]
    );
    const a = items.find((i) => i.employee_id === adpf.id)!;
    const g = items.find((i) => i.employee_id !== adpf.id)!;
    expect([a.pension_fund, Number(a.pension_employee), Number(a.pension_employer)]).toEqual([
      "adpf",
      1250,
      3750,
    ]);
    expect([g.pension_fund, Number(g.pension_employee), Number(g.pension_employer)]).toEqual([
      "gpssa",
      1250,
      3125,
    ]);
    const approved = await t.as.post(`/api/payroll-runs/${run}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    expect(await bal(t, "2032")).toBe(-(5000 + 4375) * 100);
    // C2 (NL6): 2032 holds the ADPF contributions too, and says so.
    const [p2032] = await h.sql<{ name_en: string; name_ar: string }>(
      `SELECT name_en, name_ar FROM accounts WHERE company_id = $1 AND code = '2032'`,
      [t.company.id]
    );
    expect(p2032.name_en).toBe("Pension Payable - GPSSA / ADPF");
    expect(p2032.name_ar).toContain("صندوق أبوظبي للمعاشات");

    const liability = await t.as.get(`${c}/payroll/pension-liability`);
    expect(liability.status, liability.text).toBe(200);
    expect(liability.body.funds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fund: "gpssa", outstanding: "4375.00" }),
        expect.objectContaining({ fund: "adpf", outstanding: "5000.00" }),
      ])
    );
    const bank = await accountByCode(t, "1020");
    const over = await t.as.post(`${c}/payroll/pension-payments`, {
      fund: "gpssa",
      amount: "4375.01",
      paymentDate: "2026-10-10",
      paymentAccountId: bank.id,
    });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe("PENSION_PAYMENT_EXCEEDS_LIABILITY");
    const ar = await accountByCode(t, "1040");
    const notBank = await t.as.post(`${c}/payroll/pension-payments`, {
      fund: "gpssa",
      amount: "100.00",
      paymentDate: "2026-10-10",
      paymentAccountId: ar.id,
    });
    expect(notBank.status).toBe(422);
    const paid = await t.as.post(`${c}/payroll/pension-payments`, {
      fund: "gpssa",
      amount: "4375.00",
      paymentDate: "2026-10-10",
      paymentAccountId: bank.id,
      periodYear: 2026,
      periodMonth: 9,
      reference: "GPSSA-SEP",
    });
    expect(paid.status, paid.text).toBe(201);
    expect(await linesOf(paid.body.journal_entry_id)).toEqual([
      { code: "1020", debit: 0, credit: 4375, fc: null },
      { code: "2032", debit: 4375, credit: 0, fc: null },
    ]);
    expect(await bal(t, "2032")).toBe(-5000 * 100);

    // Month-end (October): the pension tie holds; a manual journal to 2032 breaks it.
    const period = "period=2026-10";
    const ok = await t.as.get(`${c}/month-end/checklist?${period}`);
    expect(ok.status, ok.text).toBe(200);
    const list = (ok.body.checklist ?? ok.body.items ?? ok.body) as Array<Record<string, any>>;
    const step = list.find((i) => i.key === "control_accounts")!;
    const pensionTie = step.ties.find((x: any) => x.key === "pension");
    expect(pensionTie).toMatchObject({ glBalance: 5000, subledgerBalance: 5000, reconciled: true });
    await postJournalEntry(t, {
      date: "2026-10-15",
      description: "Manual pension adjustment",
      lines: [
        { code: "2032", debit: 100 },
        { code: "1020", credit: 100 },
      ],
    });
    const broken = await t.as.get(`${c}/month-end/checklist?${period}`);
    const step2 = (
      (broken.body.checklist ?? broken.body.items ?? broken.body) as Array<Record<string, any>>
    ).find((i) => i.key === "control_accounts")!;
    expect(step2.status).toBe("incomplete");
    expect(step2.ties.find((x: any) => x.key === "pension")).toMatchObject({
      glBalance: 4900,
      subledgerBalance: 5000,
      difference: -100,
      reconciled: false,
    });
    expect(step2.details).toContain("2032 (-100.00)");

    // Reversing the payment restores the GPSSA liability.
    const rev = await t.as.post(`${c}/payroll/pension-payments/${paid.body.id}/reverse`, {
      reason: "Paid twice by mistake",
    });
    expect(rev.status, rev.text).toBe(200);
    expect(await bal(t, "2032")).toBe(-(9375 - 100) * 100);
  });

  it("[L6] a run cannot be approved before its month; inside the month it accrues today, not in the future", async () => {
    const t = await h.createTenant({ name: "A4Future" });
    await employee(t, {
      fullName: "Future",
      nationality: "IN",
      joinDate: "2026-01-01",
      basicSalary: "5000.00",
      openingGratuityProvision: "0.00",
    });
    const now = new Date(Date.now() + 4 * 3600_000);
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const future = await runFor(t, next.getUTCMonth() + 1, next.getUTCFullYear());
    expect((await t.as.post(`/api/payroll-runs/${future}/calculate`, {})).status).toBe(200);
    const early = await t.as.post(`/api/payroll-runs/${future}/approve`, {});
    expect(early.status).toBe(422);
    expect(early.body.code).toBe("PAYROLL_PERIOD_NOT_STARTED");

    const current = await runFor(t, now.getUTCMonth() + 1, now.getUTCFullYear());
    expect((await t.as.post(`/api/payroll-runs/${current}/calculate`, {})).status).toBe(200);
    const ok = await t.as.post(`/api/payroll-runs/${current}/approve`, {});
    expect(ok.status, ok.text).toBe(200);
    const [je] = await entryOf(t, "payroll", current);
    expect(je.date <= dubaiToday()).toBe(true);
    // `now` is already shifted +4h (Dubai wall clock), so its UTC fields are the Dubai month.
    expect(je.date.slice(0, 7)).toBe(now.toISOString().slice(0, 7));
  });
});

// ─── Corporate tax ──────────────────────────────────────────────────────────

/** Revenue 1,000,000, rent 300,000, entertainment 100,000 in 2025: tax 20,250. */
async function ctBooks(name: string): Promise<Tenant> {
  const t = await h.createTenant({ name });
  await postJournalEntry(t, {
    date: "2025-06-15",
    lines: [
      { code: "1020", debit: 1_000_000 },
      { code: "4020", credit: 1_000_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2025-07-10",
    lines: [
      { code: "5010", debit: 300_000 },
      { code: "1020", credit: 300_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2025-08-20",
    lines: [
      { code: "5090", debit: 100_000 },
      { code: "1020", credit: 100_000 },
    ],
  });
  return t;
}

async function ctReturn(t: Tenant) {
  const r = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/returns`, {
    taxPeriodStart: "2025-01-01",
    taxPeriodEnd: "2025-12-31",
  });
  expect(r.status, r.text).toBe(201);
  const base = `/api/corporate-tax/returns/${r.body.id}`;
  expect((await t.as.post(`${base}/transition`, { to: "computed" })).status).toBe(200);
  return { id: r.body.id as string, base };
}

describe("[A4][M2] year-end corporate-tax accrual and the true-up on filing", () => {
  it("accrues at period end before filing; filing an unchanged return posts nothing more", async () => {
    const t = await ctBooks("A4CtAccrue");
    const { id, base } = await ctReturn(t);
    const acc = await t.as.post(`${base}/accrue`, {});
    expect(acc.status, acc.text).toBe(200);
    expect(acc.body.accruedTax).toBe(20_250);
    const [accrual] = await entryOf(t, "corporate_tax_accrual", id);
    expect(accrual.date).toBe("2025-12-31");
    expect(await linesOf(accrual.id)).toEqual([
      { code: "2060", debit: 0, credit: 20_250, fc: null },
      { code: "5200", debit: 20_250, credit: 0, fc: null },
    ]);
    // Accruing again with the same figures is a no-op.
    const again = await t.as.post(`${base}/accrue`, {});
    expect(again.body.accrual.changed).toBe(false);

    expect((await t.as.post(`${base}/transition`, { to: "reviewed" })).status).toBe(200);
    const filed = await t.as.post(`${base}/transition`, {
      to: "filed",
      filingReference: "FTA-A4-1",
      filedOn: "2026-03-15",
      postProvision: true,
    });
    expect(filed.status, filed.text).toBe(200);
    expect(await entryOf(t, "corporate_tax", id)).toHaveLength(0);
    expect(await bal(t, "2060")).toBe(-20_250 * 100);
    // The accrual is not deductible: the CT preview is unchanged by it.
    const calc = await t.as.get(
      `/api/companies/${t.company.id}/corporate-tax/calculate?periodStart=2025-01-01&periodEnd=2025-12-31`
    );
    expect(calc.body.taxPayable).toBe(20_250);
    // L3: revenue less expenses is the accounting profit, not gross profit.
    expect(calc.body.accountingProfit).toBe(600_000);
  });

  it("re-accrues after a change; a later filing in a locked year books the true-up on the filing date", async () => {
    const t = await ctBooks("A4CtTrueUp");
    const { id, base } = await ctReturn(t);
    expect((await t.as.post(`${base}/accrue`, {})).status).toBe(200);
    // Fines found before the year is locked: recompute and re-accrue (old accrual reversed).
    const fines = await t.as.post(`${base}/compute`, {
      adjustments: [{ id: "f1", category: "fines_penalties", amount: 5_000 }],
    });
    expect(fines.status, fines.text).toBe(200);
    expect(fines.body.return.taxPayable).toBe(20_700);
    const re = await t.as.post(`${base}/accrue`, {});
    expect(re.body.accruedTax).toBe(20_700);
    const accruals = await entryOf(t, "corporate_tax_accrual", id);
    expect(accruals).toHaveLength(2);
    expect(await bal(t, "2060")).toBe(-20_700 * 100);

    // Year locked; the filed return carries another 5,000 of fines -> under-provision 450.
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_end, status, lock_type, lock_scope)
       VALUES ($1, '2025-12-31', 'locked', 'hard', 'through')`,
      [t.company.id]
    );
    const more = await t.as.post(`${base}/compute`, {
      adjustments: [{ id: "f1", category: "fines_penalties", amount: 10_000 }],
    });
    expect(more.body.return.taxPayable).toBe(21_150);
    expect((await t.as.post(`${base}/transition`, { to: "reviewed" })).status).toBe(200);
    const filed = await t.as.post(`${base}/transition`, {
      to: "filed",
      filingReference: "FTA-A4-2",
      filedOn: "2026-03-15",
      postProvision: true,
    });
    expect(filed.status, filed.text).toBe(200);
    const [trueUp] = await entryOf(t, "corporate_tax", id);
    expect(trueUp.date).toBe("2026-03-15");
    expect(await linesOf(trueUp.id)).toEqual([
      { code: "2060", debit: 0, credit: 450, fc: null },
      { code: "5200", debit: 450, credit: 0, fc: null },
    ]);
    expect(await bal(t, "2060")).toBe(-21_150 * 100);
  });

  it("deferred tax: a 9% liability on a taxable temporary difference posts Dr 5210 / Cr 2260", async () => {
    const t = await ctBooks("A4Dt");
    const c = `/api/companies/${t.company.id}/corporate-tax/deferred-tax`;
    const body = {
      asOf: "2025-12-31",
      schedule: [
        {
          description: "Equipment: accelerated tax depreciation",
          kind: "asset",
          carryingAmount: 100_000,
          taxBase: 60_000,
        },
        { description: "Unused tax losses", kind: "tax_loss", amount: 10_000 },
      ],
    };
    const preview = await t.as.post(`${c}/preview`, body);
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body).toMatchObject({ closingLiability: 3_600, closingAsset: 900 });
    const posted = await t.as.post(c, body);
    expect(posted.status, posted.text).toBe(201);
    expect(await linesOf(posted.body.journalEntryId)).toEqual([
      { code: "1270", debit: 900, credit: 0, fc: null },
      { code: "2260", debit: 0, credit: 3_600, fc: null },
      { code: "5210", debit: 2_700, credit: 0, fc: null },
    ]);
    // Same balances again: nothing to post.
    expect((await t.as.post(c, body)).status).toBe(409);
    // Deferred tax is income tax: excluded from the CT base.
    const calc = await t.as.get(
      `/api/companies/${t.company.id}/corporate-tax/calculate?periodStart=2025-01-01&periodEnd=2025-12-31`
    );
    expect(calc.body.taxPayable).toBe(20_250);
    const rev = await t.as.post(`${c}/${posted.body.id}/reverse`, { reason: "Wrong tax base" });
    expect(rev.status, rev.text).toBe(200);
    expect(await bal(t, "2260")).toBe(0);
  });
});

describe("[A4][M13] tax losses brought forward from a return filed outside Muhasib", () => {
  it("a 2024 loss of 100,000 entered by hand reduces 2025 taxable income", async () => {
    const t = await ctBooks("A4Loss");
    const ext = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/external-returns`, {
      taxPeriodStart: "2024-01-01",
      taxPeriodEnd: "2024-12-31",
      totalRevenue: 400_000,
      lossCarriedForward: 100_000,
      filingReference: "EMARATAX-2024",
    });
    expect(ext.status, ext.text).toBe(201);
    const r = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/returns`, {
      taxPeriodStart: "2025-01-01",
      taxPeriodEnd: "2025-12-31",
    });
    expect(r.status, r.text).toBe(201);
    const computed = await t.as.post(`/api/corporate-tax/returns/${r.body.id}/compute`, {});
    expect(computed.status, computed.text).toBe(200);
    expect(computed.body.return.lossBroughtForward).toBe(100_000);
    // Taxable 600,000 - 100,000 relief (under the 75% cap) = 500,000 -> (500,000 - 375,000) x 9%.
    expect(computed.body.return.taxPayable).toBe(11_250);
    expect(computed.body.return.lossCarriedForward).toBe(0);
    // A period already covered by a Muhasib return cannot also be entered as external.
    const dup = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/external-returns`, {
      taxPeriodStart: "2025-01-01",
      taxPeriodEnd: "2025-12-31",
      lossCarriedForward: 1,
    });
    expect(dup.status).toBe(409);
  });
});

// ─── Customer deposits ──────────────────────────────────────────────────────

async function vatTenant(name: string) {
  return h.createTenant({
    name,
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
}

describe("[A4][M1] customer deposit with VAT on receipt", () => {
  it("VAT 50 is declared on the 1,050 deposit, reversed when applied, and the invoice VAT is not doubled", async () => {
    const t = await vatTenant("A4Deposit");
    const c = `/api/companies/${t.company.id}`;
    const bank = await accountByCode(t, "1020");
    const dep = await t.as.post(`${c}/customer-deposits`, {
      customerName: "Advance Customer LLC",
      date: "2026-07-05",
      amount: 1050,
      vatTreatment: "standard",
      paymentAccountId: bank.id,
      reference: "ADV-1",
    });
    expect(dep.status, dep.text).toBe(201);
    expect(await linesOf(dep.body.journalEntryId)).toEqual([
      { code: "1020", debit: 1050, credit: 0, fc: null },
      { code: "2020", debit: 0, credit: 50, fc: null },
      { code: "2050", debit: 0, credit: 1000, fc: null },
    ]);
    const q3 = await t.as.get(`${c}/vat/compute?from=2026-07-01&to=2026-09-30`);
    expect(q3.status, q3.text).toBe(200);
    expect(q3.body.boxes.box1bDubaiAmount).toBe(1000);
    expect(q3.body.boxes.box1bDubaiVat).toBe(50);
    expect(q3.body.reconciliation.hasUnexplainedDifference).toBe(false);

    const inv = await t.as.post(`${c}/invoices`, {
      customerName: "Advance Customer LLC",
      customerTrn: TRN,
      date: "2026-10-10",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Fit-out", quantity: 1, unitPrice: 10000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    // Apply half, then the rest: VAT shares 25 + 25.
    const apply1 = await t.as.post(`${c}/customer-credits/${dep.body.creditId}/apply`, {
      invoiceId: inv.body.id,
      amount: 525,
      date: "2026-10-10",
    });
    expect(apply1.status, apply1.text).toBe(201);
    expect(await linesOf(apply1.body.journalEntryId)).toEqual([
      { code: "1040", debit: 0, credit: 525, fc: null },
      { code: "2020", debit: 25, credit: 0, fc: null },
      { code: "2050", debit: 500, credit: 0, fc: null },
    ]);
    const apply2 = await t.as.post(`${c}/customer-credits/${dep.body.creditId}/apply`, {
      invoiceId: inv.body.id,
      amount: 525,
      date: "2026-10-12",
    });
    expect(apply2.status, apply2.text).toBe(201);
    expect(await bal(t, "2050")).toBe(0);
    // Output VAT on the whole supply: 500 (50 on the deposit + 450 on the invoice balance).
    expect(await bal(t, "2020")).toBe(-500 * 100);
    const q4 = await t.as.get(`${c}/vat/compute?from=2026-10-01&to=2026-12-31`);
    expect(q4.body.boxes.box1bDubaiAmount).toBe(9000);
    expect(q4.body.boxes.box1bDubaiVat).toBe(450);
    expect(q4.body.reconciliation.hasUnexplainedDifference).toBe(false);
    // The invoice's open balance is 10,500 - 1,050 (the one settlement rule).
    const open = await h.sql<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [
      inv.body.id,
    ]);
    expect(open[0].status).toBe("partial");
    const aging = await t.as.get(`${c}/reports/aging?type=receivable&asOf=2026-10-31`);
    if (aging.status === 200 && aging.body.reconciliation) {
      expect(aging.body.reconciliation.isReconciled).toBe(true);
    }
    const list = await t.as.get(`${c}/customer-deposits`);
    expect(list.body[0]).toMatchObject({ status: "applied", number: dep.body.deposit.number });
  });

  it("a refunded deposit reverses its VAT; a standard deposit needs the company emirate", async () => {
    const t = await vatTenant("A4DepositRefund");
    const c = `/api/companies/${t.company.id}`;
    const bank = await accountByCode(t, "1020");
    const dep = await t.as.post(`${c}/customer-deposits`, {
      customerName: "Walk-away Customer",
      date: "2026-07-05",
      amount: 2100,
      paymentAccountId: bank.id,
    });
    expect(dep.status, dep.text).toBe(201);
    const refund = await t.as.post(`${c}/customer-credits/${dep.body.creditId}/refund`, {
      amount: 2100,
      date: "2026-07-20",
      paymentAccountId: bank.id,
    });
    expect(refund.status, refund.text).toBe(201);
    expect(await linesOf(refund.body.journalEntryId)).toEqual([
      { code: "1020", debit: 0, credit: 2100, fc: null },
      { code: "2020", debit: 100, credit: 0, fc: null },
      { code: "2050", debit: 2000, credit: 0, fc: null },
    ]);
    const q3 = await t.as.get(`${c}/vat/compute?from=2026-07-01&to=2026-09-30`);
    expect(q3.body.boxes.box1bDubaiVat).toBe(0);
    expect(q3.body.reconciliation.hasUnexplainedDifference).toBe(false);

    await h.sql(`UPDATE companies SET emirate = NULL WHERE id = $1`, [t.company.id]);
    const noEmirate = await t.as.post(`${c}/customer-deposits`, {
      customerName: "X",
      date: "2026-07-05",
      amount: 105,
      paymentAccountId: bank.id,
    });
    expect(noEmirate.status).toBe(422);
    expect(noEmirate.body.code).toBe("PLACE_OF_SUPPLY_REQUIRED");
  });
});

// ─── Low findings ───────────────────────────────────────────────────────────

describe("[A4] low findings", () => {
  it("[L5] an over-payment is a customer credit balance (2055), not deferred revenue (2050)", async () => {
    const t = await vatTenant("A4Overpay");
    const c = `/api/companies/${t.company.id}`;
    const inv = await t.as.post(`${c}/invoices`, {
      customerName: "Over Payer",
      date: "2026-08-10",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Job", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`${c}/invoices/${inv.body.id}/payments`, {
      amount: 1100,
      date: "2026-08-15",
      paymentAccountId: bank.id,
      allowCredit: true,
    });
    expect(pay.status, pay.text).toBeLessThan(300);
    expect(await bal(t, "2055")).toBe(-50 * 100);
    expect(await bal(t, "2050")).toBe(0);
  });

  it("[L4] a USD invoice received into an AED bank account books an AED cash line", async () => {
    const t = await h.createTenant({ name: "A4UsdIntoAed" });
    const c = `/api/companies/${t.company.id}`;
    const r = await t.as.post(`${c}/exchange-rates`, {
      fromCurrency: "USD",
      toCurrency: "AED",
      rate: 3.6725,
      effectiveDate: "2026-08-01",
    });
    expect(r.status, r.text).toBe(201);
    const inv = await t.as.post(`${c}/invoices`, {
      customerName: "Globex",
      date: "2026-08-10",
      currency: "USD",
      exchangeRate: 3.6725,
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`${c}/invoices/${inv.body.id}/payments`, {
      amount: 1050,
      date: "2026-08-20",
      method: "bank",
      paymentAccountId: bank.id,
      exchangeRate: 3.6725,
    });
    expect(pay.status, pay.text).toBe(201);
    const rows = await h.sql<{ code: string; fc: string | null; debit: string }>(
      `SELECT a.code, jl.foreign_currency AS fc, jl.debit::text AS debit
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source = 'payment'`,
      [t.company.id]
    );
    const cash = rows.find((x) => x.code === "1020")!;
    expect(Number(cash.debit)).toBe(3856.13); // 1,050 USD x 3.6725
    expect(cash.fc).toBeNull();
    // The receivable leg still carries the USD it clears.
    expect(rows.find((x) => x.code === "1040")?.fc).toBe("USD");
  });

  it("[L8] a back-dated accrual whose reversal date has passed is reversed at once", async () => {
    const t = await h.createTenant({ name: "A4AutoRev" });
    const exp = await accountByCode(t, "5060");
    const accrued = await accountByCode(t, "2040");
    const r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: "2026-01-31",
      description: "Utilities accrual",
      status: "posted",
      autoReverseOn: "2026-02-01",
      lines: [
        { accountId: exp.id, debit: 1200, credit: 0 },
        { accountId: accrued.id, debit: 0, credit: 1200 },
      ],
    });
    expect(r.status, r.text).toBe(200);
    const rows = await h.sql<{ reversed_by_entry_id: string | null }>(
      `SELECT reversed_by_entry_id FROM journal_entries WHERE id = $1`,
      [r.body.id]
    );
    expect(rows[0].reversed_by_entry_id).toBeTruthy();
    const [rev] = await h.sql<{ d: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id = $1`,
      [rows[0].reversed_by_entry_id]
    );
    expect(rev.d).toBe("2026-02-01");
    expect(await bal(t, "2040")).toBe(0);
  });

  it("[L8] an NRV write-down can be reversed up to the amount written down (IAS 2.33)", async () => {
    const t = await h.createTenant({ name: "A4Nrv" });
    const c = `/api/companies/${t.company.id}`;
    const p = await t.as.post(`${c}/products`, { name: "Gadget", unitPrice: 200, costPrice: 100 });
    expect(p.status, p.text).toBe(200);
    const bought = await t.as.post(`/api/products/${p.body.id}/movements`, {
      type: "purchase",
      quantity: 5,
      unitCost: 100,
      counterAccountId: (await accountByCode(t, "1020")).id,
    });
    expect(bought.status, bought.text).toBeLessThan(300);
    const down = await t.as.post(`/api/products/${p.body.id}/write-down`, {
      amount: 70,
      reason: "NRV below cost",
    });
    expect(down.status, down.text).toBe(201);
    const up = await t.as.post(`/api/products/${p.body.id}/write-down-reversal`, {
      amount: 50,
      reason: "Selling price recovered",
    });
    expect(up.status, up.text).toBe(201);
    expect(await linesOf(up.body.journalEntryId)).toEqual([
      { code: "1070", debit: 50, credit: 0, fc: null },
      { code: "5007", debit: 0, credit: 50, fc: null },
    ]);
    const tooMuch = await t.as.post(`/api/products/${p.body.id}/write-down-reversal`, {
      amount: 30,
      reason: "More",
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe("WRITE_DOWN_REVERSAL_EXCEEDS");
  });

  it("[L2] the default chart has a Motor Vehicles class and a Customer Credit Balances account", async () => {
    const t = await h.createTenant({ name: "A4Chart" });
    expect(
      (await accountByCode(t, "1250")).nameEn ?? (await accountByCode(t, "1250")).name_en
    ).toBe("Motor Vehicles");
    expect(await accountByCode(t, "2055")).toBeTruthy();
  });
});
