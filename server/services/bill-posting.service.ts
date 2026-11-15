// GL posting and the state machine for vendor bills (W3-B: R04-01, R04-02, R04-04, R04-06,
// R04-08, R04-21, R11-04).
//
// Bills live in raw-SQL tables (vendor_bills / bill_line_items / bill_payments, migrations
// 0010/0069/0096). Every journal goes through the ledger kernel (server/ledger) with an
// idempotency key; every status change is ONE conditional UPDATE (transitionRow) inside the same
// ledger transaction as its journal.
//
//   Approval (on bill_date), all amounts converted to AED at the bill rate, in integer fils:
//     Dr  expense/asset per line (+ its share of non-recoverable VAT)
//     Dr  VAT Receivable (Input VAT 1050)          recoverable VAT
//     Cr  Accounts Payable 2010                     payable to the vendor (less withholding)
//     Cr  Withholding Tax Payable 2070              withholding (off unless entered)
//   Reverse charge / imports additionally self-assess output VAT (both VAT legs posted):
//     Cr  VAT Payable (Output VAT 2020)            full VAT; the vendor is owed the subtotal only
//
// Uncategorised lines post to 5000 General Expenses (created on demand), never 5130 (which the
// seeded chart uses for Loss on Asset Disposal, R11-04).

import { sql, type SQL } from "drizzle-orm";
import { boolean, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { createLogger } from "../config/logger";
import { DomainError } from "../errors";
import { allocate, fromFils, mulRate, sumFils, toFils } from "../../shared/money";
import {
  defineMachine,
  postJournal,
  reverseBySource,
  type LedgerTx,
  type PostJournalLineInput,
} from "../ledger";
import type { Account } from "../../shared/schema";
import { afterBillPosted, planBillStock, reverseBillStock } from "./inventory/documents";

const log = createLogger("bill-posting");

export const BILL_JE_SOURCE = "bill";
export const BILL_PAYMENT_JE_SOURCE = "bill_payment";
export const BASE_CURRENCY = "AED";

/** Fallback expense account for uncategorised bill lines (R11-04: 5000, never 5130). */
export const GENERAL_EXPENSE_CODE = ACCOUNT_CODES.GENERAL_EXPENSE; // "5000"
export const WITHHOLDING_PAYABLE_CODE = "2070";
export const VENDOR_ADVANCES_CODE = "1065";

// ─── State machine ──────────────────────────────────────────────────────────

export const BILL_STATES = [
  "draft",
  "pending",
  "approved",
  "partial",
  "paid",
  "rejected",
  "void",
  // Legacy stored value (pre-W3-B); behaves like "approved". Overdue is derived from due_date.
  "overdue",
] as const;
export type BillState = (typeof BILL_STATES)[number];

export const billMachine = defineMachine<BillState>({
  states: BILL_STATES,
  transitions: {
    draft: ["pending", "void"],
    pending: ["approved", "rejected", "void", "draft"],
    rejected: ["pending", "draft"],
    approved: ["partial", "paid", "void"],
    overdue: ["partial", "paid", "void", "approved"],
    partial: ["paid", "approved"],
    paid: ["partial", "approved"],
  },
});

/** States whose journal is posted (the bill is in A/P). */
export const POSTED_BILL_STATES: readonly BillState[] = ["approved", "overdue", "partial", "paid"];
/** States that accept a payment (R04-01). */
export const PAYABLE_BILL_STATES: readonly BillState[] = ["approved", "overdue", "partial"];
/** States that can still be edited in place (no journal). */
export const EDITABLE_BILL_STATES: readonly BillState[] = ["draft", "pending", "rejected"];

/**
 * Minimal Drizzle mirror of the raw-SQL vendor_bills table, so status changes go through the
 * kernel's transitionRow (one conditional UPDATE). Only the columns transitions touch.
 */
export const vendorBillsTable = pgTable("vendor_bills", {
  id: uuid("id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  status: text("status"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  rejectedBy: uuid("rejected_by"),
  rejectedAt: timestamp("rejected_at"),
  voidedBy: uuid("voided_by"),
  voidedAt: timestamp("voided_at"),
  statusReason: text("status_reason"),
  amountPaid: numeric("amount_paid"),
  reverseCharge: boolean("reverse_charge"),
});

// ─── Raw SQL inside a ledger transaction ────────────────────────────────────

/** Build a parameterised drizzle SQL chunk from "$1 … $n" text (pg placeholder style). */
export function rawSql(text: string, params: readonly unknown[] = []): SQL {
  const parts = text.split(/\$(\d+)/);
  const chunks: SQL[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) chunks.push(sql.raw(parts[i]));
    } else {
      chunks.push(sql`${params[Number(parts[i]) - 1]}`);
    }
  }
  return sql.join(chunks, sql.raw(""));
}

