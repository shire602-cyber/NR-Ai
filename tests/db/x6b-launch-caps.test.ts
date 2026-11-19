/**
 * X6b free trial + cost caps (WQ7: the trial's caps are shared/plans.ts TRIAL_LIMITS): while billing enforcement is off (no online payment yet) every feature and
 * the monthly invoice/receipt/seat figures stay open, but the cost and abuse caps stay hard:
 * AI credits, storage and companies per user. Each cap answers with a stable code that the app
 * localises (forms.serverErrors.<CODE>).
 */
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

function env(billing: string | undefined, caps: string | undefined) {
  if (billing === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = billing;
  if (caps === undefined) delete process.env.COST_CAPS_ENFORCEMENT;
  else process.env.COST_CAPS_ENFORCEMENT = caps;
}

afterEach(() => env(undefined, undefined));

async function invoice(t: Tenant) {
  return t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Offer Customer",
    date: today(),
    lines: [{ description: "Item", quantity: 1, unitPrice: 10, vatRate: 5 }],
  });
}

describe("X6b free trial + cost caps keeps only the cost caps", () => {
  it("[X6b-invoices-open] invoices past the free figure are not blocked while the offer is open", async () => {
    env("false", "true");
    const t = await h.createTenant();
    await h.sql(
      `INSERT INTO usage_counters (company_id, period, metric, count)
       SELECT $1, to_char(now() + interval '4 hours', 'YYYY-MM'), 'invoices', 500
       ON CONFLICT (company_id, period, metric) DO UPDATE SET count = 500`,
      [t.company.id]
    );
    const r = await invoice(t);
    expect(r.status, r.text).toBe(200);
  });

  it("[X6b-ai-credits] WQ7: the 101st AI call of the month in the trial is a localisable 402", async () => {
    env("false", "true");
    const t = await h.createTenant();
    await h.sql(
      `INSERT INTO usage_counters (company_id, period, metric, count)
       SELECT $1, to_char(now() + interval '4 hours', 'YYYY-MM'), 'ai_calls', 100
       ON CONFLICT (company_id, period, metric) DO UPDATE SET count = 100`,
      [t.company.id]
    );
    const r = await t.as.post("/api/ai/categorize", {
      companyId: t.company.id,
      description: "Office supplies",
      amount: 12,
    });
    expect(r.status, r.text).toBe(402);
    expect(r.body).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      resource: "ai_calls",
      limit: 100,
    });
  });

  it("[X6b-ai-credits] with the caps switched off (development default) AI calls are not capped", async () => {
    env("false", "false");
    const t = await h.createTenant();
    await h.sql(
      `INSERT INTO usage_counters (company_id, period, metric, count)
       SELECT $1, to_char(now() + interval '4 hours', 'YYYY-MM'), 'ai_calls', 10
       ON CONFLICT (company_id, period, metric) DO UPDATE SET count = 10`,
      [t.company.id]
    );
    const r = await t.as.post("/api/ai/categorize", {
      companyId: t.company.id,
      description: "Office supplies",
      amount: 12,
    });
    expect(r.status).not.toBe(402);
  });

  it("[X6b-companies] WQ7: a trial user may own three companies; the fourth is COMPANY_LIMIT_REACHED", async () => {
    env("false", "true");
    const t = await h.createTenant();
    for (const n of [2, 3]) {
      const ok = await t.as.post("/api/companies", { name: `Trial Co ${n} ${Date.now()}` });
      expect([200, 201], ok.text).toContain(ok.status);
    }
    const fourth = await t.as.post("/api/companies", { name: `Fourth Co ${Date.now()}` });
    expect(fourth.status, fourth.text).toBe(403);
    expect(fourth.body.code).toBe("COMPANY_LIMIT_REACHED");
    expect(fourth.body.details).toMatchObject({ planId: "trial", limit: 3, current: 3 });

    // Enterprise has no company limit.
    const ent = await h.createTenant({ planId: "enterprise" });
    for (const n of [2, 3, 4]) {
      const ok = await ent.as.post("/api/companies", { name: `Ent Co ${n} ${Date.now()}` });
      expect([200, 201], ok.text).toContain(ok.status);
    }
  });

  it("[X6b-storage] an upload that would pass the storage allowance is refused with STORAGE_LIMIT_REACHED", async () => {
    env("false", "true");
    const t = await h.createTenant();
    const cash = await h.sql<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = '1010'`,
      [t.company.id]
    );
    const equity = await h.sql<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = '3010'`,
      [t.company.id]
    );
    const entry = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      status: "posted",
      lines: [
        { accountId: cash[0].id, debit: 10 },
        { accountId: equity[0].id, credit: 10 },
      ],
    });
    expect(entry.status, entry.text).toBe(200);
    // 1,023 MB already stored (trial: 1,024 MB, WQ7): the next receipt photo fits no longer.
    await h.sql(
      `INSERT INTO journal_attachments (entry_id, company_id, file_name, content_type, storage_key, size_bytes, uploaded_by)
       VALUES ($1, $2, 'scan.pdf', 'application/pdf', 'k', $3, $4)`,
      [entry.body.id, t.company.id, 1023 * 1024 * 1024, t.user.id]
    );
    const usage = await t.as.get(`/api/companies/${t.company.id}/billing/usage`);
    expect(usage.body.usage.storage.used).toBeGreaterThan(1022);
    expect(usage.body.usage.storage.limit).toBe(1024);

    const big = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024);
    const receipt = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
      merchant: "Big Scan",
      date: today(),
      amount: 10,
      imageData: big,
    });
    expect(receipt.status, receipt.text).toBe(402);
    expect(receipt.body).toMatchObject({ code: "STORAGE_LIMIT_REACHED", limitMb: 1024 });

    // The same upload is allowed once the company is on a larger plan.
    const pro = await h.createTenant({ planId: "professional" });
    const okReceipt = await pro.as.post(`/api/companies/${pro.company.id}/receipts`, {
      merchant: "Big Scan",
      date: today(),
      amount: 10,
      imageData: big,
    });
    expect(okReceipt.status).not.toBe(402);
  });

  it("[X6b-checkout] checkout answers 503 STRIPE_NOT_CONFIGURED and the subscription says checkout is unavailable", async () => {
    const t = await h.createTenant();
    const sub = await t.as.get(`/api/companies/${t.company.id}/billing/subscription`);
    expect(sub.status, sub.text).toBe(200);
    expect(sub.body.checkoutAvailable).toBe(false);
    expect(sub.body.trial).toMatchObject({ days: 14, ended: false });
    expect(sub.body.trial.daysLeft).toBeGreaterThan(12);
    // The trial never locks anything: an expired trial still serves the app.
    await h.sql(
      `UPDATE subscriptions SET created_at = now() - interval '30 days', trial_ends_at = NULL WHERE company_id = $1`,
      [t.company.id]
    );
    const after = await t.as.get(`/api/companies/${t.company.id}/billing/subscription`);
    expect(after.body.trial).toMatchObject({ ended: true, daysLeft: 0 });
    expect((await invoice(t)).status).toBe(200);
    const checkout = await t.as.post(`/api/companies/${t.company.id}/billing/checkout`, {
      planId: "starter",
      billingCycle: "monthly",
    });
    expect(checkout.status, checkout.text).toBe(503);
    expect(checkout.body.code).toBe("STRIPE_NOT_CONFIGURED");
  });
});

