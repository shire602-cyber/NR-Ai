import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
const migration = (tag: string) => readFileSync(join(repoRoot, "migrations", tag + ".sql"), "utf8");

describe("AU7 historical migration integrity", () => {
  it("0039 preserves a paid payroll run and its payslip when a newer draft exists", async () => {
    const tenant = await h.createTenant();
    const paid = "30000000-0000-4000-8000-000000000001";
    const draft = "20000000-0000-4000-8000-000000000001";
    const [employee] = await h.sql<{ id: string }>(
      "INSERT INTO employees (company_id, full_name) VALUES ($1, 'Audit Employee') RETURNING id",
      [tenant.company.id]
    );

    // Rewind only the uniqueness added by this migration, in this file's disposable database.
    await h.sql("ALTER TABLE payroll_runs DROP CONSTRAINT payroll_runs_company_period_unique");
    await h.sql(
      `INSERT INTO payroll_runs (id, company_id, period_month, period_year, status, created_at)
       VALUES ($1, $3, 1, 2025, 'paid', '2025-01-20'), ($2, $3, 1, 2025, 'draft', '2025-01-30')`,
      [paid, draft, tenant.company.id]
    );
    await h.sql(
      "INSERT INTO payroll_items (payroll_run_id, employee_id, net_salary) VALUES ($1, $2, 5000)",
      [paid, employee.id]
    );

    // A preflight may refuse the ambiguous upgrade so an operator can reconcile the runs.
    try {
      await h.sql(migration("0039_payroll_state_machine"));
    } catch (err) {
      expect(String(err)).toMatch(/duplicate|reconcil|conflict/i);
    }
    expect(
      await h.sql(
        `SELECT r.status, i.net_salary::text AS net_salary FROM payroll_runs r
         JOIN payroll_items i ON i.payroll_run_id = r.id WHERE r.id = $1 AND i.employee_id = $2`,
        [paid, employee.id]
      )
    ).toEqual([{ status: "paid", net_salary: "5000.00" }]);
  });

  it("0074 renumbers a duplicate beyond 999 without colliding with an existing journal", async () => {
    const tenant = await h.createTenant();
    await h.sql(
      "ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_company_entry_number_unique"
    );
    await h.sql(
      `INSERT INTO journal_entries (company_id, created_by, date, entry_number)
       SELECT $1, $2, '2025-01-01', number
       FROM (VALUES ('JE-20250101-100'), ('JE-20250101-999'), ('JE-20250101-999')) n(number)`,
      [tenant.company.id, tenant.user.id]
    );

    await h.sql(migration("0074_journal_entry_unique_dedup"));
    expect(
      await h.sql(
        "SELECT entry_number FROM journal_entries WHERE company_id = $1 AND date = '2025-01-01' ORDER BY entry_number",
        [tenant.company.id]
      )
    ).toEqual([
      { entry_number: "JE-20250101-100" },
      { entry_number: "JE-20250101-1000" },
      { entry_number: "JE-20250101-999" },
    ]);
  });
});