/** Run a "$n"-parameterised statement on a ledger transaction and return its rows. */
export async function txRows<T = Record<string, unknown>>(
  tx: LedgerTx,
  text: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  const res = (await tx.execute(rawSql(text, params))) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

// ─── Totals (pure, integer fils) ────────────────────────────────────────────

export interface BillLineCalcInput {
  quantity?: number | null;
  unitPriceFils: number;
  vatRate?: number | null; // 0 | 5 (percent)
  supplyType?: string | null;
}

export interface BillLineCalc {
  quantity: number;
  unitPriceFils: number;
  amountFils: number;
  vatRate: 0 | 5;
  vatFils: number;
  supplyType: string;
  reverseCharge: boolean;
}

export interface BillTotalsInput {
  lines: BillLineCalcInput[];
  reverseCharge?: boolean;
  isImport?: boolean;
  importVatFils?: number | null;
  withholdingFils?: number | null;
}

export interface BillTotals {
  lines: BillLineCalc[];
  subtotalFils: number;
  vatFils: number;
  /** Payable to the vendor (subtotal [+ VAT unless reverse charge] − withholding). */
  totalFils: number;
  withholdingFils: number;
  reverseCharge: boolean;
}

const ZERO_VAT_SUPPLY = new Set(["zero_rated", "exempt", "out_of_scope"]);

/**
 * Compute bill totals in integer fils. Reverse-charge bills (and imports) exclude VAT from the
 * total (R04-04); zero-rated / exempt / out-of-scope lines carry no VAT; negative values never
 * reach here (validators reject them).
 */
export function computeBillTotals(input: BillTotalsInput): BillTotals {
  const billRc = input.reverseCharge === true || input.isImport === true;
  const lines: BillLineCalc[] = input.lines.map((l, i) => {
    const quantity = l.quantity && l.quantity > 0 ? l.quantity : 1;
    if (!Number.isSafeInteger(l.unitPriceFils) || l.unitPriceFils < 0) {
      throw new DomainError("NEGATIVE_AMOUNT", 400, { line: i }, "Line amounts cannot be negative");
    }
    const amountFils = l.unitPriceFils === 0 ? 0 : mulRate(l.unitPriceFils, quantity);
    let supplyType = l.supplyType || (billRc ? "reverse_charge" : "standard_rated");
    if (billRc && supplyType === "standard_rated") supplyType = "reverse_charge";
    const lineRc = billRc || supplyType === "reverse_charge";
    let vatRate: 0 | 5;
    if (ZERO_VAT_SUPPLY.has(supplyType)) {
      if (l.vatRate === 5) {
        throw new DomainError(
          "VAT_RATE_SUPPLY_MISMATCH",
          400,
          { line: i, supplyType },
          `A ${supplyType.replace(/_/g, "-")} line cannot carry 5% VAT`
        );
      }
      vatRate = 0;
    } else {
      vatRate = l.vatRate === 0 ? 0 : 5;
    }
    const vatFils = vatRate === 5 && amountFils > 0 ? mulRate(amountFils, "0.05") : 0;
    return {
      quantity,
      unitPriceFils: l.unitPriceFils,
      amountFils,
      vatRate,
      vatFils,
      supplyType,
      reverseCharge: lineRc,
    };
  });
  const subtotalFils = sumFils(lines.map((l) => l.amountFils));
  let vatFils = sumFils(lines.map((l) => l.vatFils));
  if (input.isImport && input.importVatFils && input.importVatFils > 0) {
    // Box 6: import VAT is the amount on the customs declaration.
    vatFils = input.importVatFils;
  }
  const anyRc = billRc || lines.some((l) => l.reverseCharge);
  const rcVat = billRc
    ? vatFils
    : sumFils(lines.filter((l) => l.reverseCharge).map((l) => l.vatFils));
  const withholdingFils =
    input.withholdingFils && input.withholdingFils > 0 ? input.withholdingFils : 0;
  const gross = subtotalFils + vatFils - rcVat;
  if (withholdingFils > gross) {
    throw new DomainError(
      "WITHHOLDING_EXCEEDS_TOTAL",
      400,
      undefined,
      "Withholding exceeds the bill total"
    );
  }
  return {
    lines,
    subtotalFils,
    vatFils,
    totalFils: gross - withholdingFils,
    withholdingFils,
    reverseCharge: anyRc,
  };
}

// ─── Account resolution ─────────────────────────────────────────────────────

/** Map bill-pay category strings to chart-of-accounts codes. */
const CATEGORY_ACCOUNT_CODES: Record<string, string> = {
  inventory: ACCOUNT_CODES.INVENTORY,
  stock: ACCOUNT_CODES.INVENTORY,
  goods: ACCOUNT_CODES.INVENTORY,
  equipment: ACCOUNT_CODES.EQUIPMENT,
  rent: "5010",
  salaries: "5020",
  payroll: "5020",
  utilities: "5030",
  telecom: "5040",
  phone: "5040",
  internet: "5040",
  supplies: "5050",
  office: "5050",
  marketing: "5060",
  advertising: "5060",
  professional: "5070",
  legal: "5070",
  audit: "5070",
  insurance: "5070",
  software: "5080",
  travel: "5090",
  fuel: "5090",
  meals: "5090",
  freight: GENERAL_EXPENSE_CODE,
  shipping: GENERAL_EXPENSE_CODE,
};

interface AccountSpec {
  code: string;
  nameEn: string;
  nameAr: string;
  type: "asset" | "liability" | "income" | "expense";
  subType: string;
}

export const ACCOUNT_SPECS: Record<string, AccountSpec> = {
  [GENERAL_EXPENSE_CODE]: {
    code: GENERAL_EXPENSE_CODE,
    nameEn: "General Expenses",
    nameAr: "مصاريف عامة",
    type: "expense",
    subType: "operating_expense",
  },
  [WITHHOLDING_PAYABLE_CODE]: {
    code: WITHHOLDING_PAYABLE_CODE,
    nameEn: "Withholding Tax Payable",
    nameAr: "ضريبة الاستقطاع المستحقة",
    type: "liability",
    subType: "current_liability",
  },
  [VENDOR_ADVANCES_CODE]: {
    code: VENDOR_ADVANCES_CODE,
    nameEn: "Advances to Suppliers",
    nameAr: "دفعات مقدمة للموردين",
    type: "asset",
    subType: "other_current_asset",
  },
  [ACCOUNT_CODES.FX_GAIN]: {
    code: ACCOUNT_CODES.FX_GAIN,
    nameEn: "Foreign Exchange Gain",
    nameAr: "أرباح فروق العملة",
    type: "income",
    subType: "other_income",
  },
  [ACCOUNT_CODES.FX_LOSS]: {
    code: ACCOUNT_CODES.FX_LOSS,
    nameEn: "Foreign Exchange Loss",
    nameAr: "خسائر فروق العملة",
    type: "expense",
    subType: "other_expense",
  },
};

const usable = (a: Account | undefined): a is Account =>
  !!a && a.isActive !== false && a.isArchived !== true;

/** Find an active account by code, creating the standard one when the chart lacks it. */
export async function ensureAccountByCode(companyId: string, code: string): Promise<Account> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const found = accounts.find((a) => a.code === code && usable(a));
  if (found) return found;
  const spec = ACCOUNT_SPECS[code];
  if (!spec)
    throw new DomainError("ACCOUNT_NOT_FOUND", 422, { code }, `Account ${code} is missing`);
  const created = await storage.createAccount({
    companyId,
    code: spec.code,
    nameEn: spec.nameEn,
    nameAr: spec.nameAr,
    description: "Created by vendor bill posting (W3-B)",
    type: spec.type,
    subType: spec.subType,
    isVatAccount: false,
    vatType: null,
    isSystemAccount: false,
  } as Parameters<typeof storage.createAccount>[0]);
  return created;
}

