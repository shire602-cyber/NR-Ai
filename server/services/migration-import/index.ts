/**
 * Migration import (W5-B, R19-13, R19-18, R02-16b; W2-B carry-over R11-14).
 *
 * preview -> validate -> commit jobs (import_jobs) for:
 *   chart_of_accounts  new accounts (existing codes are skipped, never overwritten)
 *   trial_balance      ONE balanced `entry_kind = 'opening'` journal on the cut-over
 *                      date through server/ledger. ar_ap_mode:
 *                        balance    A/R and A/P control balances are posted as lines
 *                        documents  A/R and A/P are carried by the open invoices / bills
 *                                   import instead (their lines move to Opening Balance
 *                                   Equity 3040 here and are posted per document)
 *   customers, vendors, items
 *   open_invoices      AR subledger: one issued invoice per open document (outstanding
 *   open_bills         amount, in its own currency: S5 adds foreign-currency documents at the
 *                      document-date rate from the file or fx.getRate, so settlement books
 *                      realised FX) plus a per-document opening journal Dr A/R / Cr 3040
 *                      (Dr 3040 / Cr A/P). Control totals are checked against the
 *                      trial balance so the opening balance is never counted twice.
 *
 * D1 (go-live model, docs/platform-rules.md "Go-live"): every account with a sub-ledger is posted
 * by that sub-ledger's own opening seam (open invoices / bills, opening stock, the asset
 * register's opening import, the employees' opening gratuity provisions), each against Opening
 * Balance Equity 3040. The opening trial balance checks its line for such an account against the
 * sub-ledger and moves it to 3040 instead of posting it, so 3040 nets to zero once every opening
 * document is in, and nothing is counted twice whatever the order. VAT of the tax period that
 * contains the cut-over date may sit on the VAT accounts: that period's return reports it and
 * its settlement clears it.
 *
 * Column layouts of Xero, QuickBooks Online, Zoho Books and Wafeq exports are
 * mapped in ./mappers.ts. All money is integer fils.
 */
import { db } from "../../db";
import {
  accounts,
  customerContacts,
  invoiceLines,
  invoices,
  products,
} from "../../../shared/schema";
import { fromFils, mulRate } from "../../../shared/money";
import { resolve } from "../../platform/service-registry";
import type { FxGetRate } from "../fx";
import { DomainError } from "../../errors";
import { postJournal, withLedgerTx, type PostJournalLineInput } from "../../ledger";
import { controlAccountsAmong, type ControlLedger } from "../../ledger/control-accounts";
import { emitDomainEvent } from "../../platform/domain-events";
import { txRows } from "../bill-posting.service";
import { pq } from "../connectors/pq";
import { syncOpeningGratuity } from "../payroll/opening-gratuity";
import { isSubTypeForType } from "../../../shared/validators/accounts";
import {
  csvEscape,
  mapAccountType,
  moneyToFils,
  parseImportCsv,
  parseImportDate,
  REQUIRED_FIELDS,
  splitCodeAndName,
  type ImportKind,
  type SourceSystem,
} from "./mappers";

export * from "./mappers";

const OBE_CODE = "3040"; // Opening Balance Equity

/** Make sure 3040 Opening Balance Equity exists (older charts were seeded without it). */
async function ensureObe(companyId: string): Promise<void> {
  await pq(
    `INSERT INTO accounts (company_id, code, name_en, name_ar, type, sub_type, is_active, is_system_account)
     SELECT $1, '3040', 'Opening Balance Equity', 'حقوق ملكية الرصيد الافتتاحي', 'equity', 'owner_equity', true, true
      WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = $1 AND code = '3040')`,
    [companyId]
  );
}

