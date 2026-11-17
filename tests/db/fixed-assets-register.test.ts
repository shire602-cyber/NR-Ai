/**
 * W4-B fixed assets: R10-04, R10-05, R10-06, R10-08, R10-11, R10-12, R10-17.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function createAsset(t: Tenant, over: Record<string, unknown> = {}) {
  return t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
    assetName: "Laptop",
    category: "Computer Equipment",
    purchaseDate: "2026-01-15",
    purchaseCost: 12000,
    usefulLifeYears: 5,
    ...over,
  });
}

async function capitalised(t: Tenant, over: Record<string, unknown> = {}) {
  const bank = await accountByCode(t, "1020");
  const r = await createAsset(t, { paymentAccountId: bank.id, ...over });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; capitalizationJournalEntryId: string };
}

async function bal(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0].n);
}

describe("W4-B fixed assets", () => {
  it("[R10-04] a land asset without a useful life is created (201) and never depreciated", async () => {
    const t = await h.createTenant();
    const bank = await accountByCode(t, "1020");
    const land = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
      assetName: "Land",
      category: "land",
      purchaseDate: "2026-01-01",
      purchaseCost: 100000,
      paymentAccountId: bank.id,
    });
    expect(land.status, land.text).toBe(201);
    expect(land.body.useful_life_years).toBeNull();
    expect(land.body.is_depreciable).toBe(false);
    expect(await bal(t, "1290")).toBe(10_000_000);
    const run = await t.as.post(`/api/companies/${t.company.id}/fixed-assets/run-depreciation`, {
      month: 3,
      year: 2026,
    });
    expect(run.status, run.text).toBe(200);
    expect(run.body.results[0]).toMatchObject({ skipped: true, code: "NON_DEPRECIABLE" });
    const single = await t.as.post(`/api/fixed-assets/${land.body.id}/depreciate`, {
      month: 3,
      year: 2026,
    });
    expect(single.status).toBe(400);
    expect(await bal(t, "1240")).toBe(0);
  });

  it("[R10-05] the bulk run uses the capitalisation guard: an asset that is not on the GL is skipped", async () => {
    const t = await h.createTenant();
    const on = await capitalised(t);
    const off = await createAsset(t, { assetName: "X" });
    expect(off.status, off.text).toBe(201);
    const run = await t.as.post(`/api/companies/${t.company.id}/fixed-assets/run-depreciation`, {
      month: 2,
      year: 2026,
    });
    expect(run.status, run.text).toBe(200);
    const byId = Object.fromEntries(
      run.body.results.map((r: { assetId: string }) => [r.assetId, r])
    );
    expect(byId[off.body.id]).toMatchObject({ skipped: true, code: "ASSET_NOT_CAPITALIZED" });
    expect(byId[on.id]).toMatchObject({ skipped: false, monthlyDepreciation: 200 });
    expect(await bal(t, "1240")).toBe(-20_000);
    // Capitalising later lets it depreciate.
    const bank = await accountByCode(t, "1020");
    const cap = await t.as.post(`/api/fixed-assets/${off.body.id}/capitalize`, {
      paymentAccountId: bank.id,
    });
    expect(cap.status, cap.text).toBe(200);
    const again = await t.as.post(`/api/fixed-assets/${off.body.id}/depreciate`, {
      month: 2,
      year: 2026,
    });
    expect(again.status, again.text).toBe(200);
  });

  it("[R10-06] an invalid depreciation method is 400 and writes nothing", async () => {
    const t = await h.createTenant();
    const r = await createAsset(t, { depreciationMethod: "bogus" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_ERROR");
    const rows = await h.sql(`SELECT 1 FROM fixed_assets WHERE company_id = $1`, [t.company.id]);
    expect(rows).toHaveLength(0);
  });

  it("[R10-12] straight line follows a fixed schedule: prorated January, then equal Feb-May amounts", async () => {
    const t = await h.createTenant();
    const a = await capitalised(t);
    const amounts: number[] = [];
    for (const month of [1, 2, 3, 4, 5]) {
      const r = await t.as.post(`/api/fixed-assets/${a.id}/depreciate`, { month, year: 2026 });
      expect(r.status, r.text).toBe(200);
      amounts.push(r.body.monthlyDepreciation);
    }
    expect(amounts[0]).toBe(109.68);
    expect(amounts.slice(1)).toEqual([200, 200, 200, 200]);
    const dup = await t.as.post(`/api/fixed-assets/${a.id}/depreciate`, { month: 2, year: 2026 });
    expect(dup.status).toBe(409);
  });

  it("[R10-08] disposal to a bank account posts 5% output VAT and a balanced gain/loss entry", async () => {
    // A1 (M9): a standard-rated disposal is reported in the company emirate's Box 1 row.
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: "100000000000003", emirate: "dubai" },
    });
    const a = await capitalised(t);
    const bank = await accountByCode(t, "1020");
    const d = await t.as.post(`/api/fixed-assets/${a.id}/dispose`, {
      disposalDate: "2026-04-10",
      disposalAmount: 9000,
      proceedsAccountId: bank.id,
      buyerName: "Second Hand LLC",
    });
    expect(d.status, d.text).toBe(200);
    // Catch-up Jan (109.68) + Feb + Mar (200 each) = 509.68 → NBV 11,490.32, loss 2,490.32.
    expect(d.body.vatAmount).toBe(450);
    expect(d.body.netBookValueAtDisposal).toBe(11490.32);
    expect(d.body.gainLoss).toBe(-2490.32);
    const lines = await h.sql<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, jl.debit::text AS debit, jl.credit::text AS credit
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1 ORDER BY a.code`,
      [d.body.journalEntryId]
    );
    const by = Object.fromEntries(lines.map((l) => [l.code, Number(l.debit) - Number(l.credit)]));
    expect(by["1020"]).toBe(9450);
    expect(by["2020"]).toBe(-450);
    expect(by["1240"]).toBe(509.68);
    expect(by["5130"]).toBe(2490.32);
    expect(by["1290"]).toBe(-12000);
    const sum = lines.reduce(
      (s, l) => s + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100),
      0
    );
    expect(sum).toBe(0);
    // Sold on credit to a named buyer → A/R; exempt treatment → no VAT.
    const b = await capitalised(t, { assetName: "Printer", purchaseCost: 1000 });
    const d2 = await t.as.post(`/api/fixed-assets/${b.id}/dispose`, {
      disposalDate: "2026-01-20",
      disposalAmount: 1200,
      onCredit: true,
      buyerName: "Buyer Co",
      vatTreatment: "exempt",
    });
    expect(d2.status, d2.text).toBe(200);
    expect(d2.body).toMatchObject({ vatAmount: 0, gainLoss: 200, gainLossType: "gain" });
    expect(await bal(t, "1040")).toBe(120_000);
    const noBuyer = await t.as.post(`/api/fixed-assets/${a.id}/dispose`, {
      disposalDate: "2026-04-10",
      onCredit: true,
    });
    expect(noBuyer.status).toBe(400);
  });

  it("[R10-11] depreciation of an asset tagged with a cost centre carries the cost centre on the expense line", async () => {
    const t = await h.createTenant();
    const cc = await h.sql<{ id: string }>(
      `INSERT INTO cost_centers (company_id, code, name) VALUES ($1, 'OPS', 'Operations') RETURNING id`,
      [t.company.id]
    );
    const a = await capitalised(t, { costCenterId: cc[0].id });
    const r = await t.as.post(`/api/fixed-assets/${a.id}/depreciate`, { month: 2, year: 2026 });
    expect(r.status, r.text).toBe(200);
    const line = await h.sql<{ cost_center_id: string }>(
      `SELECT jl.cost_center_id FROM journal_lines jl JOIN accounts ac ON ac.id = jl.account_id
        WHERE jl.entry_id = $1 AND ac.code = '5100'`,
      [r.body.journalEntryId]
    );
    expect(line[0].cost_center_id).toBe(cc[0].id);
  });

  it("[R10-17] classes default the accounts and life; revaluation, impairment, audit trail, CSV import and register export", async () => {
    const t = await h.createTenant();
    const vehicles = await h.sql<{ id: string }>(
      // L2 (A4): 1250 Motor Vehicles is in the default chart now.
      `SELECT id FROM accounts WHERE company_id = $1 AND code = '1250'`,
      [t.company.id]
    );
    const cls = await t.as.post(`/api/companies/${t.company.id}/fixed-asset-classes`, {
      code: "VEH",
      name: "Vehicles",
      nameAr: "مركبات",
      usefulLifeYears: 4,
      costAccountId: vehicles[0].id,
      taxUsefulLifeYears: 5,
    });
    expect(cls.status, cls.text).toBe(201);
    const bank = await accountByCode(t, "1020");
    const truck = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
      assetName: "Truck",
      category: "Vehicles",
      assetClassId: cls.body.id,
      purchaseDate: "2026-01-01",
      purchaseCost: 48000,
      paymentAccountId: bank.id,
    });
    expect(truck.status, truck.text).toBe(201);
    expect(truck.body.useful_life_years).toBe(4);
    expect(await bal(t, "1250")).toBe(4_800_000);
    expect(await bal(t, "1290")).toBe(0);
    const dep = await t.as.post(`/api/fixed-assets/${truck.body.id}/depreciate`, {
      month: 1,
      year: 2026,
    });
    expect(dep.body.monthlyDepreciation).toBe(1000);
    const rev = await t.as.post(`/api/fixed-assets/${truck.body.id}/revalue`, {
      date: "2026-02-01",
      fairValue: 50000,
    });
    expect(rev.status, rev.text).toBe(201);
    expect(await bal(t, "3050")).toBe(-300_000);
    const imp = await t.as.post(`/api/fixed-assets/${truck.body.id}/impair`, {
      date: "2026-02-02",
      amount: 2000,
    });
    expect(imp.status, imp.text).toBe(201);
    // A3 (H4): the asset holds a 3,000 surplus, so the 2,000 impairment is a revaluation decrease
    // charged to the surplus (IAS 36.60-61), not to profit or loss (5150 was 2,000 before).
    expect(await bal(t, "5150")).toBe(0);
    expect(await bal(t, "3050")).toBe(-100_000);
    const events = await t.as.get(`/api/fixed-assets/${truck.body.id}/events`);
    expect(events.body.map((e: { event_type: string }) => e.event_type)).toEqual([
      "capitalized",
      "created",
      "depreciated",
      "revalued",
      "impaired",
    ]);
    const reg = await t.as.get(
      `/api/companies/${t.company.id}/fixed-assets/register?asOf=2026-01-31`
    );
    expect(reg.status).toBe(200);
    const row = reg.body.rows.find((r: { id: string }) => r.id === truck.body.id);
    expect(row.taxAccumulatedDepreciation).toBe(800);
    // B2: the book columns are as at asOf (31 Jan), before the 1 Feb revaluation eliminated
    // January's 1,000 against the gross amount (IAS 16.35(b)); they used to show the current state.
    expect(row.bookAccumulatedDepreciation).toBe(1000);
    expect(row.grossCarryingAmount).toBe(48000);
    const now = await t.as.get(
      `/api/companies/${t.company.id}/fixed-assets/register?asOf=2026-02-28`
    );
    const feb = now.body.rows.find((r: { id: string }) => r.id === truck.body.id);
    expect(feb.bookAccumulatedDepreciation).toBe(0);
    expect(feb.grossCarryingAmount).toBe(50000);
    const xlsx = await t.as.get(`/api/companies/${t.company.id}/fixed-assets/register?format=xlsx`);
    expect(xlsx.status).toBe(200);
    expect(String(xlsx.headers.get("content-type"))).toContain("spreadsheetml");
    // CSV import: one bad row rejects the batch with row-level errors; a clean file imports.
    const bad = await t.as.post(`/api/companies/${t.company.id}/fixed-assets/import`, {
      csv: "assetName,category,purchaseDate,purchaseCost,usefulLifeYears,depreciationMethod\nDesk,Furniture,2026-01-05,800,5,straight_line\nChair,Furniture,2026-13-01,100,5,bogus\n",
    });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 3]);
    const good = await t.as.post(`/api/companies/${t.company.id}/fixed-assets/import`, {
      csv: "assetName,category,purchaseDate,purchaseCost,usefulLifeYears,accumulatedDepreciation\nDesk,Furniture,2026-01-05,800,5,100\n",
      openingBalance: true,
    });
    expect(good.status, good.text).toBe(201);
    expect(good.body.created).toHaveLength(1);
    expect(await bal(t, "3040")).toBe(-70_000);
  });
});
