/**
 * W4-A corporate tax engine and return lifecycle on the report-08 books:
 * revenue 1,000,000, rent 300,000, entertainment 100,000 (all 2025) —
 * accounting profit 600,000, tax 20,250.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function tenantWithBooks(name: string): Promise<Tenant> {
  const t = await h.createTenant({ name });
  await postJournalEntry(t, {
    date: "2025-06-15",
    description: "Services",
    lines: [
      { code: "1040", debit: 1_000_000 },
      { code: "4020", credit: 1_000_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2025-07-10",
    description: "Rent",
    lines: [
      { code: "5010", debit: 300_000 },
      { code: "1020", credit: 300_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2025-08-20",
    description: "Travel and meals",
    lines: [
      { code: "5090", debit: 100_000 },
      { code: "1020", credit: 100_000 },
    ],
  });
  return t;
}

async function addMember(t: Tenant, role: string, name: string): Promise<Tenant> {
  const m = await h.createSecondTenant({ name });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    t.company.id,
    m.user.id,
    role,
  ]);
  return m;
}

const FY2025 = { taxPeriodStart: "2025-01-01", taxPeriodEnd: "2025-12-31" };

async function createReturn(t: Tenant, body: Record<string, unknown> = FY2025) {
  const r = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/returns`, body);
  expect(r.status, r.text).toBe(201);
  return r.body;
}

describe("W4-A corporate tax: create validation and computation (R08-09)", () => {
  it("[R08-09] rejects end < start, negative revenue and a client-set rate; creation computes the liability", async () => {
    const t = await tenantWithBooks("CtCreate");
    const url = `/api/companies/${t.company.id}/corporate-tax/returns`;
    const backwards = await t.as.post(url, {
      taxPeriodStart: "2025-12-31",
      taxPeriodEnd: "2025-01-01",
    });
    expect(backwards.status).toBe(400);
    const negative = await t.as.post(url, { ...FY2025, totalRevenue: -5 });
    expect(negative.status).toBe(400);
    const rate = await t.as.post(url, { ...FY2025, taxRate: 5 });
    expect(rate.status).toBe(400);
    const status = await t.as.post(url, { ...FY2025, status: "filed" });
    expect(status.status).toBe(400);
    const tooLong = await t.as.post(url, {
      taxPeriodStart: "2024-01-01",
      taxPeriodEnd: "2025-12-31",
    });
    expect(tooLong.status).toBe(400);

    // No figures supplied: pulled from the books and computed on creation.
    const created = await createReturn(t);
    expect(created.status).toBe("draft");
    expect(created.totalRevenue).toBe(1_000_000);
    expect(created.totalExpenses).toBe(400_000);
    expect(created.taxableIncome).toBe(600_000);
    expect(created.taxPayable).toBe(20_250);
    expect(Number(created.taxRate)).toBe(0.09);
    expect(created.filingDeadline).toBe("2026-09-30");

    const overlap = await t.as.post(url, {
      taxPeriodStart: "2025-06-01",
      taxPeriodEnd: "2026-05-31",
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe("CT_RETURN_PERIOD_OVERLAP");
  });
});

describe("W4-A corporate tax: adjustments (R08-06, R08-07, R08-08, R08-18)", () => {
  it("[R08-06] unknown category or non-numeric / negative amount is a 400", async () => {
    const t = await tenantWithBooks("CtAdj");
    const ret = await createReturn(t);
    const url = `/api/corporate-tax/returns/${ret.id}/compute`;
    const bogus = await t.as.post(url, {
      adjustments: [{ id: "a1", category: "bogus", amount: 5000 }],
    });
    expect(bogus.status).toBe(400);
    const abc = await t.as.post(url, {
      adjustments: [{ id: "a1", category: "fines_penalties", amount: "abc" }],
    });
    expect(abc.status).toBe(400);
    const negative = await t.as.post(url, {
      adjustments: [{ id: "a1", category: "fines_penalties", amount: -5000 }],
    });
    expect(negative.status).toBe(400);
    const direction = await t.as.post(url, {
      adjustments: [{ id: "a1", category: "fines_penalties", amount: 5000, direction: "deduct" }],
    });
    expect(direction.status).toBe(400);
    const after = await t.as.get(`/api/corporate-tax/returns/${ret.id}`);
    expect(after.body.taxableIncome).toBe(600_000);
  });

  it("[R08-07] entertainment 100,000 adds back 50,000", async () => {
    const t = await tenantWithBooks("CtEnt");
    const ret = await createReturn(t);
    const r = await t.as.post(`/api/corporate-tax/returns/${ret.id}/compute`, {
      adjustments: [{ id: "e1", category: "entertainment_50", amount: 100_000 }],
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.computation.totalAddBacks).toBe(50_000);
    expect(r.body.return.taxableIncome).toBe(650_000);
    expect(r.body.return.status).toBe("computed");
  });

  it("[R08-08] pull-from-books keeps a 100,000 add-back and recomputes the full liability", async () => {
    const t = await tenantWithBooks("CtPull");
    const ret = await createReturn(t);
    const computed = await t.as.post(`/api/corporate-tax/returns/${ret.id}/compute`, {
      adjustments: [{ id: "x1", category: "other_addback", amount: 100_000, notes: "support" }],
      smallBusinessReliefElected: false,
    });
    expect(computed.body.return.taxableIncome).toBe(700_000);
    const pulled = await t.as.post(`/api/corporate-tax/returns/${ret.id}/pull-from-books`, {});
    expect(pulled.status, pulled.text).toBe(200);
    expect(pulled.body.taxableIncome).toBe(700_000);
    expect(pulled.body.taxPayable).toBe(29_250);
    expect(pulled.body.workpaper.adjustments).toHaveLength(1);
    expect(pulled.body.workpaper.adjustments[0]).toMatchObject({ id: "x1", amount: 100_000 });
    expect(pulled.body.workpaper.computation.taxPayable).toBe(29_250);
    expect(pulled.body.workpaper.rows.length).toBeGreaterThan(0);
  });

  it("[R08-18] tagged accounts drive account-based add-backs (entertainment 50%, fines 100%)", async () => {
    const t = await tenantWithBooks("CtTags");
    const ensured = await t.as.post(
      `/api/companies/${t.company.id}/corporate-tax/account-tags/ensure`,
      {}
    );
    expect(ensured.status, ensured.text).toBe(200);
    const tags = new Map(ensured.body.map((a: { taxTag: string; id: string }) => [a.taxTag, a.id]));
    expect(tags.has("entertainment")).toBe(true);
    expect(tags.has("corporate_tax_expense")).toBe(true);
    await postJournalEntry(t, {
      date: "2025-09-10",
      description: "Client dinner",
      lines: [
        { accountId: tags.get("entertainment") as string, debit: 40_000 },
        { code: "1020", credit: 40_000 },
      ],
    });
    await postJournalEntry(t, {
      date: "2025-09-11",
      description: "Traffic fine",
      lines: [
        { accountId: tags.get("fines_penalties") as string, debit: 2_000 },
        { code: "1020", credit: 2_000 },
      ],
    });
    const ret = await createReturn(t);
    // Profit 600,000 - 42,000 = 558,000; + 20,000 (50% of entertainment) + 2,000 fines.
    expect(ret.taxableIncome).toBe(580_000);
    const ledgerAdj = ret.workpaper.ledgerAdjustments;
    expect(ledgerAdj.map((a: { category: string }) => a.category).sort()).toEqual([
      "entertainment_50",
      "fines_penalties",
    ]);
  });
});

describe("W4-A corporate tax: report 08 figures (losses, SBR, sunset) (R08-14)", () => {
  it("[R08-14] report-08 tax 20,250; SBR eligible at 1M; denied after a >3M prior period; refused for a period ending 2027-06-30", async () => {
    const t = await h.createTenant({ name: "CtSbr" });
    const prior = await createReturn(t, {
      taxPeriodStart: "2024-01-01",
      taxPeriodEnd: "2024-12-31",
      totalRevenue: 4_000_000,
      totalExpenses: 3_900_000,
    });
    expect(prior.taxPayable).toBe(0);
    const fy25 = await createReturn(t, {
      ...FY2025,
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
      smallBusinessReliefElected: true,
    });
    expect(fy25.workpaper.computation.smallBusinessRelief).toMatchObject({
      elected: true,
      eligible: false,
      applied: false,
      ineligibleReason: "prior_period_cap",
    });
    expect(fy25.taxPayable).toBe(20_250);

    const solo = await h.createTenant({ name: "CtSbrOk" });
    const eligible = await createReturn(solo, {
      ...FY2025,
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
      smallBusinessReliefElected: true,
    });
    expect(eligible.workpaper.computation.smallBusinessRelief.applied).toBe(true);
    expect(eligible.taxPayable).toBe(0);

    const late = await createReturn(solo, {
      taxPeriodStart: "2026-07-01",
      taxPeriodEnd: "2027-06-30",
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
      smallBusinessReliefElected: true,
    });
    expect(late.workpaper.computation.smallBusinessRelief).toMatchObject({
      applied: false,
      ineligibleReason: "sunset",
    });
    expect(late.taxPayable).toBe(20_250);

    const calc = await solo.as.get(
      `/api/companies/${solo.company.id}/corporate-tax/calculate?periodStart=2026-07-01&periodEnd=2027-06-30&sbrElected=true`
    );
    expect(calc.status).toBe(200);
    expect(calc.body.smallBusinessRelief.eligible).toBe(false);
  });

  it("[R08-14] loss carry-forward is capped at 75% of taxable income", async () => {
    const t = await h.createTenant({ name: "CtLoss" });
    const lossYear = await createReturn(t, {
      taxPeriodStart: "2024-01-01",
      taxPeriodEnd: "2024-12-31",
      totalRevenue: 100_000,
      totalExpenses: 1_000_000,
    });
    expect(lossYear.lossCarriedForward).toBe(900_000);
    const next = await createReturn(t, {
      ...FY2025,
      totalRevenue: 2_000_000,
      totalExpenses: 1_000_000,
    });
    expect(next.lossBroughtForward).toBe(900_000);
    expect(next.workpaper.computation.lossReliefApplied).toBe(750_000);
    expect(next.taxableIncome).toBe(250_000);
    expect(next.lossCarriedForward).toBe(150_000);
    expect(next.taxPayable).toBe(0);
  });
});

describe("W4-A corporate tax: lifecycle (R08-04, R08-19)", () => {
  it("[R08-04] reviewer must differ, filed returns are immutable, every transition is audited", async () => {
    const t = await tenantWithBooks("CtLife");
    const accountant = await addMember(t, "accountant", "CtReviewer");
    const ret = await createReturn(t);
    const tr = (who: Tenant, body: Record<string, unknown>) =>
      who.as.post(`/api/corporate-tax/returns/${ret.id}/transition`, body);

    expect((await tr(t, { to: "reviewed" })).status).toBe(409); // draft -> reviewed not allowed
    const computed = await tr(t, { to: "computed" });
    expect(computed.status, computed.text).toBe(200);
    expect(computed.body.status).toBe("computed");
    const selfReview = await tr(t, { to: "reviewed" });
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.code).toBe("SAME_ACTOR_APPROVAL");
    const reviewed = await tr(accountant, { to: "reviewed" });
    expect(reviewed.status, reviewed.text).toBe(200);
    expect(reviewed.body.reviewedBy).toBe(accountant.user.id);
    // Reviewed returns are locked for edits.
    expect(
      (await t.as.patch(`/api/corporate-tax/returns/${ret.id}`, { notes: "late edit" })).status
    ).toBe(409);
    const filed = await tr(t, { to: "filed", filingReference: "FTA-REF-1" });
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body.status).toBe("filed");
    expect(filed.body.filedAt).toBeTruthy();
    expect(filed.body.filedBy).toBe(t.user.id);

    const patchFiled = await t.as.patch(`/api/corporate-tax/returns/${ret.id}`, {
      totalRevenue: 1,
    });
    expect(patchFiled.status).toBe(409);
    expect(patchFiled.body.code).toBe("CT_RETURN_IMMUTABLE");
    const patchStatus = await t.as.patch(`/api/corporate-tax/returns/${ret.id}`, {
      status: "draft",
      taxPayable: 1,
    });
    expect(patchStatus.status).toBe(400);
    const recompute = await t.as.post(`/api/corporate-tax/returns/${ret.id}/compute`, {});
    expect(recompute.status).toBe(409);
    const pull = await t.as.post(`/api/corporate-tax/returns/${ret.id}/pull-from-books`, {});
    expect(pull.status).toBe(409);
    const back = await tr(t, { to: "computed" });
    expect(back.status).toBe(409);

    const stored = await h.sql(
      `SELECT status, tax_payable FROM corporate_tax_returns WHERE id = $1`,
      [ret.id]
    );
    expect(stored[0]).toMatchObject({ status: "filed" });
    expect(Number(stored[0].tax_payable)).toBe(20_250);

    const audit = await h.sql<{ action: string }>(
      `SELECT action FROM audit_logs WHERE resource_type = 'corporate_tax_return' AND resource_id = $1
        ORDER BY created_at`,
      [ret.id]
    );
    const actions = audit.map((a) => a.action);
    for (const a of ["created", "initial_compute", "computed", "reviewed", "filed"]) {
      expect(actions).toContain(`corporate_tax_return.${a}`);
    }
    const trail = await t.as.get(`/api/corporate-tax/returns/${ret.id}/audit`);
    expect(trail.status).toBe(200);
    expect(trail.body.length).toBe(audit.length);
  });

  it("[R08-19] filing posts the CT provision (Dr expense / Cr payable) and amending reverses it", async () => {
    const t = await tenantWithBooks("CtProv");
    const accountant = await addMember(t, "accountant", "CtProvReviewer");
    const ret = await createReturn(t);
    const base = `/api/corporate-tax/returns/${ret.id}`;
    await t.as.post(`${base}/transition`, { to: "computed" });
    await accountant.as.post(`${base}/transition`, { to: "reviewed" });
    const filed = await t.as.post(`${base}/transition`, { to: "filed", postProvision: true });
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body.provisionEntryId).toBeTruthy();
    const lines = await h.sql<{ code: string; debit: string; credit: string; source: string }>(
      `SELECT a.code, jl.debit::text, jl.credit::text, je.source
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.id = $1 ORDER BY jl.debit DESC`,
      [filed.body.provisionEntryId]
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ code: "5200", source: "corporate_tax" });
    expect(Number(lines[0].debit)).toBe(20_250);
    expect(lines[1].code).toBe("2060");
    expect(Number(lines[1].credit)).toBe(20_250);

    // The provision is not deductible: recalculating excludes it.
    const calc = await t.as.get(
      `/api/companies/${t.company.id}/corporate-tax/calculate?periodStart=2025-01-01&periodEnd=2025-12-31`
    );
    expect(calc.body.taxPayable).toBe(20_250);

    const amend = await t.as.post(`${base}/amend`, { reason: "Missed fines add-back" });
    expect(amend.status, amend.text).toBe(201);
    expect(amend.body.original.status).toBe("amended");
    expect(amend.body.original.provisionReversalEntryId).toBeTruthy();
    expect(amend.body.amendment.status).toBe("draft");
    expect(amend.body.amendment.amendsReturnId).toBe(ret.id);
    expect(amend.body.amendment.amendmentNumber).toBe(1);
    const reversal = await h.sql(
      `SELECT entry_kind, reversed_entry_id FROM journal_entries WHERE id = $1`,
      [amend.body.original.provisionReversalEntryId]
    );
    expect(reversal[0]).toMatchObject({
      entry_kind: "reversal",
      reversed_entry_id: filed.body.provisionEntryId,
    });
    // The amended original stays immutable.
    expect((await t.as.patch(base, { notes: "x" })).status).toBe(409);
    // The amendment is editable and recomputes.
    const fix = await t.as.post(`/api/corporate-tax/returns/${amend.body.amendment.id}/compute`, {
      adjustments: [{ id: "f1", category: "fines_penalties", amount: 10_000 }],
    });
    expect(fix.status, fix.text).toBe(200);
    expect(fix.body.return.taxPayable).toBe(21_150);
  });
});

describe("W4-A corporate tax: QFZP, interest limitation, transfer pricing (R08-15, R08-16, R08-17)", () => {
  it("[R08-15] the QFZP profile drives 0%/9%; the module stays 'adviser review pending' until confirmed", async () => {
    const t = await h.createTenant({ name: "CtQfzp" });
    const rules = await t.as.get(`/api/companies/${t.company.id}/corporate-tax/rules`);
    expect(rules.body.adviserReviewPending).toBe(true);
    const profile = await t.as.put(`/api/companies/${t.company.id}/corporate-tax/profile`, {
      isQfzp: true,
      freeZone: "JAFZA",
    });
    expect(profile.status, profile.text).toBe(200);
    expect(profile.body.isQfzp).toBe(true);
    const ret = await createReturn(t, {
      ...FY2025,
      totalRevenue: 2_000_000,
      totalExpenses: 1_000_000,
    });
    const qfzp = await t.as.post(`/api/corporate-tax/returns/${ret.id}/compute`, {
      qfzp: { qualifyingRevenue: 1_960_000, nonQualifyingRevenue: 40_000 },
    });
    expect(qfzp.status, qfzp.text).toBe(200);
    const c = qfzp.body.computation;
    expect(c.qfzp.deMinimisPassed).toBe(true);
    // 2% of 1,000,000 taxable income is non-qualifying: 20,000 at 9% = 1,800.
    expect(c.qfzp.nonQualifyingTaxableIncome).toBe(20_000);
    expect(c.taxPayable).toBe(1_800);
    const confirm = await t.as.post(
      `/api/companies/${t.company.id}/corporate-tax/profile/adviser-confirmation`,
      { adviserName: "Tax Adviser LLP" }
    );
    expect(confirm.status).toBe(200);
    expect(confirm.body.adviserReviewPending).toBe(false);
  });

  it("[R08-16] net interest above max(30% tax-EBITDA, AED 12M) is added back and carried forward", async () => {
    const t = await h.createTenant({ name: "CtInterest" });
    const ret = await createReturn(t, {
      ...FY2025,
      totalRevenue: 100_000_000,
      totalExpenses: 90_000_000,
    });
    const r = await t.as.post(`/api/corporate-tax/returns/${ret.id}/compute`, {
      interest: { netInterestExpense: 20_000_000, depreciationAmortisation: 5_000_000 },
    });
    expect(r.status, r.text).toBe(200);
    const il = r.body.computation.interestLimitation;
    // tax-EBITDA = 10M + 20M + 5M = 35M; 30% = 10.5M < 12M safe harbour.
    expect(il.taxEbitda).toBe(35_000_000);
    expect(il.capacity).toBe(12_000_000);
    expect(il.disallowed).toBe(8_000_000);
    expect(r.body.return.interestCarriedForward).toBe(8_000_000);
    expect(r.body.computation.adjustedTaxableIncome).toBe(18_000_000);
  });

  it("[R08-17] related-party register above AED 40M flags the TP disclosure form", async () => {
    const t = await h.createTenant({ name: "CtTp" });
    const add = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/related-parties`, {
      name: "Parent Holding Ltd",
      relationship: "related_party",
      jurisdiction: "UK",
      periodYear: 2025,
      transactionValue: 45_000_000,
    });
    expect(add.status, add.text).toBe(201);
    const ret = await createReturn(t, {
      ...FY2025,
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
    });
    expect(ret.workpaper.transferPricing).toMatchObject({
      disclosureFormRequired: true,
      masterLocalFileRequired: false,
    });
    const pack = await t.as.get(`/api/companies/${t.company.id}/evidence-center/ct-pack`);
    expect(pack.status, pack.text).toBe(200);
    expect(pack.body.relatedParties).toHaveLength(1);
    expect(pack.body.transferPricing.disclosureFormRequired).toBe(true);
  });
});

describe("W4-A corporate tax: output and evidence (R08-20, R08-22, R08-24)", () => {
  it("[R08-20][R08-24] export carries an EmaraTax-ordered sheet with Arabic labels and a manual-upload notice", async () => {
    const t = await tenantWithBooks("CtExport");
    const ret = await createReturn(t);
    const res = await fetch(`${h.baseUrl}/api/corporate-tax/returns/${ret.id}/export`, {
      headers: { Authorization: `Bearer ${t.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-filing-mode")).toBe("manual-upload-no-fta-api");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
    const sheet = wb.getWorksheet("EmaraTax Return");
    expect(sheet).toBeDefined();
    const text: string[] = [];
    sheet!.eachRow((row) => row.eachCell((cell) => text.push(String(cell.value ?? ""))));
    const joined = text.join("|");
    expect(joined).toContain("Upload manually to EmaraTax");
    expect(joined).toContain("ضريبة الشركات المستحقة");
    expect(joined).toContain("20250");
    expect(wb.getWorksheet("Deferred Tax Note")).toBeDefined();
  });

  it("[R08-22] the evidence centre exposes a corporate tax pack next to VAT", async () => {
    const t = await tenantWithBooks("CtEvidence");
    const ret = await createReturn(t);
    await t.as.post(`/api/corporate-tax/returns/${ret.id}/compute`, {
      adjustments: [{ id: "n1", category: "other_addback", amount: 1_000 }],
    });
    const pack = await t.as.get(`/api/companies/${t.company.id}/evidence-center/ct-pack`);
    expect(pack.status, pack.text).toBe(200);
    expect(pack.body.ctReturn).toMatchObject({ id: ret.id, filingDeadline: "2026-09-30" });
    expect(pack.body.adjustments[0]).toMatchObject({ id: "n1", support: "missing" });
    expect(pack.body.checks.map((c: { key: string }) => c.key)).toContain("related_party_register");
    const xlsx = await fetch(
      `${h.baseUrl}/api/companies/${t.company.id}/evidence-center/ct-pack.xlsx`,
      {
        headers: { Authorization: `Bearer ${t.token}` },
      }
    );
    expect(xlsx.status).toBe(200);
    const center = await t.as.get(`/api/companies/${t.company.id}/evidence-center`);
    const ct = center.body.filingTimeline.find((i: { id: string }) => i.id === `ct:${ret.id}`);
    expect(ct.dueDate.slice(0, 10)).toBe("2026-09-30");

    const other = await h.createSecondTenant({ name: "CtEvidenceB" });
    const leak = await other.as.get(`/api/companies/${t.company.id}/evidence-center/ct-pack`);
    expect([403, 404]).toContain(leak.status);
  });
});
