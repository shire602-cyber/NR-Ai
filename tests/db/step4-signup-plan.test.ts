/**
 * STEP4: the plan chosen at sign-up (59 / 119 / 229 AED, 14-day Enterprise trial, no card).
 *
 *   STEP4-register-each-plan  register with each plan x cycle: choice stored, trial end frozen
 *   STEP4-deep-link / invalid-plan / existing-email / no-plan  the register contract
 *   STEP4-gates-trial / gates-after-trial  the choice never feeds the gates
 *   STEP4-change-choice / activation / admin / oauth / reminders / migration
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planPrice, PAID_PLAN_IDS, type BillingCycle, type PaidPlanId } from "../../shared/plans";
import { useHarness, type Tenant } from "./harness";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dubaiToday } from "../helpers/dates";

const oauthNext: { path: string } = { path: "/dashboard" };
const profiles: Array<Record<string, unknown>> = [];

vi.mock("../../server/services/oauth.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/oauth.service")>();
  return {
    ...actual,
    consumeOAuthState: vi.fn(async (provider: string) => ({
      state: "s",
      provider,
      codeVerifier: "v",
      nonce: "n",
      nextPath: oauthNext.path,
    })),
    exchangeOAuthCallback: vi.fn(async () => {
      const next = profiles.shift();
      if (!next) throw new Error("no mocked profile queued");
      return next;
    }),
  };
});

const h = useHarness();
const today = () => dubaiToday();

function setEnforcement(v: "true" | "false" | undefined) {
  if (v === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = v;
}
afterEach(() => setEnforcement(undefined));

function creds(label: string) {
  const slug = `${label}_${randomBytes(4).toString("hex")}`;
  return {
    name: `${label} Person`,
    email: `${slug}@harness.test`,
    password: `Harness${randomBytes(4).toString("hex")}A1!`,
  };
}

/** Register (anonymous) with the extra body fields, then sign in like the client does. */
async function signUp(label: string, extra: Record<string, unknown> = {}) {
  const c = creds(label);
  const reg = await h.anon.post("/api/auth/register", { ...c, ...extra });
  if (reg.status !== 200) return { reg, c, tenant: null as Tenant | null };
  const login = await h.anon.post("/api/auth/login", { email: c.email, password: c.password });
  expect(login.status, login.text).toBe(200);
  const { token, user } = login.body;
  const [company] = await h.sql<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM companies c JOIN company_users cu ON cu.company_id = c.id
      WHERE cu.user_id = $1 ORDER BY c.created_at LIMIT 1`,
    [user.id]
  );
  const tenant = {
    user,
    company,
    email: c.email,
    password: c.password,
    token,
    as: h.client(token),
  } as unknown as Tenant;
  return { reg, c, tenant };
}

const subUrl = (t: Tenant) => `/api/companies/${t.company.id}/billing/subscription`;
const choiceUrl = (t: Tenant) => `/api/companies/${t.company.id}/billing/chosen-plan`;
const activateUrl = (t: Tenant) => `/api/companies/${t.company.id}/billing/activation-request`;

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

describe("STEP4 register with a plan", () => {
  const cases = PAID_PLAN_IDS.flatMap((p) =>
    (["monthly", "yearly"] as BillingCycle[]).map((c) => [p, c] as const)
  );

  it.each(cases)(
    "[STEP4-register-each-plan] %s %s: the choice is stored, the trial is Enterprise with a frozen 14-day end",
    async (plan, cycle) => {
      const { reg, tenant: t } = await signUp(`S4${plan}`, {
        plan,
        billingCycle: cycle,
        planSource: "signup_picked",
      });
      expect(reg.status, reg.text).toBe(200);
      const [row] = await h.sql(
        `SELECT plan_id, status, chosen_plan_id, chosen_billing_cycle, chosen_plan_source,
                EXTRACT(EPOCH FROM (trial_ends_at - created_at)) AS span
           FROM subscriptions WHERE company_id = $1`,
        [t!.company.id]
      );
      expect(row).toMatchObject({
        plan_id: "free",
        status: "active",
        chosen_plan_id: plan,
        chosen_billing_cycle: cycle,
        chosen_plan_source: "signup_picked",
      });
      expect(Math.abs(Number(row.span) - 14 * 86400)).toBeLessThan(2);

      const sub = await t!.as.get(subUrl(t!));
      expect(sub.body.entitlement).toMatchObject({ state: "trial", planId: "enterprise" });
      expect(Object.values(sub.body.entitlement.features).every((v) => v === true)).toBe(true);
      expect(sub.body.entitlement.chosenPlan).toMatchObject({
        planId: plan,
        billingCycle: cycle,
        price: planPrice(plan as PaidPlanId, cycle),
      });
      expect([59, 119, 229, 590, 1190, 2290].includes(sub.body.entitlement.chosenPlan.price)).toBe(
        true
      );

      const audit = await h.sql(
        `SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'billing.plan_chosen'`,
        [t!.company.id]
      );
      expect(audit).toHaveLength(1);
      const sec = await h.sql(
        `SELECT details FROM audit_logs WHERE action = 'auth.register' AND user_id = $1`,
        [t!.user.id]
      );
      expect(JSON.stringify(sec[0]?.details)).toContain(plan);
    }
  );

  it("[STEP4-deep-link] the planSource is stored as sent (pricing_link, signup_default, signup_picked)", async () => {
    for (const source of ["pricing_link", "signup_default", "signup_picked"]) {
      const { tenant: t } = await signUp("S4src", {
        plan: "starter",
        billingCycle: "yearly",
        planSource: source,
      });
      const [row] = await h.sql(
        `SELECT chosen_plan_source AS s FROM subscriptions WHERE company_id = $1`,
        [t!.company.id]
      );
      expect(row.s).toBe(source);
    }
  });

  it("[STEP4-invalid-plan] an invalid plan, cycle or source is a 400 and creates no user", async () => {
    const bad: Record<string, unknown>[] = [
      { plan: "free" },
      { plan: "none" },
      { plan: "gold" },
      { plan: "" },
      { plan: "starter", billingCycle: "quarterly" },
      { plan: "starter", planSource: "admin" },
      { plan: "starter", planSource: "settings" },
      { plan: "starter", chosenPlanId: "enterprise" },
    ];
    for (const extra of bad) {
      const { reg, c } = await signUp("S4bad", extra);
      expect(reg.status, JSON.stringify(extra)).toBe(400);
      expect(reg.body.code).toBe("VALIDATION_ERROR");
      const users = await h.sql(`SELECT id FROM users WHERE email = $1`, [c.email]);
      expect(users, JSON.stringify(extra)).toHaveLength(0);
    }
  });

  it("[STEP4-existing-email] registering an existing email with a plan gives the same answer and changes nothing", async () => {
    const owner = await h.createTenant({ name: "S4exist" });
    const before = await h.sql(`SELECT * FROM subscriptions WHERE company_id = $1`, [
      owner.company.id,
    ]);
    const fresh = await h.anon.post("/api/auth/register", {
      ...creds("S4fresh"),
      plan: "starter",
    });
    const dup = await h.anon.post("/api/auth/register", {
      name: "Someone",
      email: owner.email,
      password: `Harness${randomBytes(4).toString("hex")}A1!`,
      plan: "enterprise",
      billingCycle: "yearly",
    });
    expect(dup.status).toBe(200);
    expect(dup.body).toEqual(fresh.body);
    const after = await h.sql(`SELECT * FROM subscriptions WHERE company_id = $1`, [
      owner.company.id,
    ]);
    expect(after).toEqual(before);
  });

  it("[STEP4-no-plan] registering without a plan records no choice and the trial is normal", async () => {
    const { tenant: t } = await signUp("S4none");
    const [row] = await h.sql(
      `SELECT chosen_plan_id, chosen_billing_cycle, chosen_plan_source, trial_ends_at
         FROM subscriptions WHERE company_id = $1`,
      [t!.company.id]
    );
    expect(row).toMatchObject({
      chosen_plan_id: null,
      chosen_billing_cycle: null,
      chosen_plan_source: null,
    });
    expect(row.trial_ends_at).toBeTruthy();
    const sub = await t!.as.get(subUrl(t!));
    expect(sub.body.entitlement).toMatchObject({
      state: "trial",
      planId: "enterprise",
      chosenPlan: null,
    });
    const audit = await h.sql(
      `SELECT 1 FROM audit_logs WHERE company_id = $1 AND action = 'billing.plan_chosen'`,
      [t!.company.id]
    );
    expect(audit).toHaveLength(0);
  });
});

describe("STEP4 gates ignore the choice", () => {
  it("[STEP4-gates-trial] a company that chose Starter can use Professional and Enterprise modules during the trial", async () => {
    setEnforcement("true");
    const { tenant: t } = await signUp("S4gate", { plan: "starter", billingCycle: "monthly" });
    const emp = await t!.as.post(`/api/companies/${t!.company.id}/employees`, {});
    expect([402, 403]).not.toContain(emp.status);
    const hooks = await t!.as.post(`/api/companies/${t!.company.id}/webhooks`, {});
    expect([402, 403]).not.toContain(hooks.status);
  });

  it("[STEP4-gates-after-trial] after the trial, writes are 402 and the chosen plan is still reported", async () => {
    setEnforcement("true");
    const { tenant: t } = await signUp("S4after", {
      plan: "professional",
      billingCycle: "monthly",
    });
    await endTrial(t!);
    const inv = await t!.as.post(`/api/companies/${t!.company.id}/invoices`, {
      customerName: "C",
      date: today(),
      lines: [{ description: "Item", quantity: 1, unitPrice: 10, vatRate: 5 }],
    });
    expect(inv.status).toBe(402);
    expect(inv.body.code).toBe("PLAN_REQUIRED");
    const list = await t!.as.get(`/api/companies/${t!.company.id}/invoices`);
    expect(list.status).toBe(200);
    const sub = await t!.as.get(subUrl(t!));
    expect(sub.body.entitlement.state).toBe("expired");
    expect(sub.body.entitlement.chosenPlan).toMatchObject({ planId: "professional" });
  });
});

describe("STEP4 change the choice and request activation", () => {
  it("[STEP4-change-choice] the owner changes it; a viewer, bad bodies, no CSRF and paid companies are refused", async () => {
    const { tenant: t } = await signUp("S4chg", { plan: "professional", billingCycle: "monthly" });
    const r = await t!.as.put(choiceUrl(t!), { planId: "starter", billingCycle: "yearly" });
    expect(r.status, r.text).toBe(200);
    expect(r.body.chosenPlan).toMatchObject({
      planId: "starter",
      billingCycle: "yearly",
      source: "settings",
      price: 590,
    });
    const audits = await h.sql(
      `SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'billing.plan_chosen' ORDER BY created_at`,
      [t!.company.id]
    );
    expect(audits).toHaveLength(2);
    const last = JSON.parse(audits[1].details);
    expect(last.before).toMatchObject({ planId: "professional" });
    expect(last.after).toMatchObject({ planId: "starter", source: "settings" });

    // Viewer: 403 from the central policy.
    const viewer = await h.createTenant({ name: "S4viewer" });
    await addMember(t!, viewer, "viewer");
    expect(
      (await viewer.as.put(choiceUrl(t!), { planId: "starter", billingCycle: "monthly" })).status
    ).toBe(403);
    // Another tenant: refused by the central policy.
    const other = await h.createTenant({ name: "S4other" });
    expect([403, 404]).toContain(
      (await other.as.put(choiceUrl(t!), { planId: "starter", billingCycle: "monthly" })).status
    );
    // Bad bodies.
    expect(
      (await t!.as.put(choiceUrl(t!), { planId: "free", billingCycle: "monthly" })).status
    ).toBe(400);
    expect(
      (await t!.as.put(choiceUrl(t!), { planId: "starter", billingCycle: "monthly", x: 1 })).status
    ).toBe(400);
    // A cookie session without a CSRF token is refused.
    const login = await h.anon.post("/api/auth/login", { email: t!.email, password: t!.password });
    const access = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("muhasib-access="));
    expect(access).toBeTruthy();
    const noCsrf = await h.anon.put(
      choiceUrl(t!),
      { planId: "starter", billingCycle: "monthly" },
      { headers: { Cookie: access! } }
    );
    expect(noCsrf.status).toBe(403);

    // Paid company (admin-set plan): 409.
    const admin = await h.createTenant({ name: "S4admin", isAdmin: true });
    await admin.as.put(`/api/admin/companies/${t!.company.id}/plan`, { planId: "starter" });
    const paid = await t!.as.put(choiceUrl(t!), {
      planId: "professional",
      billingCycle: "monthly",
    });
    expect(paid.status).toBe(409);
    expect(paid.body.code).toBe("PLAN_ALREADY_ACTIVE");
    // Client books: 409.
    const client = await h.createTenant({
      name: "S4client",
      companyColumns: { company_type: "client" },
    });
    const firm = await client.as.put(choiceUrl(client), {
      planId: "starter",
      billingCycle: "monthly",
    });
    expect(firm.status, firm.text).toBe(409);
    expect(firm.body.code).toBe("FIRM_BILLED");
  });

  it("[STEP4-activation] needs a choice; queues exactly one email pair a day; a viewer is refused", async () => {
    const { tenant: t } = await signUp("S4act");
    const none = await t!.as.post(activateUrl(t!), {});
    expect(none.status).toBe(409);
    expect(none.body.code).toBe("NO_PLAN_CHOSEN");

    await t!.as.put(choiceUrl(t!), { planId: "professional", billingCycle: "monthly" });
    const first = await t!.as.post(activateUrl(t!), { note: "Please activate" });
    expect(first.status, first.text).toBe(202);
    expect(first.body.activationRequestedAt).toBeTruthy();
    const [row] = await h.sql(
      `SELECT plan_activation_requested_at AS at FROM subscriptions WHERE company_id = $1`,
      [t!.company.id]
    );
    expect(row.at).toBeTruthy();
    const mails = () =>
      h.sql<{ to_address: string; status: string }>(
        `SELECT to_address, status FROM email_outbox WHERE company_id = $1 AND category = 'billing'
          AND idempotency_key LIKE 'plan-activation:%'`,
        [t!.company.id]
      );
    const rows = await mails();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status)).toEqual(["blocked_no_provider", "blocked_no_provider"]);
    expect(rows.map((r) => r.to_address).sort()).toEqual(
      ["support@muhasib.ai", t!.email.toLowerCase()].sort()
    );

    const again = await t!.as.post(activateUrl(t!), {});
    expect(again.status).toBe(202);
    expect(await mails()).toHaveLength(2);

    const viewer = await h.createTenant({ name: "S4v2" });
    await addMember(t!, viewer, "viewer");
    expect((await viewer.as.post(activateUrl(t!), {})).status).toBe(403);
  });

  it("[STEP4-admin] the admin sees the choice and the request and applies it; customers cannot", async () => {
    const { tenant: t } = await signUp("S4adm", { plan: "starter", billingCycle: "yearly" });
    await t!.as.post(activateUrl(t!), {});
    const admin = await h.createTenant({ name: "S4adm2", isAdmin: true });
    const one = `/api/admin/companies/${t!.company.id}/plan`;
    expect((await t!.as.get(one)).status).toBe(403);
    expect((await t!.as.get(`/api/admin/billing/trials`)).status).toBe(403);

    const detail = await admin.as.get(one);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body).toMatchObject({
      state: "trial",
      chosenPlan: { planId: "starter", billingCycle: "yearly" },
    });
    expect(detail.body.activationRequestedAt).toBeTruthy();

    const trials = await admin.as.get(`/api/admin/billing/trials`);
    expect(trials.status).toBe(200);
    const mine = trials.body.trials.find((x: any) => x.companyId === t!.company.id);
    expect(mine).toMatchObject({
      chosenPlan: { planId: "starter", billingCycle: "yearly" },
      trialEnded: false,
    });
    expect(mine.activationRequestedAt).toBeTruthy();
    // Activation requests are listed first.
    expect(trials.body.trials[0].activationRequestedAt).toBeTruthy();

    const applied = await admin.as.put(one, { planId: "starter", billingCycle: "yearly" });
    expect(applied.status, applied.text).toBe(200);
    expect(applied.body).toMatchObject({ state: "active", planId: "starter" });
    const [row] = await h.sql(
      `SELECT plan_id, chosen_plan_id FROM subscriptions WHERE company_id = $1`,
      [t!.company.id]
    );
    expect(row).toMatchObject({ plan_id: "starter", chosen_plan_id: "starter" });
    const audit = await h.sql(
      `SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'billing.plan_set'`,
      [t!.company.id]
    );
    expect(JSON.parse(audit[0].details).after.chosenPlanId).toBe("starter");
  });
});

describe("STEP4 OAuth sign-up", () => {
  const prof = (subject: string, email: string) => ({
    provider: "google",
    issuer: "https://accounts.google.com",
    subject,
    email,
    emailVerified: true,
    name: "Plan Person",
    claims: { sub: subject },
  });
  const callback = () => h.anon.get("/api/auth/oauth/google/callback?state=s&code=c");

  it("[STEP4-oauth] a new account keeps the plan from the next path; a linked account and junk are safe", async () => {
    oauthNext.path =
      "/dashboard?signup_plan=starter&signup_cycle=yearly&signup_source=signup_picked";
    profiles.push(prof("s4-sub-1", "s4.oauth.new@example.test"));
    const r = await callback();
    expect(r.status).toBe(302);
    const [u] = await h.sql(`SELECT id FROM users WHERE email = 's4.oauth.new@example.test'`);
    const [row] = await h.sql(
      `SELECT s.chosen_plan_id, s.chosen_billing_cycle, s.chosen_plan_source, s.trial_ends_at
         FROM subscriptions s JOIN company_users cu ON cu.company_id = s.company_id
        WHERE cu.user_id = $1`,
      [u.id]
    );
    expect(row).toMatchObject({
      chosen_plan_id: "starter",
      chosen_billing_cycle: "yearly",
      chosen_plan_source: "signup_picked",
    });
    expect(row.trial_ends_at).toBeTruthy();

    // A second sign-in of the same identity with another plan changes nothing.
    oauthNext.path = "/dashboard?signup_plan=enterprise&signup_cycle=monthly";
    profiles.push(prof("s4-sub-1", "s4.oauth.new@example.test"));
    await callback();
    const [again] = await h.sql(
      `SELECT s.chosen_plan_id FROM subscriptions s JOIN company_users cu ON cu.company_id = s.company_id
        WHERE cu.user_id = $1`,
      [u.id]
    );
    expect(again.chosen_plan_id).toBe("starter");

    // An existing password account linked by email keeps its subscription untouched.
    const existing = await h.createTenant({ name: "S4link" });
    const [beforeRow] = await h.sql(`SELECT * FROM subscriptions WHERE company_id = $1`, [
      existing.company.id,
    ]);
    oauthNext.path = "/dashboard?signup_plan=enterprise&signup_cycle=yearly";
    profiles.push(prof("s4-sub-2", existing.email));
    expect((await callback()).status).toBe(302);
    const [afterRow] = await h.sql(`SELECT * FROM subscriptions WHERE company_id = $1`, [
      existing.company.id,
    ]);
    expect(afterRow).toEqual(beforeRow);

    // Junk plan: the account is created, with no choice and no 500.
    oauthNext.path = "/dashboard?signup_plan=gold&signup_cycle=quarterly";
    profiles.push(prof("s4-sub-3", "s4.oauth.junk@example.test"));
    const junk = await callback();
    expect(junk.status).toBe(302);
    expect(junk.headers.get("location")).not.toMatch(/error|failed/i);
    const [ju] = await h.sql(`SELECT id FROM users WHERE email = 's4.oauth.junk@example.test'`);
    const [jrow] = await h.sql(
      `SELECT s.chosen_plan_id FROM subscriptions s JOIN company_users cu ON cu.company_id = s.company_id
        WHERE cu.user_id = $1`,
      [ju.id]
    );
    expect(jrow.chosen_plan_id).toBeNull();
    oauthNext.path = "/dashboard";
  });
});

describe("STEP4 trial reminders", () => {
  it("[STEP4-reminders] one ending and one ended email per owner, none twice, none for paid or client books", async () => {
    const { sendTrialReminders } = await import("../../server/services/billing/plan-choice");
    const { tenant: ending } = await signUp("S4end", { plan: "professional" });
    const { tenant: ended } = await signUp("S4ended");
    const { tenant: paid } = await signUp("S4paid");
    const client = await h.createTenant({
      name: "S4cl",
      companyColumns: { company_type: "client" },
    });
    await h.sql(
      `UPDATE subscriptions SET trial_ends_at = now() + interval '60 hours' WHERE company_id = $1`,
      [ending!.company.id]
    );
    await h.sql(
      `UPDATE subscriptions SET trial_ends_at = now() - interval '6 hours' WHERE company_id = $1`,
      [ended!.company.id]
    );
    await h.sql(
      `UPDATE subscriptions SET plan_id = 'starter', trial_ends_at = now() + interval '60 hours'
        WHERE company_id = $1`,
      [paid!.company.id]
    );
    await h.sql(
      `UPDATE subscriptions SET trial_ends_at = now() + interval '60 hours' WHERE company_id = $1`,
      [client.company.id]
    );
    const count = (id: string, kind: string) =>
      h
        .sql(`SELECT 1 FROM email_outbox WHERE company_id = $1 AND idempotency_key LIKE $2`, [
          id,
          `${kind}:%`,
        ])
        .then((r) => r.length);

    const first = await sendTrialReminders(new Date());
    expect(first.ending).toBeGreaterThanOrEqual(1);
    expect(await count(ending!.company.id, "trial-ending")).toBe(1);
    expect(await count(ended!.company.id, "trial-ended")).toBe(1);
    expect(await count(paid!.company.id, "trial-ending")).toBe(0);
    expect(await count(client.company.id, "trial-ending")).toBe(0);

    const [expiryEmail] = await h.sql<{ text_body: string }>(
      `SELECT text_body FROM email_outbox WHERE company_id = $1 AND idempotency_key LIKE 'trial-ended:%'`,
      [ended!.company.id]
    );
    expect(expiryEmail.text_body).toContain(
      "Your data is kept safe. You can access it again once you choose and activate a paid plan."
    );
    expect(expiryEmail.text_body).toContain(
      "تبقى بياناتك محفوظة بأمان. يمكنك الوصول إليها مجددًا بعد اختيار خطة مدفوعة وتفعيلها."
    );
    expect(expiryEmail.text_body).not.toMatch(/safe and readable|آمنة ومقروءة/);

    await sendTrialReminders(new Date());
    expect(await count(ending!.company.id, "trial-ending")).toBe(1);
    expect(await count(ended!.company.id, "trial-ended")).toBe(1);
  });
});

describe("STEP4 migration 0135", () => {
  it("[STEP4-migration] the columns exist, the checks hold and the SQL is a no-op the second time", async () => {
    const cols = await h.sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'subscriptions' AND column_name LIKE ANY (ARRAY['chosen_%','plan_activation_%'])`
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      "chosen_billing_cycle",
      "chosen_plan_at",
      "chosen_plan_id",
      "chosen_plan_source",
      "plan_activation_requested_at",
    ]);
    const t = await h.createTenant({ name: "S4mig" });
    await expect(
      h.sql(`UPDATE subscriptions SET chosen_plan_id = 'free' WHERE company_id = $1`, [
        t.company.id,
      ])
    ).rejects.toThrow(/subscriptions_chosen_plan_chk/);
    await expect(
      h.sql(`UPDATE subscriptions SET chosen_billing_cycle = 'quarterly' WHERE company_id = $1`, [
        t.company.id,
      ])
    ).rejects.toThrow(/subscriptions_chosen_cycle_chk/);
    await expect(
      h.sql(`UPDATE subscriptions SET chosen_plan_source = 'admin' WHERE company_id = $1`, [
        t.company.id,
      ])
    ).rejects.toThrow(/subscriptions_chosen_source_chk/);
    const sqlText = readFileSync(
      path.join(process.cwd(), "migrations/0135_step4_signup_plan_choice.sql"),
      "utf8"
    );
    for (const stmt of sqlText.split("--> statement-breakpoint")) await h.sql(stmt);
    for (const stmt of sqlText.split("--> statement-breakpoint")) await h.sql(stmt);
  });
});

