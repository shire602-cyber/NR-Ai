/**
 * S5 migration import (W5-B, R19-13; S5 foreign-currency open documents): preview and
 * validation logic against an in-memory stand-in for the raw-SQL layer. The DB-backed
 * commit path is covered by tests/db/import-migration.test.ts and tests/db/s5-platform.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Job {
  [k: string]: unknown;
}
const state = {
  jobs: new Map<string, Job>(),
  accounts: [] as Array<Record<string, unknown>>,
  committed: [] as Array<Record<string, unknown>>,
  invoiceNumbers: [] as string[],
  billNumbers: [] as string[],
  customerNames: [] as string[],
  productNames: [] as Array<{ n: string; sku: string | null }>,
  base: "AED",
  seq: 0,
};

vi.mock("../../server/services/connectors/pq", () => ({
  pq: vi.fn(async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ");
    const out = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    if (/^INSERT INTO import_jobs/.test(sql.trim())) {
      const id = `job-${++state.seq}`;
      const job: Job = {
        id,
        company_id: params[0],
        kind: params[1],
        source_system: params[2],
        status: "previewed",
        file_name: params[3],
        cut_over_date: params[4],
        ar_ap_mode: params[5],
        rows: params[6],
        issues: params[7],
        summary: params[8],
        result: null,
        journal_entry_id: null,
        created_at: new Date(0),
        committed_at: null,
      };
      state.jobs.set(id, job);
      return out([job]);
    }
    if (/FROM import_jobs WHERE id = \$1 AND company_id = \$2/.test(sql)) {
      const j = state.jobs.get(String(params[0]));
      return out(j && j.company_id === params[1] ? [j] : []);
    }
    if (/FROM import_jobs WHERE company_id = \$1 ORDER BY/.test(sql)) {
      return out([...state.jobs.values()].filter((j) => j.company_id === params[0]));
    }
    if (/FROM import_jobs WHERE company_id = \$1 AND status = 'committed'/.test(sql)) {
      return out(state.committed);
    }
    if (
      /^UPDATE import_jobs SET status = \$3, issues = \$4, summary = \$5, rows = \$6/.test(
        sql.trim()
      )
    ) {
      const j = state.jobs.get(String(params[0]))!;
      Object.assign(j, {
        status: params[2],
        issues: params[3],
        summary: params[4],
        rows: params[5],
      });
      return out([j]);
    }
    if (/FROM accounts WHERE company_id = \$1/.test(sql)) return out(state.accounts);
    if (/SELECT base_currency FROM companies/.test(sql))
      return out([{ base_currency: state.base }]);
    if (/SELECT number AS n FROM invoices/.test(sql))
      return out(state.invoiceNumbers.map((n) => ({ n })));
    if (/FROM vendor_bills/.test(sql)) return out(state.billNumbers.map((n) => ({ n })));
    if (/FROM customer_contacts|FROM vendors/.test(sql))
      return out(state.customerNames.map((n) => ({ n })));
    if (/FROM products/.test(sql)) return out(state.productNames);
    return out([]);
  }),
}));

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "import", name), "utf8");
const CO = "co-1";

const acct = (code: string, type: string, sub_type: string | null = null) => ({
  id: `a-${code}`,
  code,
  type,
  sub_type,
  is_active: true,
  is_archived: false,
});

beforeEach(async () => {
  state.jobs.clear();
  state.accounts = [
    acct("1020", "asset", "bank"),
    acct("1040", "asset", "receivable"),
    acct("2010", "liability", "payable"),
    acct("3010", "equity", "owner_equity"),
    acct("4010", "income", "operating_revenue"),
  ];
  state.committed = [];
  state.invoiceNumbers = [];
  state.billNumbers = [];
  state.customerNames = [];
  state.productNames = [];
  state.base = "AED";
  const reg = await import("../../server/platform/service-registry");
  reg.provide(
    "fx.getRate",
    (async (_c: string, from: string, _to: string, date: string) => {
      if (from === "USD") return { rate: 3.6725, stale: date < "2025-06-01", ageDays: 200 };
      throw new Error("NO_EXCHANGE_RATE");
    }) as never,
    { replace: true }
  );
});

async function previewAndValidate(input: Record<string, unknown>) {
  const svc = await import("../../server/services/migration-import");
  const p = await svc.previewImport({ companyId: CO, userId: "u-1", ...input } as never);
  const v = await svc.validateImport(CO, p.id);
  return { p, v, codes: v.issues.map((i) => i.code) };
}

describe("S5 migration import preview + validation (unit)", () => {
  it("[S5-3] open invoices: AED rows at rate 1, USD rows at the document-date rate, base control total", async () => {
    const csv = [
      "ContactName,InvoiceNumber,InvoiceDate,DueDate,Total,AmountDue,Currency",
      "Boston Inc,US-1,02/12/2025,01/01/2026,1000.00,1000.00,USD",
      "Old Boston,US-0,02/01/2025,01/02/2025,10.00,10.00,USD",
      "Gulf LLC,AE-1,05/12/2025,04/01/2026,500.00,500.00,AED",
    ].join("\n");
    const { v, codes } = await previewAndValidate({
      kind: "open_invoices",
      sourceSystem: "xero",
      csv,
      cutOverDate: "2025-12-31",
    });
    expect(v.status).toBe("validated");
    expect(codes).toContain("V_STALE_EXCHANGE_RATE");
    expect(codes).toContain("V_NO_OPENING_TB");
    expect(v.summary).toMatchObject({
      controlTotalFils: 367250 + 3673 + 50000,
      documents: 3,
      foreignCurrencyDocuments: 2,
    });
    const usd = v.rows.find((r) => r.number === "US-1")!;
    expect(usd).toMatchObject({ currency: "USD", exchangeRate: 3.6725, amountDueBaseFils: 367250 });
    expect(v.rows.find((r) => r.number === "AE-1")).toMatchObject({
      exchangeRate: 1,
      foreign: false,
    });
  });

  it("[S5-3] open bills: the file's rate column wins; unknown currency, bad rate and missing rate are errors", async () => {
    const csv = [
      "Date,Num,Vendor,Due Date,Amount,Open Balance,Currency,Exchange Rate",
      "12/01/2025,EU-1,Berlin GmbH,12/31/2025,200.00,200.00,EUR,4.0",
      "12/01/2025,JP-1,Tokyo KK,12/31/2025,100.00,100.00,JPY,",
      "12/01/2025,XX-1,Nowhere,12/31/2025,100.00,100.00,EURO,",
      "12/01/2025,BR-1,Rio,12/31/2025,100.00,100.00,BRL,-2",
    ].join("\n");
    const { v, codes } = await previewAndValidate({
      kind: "open_bills",
      sourceSystem: "quickbooks",
      csv,
      cutOverDate: "2025-12-31",
    });
    expect(v.status).toBe("previewed");
    expect(codes).toEqual(
      expect.arrayContaining(["INVALID_CURRENCY", "INVALID_EXCHANGE_RATE", "V_NO_EXCHANGE_RATE"])
    );
    expect(v.rows.find((r) => r.number === "EU-1")).toMatchObject({
      exchangeRate: 4,
      amountDueBaseFils: 80000,
    });
  });

  it("open documents: duplicates, after-cut-over, nothing-due, due-exceeds-total and missing control account", async () => {
    state.accounts = state.accounts.filter((a) => a.sub_type !== "receivable");
    state.invoiceNumbers = ["INV-0041"];
    const csv = [
      "ContactName,InvoiceNumber,InvoiceDate,DueDate,Total,AmountDue",
      "A,INV-0041,15/11/2025,15/12/2025,100,100",
      "B,INV-9,15/01/2026,15/02/2026,100,100",
      "C,INV-8,15/11/2025,bad-date,100,200",
      "D,INV-7,15/11/2025,15/12/2025,100,0",
      ",,nope,,0,",
    ].join("\n");
    const { codes } = await previewAndValidate({
      kind: "open_invoices",
      sourceSystem: "xero",
      csv,
      cutOverDate: "2025-12-31",
    });
    expect(codes).toEqual(
      expect.arrayContaining([
        "V_DUPLICATE_NUMBER",
        "V_AFTER_CUT_OVER",
        "V_CONTROL_ACCOUNT_MISSING",
        "V_OBE_CREATED",
        "DUE_EXCEEDS_TOTAL",
        "INVALID_DUE_DATE",
        "NOTHING_DUE",
        "NUMBER_REQUIRED",
        "INVALID_DATE",
        "CONTACT_REQUIRED",
        "INVALID_TOTAL",
      ])
    );
  });

  it("open documents tie to a committed trial balance: documents mode totals, balance mode double count, cut-over", async () => {
    state.committed = [
      {
        id: "tb",
        kind: "trial_balance",
        ar_ap_mode: "documents",
        summary: JSON.stringify({ arControlFils: 150000, apControlFils: 0 }),
        cut_over_date: "2025-12-31",
      },
    ];
    const csv = fixture("xero-open-invoices.csv");
    const ok = await previewAndValidate({
      kind: "open_invoices",
      sourceSystem: "xero",
      csv,
      cutOverDate: "2025-12-31",
    });
    expect(ok.v.status).toBe("validated");
    const wrongDate = await previewAndValidate({
      kind: "open_invoices",
      sourceSystem: "xero",
      csv,
      cutOverDate: "2025-12-30",
    });
    expect(wrongDate.codes).toContain("V_CUT_OVER_MISMATCH");

    state.committed[0].summary = JSON.stringify({ arControlFils: 99, apControlFils: 0 });
    const mismatch = await previewAndValidate({
      kind: "open_invoices",
      sourceSystem: "xero",
      csv,
      cutOverDate: "2025-12-31",
    });
    expect(mismatch.codes).toContain("V_CONTROL_TOTAL_MISMATCH");

    state.committed[0].ar_ap_mode = "balance";
    const twice = await previewAndValidate({
      kind: "open_invoices",
      sourceSystem: "xero",
      csv,
      cutOverDate: "2025-12-31",
    });
    expect(twice.codes).toContain("V_CONTROL_IN_OPENING_BALANCE");
  });

  it("chart of accounts: types mapped, duplicates and existing codes reported", async () => {
    const xero = await previewAndValidate({
      kind: "chart_of_accounts",
      sourceSystem: "xero",
      csv: fixture("xero-chart-of-accounts.csv") + "\n1110,Again,Current Asset,No VAT,,No,No,No\n",
    });
    expect(xero.codes).toEqual(expect.arrayContaining(["V_CODE_EXISTS", "V_DUPLICATE_CODE"]));
    const wafeq = await previewAndValidate({
      kind: "chart_of_accounts",
      sourceSystem: "wafeq",
      csv: fixture("wafeq-chart-of-accounts.csv"),
    });
    expect(wafeq.v.status).toBe("validated");
    expect(wafeq.v.summary.accountsToCreate).toBe(2);
    const bad = await previewAndValidate({
      kind: "chart_of_accounts",
      sourceSystem: "generic",
      csv: "Code,Name,Type\n,,Spaceship\n",
    });
    expect(bad.codes).toEqual(
      expect.arrayContaining(["CODE_REQUIRED", "NAME_REQUIRED", "UNKNOWN_ACCOUNT_TYPE"])
    );
  });

  it("trial balance: balanced Xero/Zoho files validate; unbalanced, unknown and P&L accounts are reported", async () => {
    const zoho = await previewAndValidate({
      kind: "trial_balance",
      sourceSystem: "zoho",
      csv: fixture("zoho-trial-balance.csv"),
      cutOverDate: "2025-12-31",
      arApMode: "balance",
    });
    expect(zoho.v.status, JSON.stringify(zoho.v.issues)).toBe("validated");
    const unbalanced = await previewAndValidate({
      kind: "trial_balance",
      sourceSystem: "xero",
      csv: fixture("xero-trial-balance-unbalanced.csv"),
      cutOverDate: "2025-12-31",
    });
    expect(unbalanced.codes).toContain("V_UNBALANCED");
    const xero = await previewAndValidate({
      kind: "trial_balance",
      sourceSystem: "xero",
      csv: fixture("xero-trial-balance.csv"),
      cutOverDate: "2025-12-31",
      arApMode: "documents",
    });
    expect(xero.v.issues.length).toBeGreaterThan(0);
    const pl = await previewAndValidate({
      kind: "trial_balance",
      sourceSystem: "generic",
      csv: "Code,Name,Debit,Credit\n4010,Sales,0,100\n9999,Ghost,100,0\n",
      cutOverDate: "2999-01-01",
    });
    expect(pl.codes).toEqual(
      expect.arrayContaining(["V_PL_ACCOUNT", "V_UNKNOWN_ACCOUNT", "V_CUT_OVER_IN_FUTURE"])
    );
    const noCutOver = await previewAndValidate({
      kind: "trial_balance",
      sourceSystem: "zoho",
      csv: fixture("zoho-trial-balance.csv"),
    });
    expect(noCutOver.codes).toContain("CUT_OVER_REQUIRED");
  });

  it("customers, vendors and items normalise; missing columns and empty files are file-level errors", async () => {
    const qb = await previewAndValidate({
      kind: "customers",
      sourceSystem: "quickbooks",
      csv: fixture("quickbooks-customers.csv"),
    });
    expect(qb.v.rows.length).toBe(2);
    const zoho = await previewAndValidate({
      kind: "vendors",
      sourceSystem: "zoho",
      csv: fixture("zoho-vendors.csv"),
    });
    expect(zoho.v.rows.length).toBe(1);
    state.productNames = [{ n: "consulting hour", sku: null }];
    const items = await previewAndValidate({
      kind: "items",
      sourceSystem: "wafeq",
      csv: fixture("wafeq-items.csv"),
    });
    expect(items.v.rows.length).toBe(2);
    const missing = await previewAndValidate({
      kind: "customers",
      sourceSystem: "generic",
      csv: "Foo,Bar\n1,2\n",
    });
    expect(missing.codes).toContain("COLUMN_MISSING");

    const svc = await import("../../server/services/migration-import");
    expect((await svc.listImportJobs(CO)).length).toBeGreaterThan(3);
    await expect(svc.getImportJob(CO, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
