/**
 * E3 launch fixes (J3-r3 lows):
 *  - The compliance calendar listed "Pay Dec 2025 ... Aug 2026 salaries through WPS" as overdue
 *    for a company whose books started in Nov 2025 but whose payroll started in Sep 2026. WPS
 *    obligations now start with the payroll (first run, else the first employee added).
 *  - Capitalising an existing asset from its row had no input-VAT field; the capitalise route
 *    takes the input VAT paid with it (Dr 1050 when VAT registered).
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness } from "./harness";

const h = useHarness();

describe("E3 (J3-r3) WPS obligations start with the payroll", () => {
  it("no WPS month before the first employee was added, even with older books", async () => {
    const t = await h.createTenant({
      name: "WpsStart",
      companyColumns: { created_at: "2025-11-01T00:00:00Z" },
    });
    await h.sql(
      `INSERT INTO employees (company_id, full_name, join_date, status, created_at)
       VALUES ($1, 'Raj', '2020-01-01', 'active', '2026-09-05T08:00:00Z')`,
      [t.company.id]
    );
    const { buildObligationSpecs } =
      await import("../../server/services/compliance-obligations.service");
    const wps = [
      ...(await buildObligationSpecs(t.company.id, 2025)),
      ...(await buildObligationSpecs(t.company.id, 2026)),
    ].filter((s) => s.type === "wps_payroll");
    const months = wps.map((s) => String(s.periodEnd).slice(0, 7));
    expect(months.length).toBeGreaterThan(0);
    expect(
      months.every((m) => m >= "2026-09"),
      months.join(",")
    ).toBe(true);
    expect(months).toContain("2026-09");
  });
});

describe("E3 (J3-r3) capitalise an existing asset with its input VAT", () => {
  it("posts Dr cost 60,000 / Dr 1050 3,000 / Cr bank 63,000", async () => {
    const t = await h.createTenant({ name: "CapVat" });
    const bank = await accountByCode(t, "1020");
    const asset = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
      assetName: "Forklift",
      category: "vehicles",
      purchaseDate: "2026-09-01",
      purchaseCost: 60000,
      salvageValue: 0,
      usefulLifeYears: 5,
      depreciationMethod: "straight_line",
    });
    expect(asset.status, asset.text).toBe(201);
    expect(asset.body.capitalizationJournalEntryId ?? null).toBeNull();
    const cap = await t.as.post(`/api/fixed-assets/${asset.body.id}/capitalize`, {
      paymentAccountId: bank.id,
      inputVat: 3000,
    });
    expect(cap.status, cap.text).toBe(200);
    const rows = await h.sql<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, jl.debit::text AS debit, jl.credit::text AS credit
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1 ORDER BY a.code`,
      [cap.body.capitalizationJournalEntryId]
    );
    const by = (code: string) => rows.find((r) => r.code === code);
    expect(Number(by("1050")?.debit)).toBe(3000);
    expect(Number(by(bank.code)?.credit)).toBe(63000);
    const cost = rows.find((r) => Number(r.debit) > 0 && r.code !== "1050")!;
    expect(Number(cost.debit)).toBe(60000);

    const noAccount = await t.as.post(`/api/fixed-assets/${asset.body.id}/capitalize`, {
      openingBalance: true,
      inputVat: 10,
    });
    expect(noAccount.status).toBe(400);
  });
});
