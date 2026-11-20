/**
 * W3-D payroll against real Postgres: run state machine, kernel postings,
 * validation, deletion guard, SoD, leave, settlement, WPS SIF, payslips,
 * GPSSA export, multi-currency and expiry alerts. Test names carry the
 * report-09 issue ids.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
let t: Tenant;
let base: string;

const IBAN_1 = "AE070331234567890123456";
const IBAN_2 = "AE690260001015123456701";

/** A valid UAE IBAN (ISO 13616 mod-97 check digits) for account number `n`. */
function aeIban(n: number): string {
  const bban = `033${String(n).padStart(16, "0")}`;
  const check = 98n - (BigInt(`${bban}101400`) % 97n);
  return `AE${String(check).padStart(2, "0")}${bban}`;
}

async function createEmployee(tenant: Tenant, body: Record<string, unknown>) {
  const r = await tenant.as.post(`/api/companies/${tenant.company.id}/employees`, body);
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

async function createRun(tenant: Tenant, periodMonth: number, periodYear = 2026) {
  const r = await tenant.as.post(`/api/companies/${tenant.company.id}/payroll-runs`, {
    periodMonth,
    periodYear,
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; status: string };
}

async function calculate(tenant: Tenant, runId: string) {
  const r = await tenant.as.post(`/api/payroll-runs/${runId}/calculate`, {});
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function accountBalance(companyId: string, code: string): Promise<number> {
  const rows = await h.sql<{ bal: string }>(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS bal
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [companyId, code]
  );
  return Number(rows[0].bal);
}

async function entriesFor(companyId: string, source: string, sourceId: string) {
  return h.sql(
    `SELECT id, entry_kind, reversed_by_entry_id FROM journal_entries
      WHERE company_id = $1 AND source = $2 AND source_id = $3 ORDER BY created_at`,
    [companyId, source, sourceId]
  );
}

const expat = {
  fullName: "Rahul Nair",
  nationality: "IN",
  joinDate: "2018-01-01",
  basicSalary: "10000.00",
  housingAllowance: "3000.00",
  // A4 (M10): nil opening gratuity provision confirmed (first run catches up in full).
  openingGratuityProvision: "0.00",
  molPersonId: "10012345678902",
  routingCode: "602620101",
  iban: IBAN_2,
  email: "rahul@harness.test",
};
const emirati = {
  fullName: "Aisha Al Mansoori",
  nationality: "AE",
  joinDate: "2020-06-01",
  basicSalary: "20000.00",
  housingAllowance: "5000.00",
  transportAllowance: "2000.00",
  molPersonId: "10012345678901",
  routingCode: "600310101",
  iban: IBAN_1,
  emiratesId: "784-1990-1234567-6",
};

beforeAll(async () => {
  t = await h.createTenant({ name: "Payroll" });
  base = `/api/companies/${t.company.id}`;
  await createEmployee(t, expat);
  await createEmployee(t, emirati);
});

describe("validation (R09-08 .. R09-11)", () => {
  it("R09-08: period month 13 and year 1900 are rejected", async () => {
    const m = await t.as.post(`${base}/payroll-runs`, { periodMonth: 13, periodYear: 2026 });
    expect(m.status).toBe(400);
    expect(m.body.fields).toHaveProperty("periodMonth");
    const y = await t.as.post(`${base}/payroll-runs`, { periodMonth: 1, periodYear: 1900 });
    expect(y.status).toBe(400);
    expect(y.body.fields).toHaveProperty("periodYear");
  });

  it("R09-09: IBAN 'XX', bad Emirates ID, short MOL id and routing code are rejected", async () => {
    for (const bad of [
      { iban: "XX" },
      { emiratesId: "784-1990-1234567-1" },
      { molPersonId: "123" },
      { routingCode: "12" },
      { nationality: "Indian national" },
    ]) {
      const r = await t.as.post(`${base}/employees`, { fullName: "Bad", ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.code).toBe("VALIDATION_ERROR");
    }
    const ok = await t.as.post(`${base}/employees`, {
      fullName: "Emirates Id Stored",
      // X4: a different person from `emirati` (Emirates IDs are unique per company).
      emiratesId: "784199112345675",
      contractType: "full_time",
      contractStart: "2024-01-01",
      contractEnd: "2026-12-31",
      visaExpiry: "2027-01-01",
      salaryCurrency: "AED",
    });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.emirates_id).toBe("784-1991-1234567-5");
    expect(ok.body.contract_type).toBe("full_time");
    await t.as.delete(`/api/employees/${ok.body.id}`);
  });

  it("R09-10: employee PATCH validates every field and rejects an empty body", async () => {
    const emp = await createEmployee(t, { fullName: "Patch Target", basicSalary: "1000.00" });
    expect((await t.as.patch(`/api/employees/${emp.id}`, {})).status).toBe(400);
    expect((await t.as.patch(`/api/employees/${emp.id}`, { basicSalary: "abc" })).status).toBe(400);
    expect((await t.as.patch(`/api/employees/${emp.id}`, { basicSalary: -5 })).status).toBe(400);
    expect((await t.as.patch(`/api/employees/${emp.id}`, { iban: "XX" })).status).toBe(400);
    expect((await t.as.patch(`/api/employees/${emp.id}`, { companyId: t.company.id })).status).toBe(
      400
    );
    const ok = await t.as.patch(`/api/employees/${emp.id}`, {
      basicSalary: "1500.00",
      salaryChangeReason: "Annual raise",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.total_salary).toBe("1500.00");
    const hist = await t.as.get(`/api/employees/${emp.id}/salary-history`);
    expect(hist.body.map((x: { basic_salary: string }) => x.basic_salary)).toEqual([
      "1500.00",
      "1000.00",
    ]);
    await t.as.delete(`/api/employees/${emp.id}`);
  });
});

describe("run state machine and postings (R09-02, R09-12, R09-13, R09-22)", () => {
  let runId: string;

  it("R09-02: PATCH { status: 'approved' } -> 400 and the run stays draft", async () => {
    const run = await createRun(t, 1);
    runId = run.id;
    const r = await t.as.patch(`/api/payroll-runs/${runId}`, { status: "approved" });
    expect(r.status).toBe(400);
    const rows = await h.sql(`SELECT status, journal_entry_id FROM payroll_runs WHERE id = $1`, [
      runId,
    ]);
    expect(rows[0]).toMatchObject({ status: "draft", journal_entry_id: null });
    // Approving a draft is refused by the state machine.
    expect((await t.as.post(`/api/payroll-runs/${runId}/approve`, {})).status).toBe(409);
  });

  it("R09-11: item PATCH rejects negative / NaN overtime and deductions", async () => {
    await calculate(t, runId);
    const items = (await t.as.get(`/api/payroll-runs/${runId}/items`)).body as Array<{
      id: string;
    }>;
    const itemId = items[0].id;
    for (const bad of [
      { overtime: -5000 },
      { overtime: "NaN" },
      { deductions: -1 },
      { unpaidLeaveDays: 40 },
      {},
    ]) {
      const r = await t.as.patch(`/api/payroll-items/${itemId}`, bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await t.as.patch(`/api/payroll-items/${itemId}`, { overtimeHours: 10 });
    expect(ok.status, ok.text).toBe(200);
  });

  it("R09-06: Emirati pension is 5% of basic + housing (1,250)", async () => {
    const rows = await h.sql(
      `SELECT pi.pension_employee, pi.pension_employer, pi.gratuity_accrual
         FROM payroll_items pi JOIN employees e ON e.id = pi.employee_id
        WHERE pi.payroll_run_id = $1 AND e.nationality = 'AE'`,
      [runId]
    );
    expect(rows[0]).toMatchObject({
      pension_employee: "1250.00",
      pension_employer: "3125.00",
      gratuity_accrual: "0.00",
    });
  });

  it("R09-13: approve then pay nets salaries payable to 0; items approved then paid (R09-12)", async () => {
    const appr = await t.as.post(`/api/payroll-runs/${runId}/approve`, {});
    expect(appr.status, appr.text).toBe(200);
    expect(appr.body.status).toBe("approved");
    const items = await h.sql(
      `SELECT DISTINCT status FROM payroll_items WHERE payroll_run_id = $1`,
      [runId]
    );
    expect(items).toEqual([{ status: "approved" }]);
    const run = await h.sql(`SELECT total_net FROM payroll_runs WHERE id = $1`, [runId]);
    expect(await accountBalance(t.company.id, "2030")).toBe(-Number(run[0].total_net));

    // Double approve -> 409
    expect((await t.as.post(`/api/payroll-runs/${runId}/approve`, {})).status).toBe(409);

    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`/api/payroll-runs/${runId}/pay`, {
      paymentAccountId: bank.id,
      paymentDate: "2026-02-03",
    });
    expect(pay.status, pay.text).toBe(200);
    expect(pay.body.status).toBe("paid");
    expect(await accountBalance(t.company.id, "2030")).toBe(0);
    const paidItems = await h.sql(
      `SELECT DISTINCT status FROM payroll_items WHERE payroll_run_id = $1`,
      [runId]
    );
    expect(paidItems).toEqual([{ status: "paid" }]);
    expect(
      (
        await t.as.post(`/api/payroll-runs/${runId}/pay`, {
          paymentAccountId: bank.id,
          paymentDate: "2026-02-03",
        })
      ).status
    ).toBe(409);
  });

  it("R09-22: unpay and unapprove are kernel reversals; the run can be recalculated", async () => {
    const unpay = await t.as.post(`/api/payroll-runs/${runId}/unpay`, { reason: "Wrong bank" });
    expect(unpay.status, unpay.text).toBe(200);
    expect(unpay.body.status).toBe("approved");
    const unapprove = await t.as.post(`/api/payroll-runs/${runId}/unapprove`, {
      reason: "Recalculate",
    });
    expect(unapprove.status, unapprove.text).toBe(200);
    expect(unapprove.body.status).toBe("reversed");
    const accrual = await entriesFor(t.company.id, "payroll", runId);
    expect(accrual.filter((e) => e.entry_kind === "reversal")).toHaveLength(1);
    expect(accrual.find((e) => e.entry_kind !== "reversal")?.reversed_by_entry_id).toBeTruthy();
    expect(await accountBalance(t.company.id, "2030")).toBe(0);
    expect(await accountBalance(t.company.id, "5020")).toBe(0);
    const again = await calculate(t, runId);
    expect(again.status).toBe("calculated");
  });

  it("R09-13: a failure mid-approve leaves nothing behind", async () => {
    await h.sql(`CREATE OR REPLACE FUNCTION w3d_fail_items() RETURNS trigger AS $$
                 BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql`);
    await h.sql(`CREATE TRIGGER w3d_fail BEFORE UPDATE ON payroll_items
                 FOR EACH ROW WHEN (NEW.status = 'approved') EXECUTE FUNCTION w3d_fail_items()`);
    try {
      const before = await entriesFor(t.company.id, "payroll", runId);
      const r = await t.as.post(`/api/payroll-runs/${runId}/approve`, {});
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect(await entriesFor(t.company.id, "payroll", runId)).toHaveLength(before.length);
      const run = await h.sql(`SELECT status, journal_entry_id FROM payroll_runs WHERE id = $1`, [
        runId,
      ]);
      expect(run[0]).toMatchObject({ status: "calculated", journal_entry_id: null });
    } finally {
      await h.sql(`DROP TRIGGER IF EXISTS w3d_fail ON payroll_items`);
      await h.sql(`DROP FUNCTION IF EXISTS w3d_fail_items()`);
    }
  });

  it("R09-13: calculate is atomic — a negative net rolls back the delete", async () => {
    const run = await createRun(t, 11, 2025);
    await calculate(t, run.id);
    const before = await h.sql(
      `SELECT COUNT(*)::int AS n FROM payroll_items WHERE payroll_run_id = $1`,
      [run.id]
    );
    // A huge unpaid-leave deduction cannot make net negative (capped), so force it via settings.
    await h.sql(
      `INSERT INTO payroll_settings (company_id, legal_params) VALUES ($1, $2::jsonb)
       ON CONFLICT (company_id) DO UPDATE SET legal_params = EXCLUDED.legal_params`,
      [
        t.company.id,
        JSON.stringify({
          pension: {
            AE: {
              employeeRate: "1",
              employerRate: "0.125",
              base: "gross",
              minContributionSalary: "100000.00",
              maxContributionSalary: null,
              confirmed: false,
            },
          },
        }),
      ]
    );
    try {
      const r = await t.as.post(`/api/payroll-runs/${run.id}/calculate`, {});
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("NEGATIVE_NET_SALARY");
      const after = await h.sql(
        `SELECT COUNT(*)::int AS n FROM payroll_items WHERE payroll_run_id = $1`,
        [run.id]
      );
      expect(after[0].n).toBe(before[0].n);
    } finally {
      await h.sql(`DELETE FROM payroll_settings WHERE company_id = $1`, [t.company.id]);
    }
  });
});

describe("employee history (R09-05, R09-21)", () => {
  it("R09-05: deleting an employee with payroll history -> 409, FK is RESTRICT", async () => {
    const emp = await createEmployee(t, {
      ...expat,
      fullName: "History Holder",
      molPersonId: undefined,
      email: undefined,
      iban: undefined, // X4: IBANs are unique per company
    });
    const run = await createRun(t, 2);
    await calculate(t, run.id);
    const del = await t.as.delete(`/api/employees/${emp.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("EMPLOYEE_HAS_PAYROLL_HISTORY");
    await expect(h.sql(`DELETE FROM employees WHERE id = $1`, [emp.id])).rejects.toMatchObject({
      code: "23503",
    });
    const arch = await t.as.post(`/api/employees/${emp.id}/archive`, {});
    expect(arch.status).toBe(200);
    expect(arch.body.archived_at).toBeTruthy();
    const items = await h.sql(
      `SELECT COUNT(*)::int AS n FROM payroll_items WHERE employee_id = $1`,
      [emp.id]
    );
    expect(items[0].n).toBe(1);
  });

  it("R09-21: expiring visa emits one alert per document and date", async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const emp = await createEmployee(t, {
      fullName: "Visa Soon",
      visaExpiry: soon,
      basicSalary: "4000.00",
    });
    const list = await t.as.get(`${base}/payroll/expiries?days=30`);
    expect(
      list.body.some(
        (e: { employeeId: string; document: string }) =>
          e.employeeId === emp.id && e.document === "visa"
      )
    ).toBe(true);
    const first = await t.as.post(`${base}/payroll/expiries/scan`, {});
    expect(first.body.emitted).toBeGreaterThanOrEqual(1);
    const second = await t.as.post(`${base}/payroll/expiries/scan`, {});
    expect(second.body.emitted).toBe(0);
  });
});

describe("segregation of duties (R09-23)", () => {
  it("R09-23: the preparer cannot approve; a different approver can", async () => {
    const owner = await h.createTenant({ name: "SoD" });
    const approver = await h.createSecondTenant({ name: "SoDApprover" });
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'approver')`,
      [owner.company.id, approver.user.id]
    );
    await createEmployee(owner, expat);
    const run = await createRun(owner, 3);
    await calculate(owner, run.id);
    const self = await owner.as.post(`/api/payroll-runs/${run.id}/approve`, {});
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("SAME_ACTOR_APPROVAL");
    // An accountant-like role without payroll.approve is refused.
    const other = await approver.as.post(`/api/payroll-runs/${run.id}/approve`, {});
    expect(other.status, other.text).toBe(200);
    expect(other.body.approved_by).toBe(approver.user.id);
  });
});

describe("leave (R09-15)", () => {
  it("R09-15: 5 approved unpaid-leave days reduce basic by 5/30 and flow into the SIF", async () => {
    const lt = await t.as.get(`${base}/payroll/leave-types`);
    const unpaid = lt.body.find((x: { code: string }) => x.code === "unpaid");
    const emps = (await t.as.get(`${base}/employees`)).body as Array<{
      id: string;
      full_name: string;
    }>;
    const rahul = emps.find((e) => e.full_name === "Rahul Nair")!;
    const req = await t.as.post(`${base}/payroll/leave-requests`, {
      employeeId: rahul.id,
      leaveTypeId: unpaid.id,
      startDate: "2026-04-06",
      endDate: "2026-04-10",
    });
    expect(req.status, req.text).toBe(201);
    const dec = await t.as.post(`${base}/payroll/leave-requests/${req.body.id}/decision`, {
      decision: "approve",
    });
    expect(dec.status, dec.text).toBe(200);
    const run = await createRun(t, 4);
    await calculate(t, run.id);
    const rows = await h.sql(
      `SELECT unpaid_leave_days, unpaid_leave_deduction, net_salary FROM payroll_items
        WHERE payroll_run_id = $1 AND employee_id = $2`,
      [run.id, rahul.id]
    );
    expect(rows[0].unpaid_leave_days).toBe("5.00");
    expect(rows[0].unpaid_leave_deduction).toBe("1666.67"); // 10,000 x 5/30
    expect(Number(rows[0].net_salary)).toBeCloseTo(13000 - 1666.67, 2);

    // WPS: blank employer MOL id blocks the SIF with a per-employee report (R09-04).
    const blocked = await t.as.get(`/api/payroll-runs/${run.id}/generate-sif`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("SIF_PREVALIDATION_FAILED");
    const fields = blocked.body.details.issues.map((i: { field: string }) => i.field);
    expect(fields).toContain("mohreEstablishmentId");
    const settings = await t.as.put(`${base}/payroll/wps-settings`, {
      mohreEstablishmentId: "1000000000123",
      wpsEmployerRoutingCode: "600310101",
    });
    expect(settings.status, settings.text).toBe(200);
    // Employees without MOL ids (from other tests) still block, per employee.
    const pre = await t.as.get(`/api/payroll-runs/${run.id}/sif-prevalidation`);
    const blank = pre.body.issues.filter((i: { scope: string }) => i.scope === "employee");
    let n = 0;
    for (const i of blank) {
      // X4: IBANs are unique per company, so each employee gets its own valid IBAN.
      await h.sql(
        `UPDATE employees SET mol_person_id = '10012345678999', routing_code = '600310101', iban = $2 WHERE id = $1`,
        [i.employeeId, aeIban(++n)]
      );
    }
    const sif = await t.as.get(`/api/payroll-runs/${run.id}/generate-sif`);
    expect(sif.status, sif.text).toBe(200);
    expect(sif.headers.get("content-disposition")).toMatch(/1000000000123\d{12}\.SIF/);
    const edr = sif.text.split("\r\n").find((l) => l.startsWith("EDR,10012345678902"))!;
    expect(edr.split(",")[9]).toBe("5"); // days on leave
    const check = await t.as.post(`${base}/payroll/sif/validate`, { content: sif.text });
    expect(check.body.valid).toBe(true);

    // R09-18: WPS status is recorded manually; rejection needs notes.
    expect(
      (await t.as.post(`/api/payroll-runs/${run.id}/wps-status`, { wpsStatus: "accepted" })).status
    ).toBe(409);
    expect(
      (await t.as.post(`/api/payroll-runs/${run.id}/wps-status`, { wpsStatus: "submitted" })).status
    ).toBe(200);
    expect(
      (await t.as.post(`/api/payroll-runs/${run.id}/wps-status`, { wpsStatus: "rejected" })).status
    ).toBe(400);
    const rej = await t.as.post(`/api/payroll-runs/${run.id}/wps-status`, {
      wpsStatus: "rejected",
      notes: "IBAN mismatch",
    });
    expect(rej.status).toBe(200);
    expect(rej.body.wps_status).toBe("rejected");
  });
});

describe("payslips and GPSSA (R09-16, R09-20)", () => {
  it("R09-16 / R09-20: payslip link, PDF, honest email result, GPSSA CSV", async () => {
    const run = await createRun(t, 5);
    await calculate(t, run.id);
    const items = (await t.as.get(`/api/payroll-runs/${run.id}/items`)).body as Array<{
      id: string;
    }>;
    expect((await t.as.post(`/api/payroll-items/${items[0].id}/payslip-link`, {})).status).toBe(
      409
    );
    expect((await t.as.post(`/api/payroll-runs/${run.id}/approve`, {})).status).toBe(200);

    const link = await t.as.post(`/api/payroll-items/${items[0].id}/payslip-link`, {});
    expect(link.status, link.text).toBe(201);
    const token = String(link.body.url)
      .split("/api/payslips/")[1]
      .replace(/\/pdf$/, "");
    const view = await h.anon.get(`/api/payslips/${token}`);
    expect(view.status, view.text).toBe(200);
    expect(view.body.lines.net).toMatch(/^\d+\.\d{2}$/);
    const pdf = await h.anon.get(`/api/payslips/${token}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toMatch(/application\/pdf/);
    expect((await h.anon.get(`/api/payslips/not-a-real-token-123456789`)).status).toBe(404);

    const mail = await t.as.post(`/api/payroll-runs/${run.id}/payslips/email`, {});
    expect(mail.status, mail.text).toBe(200);
    // No email provider in the harness: nothing may claim to be sent.
    expect(mail.body.sent).toBe(0);
    expect(mail.body.results.every((r: { sent: boolean }) => r.sent === false)).toBe(true);

    const csv = await t.as.get(`/api/payroll-runs/${run.id}/gpssa-export`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Aisha Al Mansoori");
    expect(csv.text).toContain("25000.00,1250.00,3125.00,4375.00");
    expect(csv.text).not.toContain("Rahul Nair");
  });
});

describe("multi-currency (R09-19)", () => {
  it("R09-19: a USD salary is converted to AED at the run date for posting and SIF", async () => {
    const c = await h.createTenant({ name: "Fx" });
    await h.sql(
      `INSERT INTO exchange_rates (company_id, base_currency, target_currency, rate, rate_type, date)
       VALUES ($1, 'USD', 'AED', 3.6725, 'spot', '2026-01-01')`,
      [c.company.id]
    );
    await createEmployee(c, {
      fullName: "Usd Earner",
      nationality: "US",
      basicSalary: "1000.00",
      salaryCurrency: "USD",
      joinDate: "2025-01-01",
      openingGratuityProvision: "0.00",
    });
    const run = await createRun(c, 6);
    await calculate(c, run.id);
    const item = await h.sql(
      `SELECT basic_salary, salary_currency, exchange_rate, net_salary_foreign FROM payroll_items WHERE payroll_run_id = $1`,
      [run.id]
    );
    expect(item[0]).toMatchObject({
      basic_salary: "3672.50",
      salary_currency: "USD",
      net_salary_foreign: "1000.00",
    });
    expect(Number(item[0].exchange_rate)).toBeCloseTo(3.6725, 6);
  });
});

describe("end-of-service settlement (R09-17)", () => {
  it("R09-17: 6 years + 182 days on basic 10,000 = 49,986.30 posted through the kernel", async () => {
    const c = await h.createTenant({ name: "Eos" });
    const emp = await createEmployee(c, {
      fullName: "Leaver",
      nationality: "IN",
      basicSalary: "10000.00",
      joinDate: "2019-01-01",
    });
    const body = {
      employeeId: emp.id,
      // C2 (NL7): the last working day counts, so 182 trailing days end on 1 Jul.
      terminationDate: "2025-07-01",
      reason: "Resignation",
      leaveEncashmentDays: 0,
    };
    const preview = await c.as.post(
      `/api/companies/${c.company.id}/payroll/settlements/preview`,
      body
    );
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.gratuity).toBe("49986.30");
    const posted = await c.as.post(`/api/companies/${c.company.id}/payroll/settlements`, body);
    expect(posted.status, posted.text).toBe(201);
    expect(posted.body.net).toBe("49986.30");
    expect(await accountBalance(c.company.id, "5028")).toBeCloseTo(49986.3, 2);
    expect(await accountBalance(c.company.id, "2030")).toBeCloseTo(-49986.3, 2);
    const e = await h.sql(`SELECT status FROM employees WHERE id = $1`, [emp.id]);
    expect(e[0].status).toBe("terminated");
    expect(
      (await c.as.post(`/api/companies/${c.company.id}/payroll/settlements`, body)).status
    ).toBe(409);
  });
});
