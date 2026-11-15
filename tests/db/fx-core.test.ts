/**
 * W2-E FX core: tenant-scoped rates, one convention, validation, unrealised revaluation.
 * Issue ids: R14-01, R14-02, R14-03, R14-04, R14-12, R14-15, R14-17, R11-18.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const AS_OF = isoDaysAgo(1);
const NEXT_DAY = isoDaysAgo(0);

const rates = (t: Tenant) => `/api/companies/${t.company.id}/exchange-rates`;

async function addRate(
  t: Tenant,
  body: Record<string, unknown>
): Promise<{ status: number; body: any }> {
  return t.as.post(rates(t), body);
}

/** Posted journal entry via SQL (source/sourceId as a document module would write them). */
async function postedEntry(
  t: Tenant,
  opts: { date: string; source: string; sourceId: string | null },
  lines: Array<{
    accountId: string;
    debit: number;
    credit: number;
    foreignCurrency?: string;
    foreignDebit?: number;
    foreignCredit?: number;
    rate?: number;
  }>
): Promise<string> {
  const id = randomUUID();
  await h.sql(
    `INSERT INTO journal_entries (id, company_id, entry_number, date, status, source, source_id, created_by, posted_by, posted_at)
     VALUES ($1, $2, $3, $4, 'posted', $5, $6, $7, $7, now())`,
    [
      id,
      t.company.id,
      `JE-T-${id.slice(0, 8)}`,
      `${opts.date}T00:00:00Z`,
      opts.source,
      opts.sourceId,
      t.user.id,
    ]
  );
  for (const l of lines) {
    await h.sql(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit, foreign_currency, foreign_debit, foreign_credit, exchange_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        l.accountId,
        l.debit,
        l.credit,
        l.foreignCurrency ?? null,
        l.foreignDebit ?? 0,
        l.foreignCredit ?? 0,
        l.rate ?? 1,
      ]
    );
  }
  return id;
}

