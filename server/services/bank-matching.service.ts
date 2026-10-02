// Suggestions for bank lines: which open invoice, open bill, unlinked journal entry, posted receipt, rule or clearing
// account explains this line? Read-only (nothing is posted here); bank-posting.service.ts applies a suggestion.
// Candidates are loaded once per request and scored in memory with bank-match-scoring.ts.

import { pool } from "../db";
import { storage } from "../storage";
import type { Account, BankAccount, BankTransaction, ReconciliationRule } from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";
import { outstandingSql, openReceivableSql } from "./invoice-outstanding.db";
import {
  CONFIDENT_SCORE,
  assignGreedy,
  scoreCandidate,
  type ReasonCode,
} from "./bank-match-scoring";
import { computeRulePosting, ruleMatches, type SplitLine } from "./bank-rule-split";

export const CLEARING_ACCOUNT_CODE = "1025";
export const RULE_CONFIDENCE = 75;
export const CLEARING_CONFIDENCE = 70;

export type SuggestionKind = "invoice" | "bill" | "journal" | "receipt" | "rule" | "account";

export interface ProposedLine {
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface Suggestion {
  transactionId: string;
  kind: SuggestionKind;
  targetId: string;
  confidence: number;
  reasons: ReasonCode[];
  label: string;
  amount: number;
  date: string;
  /** What posting the suggestion would make (empty for a link to something already posted). */
  proposedLines: ProposedLine[];
  posts: boolean;
  /** For an invoice or bill: the bank amount equals what is still open. Bulk accept drops rows where it does not, below 80. */
  amountMatches: boolean;
  ruleId?: string;
}

interface OpenDoc {
  id: string;
  number: string | null;
  name: string | null;
  currency: string;
  open: number;
  dates: Date[];
}

interface JournalCandidate {
  entryId: string;
  source: string;
  sourceId: string | null;
  memo: string | null;
  entryNumber: string;
  date: Date;
  /** Net debit - credit on the bank GL account: positive = money in. */
  net: number;
  merchant: string | null;
}

export interface CandidatePool {
  accounts: Map<string, Account>;
  accountsByCode: Map<string, Account>;
  bankAccounts: Map<string, BankAccount>;
  invoices: OpenDoc[];
  bills: OpenDoc[];
  journals: Map<string, JournalCandidate[]>; // by bank GL account id
  rules: ReconciliationRule[];
  clearingBalance: number | null;
}

const num = (v: unknown): number => Number(v) || 0;
const day = (d: Date): string => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" (selected with to_char, so the server's time zone cannot move it) as UTC midnight. */
const dayToDate = (s: string): Date => new Date(`${s}T00:00:00Z`);

async function loadOpenInvoices(companyId: string): Promise<OpenDoc[]> {
  const res = await pool.query(
    `SELECT i.id, i.number, i.customer_name, i.currency, to_char(i.date, 'YYYY-MM-DD') AS date_s, to_char(i.due_date, 'YYYY-MM-DD') AS due_s,
            ${outstandingSql("i")}::float8 AS open
       FROM invoices i
      WHERE i.company_id = $1 AND ${openReceivableSql("i")}`,
    [companyId]
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    number: r.number,
    name: r.customer_name,
    currency: r.currency || "AED",
    open: num(r.open),
    dates: [r.date_s, r.due_s].filter(Boolean).map(dayToDate),
  }));
}

/** Open (approved or part-paid) bills with what is still owed after payments and applied vendor credits. */
export async function loadOpenBills(companyId: string, billId?: string): Promise<OpenDoc[]> {
  const res = await pool.query(
    `SELECT b.id, b.bill_number, b.vendor_name, b.currency, to_char(b.bill_date, 'YYYY-MM-DD') AS date_s, to_char(b.due_date, 'YYYY-MM-DD') AS due_s,
            GREATEST(COALESCE(b.total_amount, 0)
              - COALESCE((SELECT SUM(p.amount) FROM bill_payments p WHERE p.bill_id = b.id), 0)
              - COALESCE((SELECT SUM(a.amount) FROM vendor_credit_applications a WHERE a.bill_id = b.id), 0), 0)::float8 AS open
       FROM vendor_bills b
      WHERE b.company_id = $1 AND b.status IN ('approved', 'partial')${billId ? " AND b.id = $2" : ""}`,
    billId ? [companyId, billId] : [companyId]
  );
  return res.rows
    .map((r: any) => ({
      id: r.id,
      number: r.bill_number,
      name: r.vendor_name,
      currency: r.currency || "AED",
      open: num(r.open),
      dates: [r.date_s, r.due_s].filter(Boolean).map(dayToDate),
    }))
    .filter((b: OpenDoc) => b.open > 0.005);
}

