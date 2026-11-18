/**
 * E2 (J3-r2) payroll: the opening gratuity provision is booked in the ledger from the employee
 * records (month-end gratuity tie holds, no account code to type), the payslip PDF is named after
 * the employee and month, and the cash-flow forecast drops an employee after termination.
 */
import { afterEach, describe, expect, it } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

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

async function gl(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.credit*100) - ROUND(jl.debit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0].n) / 100;
}

describe("E2 (J3-r2) opening gratuity provision", () => {
  it("books the employees' opening provision (Dr 3040 / Cr 2036) once, so the month-end tie holds", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "E2Grat" });
    const c = `/api/companies/${t.company.id}`;
    const emp = await employee(t, {
      fullName: "Long Service",
      nationality: "IN",
      joinDate: "2021-01-01",
      basicSalary: "10000.00",
    });
    await t.as.patch(`/api/employees/${emp.id}`, {
      openingGratuityProvision: "40000.00",
      openingGratuityAsOf: "2026-09-30",
    });
    // D1 (N1): saving the provision on the employee books it (one source of truth).
    const before = await t.as.get(`${c}/payroll/opening-gratuity`);
    expect(before.status, before.text).toBe(200);
    expect(before.body).toMatchObject({ provision: 40000, booked: 40000, outstanding: 0 });
    expect(await gl(t, "2036")).toBe(40000);
    expect(await gl(t, "3040")).toBe(-40000);
    const again = await t.as.post(`${c}/payroll/opening-gratuity/book`, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("OPENING_GRATUITY_NOTHING_TO_BOOK");

    // A corrected provision books only the difference, on save.
    await t.as.patch(`/api/employees/${emp.id}`, {
      openingGratuityProvision: "39000.00",
      openingGratuityAsOf: "2026-09-30",
    });
    const lines = await h.sql<{ d: string }>(
      `SELECT jl.debit::text AS d FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source = 'opening_balance' AND a.code = '2036' AND jl.debit > 0`,
      [t.company.id]
    );
    expect(lines.map((l) => Number(l.d))).toEqual([1000]);
    expect(await gl(t, "2036")).toBe(39000);

    // The October run, approved: gratuity GL ties to opening + accrued.
    const run = await runFor(t, 10);
    expect((await t.as.post(`/api/payroll-runs/${run}/calculate`, {})).status).toBe(200);
    const approved = await t.as.post(`/api/payroll-runs/${run}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    const list = await t.as.get(`${c}/month-end/checklist?period=2026-10`);
    expect(list.status, list.text).toBe(200);
    const items = (list.body.checklist ?? list.body.items ?? list.body) as Array<any>;
    const tie = items
      .find((i) => i.key === "control_accounts")!
      .ties.find((x: any) => x.key === "gratuity");
    expect(tie).toMatchObject({ reconciled: true });

    // A viewer cannot post the opening entry.
    const viewer = await h.createSecondTenant({ name: "E2GratViewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      viewer.user.id,
    ]);
    expect((await viewer.as.post(`${c}/payroll/opening-gratuity/book`, {})).status).toBe(403);
  });
});

describe("E2 (J3-r2) payslip file name and forecast after termination", () => {
  it("names the payslip after the employee and month; the forecast drops the terminated employee", async () => {
    restore = freezeTime("2026-11-18T08:00:00Z");
    const t = await h.createTenant({ name: "E2Slip" });
    const c = `/api/companies/${t.company.id}`;
    const raj = await employee(t, {
      fullName: "Raj Kumar",
      nationality: "IN",
      joinDate: "2026-01-01",
      basicSalary: "6000.00",
      openingGratuityProvision: "0.00",
    });
    await employee(t, {
      fullName: "Sara Ali",
      nationality: "IN",
      joinDate: "2026-01-01",
      basicSalary: "9000.00",
      openingGratuityProvision: "0.00",
    });
    const run = await runFor(t, 10);
    expect((await t.as.post(`/api/payroll-runs/${run}/calculate`, {})).status).toBe(200);
    const approved = await t.as.post(`/api/payroll-runs/${run}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    const [item] = await h.sql<{ id: string }>(
      `SELECT id FROM payroll_items WHERE payroll_run_id = $1 AND employee_id = $2`,
      [run, raj.id]
    );
    const pdf = await t.as.get(`/api/payroll-items/${item.id}/payslip.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-disposition")).toBe(
      'attachment; filename="payslip-raj-kumar-2026-10.pdf"'
    );

    const nets = await h.sql<{ name: string; net: string }>(
      `SELECT e.full_name AS name, pi.net_salary::text AS net FROM payroll_items pi
         JOIN employees e ON e.id = pi.employee_id WHERE pi.payroll_run_id = $1`,
      [run]
    );
    const sara = Number(nets.find((n) => n.name === "Sara Ali")!.net);
    const term = await t.as.post(`/api/employees/${raj.id}/terminate`, {
      terminationDate: "2026-10-20",
      reason: "resignation",
    });
    expect(term.status, term.text).toBeLessThan(300);

    const { generateCashFlowForecast } =
      await import("../../server/services/cashflow-forecast.service");
    const f = await generateCashFlowForecast(t.company.id, { days: 90 });
    const payroll = f.items.filter(
      (i) => i.kind === "payroll" && /^Payroll \d{4}-\d{2}$/.test(i.description)
    );
    const dec = payroll.find((i) => i.description === "Payroll 2026-12");
    expect(dec, JSON.stringify(payroll)).toBeTruthy();
    expect(-dec!.amount).toBeCloseTo(sara, 2);
    void c;
  });
});
