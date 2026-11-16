/**
 * W5-B: plan gates, usage quotas and billing.
 *   R19-04 monthly quotas enforced centrally (402) — only when billing enforcement is on
 *   R19-05 feature gates (payroll, fixed assets, webhooks, ...) follow TIER_FEATURES
 *   R19-11 referral reward recorded on the referred customer's first paid invoice
 *   R19-16 VAT-inclusive subscription invoices/receipts, dunning through the outbox
 */
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

function setEnforcement(v: "true" | "false" | undefined) {
  if (v === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = v;
}

async function invoice(t: Tenant) {
  return t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Quota Customer",
    date: today(),
    lines: [{ description: "Item", quantity: 1, unitPrice: 10, vatRate: 5 }],
  });
}

afterEach(() => setEnforcement(undefined));

describe("W5-B usage quotas", () => {
  it("[R19-04] with enforcement on, the 21st invoice of the month on the free plan is 402", async () => {
    setEnforcement("true");
    const t = await h.createTenant();
    for (let i = 0; i < 20; i++) {
      const r = await invoice(t);
      expect(r.status, r.text).toBe(200);
    }
    const r21 = await invoice(t);
    expect(r21.status).toBe(402);
    expect(r21.body).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      resource: "invoices",
      limit: 20,
    });
    const n = await h.sql(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(n[0].n).toBe(20);
    const usage = await t.as.get(`/api/companies/${t.company.id}/billing/usage`);
    expect(usage.body.usage.invoices).toMatchObject({ used: 20, limit: 20 });
  });

  it("[R19-04] a failed create does not burn quota, and enforcement off never blocks (but still meters)", async () => {
    setEnforcement("true");
    const t = await h.createTenant();
    const bad = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      date: today(),
      lines: [],
    });
    expect(bad.status).toBe(400);
    await new Promise((r) => setTimeout(r, 50));
    const used = await h.sql(
      `SELECT COALESCE(SUM(count), 0)::int AS n FROM usage_counters WHERE company_id = $1 AND metric = 'invoices'`,
      [t.company.id]
    );
    expect(used[0].n).toBe(0);

    setEnforcement("false");
    await h.sql(
      `INSERT INTO usage_counters (company_id, period, metric, count)
       SELECT $1, to_char(now() + interval '4 hours', 'YYYY-MM'), 'invoices', 500
       ON CONFLICT (company_id, period, metric) DO UPDATE SET count = 500`,
      [t.company.id]
    );
    const ok = await invoice(t);
    expect(ok.status, ok.text).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const after = await h.sql(
      `SELECT count::int AS n FROM usage_counters WHERE company_id = $1 AND metric = 'invoices'`,
      [t.company.id]
    );
    expect(after[0].n).toBe(501);
  });

  it("[R19-04] team seats: a second invitation on the free plan (1 user) is 402 when enforced", async () => {
    setEnforcement("true");
    const t = await h.createTenant();
    const r = await t.as.post(`/api/companies/${t.company.id}/team/invitations`, {
      email: "seat@harness.test",
      role: "viewer",
    });
    expect(r.status).toBe(402);
    expect(r.body.resource).toBe("team_members");
  });
});

describe("W5-B feature gates", () => {
  it("[R19-05] payroll and fixed assets are Professional+, webhooks/API keys Enterprise — per TIER_FEATURES", async () => {
    setEnforcement("true");
    const free = await h.createTenant();
    const pro = await h.createTenant({ planId: "professional" });
    const ent = await h.createTenant({ planId: "enterprise" });

    const emp = await free.as.get(`/api/companies/${free.company.id}/employees`);
    expect(emp.status).toBe(403);
    expect(emp.body).toMatchObject({
      code: "TIER_LOCKED",
      feature: "payroll",
      requiredTier: "professional",
    });
    expect((await free.as.get(`/api/companies/${free.company.id}/fixed-assets`)).body.feature).toBe(
      "fixedAssets"
    );
    expect((await pro.as.get(`/api/companies/${pro.company.id}/employees`)).status).toBe(200);

    const hooksPro = await pro.as.get(`/api/companies/${pro.company.id}/webhooks`);
    expect(hooksPro.status).toBe(403);
    expect(hooksPro.body.feature).toBe("webhooks");
    expect((await ent.as.get(`/api/companies/${ent.company.id}/webhooks`)).status).toBe(200);
    expect((await pro.as.get(`/api/companies/${pro.company.id}/api-keys`)).status).toBe(403);
    expect((await ent.as.get(`/api/companies/${ent.company.id}/api-keys`)).status).toBe(200);

    // Multi-currency documents are Starter+: a USD invoice on Free is locked, AED is fine.
    const usd = await free.as.post(`/api/companies/${free.company.id}/invoices`, {
      customerName: "FX",
      date: today(),
      currency: "USD",
      exchangeRate: 3.6725,
      lines: [{ description: "Item", quantity: 1, unitPrice: 10, vatRate: 5 }],
    });
    expect(usd.status).toBe(403);
    expect(usd.body.feature).toBe("multiCurrency");
  });

  it("[R19-05] with enforcement off every gate passes", async () => {
    setEnforcement("false");
    const free = await h.createTenant();
    expect((await free.as.get(`/api/companies/${free.company.id}/employees`)).status).toBe(200);
    expect((await free.as.get(`/api/companies/${free.company.id}/webhooks`)).status).toBe(200);
    expect((await free.as.get(`/api/companies/${free.company.id}/api-keys`)).status).toBe(200);
  });
});

