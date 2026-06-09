import Decimal from 'decimal.js';

/**
 * Defense-in-depth: never persist a journal entry whose debits and credits
 * don't balance within a 1-cent tolerance. Every posting path (invoice create,
 * invoice void, receipt posting, manual journal, bank reconciliation, vendor-
 * bill payment) should run lines through this before INSERT.
 *
 * Centralised here so all callers use the SAME Decimal-based summation — a
 * naive Number.reduce can accumulate floating-point drift across many lines
 * and reject a genuinely-balanced entry (or worse, accept an unbalanced one).
 */
export function assertBalancedJournalLines(
  lines: ReadonlyArray<{ debit?: number; credit?: number }>,
): void {
  const totalDebit = lines.reduce(
    (sum, line) => sum.plus(line.debit || 0),
    new Decimal(0),
  );
  const totalCredit = lines.reduce(
    (sum, line) => sum.plus(line.credit || 0),
    new Decimal(0),
  );
  if (totalDebit.minus(totalCredit).abs().greaterThan(0.01)) {
    throw new Error(
      `Journal entry is unbalanced: debits ${totalDebit.toFixed(2)} != credits ${totalCredit.toFixed(2)}`,
    );
  }
}
