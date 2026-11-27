/**
 * PR175 audit: PATCH on a budget plan / line treated an explicit `costCenterId: null` as "omitted"
 * (COALESCE), so a draft could never drop its cost-centre reference and the cost centre could
 * never be deleted. An absent key must leave the reference alone; an explicit null clears it.
 * Demo data only.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness } from "./harness";

const h = useHarness();

describe("budget PATCH distinguishes an absent costCenterId from an explicit null", () => {
  it("clears draft references, keeps amounts, then the unused cost centre can be deleted", async () => {
    const a = await h.createTenant({ planId: "enterprise" });
    const cc = await a.as.post(`/api/companies/${a.company.id}/cost-centers`, {
      code: "DEMO-1",
      name: "Demo Marketing",
    });
    expect(cc.status, cc.text).toBe(201);
    const ccId = cc.body.id as string;

    const plan = await a.as.post(`/api/companies/${a.company.id}/budget-plans`, {
      name: "Demo Budget",
      fiscalYear: 2027,
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      costCenterId: ccId,
    });
    expect(plan.status, plan.text).toBe(201);
    const expense = await accountByCode(a, "5020");
    const line = await a.as.post(`/api/budget-plans/${plan.body.id}/lines`, {
      accountId: expense.id,
      category: "Marketing",
      costCenterId: ccId,
      jan: "100.00",
      feb: "250.50",
    });
    expect(line.status, line.text).toBe(201);

    // Absent key: the reference stays (the rest of the update still applies).
    const keepPlan = await a.as.patch(`/api/budget-plans/${plan.body.id}`, { notes: "kept" });
    expect(keepPlan.status, keepPlan.text).toBe(200);
    expect(keepPlan.body.cost_center_id).toBe(ccId);
    const keepLine = await a.as.patch(`/api/budget-lines/${line.body.id}`, { description: "kept" });
    expect(keepLine.status, keepLine.text).toBe(200);
    expect(keepLine.body.cost_center_id).toBe(ccId);

    // Still referenced: delete is refused.
    const refused = await a.as.delete(`/api/cost-centers/${ccId}`);
    expect(refused.status, refused.text).toBe(400);

    // Explicit null clears both.
    const clearPlan = await a.as.patch(`/api/budget-plans/${plan.body.id}`, { costCenterId: null });
    expect(clearPlan.status, clearPlan.text).toBe(200);
    expect(clearPlan.body.cost_center_id).toBeNull();
    const clearLine = await a.as.patch(`/api/budget-lines/${line.body.id}`, { costCenterId: null });
    expect(clearLine.status, clearLine.text).toBe(200);
    expect(clearLine.body.cost_center_id).toBeNull();

    // Amounts are untouched.
    expect(Number(clearLine.body.jan)).toBe(100);
    expect(Number(clearLine.body.feb)).toBe(250.5);
    expect(Number(clearLine.body.annual_total)).toBe(350.5);

    const deleted = await a.as.delete(`/api/cost-centers/${ccId}`);
    expect(deleted.status, deleted.text).toBe(200);
  });
});
