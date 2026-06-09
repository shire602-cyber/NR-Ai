import { round2 } from './fx.service';

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
}

export interface BuildVendorBillApprovalJournalLinesInput {
  expenseLines: VendorBillExpenseLine[];
  apAccountId: string;
  inputVatAccountId?: string;
  outputVatAccountId?: string;
  vatAmount: number;
  reverseCharge: boolean;
  description: string;
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

  const expenseLines = input.expenseLines.map((line) => {
    const amount = round2(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Vendor bill line amount must be a positive number');
    }
    return {
      accountId: line.accountId,
      debit: amount,
      credit: 0,
      description: line.description,
    };
  });

  const subtotal = round2(expenseLines.reduce((sum, line) => sum + line.debit, 0));
  const vatAmount = round2(input.vatAmount);
  if (!Number.isFinite(vatAmount) || vatAmount < 0) {
    throw new Error('Vendor bill VAT amount must be zero or positive');
  }

  const lines: VendorBillApprovalLine[] = [...expenseLines];

  if (vatAmount > 0) {
    if (!input.inputVatAccountId) {
      throw new Error('Input VAT account is required for VAT-bearing vendor bills');
    }
    lines.push({
      accountId: input.inputVatAccountId,
      debit: vatAmount,
      credit: 0,
      description: `${input.description} - input VAT`,
    });
  }

  lines.push({
    accountId: input.apAccountId,
    debit: 0,
    credit: input.reverseCharge ? subtotal : round2(subtotal + vatAmount),
    description: `${input.description} - accounts payable`,
  });

  if (input.reverseCharge && vatAmount > 0) {
    if (!input.outputVatAccountId) {
      throw new Error('Output VAT account is required for reverse-charge vendor bills');
    }
    lines.push({
      accountId: input.outputVatAccountId,
      debit: 0,
      credit: vatAmount,
      description: `${input.description} - reverse-charge output VAT`,
    });
  }

  return lines;
}