describe("W5-B billing", () => {
  it("[R19-11] the referral reward is recorded when the referred customer's first invoice is paid", async () => {
    const referrer = await h.createTenant({ name: "Referrer" });
    const referee = await h.createTenant({ name: "Referee" });
    const code = await referrer.as.get(`/api/referral/my-code`);
    expect(code.status).toBe(200);
    const track = await referrer.as.post(`/api/referral/track-signup`, {
      code: code.body.code,
      refereeEmail: referee.email,
    });
    expect(track.status, track.text).toBe(200);
    const self = await referrer.as.post(`/api/referral/track-signup`, {
      code: code.body.code,
      refereeEmail: referrer.email,
    });
    expect(self.status).toBe(400);

    await h.sql(
      `UPDATE subscriptions SET stripe_customer_id = 'cus_referee' WHERE company_id = $1`,
      [referee.company.id]
    );
    const { handleWebhookEvent } = await import("../../server/services/stripe.service");
    const event = {
      id: `evt_${Date.now()}`,
      type: "invoice.paid",
      data: {
        object: {
          id: "in_first",
          customer: "cus_referee",
          total: 10500, // AED 105.00 VAT-inclusive
          currency: "aed",
          period_start: 1767225600,
          period_end: 1769904000,
          total_discount_amounts: [],
        },
      },
    };
    await handleWebhookEvent(event as never);
    await handleWebhookEvent(event as never); // duplicate delivery is ignored

    const credits = await h.sql(
      `SELECT beneficiary, kind, amount_fils::int AS amount, percent_off::text AS pct, status
         FROM billing_credits ORDER BY beneficiary`
    );
    expect(credits).toEqual([
      { beneficiary: "referee", kind: "percent_off", amount: 0, pct: "20.00", status: "ledgered" },
      { beneficiary: "referrer", kind: "credit", amount: 5000, pct: null, status: "ledgered" },
    ]);
    const ref = await h.sql(`SELECT status FROM referrals`);
    expect(ref[0].status).toBe("rewarded");

    // [R19-16] VAT-inclusive invoice + receipt: 105.00 = 100.00 net + 5.00 VAT
    const docs = await h.sql(
      `SELECT kind, subtotal_fils::int AS net, vat_fils::int AS vat, total_fils::int AS total
         FROM billing_documents WHERE company_id = $1 ORDER BY kind`,
      [referee.company.id]
    );
    expect(docs).toEqual([
      { kind: "invoice", net: 10000, vat: 500, total: 10500 },
      { kind: "receipt", net: 10000, vat: 500, total: 10500 },
    ]);
    const credList = await referrer.as.get(`/api/referral/credits`);
    expect(credList.body).toHaveLength(1);
  });

  it("[R19-16] a failed payment marks past_due and queues an escalating dunning email", async () => {
    const t = await h.createTenant();
    await h.sql(
      `UPDATE subscriptions SET stripe_customer_id = 'cus_dun', plan_id = 'starter' WHERE company_id = $1`,
      [t.company.id]
    );
    const { handleWebhookEvent } = await import("../../server/services/stripe.service");
    for (const n of [1, 2]) {
      await handleWebhookEvent({
        id: `evt_fail_${n}_${Date.now()}`,
        type: "invoice.payment_failed",
        data: { object: { id: "in_dun", customer: "cus_dun", attempt_count: n } },
      } as never);
    }
    const sub = await h.sql(
      `SELECT status, dunning_stage FROM subscriptions WHERE company_id = $1`,
      [t.company.id]
    );
    expect(sub[0]).toEqual({ status: "past_due", dunning_stage: 2 });
    const mail = await h.sql(
      `SELECT subject FROM email_outbox WHERE company_id = $1 AND category = 'billing_dunning' ORDER BY created_at`,
      [t.company.id]
    );
    expect(mail.map((m) => m.subject)).toEqual([
      "Payment failed for your Muhasib.ai subscription",
      "Second notice: your Muhasib.ai payment is still outstanding",
    ]);
  });

  it("[R19-16] plan change needs Stripe (503 when unconfigured) and billing.manage", async () => {
    const t = await h.createTenant();
    const r = await t.as.post(`/api/companies/${t.company.id}/billing/change-plan`, {
      planId: "professional",
    });
    expect(r.status).toBe(503);
    const viewer = await h.createTenant({ role: "viewer" });
    const v = await viewer.as.get(`/api/companies/${viewer.company.id}/billing/documents`);
    expect(v.status).toBe(403);
  });
});
