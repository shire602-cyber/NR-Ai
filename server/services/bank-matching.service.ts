// Suggestions for bank lines: which open invoice, open bill, unlinked journal entry, posted receipt, rule or clearing
// account explains this line? Read-only (nothing is posted here); bank-posting.service.ts applies a suggestion.
// Candidates are loaded once per request and scored in memory with bank-match-scoring.ts.

import { dubaiDayTextSql } from "./vat-dubai-day";
const linkedToSql = (bt: string, je: string) =>
  `(${bt}.matched_journal_entry_id = ${je}.id OR EXISTS (SELECT 1 FROM bank_transaction_entries e_l WHERE e_l.bank_transaction_id = ${bt}.id AND e_l.journal_entry_id = ${je}.id))`;
import { pool } from "../db";
import { storage } from "../storage";
import type { Account, BankAccount, BankTransaction, ReconciliationRule } from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";
import { outstandingSql, openReceivableSql } from "./invoice-outstanding.db";
import {
  CONFIDENT_SCORE,
  assignGreedy,
  daysBetween,
  nameSimilarity,
  scoreCandidate,
  type ReasonCode,
} from "./bank-match-scoring";
import { getLatestRate } from "./exchange-rate.service";
import { computeRulePosting, ruleMatches, type SplitLine } from "./bank-rule-split";

export const CLEARING_ACCOUNT_CODE = "1025";
export const RULE_CONFIDENCE = 75;
export const CLEARING_CONFIDENCE = 70;

export type SuggestionKind = "invoice" | "bill" | "journal" | "receipt" | "rule" | "account" | "invoices" | "transfer";

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
  /** kind "invoices": the invoices one receipt settles, in order. */
  targetIds?: string[];
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
  /** Unmatched bank lines of the whole company (the other leg of an own-account transfer is among them). */
  openTxns: BankTransaction[];
  /** AED per unit of each foreign bank currency, latest. */
  rates: Map<string, number>;
}

const num = (v: unknown): number => Number(v) || 0;
const day = (d: Date): string => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" (selected with to_char, so the server's time zone cannot move it) as UTC midnight. */
const dayToDate = (s: string): Date => new Date(`${s}T00:00:00Z`);

