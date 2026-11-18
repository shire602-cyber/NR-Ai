/**
 * Accounting round D2 (re-audit 3): disposals, the chart of accounts, the FX sanity band and VAT
 * submit hygiene, against real Postgres. Every scenario posts through the public API (Bearer
 * client) and asserts the exact journal lines and the register / report figures:
 *
 *  N5   a debit note on a disposal invoice raises the disposal proceeds: Cr 5130 up to the loss,
 *       Cr 4080 for the rest, never revenue (IAS 16.68, 16.71); the register's proceeds and VAT go
 *       up; voiding it restores both; its receipt is investing (IAS 7.16(b))
 *  N6   a disposal dated before depreciation already booked reverses that depreciation through
 *       the ledger in the disposal transaction (IAS 16.55), then charges the disposal month to the
 *       disposal date; a locked period still refuses it
 *  N10  a future-dated disposal is refused (422 DISPOSAL_DATE_IN_FUTURE)
 *  N8   control / system accounts keep their code, type, sub-type, VAT flags (and a control
 *       sub-account its parent); a control account is never a bank account's GL link
 *  N9   the first USD rate is checked against the CBUAE peg (36.725 refused, 3.69 accepted); a
 *       revaluation at a rate outside the band needs a reason from a permitted role
 *  N11  the VAT submit refuses the dead adjustmentAmount / adjustmentReason fields
 *  N12  a vendor's default expense account cannot be a control account
 *  N13  a filed return's settlement cannot be dated before the filing date
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountByCode, freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";

let restore: (() => void) | null = null;
beforeEach(() => {
  // The server's "today" for every scenario (the disposal and rate checks compare with it).
  restore = freezeTime("2026-11-18T08:00:00Z");
});
afterEach(() => {
  restore?.();
  restore = null;
});

async function tenant(name: string): Promise<Tenant> {
  return h.createTenant({
    name,
    planId: "professional",
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function linesOf(entryId: string) {
  const rows = await h.sql<{ code: string; d: string; c: string }>(
    `SELECT a.code, SUM(jl.debit)::text AS d, SUM(jl.credit)::text AS c
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 GROUP BY a.code ORDER BY a.code`,
    [entryId]
  );
  return Object.fromEntries(rows.map((r) => [r.code, [Number(r.d), Number(r.c)]]));
}

async function glBalance(t: Tenant, code: string, from?: string, to?: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2
        AND ($3::date IS NULL OR (je.date + interval '4 hours')::date >= $3::date)
        AND ($4::date IS NULL OR (je.date + interval '4 hours')::date <= $4::date)`,
    [t.company.id, code, from ?? null, to ?? null]
  );
  return Number(rows[0].n) / 100;
}

async function register(assetId: string) {
  const [r] = await h.sql<{ amount: string; vat: string; status: string }>(
    `SELECT disposal_amount::text AS amount, disposal_vat::text AS vat, status
       FROM fixed_assets WHERE id = $1`,
    [assetId]
  );
  return { amount: Number(r.amount), vat: Number(r.vat), status: r.status };
}

async function adjustmentEntry(t: Tenant, assetId: string, docId: string) {
  const [e] = await h.sql<{ id: string; status: string; reversed: string | null }>(
    `SELECT id, status, reversed_by_entry_id AS reversed FROM journal_entries
      WHERE company_id = $1 AND idempotency_key = $2`,
    [t.company.id, `fixed_asset:${assetId}:proceeds-adj:${docId}`]
  );
  return e;
}

async function asset(t: Tenant, body: Record<string, unknown>) {
  const bank = await accountByCode(t, "1020");
  const a = await t.as.post(`${base(t)}/fixed-assets`, {
    usefulLifeYears: 5,
    depreciationMethod: "straight_line",
    paymentAccountId: bank.id,
    ...body,
  });
  expect(a.status, a.text).toBe(201);
  return a.body.id as string;
}

describe("D2 N5: a debit note on a disposal invoice", () => {
  it("[N5] moves the extra charge to the disposal result (Cr 5130 400 / Cr 4080 1,600), raises the register, restores on void, and its receipt is investing", async () => {
    const t = await tenant("D2N5");
    const bank = await accountByCode(t, "1020");
    const van = await asset(t, {
      assetName: "Van",
      category: "vehicles",
      purchaseDate: "2026-01-01",
      purchaseCost: 60000,
    });
    // 10 months at 1,000 + 18/30 of November = 10,600; NBV 49,400; gain 5,600.
    const d = await t.as.post(`/api/fixed-assets/${van}/dispose`, {
      disposalDate: "2026-11-18",
      disposalAmount: 55000,
      onCredit: true,
      buyerName: "Buyer LLC",
      vatTreatment: "standard",
    });
    expect(d.status, d.text).toBe(200);
    expect(d.body).toMatchObject({ netBookValueAtDisposal: 49400, gainLoss: 5600 });
    const inv = d.body.invoiceId as string;

    // RM3 (C2): a credit note of 6,000 takes the gain to a loss of 400.
    const cn = await t.as.post(`${base(t)}/invoices/${inv}/credit-note`, {
      lines: [
        {
          description: "Price reduction",
          quantity: 1,
          unitPrice: 6000,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
      reason: "Dent found",
      date: "2026-11-18",
    });
    expect(cn.status, cn.text).toBe(201);
    expect(await register(van)).toMatchObject({ amount: 49000, vat: 2450 });

    const debitNote = () =>
      t.as.post(`${base(t)}/invoices/${inv}/debit-note`, {
        lines: [
          {
            description: "Spare tyre",
            quantity: 1,
            unitPrice: 2000,
            vatRate: 0.05,
            vatSupplyType: "standard_rated",
          },
        ],
        reason: "Spare tyre added",
        date: "2026-11-18",
      });
    const dn1 = await debitNote();
    expect(dn1.status, dn1.text).toBe(201);
    const [dnEntry] = await h.sql<{ id: string }>(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND idempotency_key = $2`,
      [t.company.id, `invoice:${dn1.body.id}:revenue`]
    );
    // The debit note itself stays a tax document: receivable, sales and output VAT.
    expect(await linesOf(dnEntry.id)).toEqual({
      "1040": [2100, 0],
      "2020": [0, 100],
      "4010": [0, 2000],
    });
    const adj = await adjustmentEntry(t, van, dn1.body.id);
    expect(adj.status).toBe("posted");
    expect(await linesOf(adj.id)).toEqual({
      "4010": [2000, 0],
      "4080": [0, 1600],
      "5130": [0, 400],
    });
    expect(await register(van)).toMatchObject({ amount: 51000, vat: 2550 });
    // November P&L: no revenue; net gain 1,600 = 51,000 - 49,400.
    expect(await glBalance(t, "4010", "2026-11-01", "2026-11-30")).toBe(0);
    expect(await glBalance(t, "4080", "2026-11-01", "2026-11-30")).toBe(-1600);
    expect(await glBalance(t, "5130", "2026-11-01", "2026-11-30")).toBe(0);

    // Voiding the debit note voids the adjustment and restores the register.
    const v = await t.as.patch(`/api/invoices/${dn1.body.id}/status`, { status: "void" });
    expect(v.status, v.text).toBe(200);
    const adjAfter = await adjustmentEntry(t, van, dn1.body.id);
    expect(adjAfter.reversed).not.toBeNull();
    expect(await register(van)).toMatchObject({ amount: 49000, vat: 2450 });
    expect(await glBalance(t, "4080", "2026-11-01", "2026-11-30")).toBe(0);
    expect(await glBalance(t, "5130", "2026-11-01", "2026-11-30")).toBe(400);
    expect(await glBalance(t, "4010", "2026-11-01", "2026-11-30")).toBe(0);

    // A second debit note, then the buyer pays it: 2,000 is investing (proceeds), 100 operating.
    const dn2 = await debitNote();
    expect(dn2.status, dn2.text).toBe(201);
    expect(await register(van)).toMatchObject({ amount: 51000, vat: 2550 });
    const pay = await t.as.post(`${base(t)}/invoices/${dn2.body.id}/payments`, {
      amount: 2100,
      date: "2026-11-18",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const url = `${base(t)}/financial-statements/cash-flow?startDate=2026-11-18&endDate=2026-11-18`;
    for (const method of ["", "&method=direct"]) {
      const cf = await t.as.get(`${url}${method}`);
      expect(cf.status, cf.text).toBe(200);
      expect(cf.body.cashProof.isBalanced).toBe(true);
      expect(cf.body.investing.total).toBe(2000);
      expect(cf.body.operating.total).toBe(100);
    }
  });
});

describe("D2 N6 / N10: disposal dates", () => {
  it("[N6] a disposal dated before booked depreciation reverses it through the ledger and charges the month to the disposal date", async () => {
    const t = await tenant("D2N6");
    const bank = await accountByCode(t, "1020");
    const printer = await asset(t, {
      assetName: "Printer",
      category: "equipment",
      purchaseDate: "2026-01-01",
      purchaseCost: 12000,
    });
    const dep = await t.as.post(`/api/fixed-assets/${printer}/depreciate`, {
      month: 10,
      year: 2026,
    });
    expect(dep.status, dep.text).toBeLessThan(300);
    const [oct] = await h.sql<{ id: string }>(
      `SELECT journal_entry_id AS id FROM depreciation_schedules
        WHERE asset_id = $1 AND period_year = 2026 AND period_month = 10`,
      [printer]
    );
    expect(await linesOf(oct.id)).toEqual({ "1240": [0, 200], "5100": [200, 0] });

    const d = await t.as.post(`/api/fixed-assets/${printer}/dispose`, {
      disposalDate: "2026-10-15",
      disposalAmount: 8000,
      proceedsAccountId: bank.id,
      vatTreatment: "standard",
    });
    expect(d.status, d.text).toBe(200);
    // The October charge is reversed on its own date (31 Oct) through the ledger.
    expect(d.body.reversedDepreciation).toEqual([
      expect.objectContaining({ year: 2026, month: 10, amount: 200 }),
    ]);
    const [rev] = await h.sql<{ id: string; d: string; kind: string }>(
      `SELECT id, to_char(date, 'YYYY-MM-DD') AS d, entry_kind AS kind FROM journal_entries
        WHERE id = $1`,
      [d.body.reversedDepreciation[0].reversalEntryId]
    );
    expect(rev).toMatchObject({ d: "2026-10-31", kind: "reversal" });
    expect(await linesOf(rev.id)).toEqual({ "1240": [200, 0], "5100": [0, 200] });
    // Catch-up Jan-Sep (9 x 200) and October to the 15th: 200 x 15/31 = 96.77.
    expect(d.body.catchUpDepreciation).toHaveLength(10);
    expect(d.body.catchUpDepreciation[9]).toMatchObject({ year: 2026, month: 10, amount: 96.77 });
    const [octRedo] = await h.sql<{ id: string; d: string }>(
      `SELECT id, to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries
        WHERE company_id = $1 AND idempotency_key = $2`,
      [t.company.id, `fixed_asset:${printer}:dep:2026-10:to-2026-10-15`]
    );
    expect(octRedo.d).toBe("2026-10-15");
    expect(await linesOf(octRedo.id)).toEqual({ "1240": [0, 96.77], "5100": [96.77, 0] });
    // Carrying amount 12,000 - 1,896.77 = 10,103.23; proceeds 8,000; loss 2,103.23.
    expect(d.body).toMatchObject({ netBookValueAtDisposal: 10103.23, gainLoss: -2103.23 });
    expect(await linesOf(d.body.journalEntryId)).toEqual({
      "1020": [8400, 0],
      "1240": [1896.77, 0],
      "1210": [0, 12000],
      "2020": [0, 400],
      "5130": [2103.23, 0],
    });
    // October P&L carries 96.77 of depreciation; 1240 is cleared; the register is consistent.
    expect(await glBalance(t, "5100", "2026-10-01", "2026-10-31")).toBe(96.77);
    expect(await glBalance(t, "1240")).toBe(0);
    const sched = await h.sql<{ n: string; s: string }>(
      `SELECT COUNT(*)::text AS n, SUM(amount)::text AS s FROM depreciation_schedules
        WHERE asset_id = $1`,
      [printer]
    );
    expect(sched[0]).toMatchObject({ n: "10" });
    expect(Number(sched[0].s)).toBe(1896.77);
  });

  it("[N6] a locked period still refuses the disposal, and nothing changes", async () => {
    const t = await tenant("D2N6L");
    const bank = await accountByCode(t, "1020");
    const desk = await asset(t, {
      assetName: "Desk",
      category: "furniture",
      purchaseDate: "2026-01-01",
      purchaseCost: 6000,
    });
    for (const month of [8, 9, 10]) {
      const dep = await t.as.post(`/api/fixed-assets/${desk}/depreciate`, { month, year: 2026 });
      expect(dep.status, dep.text).toBeLessThan(300);
    }
    const lock = await t.as.post(`${base(t)}/month-end/lock-period`, {
      periodEnd: "2026-09-30",
      overrideChecklist: true,
      lockType: "hard",
      reason: "Q3 closed",
    });
    expect(lock.status, lock.text).toBe(200);
    const d = await t.as.post(`/api/fixed-assets/${desk}/dispose`, {
      disposalDate: "2026-09-20",
      disposalAmount: 1000,
      proceedsAccountId: bank.id,
      vatTreatment: "standard",
    });
    expect(d.status, d.text).toBeGreaterThanOrEqual(400);
    expect(await register(desk)).toMatchObject({ status: "active" });
    const n = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM depreciation_schedules WHERE asset_id = $1`,
      [desk]
    );
    expect(n[0].n).toBe("3");
  });

  it("[N10] a disposal dated after today is refused and posts nothing", async () => {
    const t = await tenant("D2N10");
    const bank = await accountByCode(t, "1020");
    const desk = await asset(t, {
      assetName: "Desk",
      category: "furniture",
      purchaseDate: "2026-02-01",
      purchaseCost: 3000,
    });
    const before = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE company_id = $1`,
      [t.company.id]
    );
    for (const onCredit of [false, true]) {
      const d = await t.as.post(`/api/fixed-assets/${desk}/dispose`, {
        disposalDate: "2026-11-19",
        disposalAmount: 1000,
        ...(onCredit ? { onCredit: true, buyerName: "Buyer" } : { proceedsAccountId: bank.id }),
        vatTreatment: "standard",
      });
      expect(d.status, d.text).toBe(422);
      expect(d.body.code).toBe("DISPOSAL_DATE_IN_FUTURE");
    }
    const after = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE company_id = $1`,
      [t.company.id]
    );
    expect(after[0].n).toBe(before[0].n);
    // Today is fine.
    const ok = await t.as.post(`/api/fixed-assets/${desk}/dispose`, {
      disposalDate: "2026-11-18",
      disposalAmount: 1000,
      proceedsAccountId: bank.id,
      vatTreatment: "standard",
    });
    expect(ok.status, ok.text).toBe(200);
  });
});

describe("D2 N8: the account master cannot strip control status", () => {
  it("[N8] code, type, sub-type and VAT flags of control / system accounts are locked (422); names are not", async () => {
    const t = await tenant("D2N8");
    const put = (id: string, body: Record<string, unknown>) =>
      t.as.put(`/api/accounts/${id}`, body);
    const inv = await accountByCode(t, "1070");
    const pay = await accountByCode(t, "2030");
    const ar = await accountByCode(t, "1040");
    const vat = await accountByCode(t, "2020");
    for (const [id, body] of [
      [inv.id, { code: "1079" }],
      [pay.id, { code: "2039" }],
      [ar.id, { subType: "bank" }],
      [vat.id, { isVatAccount: false, vatType: null }],
      [inv.id, { type: "expense" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const r = await put(id, body);
      expect(r.status, r.text).toBe(422);
      expect(r.body.code).toBe("CONTROL_ACCOUNT_LOCKED");
    }
    const codes = await h.sql<{ code: string; sub_type: string | null; is_vat: boolean }>(
      `SELECT code, sub_type, is_vat_account AS is_vat FROM accounts
        WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY code`,
      [t.company.id, [inv.id, pay.id, ar.id, vat.id]]
    );
    expect(codes.map((c) => c.code)).toEqual(["1040", "1070", "2020", "2030"]);
    expect(codes.find((c) => c.code === "2020")?.is_vat).toBe(true);
    expect(codes.find((c) => c.code === "1040")?.sub_type).not.toBe("bank");
    // Renaming, or sending the unchanged values back, is fine.
    const rename = await put(inv.id, { nameEn: "Stock on hand", code: "1070" });
    expect(rename.status, rename.text).toBe(200);

    // A sub-account of 1040 is a control account through its parent: its parent is locked.
    // WQ3 (C1 on the parent field): the API no longer creates one, so this is a legacy row.
    const create = await t.as.post(`${base(t)}/accounts`, {
      code: "1041",
      nameEn: "Receivables - branch",
      type: "asset",
      subType: "receivable",
      parentId: ar.id,
    });
    expect(create.status, create.text).toBe(422);
    expect(create.body.code).toBe("CONTROL_ACCOUNT_NOT_ALLOWED");
    const [legacy] = await h.sql<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name_en, type, sub_type, parent_id)
       VALUES ($1, '1041', 'Receivables - branch', 'asset', 'receivable', $2) RETURNING id`,
      [t.company.id, ar.id]
    );
    const sub = { body: { id: legacy.id } };
    const unparent = await put(sub.body.id, { parentId: null });
    expect(unparent.status, unparent.text).toBe(422);
    expect(unparent.body.code).toBe("CONTROL_ACCOUNT_LOCKED");

    // A plain account cannot be turned into an input / output VAT account.
    const plain = await t.as.post(`${base(t)}/accounts`, {
      code: "1999",
      nameEn: "Sundry asset",
      type: "asset",
    });
    expect(plain.status, plain.text).toBe(201);
    const toVat = await put(plain.body.id, { isVatAccount: true, vatType: "input" });
    expect(toVat.status, toVat.text).toBe(422);
    expect(toVat.body.code).toBe("CONTROL_ACCOUNT_ROLE_RESERVED");
    const ok = await put(plain.body.id, { subType: "other_current_asset" });
    expect(ok.status, ok.text).toBe(200);

    // A bank account never links to a control account, even one mislabelled "bank" (legacy).
    await h.sql(`UPDATE accounts SET sub_type = 'bank' WHERE id = $1`, [ar.id]);
    const link = await t.as.post(`${base(t)}/bank-accounts`, {
      nameEn: "Linked to AR",
      bankName: "ENBD",
      currency: "AED",
      glAccountId: ar.id,
    });
    expect(link.status, link.text).toBe(422);
    expect(link.body.code).toBe("GL_ACCOUNT_NOT_BANK");
  });
});

describe("D2 N9: the FX sanity band starts at the peg", () => {
  it("[N9] the first USD rate is checked against 3.6725; a revaluation outside the band needs a reason and a permitted role", async () => {
    const t = await tenant("D2N9");
    const rates = `${base(t)}/exchange-rates`;
    const typo = await t.as.post(rates, {
      fromCurrency: "USD",
      rate: 36.725,
      effectiveDate: "2026-11-10",
    });
    expect(typo.status, typo.text).toBe(409);
    expect(typo.body.code).toBe("RATE_CHANGE_UNCONFIRMED");
    expect(typo.body.details?.previousRate ?? typo.body.previousRate).toBeDefined();
    const right = await t.as.post(rates, {
      fromCurrency: "USD",
      rate: 3.69,
      effectiveDate: "2026-11-10",
    });
    expect(right.status, right.text).toBe(201);

    // A USD receivable at 3.69, then a confirmed (wrong) closing rate of 36.725.
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Export Customer LLC",
      placeOfSupplyEmirate: "dubai",
      date: "2026-11-11",
      currency: "USD",
      exchangeRate: 3.69,
      lines: [
        {
          description: "Export consulting",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    expect(sent.status, sent.text).toBe(200);
    const confirmed = await t.as.post(rates, {
      fromCurrency: "USD",
      rate: 36.725,
      effectiveDate: "2026-11-15",
      confirmLargeMove: true,
    });
    expect(confirmed.status, confirmed.text).toBe(201);

    const revalue = (as: Tenant["as"], body: Record<string, unknown> = {}) =>
      as.post(`${rates}/revalue`, { asOf: "2026-11-15", ...body });
    const refused = await revalue(t.as);
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("FX_RATE_OUTSIDE_BAND");
    const none = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries
        WHERE company_id = $1 AND source = 'fx_revaluation'`,
      [t.company.id]
    );
    expect(none[0].n).toBe("0");

    // A bookkeeper may post revaluations, but not override the band.
    const m = await h.createSecondTenant({ name: "D2N9Bookkeeper" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
      t.company.id,
      m.user.id,
      "bookkeeper",
    ]);
    const bk = await revalue(m.as, { rateOverrideReason: "Bank confirmed this rate" });
    expect(bk.status, bk.text).toBe(403);
    expect(bk.body.code).toBe("FX_RATE_OVERRIDE_ROLE_REQUIRED");

    const short = await revalue(t.as, { rateOverrideReason: "ok" });
    expect(short.status, short.text).toBe(422);
    const ok = await revalue(t.as, { rateOverrideReason: "Bank confirmed this rate" });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.rateOverride).toMatchObject({
      reason: "Bank confirmed this rate",
      rates: [expect.objectContaining({ currency: "USD", referenceRate: "3.6725" })],
    });
  });
});

async function vatActivity(t: Tenant) {
  const inv = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date: "2026-02-01",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Job", quantity: 1, unitPrice: 2000, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });
  expect(gen.status, gen.text).toBe(201);
  const ready = await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {});
  expect(ready.status, ready.text).toBe(200);
  return gen.body.id as string;
}

describe("D2 N11 / N13: VAT submit and settlement hygiene", () => {
  it("[N11] the submit refuses adjustmentAmount / adjustmentReason (no free Box 14 adjustment)", async () => {
    const t = await tenant("D2N11");
    const id = await vatActivity(t);
    const dead = await t.as.post(`/api/vat-returns/${id}/submit`, {
      adjustmentAmount: 50,
      adjustmentReason: "EmaraTax rounding",
    });
    expect(dead.status, dead.text).toBe(400);
    const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-N11",
      filedOn: "2026-04-25",
    });
    expect(filed.status, filed.text).toBe(200);
    expect(Number(filed.body.box14PayableTax)).toBe(100);
  });

  it("[N13] a filed return's payment cannot be dated before the filing date", async () => {
    const t = await tenant("D2N13");
    const bank = await accountByCode(t, "1020");
    const id = await vatActivity(t);
    const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-N13",
      filedOn: "2026-04-25",
    });
    expect(filed.status, filed.text).toBe(200);
    const url = `/api/vat-returns/${id}/settlement`;
    const early = await t.as.post(url, { date: "2026-04-10", paymentAccountId: bank.id });
    expect(early.status, early.text).toBe(422);
    expect(early.body.code).toBe("VAT_SETTLEMENT_BEFORE_FILING");
    expect((await t.as.get(url)).body.settlement).toBeNull();
    const onTheDay = await t.as.post(url, { date: "2026-04-25", paymentAccountId: bank.id });
    expect(onTheDay.status, onTheDay.text).toBe(201);
    expect(onTheDay.body.netPayable).toBe(100);
  });
});

describe("D2 N12: vendor default expense account", () => {
  it("[N12] a control account is refused at vendor save (create and update)", async () => {
    const t = await tenant("D2N12");
    const ar = await accountByCode(t, "1040");
    const rent = await accountByCode(t, "5020");
    const url = `${base(t)}/vendors`;
    const bad = await t.as.post(url, { name: "Landlord LLC", default_expense_account_id: ar.id });
    expect(bad.status, bad.text).toBe(422);
    expect(bad.body.code).toBe("CONTROL_ACCOUNT_NOT_ALLOWED");
    const ok = await t.as.post(url, { name: "Landlord LLC", default_expense_account_id: rent.id });
    expect(ok.status, ok.text).toBeLessThan(300);
    const upd = await t.as.patch(`${url}/${ok.body.id}`, { default_expense_account_id: ar.id });
    expect(upd.status, upd.text).toBe(422);
    expect(upd.body.code).toBe("CONTROL_ACCOUNT_NOT_ALLOWED");
  });
});
