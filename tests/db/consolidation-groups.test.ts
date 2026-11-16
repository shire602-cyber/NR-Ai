/**
 * W5-C management consolidation: company groups, intercompany eliminations, NCI, FX translation
 * with CTA, member-level access. Issue ids: R14-18, R12-12.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();
const FROM = "2026-01-01";
const TO = "2026-10-31";

async function ownerOf(member: Tenant, company: Tenant, role = "owner") {
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    company.company.id,
    member.user.id,
    role,
  ]);
}

async function addAccount(t: Tenant, code: string, name: string, type: string): Promise<string> {
  const rows = await h.sql<{ id: string }>(
    `INSERT INTO accounts (company_id, code, name_en, type, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [t.company.id, code, name, type]
  );
  return rows[0].id;
}

async function createGroup(t: Tenant, body: Record<string, unknown> = {}) {
  const r = await t.as.post(`/api/companies/${t.company.id}/company-groups`, {
    name: "Harness Group",
    ...body,
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; reportingCurrency: string };
}

async function addMember(owner: Tenant, groupId: string, company: Tenant, pct = 100) {
  const r = await owner.as.post(`/api/company-groups/${groupId}/members`, {
    memberCompanyId: company.company.id,
    ownershipPercent: pct,
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

const statements = (t: Tenant, groupId: string) =>
  t.as.get(`/api/company-groups/${groupId}/consolidated-statements?from=${FROM}&to=${TO}`);

/** Parent P and subsidiary S (both AED) with a 10,000 intercompany sale. */
async function seedAedPair() {
  const p = await h.createTenant({ name: "Parent" });
  const s = await h.createSecondTenant({ name: "Sub" });
  await ownerOf(p, s);
  const pDue = await addAccount(p, "1095", "Due from group companies", "asset");
  const pIcRev = await addAccount(p, "4095", "Intercompany revenue", "income");
  const sDue = await addAccount(s, "2095", "Due to group companies", "liability");
  const sIcExp = await addAccount(s, "5095", "Intercompany expenses", "expense");
  await postJournalEntry(p, {
    date: "2026-01-05",
    lines: [
      { code: "1020", debit: 50_000 },
      { code: "3010", credit: 50_000 },
    ],
  });
  await postJournalEntry(p, {
    date: "2026-03-10",
    lines: [
      { accountId: pDue, debit: 10_000 },
      { accountId: pIcRev, credit: 10_000 },
    ],
  });
  await postJournalEntry(p, {
    date: "2026-04-10",
    lines: [
      { code: "1020", debit: 5_000 },
      { code: "4010", credit: 5_000 },
    ],
  });
  await postJournalEntry(s, {
    date: "2026-01-05",
    lines: [
      { code: "1020", debit: 20_000 },
      { code: "3010", credit: 20_000 },
    ],
  });
  await postJournalEntry(s, {
    date: "2026-03-10",
    lines: [
      { accountId: sIcExp, debit: 10_000 },
      { accountId: sDue, credit: 10_000 },
    ],
  });
  await postJournalEntry(s, {
    date: "2026-05-10",
    lines: [
      { code: "1020", debit: 3_000 },
      { code: "4010", credit: 3_000 },
    ],
  });
  return { p, s, pDue, pIcRev, sDue, sIcExp };
}

const lineTotal = (block: { lines: Array<{ accountCode: string; total: number }> }, code: string) =>
  block.lines.find((l) => l.accountCode === code)?.total ?? 0;

