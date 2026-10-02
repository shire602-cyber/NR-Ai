// Bank rules: validation of a rule, the posting a rule makes, and the preview that shows it first (suggest, then post).

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { bankTransactions, reconciliationRules, type BankTransaction, type ReconciliationRule } from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";
import { db } from "../db";
import { storage } from "../storage";
import { buildBankEntryLines } from "./bank-entry-lines";
import {
  MAX_REGEX_LENGTH,
  RULE_VAT_RATES,
  computeRulePosting,
  isRegexSafe,
  ruleMatches,
  validateSplitShape,
  type SplitLine,
} from "./bank-rule-split";
import { proposeRuleLines, type ProposedLine } from "./bank-matching.service";
import {
  appError,
  bankRate,
  isBankOrCashAccount,
  isDocumentOnlyAccount,
  matchPatch,
  type PostCtx,
  type Tx,
} from "./bank-posting-common";

export const RULE_SOURCE = "bank_rule";

export const ruleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  matchField: z.enum(["description", "reference", "amount"]).default("description"),
  matchType: z.enum(["contains", "equals", "starts_with", "regex"]).default("contains"),
  matchValue: z.string().min(1).max(200),
  direction: z.enum(["any", "inflow", "outflow"]).default("any"),
  bankAccountId: z.string().uuid().nullable().optional(),
  amountMin: z.coerce.number().min(0).nullable().optional(),
  amountMax: z.coerce.number().min(0).nullable().optional(),
  // Absent: a category-only rule with no split lines (the original rule shape). It suggests and tags but cannot post;
  // add split lines to make it post. When present the lines are validated (1-10, adding up to 100).
  splitLines: z
    .array(z.object({ accountId: z.string().uuid(), percent: z.coerce.number(), description: z.string().max(200).optional() }))
    .max(10)
    .default([]),
  vatRate: z.coerce.number().refine((v) => (RULE_VAT_RATES as readonly number[]).includes(v), "vatRate must be 0 or 5").default(0),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  category: z.string().max(120).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** Business rules for a rule payload (zod has already checked the shape). 422 with a rule-specific code. */
