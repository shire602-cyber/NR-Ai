// The two-sided bank reconciliation statement, pure arithmetic.
//
//   Statement balance (S)                      + deposits in transit (LD: ledger money-in not yet on the statement)
//                                              - outstanding payments (LC: ledger money-out not yet on the statement)
//   = adjusted statement balance
//   Ledger balance (L)                         + unreconciled credits (SC: statement money-in not yet in the ledger)
//                                              - unreconciled debits (SD: statement money-out not yet in the ledger)
//   = adjusted ledger balance
//
// The two adjusted balances are equal when every difference is an item on one of the four lists.

import Decimal from "decimal.js";

export interface LedgerItem {
  entryId: string;
  entryNumber: string;
  date: string;
  memo: string | null;
  source: string;
  sourceId: string | null;
  /** Net movement on the bank GL account in the account currency: positive = money in. */
  amount: number;
}

export interface StatementItem {
  transactionId: string;
  date: string;
  description: string;
  reference: string | null;
  /** Signed: positive = credit (money in). */
  amount: number;
}

export type StatementBalanceSource = "param" | "session" | "import" | "running_balance" | null;

export interface ReconciliationStatement {
  bankAccountId: string;
  asOf: string;
  currency: string;
  statementBalance: number | null;
  statementBalanceSource: StatementBalanceSource;
  ledgerBalance: number;
  unreconciledCredits: number;
  unreconciledDebits: number;
  depositsInTransit: number;
  outstandingPayments: number;
  adjustedStatementBalance: number | null;
  adjustedLedgerBalance: number;
  difference: number | null;
  /** FX_RATE_MISSING: a line keyed in AED only could not be converted to the account currency. */
  warnings?: string[];
  items: {
    unreconciledCredits: StatementItem[];
    unreconciledDebits: StatementItem[];
    depositsInTransit: LedgerItem[];
    outstandingPayments: LedgerItem[];
  };
}

const r2 = (v: Decimal.Value): number => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const sum = (xs: number[]): Decimal => xs.reduce((a, b) => a.plus(b), new Decimal(0));

export function computeStatementMath(input: {
  bankAccountId: string;
  asOf: string;
  currency: string;
  statementBalance: number | null;
  statementBalanceSource: StatementBalanceSource;
  ledgerBalance: number;
  /** Bank statement lines not matched to a ledger entry as of the date. */
  bankItems: StatementItem[];
  /** Ledger entries on the bank account that no statement line clears as of the date. */
  ledgerItems: LedgerItem[];
}): ReconciliationStatement {
  const credits = input.bankItems.filter((i) => i.amount > 0);
  const debits = input.bankItems.filter((i) => i.amount < 0);
  const inTransit = input.ledgerItems.filter((i) => i.amount > 0);
  const outstanding = input.ledgerItems.filter((i) => i.amount < 0);

  const sc = sum(credits.map((i) => i.amount));
  const sd = sum(debits.map((i) => Math.abs(i.amount)));
  const ld = sum(inTransit.map((i) => i.amount));
  const lc = sum(outstanding.map((i) => Math.abs(i.amount)));

  const adjustedLedger = new Decimal(input.ledgerBalance).plus(sc).minus(sd);
  const adjustedStatement = input.statementBalance === null ? null : new Decimal(input.statementBalance).plus(ld).minus(lc);

  return {
    bankAccountId: input.bankAccountId,
    asOf: input.asOf,
    currency: input.currency,
    statementBalance: input.statementBalance,
    statementBalanceSource: input.statementBalanceSource,
    ledgerBalance: r2(input.ledgerBalance),
    unreconciledCredits: r2(sc),
    unreconciledDebits: r2(sd),
    depositsInTransit: r2(ld),
    outstandingPayments: r2(lc),
    adjustedStatementBalance: adjustedStatement === null ? null : r2(adjustedStatement),
    adjustedLedgerBalance: r2(adjustedLedger),
    difference: adjustedStatement === null ? null : r2(adjustedStatement.minus(adjustedLedger)),
    items: {
      unreconciledCredits: credits,
      unreconciledDebits: debits,
      depositsInTransit: inTransit,
      outstandingPayments: outstanding,
    },
  };
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // spreadsheet formula injection
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The statement as CSV (UTF-8 with BOM so Excel reads Arabic text). */
export function reconciliationStatementCsv(s: ReconciliationStatement): string {
  const rows: unknown[][] = [
    ["Bank reconciliation statement"],
    ["Bank account", s.bankAccountId],
    ["As of", s.asOf],
    ["Currency", s.currency],
    [],
    ["Statement balance", s.statementBalance ?? ""],
    ["Add: deposits in transit", s.depositsInTransit],
    ["Less: outstanding payments", s.outstandingPayments],
    ["Adjusted statement balance", s.adjustedStatementBalance ?? ""],
    [],
    ["Ledger balance", s.ledgerBalance],
    ["Add: unreconciled credits", s.unreconciledCredits],
    ["Less: unreconciled debits", s.unreconciledDebits],
    ["Adjusted ledger balance", s.adjustedLedgerBalance],
    [],
    ["Difference", s.difference ?? ""],
    [],
    ["Section", "Date", "Reference", "Description", "Amount"],
    ...s.items.depositsInTransit.map((i) => ["Deposit in transit", i.date, i.entryNumber, i.memo ?? i.source, i.amount]),
    ...s.items.outstandingPayments.map((i) => ["Outstanding payment", i.date, i.entryNumber, i.memo ?? i.source, i.amount]),
    ...s.items.unreconciledCredits.map((i) => ["Unreconciled credit", i.date, i.reference ?? "", i.description, i.amount]),
    ...s.items.unreconciledDebits.map((i) => ["Unreconciled debit", i.date, i.reference ?? "", i.description, i.amount]),
  ];
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
