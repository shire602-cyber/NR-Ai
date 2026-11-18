/**
 * WQ7: commercial truth, plan gates, automations, numbering, onboarding progress and approvals,
 * against the real app and a fresh database.
 *
 *   WQ7-plans       GET /api/billing/plans is the shared plan module (59 / 119 / 229 a month,
 *                   590 / 1,190 / 2,290 a year, no quarterly, 14-day trial of the top plan)
 *   WQ7-gate-*      one test per gate: trial open, module read-only outside the plan, read-only
 *                   after the trial (nothing deleted), monthly usage limit, unlimited users,
 *                   the NR admin plan path
 *   WQ7-auto        Automations switches: RBAC, strictBody, the scheduler skips a company that
 *                   switched one off, last run / result / next run
 *   WQ7-numbering   prefix change keeps gap-free order under concurrency; next number only moves
 *                   forward; prefixes stay unique per document type
 *   WQ7-onboarding  setup wizard progress round-trips on the server (device change)
 *   WQ7-approvals   the journal approval band (Settings › Approvals) holds posting until a second
 *                   user approves (maker ≠ checker)
 */
import { afterEach, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);
const year = () => new Date().getUTCFullYear();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

function setEnforcement(v: "true" | "false" | undefined) {
  if (v === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = v;
}
afterEach(() => setEnforcement(undefined));

function invoice(t: Tenant, extra: Record<string, unknown> = {}) {
  return t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Plan Customer",
    date: today(),
    lines: [{ description: "Item", quantity: 1, unitPrice: 10, vatRate: 5 }],
    ...extra,
  });
}

/** Move the company's trial start 30 days back, so its 14-day trial has ended. */
async function endTrial(t: Tenant) {
  await h.sql(
    `UPDATE subscriptions SET created_at = now() - interval '30 days', trial_ends_at = NULL
      WHERE company_id = $1`,
    [t.company.id]
  );
  await h.sql(`UPDATE companies SET created_at = now() - interval '30 days' WHERE id = $1`, [
    t.company.id,
  ]);
}

async function addMember(t: Tenant, other: Tenant, role: string) {
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    t.company.id,
    other.user.id,
    role,
  ]);
}

describe("WQ7 public plans", () => {
  it("[WQ7-plans] /api/billing/plans serves the owner-approved prices from the shared module", async () => {
    const r = await h.anon.get("/api/billing/plans");
    expect(r.status).toBe(200);
    const { publicPlanCatalog } = await import("../../shared/plans");
    expect(r.body).toEqual(JSON.parse(JSON.stringify(publicPlanCatalog())));
    expect(r.body.currency).toBe("AED");
    expect(r.body.cycles).toEqual(["monthly", "yearly"]);
    expect(r.body.trial).toEqual({ days: 14, planId: "enterprise", cardRequired: false });
    const prices = Object.fromEntries(
      r.body.plans.map((p: { id: string; pricing: { monthly: number; yearly: number } }) => [
        p.id,
        [p.pricing.monthly, p.pricing.yearly],
      ])
    );
    expect(prices).toEqual({
      starter: [59, 590],
      professional: [119, 1190],
      enterprise: [229, 2290],
    });
    for (const p of r.body.plans) expect(p.limits.maxUsers).toBe(-1);
    expect(JSON.stringify(r.body)).not.toMatch(/quarter|"free"/i);
  });
});