export async function validateRuleBusiness(companyId: string, rule: RuleInput): Promise<void> {
  if (rule.splitLines.length > 0) {
    const shape = validateSplitShape(rule.splitLines as SplitLine[]);
    if (shape) throw appError(422, "RULE_SPLIT_INVALID", shape);
  }
  if (rule.splitLines.length === 0 && rule.vatRate > 0) {
    throw appError(422, "RULE_SPLIT_INVALID", "A VAT rule needs split lines to post to.");
  }

  if (rule.matchType === "regex" && !isRegexSafe(rule.matchValue)) {
    throw appError(422, "RULE_REGEX_UNSAFE", `The pattern is invalid or unsafe (at most ${MAX_REGEX_LENGTH} characters, no nested repeats, alternation inside repeats, back-references or lookarounds).`);
  }
  if (rule.vatRate > 0 && rule.direction === "inflow") {
    throw appError(422, "RULE_VAT_INFLOW_UNSUPPORTED", "VAT can only be taken from payments out of the bank (outflows).");
  }
  if (rule.amountMin != null && rule.amountMax != null && rule.amountMin > rule.amountMax) {
    throw appError(422, "RULE_SPLIT_INVALID", "The minimum amount is above the maximum amount.");
  }

  const [accounts, banks] = await Promise.all([storage.getAccountsByCompanyId(companyId), storage.getBankAccountsByCompanyId(companyId)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const managedGl = new Set(banks.map((b) => b.glAccountId).filter((v): v is string => !!v));
  for (const l of rule.splitLines) {
    const a = byId.get(l.accountId);
    if (!a || a.isActive === false || a.isArchived === true || isDocumentOnlyAccount(a) || isBankOrCashAccount(a, managedGl, a.id)) {
      throw appError(422, "RULE_ACCOUNT_INVALID", "Every split account must be an active income or expense-type account of this company (not receivables, payables, VAT, bank or cash).");
    }
  }
  if (rule.bankAccountId && !banks.some((b) => b.id === rule.bankAccountId)) {
    throw appError(422, "RULE_ACCOUNT_INVALID", "The bank account does not belong to this company.");
  }
}

/** DB row shape for insert/update from a validated payload. */
export function ruleColumns(rule: RuleInput) {
  return {
    name: rule.name,
    matchField: rule.matchField,
    matchType: rule.matchType,
    matchValue: rule.matchValue,
    direction: rule.direction,
    bankAccountId: rule.bankAccountId ?? null,
    amountMin: rule.amountMin ?? null,
    amountMax: rule.amountMax ?? null,
    splitLines: rule.splitLines,
    vatRate: rule.vatRate,
    priority: rule.priority,
    isActive: rule.isActive,
    category: rule.category ?? null,
    memo: rule.memo ?? null,
  };
}

/** First active rule (highest priority first) that fits the bank line and has split lines to post. */
export function firstMatchingRule(rules: ReconciliationRule[], txn: Pick<BankTransaction, "description" | "reference" | "amount" | "bankStatementAccountId">): ReconciliationRule | null {
  for (const rule of rules) {
    if (!rule.isActive || !Array.isArray(rule.splitLines) || rule.splitLines.length === 0) continue;
    if (ruleMatches(rule as any, { description: txn.description, reference: txn.reference, amount: Number(txn.amount), bankStatementAccountId: txn.bankStatementAccountId })) return rule;
  }
  return null;
}

export interface RulePreview {
  transactionId: string;
  ruleId: string;
  ruleName: string;
  proposedLines: ProposedLine[];
}

/** What each open bank line would post under the rules. Posts nothing. */
export async function previewRules(companyId: string, txns: BankTransaction[]): Promise<RulePreview[]> {
  const [accountList, rules] = await Promise.all([storage.getAccountsByCompanyId(companyId), storage.getReconciliationRulesByCompanyId(companyId)]);
  const view = { accounts: new Map(accountList.map((a) => [a.id, a])), accountsByCode: new Map(accountList.map((a) => [a.code, a])) };
  const out: RulePreview[] = [];
  for (const txn of txns) {
    if (txn.isReconciled || txn.matchStatus === "matched" || !txn.bankAccountId) continue;
    const rule = firstMatchingRule(rules, txn);
    if (!rule) continue;
    out.push({ transactionId: txn.id, ruleId: rule.id, ruleName: rule.name, proposedLines: proposeRuleLines(view, txn, rule) });
  }
  return out;
}

/** Post a rule's entry for one bank line inside the caller's locked transaction. */
export async function applyRuleInTx(
  tx: Tx,
  ctx: PostCtx,
  txn: BankTransaction,
  bank: { glAccountId: string; currency: string },
  ruleId: string
): Promise<{ journalEntryId: string; receiptId: string | null }> {
  const rule = await storage.getReconciliationRule(ruleId);
  if (!rule || rule.companyId !== ctx.companyId) throw appError(404, "RULE_NOT_FOUND", "Reconciliation rule not found");
  if (!rule.isActive) throw appError(422, "RULE_NOT_APPLICABLE", "This rule is switched off.");
  const splitLines = (rule.splitLines as SplitLine[]) ?? [];
  if (!ruleMatches(rule as any, { description: txn.description, reference: txn.reference, amount: Number(txn.amount), bankStatementAccountId: txn.bankStatementAccountId })) {
    throw appError(422, "RULE_NOT_APPLICABLE", "This rule does not apply to this bank line.");
  }
  const shape = validateSplitShape(splitLines);
  if (shape) throw appError(422, "RULE_SPLIT_INVALID", shape);

  const accounts = await storage.getAccountsByCompanyId(ctx.companyId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const l of splitLines) {
    const a = byId.get(l.accountId);
    if (!a || a.isActive === false || a.isArchived === true || isDocumentOnlyAccount(a)) {
      throw appError(422, "RULE_ACCOUNT_INVALID", "A split account of this rule is no longer valid. Edit the rule.");
    }
  }

  const inflow = Number(txn.amount) > 0;
  const vatRate = Number(rule.vatRate) || 0;
  if (inflow && vatRate > 0) throw appError(422, "RULE_VAT_INFLOW_UNSUPPORTED", "VAT can only be taken from payments out of the bank.");
  const posting = computeRulePosting({ gross: Math.abs(Number(txn.amount)), vatRate, splitLines });
  const contra = posting.shares.map((s) => ({ accountId: s.accountId, amount: s.amount, description: s.description ?? txn.description }));
  if (!inflow && posting.vat > 0) {
    const vatAccount = accounts.find((a) => a.code === ACCOUNT_CODES.VAT_INPUT);
    if (!vatAccount) throw appError(422, "VAT_ACCOUNT_MISSING", "The input VAT account (1050) is missing from the chart of accounts.");
    contra.push({ accountId: vatAccount.id, amount: posting.vat, description: "Input VAT" });
  }

  const date = new Date(txn.transactionDate);
  const rate = await bankRate(ctx.companyId, bank.currency, date);
  const lines = buildBankEntryLines({
    amount: Number(txn.amount),
    bankGlAccountId: bank.glAccountId,
    contra,
    currency: bank.currency,
    rate,
    description: txn.description.slice(0, 200),
  });
  const entry = await storage.createJournalEntry(
    {
      companyId: ctx.companyId,
      entryNumber: "PENDING",
      date,
      memo: `Bank rule: ${rule.name} - ${txn.description}`.slice(0, 500),
      status: "posted",
      source: RULE_SOURCE,
      sourceId: txn.id,
      createdBy: ctx.userId,
      postedBy: ctx.userId,
      postedAt: new Date(),
    } as any,
    lines as any,
    { tx }
  );

  // Input VAT is claimed from receipts (VAT return box 9), never from a bank-rule journal alone.
  let receiptId: string | null = null;
  if (!inflow && posting.vat > 0) {
    const largest = posting.shares.reduce((a, b) => (b.amount > a.amount ? b : a), posting.shares[0]);
    const grossAed = Math.round(posting.gross * rate * 100) / 100;
    const res: any = await tx.execute(sql`
      INSERT INTO receipts (company_id, merchant, date, amount, vat_amount, currency, category, uploaded_by, account_id,
                            payment_account_id, posted, journal_entry_id, exchange_rate, base_currency_amount, bank_transaction_id, auto_posted)
      VALUES (${ctx.companyId}, ${txn.description.slice(0, 200)}, ${date}, ${posting.net}, ${posting.vat}, ${bank.currency},
              ${rule.category ?? "Bank rule"}, ${ctx.userId}, ${largest.accountId}, ${bank.glAccountId}, true, ${entry.id}, ${rate},
              ${grossAed}, ${txn.id}, false)
      RETURNING id`);
    receiptId = ((res.rows ?? res) as Array<{ id: string }>)[0]?.id ?? null;
  }

  await tx
    .update(bankTransactions)
    .set(matchPatch(ctx.userId, { matchedJournalEntryId: entry.id, category: rule.category ?? txn.category }, 100))
    .where(and(eq(bankTransactions.id, txn.id), eq(bankTransactions.companyId, ctx.companyId)));
  await tx
    .update(reconciliationRules)
    .set({ timesApplied: sql`${reconciliationRules.timesApplied} + 1`, updatedAt: new Date() })
    .where(eq(reconciliationRules.id, rule.id));

  return { journalEntryId: entry.id, receiptId };
}


/** A receipt a bank rule created follows its bank line: it cannot be edited or deleted on its own (409 BANK_RULE_RECEIPT). */
export async function assertNotBankRuleReceipt(receiptId: string): Promise<void> {
  const res = await db.execute(sql`SELECT 1 FROM receipts WHERE id = ${receiptId} AND bank_transaction_id IS NOT NULL LIMIT 1`);
  if (((res as any).rows ?? res).length > 0) {
    throw appError(409, "BANK_RULE_RECEIPT", "This receipt was created by a bank rule. Unmatch the bank line to remove it.");
  }
}