describe("R14-18 / R12-12 company groups and eliminations", () => {
  it("R14-18 R12-12: an intercompany sale of 10,000 and its receivable/payable are eliminated; consolidated revenue and balances exclude it", async () => {
    const { p, s, pDue, pIcRev, sDue, sIcExp } = await seedAedPair();
    const g = await createGroup(p);
    expect(g.reportingCurrency).toBe("AED");
    await addMember(p, g.id, s);

    // Before the intercompany maps: a plain roll-up still counts the sale twice over.
    const before = await statements(p, g.id);
    expect(before.status, before.text).toBe(200);
    expect(before.body.basis).toBe("management_consolidation");
    expect(before.body.label.en).toMatch(/not a statutory consolidation/i);
    expect(before.body.corporateTaxNote.en).toMatch(/per entity/i);
    expect(before.body.consolidated.profitAndLoss.revenue).toBe(18_000);

    for (const body of [
      {
        kind: "receivable_payable",
        companyAId: p.company.id,
        accountAId: pDue,
        companyBId: s.company.id,
        accountBId: sDue,
      },
      {
        kind: "revenue_expense",
        companyAId: p.company.id,
        accountAId: pIcRev,
        companyBId: s.company.id,
        accountBId: sIcExp,
      },
    ]) {
      const m = await p.as.post(`/api/company-groups/${g.id}/intercompany-maps`, body);
      expect(m.status, m.text).toBe(201);
    }
    // A map with the wrong account types is rejected with a code.
    const bad = await p.as.post(`/api/company-groups/${g.id}/intercompany-maps`, {
      kind: "receivable_payable",
      companyAId: p.company.id,
      accountAId: pIcRev,
      companyBId: s.company.id,
      accountBId: sDue,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("MAP_ACCOUNT_TYPE");

    const r = await statements(p, g.id);
    expect(r.status, r.text).toBe(200);
    const pl = r.body.consolidated.profitAndLoss;
    const bs = r.body.consolidated.balanceSheet;
    expect(pl.revenue).toBe(8_000);
    expect(lineTotal(pl.sections.revenue, "4095")).toBe(0);
    expect(lineTotal(pl.sections.operatingExpenses, "5095")).toBe(0);
    expect(pl.totalExpenses).toBe(0);
    expect(pl.netProfit).toBe(8_000);
    expect(lineTotal(bs.assets.current, "1095")).toBe(0);
    expect(lineTotal(bs.liabilities.current, "2095")).toBe(0);
    expect(bs.totalAssets).toBe(78_000); // 55,000 + 23,000 bank
    expect(bs.totalLiabilities).toBe(0);
    expect(bs.equity.capital.total).toBe(70_000);
    expect(bs.equity.currentYearEarnings).toBe(8_000);
    expect(bs.isBalanced).toBe(true);
    const rules = r.body.eliminations.filter((e: any) => e.kind === "rule");
    expect(rules).toHaveLength(2);
    for (const e of rules) {
      expect(e.matched).toBe(10_000);
      expect(e.unmatchedDifference).toBe(0);
    }
    // Eliminations never touch an entity ledger.
    const je = await h.sql(
      `SELECT 1 FROM journal_entries WHERE company_id IN ($1, $2) AND source ILIKE '%elimin%'`,
      [p.company.id, s.company.id]
    );
    expect(je).toHaveLength(0);

    // An unmatched difference is reported, not hidden: S books only 9,500 of the payable.
    await postJournalEntry(s, {
      date: "2026-06-01",
      lines: [
        { accountId: sDue, debit: 500 },
        { code: "1020", credit: 500 },
      ],
    });
    const diff = await statements(p, g.id);
    const bal = diff.body.eliminations.find((e: any) => e.mapKind === "receivable_payable");
    expect(bal.amountA).toBe(10_000);
    expect(bal.amountB).toBe(9_500);
    expect(bal.matched).toBe(9_500);
    expect(bal.unmatchedDifference).toBe(500);
    expect(lineTotal(diff.body.consolidated.balanceSheet.assets.current, "1095")).toBe(500);
    expect(diff.body.warnings.join(" ")).toMatch(/unmatched difference of 500/);
    expect(diff.body.consolidated.balanceSheet.isBalanced).toBe(true);

    // Manual elimination journal (group level), balanced or 422.
    const unbalanced = await p.as.post(`/api/company-groups/${g.id}/eliminations`, {
      date: "2026-10-31",
      memo: "Bad",
      lines: [
        { memberCompanyId: p.company.id, accountId: pDue, credit: 500 },
        { memberCompanyId: s.company.id, accountId: sDue, debit: 400 },
      ],
    });
    expect(unbalanced.status).toBe(422);
    expect(unbalanced.body.code).toBe("ELIMINATION_UNBALANCED");
    const manual = await p.as.post(`/api/company-groups/${g.id}/eliminations`, {
      date: "2026-10-31",
      memo: "Cash in transit",
      lines: [
        { memberCompanyId: p.company.id, accountId: pDue, credit: 500 },
        {
          memberCompanyId: s.company.id,
          accountId: (await accountByCode(s, "1020")).id,
          debit: 500,
        },
      ],
    });
    expect(manual.status, manual.text).toBe(201);
    const after = await statements(p, g.id);
    expect(lineTotal(after.body.consolidated.balanceSheet.assets.current, "1095")).toBe(0);
    expect(after.body.eliminations.some((e: any) => e.kind === "manual")).toBe(true);
    expect(after.body.consolidated.balanceSheet.isBalanced).toBe(true);

    // Audit trail: a recorded run stores the snapshot and the rule journals (group level).
    const run = await p.as.post(`/api/company-groups/${g.id}/consolidation-runs`, {
      from: FROM,
      to: TO,
    });
    expect(run.status, run.text).toBe(201);
    const runs = await h.sql(`SELECT snapshot FROM consolidation_runs WHERE group_id = $1`, [g.id]);
    expect(runs).toHaveLength(1);
    expect(runs[0].snapshot.entities).toHaveLength(2);
    const ruleJournals = await h.sql(
      `SELECT 1 FROM elimination_journals WHERE group_id = $1 AND kind = 'rule' AND run_id = $2`,
      [g.id, run.body.id]
    );
    expect(ruleJournals).toHaveLength(2);
    // Recording the run must not double count: statements are unchanged.
    const again = await statements(p, g.id);
    expect(again.body.consolidated.balanceSheet.totalAssets).toBe(
      after.body.consolidated.balanceSheet.totalAssets
    );

    // xlsx export of the same contract.
    const x = await p.as.get(
      `/api/company-groups/${g.id}/consolidated-statements/export?from=${FROM}&to=${TO}`
    );
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toMatch(/spreadsheetml/);
  });

  it("R14-18: an 80%-owned subsidiary shows the non-controlling interest in equity and profit", async () => {
    const { p, s } = await seedAedPair();
    const g = await createGroup(p);
    await addMember(p, g.id, s, 80);
    const r = await statements(p, g.id);
    expect(r.status, r.text).toBe(200);
    // S net assets = 23,000 bank − 10,000 payable = 13,000; S profit = 3,000 − 10,000 = −7,000.
    expect(r.body.nci.byEntity).toEqual([
      expect.objectContaining({
        companyId: s.company.id,
        ownershipPercent: 80,
        nciPercent: 20,
        netAssets: 13_000,
        nciEquity: 2_600,
        netProfit: -7_000,
        nciProfit: -1_400,
      }),
    ]);
    const bs = r.body.consolidated.balanceSheet;
    expect(bs.equity.nonControllingInterest).toBe(2_600);
    expect(bs.equity.attributableToOwners).toBe(bs.totalEquity - 2_600);
    const pl = r.body.consolidated.profitAndLoss;
    expect(pl.attributableToNci).toBe(-1_400);
    expect(pl.attributableToOwners).toBe(pl.netProfit + 1_400);
    expect(bs.isBalanced).toBe(true);
  });

  it("R14-18: a USD member is translated at closing / average / historical rates and the CTA balances the group balance sheet", async () => {
    const p = await h.createTenant({ name: "AedParent" });
    const u = await h.createSecondTenant({
      name: "UsdSub",
      companyColumns: { base_currency: "USD" },
    });
    await ownerOf(p, u);
    for (const rate of [
      { rate: 3.65, effectiveDate: "2026-01-05", rateType: "spot" },
      { rate: 3.7, effectiveDate: "2026-10-31", rateType: "closing" },
      { rate: 3.68, effectiveDate: "2026-10-31", rateType: "average" },
    ]) {
      const w = await p.as.post(`/api/companies/${p.company.id}/exchange-rates`, {
        fromCurrency: "USD",
        toCurrency: "AED",
        ...rate,
      });
      expect(w.status, w.text).toBe(201);
    }
    await postJournalEntry(u, {
      date: "2026-01-05",
      lines: [
        { code: "1020", debit: 10_000 },
        { code: "3010", credit: 10_000 },
      ],
    });
    await postJournalEntry(u, {
      date: "2026-06-01",
      lines: [
        { code: "1020", debit: 2_000 },
        { code: "4010", credit: 2_000 },
      ],
    });
    await postJournalEntry(u, {
      date: "2026-06-02",
      lines: [
        { code: "5010", debit: 500 },
        { code: "1020", credit: 500 },
      ],
    });
    const g = await createGroup(p, { name: "FX Group" });
    await addMember(p, g.id, u);
    const r = await statements(p, g.id);
    expect(r.status, r.text).toBe(200);
    const ent = r.body.entities.find((e: any) => e.companyId === u.company.id);
    expect(ent.functionalCurrency).toBe("USD");
    expect(ent.snapshot.currency).toBe("USD");
    expect(ent.snapshot.balanceSheet.totalAssets).toBe(11_500);
    // Hand calculation: assets 11,500 × 3.70 = 42,550; capital 10,000 × 3.65 = 36,500;
    // profit 1,500 × 3.68 = 5,520; CTA = 42,550 − 36,500 − 5,520 = 530.
    expect(ent.translated).toMatchObject({
      totalAssets: 42_550,
      capital: 36_500,
      netProfit: 5_520,
      cta: 530,
    });
    const rates = r.body.translation.rates.find((x: any) => x.companyId === u.company.id);
    expect(rates.closing).toMatchObject({ rate: "3.700000", rateType: "closing" });
    expect(rates.average).toMatchObject({ rate: "3.680000", rateType: "average" });
    expect(rates.historical).toEqual([
      expect.objectContaining({ date: "2026-01-05", rate: "3.650000" }),
    ]);
    expect(r.body.translation.cta.total).toBe(530);
    const bs = r.body.consolidated.balanceSheet;
    expect(bs.equity.cumulativeTranslationAdjustment).toBe(530);
    expect(bs.isBalanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
    expect(r.body.consolidated.profitAndLoss.revenue).toBe(7_360);
    expect(r.body.consolidated.profitAndLoss.totalExpenses).toBe(1_840);

    // A reporting-currency change with no rate on file is a 422 with a code, not a silent sum.
    const eur = await p.as.patch(`/api/company-groups/${g.id}`, { reportingCurrency: "EUR" });
    expect(eur.status, eur.text).toBe(200);
    const missing = await statements(p, g.id);
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe("CONSOLIDATION_RATE_MISSING");
  });

  it("R14-18: a user without access to one member gets 403; outsiders get 404; adding a company needs its settings permission", async () => {
    const { p, s } = await seedAedPair();
    const g = await createGroup(p);
    await addMember(p, g.id, s);
    const partial = await h.createTenant({ name: "Partial" });
    await ownerOf(partial, p, "accountant");
    const denied = await statements(partial, g.id);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("GROUP_MEMBER_ACCESS_DENIED");
    expect(JSON.stringify(denied.body)).not.toContain(s.company.name);
    expect((await partial.as.get(`/api/company-groups/${g.id}`)).status).toBe(403);
    const list = await partial.as.get(`/api/company-groups`);
    expect(list.body.map((x: any) => x.id)).not.toContain(g.id);

    const outsider = await h.createTenant({ name: "Outsider" });
    expect((await statements(outsider, g.id)).status).toBe(404);
    expect(
      (
        await outsider.as.post(`/api/company-groups/${g.id}/members`, {
          memberCompanyId: outsider.company.id,
        })
      ).status
    ).toBe(404);

    // P's owner cannot pull a company it has no settings permission on into the group.
    const stranger = await h.createTenant({ name: "Stranger" });
    const add = await p.as.post(`/api/company-groups/${g.id}/members`, {
      memberCompanyId: stranger.company.id,
    });
    expect(add.status).toBe(403);
    expect(add.body.code).toBe("MEMBER_ACCESS_DENIED");

    // A viewer of every member can read but not manage.
    const viewer = await h.createTenant({ name: "Viewer" });
    await ownerOf(viewer, p, "viewer");
    await ownerOf(viewer, s, "viewer");
    expect((await statements(viewer, g.id)).status).toBe(200);
    const rename = await viewer.as.patch(`/api/company-groups/${g.id}`, { name: "x" });
    expect(rename.status).toBe(403);
    // Unknown fields are a 400 (strictBody), e.g. trying to move the group to another parent.
    const inject = await p.as.patch(`/api/company-groups/${g.id}`, {
      parentCompanyId: outsider.company.id,
    });
    expect(inject.status).toBe(400);
  });
});