describe("WQ7 plan gates (enforced)", () => {
  it("[WQ7-gate-trial] a new company is on a 14-day trial of the top plan: every module is open", async () => {
    setEnforcement("true");
    const t = await h.createTenant({ name: "Trial" });
    const sub = await t.as.get(`/api/companies/${t.company.id}/billing/subscription`);
    expect(sub.status).toBe(200);
    expect(sub.body.entitlement).toMatchObject({ state: "trial", planId: "enterprise" });
    expect(sub.body.enforcement).toBe(true);
    // Payroll (Professional+) and webhooks (Enterprise) pass the gate during the trial: the route
    // itself answers (validation), never TIER_LOCKED / PLAN_REQUIRED.
    const emp = await t.as.post(`/api/companies/${t.company.id}/employees`, {});
    expect([402, 403]).not.toContain(emp.status);
    const hooks = await t.as.post(`/api/companies/${t.company.id}/webhooks`, {});
    expect([402, 403]).not.toContain(hooks.status);
    const inv = await invoice(t);
    expect(inv.status, inv.text).toBe(200);
  });

  it("[WQ7-gate-module] a module outside the paid plan is read-only (403 TIER_LOCKED on writes only)", async () => {
    setEnforcement("true");
    const starter = await h.createTenant({ name: "Starter", planId: "starter" });
    const pro = await h.createTenant({ name: "Pro", planId: "professional" });

    const write = await starter.as.post(`/api/companies/${starter.company.id}/employees`, {});
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({
      code: "TIER_LOCKED",
      messageKey: "forms.serverErrors.TIER_LOCKED",
      feature: "payroll",
      currentTier: "starter",
      requiredTier: "professional",
      upgrade: { requiredPlan: "professional", url: "/subscription" },
    });
    // Reads stay open: the data is never hidden.
    expect((await starter.as.get(`/api/companies/${starter.company.id}/employees`)).status).toBe(
      200
    );
    // Starter includes multi-currency and the core books.
    const usd = await invoice(starter, { currency: "USD", exchangeRate: 3.6725 });
    expect(usd.status, usd.text).toBe(200);

    const proPayroll = await pro.as.post(`/api/companies/${pro.company.id}/employees`, {});
    expect([402, 403]).not.toContain(proPayroll.status);
    const proHooks = await pro.as.post(`/api/companies/${pro.company.id}/webhooks`, {});
    expect(proHooks.status).toBe(403);
    expect(proHooks.body).toMatchObject({ feature: "webhooks", requiredTier: "enterprise" });
  });

  it("[WQ7-gate-expired] after the trial without a plan the books are read-only and nothing is deleted", async () => {
    setEnforcement("true");
    const t = await h.createTenant({ name: "Expired" });
    const made = await invoice(t);
    expect(made.status, made.text).toBe(200);
    await endTrial(t);

    const sub = await t.as.get(`/api/companies/${t.company.id}/billing/subscription`);
    expect(sub.body.entitlement).toMatchObject({ state: "expired", planId: null });

    const refused = await invoice(t);
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({
      code: "PLAN_REQUIRED",
      messageKey: "forms.serverErrors.PLAN_REQUIRED",
    });
    const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "New customer",
    });
    expect(contact.status).toBe(402);

    // The invoice made during the trial is still there and readable.
    const list = await t.as.get(`/api/companies/${t.company.id}/invoices`);
    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : list.body.items;
    expect(rows.map((i: { id: string }) => i.id)).toContain(made.body.id);
    const n = await h.sql(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(n[0].n).toBe(1);
    // Choosing a plan stays possible: billing reads work.
    expect((await t.as.get(`/api/companies/${t.company.id}/billing/usage`)).status).toBe(200);
  });

  it("[WQ7-gate-usage] Starter's 200 invoices a month is a 402 with the upgrade hint; users are unlimited", async () => {
    setEnforcement("true");
    const t = await h.createTenant({ name: "Usage", planId: "starter" });
    await h.sql(
      `INSERT INTO usage_counters (company_id, period, metric, count)
       SELECT $1, to_char(now() + interval '4 hours', 'YYYY-MM'), 'invoices', 200
       ON CONFLICT (company_id, period, metric) DO UPDATE SET count = 200`,
      [t.company.id]
    );
    const r = await invoice(t);
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      messageKey: "forms.serverErrors.USAGE_LIMIT_REACHED_invoices",
      resource: "invoices",
      limit: 200,
      upgrade: { requiredPlan: "professional" },
    });
    const usage = await t.as.get(`/api/companies/${t.company.id}/billing/usage`);
    expect(usage.body.usage.invoices).toMatchObject({ used: 200, limit: 200 });

    // Unlimited users on every plan: invitations are never refused for seats.
    for (const email of ["seat1@harness.test", "seat2@harness.test", "seat3@harness.test"]) {
      const inv = await t.as.post(`/api/companies/${t.company.id}/team/invite`, {
        email,
        role: "viewer",
      });
      expect([200, 201], inv.text).toContain(inv.status);
    }
  });

  it("[WQ7-gate-admin] only an NR admin sets a company's plan (contact-us path), audited and validated", async () => {
    setEnforcement("true");
    const t = await h.createTenant({ name: "Contact" });
    await endTrial(t);
    expect((await invoice(t)).status).toBe(402);

    const self = await t.as.put(`/api/admin/companies/${t.company.id}/plan`, {
      planId: "enterprise",
    });
    expect(self.status).toBe(403);

    const admin = await h.createTenant({ name: "PlanAdmin", isAdmin: true });
    const bad = await admin.as.put(`/api/admin/companies/${t.company.id}/plan`, {
      planId: "starter",
      seats: 3,
    });
    expect(bad.status).toBe(400);
    const unknown = await admin.as.put(
      `/api/admin/companies/00000000-0000-4000-8000-000000000000/plan`,
      { planId: "starter" }
    );
    expect(unknown.status).toBe(404);

    const set = await admin.as.put(`/api/admin/companies/${t.company.id}/plan`, {
      planId: "starter",
      billingCycle: "yearly",
      note: "Paid by bank transfer",
    });
    expect(set.status, set.text).toBe(200);
    expect(set.body).toMatchObject({ state: "active", planId: "starter" });
    const audit = await h.sql(
      `SELECT action FROM audit_logs WHERE company_id = $1 AND action = 'billing.plan_set'`,
      [t.company.id]
    );
    expect(audit).toHaveLength(1);
    const ok = await invoice(t);
    expect(ok.status, ok.text).toBe(200);
    // Starter, so payroll stays read-only.
    expect((await t.as.post(`/api/companies/${t.company.id}/employees`, {})).status).toBe(403);
  });
});