describe("STEP4 finisher: the plan emails, the admin queue and the day key", () => {
  const mailText = (companyId: string, like: string) =>
    h.sql<{ to_address: string; subject: string; text_body: string; idempotency_key: string }>(
      `SELECT to_address, subject, text_body, idempotency_key FROM email_outbox
        WHERE company_id = $1 AND idempotency_key LIKE $2 ORDER BY to_address`,
      [companyId, like]
    );

  it("[STEP4-fix-email-ended] after the trial the customer email says the workspace is locked, never 'stays open until <past date>' (en + ar)", async () => {
    const { tenant: t } = await signUp("S4fixend", {
      plan: "professional",
      billingCycle: "monthly",
    });
    await endTrial(t!);
    const res = await t!.as.post(activateUrl(t!), {});
    expect(res.status, res.text).toBe(202);
    const customer = (await mailText(t!.company.id, "plan-activation:%:customer"))[0];
    expect(customer.text_body).toContain("Your workspace is locked until we activate your plan.");
    expect(customer.text_body).not.toContain("stay fully open until");
    expect(customer.text_body).toContain("تبقى مساحة عملك مقفلة حتى نفعّل خطتك");
    expect(customer.text_body).not.toContain("تبقى دفاترك مفتوحة بالكامل");
    // The Arabic plan phrase agrees with the noun (the email said "الخطة المبتدئ" before).
    expect(customer.text_body).toContain("استلمنا طلب تفعيل الخطة الاحترافية");
    expect(customer.subject).toContain("استلمنا طلب تفعيل الخطة الاحترافية");
  });

  it("[STEP4-fix-email-running] during the trial the email keeps the true 'stays open until' promise; Starter reads 'خطة المبتدئ'", async () => {
    const { tenant: t } = await signUp("S4fixrun", { plan: "starter", billingCycle: "yearly" });
    expect((await t!.as.post(activateUrl(t!), {})).status).toBe(202);
    const customer = (await mailText(t!.company.id, "plan-activation:%:customer"))[0];
    expect(customer.text_body).toContain("Your books stay fully open until");
    expect(customer.text_body).toContain("تبقى دفاترك مفتوحة بالكامل حتى");
    expect(customer.text_body).toContain("استلمنا طلب تفعيل خطة المبتدئ");
    expect(customer.text_body).not.toContain("الخطة المبتدئ");
  });

  it("[STEP4-fix-day-key] the once-a-day key rolls over on the Asia/Dubai date, not the UTC date", async () => {
    const { dubaiDay, requestActivation } =
      await import("../../server/services/billing/plan-choice");
    // 21:00 UTC on 19 Nov is 01:00 on 20 Nov in Dubai.
    expect(dubaiDay(new Date("2026-11-19T21:00:00Z"))).toBe("2026-11-20");
    expect(dubaiDay(new Date("2026-11-19T19:59:00Z"))).toBe("2026-11-19");
    const { tenant: t } = await signUp("S4fixday", { plan: "starter" });
    await requestActivation(
      t!.company.id,
      { id: t!.user.id, name: "N", email: t!.email },
      undefined,
      undefined,
      new Date("2026-11-19T21:00:00Z")
    );
    const keys = (await mailText(t!.company.id, "plan-activation:%")).map((r) => r.idempotency_key);
    expect(keys).toContain(`plan-activation:${t!.company.id}:2026-11-20:customer`);
    expect(keys).toContain(`plan-activation:${t!.company.id}:2026-11-20:support`);
  });

  it("[STEP4-fix-admin-apply] applying a plan clears the request and queues one 'plan active' email (en + ar), once", async () => {
    const { tenant: t } = await signUp("S4fixapply", {
      plan: "professional",
      billingCycle: "yearly",
    });
    expect((await t!.as.post(activateUrl(t!), {})).status).toBe(202);
    const admin = await h.createTenant({ name: "S4fixapply2", isAdmin: true });
    const one = `/api/admin/companies/${t!.company.id}/plan`;
    expect((await admin.as.get(one)).body.activationRequestedAt).toBeTruthy();

    const applied = await admin.as.put(one, { planId: "professional", billingCycle: "yearly" });
    expect(applied.status, applied.text).toBe(200);
    const detail = await admin.as.get(one);
    expect(detail.body.activationRequestedAt).toBeNull();
    expect(detail.body.state).toBe("active");

    const mails = await mailText(t!.company.id, "plan-active:%");
    expect(mails).toHaveLength(1);
    expect(mails[0].to_address).toBe(t!.email.toLowerCase());
    expect(mails[0].text_body).toContain("Your Professional plan (AED 1,190 a year) is now active");
    expect(mails[0].text_body).toContain("تم تفعيل الخطة الاحترافية");
    expect(mails[0].subject).toContain("Your Professional plan is active");
    // The brand stays a proper noun in the Arabic half too, not the word "accountant".
    expect(mails[0].text_body).toContain("شكرًا لاختيارك Muhasib.ai");
    expect(mails[0].text_body).not.toContain("لاختيارك محاسب");

    // Re-applying the same plan never sends a second email.
    const again = await admin.as.put(one, { planId: "professional", billingCycle: "yearly" });
    expect(again.status).toBe(200);
    expect(await mailText(t!.company.id, "plan-active:%")).toHaveLength(1);
    // "No plan" queues nothing.
    const other = (await signUp("S4fixnone")).tenant!;
    await admin.as.put(`/api/admin/companies/${other.company.id}/plan`, { planId: "none" });
    expect(await mailText(other.company.id, "plan-active:%")).toHaveLength(0);
  });

  it("[STEP4-fix-admin-trials] the trials list leaves out firm companies, firm members' workspaces and the admin's own companies", async () => {
    const admin = await h.createTenant({ name: "S4fixlist", isAdmin: true });
    const { tenant: customer } = await signUp("S4fixcust", { plan: "starter" });
    const firmCo = await h.createTenant({
      name: "S4fixfirmco",
      companyColumns: { company_type: "firm" },
    });
    const { tenant: member } = await signUp("S4fixmember");
    await h.sql(`INSERT INTO firms (name, slug, status) VALUES ('S4 firm', $1, 'active')`, [
      `s4-${randomBytes(3).toString("hex")}`,
    ]);
    const [firm] = await h.sql<{ id: string }>(
      `SELECT id FROM firms ORDER BY created_at DESC LIMIT 1`
    );
    await h.sql(`INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner')`, [
      firm.id,
      member!.user.id,
    ]);
    const res = await admin.as.get(`/api/admin/billing/trials`);
    expect(res.status, res.text).toBe(200);
    const ids = res.body.trials.map((x: { companyId: string }) => x.companyId);
    expect(ids).toContain(customer!.company.id);
    expect(ids).not.toContain(firmCo.company.id);
    expect(ids).not.toContain(member!.company.id);
    expect(ids).not.toContain(admin.company.id);
  });
});