async function loadOpenInvoices(companyId: string): Promise<OpenDoc[]> {
  const res = await pool.query(
    `SELECT i.id, i.number, i.customer_name, i.currency, ${dubaiDayTextSql("i.date")} AS date_s, ${dubaiDayTextSql("i.due_date")} AS due_s,
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
    `SELECT b.id, b.bill_number, b.vendor_name, b.currency, ${dubaiDayTextSql("b.bill_date")} AS date_s, ${dubaiDayTextSql("b.due_date")} AS due_s,
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
    `SELECT jl.account_id AS gl_id, je.id AS entry_id, je.source, je.source_id, je.memo, je.entry_number, ${dubaiDayTextSql("je.date")} AS date_s,
            SUM(jl.debit - jl.credit)::float8 AS net, MAX(r.merchant) AS merchant
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       LEFT JOIN receipts r ON je.source = 'receipt' AND r.id = je.source_id AND r.company_id = je.company_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = ANY($2::uuid[])
        AND je.date >= $3 AND je.date <= $4
        AND je.reversed_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted')
        AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND ${linkedToSql("bt", "je")}
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

  const openTxns = (await storage.getUnreconciledBankTransactions(companyId)).filter((t) => t.matchStatus !== "matched").slice(0, 500);
  const rates = new Map<string, number>();
  for (const cur of new Set(bankAccountList.map((b) => (b.currency || "AED").toUpperCase()))) {
    if (cur === "AED") continue;
    const r = await getLatestRate(cur, "AED", undefined, companyId);
    if (r && r > 0) rates.set(cur, r);
  }

  return {
    openTxns,
    rates,
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
const rateOf = (pool_: Pick<CandidatePool, "rates">, currency: string): number | null => (currency === "AED" ? 1 : (pool_.rates.get(currency) ?? null));

/** Up to 3 sets of 2-4 open invoices that add up to the bank amount exactly, best matches of the bank text first. */
export function invoiceCombinations(docs: OpenDoc[], amount: number, text: string): OpenDoc[][] {
  const target = Math.round(amount * 100);
  const pool = docs
    .filter((d) => d.open <= amount + 0.005)
    .map((d) => ({ d, sim: nameSimilarity(text, d.name ?? ""), cents: Math.round(d.open * 100) }))
    .sort((a, b) => b.sim - a.sim || a.d.open - b.d.open)
    .slice(0, 14);
  const found: OpenDoc[][] = [];
  const walk = (start: number, picked: typeof pool, sum: number) => {
    if (found.length >= 3) return;
    if (picked.length >= 2 && sum === target) {
      found.push(picked.map((p) => p.d));
      return;
    }
    if (picked.length >= 4 || sum >= target) return;
    for (let i = start; i < pool.length; i++) walk(i + 1, [...picked, pool[i]], sum + pool[i].cents);
  };
  walk(0, [], 0);
  return found;
}

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

  // one receipt that pays several invoices exactly (nothing single fits)
  if (inflow && txn.bankAccountId && !out.some((s) => s.kind === "invoice" && s.amountMatches)) {
    const control = pool_.accountsByCode.get(ACCOUNT_CODES.AR);
    for (const combo of invoiceCombinations(pool_.invoices.filter((d) => d.currency.toUpperCase() === bankCurrency), amount, text)) {
      const sameCustomer = new Set(combo.map((d) => (d.name ?? "").trim().toLowerCase())).size === 1;
      const named = combo.some((d) => nameSimilarity(text, d.name ?? "") >= 0.25);
      const confidence = Math.min(90, 70 + (sameCustomer ? 10 : 0) + (named ? 10 : 0));
      if (confidence < minConfidence) continue;
      out.push({
        ...base,
        kind: "invoices",
        targetId: combo[0].id,
        targetIds: combo.map((d) => d.id),
        confidence,
        reasons: ["AMOUNT_EXACT", "COMBINATION_OF_INVOICES", ...(named ? (["NAME_STRONG"] as ReasonCode[]) : [])],
        label: `Invoices ${combo.map((d) => d.number ?? "").join(", ")}${combo[0].name ? ` · ${combo[0].name}` : ""}`,
        posts: true,
        amountMatches: true,
        proposedLines: control ? [line(pool_, txn.bankAccountId, amount, 0, txn.description), line(pool_, control.id, 0, amount, combo.map((d) => d.number).join(", "))] : [],
      });
    }
  }

  // the other leg of a transfer between two own bank accounts (maybe in another currency)
  if (txn.bankStatementAccountId) {
    const mine = rateOf(pool_, bankCurrency);
    for (const o of pool_.openTxns) {
      if (o.id === txn.id || o.bankStatementAccountId === txn.bankStatementAccountId || !o.bankStatementAccountId) continue;
      if (Number(o.amount) > 0 === inflow) continue;
      if (daysBetween(new Date(o.transactionDate), date) > 5) continue;
      const otherCur = (pool_.bankAccounts.get(o.bankStatementAccountId)?.currency || "AED").toUpperCase();
      const theirs = rateOf(pool_, otherCur);
      if (!mine || !theirs) continue;
      const otherAbs = Math.abs(Number(o.amount));
      const same = otherCur === bankCurrency;
      const fits = same ? Math.abs(otherAbs - amount) < 0.005 : Math.abs(otherAbs * theirs - amount * mine) / Math.max(amount * mine, 0.01) <= 0.03;
      if (!fits) continue;
      const confidence = same ? 85 : 75;
      if (confidence < minConfidence) continue;
      out.push({
        ...base,
        kind: "transfer",
        targetId: o.id,
        confidence,
        reasons: ["TRANSFER_BETWEEN_OWN_ACCOUNTS"],
        label: `Transfer · ${o.description}`,
        posts: true,
        amountMatches: true,
        proposedLines: [],
      });
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
  const pairs = assignGreedy(options, (s: Suggestion) =>
    s.kind === "rule" ? `rule:${s.transactionId}` : s.kind === "transfer" ? `transfer:${[s.transactionId, s.targetId].sort().join(",")}` : s.kind === "invoices" ? `invoices:${(s.targetIds ?? []).sort().join(",")}` : `${s.kind}:${s.targetId}`
  );
  return pairs.map((p) => p.candidate).sort((a, b) => b.confidence - a.confidence);
}

export { CONFIDENT_SCORE };
