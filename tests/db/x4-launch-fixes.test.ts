/**
 * X4 launch fixes against real Postgres (end-to-end journey J3): purchase-order receipts from
 * UI-shaped bodies, corporate tax returns in a closed year, salary / settlement payments,
 * the terminated employee's final month, duplicate employee identifiers, month-end
 * depreciation, year-end date check, "not applicable" obligations, cash-flow payroll
 * liabilities, fixed-asset input VAT and the opening gratuity provision.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const today = () => dubaiToday();

/** Natural (debit - credit) balance in fils for an account code. */
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

async function addMember(t: Tenant, role: string, name: string): Promise<Tenant> {
  const m = await h.createSecondTenant({ name });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    t.company.id,
    m.user.id,
    role,
  ]);
  return m;
}

describe("[X4][J3] purchase-order receipt from the UI form", () => {
  it("a UI-shaped PO line with a product posts Dr 1070 / Cr 2015 and moves stock", async () => {
    const t = await h.createTenant({ name: "X4Po" });
    const p = await t.as.post(`/api/companies/${t.company.id}/products`, {
      name: "Widget",
      unitPrice: 100,
      costPrice: 25,
    });
    expect(p.status, p.text).toBe(200);
    // Exactly what client/src/pages/PurchaseOrders.tsx sends (VAT as a decimal rate).
    const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
      vendorName: "PO Supplier",
      vendorTrn: null,
      date: today(),
      expectedDeliveryDate: today(),
      currency: "AED",
      notes: null,
      lines: [
        { description: "Widget", quantity: 4, unitPrice: 25, vatRate: 0.05, productId: p.body.id },
      ],
    });
    expect([200, 201], po.text).toContain(po.status);
    await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {});
    const rec = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {});
    expect(rec.status, rec.text).toBe(200);
    expect(rec.body.inventoryUpdated).toBe(true);
    expect(rec.body.warnings).toEqual([]);
    expect(await bal(t, "1070")).toBe(10_000);
    expect(await bal(t, "2015")).toBe(-10_000);
    const stock = await h.sql(`SELECT current_stock FROM products WHERE id = $1`, [p.body.id]);
    expect(Number(stock[0].current_stock)).toBe(4);
  });

  it("a line without a product posts nothing and the response says so", async () => {
    const t = await h.createTenant({ name: "X4PoNoProduct" });
    const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
      vendorName: "Service Supplier",
      date: today(),
      currency: "AED",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 500, vatRate: 0.05 }],
    });
    expect([200, 201], po.text).toContain(po.status);
    await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {});
    const rec = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {});
    expect(rec.status, rec.text).toBe(200);
    expect(rec.body.inventoryUpdated).toBe(false);
    expect(rec.body.warnings[0]).toMatchObject({ code: "PO_LINES_WITHOUT_PRODUCT" });
    expect(rec.body.warnings[0].lineIds).toHaveLength(1);
    expect(await bal(t, "2015")).toBe(0);
  });
});

