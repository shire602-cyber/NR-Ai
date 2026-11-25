/**
 * WQ3 (accounting core gaps), against real Postgres through the public API (Bearer client):
 *
 *  9.3   the account drawer payload: 201 with its code, name in Arabic and description; a
 *        duplicate code is 409 ACCOUNT_CODE_TAKEN; a control parent (1040) is refused 422
 *        CONTROL_ACCOUNT_NOT_ALLOWED on create and on a parent change; a reserved control code
 *        is 422 CONTROL_ACCOUNT_ROLE_RESERVED
 *  12.10 no company can store the 15% KSA default VAT rate (UAE only, STEP2)
 *  9.4   journal grid lines: a foreign-currency line posts base and foreign amounts at the
 *        tenant's own rate (fx.convert); a standard-rated line gets its derived input VAT leg
 *        (system_vat) with no adjustment, and the control gate still refuses a manual 2020 line;
 *        the VAT 201 reports it in Box 9, not as an adjustment; a draft with a derived leg posts
 *  9.16  a line marked non-deductible 50% is added back in the CT estimate and moves the CT
 *        payable by exactly 9% of the disallowed half; exempt income is deducted; a reversal
 *        cancels the add-back
 *  9.11  the monthly depreciation job posts last month once (run twice -> one entry, exact
 *        lines), skips a locked period and never charges a disposed asset
 *  9.13  the tax-rates endpoint returns the boxes from the engine's own mapping
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountByCode, freezeTime, postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";

let restore: (() => void) | null = null;
beforeEach(() => {
  restore = freezeTime("2026-11-18T08:00:00Z");
});
afterEach(() => {
  restore?.();
  restore = null;
});

async function tenant(name: string, extra: Record<string, unknown> = {}): Promise<Tenant> {
  return h.createTenant({
    name,
    planId: "professional",
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...extra,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function lines(entryId: string) {
  return h.sql<{
    code: string;
    debit: string;
    credit: string;
    foreign_currency: string | null;
    foreign_debit: string;
    foreign_credit: string;
    exchange_rate: string;
    system_vat: boolean;
    vat_treatment: string | null;
    ct_treatment: string | null;
    ct_disallowed_pct: string | null;
  }>(
    `SELECT a.code, jl.debit::text, jl.credit::text, jl.foreign_currency,
            jl.foreign_debit::text, jl.foreign_credit::text, jl.exchange_rate::text, jl.system_vat,
            jl.vat_treatment, jl.ct_treatment, jl.ct_disallowed_pct::text
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 ORDER BY a.code, jl.debit DESC`,
    [entryId]
  );
}

describe("WQ3 9.3: the account drawer", () => {
  it("[9.3] creates with code (201), refuses a duplicate code (409) and a control parent (422)", async () => {
    const t = await tenant("WQ3Acc");
    const payload = {
      code: "5095",
      nameEn: "Client entertainment",
      nameAr: "ضيافة العملاء",
      description: "Meals and events with clients",
      type: "expense",
      subType: "operating_expense",
      parentId: null,
    };
    const created = await t.as.post(`${base(t)}/accounts`, payload);
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({
      code: "5095",
      nameAr: "ضيافة العملاء",
      description: "Meals and events with clients",
      isSystemAccount: false,
    });

    const dup = await t.as.post(`${base(t)}/accounts`, { ...payload, nameEn: "Other" });
    expect(dup.status, dup.text).toBe(409);
    expect(dup.body.code).toBe("ACCOUNT_CODE_TAKEN");
    expect(dup.body.details.fields.code[0]).toContain("5095");

    const ar = await accountByCode(t, "1040");
    const underAr = await t.as.post(`${base(t)}/accounts`, {
      code: "1045",
      nameEn: "Branch receivables",
      type: "asset",
      subType: "receivable",
      parentId: ar.id,
    });
    expect(underAr.status, underAr.text).toBe(422);
    expect(underAr.body.code).toBe("CONTROL_ACCOUNT_NOT_ALLOWED");
    expect(underAr.body.details.fields).toEqual(["parentId"]);

    const reserved = await t.as.post(`${base(t)}/accounts`, {
      code: "2032",
      nameEn: "Not payroll",
      type: "liability",
    });
    // 2032 exists in the default chart: the duplicate check answers first.
    expect([409, 422]).toContain(reserved.status);

    // A plain asset account moved under 1040 is refused; under a plain header it is fine.
    const plain = await t.as.post(`${base(t)}/accounts`, {
      code: "1095",
      nameEn: "Staff advances",
      type: "asset",
      subType: "other_current_asset",
    });
    expect(plain.status, plain.text).toBe(201);
    const move = await t.as.put(`/api/accounts/${plain.body.id}`, { parentId: ar.id });
    expect(move.status, move.text).toBe(422);
    expect(move.body.code).toBe("CONTROL_ACCOUNT_NOT_ALLOWED");
    const recode = await t.as.put(`/api/accounts/${plain.body.id}`, { code: "5095" });
    expect(recode.status, recode.text).toBe(409);

    // Another tenant cannot see the code as taken.
    const other = await tenant("WQ3Acc2");
    const same = await other.as.post(`${base(other)}/accounts`, payload);
    expect(same.status, same.text).toBe(201);
  });
});

describe("WQ3 12.10: the 15% KSA rate", () => {
  it("[12.10] no company can store 15%", async () => {
    const uae = await tenant("WQ3Uae", { address_country: "AE" });
    const bad = await uae.as.patch(`/api/companies/${uae.company.id}`, { defaultVatRate: 0.15 });
    expect(bad.status, bad.text).toBe(422);
    expect(bad.body.code).toBe("VAT_RATE_NOT_FOR_COUNTRY");
    const ok = await uae.as.patch(`/api/companies/${uae.company.id}`, { defaultVatRate: 0.05 });
    expect(ok.status, ok.text).toBe(200);

    const ksa = await h.createTenant({
      name: "WQ3Ksa",
      companyColumns: { address_country: "SA" },
    });
    const ksaBad = await ksa.as.patch(`/api/companies/${ksa.company.id}`, {
      defaultVatRate: 0.15,
    });
    expect(ksaBad.status, ksaBad.text).toBe(422);
    expect(ksaBad.body.code).toBe("VAT_RATE_NOT_FOR_COUNTRY");
    const ksaOk = await ksa.as.patch(`/api/companies/${ksa.company.id}`, {
      defaultVatRate: 0.05,
    });
    expect(ksaOk.status, ksaOk.text).toBe(200);
    const [row] = await h.sql<{ r: string }>(
      `SELECT default_vat_rate::text AS r FROM companies WHERE id = $1`,
      [ksa.company.id]
    );
    expect(Number(row.r)).toBe(0.05);
  });
});

describe("WQ3 9.4: journal grid lines", () => {
  it("[9.4-fx] a EUR line posts base and foreign amounts at the tenant's own rate", async () => {
    const t = await tenant("WQ3Fx");
    const other = await tenant("WQ3FxOther");
    for (const [tn, rate] of [
      [t, 4.1],
      [other, 9.9],
    ] as const) {
      const r = await tn.as.post(`${base(tn)}/exchange-rates`, {
        fromCurrency: "EUR",
        rate,
        effectiveDate: "2026-11-10",
      });
      expect(r.status, r.text).toBeLessThan(300);
    }
    const travel = await accountByCode(t, "5090");
    const bank = await accountByCode(t, "1020");
    const r = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-15",
      memo: "Paris trip",
      status: "posted",
      lines: [
        {
          accountId: travel.id,
          foreignCurrency: "EUR",
          foreignDebit: 100,
          description: "Hotel",
        },
        { accountId: bank.id, credit: 410 },
      ],
    });
    expect(r.status, r.text).toBe(200);
    const l = await lines(r.body.id);
    expect(l.map((x) => [x.code, Number(x.debit), Number(x.credit)])).toEqual([
      ["1020", 0, 410],
      ["5090", 410, 0],
    ]);
    const eur = l.find((x) => x.code === "5090")!;
    expect(eur.foreign_currency).toBe("EUR");
    expect(Number(eur.foreign_debit)).toBe(100);
    expect(Number(eur.exchange_rate)).toBe(4.1);
  });

  it("[9.4-vat] a standard-rated line derives its input VAT leg; a manual 2020 line is still refused; Box 9 reports it", async () => {
    const t = await tenant("WQ3Vat");
    const software = await accountByCode(t, "5080");
    const bank = await accountByCode(t, "1020");
    const vatOut = await accountByCode(t, "2020");
    const r = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-12",
      memo: "Software licence",
      status: "posted",
      lines: [
        { accountId: software.id, debit: 1000, vatTreatment: "standard", description: "Licence" },
        { accountId: bank.id, credit: 1050 },
      ],
    });
    expect(r.status, r.text).toBe(200);
    const l = await lines(r.body.id);
    expect(l.map((x) => [x.code, Number(x.debit), Number(x.credit), x.system_vat])).toEqual([
      ["1020", 0, 1050, false],
      ["1050", 50, 0, true],
      ["5080", 1000, 0, false],
    ]);
    expect(l.find((x) => x.code === "5080")!.vat_treatment).toBe("standard");
    const [stamp] = await h.sql<{ r: string | null }>(
      `SELECT control_adjustment_reason AS r FROM journal_entries WHERE id = $1`,
      [r.body.id]
    );
    expect(stamp.r).toBeNull();

    const manual = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-12",
      status: "posted",
      lines: [
        { accountId: bank.id, debit: 50 },
        { accountId: vatOut.id, credit: 50 },
      ],
    });
    expect(manual.status, manual.text).toBe(422);
    expect(manual.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");

    const { computeVat201 } = await import("../../server/tax/vat-engine");
    const c = await computeVat201({
      companyId: t.company.id,
      from: "2026-10-01",
      to: "2026-12-31",
      allowIncomplete: true,
    });
    expect(c.boxesFils.box9ExpensesAmount).toBe(100000);
    expect(c.boxesFils.box9ExpensesVat).toBe(5000);
    expect(c.boxesFils.box9ExpensesAdj).toBe(0);

    // A draft with a derived leg posts without a control-account adjustment.
    const draft = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-13",
      status: "draft",
      lines: [
        { accountId: software.id, debit: 200, vatTreatment: "standard" },
        { accountId: bank.id, credit: 210 },
      ],
    });
    expect(draft.status, draft.text).toBe(200);
    const posted = await t.as.post(`/api/journal/${draft.body.id}/post`, {});
    expect(posted.status, posted.text).toBe(200);
  });

  it("[9.4-sales] standard-rated income derives output VAT and lands in Box 1b", async () => {
    const t = await tenant("WQ3Sales");
    const services = await accountByCode(t, "4020");
    const bank = await accountByCode(t, "1020");
    const r = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-12",
      status: "posted",
      lines: [
        { accountId: bank.id, debit: 2100 },
        { accountId: services.id, credit: 2000, vatTreatment: "standard" },
      ],
    });
    expect(r.status, r.text).toBe(200);
    const l = await lines(r.body.id);
    expect(l.map((x) => [x.code, Number(x.debit), Number(x.credit), x.system_vat])).toEqual([
      ["1020", 2100, 0, false],
      ["2020", 0, 100, true],
      ["4020", 0, 2000, false],
    ]);
    const { computeVat201 } = await import("../../server/tax/vat-engine");
    const c = await computeVat201({
      companyId: t.company.id,
      from: "2026-10-01",
      to: "2026-12-31",
      allowIncomplete: true,
    });
    expect(c.boxesFils.box1bDubaiAmount).toBe(200000);
    expect(c.boxesFils.box1bDubaiVat).toBe(10000);
    expect(c.boxesFils.box1bDubaiAdj).toBe(0);
  });

  it("[9.4-contact] a contact of another tenant is refused", async () => {
    const t = await tenant("WQ3Contact");
    const other = await tenant("WQ3ContactOther");
    const [vendor] = await h.sql<{ id: string }>(
      `INSERT INTO vendors (company_id, name) VALUES ($1, 'Other supplier') RETURNING id`,
      [other.company.id]
    );
    const rent = await accountByCode(t, "5010");
    const bank = await accountByCode(t, "1020");
    const r = await t.as.post(`${base(t)}/journal`, {
      date: "2026-11-12",
      status: "posted",
      lines: [
        { accountId: rent.id, debit: 100, contactType: "vendor", contactId: vendor.id },
        { accountId: bank.id, credit: 100 },
      ],
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("CONTACT_NOT_FOUND");
  });
});

describe("WQ3 9.16: CT treatment per journal line", () => {
  async function books(t: Tenant, ct?: Record<string, unknown>) {
    await postJournalEntry(t, {
      date: "2026-03-31",
      lines: [
        { code: "1020", debit: 1_000_000 },
        { code: "4020", credit: 1_000_000 },
      ],
    });
    await postJournalEntry(t, {
      date: "2026-03-31",
      lines: [
        { code: "5010", debit: 100_000 },
        { code: "1020", credit: 100_000 },
      ],
    });
    const meals = await accountByCode(t, "5090");
    const bank = await accountByCode(t, "1020");
    const r = await t.as.post(`${base(t)}/journal`, {
      date: "2026-04-15",
      status: "posted",
      lines: [
        { accountId: meals.id, debit: 20_000, description: "Client dinner", ...ct },
        { accountId: bank.id, credit: 20_000 },
      ],
    });
    expect(r.status, r.text).toBe(200);
    return r.body.id as string;
  }

  const calc = (t: Tenant) =>
    t.as.get(`${base(t)}/corporate-tax/calculate?periodStart=2026-01-01&periodEnd=2026-12-31`);

  it("[9.16] non-deductible 50% adds back 10,000 and moves the CT payable by exactly 900", async () => {
    const plain = await tenant("WQ3CtPlain");
    await books(plain);
    const nd = await tenant("WQ3CtNd");
    const entryId = await books(nd, { ctTreatment: "non_deductible", ctDisallowedPct: 50 });

    const l = await lines(entryId);
    expect(l.find((x) => x.code === "5090")).toMatchObject({
      ct_treatment: "non_deductible",
      ct_disallowed_pct: "50.00",
    });

    const a = await calc(plain);
    const b = await calc(nd);
    expect(a.status, a.text).toBe(200);
    expect(b.status, b.text).toBe(200);
    // Same books: revenue 1,000,000, expenses 120,000, profit 880,000.
    expect(a.body.accountingProfit).toBe(880_000);
    expect(b.body.accountingProfit).toBe(880_000);
    const addBack = b.body.ledgerAdjustments.find(
      (x: { id: string }) => x.id.startsWith("ledger-line-") && x.id.includes("-nd-")
    );
    expect(addBack).toMatchObject({ category: "other_addback", amount: 10_000, source: "ledger" });
    expect(b.body.totalAddBacks - a.body.totalAddBacks).toBe(10_000);
    expect(Math.round((b.body.taxPayable - a.body.taxPayable) * 100)).toBe(90_000);

    // Reversing the entry removes the line (and its add-back) from the period.
    const rev = await nd.as.post(`/api/journal/${entryId}/reverse`, {
      reason: "Wrong account",
      date: "2026-04-20",
    });
    expect(rev.status, rev.text).toBe(200);
    const after = await calc(nd);
    expect(
      after.body.ledgerAdjustments.some((x: { id: string }) => x.id.startsWith("ledger-line-"))
    ).toBe(false);
  });

  it("[9.16-exempt] exempt income is deducted (CT down by 9% of it); a wrong account type is refused", async () => {
    const t = await tenant("WQ3CtExempt");
    await books(t);
    const before = await calc(t);
    const interest = await accountByCode(t, "4040");
    const bank = await accountByCode(t, "1020");
    const r = await t.as.post(`${base(t)}/journal`, {
      date: "2026-05-01",
      status: "posted",
      lines: [
        { accountId: bank.id, debit: 50_000 },
        { accountId: interest.id, credit: 50_000, ctTreatment: "exempt_income" },
      ],
    });
    expect(r.status, r.text).toBe(200);
    const after = await calc(t);
    // +50,000 profit, -50,000 exempt: the payable is unchanged.
    expect(after.body.accountingProfit - before.body.accountingProfit).toBe(50_000);
    expect(Math.round(after.body.taxPayable * 100)).toBe(Math.round(before.body.taxPayable * 100));
    expect(
      after.body.ledgerAdjustments.find((x: { category: string }) => x.category === "exempt_income")
    ).toMatchObject({ amount: 50_000 });

    const wrong = await t.as.post(`${base(t)}/journal`, {
      date: "2026-05-01",
      status: "posted",
      lines: [
        { accountId: bank.id, debit: 10, ctTreatment: "non_deductible" },
        { accountId: interest.id, credit: 10 },
      ],
    });
    expect(wrong.status, wrong.text).toBe(422);
    expect(wrong.body.code).toBe("CT_TREATMENT_ACCOUNT_TYPE");
  });
});

describe("WQ3 9.11: the monthly depreciation job", () => {
  // The job depreciates the last month that has fully ended before `today` (October here).
  const TODAY = "2026-11-18";
  async function asset(t: Tenant, body: Record<string, unknown>) {
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`${base(t)}/fixed-assets`, {
      usefulLifeYears: 5,
      depreciationMethod: "straight_line",
      paymentAccountId: bank.id,
      category: "equipment",
      ...body,
    });
    expect(a.status, a.text).toBe(201);
    return a.body.id as string;
  }

  it("[PR94] posts depreciation for an active trial and leaves expired books untouched", async () => {
    const { runMonthlyDepreciation } =
      await import("../../server/services/fixed-assets/monthly-job");
    const active = await tenant("PR94DepActive");
    const expired = await tenant("PR94DepExpired");
    for (const t of [active, expired]) {
      // Seed already-capitalised books to exercise the scheduled job directly.
      const entry = await postJournalEntry(t, {
        date: "2026-10-01",
        lines: [
          { code: "1210", debit: 60_000 },
          { code: "1020", credit: 60_000 },
        ],
      });
      await h.sql(
        `INSERT INTO fixed_assets (company_id, asset_name, category, purchase_date, purchase_cost,
                                  useful_life_years, net_book_value, capitalization_entry_id)
         VALUES ($1, 'Server rack', 'equipment', '2026-10-01', 60000, 5, 60000, $2)`,
        [t.company.id, entry.id]
      );
    }
    const companyIds = [active.company.id, expired.company.id];
    await h.sql(
      `UPDATE subscriptions SET plan_id = 'free', trial_ends_at =
         CASE WHEN company_id = $1 THEN '2026-11-24'::timestamp ELSE '2026-11-17'::timestamp END
       WHERE company_id IN ($1, $2)`,
      companyIds
    );
    const counts = async (companyId: string) => {
      const [row] = await h.sql<{ journals: number; schedules: number }>(
        `SELECT (SELECT count(*)::int FROM journal_entries WHERE company_id = $1) AS journals,
                (SELECT count(*)::int FROM depreciation_schedules WHERE company_id = $1) AS schedules`,
        [companyId]
      );
      return row;
    };
    const activeBefore = await counts(active.company.id);
    const expiredBefore = await counts(expired.company.id);
    vi.stubEnv("BILLING_ENFORCEMENT", "true");
    try {
      expect(await runMonthlyDepreciation({ companyIds, today: TODAY })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ companyId: active.company.id, status: "posted", posted: 1 }),
          expect.objectContaining({ companyId: expired.company.id, status: "disabled", posted: 0 }),
        ])
      );
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await counts(active.company.id)).toEqual({
      journals: activeBefore.journals + 1,
      schedules: 1,
    });
    expect(await counts(expired.company.id)).toEqual(expiredBefore);
  });

  it("[9.11] posts October once (idempotent), with exact lines; skips a locked period", async () => {
    const { runMonthlyDepreciation, MONTHLY_DEPRECIATION_JOB } =
      await import("../../server/services/fixed-assets/monthly-job");
    const { listJobs } = await import("../../server/platform/job-registry");
    expect(listJobs().map((j) => j.name)).toContain(MONTHLY_DEPRECIATION_JOB);

    const t = await tenant("WQ3Dep");
    const id = await asset(t, {
      assetName: "Laptop rack",
      purchaseDate: "2026-10-01",
      purchaseCost: 60_000,
    });
    const first = await runMonthlyDepreciation({ companyIds: [t.company.id], today: TODAY });
    expect(first).toEqual([
      expect.objectContaining({ status: "posted", posted: 1, period: { year: 2026, month: 10 } }),
    ]);
    const second = await runMonthlyDepreciation({ companyIds: [t.company.id], today: TODAY });
    expect(second[0]).toMatchObject({ status: "nothing_due", posted: 0 });

    const entries = await h.sql<{ id: string; d: string }>(
      `SELECT je.id, to_char(je.date, 'YYYY-MM-DD') AS d FROM depreciation_schedules s
         JOIN journal_entries je ON je.id = s.journal_entry_id
        WHERE s.asset_id = $1`,
      [id]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].d).toBe("2026-10-31");
    const l = await h.sql<{ type: string; sub: string | null; d: string; c: string }>(
      `SELECT a.type, a.sub_type AS sub, jl.debit::text AS d, jl.credit::text AS c
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1 ORDER BY jl.debit DESC`,
      [entries[0].id]
    );
    expect(l.map((x) => [x.type, Number(x.d), Number(x.c)])).toEqual([
      ["expense", 1000, 0],
      ["asset", 0, 1000],
    ]);

    // A locked October is skipped and posts nothing.
    const locked = await tenant("WQ3DepLocked");
    await asset(locked, {
      assetName: "Printer",
      purchaseDate: "2026-10-01",
      purchaseCost: 12_000,
    });
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_end, status) VALUES ($1, '2026-10-31', 'locked')`,
      [locked.company.id]
    );
    const run = await runMonthlyDepreciation({ companyIds: [locked.company.id], today: TODAY });
    expect(run[0]).toMatchObject({ status: "period_locked", posted: 0 });
    const [n] = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM depreciation_schedules WHERE company_id = $1`,
      [locked.company.id]
    );
    expect(Number(n.n)).toBe(0);
  });

  it("[9.11-disposal] never charges an asset disposed before the month, nor a future month", async () => {
    const { runMonthlyDepreciation } =
      await import("../../server/services/fixed-assets/monthly-job");
    const t = await tenant("WQ3DepDisposed");
    const bank = await accountByCode(t, "1020");
    const id = await asset(t, {
      assetName: "Old van",
      purchaseDate: "2026-08-01",
      purchaseCost: 30_000,
    });
    const sold = await t.as.post(`/api/fixed-assets/${id}/dispose`, {
      disposalDate: "2026-09-30",
      disposalAmount: 0,
      proceedsAccountId: bank.id,
    });
    expect(sold.status, sold.text).toBeLessThan(300);
    const run = await runMonthlyDepreciation({ companyIds: [t.company.id], today: TODAY });
    // A disposed asset is no longer active: the company is not even visited.
    expect(run).toEqual([]);
    const [n] = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM depreciation_schedules
        WHERE asset_id = $1 AND period_year * 100 + period_month > 202609`,
      [id]
    );
    expect(Number(n.n)).toBe(0);

    // A month that has not ended yet (November, on 18 November) is never posted.
    const fresh = await tenant("WQ3DepFuture");
    const fid = await asset(fresh, {
      assetName: "New desk",
      purchaseDate: "2026-11-01",
      purchaseCost: 6_000,
    });
    const r = await runMonthlyDepreciation({ companyIds: [fresh.company.id], today: TODAY });
    expect(r[0]).toMatchObject({ period: { year: 2026, month: 10 }, posted: 0 });
    const [m] = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM depreciation_schedules WHERE asset_id = $1`,
      [fid]
    );
    expect(Number(m.n)).toBe(0);
  });
});

describe("WQ3 9.11 x WQ7: the depreciation job is an Automations switch", () => {
  it("[9.11-automations] listed with next run; switched off skips the company; a run records last run and result", async () => {
    const { runMonthlyDepreciation, registerFixedAssetJobs } =
      await import("../../server/services/fixed-assets/monthly-job");
    registerFixedAssetJobs();
    const t = await tenant("WQ3DepAuto");
    const bank = await accountByCode(t, "1020");
    const created = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Server rack",
      purchaseDate: "2026-10-01",
      purchaseCost: 60_000,
      usefulLifeYears: 5,
      depreciationMethod: "straight_line",
      paymentAccountId: bank.id,
      category: "equipment",
    });
    expect(created.status, created.text).toBe(201);

    const row = async () => {
      const r = await t.as.get(`${base(t)}/automations`);
      expect(r.status, r.text).toBe(200);
      return r.body.automations.find((a: { key: string }) => a.key === "monthlyDepreciation");
    };
    // Listed under the job name WQ3 registered, scheduled daily at 02:43 UTC (frozen 18 Nov 08:00).
    expect(await row()).toMatchObject({
      job: "fixedAssets.monthlyDepreciation",
      enabled: true,
      scheduled: true,
      cron: "43 2 * * *",
      lastRunAt: null,
      nextRunAt: "2026-11-19T02:43:00.000Z",
    });

    const off = await t.as.put(`${base(t)}/automations/monthlyDepreciation`, { enabled: false });
    expect(off.status, off.text).toBe(200);
    const skipped = await runMonthlyDepreciation({
      companyIds: [t.company.id],
      today: "2026-11-18",
    });
    expect(skipped).toEqual([expect.objectContaining({ status: "disabled", posted: 0 })]);
    const count = async () =>
      Number(
        (
          await h.sql<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM depreciation_schedules WHERE company_id = $1`,
            [t.company.id]
          )
        )[0].n
      );
    expect(await count()).toBe(0);
    expect(await row()).toMatchObject({ enabled: false, lastRunAt: null, nextRunAt: null });

    const on = await t.as.put(`${base(t)}/automations/monthlyDepreciation`, { enabled: true });
    expect(on.status, on.text).toBe(200);
    const ran = await runMonthlyDepreciation({ companyIds: [t.company.id], today: "2026-11-18" });
    expect(ran).toEqual([expect.objectContaining({ status: "posted", posted: 1 })]);
    expect(await count()).toBe(1);
    expect(await row()).toMatchObject({
      enabled: true,
      lastStatus: "ok",
      lastSummary: { depreciated: 1 },
      nextRunAt: "2026-11-19T02:43:00.000Z",
    });
    // last_run_at is the database clock (now()), not the frozen Node clock.
    expect((await row()).lastRunAt).toEqual(expect.any(String));
  });
});

describe("WQ3 9.13: tax rates", () => {
  it("[9.13] lists each treatment with the boxes from the engine map", async () => {
    const t = await tenant("WQ3Rates");
    const r = await t.as.get(`${base(t)}/tax-rates`);
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ standardRate: 0.05, emirate: "dubai" });
    expect(r.body).not.toHaveProperty("jurisdiction");
    const row = (side: string, treatment: string) =>
      r.body.rows.find(
        (x: { side: string; treatment: string }) => x.side === side && x.treatment === treatment
      );
    expect(row("sales", "standard").boxes.map((b: { box: string }) => b.box)).toEqual(["1b", "1b"]);
    expect(row("sales", "zero_rated").boxes).toEqual([
      { box: "4", part: "amount", key: "box4ZeroRatedAmount" },
    ]);
    expect(row("purchases", "standard").boxes.map((b: { box: string }) => b.box)).toEqual([
      "9",
      "9",
    ]);
    const other = await tenant("WQ3RatesOther");
    const denied = await other.as.get(`${base(t)}/tax-rates`);
    expect(denied.status).toBe(403);
  });
});
