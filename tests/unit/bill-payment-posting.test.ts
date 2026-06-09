import { describe, it, expect } from 'vitest';
import { buildBillPaymentJournalLines } from '../../server/services/bill-payment-posting.service';
import { assertBalancedJournalLines } from '../../server/services/journal-balance.service';

// Bill payment must hit the GL: Dr Accounts Payable (reduce liability),
// Cr Cash/Bank (reduce asset) by the SAME amount. The pure helper builds the
// line shape; the route is responsible for the AP-account lookup + transaction.
describe('buildBillPaymentJournalLines', () => {
  it('produces a balanced Dr AP / Cr Cash entry', () => {
    const lines = buildBillPaymentJournalLines({
      apAccountId: 'ap-id',
      paymentAccountId: 'cash-id',
      amount: 1234.56,
      description: 'Payment to ACME Inc',
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountId: 'ap-id', debit: 1234.56, credit: 0 });
    expect(lines[1]).toMatchObject({ accountId: 'cash-id', debit: 0, credit: 1234.56 });
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('rounds to 2dp (numeric(15,2)) on construction so the JE is exactly balanced', () => {
    const lines = buildBillPaymentJournalLines({
      apAccountId: 'a',
      paymentAccountId: 'b',
      amount: 100.005, // half-cent
      description: 'X',
    });
    expect(lines[0].debit).toBe(100.01);
    expect(lines[1].credit).toBe(100.01);
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('rejects non-positive amounts (would post a zero-movement JE that "balances" at 0=0)', () => {
    expect(() => buildBillPaymentJournalLines({
      apAccountId: 'a', paymentAccountId: 'b', amount: 0, description: 'X',
    })).toThrow(/positive/i);
    expect(() => buildBillPaymentJournalLines({
      apAccountId: 'a', paymentAccountId: 'b', amount: -1, description: 'X',
    })).toThrow(/positive/i);
    expect(() => buildBillPaymentJournalLines({
      apAccountId: 'a', paymentAccountId: 'b', amount: Number.NaN, description: 'X',
    })).toThrow(/positive/i);
  });

  it('rejects same-account loops (Dr X / Cr X would self-cancel)', () => {
    expect(() => buildBillPaymentJournalLines({
      apAccountId: 'same', paymentAccountId: 'same', amount: 50, description: 'X',
    })).toThrow(/different/i);
  });
});