/** Posted entries that touch the bank GL account and are not linked to any bank line, not reversed, not a reversal. */
async function loadJournalCandidates(companyId: string, glIds: string[], from: Date, to: Date): Promise<Map<string, JournalCandidate[]>> {
  const out = new Map<string, JournalCandidate[]>();
  if (glIds.length === 0) return out;
  const res = await pool.query(
    `SELECT jl.account_id AS gl_id, je.id AS entry_id, je.source, je.source_id, je.memo, je.entry_number, to_char(je.date, 'YYYY-MM-DD') AS date_s,
            SUM(jl.debit - jl.credit)::float8 AS net, MAX(r.merchant) AS merchant
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       LEFT JOIN receipts r ON je.source = 'receipt' AND r.id = je.source_id AND r.company_id = je.company_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = ANY($2::uuid[])
        AND je.date >= $3 AND je.date <= $4
        AND je.reversed_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted')
        AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND bt.matched_journal_entry_id = je.id
                         AND bt.bank_account_id = jl.account_id)
      GROUP BY jl.account_id, je.id
     HAVING ABS(SUM(jl.debit - jl.credit)) > 0.005`,
    [companyId, glIds, from, to]
  );
  for (const r of res.rows as any[]) {
    const list = out.get(r.gl_id) ?? [];
    list.push({
      entryId: r.entry_id,
      source: r.source,
      sourceId: r.source_id,
      memo: r.memo,
      entryNumber: r.entry_number,
      date: dayToDate(r.date_s),
      net: num(r.net),
      merchant: r.merchant ?? null,
    });
    out.set(r.gl_id, list);
  }
  return out;
}

