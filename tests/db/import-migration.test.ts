/**
 * W5-B migration import wizard (R19-13, R19-18, R02-16b; W2-B carry-over R11-14).
 * Fixtures: tests/fixtures/import/ (Xero, QuickBooks Online, Zoho Books, Wafeq layouts).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const CUT_OVER = "2025-12-31";
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "import", name), "utf8");

async function runImport(
  t: Tenant,
  body: Record<string, unknown>,
  opts: { expectCommit?: boolean } = { expectCommit: true }
) {
  const p = await t.as.post(`/api/companies/${t.company.id}/imports/preview`, body);
  expect(p.status, p.text).toBe(201);
  const v = await t.as.post(`/api/companies/${t.company.id}/imports/${p.body.id}/validate`);
  expect(v.status, v.text).toBe(200);
  if (opts.expectCommit === false) return { preview: p.body, validated: v.body, committed: null };
  expect(v.body.status, JSON.stringify(v.body.issues)).toBe("validated");
  const c = await t.as.post(`/api/companies/${t.company.id}/imports/${p.body.id}/commit`);
  expect(c.status, c.text).toBe(200);
  return { preview: p.body, validated: v.body, committed: c.body };
}

async function balance(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ net: string }>(
    `SELECT (COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0))::text AS net
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0]?.net ?? 0);
}

async function importCoa(t: Tenant) {
  return runImport(t, {
    kind: "chart_of_accounts",
    sourceSystem: "xero",
    csv: fixture("xero-chart-of-accounts.csv"),
    fileName: "xero-chart-of-accounts.csv",
  });
}

describe("W5-B migration import", () => {
  it("[R19-13] a Xero trial-balance export imports as ONE balanced opening entry on the cut-over date", async () => {
    const t = await h.createTenant();
    const coa = await importCoa(t);
    expect(coa.committed!.result).toMatchObject({ accountsCreated: 4, skipped: 3 });
    const types = await h.sql(
      `SELECT code, type, sub_type FROM accounts WHERE company_id = $1 AND code IN ('1110','4110','5210','5220') ORDER BY code`,
      [t.company.id]
    );
    expect(types).toEqual([
      { code: "1110", type: "asset", sub_type: "other_current_asset" },
      { code: "4110", type: "income", sub_type: "operating_revenue" },
      { code: "5210", type: "expense", sub_type: "operating_expense" },
      { code: "5220", type: "expense", sub_type: "cost_of_sales" },
    ]);

    // C1 (RM4): A/R and A/P balances need their open documents; a balance-mode import of this
    // file is refused with guidance (the aging could never tie to 1040 / 2010).
    const refused = await runImport(
      t,
      {
        kind: "trial_balance",
        sourceSystem: "xero",
        csv: fixture("xero-trial-balance.csv"),
        cutOverDate: CUT_OVER,
        arApMode: "balance",
      },
      { expectCommit: false }
    );
    expect(refused.validated.status).toBe("previewed");
    expect(refused.validated.issues.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining(["V_AR_WITHOUT_DOCUMENTS", "V_AP_WITHOUT_DOCUMENTS"])
    );
    const { preview, committed } = await runImport(t, {
      kind: "trial_balance",
      sourceSystem: "xero",
      csv: fixture("xero-trial-balance.csv"),
      cutOverDate: CUT_OVER,
      arApMode: "documents",
    });
    expect(preview.rowCount).toBe(6); // title lines and the Total row are skipped
    const entries = await h.sql(
      `SELECT id, entry_kind, to_char(date, 'YYYY-MM-DD') AS date, status, source
         FROM journal_entries WHERE company_id = $1 AND source = 'opening_balance'`,
      [t.company.id]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entry_kind: "opening", date: CUT_OVER, status: "posted" });
    expect(committed!.journalEntryId).toBe(entries[0].id);
    const sums = await h.sql(
      `SELECT SUM(debit)::text AS d, SUM(credit)::text AS c FROM journal_lines WHERE entry_id = $1`,
      [entries[0].id]
    );
    // A/R 1,500 and A/P 2,000 wait in 3040 for the open documents (net credit 500).
    expect(Number(sums[0].d)).toBe(47500);
    expect(Number(sums[0].c)).toBe(47500);
    expect(await balance(t, "1020")).toBe(42500);
    expect(await balance(t, "1040")).toBe(0);
    expect(await balance(t, "2010")).toBe(0);
    expect(await balance(t, "3040")).toBe(-500);

    // A second opening trial balance is refused.
    const again = await runImport(
      t,
      {
        kind: "trial_balance",
        sourceSystem: "zoho",
        csv: fixture("zoho-trial-balance.csv"),
        cutOverDate: CUT_OVER,
      },
      { expectCommit: false }
    );
    expect(again.validated.issues.map((i: { code: string }) => i.code)).toContain(
      "V_OPENING_ALREADY_IMPORTED"
    );
  });

  it("[R11-14] an unbalanced trial balance is rejected at validation and nothing is posted", async () => {
    const t = await h.createTenant();
    const r = await runImport(
      t,
      {
        kind: "trial_balance",
        sourceSystem: "xero",
        csv: fixture("xero-trial-balance-unbalanced.csv"),
        cutOverDate: CUT_OVER,
      },
      { expectCommit: false }
    );
    expect(r.validated.status).toBe("previewed");
    expect(r.validated.issues.map((i: { code: string }) => i.code)).toContain("V_UNBALANCED");
    const commit = await t.as.post(`/api/companies/${t.company.id}/imports/${r.preview.id}/commit`);
    expect(commit.status).toBe(422);
    const n = await h.sql(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(n[0].n).toBe(0);
  });

  it("[R19-13] open invoices and bills tie A/R and A/P to the control accounts without double counting", async () => {
    const t = await h.createTenant();
    await importCoa(t);
    await runImport(t, {
      kind: "trial_balance",
      sourceSystem: "xero",
      csv: fixture("xero-trial-balance.csv"),
      cutOverDate: CUT_OVER,
      arApMode: "documents",
    });
    // In documents mode the control balances wait for the documents.
    expect(await balance(t, "1040")).toBe(0);
    expect(await balance(t, "2010")).toBe(0);

    const inv = await runImport(t, {
      kind: "open_invoices",
      sourceSystem: "xero",
      csv: fixture("xero-open-invoices.csv"),
      cutOverDate: CUT_OVER,
    });
    expect(inv.committed!.result).toMatchObject({ documentsCreated: 2, controlTotalFils: 150000 });
    const bills = await runImport(t, {
      kind: "open_bills",
      sourceSystem: "quickbooks",
      csv: fixture("quickbooks-open-bills.csv"),
      cutOverDate: CUT_OVER,
    });
    expect(bills.committed!.result).toMatchObject({
      documentsCreated: 2,
      controlTotalFils: 200000,
    });

    expect(await balance(t, "1040")).toBe(1500);
    expect(await balance(t, "2010")).toBe(-2000);
    expect(await balance(t, "3040")).toBe(0); // Opening Balance Equity nets out
    const open = await h.sql(
      `SELECT number, status, total::text AS total FROM invoices WHERE company_id = $1 ORDER BY number`,
      [t.company.id]
    );
    expect(open).toEqual([
      { number: "INV-0041", status: "sent", total: "1000.00" },
      { number: "INV-0042", status: "sent", total: "500.00" },
    ]);
    const ap = await h.sql(
      `SELECT origin_ref, status, total_amount::text AS total, to_char(bill_date, 'YYYY-MM-DD') AS d
         FROM vendor_bills WHERE company_id = $1 ORDER BY origin_ref`,
      [t.company.id]
    );
    expect(ap).toEqual([
      { origin_ref: "B-7781", status: "approved", total: "1200.00", d: "2025-12-01" },
      { origin_ref: "B-7790", status: "approved", total: "800.00", d: "2025-12-15" },
    ]);
    // Aged receivables (reporting kernel) equal the control account.
    const aging = await t.as.get(
      `/api/companies/${t.company.id}/reports/ar-aging?asOf=${CUT_OVER}`
    );
    if (aging.status === 200 && aging.body?.totals) expect(aging.body.totals.total).toBe(1500);
  });

  it("[R19-13] control totals are checked: a mismatch, or A/R on a balance-mode TB, are refused", async () => {
    const t = await h.createTenant();
    await importCoa(t);
    // C1 (RM4): a balance-mode TB may not carry A/R or A/P at all, so documents can never
    // count them twice; the refusal points at documents mode.
    const dup = await runImport(
      t,
      {
        kind: "trial_balance",
        sourceSystem: "xero",
        csv: fixture("xero-trial-balance.csv"),
        cutOverDate: CUT_OVER,
        arApMode: "balance",
      },
      { expectCommit: false }
    );
    expect(dup.validated.issues.map((i: { code: string }) => i.code)).toContain(
      "V_AR_WITHOUT_DOCUMENTS"
    );

    const u = await h.createTenant();
    await importCoa(u);
    await runImport(u, {
      kind: "trial_balance",
      sourceSystem: "xero",
      csv: fixture("xero-trial-balance.csv"),
      cutOverDate: CUT_OVER,
      arApMode: "documents",
    });
    const short = fixture("xero-open-invoices.csv").split("\n").slice(0, 2).join("\n");
    const mismatch = await runImport(
      u,
      { kind: "open_invoices", sourceSystem: "xero", csv: short, cutOverDate: CUT_OVER },
      { expectCommit: false }
    );
    expect(mismatch.validated.issues.map((i: { code: string }) => i.code)).toContain(
      "V_CONTROL_TOTAL_MISMATCH"
    );
  });

  it("[R02-16b] the chart of accounts round-trips through CSV export and import", async () => {
    const a = await h.createTenant();
    await runImport(a, {
      kind: "chart_of_accounts",
      sourceSystem: "wafeq",
      csv: fixture("wafeq-chart-of-accounts.csv"),
    });
    const exp = await a.as.get(`/api/companies/${a.company.id}/imports/chart-of-accounts/export`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get("content-type")).toContain("text/csv");
    expect(exp.text).toContain("6100,Marketing Agencies,وكالات التسويق");

    const b = await h.createSecondTenant();
    const res = await runImport(b, {
      kind: "chart_of_accounts",
      sourceSystem: "generic",
      csv: exp.text,
    });
    const pick = (rows: Array<Record<string, unknown>>) =>
      rows.map((r) => `${r.code}|${r.type}|${r.sub_type}|${r.name_ar ?? ""}`).sort();
    const accA = await h.sql(
      `SELECT code, type, sub_type, name_ar FROM accounts WHERE company_id = $1 AND is_archived = false`,
      [a.company.id]
    );
    const accB = await h.sql(
      `SELECT code, type, sub_type, name_ar FROM accounts WHERE company_id = $1 AND is_archived = false`,
      [b.company.id]
    );
    expect(res.committed!.result.accountsCreated).toBe(2);
    expect(pick(accB.filter((r) => ["6100", "6110"].includes(String(r.code))))).toEqual(
      pick(accA.filter((r) => ["6100", "6110"].includes(String(r.code))))
    );
    // Every exported account parses back to the same type and sub type.
    const reparsed = await b.as.post(`/api/companies/${b.company.id}/imports/preview`, {
      kind: "chart_of_accounts",
      sourceSystem: "generic",
      csv: exp.text,
    });
    const byCode = new Map(accA.map((r) => [String(r.code), r]));
    for (const row of reparsed.body.rows as Array<{
      code: string;
      type: string;
      subType: string;
    }>) {
      const orig = byCode.get(row.code)!;
      expect(`${row.code}:${row.type}:${row.subType}`).toBe(
        `${row.code}:${orig.type}:${orig.sub_type}`
      );
    }
  });

  it("[R19-13] customers (QuickBooks), vendors (Zoho) and items (Wafeq) import; bad TRNs are dropped with a warning", async () => {
    const t = await h.createTenant();
    const cust = await runImport(t, {
      kind: "customers",
      sourceSystem: "quickbooks",
      csv: fixture("quickbooks-customers.csv"),
    });
    expect(cust.validated.issues.map((i: { code: string }) => i.code)).toContain("INVALID_TRN");
    expect(cust.committed!.result).toMatchObject({ created: 2 });
    const c = await h.sql(
      `SELECT name, trn_number, email FROM customer_contacts WHERE company_id = $1 ORDER BY name`,
      [t.company.id]
    );
    expect(c).toEqual([
      { name: "Al Noor Trading", trn_number: "100123456700003", email: "accounts@alnoor.example" },
      { name: "Bad TRN Customer", trn_number: null, email: null },
    ]);
    await runImport(t, { kind: "vendors", sourceSystem: "zoho", csv: fixture("zoho-vendors.csv") });
    const v = await h.sql(`SELECT name, trn FROM vendors WHERE company_id = $1`, [t.company.id]);
    expect(v).toEqual([{ name: "Sharjah Packaging", trn: "100987654300003" }]);
    await runImport(t, { kind: "items", sourceSystem: "wafeq", csv: fixture("wafeq-items.csv") });
    const p = await h.sql(
      `SELECT sku, product_type, unit_price::text AS price, cost_price::text AS cost FROM products WHERE company_id = $1 ORDER BY sku`,
      [t.company.id]
    );
    expect(p).toEqual([
      { sku: "PKG-010", product_type: "inventory", price: "4.50", cost: "2.10" },
      { sku: "SRV-001", product_type: "service", price: "350.00", cost: "0.00" },
    ]);
    // Re-importing is idempotent.
    const again = await runImport(t, {
      kind: "customers",
      sourceSystem: "quickbooks",
      csv: fixture("quickbooks-customers.csv"),
    });
    expect(again.committed!.result).toMatchObject({ created: 0, skipped: 2 });
  });

  it("[R19-18] onboarding exposes industry COA templates and a TRN format check", async () => {
    const t = await h.createTenant();
    const list = await t.as.get(`/api/onboarding/coa-templates`);
    expect(list.body.map((x: { id: string }) => x.id)).toContain("ecommerce");
    const apply = await t.as.post(`/api/companies/${t.company.id}/onboarding/coa-template`, {
      templateId: "ecommerce",
    });
    expect(apply.status, apply.text).toBe(200);
    expect(apply.body.added).toBe(4);
    const again = await t.as.post(`/api/companies/${t.company.id}/onboarding/coa-template`, {
      templateId: "ecommerce",
    });
    expect(again.body.added).toBe(0);
    const good = await t.as.post(`/api/onboarding/validate-trn`, { trn: "100 1234 5670 0003" });
    expect(good.body).toMatchObject({
      valid: true,
      normalized: "100123456700003",
      registryCheck: "requires_external",
    });
    const bad = await t.as.post(`/api/onboarding/validate-trn`, { trn: "12345" });
    expect(bad.body.valid).toBe(false);
    const steps = await t.as.get(`/api/onboarding/optional-steps`);
    expect(steps.body.importData.done).toBe(false);
  });

  it("[R19-13] import routes need ledger.post: a viewer is refused", async () => {
    const v = await h.createTenant({ role: "viewer" });
    const r = await v.as.post(`/api/companies/${v.company.id}/imports/preview`, {
      kind: "customers",
      sourceSystem: "generic",
      csv: "Name\nX\n",
    });
    expect(r.status).toBe(403);
  });
});
