import { describe, expect, it } from 'vitest';
import {
  buildVendorBillApprovalJournalLines,
  calculateVendorBillBaseAmount,
} from '../../server/services/vendor-bill-posting.service';
import { assertBalancedJournalLines } from '../../server/services/journal-balance.service';

describe('buildVendorBillApprovalJournalLines', () => {
  it('posts a normal VAT vendor bill as Dr expense/input VAT and Cr AP', () => {
    const lines = buildVendorBillApprovalJournalLines({
      expenseLines: [{ accountId: 'expense', amount: 100, description: 'Goods' }],
      apAccountId: 'ap',
      inputVatAccountId: 'vat-input',
      vatAmount: 5,
      reverseCharge: false,
      description: 'Bill B-1',
    });

    expect(lines).toEqual([
      { accountId: 'expense', debit: 100, credit: 0, description: 'Goods', foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 },
      { accountId: 'vat-input', debit: 5, credit: 0, description: 'Bill B-1 - input VAT', foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 },
      { accountId: 'ap', debit: 0, credit: 105, description: 'Bill B-1 - accounts payable', foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 },
    ]);
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('posts reverse-charge VAT as self-assessed output VAT plus recoverable input VAT', () => {
    const lines = buildVendorBillApprovalJournalLines({
      expenseLines: [{ accountId: 'expense', amount: 100, description: 'Foreign service' }],
      apAccountId: 'ap',
      inputVatAccountId: 'vat-input',
      outputVatAccountId: 'vat-output',
      vatAmount: 5,
      reverseCharge: true,
      description: 'Bill RC-1',
    });

    expect(lines).toEqual([
      { accountId: 'expense', debit: 100, credit: 0, description: 'Foreign service', foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 },
      { accountId: 'vat-input', debit: 5, credit: 0, description: 'Bill RC-1 - input VAT', foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 },
      { accountId: 'ap', debit: 0, credit: 100, description: 'Bill RC-1 - accounts payable', foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 },
      { accountId: 'vat-output', debit: 0, credit: 5, description: 'Bill RC-1 - reverse-charge output VAT', foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 },
    ]);
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('posts a foreign-currency vendor bill in AED while preserving original currency amounts', () => {
    const lines = buildVendorBillApprovalJournalLines({
      expenseLines: [{ accountId: 'expense', amount: 100, description: 'USD goods' }],
      apAccountId: 'ap',
      inputVatAccountId: 'vat-input',
      vatAmount: 5,
      reverseCharge: false,
      description: 'Bill USD-1',
      currency: 'USD',
      exchangeRate: 3.6725,
    });

    expect(lines).toEqual([
      {
        accountId: 'expense',
        debit: 367.25,
        credit: 0,
        description: 'USD goods',
        foreignCurrency: 'USD',
        foreignDebit: 100,
        foreignCredit: 0,
        exchangeRate: 3.6725,
      },
      {
        accountId: 'vat-input',
        debit: 18.36,
        credit: 0,
        description: 'Bill USD-1 - input VAT',
        foreignCurrency: 'USD',
        foreignDebit: 5,
        foreignCredit: 0,
        exchangeRate: 3.6725,
      },
      {
        accountId: 'ap',
        debit: 0,
        credit: 385.61,
        description: 'Bill USD-1 - accounts payable',
        foreignCurrency: 'USD',
        foreignDebit: 0,
        foreignCredit: 105,
        exchangeRate: 3.6725,
      },
    ]);
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('calculates foreign bill base totals with the same line-level rounding as the journal AP credit', () => {
    const baseAmount = calculateVendorBillBaseAmount({
      expenseAmounts: [0.01, 0.01],
      vatAmount: 0,
      reverseCharge: false,
      currency: 'USD',
      exchangeRate: 3.6725,
    });
    const lines = buildVendorBillApprovalJournalLines({
      expenseLines: [
        { accountId: 'expense-1', amount: 0.01, description: 'Line 1' },
        { accountId: 'expense-2', amount: 0.01, description: 'Line 2' },
      ],
      apAccountId: 'ap',
      vatAmount: 0,
      reverseCharge: false,
      description: 'Tiny USD Bill',
      currency: 'USD',
      exchangeRate: 3.6725,
    });

    expect(baseAmount).toBe(0.08);
    expect(lines.find((line) => line.accountId === 'ap')?.credit).toBe(baseAmount);
  });

  it('posts a foreign reverse-charge bill with AED output/input VAT and foreign tracking', () => {
    const lines = buildVendorBillApprovalJournalLines({
      expenseLines: [{ accountId: 'expense', amount: 100, description: 'USD service' }],
      apAccountId: 'ap',
      inputVatAccountId: 'vat-input',
      outputVatAccountId: 'vat-output',
      vatAmount: 5,
      reverseCharge: true,
      description: 'Bill USD-RC',
      currency: 'USD',
      exchangeRate: 3.6725,
    });

    expect(lines.map((line) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit, foreignDebit: line.foreignDebit, foreignCredit: line.foreignCredit }))).toEqual([
      { accountId: 'expense', debit: 367.25, credit: 0, foreignDebit: 100, foreignCredit: 0 },
      { accountId: 'vat-input', debit: 18.36, credit: 0, foreignDebit: 5, foreignCredit: 0 },
      { accountId: 'ap', debit: 0, credit: 367.25, foreignDebit: 0, foreignCredit: 100 },
      { accountId: 'vat-output', debit: 0, credit: 18.36, foreignDebit: 0, foreignCredit: 5 },
    ]);
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('requires VAT accounts when VAT is present', () => {
    expect(() => buildVendorBillApprovalJournalLines({
      expenseLines: [{ accountId: 'expense', amount: 100, description: 'Goods' }],
      apAccountId: 'ap',
      vatAmount: 5,
      reverseCharge: false,
      description: 'Bill B-1',
    })).toThrow(/Input VAT account/);

    expect(() => buildVendorBillApprovalJournalLines({
      expenseLines: [{ accountId: 'expense', amount: 100, description: 'Foreign service' }],
      apAccountId: 'ap',
      inputVatAccountId: 'vat-input',
      vatAmount: 5,
      reverseCharge: true,
      description: 'Bill RC-1',
    })).toThrow(/Output VAT account/);
  });

  it('rejects missing or non-positive expense lines', () => {
    expect(() => buildVendorBillApprovalJournalLines({
      expenseLines: [],
      apAccountId: 'ap',
      vatAmount: 0,
      reverseCharge: false,
      description: 'Bill B-1',
    })).toThrow(/at least one/);

    expect(() => buildVendorBillApprovalJournalLines({
      expenseLines: [{ accountId: 'expense', amount: 0, description: 'Zero' }],
      apAccountId: 'ap',
      vatAmount: 0,
      reverseCharge: false,
      description: 'Bill B-1',
    })).toThrow(/positive/);
  });
});