describe("WQ7 automations", () => {
  it("[WQ7-auto] switches are per company, RBAC + strictBody, and the scheduler respects them", async () => {
    const t = await h.createTenant({ name: "Auto" });
    const viewer = await h.createTenant({ name: "AutoViewer" });
    await addMember(t, viewer, "viewer");
    const other = await h.createTenant({ name: "AutoOther" });
    const { registerLedgerJobs, runDueJournalTemplates } =
      await import("../../server/ledger/templates");
    registerLedgerJobs();

    const list = await t.as.get(`/api/companies/${t.company.id}/automations`);
    expect(list.status).toBe(200);
    const keys = list.body.automations.map((a: { key: string }) => a.key);
    expect(keys).toEqual(
      expect.arrayContaining(["recurringInvoices", "recurringJournals", "reportDeliveries"])
    );
    const journals = () =>
      t.as
        .get(`/api/companies/${t.company.id}/automations`)
        .then((r) =>
          r.body.automations.find((a: { key: string }) => a.key === "recurringJournals")
        );
    expect(await journals()).toMatchObject({ enabled: true, lastRunAt: null, scheduled: true });
    expect((await journals()).nextRunAt).not.toBeNull();

    // Another tenant's company is refused; a viewer cannot switch; unknown fields are refused.
    // (The central company policy answers 403 for a company the caller is not a member of.)
    expect([403, 404]).toContain(
      (await other.as.get(`/api/companies/${t.company.id}/automations`)).status
    );
    const byViewer = await viewer.as.put(
      `/api/companies/${t.company.id}/automations/recurringJournals`,
      { enabled: false }
    );
    expect(byViewer.status).toBe(403);
    const extra = await t.as.put(`/api/companies/${t.company.id}/automations/recurringJournals`, {
      enabled: false,
      everyone: true,
    });
    expect(extra.status).toBe(400);
    const unknown = await t.as.put(`/api/companies/${t.company.id}/automations/nope`, {
      enabled: false,
    });
    expect(unknown.status).toBe(404);

    const a = await accountByCode(t, "1020");
    const b = await accountByCode(t, "3010");
    const tpl = await t.as.post(`/api/companies/${t.company.id}/journal-templates`, {
      name: "Monthly accrual",
      frequency: "monthly",
      nextRunOn: daysAgo(2),
      lines: [
        { accountId: a.id, debit: "150.00" },
        { accountId: b.id, credit: "150.00" },
      ],
    });
    expect(tpl.status, tpl.text).toBe(201);

    const off = await t.as.put(`/api/companies/${t.company.id}/automations/recurringJournals`, {
      enabled: false,
    });
    expect(off.status, off.text).toBe(200);
    expect(off.body).toMatchObject({ enabled: false, nextRunAt: null });
    await runDueJournalTemplates();
    const posted = () =>
      h.sql(
        `SELECT count(*)::int AS n FROM journal_entries
          WHERE company_id = $1 AND source = 'journal_template'`,
        [t.company.id]
      );
    expect((await posted())[0].n).toBe(0);
    expect((await journals()).lastRunAt).toBeNull();

    const on = await t.as.put(`/api/companies/${t.company.id}/automations/recurringJournals`, {
      enabled: true,
    });
    expect(on.status).toBe(200);
    await runDueJournalTemplates();
    expect((await posted())[0].n).toBe(1);
    const after = await journals();
    expect(after).toMatchObject({ enabled: true, lastStatus: "ok", lastSummary: { posted: 1 } });
    expect(after.lastRunAt).not.toBeNull();
    expect(after.nextRunAt).not.toBeNull();
  });
});