export async function loadCandidatePool(companyId: string, txns: BankTransaction[]): Promise<CandidatePool> {
  const [accountList, bankAccountList, rules] = await Promise.all([
    storage.getAccountsByCompanyId(companyId),
    storage.getBankAccountsByCompanyId(companyId),
    storage.getReconciliationRulesByCompanyId(companyId),
  ]);
  const accounts = new Map(accountList.map((a) => [a.id, a]));
  const accountsByCode = new Map(accountList.map((a) => [a.code, a]));
  const bankAccounts = new Map(bankAccountList.map((b) => [b.id, b]));

  const glIds = Array.from(new Set(txns.map((t) => t.bankAccountId).filter((v): v is string => !!v)));
  const times = txns.map((t) => new Date(t.transactionDate).getTime());
  const pad = 90 * 24 * 60 * 60 * 1000;
  const from = new Date((times.length ? Math.min(...times) : Date.now()) - pad);
  const to = new Date((times.length ? Math.max(...times) : Date.now()) + pad);

  const needsInvoices = txns.some((t) => Number(t.amount) > 0);
  const needsBills = txns.some((t) => Number(t.amount) < 0);
  const clearing = accountsByCode.get(CLEARING_ACCOUNT_CODE);

  const [invoices, bills, journals, clearingRes] = await Promise.all([
    needsInvoices ? loadOpenInvoices(companyId) : Promise.resolve([] as OpenDoc[]),
    needsBills ? loadOpenBills(companyId) : Promise.resolve([] as OpenDoc[]),
    loadJournalCandidates(companyId, glIds, from, to),
    clearing
      ? pool.query(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS bal FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.entry_id
            WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2`,
          [companyId, clearing.id]
        )
      : Promise.resolve(null),
  ]);

  return {
    accounts,
    accountsByCode,
    bankAccounts,
    invoices,
    bills,
    journals,
    rules: rules.filter((r) => r.isActive),
    clearingBalance: clearingRes ? num((clearingRes.rows[0] as any)?.bal) : null,
  };
}

function line(pool_: Pick<CandidatePool, "accounts">, accountId: string, debit: number, credit: number, description?: string | null): ProposedLine {
  const a = pool_.accounts.get(accountId);
  return { accountId, accountCode: a?.code ?? null, accountName: a?.nameEn ?? null, debit, credit, description: description ?? null };
}

/** The Dr/Cr a rule would post for one bank line. Shared with the posting service and the rule preview. */
export function proposeRuleLines(pool_: Pick<CandidatePool, "accounts" | "accountsByCode">, txn: Pick<BankTransaction, "amount" | "description" | "bankAccountId">, rule: ReconciliationRule): ProposedLine[] {
  if (!txn.bankAccountId) return [];
  const gross = Math.abs(Number(txn.amount));
  const inflow = Number(txn.amount) > 0;
  const posting = computeRulePosting({ gross, vatRate: Number(rule.vatRate) || 0, splitLines: (rule.splitLines as SplitLine[]) ?? [] });
  const lines: ProposedLine[] = [];
  if (inflow) {
    lines.push(line(pool_, txn.bankAccountId, posting.gross, 0, txn.description));
    for (const s of posting.shares) lines.push(line(pool_, s.accountId, 0, s.amount, s.description ?? txn.description));
  } else {
    for (const s of posting.shares) lines.push(line(pool_, s.accountId, s.amount, 0, s.description ?? txn.description));
    const vat = pool_.accountsByCode.get(ACCOUNT_CODES.VAT_INPUT);
    if (posting.vat > 0 && vat) lines.push(line(pool_, vat.id, posting.vat, 0, "Input VAT"));
    lines.push(line(pool_, txn.bankAccountId, 0, posting.gross, txn.description));
  }
  return lines;
}

/** Every suggestion at or above `minConfidence` for one bank line, best first (not yet one-to-one). */
export function suggestionsFor(pool_: CandidatePool, txn: BankTransaction, minConfidence = 60): Suggestion[] {
  if (txn.isReconciled || txn.matchStatus === "matched") return [];
  const amount = Math.abs(Number(txn.amount));
  if (!(amount > 0)) return [];
  const inflow = Number(txn.amount) > 0;
  const date = new Date(txn.transactionDate);
  const text = `${txn.description} ${txn.reference ?? ""}`.trim();
  const bank = txn.bankStatementAccountId ? pool_.bankAccounts.get(txn.bankStatementAccountId) : undefined;
  const bankCurrency = (bank?.currency || "AED").toUpperCase();
  const out: Suggestion[] = [];
  const base = { transactionId: txn.id, amount: Number(txn.amount), date: day(date) };

  for (const doc of inflow ? pool_.invoices : pool_.bills) {
    if (doc.currency.toUpperCase() !== bankCurrency) continue;
    const s = scoreCandidate({ amount, date, text, candidate: { openAmount: doc.open, dates: doc.dates, documentNumber: doc.number, name: doc.name } });
    if (!s || s.score < minConfidence) continue;
    const pay = Math.min(amount, doc.open);
    const control = pool_.accountsByCode.get(inflow ? ACCOUNT_CODES.AR : ACCOUNT_CODES.AP);
    out.push({
      ...base,
      kind: inflow ? "invoice" : "bill",
      targetId: doc.id,
      confidence: s.score,
      reasons: s.reasons,
      label: `${inflow ? "Invoice" : "Bill"} ${doc.number ?? ""}${doc.name ? ` · ${doc.name}` : ""}`.trim(),
      posts: true,
      amountMatches: Math.abs(amount - doc.open) < 0.01,
      proposedLines:
        txn.bankAccountId && control
          ? inflow
            ? [line(pool_, txn.bankAccountId, pay, 0, txn.description), line(pool_, control.id, 0, pay, doc.number)]
            : [line(pool_, control.id, pay, 0, doc.number), line(pool_, txn.bankAccountId, 0, pay, txn.description)]
          : [],
    });
  }

  if (txn.bankAccountId) {
    for (const j of pool_.journals.get(txn.bankAccountId) ?? []) {
      if (inflow !== j.net > 0) continue;
      const s = scoreCandidate({
        amount,
        date,
        text,
        candidate: { openAmount: Math.abs(j.net), dates: [j.date], documentNumber: j.entryNumber, name: j.merchant ?? j.memo },
      });
      if (!s || s.score < minConfidence) continue;
      const isReceipt = j.source === "receipt" && !!j.sourceId;
      out.push({
        ...base,
        kind: isReceipt ? "receipt" : "journal",
        targetId: isReceipt ? (j.sourceId as string) : j.entryId,
        confidence: s.score,
        reasons: s.reasons,
        label: isReceipt ? `Receipt · ${j.merchant ?? j.memo ?? ""}`.trim() : `${j.entryNumber} · ${j.memo ?? j.source}`,
        posts: false,
        amountMatches: true,
        proposedLines: [],
      });
    }
  }

  if (txn.bankAccountId) {
    for (const rule of pool_.rules) {
      if (!ruleMatches(rule as any, { description: txn.description, reference: txn.reference, amount: Number(txn.amount), bankStatementAccountId: txn.bankStatementAccountId })) continue;
      if (!Array.isArray(rule.splitLines) || rule.splitLines.length === 0) continue;
      if (RULE_CONFIDENCE < minConfidence) continue;
      out.push({
        ...base,
        kind: "rule",
        targetId: rule.id,
        ruleId: rule.id,
        confidence: RULE_CONFIDENCE,
        reasons: ["RULE_MATCH"],
        label: `Rule · ${rule.name}`,
        posts: true,
        amountMatches: true,
        proposedLines: proposeRuleLines(pool_, txn, rule),
      });
      break; // rules are ordered by priority: the first that fits is the one
    }
  }

  const clearing = pool_.accountsByCode.get(CLEARING_ACCOUNT_CODE);
  if (inflow && txn.bankAccountId && clearing && pool_.clearingBalance !== null && Math.abs(pool_.clearingBalance - amount) < 0.005 && CLEARING_CONFIDENCE >= minConfidence) {
    out.push({
      ...base,
      kind: "account",
      targetId: clearing.id,
      confidence: CLEARING_CONFIDENCE,
      reasons: ["CLEARING_BALANCE_EQUALS_AMOUNT"],
      label: `${clearing.code} ${clearing.nameEn}`,
      posts: true,
      amountMatches: true,
      proposedLines: [line(pool_, txn.bankAccountId, amount, 0, txn.description), line(pool_, clearing.id, 0, amount, txn.description)],
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

export async function suggestForTransaction(companyId: string, txn: BankTransaction, limit = 5): Promise<Suggestion[]> {
  const pool_ = await loadCandidatePool(companyId, [txn]);
  return suggestionsFor(pool_, txn, 1).slice(0, limit);
}

/** One suggestion per bank line, one line per target (greedy, best first), at or above the confidence floor. */
export async function suggestForTransactions(companyId: string, txns: BankTransaction[], minConfidence = 60): Promise<Suggestion[]> {
  const open = txns.filter((t) => !t.isReconciled && t.matchStatus !== "matched");
  if (open.length === 0) return [];
  const pool_ = await loadCandidatePool(companyId, open);
  const options = open.map((t) => ({
    transactionId: t.id,
    // bulk accept never pairs a line with an invoice or bill whose open amount differs, unless the rest fits (>= 80)
    scored: suggestionsFor(pool_, t, minConfidence)
      .filter((s) => s.amountMatches || s.confidence >= CONFIDENT_SCORE)
      .map((s) => ({ candidate: s, score: s.confidence })),
  }));
  // a rule may serve many lines; documents, entries and the clearing account are exclusive targets
  const pairs = assignGreedy(options, (s: Suggestion) => (s.kind === "rule" ? `rule:${s.transactionId}` : `${s.kind}:${s.targetId}`));
  return pairs.map((p) => p.candidate).sort((a, b) => b.confidence - a.confidence);
}

export { CONFIDENT_SCORE };
