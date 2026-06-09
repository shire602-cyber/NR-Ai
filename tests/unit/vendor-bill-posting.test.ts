import { describe, expect, it } from 'vitest';
import { buildVendorBillApprovalJournalLines } from '../../server/services/vendor-bill-posting.service';
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
      { accountId: 'expense', debit: 100, credit: 0, description: 'Goods' },
      { accountId: 'vat-input', debit: 5, credit: 0, description: 'Bill B-1 - input VAT' },
      { accountId: 'ap', debit: 0, credit: 105, description: 'Bill B-1 - accounts payable' },
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
      { accountId: 'expense', debit: 100, credit: 0, description: 'Foreign service' },
      { accountId: 'vat-input', debit: 5, credit: 0, description: 'Bill RC-1 - input VAT' },
      { accountId: 'ap', debit: 0, credit: 100, description: 'Bill RC-1 - accounts payable' },
      { accountId: 'vat-output', debit: 0, credit: 5, description: 'Bill RC-1 - reverse-charge output VAT' },
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
