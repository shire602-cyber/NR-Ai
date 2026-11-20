/**
 * W3-E budgets: validation, freeze after approval, maker-checker, variance direction,
 * analytics link, versions, copy, import/export, cost-centre dimension, variance alerts.
 * Issue ids: R13-10, R13-11, R13-12, R13-26, R13-27, R13-28, R13-29.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountByCode, freezeTime, useHarness, type Tenant } from "./harness";
import { NOW, seedReport13 } from "./w3e-seed";
import { onDomainEvent } from "../../server/platform/domain-events";

const h = useHarness();
let a: Tenant;
let accountant: Tenant;
let viewer: Tenant;
let restore: () => void;
let planId: string;
let rentLineId: string;
let salesId: string;
let rentId: string;

const plans = () => `/api/companies/${a.company.id}/budget-plans`;

async function join(t: Tenant, role: string) {
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,$3)`, [
    a.company.id,
    t.user.id,
    role,
  ]);
}

beforeAll(async () => {
  restore = freezeTime(NOW);
  a = await h.createTenant();
  accountant = await h.createSecondTenant();
  viewer = await h.createSecondTenant();
  await join(accountant, "accountant");
  await join(viewer, "viewer");
  await seedReport13(h.sql, a);
  salesId = (await accountByCode(a, "4010")).id;
  rentId = (await accountByCode(a, "5020")).id;
});
afterAll(() => restore());

const planBody = (over: Record<string, unknown> = {}) => ({
  name: "FY2026",
  fiscalYear: 2026,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  ...over,
});

describe("R13-10 validation", () => {
  it("rejects end before start, garbage years and a plan longer than 12 months", async () => {
    const bad = await a.as.post(
      plans(),
      planBody({ startDate: "2026-12-01", endDate: "2026-01-31" })
    );
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_ERROR");
    expect((await a.as.post(plans(), planBody({ fiscalYear: "abc" }))).status).toBe(400);
    expect((await a.as.post(plans(), planBody({ endDate: "2027-06-30" }))).status).toBe(400);
    expect((await a.as.post(plans(), planBody({ status: "approved" }))).status).toBe(400);
    expect(
      await h.sql("SELECT 1 FROM budget_plans WHERE company_id = $1", [a.company.id])
    ).toHaveLength(0);
  });

  it("rejects non-numeric and negative month amounts unless the line is contra", async () => {
    const ok = await a.as.post(plans(), planBody());
    expect(ok.status).toBe(201);
    planId = ok.body.id;
    const lines = `/api/budget-plans/${planId}/lines`;
    expect(
      (await a.as.post(lines, { category: "Sales", accountId: salesId, nov: "abc" })).status
    ).toBe(400);
    expect(
      (await a.as.post(lines, { category: "Sales", accountId: salesId, nov: -5 })).status
    ).toBe(400);
    const contra = await a.as.post(lines, {
      category: "Discounts",
      accountId: salesId,
      isContra: true,
      nov: -50,
    });
    expect(contra.status).toBe(201);
    await a.as.delete(`/api/budget-lines/${contra.body.id}`);
    const sales = await a.as.post(lines, {
      category: "Sales",
      accountId: salesId,
      nov: 1000,
      dec: "1200.50",
    });
    expect(sales.status).toBe(201);
    expect(Number(sales.body.annual_total)).toBe(2200.5);
    expect(sales.body.id).toBeTruthy();
    const rent = await a.as.post(lines, { category: "Rent", accountId: rentId, nov: 500 });
    rentLineId = rent.body.id;
    const patch = await a.as.patch(`/api/budget-lines/${rentLineId}`, { nov: "abc" });
    expect(patch.status).toBe(400);
    const foreign = await a.as.post(lines, {
      category: "Other",
      accountId: "00000000-0000-4000-8000-000000000000",
    });
    expect(foreign.status).toBe(400);
  });
});

describe("R13-29 approval and freeze", () => {
  it("a viewer cannot approve; the creator cannot approve in a multi-user company", async () => {
    const v = await viewer.as.post(`/api/budget-plans/${planId}/approve`);
    expect(v.status).toBe(403);
    const self = await a.as.post(`/api/budget-plans/${planId}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("SAME_ACTOR_APPROVAL");
  });

  it("a different user with documents.approve approves; lines are then frozen (409)", async () => {
    const ok = await accountant.as.post(`/api/budget-plans/${planId}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    expect(ok.body.approved_by).toBe(accountant.user.id);
    const add = await a.as.post(`/api/budget-plans/${planId}/lines`, {
      category: "Late add",
      accountId: rentId,
      nov: 10,
    });
    expect(add.status).toBe(409);
    expect(add.body.code).toBe("BUDGET_FROZEN");
    expect((await a.as.patch(`/api/budget-lines/${rentLineId}`, { nov: 900 })).status).toBe(409);
    expect((await a.as.delete(`/api/budget-lines/${rentLineId}`)).status).toBe(409);
    expect((await a.as.patch(`/api/budget-plans/${planId}`, { name: "renamed" })).status).toBe(409);
    expect((await a.as.delete(`/api/budget-plans/${planId}`)).status).toBe(409);
  });

  it("a cross-tenant caller gets 404, not the plan", async () => {
    const other = await h.createSecondTenant();
    expect((await other.as.get(`/api/budget-plans/${planId}`)).status).toBe(404);
    expect((await other.as.get(`/api/budget-plans/${planId}/variance`)).status).toBe(404);
  });
});

describe("R13-11 variance direction and year-month keys", () => {
  it("income above budget is favourable; expense above budget is not", async () => {
    const r = await a.as.get(`/api/budget-plans/${planId}/variance`);
    expect(r.status).toBe(200);
    const sales = r.body.varianceLines.find((l: any) => l.category === "Sales");
    const rent = r.body.varianceLines.find((l: any) => l.category === "Rent");
    // Nov revenue is 2,000 against a 1,000 budget.
    expect(sales.months.nov).toMatchObject({
      periodKey: "2026-11",
      budget: 1000,
      actual: 2000,
      variance: 1000,
      favourable: true,
    });
    // Nov rent is 800 against a 500 budget.
    expect(rent.months.nov).toMatchObject({
      budget: 500,
      actual: 800,
      variance: -300,
      favourable: false,
    });
    expect(rent.months.nov.variancePercent).toBe(-60);
    expect(sales.totals.favourable).toBe(true);
  });

  it("a plan spanning two calendar years keeps Dec 2026 and Jan 2027 apart", async () => {
    const p = await a.as.post(
      plans(),
      planBody({ name: "Winter", startDate: "2026-12-01", endDate: "2027-01-31" })
    );
    expect(p.status).toBe(201);
    const line = await a.as.post(`/api/budget-plans/${p.body.id}/lines`, {
      category: "Rent",
      accountId: rentId,
      dec: 100,
      jan: 200,
    });
    expect(line.status).toBe(201);
    const v = await a.as.get(`/api/budget-plans/${p.body.id}/variance`);
    expect(v.body.periods).toEqual(["2026-12", "2027-01"]);
    const m = v.body.varianceLines[0].months;
    expect(m.dec.periodKey).toBe("2026-12");
    expect(m.jan.periodKey).toBe("2027-01");
    expect(m.jan.budget).toBe(200);
  });
});

describe("R13-12 / R13-26 budget vs actual reads the approved plan", () => {
  it("returns budgeted amounts for mapped accounts only", async () => {
    const r = await a.as.get(
      `/api/analytics/budget-vs-actual?companyId=${a.company.id}&year=2026&month=11`
    );
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    const sales = r.body.find((x: any) => x.accountId === salesId);
    const rent = r.body.find((x: any) => x.accountId === rentId);
    expect(sales).toMatchObject({ budgeted: 1000, actual: 2000, variance: 1000, favourable: true });
    expect(rent).toMatchObject({ budgeted: 500, actual: 800, variance: -300, favourable: false });
    const names = r.body.map((x: any) => x.accountName.toLowerCase()).join(",");
    expect(names).not.toMatch(/bank|receivable|vat/);
    const none = await a.as.get(
      `/api/analytics/budget-vs-actual?companyId=${a.company.id}&year=2019`
    );
    expect(none.body).toEqual([]);
    expect(
      (await a.as.get(`/api/analytics/budget-vs-actual?companyId=${a.company.id}&month=13`)).status
    ).toBe(400);
  });
});

describe("R13-28 versions, copy, cost centre", () => {
  it("creates a new draft version and approving it closes the previous one", async () => {
    const v2 = await a.as.post(`/api/budget-plans/${planId}/new-version`);
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect(v2.body.status).toBe("draft");
    const lines = await a.as.get(`/api/budget-plans/${v2.body.id}/lines`);
    expect(lines.body).toHaveLength(2);
    const edit = await a.as.patch(
      `/api/budget-lines/${lines.body.find((l: any) => l.category === "Rent").id}`,
      { nov: 700 }
    );
    expect(edit.status).toBe(200);
    const approved = await accountant.as.post(`/api/budget-plans/${v2.body.id}/approve`);
    expect(approved.status).toBe(200);
    const versions = await a.as.get(`/api/budget-plans/${planId}/versions`);
    expect(versions.body.map((v: any) => [v.version, v.status])).toEqual([
      [1, "closed"],
      [2, "approved"],
    ]);
    // analytics now follows v2
    const r = await a.as.get(
      `/api/analytics/budget-vs-actual?companyId=${a.company.id}&year=2026&month=11`
    );
    expect(r.body.find((x: any) => x.accountId === rentId).budgeted).toBe(700);
    planId = v2.body.id;
  });

  it("copies a plan from last year with an uplift", async () => {
    const c = await a.as.post(`/api/budget-plans/${planId}/copy`, {
      fiscalYear: 2027,
      adjustPct: 10,
    });
    expect(c.status).toBe(201);
    expect(c.body.fiscal_year).toBe(2027);
    expect(String(c.body.start_date)).toContain("2027-01-01");
    expect(c.body.copiedLines).toBe(2);
    const lines = await a.as.get(`/api/budget-plans/${c.body.id}/lines`);
    const sales = lines.body.find((l: any) => l.category === "Sales");
    expect(Number(sales.nov)).toBe(1100);
  });

  it("a cost-centre line only counts journal lines tagged with that cost centre", async () => {
    const cc = (
      await h.sql(
        `INSERT INTO cost_centers (company_id, code, name) VALUES ($1,'DXB','Dubai') RETURNING id`,
        [a.company.id]
      )
    )[0].id;
    await h.sql(
      `UPDATE journal_lines SET cost_center_id = $2
        WHERE account_id = $3 AND entry_id IN (
          SELECT id FROM journal_entries WHERE company_id = $1 AND date >= '2026-11-01')`,
      [a.company.id, cc, rentId]
    );
    const p = await a.as.post(plans(), planBody({ name: "DXB only", costCenterId: cc }));
    expect(p.status).toBe(201);
    await a.as.post(`/api/budget-plans/${p.body.id}/lines`, {
      category: "Rent",
      accountId: rentId,
      nov: 500,
    });
    const tagged = await a.as.get(`/api/budget-plans/${p.body.id}/variance`);
    expect(tagged.body.varianceLines[0].months.nov.actual).toBe(800);
    const other = (
      await h.sql(
        `INSERT INTO cost_centers (company_id, code, name) VALUES ($1,'AUH','Abu Dhabi') RETURNING id`,
        [a.company.id]
      )
    )[0].id;
    const q = await a.as.post(plans(), planBody({ name: "AUH only", costCenterId: other }));
    await a.as.post(`/api/budget-plans/${q.body.id}/lines`, {
      category: "Rent",
      accountId: rentId,
      nov: 500,
    });
    const none = await a.as.get(`/api/budget-plans/${q.body.id}/variance`);
    expect(none.body.varianceLines[0].months.nov.actual).toBe(0);
    const foreign = await a.as.post(
      plans(),
      planBody({ costCenterId: "00000000-0000-4000-8000-000000000000" })
    );
    expect(foreign.status).toBe(400);
  });
});

describe("R13-27 import / export", () => {
  it("exports csv and re-imports it into a draft plan; bad rows import nothing", async () => {
    const csv = await a.as.get(`/api/budget-plans/${planId}/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("category,account_code,cost_center_code,is_contra,jan");
    expect(csv.text).toContain("Sales,4010");

    const p = await a.as.post(plans(), planBody({ name: "Imported" }));
    const body = [
      "category,account_code,jan,feb,nov",
      "Sales,4010,100,200,300",
      "Rent,5020,10,20,30",
    ].join("\n");
    const ok = await a.as.post(`/api/budget-plans/${p.body.id}/import`, { csv: body });
    expect(ok.status).toBe(200);
    expect(ok.body.imported).toBe(2);
    const lines = await a.as.get(`/api/budget-plans/${p.body.id}/lines`);
    expect(Number(lines.body.find((l: any) => l.category === "Sales").annual_total)).toBe(600);

    const bad = await a.as.post(`/api/budget-plans/${p.body.id}/import`, {
      csv: "category,account_code,jan\nGhost,9999,5\nNeg,4010,-5",
      replace: true,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("IMPORT_INVALID");
    expect((await a.as.get(`/api/budget-plans/${p.body.id}/lines`)).body).toHaveLength(2);

    const xlsx = await a.as.get(`/api/budget-plans/${planId}/export?format=xlsx`);
    expect(xlsx.status).toBe(200);
  });
});

describe("R13-29 variance alerts", () => {
  it("records one alert per breached line-month and emits a domain event once", async () => {
    const seen: any[] = [];
    const off = onDomainEvent("budget.variance_alert", (e) => void seen.push(e.payload));
    const first = await a.as.post(`/api/budget-plans/${planId}/variance/scan`);
    expect(first.status).toBe(200);
    // Rent Nov: 800 against 700 is +14.3% over budget (threshold 10%).
    expect(first.body.created).toBe(1);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ period: "2026-11", budgetId: planId });
    const again = await a.as.post(`/api/budget-plans/${planId}/variance/scan`);
    expect(again.body.created).toBe(0);
    const alerts = await a.as.get(`/api/budget-plans/${planId}/alerts`);
    expect(alerts.body).toHaveLength(1);
    expect(alerts.body[0]).toMatchObject({ category: "Rent", period: "2026-11" });
    off();
  });
});

describe("E2 (J3-r2) partial-year plans and account-mapped lines", () => {
  it("a new line must name an income or expense account (not a balance-sheet account)", async () => {
    const p = await a.as.post(plans(), planBody({ name: "Needs accounts" }));
    const lines = `/api/budget-plans/${p.body.id}/lines`;
    const none = await a.as.post(lines, { category: "Salaries & Wages", sep: 77000 });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe("VALIDATION_ERROR");
    const bank = (await accountByCode(a, "1020")).id;
    const bs = await a.as.post(lines, { category: "Other", accountId: bank, sep: 10 });
    expect(bs.status).toBe(400);
    expect(bs.body.code).toBe("BUDGET_ACCOUNT_INVALID");
    expect((await a.as.get(lines)).body).toHaveLength(0);
  });

  it("a Sep-Nov plan reports only its three months with actuals from the ledger", async () => {
    const p = await a.as.post(
      plans(),
      planBody({ name: "Autumn", startDate: "2026-09-01", endDate: "2026-11-30" })
    );
    expect(p.status, p.text).toBe(201);
    const lines = `/api/budget-plans/${p.body.id}/lines`;
    const rev = await a.as.post(lines, { category: "Revenue", accountId: salesId, nov: 4500 });
    expect(rev.status, rev.text).toBe(201);
    const rentLine = await a.as.post(lines, {
      category: "Rent",
      accountId: rentId,
      sep: 700,
      oct: 600,
      nov: 800,
    });
    expect(rentLine.status, rentLine.text).toBe(201);
    const v = await a.as.get(`/api/budget-plans/${p.body.id}/variance`);
    expect(v.status, v.text).toBe(200);
    expect(v.body.periods).toEqual(["2026-09", "2026-10", "2026-11"]);
    const sales = v.body.varianceLines.find((l: any) => l.category === "Revenue");
    const rent = v.body.varianceLines.find((l: any) => l.category === "Rent");
    expect(Object.keys(sales.months).sort()).toEqual(["nov", "oct", "sep"]);
    expect(sales.accountType).toBe("income");
    expect(rent.accountType).toBe("expense");
    expect(sales.months.nov.actual).toBe(2000);
    expect(rent.months.sep.actual).toBe(700);
    expect(rent.months.nov.actual).toBe(800);
    expect(rent.totals).toMatchObject({ budget: 2100, actual: 2100, variance: 0 });
  });
});