export async function requireApAccount(companyId: string): Promise<Account> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const ap = accounts.find((a) => a.code === ACCOUNT_CODES.AP && a.type === "liability");
  if (!usable(ap)) {
    throw new DomainError(
      "AP_ACCOUNT_MISSING",
      422,
      undefined,
      "Accounts Payable account (2010) not found in chart of accounts"
    );
  }
  return ap;
}

// ─── Bill rows ──────────────────────────────────────────────────────────────

export interface BillRow {
  id: string;
  company_id: string;
  vendor_id?: string | null;
  vendor_name: string;
  bill_number: string | null;
  bill_date: string | Date;
  currency?: string | null;
  subtotal: string | number;
  vat_amount: string | number;
  total_amount: string | number;
  amount_paid?: string | number | null;
  reverse_charge: boolean;
  is_import?: boolean | null;
  exchange_rate?: string | number | null;
  recoverable_vat_percent?: string | number | null;
  withholding_amount?: string | number | null;
  category?: string | null;
  status?: string | null;
  revision?: number | null;
  created_by?: string | null;
}

export interface BillLineRow {
  description: string;
  amount: string | number;
  vat_amount?: string | number | null;
  account_id: string | null;
  reverse_charge?: boolean | null;
}

export const filsOf = (v: string | number | null | undefined): number =>
  v === null || v === undefined || v === "" ? 0 : toFils(String(v), { rounding: "halfUp" });