describe("[X4][J3] corporate tax return after the year is closed", () => {
  it("a draft saves in a soft-locked year; filing needs a reference; the provision needs an audited reason; filing can be undone", async () => {
    const t = await h.createTenant({ name: "X4Ct" });
    const base = `/api/companies/${t.company.id}`;
    const lock = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd: "2025-12-31",
      overrideChecklist: true,
      lockType: "soft",
      reason: "FY2025 closed",
    });
    expect(lock.status, lock.text).toBe(200);
    // Draft: a workpaper, not a ledger posting -> not blocked by the soft lock.
    const created = await t.as.post(`${base}/corporate-tax/returns`, {
      taxPeriodStart: "2025-01-01",
      taxPeriodEnd: "2025-12-31",
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id as string;
    const tr = (body: Record<string, unknown>, headers?: Record<string, string>) =>
      t.as.post(`/api/corporate-tax/returns/${id}/transition`, body, { headers });
    expect((await tr({ to: "computed" })).status).toBe(200);
    expect((await tr({ to: "reviewed" })).status).toBe(200);

    const noRef = await tr({ to: "filed" });
    expect(noRef.status).toBe(400);
    expect(noRef.body.fields).toHaveProperty("filingReference");

    // The provision posts on 31 Dec 2025 (locked): refused without a reason, nothing changes.
    const locked = await tr({ to: "filed", filingReference: "FTA-CT-001", postProvision: true });
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe("PERIOD_SOFT_LOCKED");
    const still = await h.sql(`SELECT status FROM corporate_tax_returns WHERE id = $1`, [id]);
    expect(still[0].status).toBe("reviewed");

    const filed = await tr(
      { to: "filed", filingReference: "FTA-CT-001", filedOn: "2026-02-10", postProvision: true },
      { "X-Period-Lock-Reason": "CT provision for the filed FY2025 return" }
    );
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body).toMatchObject({ status: "filed", filingReference: "FTA-CT-001" });
    const override = await h.sql(
      `SELECT 1 FROM audit_logs WHERE company_id = $1 AND action = 'period.soft_lock_override'`,
      [t.company.id]
    );
    expect(override.length).toBeGreaterThan(0);

    // Mark not filed: needs a reason, back to reviewed, provision reversed, reference cleared.
    const noReason = await t.as.post(`/api/corporate-tax/returns/${id}/unfile`, {});
    expect(noReason.status).toBe(400);
    const unfiled = await t.as.post(`/api/corporate-tax/returns/${id}/unfile`, {
      reason: "Recorded against the wrong return",
    });
    expect(unfiled.status, unfiled.text).toBe(200);
    expect(unfiled.body).toMatchObject({ status: "reviewed", filingReference: null });
    const entries = await h.sql<{ n: string }>(
      `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint AS n
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1 AND je.status = 'posted'
          AND (je.source = 'corporate_tax' OR je.reversed_entry_id IN
               (SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'corporate_tax'))
          AND jl.debit > 0`,
      [t.company.id]
    );
    // Provision and its reversal both exist (debits on both sides of the pair).
    expect(Number(entries[0].n)).toBeGreaterThan(0);
    const audit = await h.sql(
      `SELECT 1 FROM audit_logs WHERE company_id = $1 AND action = 'corporate_tax_return.unfiled'`,
      [t.company.id]
    );
    expect(audit.length).toBe(1);
    // Re-filing posts a fresh provision (not the reversed idempotent one).
    const refiled = await tr(
      { to: "filed", filingReference: "FTA-CT-002", postProvision: true },
      { "X-Period-Lock-Reason": "Re-filed with the correct reference" }
    );
    expect(refiled.status, refiled.text).toBe(200);
    expect(refiled.body.provisionEntryId).toBeTruthy();
    expect(refiled.body.provisionEntryId).not.toBe(filed.body.provisionEntryId);
  });
});

