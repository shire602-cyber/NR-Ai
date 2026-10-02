/**
 * The database half of "clear the VAT accounts at filing": read the ledger balances of the
 * output and input VAT accounts for the period, resolve (or create) the accounts the journal
 * needs, and turn the pure result of buildClearingLines into journal lines. Everything runs on
 * the filing transaction's own connection.
 */

import { dubaiDaySql } from "./vat-dubai-day";
import { sql } from "drizzle-orm";
import { AppError } from "../errors";
import { accounts } from "../../shared/schema";
import { ACCOUNT_CODES, VAT_ACCOUNT_CODES } from "../constants";
import { defaultChartOfAccounts } from "../defaultChartOfAccounts";
import { fromFils, toFils } from "./tax-filing-core";
import {
  buildClearingLines,
  type JournalLineInput,
  type LedgerVatBalances,
  type ReturnVatFigures,
} from "./tax-settlement";
import { findAccountByCode, missingAccountError, type AccountRef } from "./tax-filing.service";
import { neverDeclaredVoidedInvoiceIds } from "./vat-void-history.service";

type Tx = any;

/** Entries that are not the period's VAT activity: earlier clearing entries and carried-in balances. */
const EXCLUDED_SOURCES = ["vat_filing", "opening_balance", "opening_balance_reversal"];

/**
 * Ledger balances of the output VAT (2020, credit) and input VAT (1050, debit) accounts for
 * documents dated in [startYmd, endYmd]. Reverse-charge self-assessment posts to the same two
 * accounts, so it is in these balances too.
 *
 * Entries of a voided document that was NEVER DECLARED (an old-rule filed return had already left
 * the sale out, so its later void is not deducted: vat-void-history.ts) are left out, the same
 * documents the return leaves out. The residue in the accounts is the original in one month and
 * the reversal in another, which nets to zero over time.
 */
export async function ledgerVatBalances(tx: Tx, companyId: string, startYmd: string, endYmd: string): Promise<LedgerVatBalances> {
  const skipDocs = await neverDeclaredVoidedInvoiceIds(tx, companyId, startYmd, endYmd);
  const skipHistorical = skipDocs.length
    ? sql`AND NOT (je.source = 'invoice' AND je.source_id IN (${sql.join(skipDocs.map((id) => sql`${id}::uuid`), sql`, `)}))`
    : sql``;
  const res: any = await tx.execute(sql`
    SELECT a.code, COALESCE(SUM(jl.credit - jl.debit), 0) AS net_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
     WHERE je.company_id = ${companyId} AND je.status = 'posted'
       AND ${sql.raw(dubaiDaySql("je.date"))} >= ${startYmd}::date AND ${sql.raw(dubaiDaySql("je.date"))} <= ${endYmd}::date
       AND je.source NOT IN (${sql.join(EXCLUDED_SOURCES.map((s) => sql`${s}`), sql`, `)})
       ${skipHistorical}
       AND ((a.code = ${ACCOUNT_CODES.VAT_OUTPUT} AND a.type = 'liability') OR (a.code = ${ACCOUNT_CODES.VAT_INPUT} AND a.type = 'asset'))
     GROUP BY a.code`);
  const rows = (res.rows ?? res) as Array<{ code: string; net_credit: string }>;
  const net = (code: string) => toFils(Number(rows.find((r) => r.code === code)?.net_credit ?? 0));
  return {
    outputVat: fromFils(net(ACCOUNT_CODES.VAT_OUTPUT)),
    inputVat: fromFils(-net(ACCOUNT_CODES.VAT_INPUT)),
  };
}

/** An expense account created from the default template for a chart that lacks it (5160, 5165). */
async function resolveExpenseAccountFromTemplate(tx: Tx, companyId: string, code: string, label: string): Promise<AccountRef> {
  const existing = await findAccountByCode(tx, companyId, code, ["expense"]);
  if (existing) return existing;
  const template = defaultChartOfAccounts.find((a) => a.code === code);
  if (!template) throw missingAccountError(label, code, "expense");
  const [created] = await tx
    .insert(accounts)
    .values({
      companyId,
      code: template.code,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      description: template.description,
      type: template.type,
      subType: template.subType,
      isVatAccount: template.isVatAccount,
      vatType: template.vatType,
      isSystemAccount: template.isSystemAccount,
      isActive: true,
      isArchived: false,
    })
    .returning({ id: accounts.id, code: accounts.code, nameEn: accounts.nameEn });
  return created;
}

/** Irrecoverable VAT Expense (5160): created from the default template for a chart that lacks it. */
export const resolveIrrecoverableAccount = (tx: Tx, companyId: string) =>
  resolveExpenseAccountFromTemplate(tx, companyId, VAT_ACCOUNT_CODES.IRRECOVERABLE_EXPENSE, "Irrecoverable VAT Expense");

/** VAT Adjustments (5165): created from the default template for a chart that lacks it. */
export const resolveVatAdjustmentsAccount = (tx: Tx, companyId: string) =>
  resolveExpenseAccountFromTemplate(tx, companyId, VAT_ACCOUNT_CODES.ADJUSTMENTS, "VAT Adjustments");

export interface ClearingPlan {
  lines: JournalLineInput[];
  irrecoverable: number;
  rounding: number;
  manualAdjustment: number;
}

/**
 * Build the clearing journal for real accounts, or throw the 422 refusal. Symbolic ids are
 * used first so that the expense account is only looked up (and created) when a line needs it.
 */
export async function planVatClearing(args: {
  tx: Tx;
  companyId: string;
  ledger: LedgerVatBalances;
  figures: ReturnVatFigures;
  controlId: string;
  label: string;
}): Promise<ClearingPlan> {
  const symbolic = { outputId: "output", inputId: "input", controlId: "control", irrecoverableId: "irrecoverable", adjustmentsId: "adjustments" };
  const result = buildClearingLines(args.ledger, args.figures, symbolic, args.label);
  if (!result.ok) {
    throw new AppError({ message: result.message, statusCode: 422, code: result.code, details: result.details });
  }
  const used = new Set(result.lines.map((l) => l.accountId));
  const ids: Record<string, string> = { control: args.controlId };
  if (used.has("output")) {
    const a = await findAccountByCode(args.tx, args.companyId, ACCOUNT_CODES.VAT_OUTPUT, ["liability"]);
    if (!a) throw missingAccountError("VAT Payable (Output VAT)", ACCOUNT_CODES.VAT_OUTPUT, "liability");
    ids.output = a.id;
  }
  if (used.has("input")) {
    const a = await findAccountByCode(args.tx, args.companyId, ACCOUNT_CODES.VAT_INPUT, ["asset"]);
    if (!a) throw missingAccountError("VAT Receivable (Input VAT)", ACCOUNT_CODES.VAT_INPUT, "asset");
    ids.input = a.id;
  }
  if (used.has("irrecoverable")) ids.irrecoverable = (await resolveIrrecoverableAccount(args.tx, args.companyId)).id;
  if (used.has("adjustments")) ids.adjustments = (await resolveVatAdjustmentsAccount(args.tx, args.companyId)).id;
  return {
    lines: result.lines.map((l) => ({ ...l, accountId: ids[l.accountId] })),
    irrecoverable: result.irrecoverable,
    rounding: result.rounding,
    manualAdjustment: result.manualAdjustment,
  };
}
