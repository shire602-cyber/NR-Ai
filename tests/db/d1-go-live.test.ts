/**
 * D1 (accounting re-audit 3, go-live): one model for every opening balance.
 *
 *  - N1  the opening gratuity is posted once, from the employees' opening provisions, whatever
 *        the order (employee form, opening trial balance, payroll dialog).
 *  - N2  opening-balance entries are the opening position of the cash-flow statement, not cash
 *        flows (IAS 7.45), when the go-live date is inside the period; direct = indirect.
 *  - N3  PPE is carried by the asset register; the trial balance is checked against it and does
 *        not post it again; a register-to-GL tie at month end.
 *  - N4  a mid-quarter go-live: the open period's pre-go-live VAT sits on 2020, the return
 *        reports it and the settlement clears it (2020 and 2040 end at 0). INTEGRATE-H: the old
 *        path (VAT on 2040 plus a return adjustment) is refused and redirected to a VAT journal.
 *  - N7  a manual stock purchase needs the account it was paid from (no GRNI default); GRNI tie.
 *  - N14 a documents-mode trial balance waiting for its open invoices / bills is a month-end
 *        warning until they arrive.
 */
import { afterEach, describe, expect, it } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Net debit (debit - credit) of an account code, in AED. */
async function gl(t: Tenant, code: string, asOf?: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2
        AND ($3::date IS NULL OR je.date::date <= $3::date)`,
    [t.company.id, code, asOf ?? null]
  );
  return Number(rows[0].n) / 100;
}

async function importJob(t: Tenant, body: Record<string, unknown>, commit = true) {
  const p = await t.as.post(`${base(t)}/imports/preview`, { sourceSystem: "generic", ...body });
  expect(p.status, p.text).toBe(201);
  const v = await t.as.post(`${base(t)}/imports/${p.body.id}/validate`, {});
  expect(v.status, v.text).toBe(200);
  const codes = (v.body.issues as Array<{ code: string }>).map((i) => i.code);
  if (!commit) return { status: v.body.status as string, codes, committed: null };
  expect(v.body.status, JSON.stringify(v.body.issues)).toBe("validated");
  const c = await t.as.post(`${base(t)}/imports/${p.body.id}/commit`, {});
  expect(c.status, c.text).toBe(200);
  return { status: "committed", codes, committed: c.body };
}

async function bank(t: Tenant): Promise<string> {
  const b = await t.as.post(`${base(t)}/bank-accounts`, {
    nameEn: "ENBD",
    bankName: "Emirates NBD",
    currency: "AED",
  });
  expect(b.status, b.text).toBeLessThan(300);
  return b.body.glAccountId as string;
}

async function bankCode(id: string): Promise<string> {
  return (await h.sql<{ code: string }>(`SELECT code FROM accounts WHERE id = $1`, [id]))[0].code;
}

async function checklist(t: Tenant, period: string) {
  const r = await t.as.get(`${base(t)}/month-end/checklist?period=${period}`);
  expect(r.status, r.text).toBe(200);
  return (r.body.checklist ?? r.body.items ?? r.body) as Array<any>;
}

async function cashFlow(t: Tenant, from: string, to: string, method: "indirect" | "direct") {
  const r = await t.as.get(`${base(t)}/reports/cash-flow?from=${from}&to=${to}&method=${method}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
}

const tbCsv = (rows: string[]) => ["Account Code,Account Name,Debit,Credit", ...rows].join("\n");