export function rateTextOf(bill: {
  exchange_rate?: string | number | null;
  currency?: string | null;
}): string {
  const cur = (bill.currency || BASE_CURRENCY).toUpperCase();
  if (cur === BASE_CURRENCY) return "1";
  const n = Number(bill.exchange_rate);
  return n > 0 ? String(bill.exchange_rate) : "1";
}

export function isForeign(bill: { currency?: string | null }): boolean {
  return (bill.currency || BASE_CURRENCY).toUpperCase() !== BASE_CURRENCY;
}

/** Convert document-currency fils to AED fils at `rate` (identity for AED). */
export function toBase(fils: number, rate: string, foreign: boolean): number {
  if (!foreign || fils === 0) return fils;
  return mulRate(fils, rate);
}

export function isoDateOf(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
}

async function resolveLineAccount(
  accounts: Account[],
  companyId: string,
  line: BillLineRow,
  category: string | null,
  vendorDefaultAccountId: string | null
): Promise<string> {
  if (line.account_id) {
    const explicit = accounts.find((a) => a.id === line.account_id);
    if (usable(explicit)) return explicit.id;
    throw new DomainError("ACCOUNT_NOT_FOUND", 422, { accountId: line.account_id });
  }
  const code = category ? CATEGORY_ACCOUNT_CODES[category.toLowerCase().trim()] : undefined;
  if (code) {
    const mapped = accounts.find((a) => a.code === code && usable(a));
    if (mapped) return mapped.id;
  }
  if (vendorDefaultAccountId) {
    const v = accounts.find((a) => a.id === vendorDefaultAccountId);
    if (usable(v)) return v.id;
  }
  return (await ensureAccountByCode(companyId, GENERAL_EXPENSE_CODE)).id;
}

export interface BillJournalPlan {
  lines: PostJournalLineInput[];
  apCreditFils: number;
  memo: string;
  date: string;
  /** W4-B inventory hook: bill-line index behind each planned line (null for VAT / A/P). */
  lineSources?: Array<number | null>;
  /** W4-B inventory hook: the bill lines the plan was built from, in order. */
  lineItems?: Array<{ description: string; amount: string | number }>;
}

/**
 * Build the balanced journal lines for an approved bill (AED, integer fils). Pure apart from
 * account lookups / on-demand account creation (done before any transaction opens).
 */
