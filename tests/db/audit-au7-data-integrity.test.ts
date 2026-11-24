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