describe("D1 go-live: gratuity, PPE, opening position in the cash flow (m1)", () => {
  it("[N1][N2][N3] go-live 30 Sep: every opening balance posts once, 3040 nets to 0, the FY cash flow opens with the opening cash", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1M1" });
    const c = base(t);
    await t.as.patch(c, { emirate: "dubai" });
    const bankId = await bank(t);
    const bankAcct = await bankCode(bankId);

    // N1: an opening provision typed on the employee form is booked at once.
    const e = await t.as.post(`${c}/employees`, {
      employeeNumber: "E1",
      fullName: "Sara Ali",
      nationality: "IN",
      joinDate: "2022-01-01",
      basicSalary: "10000.00",
      housingAllowance: "2000.00",
    });
    expect(e.status, e.text).toBe(201);
    const p = await t.as.patch(`/api/employees/${e.body.id}`, {
      openingGratuityProvision: "7000.00",
      openingGratuityAsOf: "2026-09-30",
    });
    expect(p.status, p.text).toBe(200);
    expect(await gl(t, "2036")).toBe(-7000);
    expect(await gl(t, "3040")).toBe(7000);

    const prod = await t.as.post(`${c}/products`, {
      name: "Widget",
      sku: "W-1",
      unitPrice: 150,
      costPrice: 100,
      currentStock: 40,
      openingStockDate: "2026-09-30",
    });
    expect(prod.status, prod.text).toBe(200);
    await importJob(t, {
      kind: "open_invoices",
      cutOverDate: "2026-09-30",
      csv: "Invoice Number,Invoice Date,Due Date,Customer,Total,Amount Due,Currency\nOLD-1,2026-09-15,2026-10-15,Legacy Customer,10500,10500,AED\n",
    });
    await importJob(t, {
      kind: "open_bills",
      cutOverDate: "2026-09-30",
      csv: "Bill Number,Bill Date,Due Date,Vendor,Total,Amount Due,Currency\nOB-1,2026-09-20,2026-10-20,Legacy Vendor,5250,5250,AED\n",
    });
    const fa = await t.as.post(`${c}/fixed-assets/import`, {
      csv: "assetName,category,purchaseDate,purchaseCost,usefulLifeYears,depreciationMethod,accumulatedDepreciation\nLaptop fleet,computers,2024-10-01,20000,5,straight_line,8000\n",
      openingBalance: true,
    });
    expect(fa.status, fa.text).toBe(201);
    const kinds = await h.sql<{ source: string; entry_kind: string }>(
      `SELECT source, entry_kind FROM journal_entries WHERE company_id = $1 ORDER BY created_at`,
      [t.company.id]
    );
    // N2: every opening seam posts an opening entry (stock and register included).
    expect(kinds.every((k) => k.entry_kind === "opening")).toBe(true);

    // N3: the TB carries the same PPE as the register: validated, and not posted twice.
    const tb = await importJob(t, {
      kind: "trial_balance",
      cutOverDate: "2026-09-30",
      arApMode: "documents",
      csv: tbCsv([
        `${bankAcct},Bank - ENBD,80000,`,
        "1040,Accounts Receivable,10500,",
        "1070,Inventory,4000,",
        "1230,Computer Equipment,20000,",
        "1240,Accumulated Depreciation,,8000",
        "2010,Accounts Payable,,5250",
        "2036,End-of-Service Gratuity Provision,,7000",
        "2040,Accrued Expenses,,900",
        "3010,Owner's Capital / Share Capital,,50000",
        "3020,Retained Earnings,,43350",
      ]),
    });
    expect(tb.codes).not.toContain("V_PPE_REGISTER_MISMATCH");
    const tbLines = await h.sql<{ code: string; d: string; c: string }>(
      `SELECT a.code, jl.debit::text AS d, jl.credit::text AS c FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1 ORDER BY a.code, jl.debit DESC`,
      [tb.committed!.journalEntryId ?? tb.committed!.result.entryId]
    );
    // Bank, 2040, 3010, 3020 post; A/R and A/P (one net line), stock, PPE and 2036 move to 3040.
    expect(tbLines.map((l) => l.code).sort()).toEqual(
      [bankAcct, "2040", "3010", "3020", "3040", "3040", "3040", "3040"].sort()
    );
    const obe = tbLines
      .filter((l) => l.code === "3040")
      .map((l) => Number(l.d) - Number(l.c))
      .sort((x, y) => x - y);
    // -7000 gratuity, +4000 stock, +5250 (A/R 10500 less A/P 5250), +12000 PPE (20000 - 8000)
    expect(obe).toEqual([-7000, 4000, 5250, 12000]);
    expect(await gl(t, bankAcct)).toBe(80000);
    expect(await gl(t, "1040")).toBe(10500);
    expect(await gl(t, "1070")).toBe(4000);
    expect(await gl(t, "1230")).toBe(20000);
    expect(await gl(t, "1240")).toBe(-8000);
    expect(await gl(t, "2010")).toBe(-5250);
    expect(await gl(t, "2036")).toBe(-7000);
    expect(await gl(t, "3040")).toBe(0);

    // N1: nothing left to book; the payroll dialog's book call is a no-op.
    const status = await t.as.get(`${c}/payroll/opening-gratuity`);
    expect(status.body).toMatchObject({ provision: 7000, booked: 7000, outstanding: 0 });
    const book = await t.as.post(`${c}/payroll/opening-gratuity/book`, {});
    expect(book.status).toBe(409);
    expect(book.body.code).toBe("OPENING_GRATUITY_NOTHING_TO_BOOK");

    // N3: after the opening TB an opening register import is refused (it would double PPE).
    const again = await t.as.post(`${c}/fixed-assets/import`, {
      csv: "assetName,category,purchaseDate,purchaseCost,usefulLifeYears,depreciationMethod,accumulatedDepreciation\nPrinter,equipment,2025-01-01,3000,5,straight_line,500\n",
      openingBalance: true,
    });
    expect(again.status, again.text).toBe(409);
    expect(again.body.code).toBe("OPENING_TB_ALREADY_COMMITTED");
    expect(await gl(t, "1210")).toBe(0);

    // October: the legacy customer pays OLD-1 into the bank.
    const inv = (
      await h.sql<{ id: string }>(
        `SELECT id FROM invoices WHERE company_id = $1 AND number = 'OLD-1'`,
        [t.company.id]
      )
    )[0];
    const pay = await t.as.post(`${c}/invoices/${inv.id}/payments`, {
      amount: 10500,
      date: "2026-10-10",
      paymentAccountId: bankId,
    });
    expect(pay.status, pay.text).toBe(201);

    // Month end: gratuity, PPE register and the rest tie; the opening documents are complete.
    const items = await checklist(t, "2026-10");
    const ties = items.find((i) => i.key === "control_accounts")!.ties as Array<any>;
    const byKey = new Map(ties.map((x) => [x.key, x]));
    expect(byKey.get("gratuity")).toMatchObject({ glBalance: 7000, reconciled: true });
    expect(byKey.get("fixed_assets")).toMatchObject({
      glBalance: 12000,
      subledgerBalance: 12000,
      reconciled: true,
    });
    expect(ties.filter((x) => x.applicable && !x.reconciled)).toEqual([]);
    expect(items.find((i) => i.key === "opening_balances")).toMatchObject({ status: "complete" });

    // N2: FY cash flow (Jan-Oct): the opening position is the opening cash, not a flow.
    for (const method of ["indirect", "direct"] as const) {
      const cf = await cashFlow(t, "2026-01-01", "2026-10-31", method);
      expect(cf.openingCash, method).toBe(80000);
      expect(cf.closingCash, method).toBe(90500);
      expect(cf.operating.total, method).toBe(10500);
      expect(cf.investing.total, method).toBe(0);
      expect(cf.financing.total, method).toBe(0);
      expect(cf.investing.breakdown, method).toEqual([]);
      expect(cf.financing.breakdown, method).toEqual([]);
      expect(cf.netCashChange, method).toBe(10500);
      expect(cf.cashProof.isBalanced, method).toBe(true);
      expect(cf.openingPosition, method).toMatchObject({ cash: 80000, netIncome: 0 });
      if (method === "indirect") {
        const lines = new Map(
          (cf.operating.breakdown as Array<any>).map((l) => [l.accountCode || l.kind, l.amount])
        );
        expect(lines.get("1040")).toBe(10500);
        expect(cf.netIncome).toBe(0);
      }
    }
    // A period starting after go-live is unchanged: opening 80000 from the ledger.
    const after = await cashFlow(t, "2026-10-01", "2026-10-31", "indirect");
    expect(after).toMatchObject({ openingCash: 80000, closingCash: 90500, openingPosition: null });
  });

  it("[N3] a TB carrying PPE with no register (or a different register) is refused with guidance", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1PPE" });
    const bankAcct = await bankCode(await bank(t));
    const csv = tbCsv([
      `${bankAcct},Bank,10000,`,
      "1230,Computer Equipment,20000,",
      "1240,Accumulated Depreciation,,8000",
      "3010,Share Capital,,22000",
    ]);
    const none = await importJob(
      t,
      { kind: "trial_balance", cutOverDate: "2026-09-30", arApMode: "documents", csv },
      false
    );
    expect(none.status).toBe("previewed");
    expect(none.codes).toContain("V_PPE_WITHOUT_REGISTER");

    const fa = await t.as.post(`${base(t)}/fixed-assets/import`, {
      csv: "assetName,category,purchaseDate,purchaseCost,usefulLifeYears,depreciationMethod,accumulatedDepreciation\nLaptop fleet,computers,2024-10-01,18000,5,straight_line,8000\n",
      openingBalance: true,
    });
    expect(fa.status, fa.text).toBe(201);
    const diff = await importJob(
      t,
      { kind: "trial_balance", cutOverDate: "2026-09-30", arApMode: "documents", csv },
      false
    );
    expect(diff.codes).toContain("V_PPE_REGISTER_MISMATCH");
    expect(await gl(t, "1230")).toBe(18000);
  });
});