describe("WQ7 document numbering", () => {
  it("[WQ7-numbering] a prefix change keeps gap-free order under concurrency", async () => {
    const t = await h.createTenant({ name: "Numbering" });
    const first = await invoice(t);
    expect(first.status, first.text).toBe(200);
    expect(first.body.number).toBe(`INV-${year()}-00001`);

    const save = await t.as.put(`/api/companies/${t.company.id}/numbering/invoice`, {
      prefix: "si",
      padding: 4,
      yearlyReset: true,
    });
    expect(save.status, save.text).toBe(200);
    expect(save.body).toMatchObject({ prefix: "SI", lastIssued: 1, nextNumber: 2 });
    expect(save.body.nextFormatted).toBe(`SI-${year()}-0002`);

    const both = await Promise.all([invoice(t), invoice(t)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both.map((r) => r.body.number).sort()).toEqual([
      `SI-${year()}-0002`,
      `SI-${year()}-0003`,
    ]);
  });

  it("[WQ7-numbering] next number below the highest issued is refused; forward is allowed", async () => {
    const t = await h.createTenant({ name: "Forward" });
    for (let i = 0; i < 3; i++) expect((await invoice(t)).status).toBe(200);
    const url = `/api/companies/${t.company.id}/numbering/invoice`;
    const low = await t.as.put(url, {
      prefix: "INV",
      padding: 5,
      yearlyReset: true,
      nextNumber: 3,
    });
    expect(low.status).toBe(409);
    expect(low.body.code).toBe("NUMBERING_BELOW_ISSUED");

    const fwd = await t.as.put(url, {
      prefix: "INV",
      padding: 5,
      yearlyReset: true,
      nextNumber: 100,
    });
    expect(fwd.status, fwd.text).toBe(200);
    expect((await invoice(t)).body.number).toBe(`INV-${year()}-00100`);

    // Prefixes stay unique per document type; a viewer cannot change numbering.
    const clash = await t.as.put(url, { prefix: "CN", padding: 5, yearlyReset: true });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("NUMBERING_PREFIX_IN_USE");
    const viewer = await h.createTenant({ name: "NumViewer" });
    await addMember(t, viewer, "viewer");
    expect((await viewer.as.put(url, { prefix: "ZZ", padding: 5, yearlyReset: true })).status).toBe(
      403
    );
    const view = await viewer.as.get(`/api/companies/${t.company.id}/numbering`);
    expect(view.status).toBe(200);
    expect(
      view.body.numbering.find((n: { docType: string }) => n.docType === "invoice")
    ).toMatchObject({ lastIssued: 100, nextNumber: 101 });
  });
});

describe("WQ7 onboarding progress", () => {
  it("[WQ7-onboarding] the wizard's progress round-trips on the server (another device sees it)", async () => {
    const t = await h.createTenant({ name: "Onboard" });
    const url = `/api/companies/${t.company.id}/onboarding/progress`;
    const empty = await t.as.get(url);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ step: null, firstTask: null, industry: null });

    const one = await t.as.put(url, {
      step: "starting-point",
      industry: "retail",
      startingPoint: "opening-balances",
      cutoverDate: "2026-01-01",
    });
    expect(one.status, one.text).toBe(200);
    const two = await t.as.put(url, { step: "first-task", firstTask: "bank" });
    expect(two.status).toBe(200);

    // A fresh sign-in (another device) reads the same progress; a partial save kept the rest.
    const login = await h.anon.post("/api/auth/login", { email: t.email, password: t.password });
    expect(login.status, login.text).toBe(200);
    const device = h.client(login.body.token);
    const read = await device.get(url);
    expect(read.body).toMatchObject({
      step: "first-task",
      firstTask: "bank",
      industry: "retail",
      startingPoint: "opening-balances",
      cutoverDate: "2026-01-01",
      dismissedGettingStarted: false,
    });

    expect((await t.as.put(url, { step: "done", secret: 1 })).status).toBe(400);
    expect((await t.as.put(url, { step: "nowhere" })).status).toBe(400);
    const other = await h.createTenant({ name: "OnboardOther" });
    expect([403, 404]).toContain((await other.as.get(url)).status);
    const viewer = await h.createTenant({ name: "OnboardViewer" });
    await addMember(t, viewer, "viewer");
    expect((await viewer.as.put(url, { step: "done" })).status).toBe(403);
  });
});

