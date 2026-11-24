import { afterEach, expect, it, vi } from "vitest";
import { accountByCode, useHarness } from "./harness";

const h = useHarness();
afterEach(() => vi.unstubAllEnvs());

it("keeps expired trial data and billing recovery readable while blocking changes", async () => {
  vi.stubEnv("BILLING_ENFORCEMENT", "true");
  const t = await h.createTenant();
  const base = `/api/companies/${t.company.id}`;
  const body = {
    customerName: "Original customer",
    date: new Date().toISOString().slice(0, 10),
    lines: [{ description: "Existing service", quantity: 1, unitPrice: 125, vatRate: 5 }],
  };
  const draft = await t.as.post(`${base}/invoices`, body);
  expect(draft.status, draft.text).toBe(200);
  await h.sql(
    "UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE company_id = $1",
    [t.company.id]
  );

  const read = await t.as.get(`/api/invoices/${draft.body.id}`);
  expect(read.status, read.text).toBe(200);
  expect(read.body).toMatchObject({ id: draft.body.id, customerName: body.customerName });
  expect((await t.as.get(`/api/invoices/${draft.body.id}/pdf`)).status).toBe(200);
  expect((await t.as.get(`${base}/reports/pl`)).status).toBe(200);
  for (const write of [
    await t.as.post(`${base}/invoices`, body),
    await t.as.delete(`/api/invoices/${draft.body.id}`),
    await t.as.get(
      `/api/vat/autopilot/calculate/${t.company.id}?periodStart=2026-07-01&periodEnd=2026-09-30`
    ),
  ]) {
    expect(write.status, write.text).toBe(402);
    expect(write.body.code).toBe("PLAN_REQUIRED");
  }
  const list = await t.as.get(`${base}/invoices`);
  expect(list.status, list.text).toBe(200);
  const rows = Array.isArray(list.body) ? list.body : list.body.items;
  expect(rows.map((row: { id: string }) => row.id)).toEqual([draft.body.id]);

  const plans = await h.anon.get("/api/billing/plans");
  expect(plans.status, plans.text).toBe(200);
  expect(plans.body.plans).toContainEqual(expect.objectContaining({ id: "starter" }));
  const subscription = await t.as.get(`${base}/billing/subscription`);
  expect(subscription.status, subscription.text).toBe(200);
  expect(subscription.body.entitlement.state).toBe("expired");
  expect(
    (await t.as.put(`${base}/billing/chosen-plan`, { planId: "starter", billingCycle: "monthly" }))
      .status
  ).toBe(200);
  const activation = await t.as.post(`${base}/billing/activation-request`, {});
  expect(activation.status, activation.text).toBe(202);
  const after = await t.as.get(`${base}/billing/subscription`);
  expect(after.body.entitlement.activationRequestedAt).toEqual(expect.any(String));
});

it("posts receipts with saved accounts, names a missing account, and recognizes posted books for onboarding", async () => {
  const t = await h.createTenant();
  const base = `/api/companies/${t.company.id}`;
  const expense = await accountByCode(t, "5000");
  const bank = await accountByCode(t, "1020");
  await h.sql("UPDATE companies SET onboarding_completed = false WHERE id = $1", [t.company.id]);
  async function company() {
    const result = await t.as.get("/api/companies");
    expect(result.status, result.text).toBe(200);
    return result.body.find((row: { id: string }) => row.id === t.company.id);
  }
  const input = {
    merchant: "Office supplier",
    date: "2026-11-01",
    amount: 100,
    vatAmount: 0,
    currency: "AED",
  };
  const receipt = await t.as.post(`${base}/receipts`, {
    ...input,
    accountId: expense.id,
    paymentAccountId: bank.id,
  });
  expect(receipt.status, receipt.text).toBe(200);
  expect(await company()).toMatchObject({ onboardingCompleted: false, hasPostedDocuments: false });
  const post = await t.as.post(`/api/receipts/${receipt.body.id}/post`, {});
  expect(post.status, post.text).toBe(200);
  expect(post.body).toMatchObject({
    posted: true,
    accountId: expense.id,
    paymentAccountId: bank.id,
  });
  const lines = await h.sql<{ account_id: string; debit: string; credit: string }>(
    `SELECT jl.account_id, jl.debit, jl.credit
       FROM receipts r JOIN journal_lines jl ON jl.entry_id = r.journal_entry_id
      WHERE r.id = $1 AND r.company_id = $2`,
    [receipt.body.id, t.company.id]
  );
  expect(lines).toHaveLength(2);
  expect(lines.map((line) => [line.account_id, Number(line.debit), Number(line.credit)])).toEqual(
    expect.arrayContaining([
      [expense.id, 100, 0],
      [bank.id, 0, 100],
    ])
  );
  expect(await company()).toMatchObject({ onboardingCompleted: false, hasPostedDocuments: true });
  for (const [field, saved] of [
    ["accountId", { paymentAccountId: bank.id }],
    ["paymentAccountId", { accountId: expense.id }],
  ] as const) {
    const incomplete = await t.as.post(`${base}/receipts`, {
      ...input,
      merchant: `Incomplete ${field}`,
      ...saved,
    });
    expect(incomplete.status, incomplete.text).toBe(200);
    const result = await t.as.post(`/api/receipts/${incomplete.body.id}/post`, {});
    expect(result.status, result.text).toBe(400);
    expect(result.body).toMatchObject({ code: "RECEIPT_ACCOUNTS_REQUIRED", details: { field } });
    expect(result.body.message).toContain(field);
  }
});

it("updates contacts through either verb and identifies unknown API paths without query values", async () => {
  const t = await h.createTenant();
  const list = `/api/companies/${t.company.id}/customer-contacts`;
  const created = await t.as.post(list, { name: "Original name" });
  expect(created.status, created.text).toBe(200);
  const path = `${list}/${created.body.id}`;
  const amended = await t.as.patch(path, { name: "Patched name" });
  expect(amended.status, amended.text).toBe(200);
  expect(amended.body.name).toBe("Patched name");
  const replaced = await t.as.put(path, { name: "PUT name" });
  expect(replaced.status, replaced.text).toBe(200);
  expect(replaced.body.name).toBe("PUT name");
  const bad = await t.as.patch("/api/a-missing-path?token=private-fixture", {});
  expect(bad.status, bad.text).toBe(404);
  expect(bad.body).toMatchObject({
    code: "ROUTE_NOT_FOUND",
    message: "Route PATCH /api/a-missing-path not found",
  });
});
