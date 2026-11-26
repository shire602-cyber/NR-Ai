import { expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

const budgetPeriod = {
  name: "Operating budget",
  fiscalYear: 2026,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
};

it("AU7 preserves existing budget lines when a replacement CSV exceeds the annual amount limit", async () => {
  const tenant = await h.createTenant();
  const plan = await tenant.as.post(
    `/api/companies/${tenant.company.id}/budget-plans`,
    budgetPeriod
  );
  expect(plan.status, plan.text).toBe(201);

  await h.sql("INSERT INTO budget_lines (budget_id, category, jan) VALUES ($1, 'Original', 500)", [
    plan.body.id,
  ]);
  const result = await tenant.as.post(`/api/budget-plans/${plan.body.id}/import`, {
    replace: true,
    // Both month amounts fit numeric(12, 2). Their annual sum exceeds that precision.
    csv: "category,account_code,jan,feb\nFirst replacement,5020,12,0\nAnnual overflow,5020,6000000000,6000000000",
  });
  expect(result.status).toBeGreaterThanOrEqual(400);
  const rows = await h.sql(
    "SELECT category, jan::text AS jan FROM budget_lines WHERE budget_id = $1",
    [plan.body.id]
  );
  expect(rows).toEqual([{ category: "Original", jan: "500.00" }]);
});

it("AU7 preserves the cost centre referenced by a budget plan", async () => {
  const tenant = await h.createTenant({ planId: "enterprise" });
  const base = `/api/companies/${tenant.company.id}`;
  const center = await tenant.as.post(`${base}/cost-centers`, { code: "P01", name: "Project 01" });
  expect(center.status, center.text).toBe(201);
  const plan = await tenant.as.post(`${base}/budget-plans`, {
    ...budgetPeriod,
    costCenterId: center.body.id,
  });
  expect(plan.status, plan.text).toBe(201);

  await tenant.as.delete(`/api/cost-centers/${center.body.id}`);
  const [row] = await h.sql(
    `SELECT cc.code FROM budget_plans bp LEFT JOIN cost_centers cc ON cc.id = bp.cost_center_id
      WHERE bp.id = $1`,
    [plan.body.id]
  );
  expect(row.code).toBe("P01");
});

it.each([
  { route: "new-version", body: {} },
  { route: "copy", body: { fiscalYear: 2027 } },
])(
  "AU7 budget $route clears only dangling cost centres and leaves the approved source",
  async ({ route, body }) => {
    const tenant = await h.createTenant({ planId: "enterprise" });
    const base = `/api/companies/${tenant.company.id}`;
    const center = await tenant.as.post(`${base}/cost-centers`, {
      code: "P01",
      name: "Project 01",
    });
    expect(center.status, center.text).toBe(201);
    const valid: string = center.body.id;
    const gonePlan = "11111111-1111-4111-8111-111111111111";
    const goneLine = "22222222-2222-4222-8222-222222222222";

    for (const planCenter of [gonePlan, valid]) {
      const plan = await tenant.as.post(`${base}/budget-plans`, budgetPeriod);
      expect(plan.status, plan.text).toBe(201);
      // Historical rows: the API refuses to write a missing cost centre, so seed them directly.
      await h.sql(
        "UPDATE budget_plans SET cost_center_id = $2, status = 'approved' WHERE id = $1",
        [plan.body.id, planCenter]
      );
      const lineCenter = planCenter === valid ? valid : goneLine;
      await h.sql(
        `INSERT INTO budget_lines (budget_id, category, jan, cost_center_id)
         VALUES ($1, 'A', 100, $2), ($1, 'B', 200, $3), ($1, 'C', 300, NULL)`,
        [plan.body.id, lineCenter, valid]
      );
      const snapshot = async () => ({
        plan: await h.sql("SELECT * FROM budget_plans WHERE id = $1", [plan.body.id]),
        lines: await h.sql("SELECT * FROM budget_lines WHERE budget_id = $1 ORDER BY category", [
          plan.body.id,
        ]),
      });
      const before = await snapshot();

      const draft = await tenant.as.post(`/api/budget-plans/${plan.body.id}/${route}`, body);
      expect(draft.status, draft.text).toBe(201);
      expect(draft.body).toMatchObject({
        status: "draft",
        cost_center_id: planCenter === valid ? valid : null,
      });
      expect(draft.body.clearedPlanCostCenterIds).toEqual(planCenter === valid ? [] : [gonePlan]);
      expect(draft.body.clearedLineCostCenterIds).toEqual(planCenter === valid ? [] : [goneLine]);
      const lines = await h.sql(
        "SELECT category, cost_center_id FROM budget_lines WHERE budget_id = $1 ORDER BY category",
        [draft.body.id]
      );
      expect(lines).toEqual([
        { category: "A", cost_center_id: planCenter === valid ? valid : null },
        { category: "B", cost_center_id: valid },
        { category: "C", cost_center_id: null },
      ]);
      expect(await snapshot()).toEqual(before);
    }
  }
);

it("AU7 retains the lines of a posted zero-variance stocktake after product deletion is requested", async () => {
  const tenant = await h.createTenant();
  const base = `/api/companies/${tenant.company.id}`;
  const product = await tenant.as.post(`${base}/products`, {
    name: "Unstocked widget",
    unitPrice: 100,
    costPrice: 0,
  });
  expect(product.status, product.text).toBe(200);
  const stocktake = await tenant.as.post(`${base}/stocktakes`, {
    countDate: "2026-06-01",
    lines: [{ productId: product.body.id, countedQty: 0 }],
  });
  expect(stocktake.status, stocktake.text).toBe(201);
  const posted = await tenant.as.post(`${base}/stocktakes/${stocktake.body.id}/post`, {});
  expect(posted.status, posted.text).toBe(200);

  await tenant.as.delete(`/api/products/${product.body.id}`);
  const rows = await h.sql(
    `SELECT s.status, l.product_id, l.counted_qty FROM stocktakes s
       LEFT JOIN stocktake_lines l ON l.stocktake_id = s.id WHERE s.id = $1`,
    [stocktake.body.id]
  );
  expect(rows).toEqual([{ status: "posted", product_id: product.body.id, counted_qty: 0 }]);
});

it("AU7 omits soft-deleted bank transactions from the period close checklist", async () => {
  const tenant = await h.createTenant();
  await h.sql(
    `INSERT INTO bank_transactions (company_id, transaction_date, description, amount, deleted_at)
     VALUES ($1, '2026-02-01', 'Removed duplicate', 10, now())`,
    [tenant.company.id]
  );
  const { getCloseChecklist } = await import("../../server/services/month-end.service");
  const checklist = await getCloseChecklist(tenant.company.id, "2026-02-01", "2026-02-28");
  const bank = checklist.find((item) => item.id === 1);
  expect(bank?.status).toBe("complete");
});