describe("[X4][J3] payroll payments, final month and settlement", () => {
  it("salary cannot be paid from Accounts Receivable", async () => {
    const t = await h.createTenant({ name: "X4PayAcct" });
    const base = `/api/companies/${t.company.id}`;
    expect(
      (
        await t.as.post(`${base}/employees`, {
          fullName: "Pay Check",
          nationality: "IN",
          joinDate: "2024-01-01",
          basicSalary: "5000.00",
          openingGratuityProvision: "0.00",
        })
      ).status
    ).toBe(201);
    const run = await t.as.post(`${base}/payroll-runs`, { periodMonth: 9, periodYear: 2026 });
    await t.as.post(`/api/payroll-runs/${run.body.id}/calculate`, {});
    const ap = await t.as.post(`/api/payroll-runs/${run.body.id}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    const ar = await accountByCode(t, "1040");
    const bad = await t.as.post(`/api/payroll-runs/${run.body.id}/pay`, {
      paymentAccountId: ar.id,
      paymentDate: "2026-09-30",
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("PAYMENT_ACCOUNT_REQUIRED");
    const bank = await accountByCode(t, "1020");
    const ok = await t.as.post(`/api/payroll-runs/${run.body.id}/pay`, {
      paymentAccountId: bank.id,
      paymentDate: "2026-09-30",
    });
    expect(ok.status, ok.text).toBe(200);
  });

  it("a leaver's days worked in the termination month are paid once in that run; the settlement can be paid later", async () => {
    const t = await h.createTenant({ name: "X4Leaver" });
    const base = `/api/companies/${t.company.id}`;
    const emp = await t.as.post(`${base}/employees`, {
      fullName: "Leaving Soon",
      nationality: "IN",
      joinDate: "2018-01-01",
      basicSalary: "10000.00",
      housingAllowance: "3000.00",
    });
    expect(emp.status, emp.text).toBe(201);
    const settlement = await t.as.post(`${base}/payroll/settlements`, {
      employeeId: emp.body.id,
      terminationDate: "2026-10-15",
      reason: "Resignation",
      noticeDaysInLieu: 0,
      leaveEncashmentDays: 0,
    });
    expect(settlement.status, settlement.text).toBe(201);
    const net = Number(settlement.body.net);
    expect(await bal(t, "2030")).toBe(-Math.round(net * 100));

    const run = await t.as.post(`${base}/payroll-runs`, { periodMonth: 10, periodYear: 2026 });
    const calc = await t.as.post(`/api/payroll-runs/${run.body.id}/calculate`, {});
    expect(calc.status, calc.text).toBe(200);
    const items = await h.sql<{
      basic_salary: string;
      housing_allowance: string;
      net_salary: string;
      gratuity_accrual: string;
    }>(`SELECT * FROM payroll_items WHERE payroll_run_id = $1 AND employee_id = $2`, [
      run.body.id,
      emp.body.id,
    ]);
    expect(items).toHaveLength(1);
    // 15 of 31 October days.
    expect(Number(items[0].basic_salary)).toBe(4838.71);
    expect(Number(items[0].housing_allowance)).toBe(1451.61);
    expect(Number(items[0].net_salary)).toBe(6290.32);
    // The settlement already settled the gratuity against the provision.
    expect(Number(items[0].gratuity_accrual)).toBe(0);
    // November: no longer on the payroll.
    const nov = await t.as.post(`${base}/payroll-runs`, { periodMonth: 11, periodYear: 2026 });
    const novCalc = await t.as.post(`/api/payroll-runs/${nov.body.id}/calculate`, {});
    expect(novCalc.status).toBe(422);
    expect(novCalc.body.code).toBe("NO_ACTIVE_EMPLOYEES");

    // Pay the settlement later from the bank: Dr 2030 / Cr 1020.
    const ar = await accountByCode(t, "1040");
    const badAcct = await t.as.post(`${base}/payroll/settlements/${settlement.body.id}/pay`, {
      paymentAccountId: ar.id,
      paymentDate: "2026-10-20",
    });
    expect(badAcct.status).toBe(422);
    const bank = await accountByCode(t, "1020");
    const bankBefore = await bal(t, "1020");
    const paid = await t.as.post(`${base}/payroll/settlements/${settlement.body.id}/pay`, {
      paymentAccountId: bank.id,
      paymentDate: "2026-10-20",
    });
    expect(paid.status, paid.text).toBe(200);
    expect(paid.body.status).toBe("paid");
    expect(await bal(t, "2030")).toBe(0);
    expect(await bal(t, "1020")).toBe(bankBefore - Math.round(net * 100));
    const again = await t.as.post(`${base}/payroll/settlements/${settlement.body.id}/pay`, {
      paymentAccountId: bank.id,
      paymentDate: "2026-10-20",
    });
    expect(again.status).toBe(409);
  });

  it("an opening gratuity provision stops the first run charging the whole service history", async () => {
    const t = await h.createTenant({ name: "X4Opening" });
    const base = `/api/companies/${t.company.id}`;
    const mk = (name: string, opening?: string) =>
      t.as.post(`${base}/employees`, {
        fullName: name,
        nationality: "IN",
        joinDate: "2018-01-01",
        basicSalary: "10000.00",
        // A4 (M10): the first run now asks for the opening provision; "0.00" = confirmed nil.
        openingGratuityProvision: opening ?? "0.00",
      });
    const without = await mk("No Opening");
    const withOpening = await mk("With Opening", "60000.00");
    expect(withOpening.status, withOpening.text).toBe(201);
    const run = await t.as.post(`${base}/payroll-runs`, { periodMonth: 9, periodYear: 2026 });
    await t.as.post(`/api/payroll-runs/${run.body.id}/calculate`, {});
    const rows = await h.sql<{ employee_id: string; gratuity_accrual: string }>(
      `SELECT employee_id, gratuity_accrual FROM payroll_items WHERE payroll_run_id = $1`,
      [run.body.id]
    );
    const g = new Map(rows.map((r) => [r.employee_id, Number(r.gratuity_accrual)]));
    const full = g.get(without.body.id)!;
    expect(full).toBeGreaterThan(60_000);
    expect(g.get(withOpening.body.id)).toBeCloseTo(full - 60_000, 2);
  });
});

describe("[X4][J3] duplicate employee identifiers", () => {
  it("employee number, IBAN and Emirates ID are unique per company (409 with field messages)", async () => {
    const t = await h.createTenant({ name: "X4Dup" });
    const url = `/api/companies/${t.company.id}/employees`;
    const first = await t.as.post(url, {
      fullName: "First",
      employeeNumber: "E-001",
      iban: "AE070331234567890123456",
      emiratesId: "784-1990-1234567-6",
    });
    expect(first.status, first.text).toBe(201);
    for (const [field, value] of [
      ["employeeNumber", "e-001 "],
      ["iban", "AE07 0331 2345 6789 0123 456"],
      ["emiratesId", "784199012345676"],
    ] as const) {
      const dup = await t.as.post(url, { fullName: `Dup ${field}`, [field]: value });
      expect(dup.status, `${field}: ${dup.text}`).toBe(409);
      expect(dup.body.code).toBe("EMPLOYEE_DUPLICATE");
      expect(dup.body.details.fields).toHaveProperty(field);
    }
    // Updating another employee onto a taken IBAN is refused too; its own value is fine.
    const second = await t.as.post(url, { fullName: "Second", employeeNumber: "E-002" });
    const clash = await t.as.patch(`/api/employees/${second.body.id}`, {
      iban: "AE070331234567890123456",
    });
    expect(clash.status).toBe(409);
    const self = await t.as.patch(`/api/employees/${first.body.id}`, { employeeNumber: "E-001" });
    expect(self.status, self.text).toBe(200);
    // Another company may use the same identifiers.
    const other = await h.createSecondTenant({ name: "X4DupOther" });
    const elsewhere = await other.as.post(`/api/companies/${other.company.id}/employees`, {
      fullName: "Elsewhere",
      employeeNumber: "E-001",
      iban: "AE070331234567890123456",
    });
    expect(elsewhere.status, elsewhere.text).toBe(201);
  });
});

describe("[X4][J3] month-end and year-end", () => {
  it("the depreciation checklist item completes once the month's depreciation is posted", async () => {
    const t = await h.createTenant({ name: "X4Dep" });
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
      assetName: "Van",
      category: "Vehicles",
      purchaseDate: "2026-10-10",
      purchaseCost: 60000,
      usefulLifeYears: 5,
      paymentAccountId: bank.id,
    });
    expect(a.status, a.text).toBe(201);
    const item = async () => {
      const r = await t.as.get(`/api/companies/${t.company.id}/month-end/checklist?period=2026-10`);
      expect(r.status, r.text).toBe(200);
      return r.body.checklist.find((c: { id: number }) => c.id === 6);
    };
    expect((await item()).status).toBe("incomplete");
    const run = await t.as.post(`/api/companies/${t.company.id}/fixed-assets/run-depreciation`, {
      month: 10,
      year: 2026,
    });
    expect(run.status, run.text).toBe(200);
    expect(await item()).toMatchObject({ status: "complete" });
    // The depreciation entry is dated at month end, never before the 10 Oct capitalisation.
    const dates = await h.sql<{ d: string; memo: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d, memo FROM journal_entries
        WHERE company_id = $1 AND source = 'fixed_asset' ORDER BY date`,
      [t.company.id]
    );
    expect(dates.map((r) => r.d)).toEqual(["2026-10-10", "2026-10-31"]);
  });

  it("a year-end close on a date that is not the fiscal year end says so before the checklist", async () => {
    const t = await h.createTenant({
      name: "X4Fye",
      companyColumns: { fiscal_year_start_month: 11 },
    });
    const r = await t.as.post(`/api/companies/${t.company.id}/month-end/year-end-close`, {
      fiscalYearEnd: "2026-12-31",
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("NOT_FISCAL_YEAR_END");
    expect(r.body.details.expectedFiscalYearEnd).toBe("2027-10-31");
  });
});

describe("[X4][J3] compliance obligations before the company used Muhasib", () => {
  it("a return-derived obligation can be marked not applicable with a note, and undone", async () => {
    const t = await h.createTenant({
      name: "X4Na",
      companyColumns: {
        trn_vat_number: "100000000000003",
        vat_filing_frequency: "Quarterly",
        vat_period_start_month: 1,
        // X5 (J1 D4): returns apply from the books start, so give the company older books for
        // an earlier period to exist; "not applicable" is the explicit way out for those.
        created_at: "2025-01-01T00:00:00Z",
      },
    });
    const url = `/api/companies/${t.company.id}/compliance-calendar`;
    const gen = await t.as.post(`${url}/generate`, { year: 2026 });
    expect(gen.status, gen.text).toBe(200);
    const list = await t.as.get(`${url}?from=2026-01-01&to=2026-12-31&generate=false`);
    const vat = (list.body as Array<{ id: string; obligationType: string; status: string }>).find(
      (r) => r.obligationType === "vat_return" && r.status === "overdue"
    )!;
    expect(vat).toBeTruthy();
    const noNote = await t.as.patch(`${url}/${vat.id}`, { status: "dismissed" });
    expect(noNote.status).toBe(422);
    const na = await t.as.patch(`${url}/${vat.id}`, {
      status: "dismissed",
      note: "Filed by the previous accountant before we joined",
    });
    expect(na.status, na.text).toBe(200);
    expect(na.body.status).toBe("dismissed");
    // Regeneration keeps it not applicable.
    await t.as.post(`${url}/generate`, { year: 2026 });
    const row = await h.sql(`SELECT status FROM compliance_calendar WHERE id = $1`, [vat.id]);
    expect(row[0].status).toBe("dismissed");
    // Completing by hand is still refused; undoing is allowed.
    expect((await t.as.patch(`${url}/${vat.id}`, { status: "completed" })).status).toBe(409);
    const undo = await t.as.patch(`${url}/${vat.id}`, { status: "upcoming" });
    expect(undo.status, undo.text).toBe(200);
  });
});

describe("[X4][J3] cash-flow forecast payroll liabilities and fixed-asset input VAT", () => {
  it("an unpaid final settlement appears as a forecast outflow", async () => {
    const t = await h.createTenant({ name: "X4Cf" });
    const base = `/api/companies/${t.company.id}`;
    const emp = await t.as.post(`${base}/employees`, {
      fullName: "Forecast Leaver",
      nationality: "IN",
      joinDate: "2020-01-01",
      basicSalary: "8000.00",
    });
    const term = today();
    const s = await t.as.post(`${base}/payroll/settlements`, {
      employeeId: emp.body.id,
      terminationDate: term,
      reason: "End of contract",
      noticeDaysInLieu: 0,
      leaveEncashmentDays: 0,
    });
    expect(s.status, s.text).toBe(201);
    const f = await t.as.get(`${base}/cashflow/forecast?days=90`);
    expect(f.status, f.text).toBe(200);
    const items = (f.body.items ?? f.body.forecast?.items ?? []) as Array<{
      description: string;
      amount: number;
    }>;
    const row = items.find((i) => i.description === "Final settlement – Forecast Leaver");
    expect(row, JSON.stringify(items)).toBeTruthy();
    expect(row!.amount).toBeCloseTo(-Number(s.body.net), 2);
  });

  it("input VAT paid with a capitalised asset posts Dr 1050 and lands in VAT return Box 9", async () => {
    const t = await h.createTenant({ name: "X4FaVat", companyColumns: { emirate: "dubai" } });
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
      assetName: "Server",
      category: "Computer Equipment",
      purchaseDate: "2026-08-10",
      purchaseCost: 20000,
      usefulLifeYears: 4,
      paymentAccountId: bank.id,
      inputVat: 1000,
    });
    expect(a.status, a.text).toBe(201);
    expect(await bal(t, "1050")).toBe(100_000);
    expect(await bal(t, "1020")).toBe(-2_100_000);
    const rep = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-return?from=2026-07-01&to=2026-09-30`
    );
    expect(rep.status, rep.text).toBe(200);
    expect(rep.body.boxes.box9ExpensesAmount).toBe(20000);
    expect(rep.body.boxes.box9ExpensesVat).toBe(1000);
    expect(rep.body.reconciliation.hasUnexplainedDifference).toBe(false);
  });
});

describe("[X4][J3] expense claim reimbursed through payroll for a chosen employee", () => {
  it("the employee picker's employee_id is accepted when the submitter's email matches nobody", async () => {
    const t = await h.createTenant({ name: "X4Claim" });
    const approver = await addMember(t, "approver", "X4ClaimApprover");
    const base = `/api/companies/${t.company.id}`;
    const emp = await t.as.post(`${base}/employees`, {
      fullName: "Claimant Employee",
      email: "someone-else@harness.test",
      basicSalary: "4000.00",
    });
    const claim = await t.as.post(`${base}/expense-claims`, {
      title: "Taxi",
      items: [{ expense_date: today(), category: "travel", description: "Taxi", amount: 40 }],
    });
    expect([200, 201], claim.text).toContain(claim.status);
    const claimId = claim.body.id ?? claim.body.claim?.id;
    await t.as.post(`/api/expense-claims/${claimId}/submit`, {});
    const ok = await approver.as.post(`/api/expense-claims/${claimId}/approve`, {});
    expect(ok.status, ok.text).toBe(200);
    const auto = await t.as.post(`/api/expense-claims/${claimId}/payroll-reimbursement`, {
      enabled: true,
    });
    expect(auto.body.code).toBe("CLAIM_EMPLOYEE_REQUIRED");
    const picked = await t.as.post(`/api/expense-claims/${claimId}/payroll-reimbursement`, {
      enabled: true,
      employee_id: emp.body.id,
    });
    expect(picked.status, picked.text).toBe(200);
  });
});