export async function planBillJournal(
  bill: BillRow,
  lineItems: BillLineRow[],
  opts: { vendorDefaultAccountId?: string | null } = {}
): Promise<BillJournalPlan> {
  const companyId = bill.company_id;
  const ap = await requireApAccount(companyId);
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const foreign = isForeign(bill);
  const rate = rateTextOf(bill);
  const currency = (bill.currency || BASE_CURRENCY).toUpperCase();
  const billRef = bill.bill_number || bill.id.slice(0, 8);

  const nets = lineItems.map((l) => filsOf(l.amount));
  if (nets.some((n) => n < 0)) throw new DomainError("NEGATIVE_AMOUNT", 400);
  const vatDoc = filsOf(bill.vat_amount);
  const whtDoc = filsOf(bill.withholding_amount);
  const netBase = nets.map((n) => toBase(n, rate, foreign));
  const vatBase = toBase(vatDoc, rate, foreign);
  const pct = Number(bill.recoverable_vat_percent ?? 100);
  const recoverableBase =
    vatBase === 0 ? 0 : pct >= 100 ? vatBase : pct <= 0 ? 0 : mulRate(vatBase, String(pct / 100));
  const nonRecoverableBase = vatBase - recoverableBase;
  const shares =
    nonRecoverableBase > 0
      ? allocate(nonRecoverableBase, netBase.some((n) => n > 0) ? netBase : netBase.map(() => 1))
      : netBase.map(() => 0);

  const lines: PostJournalLineInput[] = [];
  const lineSources: Array<number | null> = [];
  for (let i = 0; i < lineItems.length; i++) {
    const debitFils = netBase[i] + shares[i];
    if (debitFils === 0) continue;
    lineSources.push(i);
    const accountId = await resolveLineAccount(
      accounts,
      companyId,
      lineItems[i],
      bill.category ?? null,
      opts.vendorDefaultAccountId ?? null
    );
    lines.push({
      accountId,
      debitFils,
      description: `Bill ${billRef} - ${lineItems[i].description}`.slice(0, 255),
    });
  }

  if (recoverableBase > 0) {
    const inputVat =
      accounts.find(
        (a) =>
          a.isVatAccount && a.vatType === "input" && a.code === ACCOUNT_CODES.VAT_INPUT && usable(a)
      ) ?? accounts.find((a) => a.isVatAccount && a.vatType === "input" && usable(a));
    if (!inputVat) {
      throw new DomainError(
        "VAT_ACCOUNTS_MISSING",
        422,
        undefined,
        "Input VAT account (1050) is missing"
      );
    }
    lines.push({
      accountId: inputVat.id,
      debitFils: recoverableBase,
      description: `Input VAT - Bill ${billRef}`,
    });
  }

  const totalDebit = sumFils(lines.map((l) => l.debitFils ?? 0));
  let rcVatBase = 0;
  if (bill.reverse_charge || bill.is_import) {
    rcVatBase = vatBase;
  } else {
    const rcLines = lineItems.filter((l) => l.reverse_charge);
    rcVatBase = toBase(sumFils(rcLines.map((l) => filsOf(l.vat_amount))), rate, foreign);
  }
  if (rcVatBase > 0) {
    const outputVat =
      accounts.find(
        (a) =>
          a.isVatAccount &&
          a.vatType === "output" &&
          a.code === ACCOUNT_CODES.VAT_OUTPUT &&
          usable(a)
      ) ?? accounts.find((a) => a.isVatAccount && a.vatType === "output" && usable(a));
    if (!outputVat) {
      throw new DomainError(
        "VAT_ACCOUNTS_MISSING",
        422,
        undefined,
        "Reverse-charge posting requires the Output VAT account (2020)"
      );
    }
    lines.push({
      accountId: outputVat.id,
      creditFils: rcVatBase,
      description: `Reverse-charge output VAT - Bill ${billRef}`,
    });
  }
  const whtBase = toBase(whtDoc, rate, foreign);
  if (whtBase > 0) {
    const wht = await ensureAccountByCode(companyId, WITHHOLDING_PAYABLE_CODE);
    lines.push({
      accountId: wht.id,
      creditFils: whtBase,
      description: `Withholding - Bill ${billRef}`,
    });
  }
  const apCreditFils = totalDebit - rcVatBase - whtBase;
  if (apCreditFils <= 0) {
    throw new DomainError(
      "BILL_ZERO_TOTAL",
      422,
      undefined,
      "A bill with a zero total cannot be posted"
    );
  }
  while (lineSources.length < lines.length) lineSources.push(null);
  lines.push({
    accountId: ap.id,
    creditFils: apCreditFils,
    description: `A/P - ${bill.vendor_name} - Bill ${billRef}`.slice(0, 255),
    ...(foreign
      ? {
          foreignCurrency: currency,
          foreignCredit: fromFils(filsOf(bill.total_amount)),
          exchangeRate: rate,
        }
      : {}),
  });
  return {
    lines,
    apCreditFils,
    memo: `Vendor Bill ${billRef} - ${bill.vendor_name}`.slice(0, 500),
    date: isoDateOf(bill.bill_date),
    lineSources: [...lineSources, null],
    lineItems: lineItems.map((l) => ({ description: l.description, amount: l.amount })),
  };
}

