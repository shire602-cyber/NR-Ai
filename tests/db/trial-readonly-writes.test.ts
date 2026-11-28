/**
 * TRIAL-READONLY: an expired 14-day trial with no active plan is read-only across the workspace.
 * Reads pass, writes (company-scoped and row-id paths) answer 402 PLAN_REQUIRED, and the plan
 * selection routes stay open so the owner can still choose a plan (59 / 119 / 229).
 */
import { afterEach, expect, it, vi } from "vitest";
import { useHarness } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
afterEach(() => vi.unstubAllEnvs());

it("[TRIAL-RO] expired trial: reads pass, every write is 402, plan choice stays open", async () => {
  vi.stubEnv("BILLING_ENFORCEMENT", "true");
  const t = await h.createTenant();
  const base = `/api/companies/${t.company.id}`;
  const today = dubaiToday();
  const draft = await t.as.post(`${base}/invoices`, {
    customerName: "Before expiry",
    date: today,
    lines: [{ description: "Service", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  await h.sql(
    "UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE company_id = $1",
    [t.company.id]
  );

  for (const path of [
    `${base}/invoices`,
    `/api/invoices/${draft.body.id}`,
    `${base}/accounts`,
    `${base}/vendors`,
    `${base}/journal`,
    `${base}/receipts`,
    `${base}/billing/subscription`,
  ]) {
    const read = await t.as.get(path);
    expect(read.status, `${path} ${read.text}`).toBe(200);
  }

  const writes = [
    ["post", `${base}/vendors`, { name: "Blocked vendor" }],
    ["post", `${base}/accounts`, { code: "9999", nameEn: "Blocked", type: "expense" }],
    ["post", `${base}/journal`, { date: today, memo: "Blocked", lines: [] }],
    ["post", `${base}/receipts`, { merchant: "Blocked", date: today, amount: 10 }],
    ["post", `/api/invoices/${draft.body.id}/post`, {}],
    ["put", `/api/invoices/${draft.body.id}`, { customerName: "Edited" }],
    ["post", `${base}/invoices/${draft.body.id}/payments`, { amount: 10, date: today }],
    ["delete", `/api/invoices/${draft.body.id}`, undefined],
  ] as const;
  for (const [method, path, body] of writes) {
    const res = await (t.as as any)[method](path, ...(body === undefined ? [] : [body]));
    expect(res.status, `${method} ${path} ${res.text}`).toBe(402);
    expect(res.body.code).toBe("PLAN_REQUIRED");
    expect(res.body.messageKey).toBe("forms.serverErrors.PLAN_REQUIRED");
  }

  const unchanged = await t.as.get(`/api/invoices/${draft.body.id}`);
  expect(unchanged.body.customerName).toBe("Before expiry");

  const plans = await h.anon.get("/api/billing/plans");
  expect(plans.body.plans.map((p: { id: string }) => p.id)).toEqual(
    expect.arrayContaining(["starter", "professional", "enterprise"])
  );
  for (const planId of ["starter", "professional", "enterprise"]) {
    const chosen = await t.as.put(`${base}/billing/chosen-plan`, {
      planId,
      billingCycle: "monthly",
    });
    expect(chosen.status, chosen.text).toBe(200);
  }
});
