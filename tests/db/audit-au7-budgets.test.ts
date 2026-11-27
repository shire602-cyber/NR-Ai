import pg from "pg";
import { expect, it, vi, type TestContext } from "vitest";
import { useHarness, type ApiResponse } from "./harness";

const h = useHarness();

async function budget() {
  const t = await h.createTenant();
  const center = await t.as.post("/api/companies/" + t.company.id + "/cost-centers", {
    code: "OPS",
    name: "Operations",
  });
  expect(center.status, center.text).toBe(201);
  const plan = await t.as.post("/api/companies/" + t.company.id + "/budget-plans", {
    name: "Demo budget",
    fiscalYear: 2026,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  expect(plan.status, plan.text).toBe(201);
  const [account] = await h.sql(
    "SELECT id FROM accounts WHERE company_id=$1 AND type='income' AND COALESCE(is_vat_account,false)=false ORDER BY code LIMIT 1",
    [t.company.id]
  );
  const planUrl = "/api/budget-plans/" + plan.body.id;
  const addLine = (extra: Record<string, unknown> = {}) =>
    t.as.post(planUrl + "/lines", {
      accountId: account.id,
      category: "Sales",
      jan: "100",
      ...extra,
    });
  return { t, planUrl, addLine, planId: plan.body.id, centerId: center.body.id };
}

/**
 * Plays the competing writer: take a row lock, start `request`, wait until it is blocked on a
 * lock, then commit `change`. Needs real parallel connections (not the PGlite fallback).
 */
async function whileLocked(
  lock: [string, unknown[]],
  request: () => Promise<ApiResponse>,
  change: [string, unknown[]]
): Promise<ApiResponse> {
  const holder = new pg.Client({ connectionString: h.databaseUrl });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(lock[0], lock[1]);
    const pending = request();
    await vi.waitFor(
      async () => {
        const [waiting] = await h.sql(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"
        );
        expect(waiting.n).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 50 }
    );
    await holder.query(change[0], change[1]);
    await holder.query("COMMIT");
    return await pending;
  } finally {
    await holder.end();
  }
}

const needsConcurrency = (ctx: TestContext) => {
  if (!h.concurrencySupported) ctx.skip();
};

const lockCenter = "SELECT 1 FROM cost_centers WHERE id=$1 FOR UPDATE";
const lockPlanRow = "SELECT 1 FROM budget_plans WHERE id=$1 FOR UPDATE";

it("AU7 refuses a budget line whose cost centre is deleted while it waits", async (ctx) => {
  needsConcurrency(ctx);
  const b = await budget();
  const res = await whileLocked(
    [lockCenter, [b.centerId]],
    () => b.addLine({ costCenterId: b.centerId }),
    ["DELETE FROM cost_centers WHERE id=$1", [b.centerId]]
  );
  expect(res.status, res.text).toBe(400);
  expect(res.body.code).toBe("COST_CENTER_NOT_FOUND");
});

it("AU7 refuses a CSV replacement whose cost centre is deleted while it waits", async (ctx) => {
  needsConcurrency(ctx);
  const b = await budget();
  expect((await b.addLine()).status).toBe(201);
  const res = await whileLocked(
    [lockCenter, [b.centerId]],
    () =>
      b.t.as.post(b.planUrl + "/import", {
        csv: "category,cost_center_code,jan\nRent,OPS,5",
        replace: true,
      }),
    ["DELETE FROM cost_centers WHERE id=$1", [b.centerId]]
  );
  expect(res.status, res.text).toBe(400);
  expect(res.body.code).toBe("COST_CENTER_NOT_FOUND");
  // The failed replacement rolled back: the existing line is still there.
  const lines = await h.sql("SELECT category FROM budget_lines WHERE budget_id=$1", [b.planId]);
  expect(lines).toEqual([{ category: "Sales" }]);
});

it("AU7 refuses to delete a cost centre a waiting budget write has just referenced", async (ctx) => {
  needsConcurrency(ctx);
  const b = await budget();
  expect((await b.addLine()).status).toBe(201);
  const res = await whileLocked(
    [lockCenter, [b.centerId]],
    () => b.t.as.delete("/api/cost-centers/" + b.centerId),
    ["UPDATE budget_lines SET cost_center_id=$1 WHERE budget_id=$2", [b.centerId, b.planId]]
  );
  expect(res.status, res.text).toBe(400);
  expect(res.body.code).toBe("COST_CENTER_IN_USE");
});

it("AU7 does not approve a budget emptied while approval waits", async (ctx) => {
  needsConcurrency(ctx);
  const b = await budget();
  expect((await b.addLine()).status).toBe(201);
  const res = await whileLocked(
    [lockPlanRow, [b.planId]],
    () => b.t.as.post(b.planUrl + "/approve", {}),
    ["DELETE FROM budget_lines WHERE budget_id=$1", [b.planId]]
  );
  expect(res.status, res.text).toBe(409);
  expect(res.body.code).toBe("BUDGET_EMPTY");
  const [plan] = await h.sql("SELECT status FROM budget_plans WHERE id=$1", [b.planId]);
  expect(plan.status).not.toBe("approved");
});

it("AU7 does not approve a budget after a header-only CSV replacement clears its lines", async () => {
  const b = await budget();
  expect((await b.addLine()).status).toBe(201);
  const cleared = await b.t.as.post(b.planUrl + "/import", {
    csv: "category,jan\n",
    replace: true,
  });
  expect(cleared.status, cleared.text).toBe(200);
  expect(cleared.body).toEqual({ imported: 0, replaced: true });
  const approved = await b.t.as.post(b.planUrl + "/approve", {});
  expect(approved.status, approved.text).toBe(409);
  expect(approved.body.code).toBe("BUDGET_EMPTY");
  const [plan] = await h.sql("SELECT status FROM budget_plans WHERE id=$1", [b.planId]);
  expect(plan.status).not.toBe("approved");
});

it("AU7 refuses line writes and CSV replacement once approval wins the lock", async (ctx) => {
  needsConcurrency(ctx);
  for (const write of ["line", "import"] as const) {
    const b = await budget();
    expect((await b.addLine()).status).toBe(201);
    const res = await whileLocked(
      [lockPlanRow, [b.planId]],
      () =>
        write === "line"
          ? b.addLine()
          : b.t.as.post(b.planUrl + "/import", { csv: "category,jan\nRent,5", replace: true }),
      ["UPDATE budget_plans SET status='approved' WHERE id=$1", [b.planId]]
    );
    expect(res.status, res.text).toBe(409);
    expect(res.body.code).toBe("BUDGET_FROZEN");
    const lines = await h.sql("SELECT category FROM budget_lines WHERE budget_id=$1", [b.planId]);
    expect(lines).toEqual([{ category: "Sales" }]);
  }
});

it("AU7 keeps the ordinary budget write, copy, version and approval paths working", async () => {
  const b = await budget();
  expect((await b.addLine({ costCenterId: b.centerId })).status).toBe(201);
  const imported = await b.t.as.post(b.planUrl + "/import", {
    csv: "category,cost_center_code,jan\nRent,OPS,5",
    replace: true,
  });
  expect(imported.status, imported.text).toBe(200);
  const copy = await b.t.as.post(b.planUrl + "/copy", { fiscalYear: 2027 });
  expect(copy.status, copy.text).toBe(201);
  expect(copy.body.copiedLines).toBe(1);
  const approved = await b.t.as.post(b.planUrl + "/approve", {});
  expect(approved.status, approved.text).toBe(200);
  const next = await b.t.as.post(b.planUrl + "/new-version", {});
  expect(next.status, next.text).toBe(201);
  const used = await b.t.as.delete("/api/cost-centers/" + b.centerId);
  expect(used.status, used.text).toBe(400);
});
