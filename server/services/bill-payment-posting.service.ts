import {
  positiveExchangeRate,
  round2,
  toBaseCurrencyAmount,
  withForeignAmount,
} from './fx.service';

/**
 * Pure helper: build the journal lines for a vendor-bill payment.
 *
 * Bills are posted to the GL as Dr Accounts Payable / Cr Cash (or Bank). This
 * helper enforces the invariants that the post-payment route can't easily check
 * after construction:
 *   - amount must be a positive, finite number (a zero-amount entry "balances"
 *     at 0 = 0 and would silently pollute the JE list);
 *   - AP and the payment account must be different (Dr X / Cr X self-cancels).
 *
 * The route layer is responsible for tenant scoping, AP-account lookup, the
 * transaction wrapper, and persisting the resulting entry.
 */
export interface BillPaymentJournalLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  foreignCurrency?: string;
  foreignDebit?: number;
  foreignCredit?: number;
  exchangeRate?: number;
}

export interface BuildBillPaymentJournalLinesInput {
  apAccountId: string;
  paymentAccountId: string;
  amount: number;
  description: string;
  currency?: string;
  exchangeRate?: number;
}

export function buildBillPaymentJournalLines(
  input: BuildBillPaymentJournalLinesInput,
): [BillPaymentJournalLine, BillPaymentJournalLine] {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Bill payment amount must be a positive number');
  }
  if (input.apAccountId === input.paymentAccountId) {
    throw new Error(
      'Bill payment AP and cash accounts must be different accounts',
    );
  }
  const currency = (input.currency || 'AED').toUpperCase();
  const exchangeRate = currency === 'AED' ? 1 : positiveExchangeRate(input.exchangeRate);
  const foreignAmount = round2(input.amount);
  const baseAmount = toBaseCurrencyAmount(foreignAmount, currency, exchangeRate);
  return [
    {
      accountId: input.apAccountId,
      debit: baseAmount,
      credit: 0,
      description: input.description,
      ...withForeignAmount(currency, exchangeRate, foreignAmount, 0),
    },
    {
      accountId: input.paymentAccountId,
      debit: 0,
      credit: baseAmount,
      description: input.description,
      ...withForeignAmount(currency, exchangeRate, 0, foreignAmount),
    },
  ];
}