describe("D1 go-live mid-quarter (m2)", () => {
  it("[N1][N4][N2] TB at 31 Jan with 2036 and January VAT: the payroll dialog books only the new employee, Q1 VAT settles 2020 to 0, Jan-Mar cash flow opens at 80000", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1M2" });
    const c = base(t);
    await t.as.patch(c, { emirate: "dubai" });
    const bankId = await bank(t);
    const bankAcct = await bankCode(bankId);
    const e1 = await t.as.post(`${c}/employees`, {
      employeeNumber: "E1",
      fullName: "Sara Ali",
      nationality: "IN",
      joinDate: "2022-01-01",
      basicSalary: "10000.00",
      openingGratuityProvision: "7000.00",
      openingGratuityAsOf: "2026-01-31",
    });
    expect(e1.status, e1.text).toBe(201);
    const e2 = await t.as.post(`${c}/employees`, {
      employeeNumber: "E2",
      fullName: "Omar Said",
      nationality: "EG",
      joinDate: "2023-06-01",
      basicSalary: "6000.00",
    });
    expect(e2.status, e2.text).toBe(201);

    const tb = await importJob(t, {
      kind: "trial_balance",
      cutOverDate: "2026-01-31",
      arApMode: "documents",
      csv: tbCsv([
        `${bankAcct},Bank - ENBD,80000,`,
        "2020,VAT Payable (Output VAT),,500",
        "2036,End-of-Service Gratuity Provision,,7000",
        "3010,Owner's Capital / Share Capital,,50000",
        "3020,Retained Earnings,,22500",
      ]),
    });
    // N4: the cut-over is inside Q1 (Jan-Mar): January's VAT may stay on 2020.
    expect(tb.codes).toContain("V_VAT_OPENING_IN_RETURN");
    expect(tb.codes).not.toContain("V_VAT_IN_OPENING");
    expect(await gl(t, "2036")).toBe(-7000);
    expect(await gl(t, "2020")).toBe(-500);
    expect(await gl(t, "3040")).toBe(0);

    // N1 (UI path): the February run asks for E2's opening provision; the dialog saves it on
    // the employee (booked at once) and then calls book, which has nothing left to post.
    const run = await t.as.post(`${c}/payroll-runs`, { periodMonth: 2, periodYear: 2026 });
    expect(run.status, run.text).toBe(201);
    const calc = await t.as.post(`/api/payroll-runs/${run.body.id}/calculate`, {});
    expect(calc.status, calc.text).toBe(422);
    expect(calc.body.code).toBe("OPENING_GRATUITY_REQUIRED");
    const gap = calc.body.details.employees as Array<{
      employeeId: string;
      suggestedOpeningProvision: string;
    }>;
    expect(gap.map((g) => g.employeeId)).toEqual([e2.body.id]);
    const suggested = Number(gap[0].suggestedOpeningProvision);
    expect(suggested).toBeGreaterThan(0);
    const patched = await t.as.patch(`/api/employees/${e2.body.id}`, {
      openingGratuityProvision: gap[0].suggestedOpeningProvision,
      openingGratuityAsOf: "2026-01-31",
    });
    expect(patched.status, patched.text).toBe(200);
    const book = await t.as.post(`${c}/payroll/opening-gratuity/book`, {});
    expect(book.status).toBe(409);
    expect(await gl(t, "2036")).toBeCloseTo(-(7000 + suggested), 2);
    expect(await gl(t, "3040")).toBeCloseTo(suggested, 2);
    const entries = await h.sql<{ c: string }>(
      `SELECT jl.credit::text AS c FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source = 'opening_balance' AND a.code = '2036'
          AND jl.credit > 0`,
      [t.company.id]
    );
    expect(entries.map((x) => Number(x.c)).sort((a, b) => a - b)).toEqual(
      [7000, suggested].sort((a, b) => a - b)
    );

    // N4: February sale; the Q1 return reports January's VAT as an adjustment.
    const cu = await t.as.post(`${c}/customer-contacts`, {
      name: "Cust",
      trnNumber: "100987654300202",
      emirate: "dubai",
    });
    expect(cu.status, cu.text).toBeLessThan(300);
    const inv = await t.as.post(`${c}/invoices`, {
      contactId: cu.body.id,
      customerName: "Cust",
      date: "2026-02-15",
      placeOfSupplyEmirate: "dubai",
      lines: [
        {
          description: "Sale",
          quantity: 1,
          unitPrice: 20000,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const vat = await t.as.get(`${c}/vat/compute?from=2026-01-01&to=2026-03-31`);
    expect(vat.status, vat.text).toBe(200);
    expect(vat.body.boxes).toMatchObject({
      box1bDubaiAmount: 20000,
      box1bDubaiVat: 1000,
      box1bDubaiAdj: 500,
      box12TotalDueTax: 1500,
      box14PayableTax: 1500,
    });
    expect(vat.body.reconciliation.unexplainedOutputFils).toBe(0);
    expect(vat.body.reconciliation.ledgerOutputVatFils).toBe(150000);

    const gen = await t.as.post(`${c}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(gen.status, gen.text).toBe(201);
    await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {});
    const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
      ftaReferenceNumber: "FTA-D1",
      filedOn: "2026-04-20",
    });
    expect(sub.status, sub.text).toBe(200);
    const settle = await t.as.post(`/api/vat-returns/${gen.body.id}/settlement`, {
      date: "2026-04-25",
      paymentAccountId: bankId,
    });
    expect(settle.status, settle.text).toBe(201);
    expect(settle.body).toMatchObject({ outputVat: 1500, netPayable: 1500 });
    expect(await gl(t, "2020")).toBe(0);
    expect(await gl(t, "2040")).toBe(0);
    expect(await gl(t, bankAcct)).toBe(78500);

    // N2: Jan-Mar opens with the opening cash; no financing or operating flow is invented.
    for (const method of ["indirect", "direct"] as const) {
      const q1 = await cashFlow(t, "2026-01-01", "2026-03-31", method);
      expect(q1, method).toMatchObject({
        openingCash: 80000,
        closingCash: 80000,
        netCashChange: 0,
        operating: { total: 0 },
        investing: { total: 0 },
        financing: { total: 0, breakdown: [] },
      });
      const ytd = await cashFlow(t, "2026-01-01", "2026-04-30", method);
      expect(ytd, method).toMatchObject({
        openingCash: 80000,
        closingCash: 78500,
        netCashChange: -1500,
        operating: { total: -1500 },
        financing: { total: 0 },
      });
      expect(ytd.cashProof.isBalanced).toBe(true);
    }
  });

  it("[N4] at a tax-period end the VAT balance still belongs on 2040 (refused with guidance)", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1VatEnd" });
    const bankAcct = await bankCode(await bank(t));
    const r = await importJob(
      t,
      {
        kind: "trial_balance",
        cutOverDate: "2026-03-31",
        arApMode: "documents",
        csv: tbCsv([
          `${bankAcct},Bank,10000,`,
          "2020,VAT Payable (Output VAT),,500",
          "3010,Share Capital,,9500",
        ]),
      },
      false
    );
    expect(r.status).toBe("previewed");
    expect(r.codes).toContain("V_VAT_IN_OPENING");
  });

  it("[N1] a doubled opening 2036 (TB and seam both posted it before D1) is reported and reversed by the seam", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1Legacy" });
    const c = base(t);
    const e = await t.as.post(`${c}/employees`, {
      fullName: "Long Server",
      nationality: "IN",
      joinDate: "2020-01-01",
      basicSalary: "10000.00",
      openingGratuityProvision: "7000.00",
      openingGratuityAsOf: "2026-09-30",
    });
    expect(e.status, e.text).toBe(201);
    expect(await gl(t, "2036")).toBe(-7000);
    // Legacy data: a pre-D1 opening trial balance that posted 2036 itself, on the cut-over date.
    const entry = (
      await h.sql<{ id: string }>(
        `SELECT je.id FROM journal_entries je WHERE je.company_id = $1 AND je.source = 'opening_balance'`,
        [t.company.id]
      )
    )[0];
    await h.sql(
      `INSERT INTO journal_entries (company_id, entry_number, date, memo, status, source, source_id, entry_kind, created_by)
       SELECT company_id, 'JE-LEGACY-TB', '2026-09-30', 'Opening balances (legacy)', 'posted', 'opening_balance', gen_random_uuid(), 'opening', created_by
         FROM journal_entries WHERE id = $1`,
      [entry.id]
    );
    const legacy = (
      await h.sql<{ id: string }>(
        `SELECT id FROM journal_entries WHERE company_id = $1 AND entry_number = 'JE-LEGACY-TB'`,
        [t.company.id]
      )
    )[0];
    await h.sql(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
       SELECT $1, a.id, CASE WHEN a.code = '3020' THEN 7000 ELSE 0 END,
              CASE WHEN a.code = '2036' THEN 7000 ELSE 0 END, 'legacy'
         FROM accounts a WHERE a.company_id = $2 AND a.code IN ('2036', '3020')`,
      [legacy.id, t.company.id]
    );
    expect(await gl(t, "2036")).toBe(-14000);
    const status = await t.as.get(`${c}/payroll/opening-gratuity`);
    expect(status.body).toMatchObject({ provision: 7000, booked: 14000, outstanding: -7000 });
    const fix = await t.as.post(`${c}/payroll/opening-gratuity/book`, {});
    expect(fix.status, fix.text).toBe(201);
    expect(fix.body.posted).toEqual([
      expect.objectContaining({ asOf: "2026-09-30", amount: -7000 }),
    ]);
    expect(await gl(t, "2036")).toBe(-7000);
    expect(await gl(t, "3040")).toBe(0);
  });
});

describe("D1 manual stock purchase and GRNI (N7)", () => {
  it("[N7] a manual purchase needs a paid-from account (no GRNI default); PO receipts tie to 2015", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1Grni" });
    const c = base(t);
    const bankId = await bank(t);
    const p = await t.as.post(`${c}/products`, { name: "Widget", unitPrice: 100, costPrice: 25 });
    expect(p.status, p.text).toBe(200);
    const url = `/api/products/${p.body.id}/movements`;
    const none = await t.as.post(url, { type: "purchase", quantity: 4, unitCost: 25 });
    expect(none.status, none.text).toBe(422);
    expect(none.body.code).toBe("COUNTER_ACCOUNT_REQUIRED");
    const grniId = (
      await h.sql<{ id: string }>(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = '2015'`,
        [t.company.id]
      )
    )[0]?.id;
    if (grniId) {
      const toGrni = await t.as.post(url, {
        type: "purchase",
        quantity: 4,
        unitCost: 25,
        counterAccountId: grniId,
      });
      expect(toGrni.status, toGrni.text).toBe(422);
    }
    expect(await gl(t, "2015")).toBe(0);
    const paid = await t.as.post(url, {
      type: "purchase",
      quantity: 4,
      unitCost: 25,
      counterAccountId: bankId,
    });
    expect(paid.status, paid.text).toBeLessThan(300);
    expect(await gl(t, "1070")).toBe(100);
    expect(await gl(t, await bankCode(bankId))).toBe(-100);
    expect(await gl(t, "2015")).toBe(0);

    // A PO receipt accrues GRNI: the tie reads it from the receipts not yet billed.
    const po = await t.as.post(`${c}/purchase-orders`, {
      vendorName: "PO Supplier",
      date: "2026-11-10",
      lines: [
        { description: "Widget", quantity: 4, unitPrice: 25, vatRate: 5, productId: p.body.id },
      ],
    });
    expect([200, 201], po.text).toContain(po.status);
    expect((await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {})).status).toBe(200);
    const rec = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {});
    expect(rec.status, rec.text).toBe(200);
    for (let i = 0; i < 60 && (await gl(t, "2015")) === 0; i++) await sleep(50);
    expect(await gl(t, "2015")).toBe(-100);
    const ties = (await checklist(t, "2026-11")).find((i) => i.key === "control_accounts")!
      .ties as Array<any>;
    expect(ties.find((x) => x.key === "grni")).toMatchObject({
      glBalance: 100,
      subledgerBalance: 100,
      reconciled: true,
    });
  });
});

describe("D1 pending opening documents (N14)", () => {
  it("[N14] a documents-mode TB waiting for its open invoices is a month-end warning until they arrive", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1Pending" });
    const bankAcct = await bankCode(await bank(t));
    await importJob(t, {
      kind: "trial_balance",
      cutOverDate: "2026-09-30",
      arApMode: "documents",
      csv: tbCsv([
        `${bankAcct},Bank,50000,`,
        "1040,Accounts Receivable,10500,",
        "3010,Capital,,60500",
      ]),
    });
    let step = (await checklist(t, "2026-10")).find((i) => i.key === "opening_balances");
    expect(step).toMatchObject({ status: "incomplete" });
    expect(step.details).toContain("receivables 10500.00");
    expect(step.copy.details).toMatchObject({
      key: "monthEnd.opening.pending",
      params: { date: "2026-09-30", ar: "10500.00", ap: "0.00" },
    });
    await importJob(t, {
      kind: "open_invoices",
      cutOverDate: "2026-09-30",
      csv: "Invoice Number,Invoice Date,Due Date,Customer,Total,Amount Due,Currency\nOLD-1,2026-09-15,2026-10-15,Legacy Customer,10500,10500,AED\n",
    });
    step = (await checklist(t, "2026-10")).find((i) => i.key === "opening_balances");
    expect(step).toMatchObject({ status: "complete" });
    expect(await gl(t, "3040")).toBe(0);
  });
});

describe("INTEGRATE-H: N4 residual (pre-go-live VAT carried on 2040)", () => {
  it("[N4-residual] a return correction for pre-go-live VAT is refused and redirected to a reasoned VAT journal; Q1 then settles 2020 and 2040 to 0", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "D1N4Old" });
    const c = base(t);
    await t.as.patch(c, { emirate: "dubai" });
    const bankId = await bank(t);
    const bankAcct = await bankCode(bankId);
    // The old guidance: January's output VAT carried on 2040 at a mid-quarter cut-over.
    await importJob(t, {
      kind: "trial_balance",
      cutOverDate: "2026-01-31",
      arApMode: "documents",
      csv: tbCsv([
        `${bankAcct},Bank - ENBD,80000,`,
        "2040,Accrued Expenses,,500",
        "3010,Owner's Capital / Share Capital,,50000",
        "3020,Retained Earnings,,29500",
      ]),
    });
    expect(await gl(t, "2040")).toBe(-500);

    const adjust = (body: Record<string, unknown>) =>
      t.as.post(`${c}/vat/adjustments`, {
        kind: "output_correction",
        emirate: "dubai",
        amount: 10000,
        vatAmount: 500,
        reason: "January output VAT before go-live",
        ...body,
      });
    // The return adjustment (no GL side) is the path that ended 2020 +500 / 2040 -500: refused.
    const q1 = await adjust({ periodStart: "2026-01-01", periodEnd: "2026-03-31" });
    expect(q1.status, q1.text).toBe(422);
    expect(q1.body.code).toBe("VAT_PRE_GO_LIVE_ADJUSTMENT");
    expect(q1.body.message).toContain("2026-01-31");
    expect(q1.body.message).toContain("credit 2020 Output VAT");
    // ... also from a later return when it corrects a pre-go-live period.
    const later = await adjust({
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      correctsPeriodStart: "2025-10-01",
      correctsPeriodEnd: "2025-12-31",
    });
    expect(later.status, later.text).toBe(422);
    expect(later.body.code).toBe("VAT_PRE_GO_LIVE_ADJUSTMENT");
    const input = await adjust({
      kind: "input_correction",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(input.status, input.text).toBe(422);
    expect(input.body.message).toContain("debit 1050 Input VAT");
    // A correction that concerns only post-go-live periods is unchanged.
    const q2 = await adjust({ periodStart: "2026-04-01", periodEnd: "2026-06-30", vatAmount: 10 });
    expect(q2.status, q2.text).toBe(201);
    expect((await t.as.delete(`${c}/vat/adjustments/${q2.body.id}`)).status).toBe(200);
    const stored = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vat_return_adjustments WHERE company_id = $1`,
      [t.company.id]
    );
    expect(stored[0].n).toBe("0");

    // The redirect: a reasoned VAT journal moves it onto 2020 inside Q1.
    const ids = await h.sql<{ code: string; id: string }>(
      `SELECT code, id FROM accounts WHERE company_id = $1 AND code IN ('2020', '2040')`,
      [t.company.id]
    );
    const id = (code: string) => ids.find((r) => r.code === code)!.id;
    const je = await t.as.post(`${c}/journal`, {
      date: "2026-02-01",
      status: "posted",
      memo: "January output VAT carried on 2040 at go-live",
      lines: [
        { accountId: id("2040"), debit: 500, credit: 0 },
        { accountId: id("2020"), debit: 0, credit: 500 },
      ],
      controlAdjustment: { reason: "January output VAT before go-live, reported in Q1" },
    });
    expect(je.status, je.text).toBeLessThan(300);
    expect(await gl(t, "2040")).toBe(0);
    expect(await gl(t, "2020")).toBe(-500);

    const cu = await t.as.post(`${c}/customer-contacts`, {
      name: "Cust",
      trnNumber: "100987654300202",
      emirate: "dubai",
    });
    expect(cu.status, cu.text).toBeLessThan(300);
    const inv = await t.as.post(`${c}/invoices`, {
      contactId: cu.body.id,
      customerName: "Cust",
      date: "2026-02-15",
      placeOfSupplyEmirate: "dubai",
      lines: [
        {
          description: "Sale",
          quantity: 1,
          unitPrice: 20000,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const vat = await t.as.get(`${c}/vat/compute?from=2026-01-01&to=2026-03-31`);
    expect(vat.status, vat.text).toBe(200);
    expect(vat.body.boxes).toMatchObject({
      box1bDubaiAmount: 20000,
      box1bDubaiVat: 1000,
      box1bDubaiAdj: 500,
      box12TotalDueTax: 1500,
      box14PayableTax: 1500,
    });
    expect(vat.body.reconciliation.unexplainedOutputFils).toBe(0);

    const gen = await t.as.post(`${c}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(gen.status, gen.text).toBe(201);
    await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {});
    const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
      ftaReferenceNumber: "FTA-N4R",
      filedOn: "2026-04-20",
    });
    expect(sub.status, sub.text).toBe(200);
    const settle = await t.as.post(`/api/vat-returns/${gen.body.id}/settlement`, {
      date: "2026-04-25",
      paymentAccountId: bankId,
    });
    expect(settle.status, settle.text).toBe(201);
    expect(settle.body).toMatchObject({ outputVat: 1500, netPayable: 1500 });
    expect(await gl(t, "2020")).toBe(0);
    expect(await gl(t, "2040")).toBe(0);
    expect(await gl(t, bankAcct)).toBe(78500);
  });
});