describe("X6b first-hour data fixes", () => {
  it("[X6b-bank-gl-name] a bank account's GL name is not doubled to 'Bank - Bank - …'", async () => {
    const t = await h.createTenant();
    const make = async (nameEn: string) => {
      const r = await t.as.post(`/api/companies/${t.company.id}/bank-accounts`, {
        nameEn,
        bankName: "Emirates NBD",
        currency: "AED",
      });
      expect(r.status, r.text).toBe(201);
      return r.body.glAccount as { nameEn: string; nameAr: string };
    };
    expect((await make("Main current")).nameEn).toBe("Bank - Main current");
    expect((await make("Bank - Emirates NBD")).nameEn).toBe("Bank - Emirates NBD");
    const ar = await make("Bank of Sharjah");
    expect(ar.nameEn).toBe("Bank of Sharjah");
    expect(ar.nameEn).not.toMatch(/Bank - Bank/);
  });

  it("[X6b-bill-memo] a bill without a supplier number is referenced by its date, never an id fragment", async () => {
    const t = await h.createTenant();
    const noNumber = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Memo Vendor LLC",
      bill_date: "2026-01-15",
      due_date: "2026-02-14",
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 100, vat_rate: 5 }],
    });
    expect(noNumber.status, noNumber.text).toBe(200);
    const approved = await t.as.post(`/api/bills/${noNumber.body.id}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    const withNumber = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Memo Vendor LLC",
      bill_number: "SUP-77",
      bill_date: "2026-01-16",
      due_date: "2026-02-14",
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 100, vat_rate: 5 }],
    });
    expect(withNumber.status, withNumber.text).toBe(200);
    expect((await t.as.post(`/api/bills/${withNumber.body.id}/approve`, {})).status).toBe(200);
    const memos = await h.sql<{ memo: string }>(
      `SELECT memo FROM journal_entries WHERE company_id = $1 AND memo LIKE 'Vendor Bill%' ORDER BY memo`,
      [t.company.id]
    );
    expect(memos.map((m) => m.memo)).toEqual([
      "Vendor Bill 2026-01-15 - Memo Vendor LLC",
      "Vendor Bill SUP-77 - Memo Vendor LLC",
    ]);
  });
});
