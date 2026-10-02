// The journal lines for one bank line, pure. The bank GL account takes the whole movement; the contra lines (a chosen
// account, a rule's split accounts plus input VAT) take the other side. For a bank account in a foreign currency the
// amounts are converted at the rate of the bank date: each contra line is round2(amount x rate), the bank line is
// round2(gross x rate) and carries the foreign amount, and any rounding residue lands on the largest contra line so the
// entry balances to the fils.

import Decimal from "decimal.js";

export interface ContraInput {
  accountId: string;
  /** Positive, in the bank account's currency. */
  amount: number;
  description?: string | null;
}

export interface EntryLine {
  accountId: string;
  debit: number;
  credit: number;
  description?: string | null;
  foreignCurrency?: string;
  foreignDebit?: number;
  foreignCredit?: number;
  exchangeRate?: number;
}

const r2 = (n: Decimal.Value): number => new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export function buildBankEntryLines(args: {
  /** Signed bank amount in the bank account's currency: positive = money in. */
  amount: number;
  bankGlAccountId: string;
  contra: ContraInput[];
  currency: string;
  /** AED per unit of `currency` on the bank date (1 for AED). */
  rate: number;
  description: string;
}): EntryLine[] {
  const inflow = args.amount > 0;
  const gross = Math.abs(args.amount);
  const contraTotal = args.contra.reduce((s, c) => s.plus(c.amount), new Decimal(0));
  if (contraTotal.minus(gross).abs().greaterThan("0.005")) {
    throw new Error(`Contra lines (${contraTotal.toFixed(2)}) do not add up to the bank amount (${gross.toFixed(2)})`);
  }
  const foreign = args.currency.toUpperCase() !== "AED";
  const rate = foreign ? args.rate : 1;
  const grossAed = r2(new Decimal(gross).times(rate));
  const contraAed = args.contra.map((c) => r2(new Decimal(c.amount).times(rate)));
  const residue = new Decimal(grossAed).minus(contraAed.reduce((a, b) => a + b, 0)).toNumber();
  if (Math.abs(residue) > 0.000001 && contraAed.length) {
    let largest = 0;
    contraAed.forEach((v, i) => {
      if (v > contraAed[largest]) largest = i;
    });
    contraAed[largest] = r2(contraAed[largest] + residue);
  }

  const bankLine: EntryLine = {
    accountId: args.bankGlAccountId,
    debit: inflow ? grossAed : 0,
    credit: inflow ? 0 : grossAed,
    description: args.description,
    ...(foreign
      ? {
          foreignCurrency: args.currency.toUpperCase(),
          foreignDebit: inflow ? r2(gross) : 0,
          foreignCredit: inflow ? 0 : r2(gross),
          exchangeRate: rate,
        }
      : {}),
  };
  const contraLines: EntryLine[] = args.contra.map((c, i) => ({
    accountId: c.accountId,
    debit: inflow ? 0 : contraAed[i],
    credit: inflow ? contraAed[i] : 0,
    description: c.description ?? args.description,
  }));
  return inflow ? [bankLine, ...contraLines] : [...contraLines, bankLine];
}

/** The reversing lines of a posted entry (debit and credit swapped, foreign amounts swapped with them). */
export function reverseLines(
  lines: Array<{
    accountId: string;
    debit: number | string;
    credit: number | string;
    description?: string | null;
    foreignCurrency?: string | null;
    foreignDebit?: number | string | null;
    foreignCredit?: number | string | null;
    exchangeRate?: number | string | null;
  }>,
  label: string
): EntryLine[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    debit: Number(l.credit) || 0,
    credit: Number(l.debit) || 0,
    description: `${label}${l.description ? `: ${l.description}` : ""}`.slice(0, 500),
    ...(l.foreignCurrency
      ? {
          foreignCurrency: l.foreignCurrency,
          foreignDebit: Number(l.foreignCredit) || 0,
          foreignCredit: Number(l.foreignDebit) || 0,
          exchangeRate: Number(l.exchangeRate) || 1,
        }
      : {}),
  }));
}