/** Post the bill's A/P journal inside `tx`. Idempotent per bill revision. */
export async function postBillJournal(
  tx: LedgerTx,
  bill: BillRow,
  plan: BillJournalPlan,
  actorId: string
) {
  // W4-B (R10-01, R10-02, R10-11): stock-item lines debit inventory (or clear GRNI) and move stock;
  // every line carries its bill line's cost centre. Same transaction as the A/P journal.
  const stock = await planBillStock(tx, {
    bill,
    date: plan.date,
    lines: plan.lines,
    lineSources: plan.lineSources ?? plan.lines.map(() => null),
    lineItems: plan.lineItems ?? [],
    actorId,
  });
  const result = await postJournal(
    {
      companyId: bill.company_id,
      date: plan.date,
      memo: plan.memo,
      status: "posted",
      source: BILL_JE_SOURCE,
      sourceId: bill.id,
      idempotencyKey: `bill:${bill.id}:r${bill.revision ?? 0}`,
      reference: bill.bill_number ?? null,
      allowFutureDate: true,
      lines: stock.lines,
    },
    { actorId, tx }
  );
  await afterBillPosted(tx, stock.movementIds, result.entry.id);
  log.info({ billId: bill.id, entryId: result.entry.id, replayed: result.replayed }, "Bill posted");
  return result;
}

/** Reverse (or void) every posted journal of the bill, inside `tx`. */
export async function reverseBillJournal(
  tx: LedgerTx,
  bill: Pick<BillRow, "id" | "company_id">,
  actorId: string,
  opts: { void?: boolean; reason?: string | null } = {}
) {
  const reversals = await reverseBySource(
    bill.company_id,
    BILL_JE_SOURCE,
    bill.id,
    { void: opts.void, reason: opts.reason ?? null, source: "bill_reversal", sourceId: bill.id },
    { actorId, tx }
  );
  // W4-B: take the bill's stock back (mirrored inventory value; any drift trued up to COGS).
  await reverseBillStock(tx, bill, actorId);
  return reversals;
}

/** A/P credit (fils) of the bill's current, unreversed posted journal. */
export async function currentBillApCreditFils(
  tx: LedgerTx,
  companyId: string,
  billId: string
): Promise<number> {
  const rows = await txRows<{ fils: string | null }>(
    tx,
    `SELECT COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint AS fils
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = 'bill' AND je.source_id = $2
        AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
        AND a.code = '2010'`,
    [companyId, billId]
  );
  return Number(rows[0]?.fils ?? 0);
}

/** True when a posted, unreversed journal exists for the bill. */
export async function billHasPostedJournal(tx: LedgerTx, companyId: string, billId: string) {
  const rows = await txRows(
    tx,
    `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source = 'bill' AND source_id = $2
        AND status = 'posted' AND reversed_by_entry_id IS NULL AND entry_kind <> 'reversal' LIMIT 1`,
    [companyId, billId]
  );
  return rows.length > 0;
}