export interface ImportIssue {
  row: number | null; // 1-based data row, null = file level
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ImportJobView {
  id: string;
  companyId: string;
  kind: ImportKind;
  sourceSystem: SourceSystem;
  status: string;
  fileName: string | null;
  cutOverDate: string | null;
  arApMode: string | null;
  rowCount: number;
  rows: Array<Record<string, unknown>>;
  issues: ImportIssue[];
  summary: Record<string, unknown>;
  result: Record<string, unknown> | null;
  journalEntryId: string | null;
  createdAt: Date;
  committedAt: Date | null;
}

interface JobRow {
  id: string;
  company_id: string;
  kind: ImportKind;
  source_system: SourceSystem;
  status: string;
  file_name: string | null;
  cut_over_date: string | null;
  ar_ap_mode: string | null;
  rows: string;
  issues: string;
  summary: string;
  result: string | null;
  journal_entry_id: string | null;
  created_at: Date;
  committed_at: Date | null;
}

function view(j: JobRow, rowLimit = 200): ImportJobView {
  const rows = JSON.parse(j.rows) as Array<Record<string, unknown>>;
  return {
    id: j.id,
    companyId: j.company_id,
    kind: j.kind,
    sourceSystem: j.source_system,
    status: j.status,
    fileName: j.file_name,
    cutOverDate: j.cut_over_date ? String(j.cut_over_date).slice(0, 10) : null,
    arApMode: j.ar_ap_mode,
    rowCount: rows.length,
    rows: rows.slice(0, rowLimit),
    issues: JSON.parse(j.issues),
    summary: JSON.parse(j.summary),
    result: j.result ? JSON.parse(j.result) : null,
    journalEntryId: j.journal_entry_id,
    createdAt: j.created_at,
    committedAt: j.committed_at,
  };
}

const JOB_COLS = `id, company_id, kind, source_system, status, file_name, cut_over_date::text AS cut_over_date,
  ar_ap_mode, rows, issues, summary, result, journal_entry_id, created_at, committed_at`;

async function loadJob(companyId: string, jobId: string): Promise<JobRow> {
  const { rows } = await pq<JobRow>(
    `SELECT ${JOB_COLS} FROM import_jobs WHERE id = $1 AND company_id = $2`,
    [jobId, companyId]
  );
  if (!rows[0]) throw new DomainError("NOT_FOUND", 404, undefined, "Import job not found");
  return rows[0];
}

export async function listImportJobs(companyId: string): Promise<ImportJobView[]> {
  const { rows } = await pq<JobRow>(
    `SELECT ${JOB_COLS} FROM import_jobs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [companyId]
  );
  return rows.map((r) => view(r, 0));
}

export async function getImportJob(companyId: string, jobId: string): Promise<ImportJobView> {
  return view(await loadJob(companyId, jobId));
}

// ─── Normalised rows per kind ────────────────────────────────────────────────

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function normaliseRows(
  kind: ImportKind,
  system: SourceSystem,
  records: Array<Record<string, string>>,
  issues: ImportIssue[]
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  records.forEach((r, i) => {
    const row = i + 1;
    const err = (code: string, message: string) =>
      issues.push({ row, level: "error", code, message });
    const warn = (code: string, message: string) =>
      issues.push({ row, level: "warning", code, message });
    switch (kind) {
      case "chart_of_accounts": {
        const code = clean(r.code);
        const name = clean(r.name);
        let mapped = mapAccountType(clean(r.type), name);
        const sub = clean(r.subType);
        if (mapped && sub && isSubTypeForType(mapped.type, sub))
          mapped = { ...mapped, subType: sub };
        if (!code) err("CODE_REQUIRED", "Account code is required");
        if (!name) err("NAME_REQUIRED", "Account name is required");
        if (!mapped) err("UNKNOWN_ACCOUNT_TYPE", `Unrecognised account type "${clean(r.type)}"`);
        out.push({
          code,
          name,
          nameAr: clean(r.nameAr) || null,
          type: mapped?.type ?? null,
          subType: mapped?.subType ?? null,
          sourceType: clean(r.type),
          description: clean(r.description) || null,
        });
        break;
      }
      case "trial_balance": {
        const split = splitCodeAndName(clean(r.code), r.name);
        const debit = moneyToFils(r.debit) ?? 0;
        const credit = moneyToFils(r.credit) ?? 0;
        let debitFils = Math.abs(debit) * (debit < 0 ? 0 : 1) + (credit < 0 ? Math.abs(credit) : 0);
        let creditFils =
          Math.abs(credit) * (credit < 0 ? 0 : 1) + (debit < 0 ? Math.abs(debit) : 0);
        if (!r.debit && !r.credit && r.balance) {
          const b = moneyToFils(r.balance) ?? 0;
          debitFils = b > 0 ? b : 0;
          creditFils = b < 0 ? -b : 0;
        }
        if (/^total/i.test(split.code) || /^total/i.test(split.name)) return; // report footer
        if (!split.code) {
          err("CODE_REQUIRED", "Account code is required");
          return;
        }
        if (
          (r.debit && moneyToFils(r.debit) === null) ||
          (r.credit && moneyToFils(r.credit) === null)
        ) {
          err("INVALID_AMOUNT", "Debit/credit must be amounts with at most 2 decimals");
        }
        if (debitFils === 0 && creditFils === 0) return;
        out.push({ code: split.code, name: split.name, debitFils, creditFils });
        break;
      }
      case "customers":
      case "vendors": {
        const name = clean(r.name);
        if (!name) {
          err("NAME_REQUIRED", "Name is required");
          return;
        }
        let trn = clean(r.trn).replace(/\s|-/g, "");
        if (trn && !/^\d{15}$/.test(trn)) {
          warn("INVALID_TRN", `TRN "${clean(r.trn)}" is not 15 digits and will be left blank`);
          trn = "";
        }
        out.push({
          name: name.slice(0, 300),
          email: clean(r.email) || null,
          phone: clean(r.phone) || null,
          trn: trn || null,
          address: clean(r.address) || null,
          city: clean(r.city) || null,
          country: clean(r.country) || null,
          iban: clean(r.iban) || null,
        });
        break;
      }
      case "items": {
        const name = clean(r.name);
        if (!name) {
          err("NAME_REQUIRED", "Item name is required");
          return;
        }
        const sale = moneyToFils(r.salePrice);
        const cost = moneyToFils(r.costPrice);
        if (r.salePrice && sale === null) err("INVALID_AMOUNT", "Sales price is not an amount");
        if (r.costPrice && cost === null) err("INVALID_AMOUNT", "Cost is not an amount");
        const service = /service|non-?inventory/i.test(clean(r.type));
        out.push({
          name: name.slice(0, 300),
          sku: clean(r.sku) || null,
          salePriceFils: Math.max(0, sale ?? 0),
          costPriceFils: Math.max(0, cost ?? 0),
          description: clean(r.description) || null,
          productType: service ? "service" : "inventory",
        });
        break;
      }
      case "open_invoices":
      case "open_bills": {
        const number = clean(r.number);
        const date = parseImportDate(r.date, system);
        const dueDate = r.dueDate ? parseImportDate(r.dueDate, system) : null;
        const total = moneyToFils(r.total);
        const due = r.amountDue ? moneyToFils(r.amountDue) : total;
        const currency = (clean(r.currency) || "AED").toUpperCase();
        if (!number) err("NUMBER_REQUIRED", "Document number is required");
        if (!date) err("INVALID_DATE", `Unrecognised date "${clean(r.date)}"`);
        if (r.dueDate && !dueDate) warn("INVALID_DUE_DATE", "Due date not recognised; left blank");
        if (!clean(r.contactName)) err("CONTACT_REQUIRED", "Customer / vendor name is required");
        if (total === null || total <= 0) err("INVALID_TOTAL", "Total must be a positive amount");
        if (due === null || due <= 0) {
          warn("NOTHING_DUE", "Nothing outstanding; row skipped");
          return;
        }
        if (total !== null && due > total) err("DUE_EXCEEDS_TOTAL", "Amount due exceeds the total");
        if (!/^[A-Z]{3}$/.test(currency)) {
          err("INVALID_CURRENCY", `Currency "${currency}" is not an ISO 4217 code`);
        }
        // S5: foreign-currency documents are supported. Amounts are in the document currency;
        // the rate (1 unit = rate base units) comes from the file or fx.getRate at the
        // document date during validation.
        let givenRate: number | null = null;
        if (clean(r.exchangeRate)) {
          const n = Number(clean(r.exchangeRate).replace(/,/g, ""));
          if (!Number.isFinite(n) || n <= 0) {
            err("INVALID_EXCHANGE_RATE", `Exchange rate "${clean(r.exchangeRate)}" is not valid`);
          } else givenRate = Number(n.toFixed(6));
        }
        out.push({
          number,
          date,
          dueDate,
          contactName: clean(r.contactName).slice(0, 300),
          totalFils: total,
          amountDueFils: due,
          currency,
          givenRate,
        });
        break;
      }
    }
  });
  return out;
}

// ─── Preview ─────────────────────────────────────────────────────────────────

export interface PreviewInput {
  companyId: string;
  userId: string;
  kind: ImportKind;
  sourceSystem: SourceSystem;
  csv: string;
  fileName?: string | null;
  cutOverDate?: string | null;
  arApMode?: "balance" | "documents" | null;
}

export async function previewImport(input: PreviewInput): Promise<ImportJobView> {
  const parsed = parseImportCsv(input.kind, input.csv);
  const issues: ImportIssue[] = [];
  const missing = REQUIRED_FIELDS[input.kind].filter((f) => !parsed.mapping[f]);
  if (
    input.kind === "trial_balance" &&
    !parsed.mapping.debit &&
    !parsed.mapping.credit &&
    !parsed.mapping.balance
  ) {
    missing.push("debit/credit");
  }
  for (const f of missing) {
    issues.push({
      row: null,
      level: "error",
      code: "COLUMN_MISSING",
      message: `No column found for "${f}". Headers seen: ${parsed.headers.join(", ")}`,
    });
  }
  const rows = missing.length
    ? []
    : normaliseRows(input.kind, input.sourceSystem, parsed.records, issues);
  if (!missing.length && !rows.length) {
    issues.push({
      row: null,
      level: "error",
      code: "NO_ROWS",
      message: "The file has no data rows",
    });
  }
  if (
    input.kind === "trial_balance" ||
    input.kind === "open_invoices" ||
    input.kind === "open_bills"
  ) {
    if (!input.cutOverDate) {
      issues.push({
        row: null,
        level: "error",
        code: "CUT_OVER_REQUIRED",
        message: "Choose the cut-over date",
      });
    }
  }
  const summary = {
    mapping: parsed.mapping,
    unmappedColumns: parsed.unmapped,
    detectedRows: parsed.records.length,
  };
  const { rows: inserted } = await pq<JobRow>(
    `INSERT INTO import_jobs (company_id, kind, source_system, status, file_name, cut_over_date,
                              ar_ap_mode, rows, issues, summary, created_by)
          VALUES ($1, $2, $3, 'previewed', $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${JOB_COLS}`,
    [
      input.companyId,
      input.kind,
      input.sourceSystem,
      input.fileName ?? null,
      input.cutOverDate ?? null,
      input.kind === "trial_balance" ? (input.arApMode ?? "balance") : null,
      JSON.stringify(rows),
      JSON.stringify(issues),
      JSON.stringify(summary),
      input.userId,
    ]
  );
  return view(inserted[0]);
}

// ─── Validation ──────────────────────────────────────────────────────────────

interface AccountRow {
  id: string;
  code: string;
  type: string;
  sub_type: string | null;
  is_active: boolean;
  is_archived: boolean;
}

async function companyAccounts(companyId: string): Promise<Map<string, AccountRow>> {
  const { rows } = await pq<AccountRow>(
    `SELECT id, code, type, sub_type, is_active, is_archived FROM accounts WHERE company_id = $1`,
    [companyId]
  );
  return new Map(rows.map((r) => [r.code, r]));
}

/**
 * B1 (NM5): the inventory control accounts (1070, any inventory sub-type account and each
 * product's inventory account). Their balance is the stock valuation (IAS 2), so an opening trial
 * balance may only carry it when the products' opening stock (quantities and costs) is recorded.
 */
async function inventoryAccountIds(companyId: string): Promise<Set<string>> {
  const { rows } = await pq<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND (code = '1070' OR sub_type = 'inventory')
     UNION
     SELECT inventory_account_id FROM products
      WHERE company_id = $1 AND inventory_account_id IS NOT NULL`,
    [companyId]
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * C1 (RM4): the control ledger of each trial-balance account (receivables, payables, VAT, GRNI,
 * payroll payables; a sub-account of a control account is one too). A control balance in the
 * opening trial balance needs the sub-ledger records that carry it, or the aging, VAT and payroll
 * ties can never hold: open invoices / bills (documents mode), the employees' opening gratuity
 * provisions, the products' opening stock.
 */
async function tbControlLedgers(
  companyId: string,
  accountIds: readonly string[]
): Promise<Map<string, ControlLedger>> {
  const hits = await controlAccountsAmong(companyId, accountIds);
  return new Map(hits.map((h) => [h.accountId, h.ledger]));
}

/** Employees' opening gratuity provisions recorded as of the cut-over date (fils). */
async function openingGratuityFils(companyId: string, cutOver: string | null): Promise<number> {
  try {
    const { rows } = await pq<{ f: string }>(
      `SELECT COALESCE(SUM(ROUND(opening_gratuity_provision * 100)), 0)::bigint::text AS f
         FROM employees
        WHERE company_id = $1 AND opening_gratuity_provision IS NOT NULL
          AND ($2::date IS NULL OR opening_gratuity_as_of IS NULL OR opening_gratuity_as_of <= $2::date)`,
      [companyId, cutOver]
    );
    return Number(rows[0]?.f ?? 0);
  } catch {
    return 0; // no payroll module tables
  }
}

const GRATUITY_CODE = "2036";

/**
 * D1 (N3): property, plant and equipment accounts carried by the asset register: every
 * fixed-asset sub-type account (cost and accumulated depreciation in the default chart) and every
 * account an asset or asset class posts to.
 */
async function ppeAccountIds(companyId: string): Promise<Set<string>> {
  const { rows } = await pq<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND sub_type = 'fixed_asset'
     UNION SELECT cost_account_id FROM fixed_assets
      WHERE company_id = $1 AND cost_account_id IS NOT NULL
     UNION SELECT accumulated_account_id FROM fixed_assets
      WHERE company_id = $1 AND accumulated_account_id IS NOT NULL
     UNION SELECT cost_account_id FROM fixed_asset_classes
      WHERE company_id = $1 AND cost_account_id IS NOT NULL
     UNION SELECT accumulated_account_id FROM fixed_asset_classes
      WHERE company_id = $1 AND accumulated_account_id IS NOT NULL`,
    [companyId]
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * D1 (N3): the asset register's opening capitalisations per account (net debit, fils): the
 * register entries posted against Opening Balance Equity (entry kind 'opening'; before D1 they
 * were 'standard' and are recognised by their 3040 leg).
 */
async function registerOpeningFils(companyId: string): Promise<Map<string, number>> {
  const { rows } = await pq<{ account_id: string; f: string }>(
    `SELECT jl.account_id, SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100))::bigint::text AS f
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = 'fixed_asset'
        AND a.code <> '3040'
        AND (je.entry_kind = 'opening' OR EXISTS (
              SELECT 1 FROM journal_lines ol JOIN accounts oa ON oa.id = ol.account_id
               WHERE ol.entry_id = je.id AND oa.code = '3040'))
      GROUP BY jl.account_id`,
    [companyId]
  );
  const out = new Map<string, number>();
  for (const r of rows) if (Number(r.f) !== 0) out.set(r.account_id, Number(r.f));
  return out;
}

/**
 * D1 (N4): whether `date` is the last day of one of the company's VAT tax periods (monthly,
 * quarterly from vat_period_start_month, or annual). A cut-over strictly inside a period leaves
 * that period's return to be filed here.
 */
async function isVatPeriodEnd(companyId: string, date: string): Promise<boolean> {
  const { rows } = await pq<{ freq: string | null; start: number | null }>(
    `SELECT vat_filing_frequency AS freq, vat_period_start_month AS start FROM companies WHERE id = $1`,
    [companyId]
  );
  const d = new Date(`${date}T00:00:00Z`);
  const next = new Date(d.getTime() + 86_400_000);
  if (next.getUTCDate() !== 1) return false; // not a month end
  const month = d.getUTCMonth() + 1;
  const start = rows[0]?.start && rows[0].start >= 1 && rows[0].start <= 12 ? rows[0].start : 1;
  const freq = String(rows[0]?.freq ?? "quarterly").toLowerCase();
  const offset = (month - start + 12) % 12;
  if (freq.startsWith("month")) return true;
  if (freq.startsWith("annual") || freq.startsWith("year")) return offset === 11;
  return offset % 3 === 2;
}

/**
 * D1 (N3): an opening trial balance is committed. The asset register's opening import is then
 * refused: the trial balance already set the opening position (with the register's PPE in it).
 */
export async function openingTrialBalanceCommitted(companyId: string): Promise<boolean> {
  const { rows } = await pq<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM import_jobs
      WHERE company_id = $1 AND kind = 'trial_balance' AND status = 'committed'`,
    [companyId]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * D1 (N14): balances a documents-mode opening trial balance moved to Opening Balance Equity for
 * open invoices / bills that have not been imported yet (fils; zero when complete).
 */
export async function pendingOpeningDocuments(
  companyId: string
): Promise<{ cutOver: string; receivablesFils: number; payablesFils: number } | null> {
  const state = await openingState(companyId);
  if (!state.tb || state.tb.mode !== "documents") return null;
  return {
    cutOver: state.tb.cutOver,
    receivablesFils: state.tb.arFils - state.invoicesFils,
    payablesFils: state.tb.apFils - state.billsFils,
  };
}

function isReceivableAccount(acct: AccountRow | undefined, ledger: ControlLedger | undefined) {
  return !!acct && (acct.sub_type === "receivable" || ledger === "receivables");
}

function isPayableAccount(acct: AccountRow | undefined, ledger: ControlLedger | undefined) {
  return !!acct && (acct.sub_type === "payable" || ledger === "payables");
}

/** Stock value recorded on the company's stocked products (fils). */
async function stockValueFils(companyId: string): Promise<number> {
  const { rows } = await pq<{ f: string }>(
    `SELECT COALESCE(SUM(ROUND(COALESCE(stock_value, 0) * 100)), 0)::bigint::text AS f
       FROM products WHERE company_id = $1 AND product_type = 'inventory'
        AND track_inventory IS NOT FALSE`,
    [companyId]
  );
  return Number(rows[0]?.f ?? 0);
}

interface OpeningState {
  /** Committed opening trial balance, if any. */
  tb: { id: string; mode: string; arFils: number; apFils: number; cutOver: string } | null;
  /** Totals of open documents already committed (fils). */
  invoicesFils: number;
  billsFils: number;
}

async function openingState(companyId: string): Promise<OpeningState> {
  const { rows } = await pq<{
    id: string;
    kind: string;
    ar_ap_mode: string | null;
    summary: string;
    cut_over_date: string | null;
  }>(
    `SELECT id, kind, ar_ap_mode, summary, cut_over_date::text AS cut_over_date FROM import_jobs
      WHERE company_id = $1 AND status = 'committed'
        AND kind IN ('trial_balance', 'open_invoices', 'open_bills')`,
    [companyId]
  );
  const state: OpeningState = { tb: null, invoicesFils: 0, billsFils: 0 };
  for (const r of rows) {
    const s = JSON.parse(r.summary) as Record<string, number>;
    if (r.kind === "trial_balance") {
      state.tb = {
        id: r.id,
        mode: r.ar_ap_mode ?? "balance",
        arFils: Number(s.arControlFils ?? 0),
        apFils: Number(s.apControlFils ?? 0),
        cutOver: String(r.cut_over_date).slice(0, 10),
      };
    } else if (r.kind === "open_invoices") state.invoicesFils += Number(s.controlTotalFils ?? 0);
    else state.billsFils += Number(s.controlTotalFils ?? 0);
  }
  return state;
}

async function companyBaseCurrency(companyId: string): Promise<string> {
  const { rows } = await pq<{ base_currency: string | null }>(
    `SELECT base_currency FROM companies WHERE id = $1`,
    [companyId]
  );
  return (rows[0]?.base_currency || "AED").toUpperCase();
}

/**
 * S5: resolve each open document's rate (file column, else fx.getRate at the document date,
 * tenant-scoped) and its outstanding amount in the company base currency. Mutates `rows`:
 * exchangeRate, amountDueBaseFils, baseCurrency, foreign. A missing rate is an error; a stale
 * rate is a warning (the settlement books realised FX against this rate either way).
 */
async function resolveDocumentRates(
  companyId: string,
  rows: Array<Record<string, unknown>>,
  err: (row: number | null, code: string, message: string) => void,
  warn: (row: number | null, code: string, message: string) => void
): Promise<void> {
  const base = await companyBaseCurrency(companyId);
  const getRate = resolve<FxGetRate>("fx.getRate");
  for (const [i, r] of rows.entries()) {
    const currency = String(r.currency || base).toUpperCase();
    const due = Number(r.amountDueFils);
    r.baseCurrency = base;
    if (currency === base) {
      r.exchangeRate = 1;
      r.amountDueBaseFils = due;
      r.foreign = false;
      continue;
    }
    r.foreign = true;
    let rate = typeof r.givenRate === "number" && r.givenRate > 0 ? r.givenRate : null;
    if (rate === null) {
      try {
        const found = await getRate(companyId, currency, base, String(r.date));
        rate = found.rate;
        if (found.stale) {
          warn(
            i + 1,
            "STALE_EXCHANGE_RATE",
            `The ${currency}/${base} rate on file is ${found.ageDays} day(s) older than ${r.date}; add the document-date rate or a rate column for an exact opening balance`
          );
        }
      } catch {
        err(
          i + 1,
          "NO_EXCHANGE_RATE",
          `No ${currency}/${base} exchange rate for ${r.date}: add it under Exchange Rates or include a rate column`
        );
        r.exchangeRate = null;
        r.amountDueBaseFils = 0;
        continue;
      }
    }
    r.exchangeRate = rate;
    r.amountDueBaseFils = mulRate(due, rate);
  }
}

export async function validateImport(companyId: string, jobId: string): Promise<ImportJobView> {
  const job = await loadJob(companyId, jobId);
  if (job.status === "committed") throw new DomainError("IMPORT_ALREADY_COMMITTED", 409);
  const rows = JSON.parse(job.rows) as Array<Record<string, unknown>>;
  // Keep parse-time issues; replace earlier validation issues.
  const issues = (JSON.parse(job.issues) as ImportIssue[]).filter((i) => !i.code.startsWith("V_"));
  const summary = JSON.parse(job.summary) as Record<string, unknown>;
  const err = (row: number | null, code: string, message: string) =>
    issues.push({ row, level: "error", code: `V_${code}`, message });
  const warn = (row: number | null, code: string, message: string) =>
    issues.push({ row, level: "warning", code: `V_${code}`, message });
  const cutOver = job.cut_over_date ? String(job.cut_over_date).slice(0, 10) : null;
  if (cutOver && cutOver > new Date().toISOString().slice(0, 10)) {
    err(null, "CUT_OVER_IN_FUTURE", "The cut-over date cannot be in the future");
  }

  switch (job.kind) {
    case "chart_of_accounts": {
      const existing = await companyAccounts(companyId);
      const seen = new Set<string>();
      let creating = 0;
      rows.forEach((r, i) => {
        const code = String(r.code);
        if (seen.has(code)) err(i + 1, "DUPLICATE_CODE", `Code ${code} appears twice in the file`);
        seen.add(code);
        if (existing.has(code))
          warn(i + 1, "CODE_EXISTS", `Account ${code} already exists and will be kept as is`);
        else creating++;
      });
      summary.accountsToCreate = creating;
      break;
    }
    case "trial_balance": {
      const existing = await companyAccounts(companyId);
      const state = await openingState(companyId);
      const inventoryIds = await inventoryAccountIds(companyId);
      const ppeIds = await ppeAccountIds(companyId);
      const ppeByAccount = new Map<string, number>();
      let vatFils = 0;
      const ledgers = await tbControlLedgers(
        companyId,
        rows.map((r) => existing.get(String(r.code))?.id ?? "")
      );
      let gratuityFils = 0;
      const otherControl = new Map<ControlLedger, Set<string>>();
      let debit = 0;
      let credit = 0;
      let arFils = 0;
      let apFils = 0;
      let inventoryFils = 0;
      const perCode = new Map<string, number>();
      let periodEnd: boolean | null = null;
      const vatCutOverIsPeriodEnd = async () =>
        (periodEnd ??= cutOver ? await isVatPeriodEnd(companyId, cutOver) : true);
      for (const [i, r] of rows.entries()) {
        const code = String(r.code);
        const acct = existing.get(code);
        if (!acct)
          err(
            i + 1,
            "UNKNOWN_ACCOUNT",
            `Account ${code} is not in the chart of accounts; import the chart first`
          );
        else if (!acct.is_active || acct.is_archived)
          err(i + 1, "ACCOUNT_INACTIVE", `Account ${code} is inactive`);
        const d = Number(r.debitFils);
        const c = Number(r.creditFils);
        debit += d;
        credit += c;
        perCode.set(code, (perCode.get(code) ?? 0) + d - c);
        const ledger = acct ? ledgers.get(acct.id) : undefined;
        if (isReceivableAccount(acct, ledger)) arFils += d - c;
        if (isPayableAccount(acct, ledger)) apFils += c - d;
        if (acct && ppeIds.has(acct.id) && !inventoryIds.has(acct.id)) {
          ppeByAccount.set(acct.id, (ppeByAccount.get(acct.id) ?? 0) + d - c);
        }
        if (acct && ledger === "vat") vatFils += c - d;
        if (acct && d !== c && !inventoryIds.has(acct.id)) {
          if (ledger === "payroll" && code === GRATUITY_CODE) gratuityFils += c - d;
          else if (ledger === "vat" && cutOver && !(await vatCutOverIsPeriodEnd())) {
            // D1 (N4): checked below; the cut-over is inside an open tax period.
          } else if (ledger === "payroll" || ledger === "vat" || ledger === "grni") {
            const set = otherControl.get(ledger) ?? new Set<string>();
            set.add(code);
            otherControl.set(ledger, set);
          }
        }
        if (acct && inventoryIds.has(acct.id)) inventoryFils += d - c;
        if (acct && (acct.type === "income" || acct.type === "expense")) {
          warn(
            i + 1,
            "PL_ACCOUNT",
            `Account ${code} is a P&L account: its year-to-date balance is posted on the cut-over date`
          );
        }
      }
      if (debit !== credit) {
        err(
          null,
          "UNBALANCED",
          `Debits (${fromFils(debit)}) and credits (${fromFils(credit)}) differ by ${fromFils(Math.abs(debit - credit))}`
        );
      }
      if (state.tb)
        err(
          null,
          "OPENING_ALREADY_IMPORTED",
          "An opening trial balance has already been imported for this company"
        );
      const mode = job.ar_ap_mode ?? "balance";
      if (mode === "balance" && (state.invoicesFils || state.billsFils)) {
        err(
          null,
          "DOCUMENTS_ALREADY_IMPORTED",
          "Open invoices or bills were already imported and carry A/R and A/P; import this trial balance in 'documents' mode"
        );
      }
      if (mode === "documents") {
        if (state.invoicesFils && state.invoicesFils !== arFils) {
          err(
            null,
            "AR_CONTROL_MISMATCH",
            `A/R in the trial balance (${fromFils(arFils)}) differs from the open invoices imported (${fromFils(state.invoicesFils)})`
          );
        }
        if (state.billsFils && state.billsFils !== apFils) {
          err(
            null,
            "AP_CONTROL_MISMATCH",
            `A/P in the trial balance (${fromFils(apFils)}) differs from the open bills imported (${fromFils(state.billsFils)})`
          );
        }
        if (!existing.has(OBE_CODE))
          warn(null, "OBE_CREATED", "Account 3040 Opening Balance Equity will be created");
      }
      // C1 (RM4): a receivable or payable balance needs its open documents, otherwise the A/R and
      // A/P aging can never tie to 1040 / 2010 and the balance can never be receipted or paid
      // (a bank line coded to a control account is refused).
      if (mode === "balance" && arFils !== 0) {
        err(
          null,
          "AR_WITHOUT_DOCUMENTS",
          `The trial balance carries accounts receivable of ${fromFils(arFils)} with no customer invoices behind it. ` +
            "Import it in 'documents' mode and import the open invoices (Customers, open invoices): each invoice then carries its share of the receivable and can be receipted."
        );
      }
      if (mode === "balance" && apFils !== 0) {
        err(
          null,
          "AP_WITHOUT_DOCUMENTS",
          `The trial balance carries accounts payable of ${fromFils(apFils)} with no supplier bills behind it. ` +
            "Import it in 'documents' mode and import the open bills (Suppliers, open bills): each bill then carries its share of the payable and can be paid."
        );
      }
      // The gratuity provision (2036) is carried by each employee's opening provision, which the
      // final settlement uses and the gratuity tie reads.
      if (gratuityFils !== 0) {
        const employeesFils = await openingGratuityFils(companyId, cutOver);
        if (employeesFils !== gratuityFils) {
          err(
            null,
            "GRATUITY_WITHOUT_EMPLOYEES",
            `The end-of-service gratuity provision in the trial balance (${fromFils(gratuityFils)}) must equal the opening gratuity provisions recorded on your employees (${fromFils(employeesFils)}). ` +
              "Add the employees with their opening gratuity provision as of the cut-over date first (Payroll, employees)."
          );
        }
      }
      if (gratuityFils === 0) {
        const employeesFils = await openingGratuityFils(companyId, cutOver);
        if (employeesFils !== 0) {
          warn(
            null,
            "GRATUITY_NOT_IN_TB",
            `Your employees carry opening gratuity provisions of ${fromFils(employeesFils)}, already booked to 2036 against Opening Balance Equity 3040; this trial balance has no 2036 balance, so 3040 keeps that amount.`
          );
        }
      }
      // D1 (N3): property, plant and equipment is carried by the asset register's opening import
      // (cost and accumulated depreciation per asset, so it is depreciated and derecognised from
      // the register). The trial balance's PPE must equal the register per account; the register
      // posts it and the trial balance moves its lines to 3040.
      const register = await registerOpeningFils(companyId);
      const ppeTb = [...ppeByAccount.entries()].filter(([, f]) => f !== 0);
      if (ppeTb.length) {
        const codeOf = new Map([...existing.values()].map((a) => [a.id, a.code]));
        const ids = new Set([...ppeTb.map(([id]) => id), ...register.keys()]);
        const diffs = [...ids]
          .map((id) => ({ id, tb: ppeByAccount.get(id) ?? 0, reg: register.get(id) ?? 0 }))
          .filter((x) => x.tb !== x.reg)
          .map(
            (x) =>
              `${codeOf.get(x.id) ?? x.id}: trial balance ${fromFils(x.tb)}, register ${fromFils(x.reg)}`
          );
        if (diffs.length) {
          err(
            null,
            register.size ? "PPE_REGISTER_MISMATCH" : "PPE_WITHOUT_REGISTER",
            `Property, plant and equipment in the trial balance must equal the opening balances of your fixed-asset register (${diffs.join("; ")}). ` +
              "Import the asset register first (Fixed assets, import, with opening balances: cost and accumulated depreciation per asset); the register then carries these balances and depreciates them."
          );
        } else if (!existing.has(OBE_CODE)) {
          warn(null, "OBE_CREATED", "Account 3040 Opening Balance Equity will be created");
        }
      } else if (register.size) {
        warn(
          null,
          "PPE_NOT_IN_TB",
          "Your fixed-asset register already carries opening balances against Opening Balance Equity 3040; this trial balance has no property, plant and equipment, so 3040 keeps them."
        );
      }
      // D1 (N4): VAT of the tax period that contains the cut-over date (not yet filed) may sit on
      // the VAT accounts: that period's return here reports it in the adjustment column (Box 1 /
      // Box 9 of the company's emirate) and its settlement clears it, so 2020 / 1050 return to 0.
      if (vatFils !== 0 && cutOver && !(await vatCutOverIsPeriodEnd())) {
        warn(
          null,
          "VAT_OPENING_IN_RETURN",
          `The VAT balance in this trial balance (net output ${fromFils(vatFils)}) is the VAT of the tax period that contains the cut-over date ${cutOver}. ` +
            "That period's VAT return here reports it as an adjustment and its payment or refund clears it; do not add a return adjustment for it as well. VAT of returns already filed before go-live belongs on 2040 Accrued Expenses."
        );
      }
      // VAT, goods received not invoiced and the payroll payables have no opening document: the
      // VAT return, the purchase-order receipts and the payroll runs are their only writers.
      const guidance: Record<string, [string, string]> = {
        vat: [
          "VAT_IN_OPENING",
          "At this cut-over date (the end of a VAT tax period) the VAT balance belongs to a return filed outside Muhasib, not to a return kept here. Carry it on a non-VAT current liability or asset (for example 2040 Accrued Expenses) and pay or receive it from there. (With a cut-over inside a tax period, that period's VAT may stay on the VAT accounts: its return here reports and settles it.)",
        ],
        grni: [
          "GRNI_IN_OPENING",
          "Goods received not invoiced is cleared by purchase-order receipts and their bills. Carry an opening accrual on 2040 Accrued Expenses instead.",
        ],
        payroll: [
          "PAYROLL_PAYABLE_IN_OPENING",
          "Salaries, pension and deductions payable are kept by payroll runs. Carry amounts unpaid at the cut-over date on 2040 Accrued Expenses and pay them from there.",
        ],
      };
      for (const [ledger, codes] of otherControl) {
        const [code, text] = guidance[ledger];
        err(
          null,
          code,
          `Control account${codes.size > 1 ? "s" : ""} ${[...codes].sort().join(", ")} cannot take an opening balance. ${text}`
        );
      }
      // B1 (NM5): inventory in the opening balance is carried by the opening stock, like A/R and
      // A/P by open documents. Without stock behind it the valuation (0) and GL 1070 would
      // never tie, and the stock could not be costed when it is sold.
      if (inventoryFils !== 0) {
        const stockFils = await stockValueFils(companyId);
        if (stockFils !== inventoryFils) {
          err(
            null,
            "INVENTORY_WITHOUT_STOCK",
            `Inventory in the trial balance (${fromFils(inventoryFils)}) must equal the opening stock recorded on your products (${fromFils(stockFils)}). ` +
              "Record each product's opening quantity and unit cost first (Inventory, opening stock); the stock then carries the inventory balance."
          );
        } else if (!existing.has(OBE_CODE)) {
          warn(null, "OBE_CREATED", "Account 3040 Opening Balance Equity will be created");
        }
      }
      Object.assign(summary, {
        totalDebitFils: debit,
        totalCreditFils: credit,
        arControlFils: arFils,
        apControlFils: apFils,
        inventoryFils,
        accounts: perCode.size,
      });
      break;
    }
    case "customers":
    case "vendors": {
      const table = job.kind === "customers" ? "customer_contacts" : "vendors";
      const { rows: names } = await pq<{ n: string }>(
        `SELECT lower(name) AS n FROM ${table} WHERE company_id = $1`,
        [companyId]
      );
      const existing = new Set(names.map((x) => x.n));
      const seen = new Set<string>();
      let creating = 0;
      rows.forEach((r, i) => {
        const n = String(r.name).toLowerCase();
        if (existing.has(n))
          warn(i + 1, "EXISTS", `"${r.name}" already exists and will be skipped`);
        else if (seen.has(n)) warn(i + 1, "DUPLICATE", `"${r.name}" appears twice; imported once`);
        else creating++;
        seen.add(n);
      });
      summary.toCreate = creating;
      break;
    }
    case "items": {
      const { rows: prods } = await pq<{ n: string; sku: string | null }>(
        `SELECT lower(name) AS n, lower(sku) AS sku FROM products WHERE company_id = $1`,
        [companyId]
      );
      const names = new Set(prods.map((p) => p.n));
      const skus = new Set(prods.map((p) => p.sku).filter(Boolean));
      let creating = 0;
      rows.forEach((r, i) => {
        if (r.sku && skus.has(String(r.sku).toLowerCase()))
          warn(i + 1, "SKU_EXISTS", `SKU ${r.sku} exists; skipped`);
        else if (names.has(String(r.name).toLowerCase()))
          warn(i + 1, "EXISTS", `"${r.name}" exists; skipped`);
        else creating++;
        if (r.productType === "inventory") {
          warn(
            i + 1,
            "NO_OPENING_STOCK",
            "Imported without stock: record opening stock with an inventory adjustment"
          );
        }
      });
      summary.toCreate = creating;
      break;
    }
    case "open_invoices":
    case "open_bills": {
      const invoicesKind = job.kind === "open_invoices";
      const existing = await companyAccounts(companyId);
      const control = [...existing.values()].find(
        (a) => a.sub_type === (invoicesKind ? "receivable" : "payable")
      );
      if (!control)
        err(
          null,
          "CONTROL_ACCOUNT_MISSING",
          `No ${invoicesKind ? "A/R" : "A/P"} control account in the chart`
        );
      if (!existing.has(OBE_CODE))
        warn(null, "OBE_CREATED", "Account 3040 Opening Balance Equity will be created");
      const nums = invoicesKind
        ? (
            await pq<{ n: string }>(`SELECT number AS n FROM invoices WHERE company_id = $1`, [
              companyId,
            ])
          ).rows
        : (
            await pq<{ n: string }>(
              `SELECT COALESCE(origin_ref, bill_number) AS n FROM vendor_bills WHERE company_id = $1`,
              [companyId]
            )
          ).rows;
      const taken = new Set(nums.map((x) => String(x.n)));
      const seen = new Set<string>();
      let total = 0;
      await resolveDocumentRates(companyId, rows, err, warn);
      rows.forEach((r, i) => {
        const n = String(r.number);
        if (taken.has(n) || seen.has(n))
          err(i + 1, "DUPLICATE_NUMBER", `Document ${n} already exists`);
        seen.add(n);
        if (cutOver && r.date && String(r.date) > cutOver) {
          err(
            i + 1,
            "AFTER_CUT_OVER",
            `Document ${n} is dated after the cut-over date; enter it as a normal document`
          );
        }
        total += Number(r.amountDueBaseFils ?? r.amountDueFils);
      });
      const foreign = rows.filter((r) => r.foreign === true).length;
      if (foreign) summary.foreignCurrencyDocuments = foreign;
      const state = await openingState(companyId);
      if (state.tb) {
        const tbControl = invoicesKind ? state.tb.arFils : state.tb.apFils;
        const already = invoicesKind ? state.invoicesFils : state.billsFils;
        if (state.tb.mode === "balance" && tbControl !== 0) {
          err(
            null,
            "CONTROL_IN_OPENING_BALANCE",
            `The opening trial balance already posted ${invoicesKind ? "A/R" : "A/P"} (${fromFils(tbControl)}) as a balance; importing open documents would count it twice`
          );
        } else if (state.tb.mode === "documents" && already + total !== tbControl) {
          err(
            null,
            "CONTROL_TOTAL_MISMATCH",
            `Open documents (${fromFils(already + total)}) must equal the ${invoicesKind ? "A/R" : "A/P"} balance of the opening trial balance (${fromFils(tbControl)})`
          );
        }
        if (cutOver && state.tb.cutOver !== cutOver) {
          err(null, "CUT_OVER_MISMATCH", `Use the trial balance cut-over date ${state.tb.cutOver}`);
        }
      } else {
        warn(
          null,
          "NO_OPENING_TB",
          "Until the opening trial balance is imported (in 'documents' mode) the offset sits in Opening Balance Equity"
        );
      }
      summary.controlTotalFils = total;
      summary.documents = rows.length;
      break;
    }
  }

  const hasErrors = issues.some((i) => i.level === "error");
  const { rows: updated } = await pq<JobRow>(
    `UPDATE import_jobs SET status = $3, issues = $4, summary = $5, rows = $6, validated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING ${JOB_COLS}`,
    [
      jobId,
      companyId,
      hasErrors ? "previewed" : "validated",
      JSON.stringify(issues),
      JSON.stringify(summary),
      JSON.stringify(rows),
    ]
  );
  return view(updated[0]);
}

// ─── Commit ──────────────────────────────────────────────────────────────────

export async function commitImport(
  companyId: string,
  jobId: string,
  userId: string
): Promise<ImportJobView> {
  // Re-validate against the current books; refuse when anything is wrong now.
  const validated = await validateImport(companyId, jobId);
  if (validated.status !== "validated") {
    throw new DomainError(
      "IMPORT_HAS_ERRORS",
      422,
      { issues: validated.issues.filter((i) => i.level === "error") },
      "Fix the errors before committing this import"
    );
  }
  const claimed = await pq<JobRow>(
    `UPDATE import_jobs SET status = 'committing' WHERE id = $1 AND company_id = $2 AND status = 'validated'
      RETURNING ${JOB_COLS}`,
    [jobId, companyId]
  );
  const job = claimed.rows[0];
  if (!job) throw new DomainError("IMPORT_ALREADY_COMMITTED", 409);
  const rows = JSON.parse(job.rows) as Array<Record<string, unknown>>;
  const summary = JSON.parse(job.summary) as Record<string, unknown>;
  const cutOver = job.cut_over_date ? String(job.cut_over_date).slice(0, 10) : null;
  try {
    let result: Record<string, unknown>;
    let journalEntryId: string | null = null;
    switch (job.kind) {
      case "chart_of_accounts":
        result = await commitAccounts(companyId, rows);
        break;
      case "trial_balance": {
        const r = await commitTrialBalance(companyId, job, rows, userId);
        journalEntryId = r.entryId;
        result = r;
        break;
      }
      case "customers":
        result = await commitContacts(companyId, rows, "customers");
        break;
      case "vendors":
        result = await commitContacts(companyId, rows, "vendors");
        break;
      case "items":
        result = await commitItems(companyId, rows);
        break;
      case "open_invoices":
        result = await commitOpenInvoices(companyId, cutOver!, rows, userId, job.source_system);
        break;
      case "open_bills":
        result = await commitOpenBills(companyId, cutOver!, rows, userId, job.source_system);
        break;
    }
    const { rows: done } = await pq<JobRow>(
      `UPDATE import_jobs SET status = 'committed', committed_at = now(), result = $3, summary = $4,
              journal_entry_id = $5
        WHERE id = $1 AND company_id = $2 RETURNING ${JOB_COLS}`,
      [jobId, companyId, JSON.stringify(result!), JSON.stringify(summary), journalEntryId]
    );
    return view(done[0]);
  } catch (err) {
    await pq(
      `UPDATE import_jobs SET status = 'failed', result = $3 WHERE id = $1 AND company_id = $2`,
      [jobId, companyId, JSON.stringify({ error: (err as Error).message })]
    );
    throw err;
  }
}

async function commitAccounts(companyId: string, rows: Array<Record<string, unknown>>) {
  const existing = await companyAccounts(companyId);
  let created = 0;
  await db.transaction(async (tx: typeof db) => {
    for (const r of rows) {
      if (existing.has(String(r.code))) continue;
      await tx.insert(accounts).values({
        companyId,
        code: String(r.code),
        nameEn: String(r.name),
        nameAr: (r.nameAr as string | null) ?? null,
        type: String(r.type),
        subType: (r.subType as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        isSystemAccount: false,
        isActive: true,
      } as typeof accounts.$inferInsert);
      existing.set(String(r.code), {} as AccountRow);
      created++;
    }
  });
  return { accountsCreated: created, skipped: rows.length - created };
}

async function commitTrialBalance(
  companyId: string,
  job: JobRow,
  rows: Array<Record<string, unknown>>,
  userId: string
) {
  const mode = job.ar_ap_mode ?? "balance";
  const inventoryIds = await inventoryAccountIds(companyId);
  let existing = await companyAccounts(companyId);
  const touchesInventory = rows.some((r) => {
    const a = existing.get(String(r.code));
    return !!a && inventoryIds.has(a.id) && Number(r.debitFils) !== Number(r.creditFils);
  });
  if (mode === "documents" || touchesInventory) {
    await ensureObe(companyId);
    existing = await companyAccounts(companyId);
  }
  const net = new Map<string, number>();
  for (const r of rows) {
    net.set(
      String(r.code),
      (net.get(String(r.code)) ?? 0) + Number(r.debitFils) - Number(r.creditFils)
    );
  }
  let deferred = 0; // net debit moved to Opening Balance Equity
  let deferredInventory = 0; // B1 (NM5): carried by the opening stock already recorded
  let deferredGratuity = 0; // D1 (N1): carried by the employees' opening provisions
  let deferredPpe = 0; // D1 (N3): carried by the asset register's opening import
  const ppeIds = await ppeAccountIds(companyId);
  const ledgers = await tbControlLedgers(
    companyId,
    [...net.keys()].map((code) => existing.get(code)?.id ?? "")
  );
  const lines: PostJournalLineInput[] = [];
  for (const [code, fils] of net) {
    if (fils === 0) continue;
    const acct = existing.get(code)!;
    const ledger = ledgers.get(acct.id);
    if (
      mode === "documents" &&
      (isReceivableAccount(acct, ledger) || isPayableAccount(acct, ledger))
    ) {
      deferred += fils;
      continue;
    }
    if (inventoryIds.has(acct.id)) {
      deferredInventory += fils;
      continue;
    }
    if (ledger === "payroll" && code === GRATUITY_CODE) {
      deferredGratuity += fils;
      continue;
    }
    if (ppeIds.has(acct.id)) {
      deferredPpe += fils;
      continue;
    }
    // C1 (RM4): validateImport refused every other control balance. D1 (N4): VAT of the open
    // tax period is posted on the VAT accounts as their own opening leg (the return settles it).
    const leg = ledger === "vat" ? { controlLeg: ledger } : {};
    lines.push(
      fils > 0
        ? { accountId: acct.id, debitFils: fils, description: "Opening balance", ...leg }
        : { accountId: acct.id, creditFils: -fils, description: "Opening balance", ...leg }
    );
  }
  if (deferred !== 0) {
    const obe = existing.get(OBE_CODE)!;
    lines.push(
      deferred > 0
        ? {
            accountId: obe.id,
            debitFils: deferred,
            description: "A/R and A/P carried by open documents",
          }
        : {
            accountId: obe.id,
            creditFils: -deferred,
            description: "A/R and A/P carried by open documents",
          }
    );
  }
  if (deferredInventory !== 0) {
    const obe = existing.get(OBE_CODE)!;
    lines.push(
      deferredInventory > 0
        ? {
            accountId: obe.id,
            debitFils: deferredInventory,
            description: "Inventory carried by opening stock",
          }
        : {
            accountId: obe.id,
            creditFils: -deferredInventory,
            description: "Inventory carried by opening stock",
          }
    );
  }
  const moved: Array<[number, string]> = [
    [deferredGratuity, "Gratuity provision carried by the employees' opening provisions"],
    [deferredPpe, "Property, plant and equipment carried by the asset register"],
  ];
  for (const [amount, description] of moved) {
    if (amount === 0) continue;
    if (!existing.has(OBE_CODE)) {
      await ensureObe(companyId);
      existing = await companyAccounts(companyId);
    }
    const obe = existing.get(OBE_CODE)!;
    lines.push(
      amount > 0
        ? { accountId: obe.id, debitFils: amount, description }
        : { accountId: obe.id, creditFils: -amount, description }
    );
  }
  return withLedgerTx(async (tx) => {
    const { entry, lines: posted } = await postJournal(
      {
        companyId,
        date: String(job.cut_over_date).slice(0, 10),
        memo: `Opening balances (${job.source_system} trial balance${job.file_name ? `: ${job.file_name}` : ""})`,
        source: "opening_balance",
        sourceId: job.id,
        idempotencyKey: `import:opening-balance:${companyId}`,
        status: "posted",
        kind: "opening",
        lines,
      },
      { actorId: userId, audit: true, tx }
    );
    // D1 (N1): the employees' opening provisions post the 2036 the trial balance moved to 3040
    // (only what is not booked yet), in the same transaction.
    const gratuity = await syncOpeningGratuity(companyId, userId, tx);
    return {
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      lines: posted.length,
      arApMode: mode,
      openingGratuityEntries: gratuity.map((g) => g.journalEntryId),
    };
  });
}

async function commitContacts(
  companyId: string,
  rows: Array<Record<string, unknown>>,
  kind: "customers" | "vendors"
) {
  const table = kind === "customers" ? "customer_contacts" : "vendors";
  const { rows: names } = await pq<{ n: string }>(
    `SELECT lower(name) AS n FROM ${table} WHERE company_id = $1`,
    [companyId]
  );
  const seen = new Set(names.map((x) => x.n));
  const created: string[] = [];
  for (const r of rows) {
    const key = String(r.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (kind === "customers") {
      const [c] = await db
        .insert(customerContacts)
        .values({
          companyId,
          name: String(r.name),
          email: (r.email as string) ?? null,
          phone: (r.phone as string) ?? null,
          trnNumber: (r.trn as string) ?? null,
          address: (r.address as string) ?? null,
          city: (r.city as string) ?? null,
          country: (r.country as string) ?? "UAE",
        } as typeof customerContacts.$inferInsert)
        .returning({ id: customerContacts.id });
      created.push(c.id);
      emitDomainEvent("contact.created", { companyId, entityId: c.id, kind: "customer" });
    } else {
      const { rows: v } = await pq<{ id: string }>(
        `INSERT INTO vendors (company_id, name, email, phone, trn, address, iban)
              VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          companyId,
          r.name,
          r.email ?? null,
          r.phone ?? null,
          r.trn ?? null,
          r.address ?? null,
          r.iban ?? null,
        ]
      );
      created.push(v[0].id);
      emitDomainEvent("contact.created", { companyId, entityId: v[0].id, kind: "vendor" });
    }
  }
  return { created: created.length, skipped: rows.length - created.length };
}

async function commitItems(companyId: string, rows: Array<Record<string, unknown>>) {
  const { rows: prods } = await pq<{ n: string; sku: string | null }>(
    `SELECT lower(name) AS n, lower(sku) AS sku FROM products WHERE company_id = $1`,
    [companyId]
  );
  const names = new Set(prods.map((p) => p.n));
  const skus = new Set(prods.map((p) => p.sku).filter(Boolean) as string[]);
  let created = 0;
  for (const r of rows) {
    const sku = r.sku ? String(r.sku).toLowerCase() : null;
    const name = String(r.name).toLowerCase();
    if ((sku && skus.has(sku)) || names.has(name)) continue;
    names.add(name);
    if (sku) skus.add(sku);
    await db.insert(products).values({
      companyId,
      name: String(r.name),
      sku: (r.sku as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      unitPrice: Number(fromFils(Number(r.salePriceFils))),
      costPrice: Number(fromFils(Number(r.costPriceFils))),
      productType: String(r.productType),
      trackInventory: false,
      currentStock: 0,
    } as typeof products.$inferInsert);
    created++;
  }
  return { created, skipped: rows.length - created };
}

async function controlAccounts(companyId: string, kind: "receivable" | "payable") {
  await ensureObe(companyId);
  const existing = await companyAccounts(companyId);
  const control =
    [...existing.values()].find(
      (a) => a.sub_type === kind && (a.code === "1040" || a.code === "2010")
    ) ?? [...existing.values()].find((a) => a.sub_type === kind)!;
  return { control, obe: existing.get(OBE_CODE)! };
}

async function contactIdFor(companyId: string, name: string): Promise<string> {
  const { rows } = await pq<{ id: string }>(
    `SELECT id FROM customer_contacts WHERE company_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [companyId, name]
  );
  if (rows[0]) return rows[0].id;
  const [c] = await db
    .insert(customerContacts)
    .values({ companyId, name } as typeof customerContacts.$inferInsert)
    .returning({ id: customerContacts.id });
  emitDomainEvent("contact.created", { companyId, entityId: c.id, kind: "customer" });
  return c.id;
}

async function commitOpenInvoices(
  companyId: string,
  cutOver: string,
  rows: Array<Record<string, unknown>>,
  userId: string,
  system: string
) {
  const { control, obe } = await controlAccounts(companyId, "receivable");
  let created = 0;
  let totalFils = 0;
  for (const r of rows) {
    const contactId = await contactIdFor(companyId, String(r.contactName));
    const due = Number(r.amountDueFils);
    const fx = docFx(r);
    const dueBase = fx.dueBaseFils;
    const date = new Date(`${r.date}T00:00:00.000Z`);
    await withLedgerTx(async (tx) => {
      const [inv] = await tx
        .insert(invoices)
        .values({
          companyId,
          number: String(r.number),
          contactId,
          customerName: String(r.contactName),
          date,
          dueDate: r.dueDate ? new Date(`${r.dueDate}T00:00:00.000Z`) : null,
          currency: fx.currency,
          exchangeRate: fx.rate,
          subtotal: Number(fromFils(due)),
          vatAmount: 0,
          total: Number(fromFils(due)),
          baseCurrencyAmount: Number(fromFils(dueBase)),
          status: "sent",
          invoiceType: "invoice",
          issuedAt: date,
          notes: `Opening balance imported from ${system} (original total ${fx.currency} ${fromFils(Number(r.totalFils))}, outstanding ${fx.currency} ${fromFils(due)} at ${cutOver}${fx.foreign ? `, rate ${fx.rate}` : ""}).`,
        } as typeof invoices.$inferInsert)
        .returning();
      await tx.insert(invoiceLines).values({
        invoiceId: inv.id,
        description: `Opening balance for invoice ${r.number}`,
        quantity: 1,
        unitPrice: Number(fromFils(due)),
        vatRate: 0,
        vatSupplyType: "out_of_scope",
        discountAmount: 0,
        netAmount: Number(fromFils(due)),
      } as typeof invoiceLines.$inferInsert);
      await postJournal(
        {
          companyId,
          date: cutOver,
          memo: `Opening A/R: invoice ${r.number} (${r.contactName})`,
          source: "invoice",
          sourceId: inv.id,
          idempotencyKey: `import:opening-invoice:${inv.id}`,
          status: "posted",
          kind: "opening",
          lines: [
            {
              accountId: control.id,
              debitFils: dueBase,
              controlLeg: "receivables",
              description: `Opening A/R ${r.number}`,
              ...fx.debitLine(due),
            },
            { accountId: obe.id, creditFils: dueBase, description: `Opening A/R ${r.number}` },
          ],
        },
        { actorId: userId, tx }
      );
    });
    created++;
    totalFils += dueBase;
  }
  return { documentsCreated: created, controlTotalFils: totalFils };
}

/** Rate and base amount resolved by validateImport (resolveDocumentRates). */
function docFx(r: Record<string, unknown>) {
  const base = String(r.baseCurrency || "AED");
  const currency = String(r.currency || base).toUpperCase();
  const foreign = r.foreign === true && currency !== base;
  const rate = foreign ? Number(r.exchangeRate) : 1;
  const dueBaseFils = foreign ? Number(r.amountDueBaseFils) : Number(r.amountDueFils);
  if (foreign && !(rate > 0)) {
    throw new DomainError("NO_EXCHANGE_RATE", 422, { number: r.number }, "Missing exchange rate");
  }
  return {
    currency,
    foreign,
    rate,
    dueBaseFils,
    /** Foreign-currency columns for the control-account line (none for base currency). */
    debitLine: (dueFils: number) =>
      foreign
        ? { foreignCurrency: currency, foreignDebit: fromFils(dueFils), exchangeRate: String(rate) }
        : {},
    creditLine: (dueFils: number) =>
      foreign
        ? {
            foreignCurrency: currency,
            foreignCredit: fromFils(dueFils),
            exchangeRate: String(rate),
          }
        : {},
  };
}

async function commitOpenBills(
  companyId: string,
  cutOver: string,
  rows: Array<Record<string, unknown>>,
  userId: string,
  system: string
) {
  const { control, obe } = await controlAccounts(companyId, "payable");
  let created = 0;
  let totalFils = 0;
  for (const r of rows) {
    const due = Number(r.amountDueFils);
    const fx = docFx(r);
    const dueBase = fx.dueBaseFils;
    const { rows: vendor } = await pq<{ id: string }>(
      `SELECT id FROM vendors WHERE company_id = $1 AND lower(name) = lower($2) LIMIT 1`,
      [companyId, r.contactName]
    );
    let vendorId = vendor[0]?.id ?? null;
    if (!vendorId) {
      const { rows: v } = await pq<{ id: string }>(
        `INSERT INTO vendors (company_id, name) VALUES ($1, $2) RETURNING id`,
        [companyId, r.contactName]
      );
      vendorId = v[0].id;
      emitDomainEvent("contact.created", { companyId, entityId: vendorId, kind: "vendor" });
    }
    await withLedgerTx(async (tx) => {
      const [bill] = await txRows<{ id: string }>(
        tx,
        `INSERT INTO vendor_bills (company_id, vendor_id, vendor_name, bill_number, bill_date, due_date,
            currency, exchange_rate, subtotal, vat_amount, total_amount, amount_paid, status, notes,
            origin, origin_ref, created_by, approved_by, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $10, $11, $7, 0, $7, 0, 'approved', $8, 'import', $4, $9, $9, now())
         RETURNING id`,
        [
          companyId,
          vendorId,
          r.contactName,
          r.number,
          r.date,
          r.dueDate ?? null,
          fromFils(due),
          `Opening balance imported from ${system} (original total ${fx.currency} ${fromFils(Number(r.totalFils))}, outstanding ${fx.currency} ${fromFils(due)} at ${cutOver}${fx.foreign ? `, rate ${fx.rate}` : ""}).`,
          userId,
          fx.currency,
          String(fx.rate),
        ]
      );
      await postJournal(
        {
          companyId,
          date: cutOver,
          memo: `Opening A/P: bill ${r.number} (${r.contactName})`,
          source: "bill",
          sourceId: bill.id,
          idempotencyKey: `import:opening-bill:${bill.id}`,
          status: "posted",
          kind: "opening",
          lines: [
            { accountId: obe.id, debitFils: dueBase, description: `Opening A/P ${r.number}` },
            {
              accountId: control.id,
              creditFils: dueBase,
              controlLeg: "payables",
              description: `Opening A/P ${r.number}`,
              ...fx.creditLine(due),
            },
          ],
        },
        { actorId: userId, tx }
      );
    });
    created++;
    totalFils += dueBase;
  }
  return { documentsCreated: created, controlTotalFils: totalFils };
}

// ─── COA export ──────────────────────────────────────────────────────────────

export async function exportChartOfAccountsCsv(companyId: string): Promise<string> {
  const { rows } = await pq<{
    code: string;
    name_en: string;
    name_ar: string | null;
    type: string;
    sub_type: string | null;
    description: string | null;
  }>(
    `SELECT code, name_en, name_ar, type, sub_type, description FROM accounts
      WHERE company_id = $1 AND is_archived = false ORDER BY code`,
    [companyId]
  );
  const header = ["Code", "Name", "Name (Arabic)", "Type", "Sub Type", "Description"];
  const typeLabel: Record<string, string> = {
    receivable: "Accounts Receivable",
    payable: "Accounts Payable",
    bank: "Bank",
    cash: "Cash",
    inventory: "Inventory",
    fixed_asset: "Fixed Asset",
    other_expense: "Other Expense",
    cost_of_sales: "Direct Costs",
    depreciation: "Depreciation",
    other_income: "Other Income",
    retained_earnings: "Retained Earnings",
    drawings: "Drawings",
    long_term_liability: "Non-current Liability",
  };
  const generic: Record<string, string> = {
    asset: "Current Asset",
    liability: "Current Liability",
    equity: "Equity",
    income: "Revenue",
    expense: "Expense",
  };
  const lines = rows.map((r) =>
    [
      r.code,
      r.name_en,
      r.name_ar ?? "",
      (r.sub_type && typeLabel[r.sub_type]) || generic[r.type] || r.type,
      r.sub_type ?? "",
      r.description ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}
