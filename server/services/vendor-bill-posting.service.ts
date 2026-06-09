import {
  positiveExchangeRate,
  round2,
  toBaseCurrencyAmount,
  withForeignAmount,
} from './fx.service';

export interface VendorBillExpenseLine {
  accountId: string;
  amount: number;
  description: string;
}

export interface VendorBillApprovalLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  foreignCurrency?: string;
  foreignDebit?: number;
  foreignCredit?: number;
  exchangeRate?: number;
}

export interface BuildVendorBillApprovalJournalLinesInput {
  expenseLines: VendorBillExpenseLine[];
  apAccountId: string;
  inputVatAccountId?: string;
  outputVatAccountId?: string;
  vatAmount: number;
  reverseCharge: boolean;
  description: string;
  currency?: string;
  exchangeRate?: number;
}

export interface CalculateVendorBillBaseAmountInput {
  expenseAmounts: number[];
  vatAmount: number;
  reverseCharge: boolean;
  currency?: string;
  exchangeRate?: number;
}

export function calculateVendorBillBaseAmount(
  input: CalculateVendorBillBaseAmountInput,
): number {
  const currency = (input.currency || 'AED').toUpperCase();
  const exchangeRate = currency === 'AED' ? 1 : positiveExchangeRate(input.exchangeRate);
  const baseExpenseTotal = round2(input.expenseAmounts.reduce((sum, rawAmount) => {
    const amount = round2(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Vendor bill line amounts must be zero or positive');
    }
    return sum + toBaseCurrencyAmount(amount, currency, exchangeRate);
  }, 0));
  const vatAmount = round2(input.vatAmount);
  if (!Number.isFinite(vatAmount) || vatAmount < 0) {
    throw new Error('Vendor bill VAT amount must be zero or positive');
  }
  const baseVatAmount = toBaseCurrencyAmount(vatAmount, currency, exchangeRate);
  return input.reverseCharge ? baseExpenseTotal : round2(baseExpenseTotal + baseVatAmount);
}

/**
 * Build the JE for approving a vendor bill.
 *
 * Normal VAT bill:
 *   Dr Expense/Asset lines
 *   Dr VAT Receivable (input VAT)
 *   Cr Accounts Payable
 *
 * Reverse-charge bill:
 *   Dr Expense/Asset lines
 *   Dr VAT Receivable (input VAT)
 *   Cr Accounts Payable for vendor subtotal only
 *   Cr VAT Payable (output VAT self-assessed)
 */
export function buildVendorBillApprovalJournalLines(
  input: BuildVendorBillApprovalJournalLinesInput,
): VendorBillApprovalLine[] {
  if (input.expenseLines.length === 0) {
    throw new Error('Vendor bill approval requires at least one expense line');
  }

  const currency = (input.currency || 'AED').toUpperCase();
  const exchangeRate = currency === 'AED' ? 1 : positiveExchangeRate(input.exchangeRate);

  const expenseLines = input.expenseLines.map((line) => {
    const amount = round2(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Vendor bill line amount must be a positive number');
    }
    return {
      accountId: line.accountId,
      debit: toBaseCurrencyAmount(amount, currency, exchangeRate),
      credit: 0,
      description: line.description,
      ...withForeignAmount(currency, exchangeRate, amount, 0),
    };
  });

  const subtotal = round2(expenseLines.reduce((sum, line) => sum + line.debit, 0));
  const foreignSubtotal = round2(input.expenseLines.reduce((sum, line) => sum + round2(line.amount), 0));
  const vatAmount = round2(input.vatAmount);
  if (!Number.isFinite(vatAmount) || vatAmount < 0) {
    throw new Error('Vendor bill VAT amount must be zero or positive');
  }
  const baseVatAmount = toBaseCurrencyAmount(vatAmount, currency, exchangeRate);

  const lines: VendorBillApprovalLine[] = [...expenseLines];

  if (vatAmount > 0) {
    if (!input.inputVatAccountId) {
      throw new Error('Input VAT account is required for VAT-bearing vendor bills');
    }
    lines.push({
      accountId: input.inputVatAccountId,
      debit: baseVatAmount,
      credit: 0,
      description: `${input.description} - input VAT`,
      ...withForeignAmount(currency, exchangeRate, vatAmount, 0),
    });
  }

  const foreignApCredit = input.reverseCharge
    ? foreignSubtotal
    : round2(foreignSubtotal + vatAmount);
  lines.push({
    accountId: input.apAccountId,
    debit: 0,
    credit: input.reverseCharge ? subtotal : round2(subtotal + baseVatAmount),
    description: `${input.description} - accounts payable`,
    ...withForeignAmount(currency, exchangeRate, 0, foreignApCredit),
  });

  if (input.reverseCharge && vatAmount > 0) {
    if (!input.outputVatAccountId) {
      throw new Error('Output VAT account is required for reverse-charge vendor bills');
    }
    lines.push({
      accountId: input.outputVatAccountId,
      debit: 0,
      credit: baseVatAmount,
      description: `${input.description} - reverse-charge output VAT`,
      ...withForeignAmount(currency, exchangeRate, 0, vatAmount),
    });
  }

  return lines;
}