/** The R14-04 fixture: 2,100 USD invoice @3.65 with 1,000 USD paid, a draft, an unpaid bill. */
async function seedExposure(t: Tenant, opts: { bank?: boolean } = {}) {
  const ar = await accountByCode(t, "1040");
  const ap = await accountByCode(t, "2010");
  const rev = await accountByCode(t, "4010");
  const exp = await accountByCode(t, "5000").catch(() => accountByCode(t, "5130"));
  const bankGl = await accountByCode(t, "1020");
  const docDate = isoDaysAgo(40);

  const inv = await h.sql<{ id: string }>(
    `INSERT INTO invoices (company_id, number, customer_name, date, currency, exchange_rate, subtotal, vat_amount, total, base_currency_amount, status)
     VALUES ($1, 'FX-INV-1', 'Globex', $2, 'USD', 3.65, 2000, 100, 2100, 7665, 'partial') RETURNING id`,
    [t.company.id, `${docDate}T00:00:00Z`]
  );
  await postedEntry(t, { date: docDate, source: "invoice", sourceId: inv[0].id }, [
    { accountId: ar.id, debit: 7665, credit: 0, foreignCurrency: "USD", foreignDebit: 2100 },
    { accountId: rev.id, debit: 0, credit: 7665 },
  ]);
  const payJe = await postedEntry(
    t,
    { date: isoDaysAgo(20), source: "payment", sourceId: inv[0].id },
    [
      { accountId: bankGl.id, debit: 3650, credit: 0 },
      { accountId: ar.id, debit: 0, credit: 3650 },
    ]
  );
  await h.sql(
    `INSERT INTO invoice_payments (invoice_id, company_id, amount, date, method, created_by, journal_entry_id)
     VALUES ($1, $2, 1000, $3, 'bank', $4, $5)`,
    [inv[0].id, t.company.id, `${isoDaysAgo(20)}T00:00:00Z`, t.user.id, payJe]
  );

  // Draft: never posted, must be excluded.
  await h.sql(
    `INSERT INTO invoices (company_id, number, customer_name, date, currency, exchange_rate, subtotal, vat_amount, total, status)
     VALUES ($1, 'FX-INV-DRAFT', 'Initech', $2, 'USD', 3.65, 5000, 0, 5000, 'draft')`,
    [t.company.id, `${docDate}T00:00:00Z`]
  );

  // Unpaid USD bill 500 @3.65, posted.
  const bill = await h.sql<{ id: string }>(
    `INSERT INTO vendor_bills (company_id, vendor_name, bill_number, bill_date, currency, exchange_rate, subtotal, vat_amount, total_amount, amount_paid, status)
     VALUES ($1, 'Acme Supplies', 'FX-BILL-1', $2, 'USD', 3.65, 500, 0, 500, 0, 'approved') RETURNING id`,
    [t.company.id, `${docDate}T00:00:00Z`]
  );
  await postedEntry(t, { date: docDate, source: "bill", sourceId: bill[0].id }, [
    { accountId: exp.id, debit: 1825, credit: 0 },
    { accountId: ap.id, debit: 0, credit: 1825 },
  ]);

  if (opts.bank) {
    // USD bank account linked to its own GL account: 1,000 USD booked at 3.65.
    const gl = await h.sql<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name_en, type) VALUES ($1, '1029', 'USD Bank', 'asset') RETURNING id`,
      [t.company.id]
    );
    await h.sql(
      `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id) VALUES ($1, 'USD Current', 'FAB', 'USD', $2)`,
      [t.company.id, gl[0].id]
    );
    await postedEntry(t, { date: docDate, source: "manual", sourceId: null }, [
      {
        accountId: gl[0].id,
        debit: 3650,
        credit: 0,
        foreignCurrency: "USD",
        foreignDebit: 1000,
        rate: 3.65,
      },
      { accountId: (await accountByCode(t, "3010")).id, debit: 0, credit: 3650 },
    ]);
  }

  const r = await addRate(t, {
    fromCurrency: "USD",
    toCurrency: "AED",
    rate: 3.7,
    effectiveDate: AS_OF,
  });
  expect(r.status).toBe(201);
  return { invoiceId: inv[0].id, billId: bill[0].id };
}

describe("R14-01 tenant-scoped exchange rates", () => {
  it("R14-01: tenant B's USD rate 9.99 never affects tenant A's lookup", async () => {
    const a = await h.createTenant({ name: "FxA" });
    const b = await h.createSecondTenant({ name: "FxB" });

    const bRate = await addRate(b, {
      fromCurrency: "USD",
      toCurrency: "AED",
      rate: 9.99,
      effectiveDate: AS_OF,
    });
    expect(bRate.status).toBe(201);
    expect(bRate.body.companyId).toBe(b.company.id);

    const none = await a.as.get(`${rates(a)}/lookup?from=USD&to=AED&date=${AS_OF}`);
    expect(none.status).toBe(422);
    expect(none.body.code).toBe("NO_EXCHANGE_RATE");

    // The legacy global lookup (used by invoices today) only sees system rows.
    const legacy = await a.as.get("/api/exchange-rates/lookup?base=USD&target=AED");
    expect(legacy.status).toBe(404);

    const aRate = await addRate(a, {
      fromCurrency: "USD",
      toCurrency: "AED",
      rate: 3.6725,
      effectiveDate: AS_OF,
    });
    expect(aRate.status).toBe(201);
    const own = await a.as.get(`${rates(a)}/lookup?from=USD&to=AED&date=${AS_OF}`);
    expect(own.status).toBe(200);
    expect(own.body.rate).toBe(3.6725);
    expect(own.body.scope).toBe("company");

    const list = await a.as.get(rates(a));
    expect(list.body.some((r: any) => Number(r.rate) === 9.99)).toBe(false);

    // B cannot write to or read A's company routes.
    expect((await b.as.post(rates(a), { fromCurrency: "USD", rate: 1 })).status).toBe(403);
    expect((await b.as.get(rates(a))).status).toBe(403);
    expect((await b.as.delete(`${rates(a)}/${aRate.body.id}`)).status).toBe(403);
  });

  it("R14-01: non-admin POST to the global routes -> 403; admin writes system rows", async () => {
    const user = await h.createTenant({ name: "FxUser" });
    const admin = await h.createTenant({ name: "FxAdmin", isAdmin: true });

    const g = await user.as.post("/api/exchange-rates", {
      baseCurrency: "USD",
      targetCurrency: "AED",
      rate: 9.99,
      date: AS_OF,
    });
    expect(g.status).toBe(403);
    const fta = await user.as.post("/api/exchange-rates/fta/bulk", {
      baseCurrency: "GBP",
      rates: [{ targetCurrency: "AED", rate: 4.6, date: AS_OF }],
    });
    expect(fta.status).toBe(403);
    expect(
      await h.sql(`SELECT 1 FROM exchange_rates WHERE rate = 9.99 AND company_id IS NULL`)
    ).toHaveLength(0);

    const sys = await admin.as.post("/api/exchange-rates/fta/bulk", {
      baseCurrency: "GBP",
      rates: [{ targetCurrency: "AED", rate: 4.6, date: AS_OF }],
    });
    expect(sys.status).toBe(201);
    expect(sys.body.inserted).toBe(1);
    const rows = await h.sql(
      `SELECT company_id, source FROM exchange_rates WHERE base_currency = 'GBP'`
    );
    expect(rows).toEqual([{ company_id: null, source: "fta" }]);

    // System rows are the fallback for every company, below its own rows.
    const fallback = await user.as.get(`${rates(user)}/lookup?from=GBP&to=AED&date=${AS_OF}`);
    expect(fallback.body).toMatchObject({ rate: 4.6, scope: "system", source: "fta" });
    // ...and a company cannot delete a system row.
    const sysId = (await user.as.get(rates(user))).body.find((r: any) => r.scope === "system").id;
    expect((await user.as.delete(`${rates(user)}/${sysId}`)).status).toBe(404);
  });

  it("R14-01: viewers cannot change rates", async () => {
    const v = await h.createTenant({ name: "FxViewer", role: "viewer" });
    const r = await addRate(v, { fromCurrency: "USD", rate: 3.6725, effectiveDate: AS_OF });
    expect(r.status).toBe(403);
  });
});

describe("R14-02 one rate convention", () => {
  it("R14-02: UI-entered EUR 4.0 converts 100 EUR -> 400.00 AED and is found by lookup", async () => {
    const t = await h.createTenant({ name: "FxConv" });
    const created = await addRate(t, {
      fromCurrency: "EUR",
      toCurrency: "AED",
      rate: 4.0,
      effectiveDate: AS_OF,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ fromCurrency: "EUR", toCurrency: "AED", rate: 4 });
    const stored = await h.sql(
      `SELECT base_currency, target_currency, rate::text AS rate FROM exchange_rates WHERE id = $1`,
      [created.body.id]
    );
    expect(stored[0]).toEqual({ base_currency: "EUR", target_currency: "AED", rate: "4.000000" });

    const conv = await t.as.get(`${rates(t)}/convert?from=EUR&to=AED&amount=100`);
    expect(conv.status).toBe(200);
    expect(conv.body.convertedAmountText).toBe("400.00");
    expect(conv.body.rate).toBe(4);

    const back = await t.as.get(`${rates(t)}/convert?from=AED&to=EUR&amount=400`);
    expect(back.body.convertedAmountText).toBe("100.00");

    const look = await t.as.get(`${rates(t)}/lookup?from=EUR&to=AED`);
    expect(look.status).toBe(200);
    expect(look.body.rate).toBe(4);
    const inv = await t.as.get(`${rates(t)}/lookup?from=AED&to=EUR`);
    expect(inv.body).toMatchObject({ rate: 0.25, inverse: true });

    // Entered the other way round (AED -> USD) it is stored canonically as USD/AED.
    const flipped = await addRate(t, {
      fromCurrency: "AED",
      toCurrency: "USD",
      rate: 0.25,
      effectiveDate: AS_OF,
    });
    expect(flipped.status).toBe(201);
    expect(flipped.body).toMatchObject({ fromCurrency: "USD", toCurrency: "AED", rate: 4 });
  });
});

describe("R14-12 rate validation", () => {
  it("R14-12: rejects non-ISO codes, AED/AED, non-positive and future rates; sanity band", async () => {
    const t = await h.createTenant({ name: "FxVal" });
    const admin = await h.createTenant({ name: "FxValAdmin", isAdmin: true });

    expect((await addRate(t, { fromCurrency: "ZZZZZZ", toCurrency: "AED", rate: 5 })).status).toBe(
      400
    );
    const zzz = await addRate(t, { fromCurrency: "ZZZ", toCurrency: "AED", rate: 5 });
    expect(zzz.status).toBe(400);
    expect(zzz.body.code).toBe("INVALID_CURRENCY");
    const same = await addRate(t, { fromCurrency: "AED", toCurrency: "AED", rate: 5 });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe("SAME_CURRENCY");
    expect((await addRate(t, { fromCurrency: "USD", rate: 0 })).body.code).toBe("INVALID_RATE");
    expect((await addRate(t, { fromCurrency: "USD", rate: -3 })).body.code).toBe("INVALID_RATE");
    expect(
      (await addRate(t, { fromCurrency: "USD", rate: 3.67, effectiveDate: isoDaysAgo(-3) })).body
        .code
    ).toBe("FUTURE_RATE_DATE");
    expect(
      (await addRate(t, { fromCurrency: "USD", rate: 3.67, effectiveDate: "2026-02-30" })).status
    ).toBe(400);
    expect(
      (await addRate(t, { fromCurrency: "USD", rate: 3.67, companyId: admin.company.id })).status
    ).toBe(400);

    const g1 = await admin.as.post("/api/exchange-rates", {
      baseCurrency: "ZZZZZZ",
      targetCurrency: "AED",
      rate: 5,
    });
    expect(g1.status).toBe(400);
    const g2 = await admin.as.post("/api/exchange-rates", {
      baseCurrency: "AED",
      targetCurrency: "AED",
      rate: 5,
    });
    expect(g2.status).toBe(400);
    expect(g2.body.code).toBe("SAME_CURRENCY");

    // Sanity band: a > 20% move vs the previous rate needs confirmation.
    expect(
      (await addRate(t, { fromCurrency: "USD", rate: 3.6725, effectiveDate: isoDaysAgo(3) })).status
    ).toBe(201);
    const jump = await addRate(t, { fromCurrency: "USD", rate: 5, effectiveDate: AS_OF });
    expect(jump.status).toBe(409);
    expect(jump.body.code).toBe("RATE_CHANGE_UNCONFIRMED");
    expect(jump.body.details.previousRate).toBe("3.672500");
    const ok = await addRate(t, {
      fromCurrency: "USD",
      rate: 5,
      effectiveDate: AS_OF,
      confirmLargeMove: true,
    });
    expect(ok.status).toBe(201);
    const small = await addRate(t, { fromCurrency: "USD", rate: 5.1, effectiveDate: AS_OF });
    expect(small.status).toBe(200); // same day, source and type: replaced
    expect(small.body.replaced).toBe(true);
  });
});

describe("R14-15 rate types, inverse pairs and staleness", () => {
  it("R14-15: closing vs spot, spot fallback, inverse pairs and stale flag", async () => {
    const t = await h.createTenant({ name: "FxTypes" });
    expect(
      (await addRate(t, { fromCurrency: "USD", rate: 3.67, effectiveDate: isoDaysAgo(30) })).status
    ).toBe(201);
    const stale = await t.as.get(`${rates(t)}/lookup?from=USD&to=AED`);
    expect(stale.body).toMatchObject({ rate: 3.67, stale: true, ageDays: 30 });
    expect(stale.body.warning).toMatch(/30 days old/);
    const relaxed = await t.as.get(`${rates(t)}/lookup?from=USD&to=AED&maxAgeDays=60`);
    expect(relaxed.body.stale).toBe(false);

    const fallback = await t.as.get(`${rates(t)}/lookup?from=USD&to=AED&rateType=closing`);
    expect(fallback.body).toMatchObject({ rate: 3.67, rateType: "spot" });
    expect(fallback.body.warning).toMatch(/No closing rate/);

    expect(
      (
        await addRate(t, {
          fromCurrency: "USD",
          rate: 3.68,
          rateType: "closing",
          effectiveDate: AS_OF,
        })
      ).status
    ).toBe(201);
    const closing = await t.as.get(`${rates(t)}/lookup?from=USD&to=AED&rateType=closing`);
    expect(closing.body).toMatchObject({ rate: 3.68, rateType: "closing", stale: false });
    const spot = await t.as.get(`${rates(t)}/lookup?from=USD&to=AED&rateType=spot`);
    expect(spot.body.rate).toBe(3.67);

    const identity = await t.as.get(`${rates(t)}/lookup?from=AED&to=AED`);
    expect(identity.body).toMatchObject({ rate: 1, scope: "identity" });

    const { resolve } = await import("../../server/platform/service-registry");
    const getRate =
      resolve<(...a: unknown[]) => Promise<{ rate: number; inverse: boolean }>>("fx.getRate");
    const r = await getRate(t.company.id, "AED", "USD", AS_OF, { rateType: "closing" });
    expect(r).toMatchObject({ rate: 0.271739, inverse: true });
  });
});

describe("R14-04 unrealised exposure", () => {
  it("R14-04: 2,100 USD invoice with 1,000 paid @3.65 at 3.70 = 55.00; draft excluded; bill opposite sign", async () => {
    const t = await h.createTenant({ name: "FxExp" });
    const { invoiceId, billId } = await seedExposure(t);

    const r = await t.as.get(
      `/api/companies/${t.company.id}/reports/fx-gains-losses?asOf=${AS_OF}`
    );
    expect(r.status).toBe(200);
    expect(r.body.receivables).toHaveLength(1);
    expect(r.body.receivables[0]).toMatchObject({
      entityId: invoiceId,
      foreignAmount: 1100,
      bookValueAed: 4015,
      currentValueAed: 4070,
      unrealizedGainLoss: 55,
    });
    expect(r.body.receivables.some((x: any) => x.entityNumber === "FX-INV-DRAFT")).toBe(false);
    expect(r.body.payables).toHaveLength(1);
    expect(r.body.payables[0]).toMatchObject({
      entityId: billId,
      entityType: "bill",
      unrealizedGainLoss: -25,
    });
    expect(r.body.totalUnrealizedGain).toBe(55);
    expect(r.body.totalUnrealizedLoss).toBe(-25);
    expect(r.body.netUnrealizedGainLoss).toBe(30);
  });
});

describe("R14-03 / R14-17 / R11-18 revaluation", () => {
  it("R14-03 R14-17 R11-18: posts a balanced entry, reverses next day, re-run is a no-op, undo reverses", async () => {
    const t = await h.createTenant({ name: "FxReval" });
    await seedExposure(t, { bank: true });
    const base = `/api/companies/${t.company.id}`;

    const preview = await t.as.get(`${base}/exchange-rates/revalue/preview?asOf=${AS_OF}`);
    expect(preview.status).toBe(200);
    expect(preview.body.netGainLoss).toBe("80.00"); // 55 A/R - 25 A/P + 50 bank
    expect(preview.body.alreadyPosted).toBeNull();

    const run = await t.as.post(`${base}/exchange-rates/revalue`, { asOf: AS_OF });
    expect(run.status).toBe(201);
    expect(run.body.posted).toBe(true);
    const revalId = run.body.revaluation.id;

    const entries = await h.sql<{
      id: string;
      source: string;
      source_id: string;
      date: string;
      reversed_entry_id: string | null;
    }>(
      `SELECT id, source, source_id::text, to_char(date, 'YYYY-MM-DD') AS date, reversed_entry_id::text
         FROM journal_entries WHERE company_id = $1 AND source LIKE 'fx_revaluation%' ORDER BY date`,
      [t.company.id]
    );
    expect(entries.map((e) => [e.source, e.date])).toEqual([
      ["fx_revaluation", AS_OF],
      ["fx_revaluation_reversal", NEXT_DAY],
    ]);
    expect(entries.every((e) => e.source_id === revalId)).toBe(true);
    expect(entries[1].reversed_entry_id).toBe(entries[0].id);

    const lines = await h.sql<{ entry_id: string; code: string; debit: string; credit: string }>(
      `SELECT jl.entry_id::text, a.code, jl.debit::text, jl.credit::text
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = ANY($1::uuid[]) ORDER BY a.code`,
      [entries.map((e) => e.id)]
    );
    const of = (id: string) => lines.filter((l) => l.entry_id === id);
    const sum = (ls: typeof lines, k: "debit" | "credit") =>
      ls.reduce((s, l) => s + Number(l[k]), 0);
    expect(sum(of(entries[0].id), "debit")).toBeCloseTo(sum(of(entries[0].id), "credit"), 10);
    const reval = Object.fromEntries(of(entries[0].id).map((l) => [l.code, [l.debit, l.credit]]));
    expect(reval).toEqual({
      "1029": ["50.00", "0.00"],
      "1040": ["55.00", "0.00"],
      "2010": ["0.00", "25.00"],
      "4091": ["0.00", "80.00"],
    });
    const reversal = Object.fromEntries(
      of(entries[1].id).map((l) => [l.code, [l.debit, l.credit]])
    );
    expect(reversal["1040"]).toEqual(["0.00", "55.00"]);
    expect(reversal["4091"]).toEqual(["80.00", "0.00"]);

    // Second run for the same date: no-op.
    const again = await t.as.post(`${base}/exchange-rates/revalue`, { asOf: AS_OF });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ posted: false, noop: true, reason: "ALREADY_POSTED" });
    const count = await h.sql(
      `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source LIKE 'fx_revaluation%'`,
      [t.company.id]
    );
    expect(count).toHaveLength(2);

    const history = await t.as.get(`${base}/fx-revaluations`);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      id: revalId,
      status: "posted",
      asOf: AS_OF,
      netGainLoss: 80,
    });

    // Undo reverses both entries; the date can then be revalued again.
    const undo = await t.as.post(`${base}/fx-revaluations/${revalId}/undo`, {});
    expect(undo.status).toBe(200);
    expect(undo.body.undoEntryIds).toHaveLength(2);
    const net = await h.sql<{ code: string; net: string }>(
      `SELECT a.code, SUM(jl.debit - jl.credit)::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source LIKE 'fx_revaluation%' GROUP BY a.code`,
      [t.company.id]
    );
    expect(net.every((n) => Number(n.net) === 0)).toBe(true);
    expect((await t.as.post(`${base}/fx-revaluations/${revalId}/undo`, {})).status).toBe(409);
    const rerun = await t.as.post(`${base}/exchange-rates/revalue`, { asOf: AS_OF });
    expect(rerun.status).toBe(201);

    // Another tenant cannot undo it.
    const other = await h.createSecondTenant({ name: "FxRevalB" });
    const leak = await other.as.post(
      `${base}/fx-revaluations/${rerun.body.revaluation.id}/undo`,
      {}
    );
    expect([403, 404]).toContain(leak.status);
  });

  it("R14-17: stale rates need acknowledgement; missing rates block the run", async () => {
    const t = await h.createTenant({ name: "FxStale" });
    const ar = await accountByCode(t, "1040");
    const rev = await accountByCode(t, "4010");
    const inv = await h.sql<{ id: string }>(
      `INSERT INTO invoices (company_id, number, customer_name, date, currency, exchange_rate, total, status)
       VALUES ($1, 'FX-CHF-1', 'Umbrella', $2, 'CHF', 4.5, 100, 'sent') RETURNING id`,
      [t.company.id, `${isoDaysAgo(60)}T00:00:00Z`]
    );
    await postedEntry(t, { date: isoDaysAgo(60), source: "invoice", sourceId: inv[0].id }, [
      { accountId: ar.id, debit: 450, credit: 0 },
      { accountId: rev.id, debit: 0, credit: 450 },
    ]);
    const base = `/api/companies/${t.company.id}`;
    const missing = await t.as.post(`${base}/exchange-rates/revalue`, { asOf: AS_OF });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe("NO_EXCHANGE_RATE");

    await addRate(t, { fromCurrency: "CHF", rate: 4.6, effectiveDate: isoDaysAgo(20) });
    const stale = await t.as.post(`${base}/exchange-rates/revalue`, { asOf: AS_OF });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_EXCHANGE_RATE");
    const ok = await t.as.post(`${base}/exchange-rates/revalue`, {
      asOf: AS_OF,
      acknowledgeStale: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.netGainLoss).toBe("10.00");
  });
});