describe("WQ7 approvals", () => {
  it("[WQ7-approvals] a journal approval band holds posting until a second user approves", async () => {
    const maker = await h.createTenant({ name: "ApprMaker" });
    const checker = await h.createTenant({ name: "ApprChecker" });
    await addMember(maker, checker, "accountant");
    const set = await maker.as.put(`/api/companies/${maker.company.id}/journal/settings`, {
      manualApprovalThreshold: "2500.00",
    });
    expect(set.status, set.text).toBe(200);
    const a = await accountByCode(maker, "1020");
    const b = await accountByCode(maker, "3010");
    const entry = await maker.as.post(`/api/companies/${maker.company.id}/journal`, {
      date: today(),
      status: "posted",
      lines: [
        { accountId: a.id, debit: 4000 },
        { accountId: b.id, credit: 4000 },
      ],
    });
    expect(entry.status, entry.text).toBe(202);
    expect(entry.body).toMatchObject({ status: "draft", approvalStatus: "pending" });
    const lines = await h.sql(
      `SELECT count(*)::int AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.id = $1 AND je.status = 'posted'`,
      [entry.body.id]
    );
    expect(lines[0].n).toBe(0);
    expect((await maker.as.post(`/api/journal/${entry.body.id}/approve`, {})).status).toBe(403);
    const ok = await checker.as.post(`/api/journal/${entry.body.id}/approve`, {});
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ status: "posted", approvalStatus: "approved" });
  });
});
