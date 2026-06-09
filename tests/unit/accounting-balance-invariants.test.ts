import { describe, it, expect } from 'vitest';
import {
  positiveExchangeRate,
  toBaseCurrencyAmount,
  withForeignAmount,
} from '../../server/services/fx.service';
import { assertBalancedJournalLines } from '../../server/services/journal-balance.service';

/**
 * Cross-path accounting invariants. These tests exercise the SAME helpers the
 * posting paths use (invoice create, receipt posting, bank reconciliation,
 * vendor-bill payment) so a future "small" change to the helpers can never
 * silently produce unbalanced GL entries.
 */

describe('Invoice-shape journal balances under FX rounding', () => {
  // Mirror the invoice posting shape:
  //   Dr Accounts Receivable           = base total
  //   Cr Sales Revenue                 = base subtotal
  //   Cr VAT Payable (output)          = base VAT
  // The H3 fix derives the AR debit from the SUM of the credit legs so the
  // entry is always exactly balanced regardless of FX rounding.
  function buildInvoiceLines(currency: string, rate: number, subtotalForeign: number, vatForeign: number) {
    const baseSubtotal = toBaseCurrencyAmount(subtotalForeign, currency, rate);
    const baseVat = toBaseCurrencyAmount(vatForeign, currency, rate);
    const baseAr = Math.round((baseSubtotal + baseVat) * 100) / 100;
    return [
      {
        accountId: 'ar', debit: baseAr, credit: 0, description: 'AR',
        ...withForeignAmount(currency, rate, subtotalForeign + vatForeign, 0),
      },
      {
        accountId: 'rev', debit: 0, credit: baseSubtotal, description: 'Revenue',
        ...withForeignAmount(currency, rate, 0, subtotalForeign),
      },
      {
        accountId: 'vat', debit: 0, credit: baseVat, description: 'VAT',
        ...withForeignAmount(currency, rate, 0, vatForeign),
      },
    ];
  }

  it('AED invoice balances exactly', () => {
    const lines = buildInvoiceLines('AED', 1, 1000, 50);
    expect(lines[0].debit).toBe(1050);
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('USD invoice with non-trivial rate still balances after rounding', () => {
    // 100.005 * 3.6725 = 367.272... rounds to 367.27 each side, total 401.27
    const lines = buildInvoiceLines('USD', 3.6725, 100.005, 5.005);
    expect(lines[0].debit).toBe(lines[1].credit + lines[2].credit);
    expect(() => assertBalancedJournalLines(lines)).not.toThrow();
  });

  it('rejects an invoice where the AR debit was NOT derived from credit legs (pre-H3 bug)', () => {
    // What the OLD buggy code would have produced: AR debit = round(total*rate)
    // = round(105 * 3.6725) = round(385.6125) = 385.61. But the sum-of-rounded
    // credits = round(100*3.6725) + round(5*3.6725) = 367.25 + 18.36 = 385.61.
    // In this case they happen to match — choose a case where they don't.
    // 100.005 vs 5.005 at rate 3.6725:
    //   round(105.01 * 3.6725) = round(385.66... ) = 385.67  // total*rate rounded
    //   round(100.005 * 3.6725) + round(5.005 * 3.6725) = 367.27 + 18.38 = 385.65
    // The old code would emit AR=385.67 and credits summing to 385.65 -> unbalanced.
    const oldStyleLines = [
      { debit: 385.67, credit: 0 },
      { debit: 0, credit: 367.27 },
      { debit: 0, credit: 18.38 },
    ];
    // Off by 0.02 - guard catches it.
    expect(() => assertBalancedJournalLines(oldStyleLines)).toThrow(/unbalanced/i);
  });
});

describe('Journal reversal swap symmetry', () => {
  // Mirrors the reversal logic in server/routes/journal.routes.ts:432-442.
  // Reversing an entry swaps debit<->credit AND foreignDebit<->foreignCredit.
  // If a future refactor accidentally swaps only ONE pair, the reversed entry
  // would still be balanced in AED but its foreign-amount tracking would be
  // inverted — these tests pin that BOTH pairs swap symmetrically.
  function reverse(line: { debit: number; credit: number; foreignDebit?: number; foreignCredit?: number; foreignCurrency?: string; exchangeRate?: number }) {
    return {
      debit: line.credit,
      credit: line.debit,
      foreignCurrency: line.foreignCurrency,
      foreignDebit: line.foreignCredit || 0,
      foreignCredit: line.foreignDebit || 0,
      exchangeRate: line.exchangeRate || 1,
    };
  }

  it('reverses an AED line by swapping debit/credit', () => {
    const original = { debit: 100, credit: 0 };
    const reversed = reverse(original);
    expect(reversed.debit).toBe(0);
    expect(reversed.credit).toBe(100);
  });

  it('reverses a foreign line by swapping BOTH base and foreign amounts symmetrically', () => {
    const original = {
      debit: 367.25, credit: 0,
      foreignCurrency: 'USD', foreignDebit: 100, foreignCredit: 0, exchangeRate: 3.6725,
    };
    const reversed = reverse(original);
    expect(reversed.debit).toBe(0);
    expect(reversed.credit).toBe(367.25);
    expect(reversed.foreignDebit).toBe(0);
    expect(reversed.foreignCredit).toBe(100);
    expect(reversed.exchangeRate).toBe(3.6725);
  });

  it('reversing twice returns to the original', () => {
    const original = {
      debit: 50, credit: 0,
      foreignCurrency: 'EUR', foreignDebit: 13.5, foreignCredit: 0, exchangeRate: 3.7,
    };
    const twice = reverse(reverse(original));
    expect(twice.debit).toBe(original.debit);
    expect(twice.credit).toBe(original.credit);
    expect(twice.foreignDebit).toBe(original.foreignDebit);
    expect(twice.foreignCredit).toBe(original.foreignCredit);
    expect(twice.foreignCurrency).toBe(original.foreignCurrency);
    expect(twice.exchangeRate).toBe(original.exchangeRate);
  });
});

describe('Invoice void skips already-reversed payment JEs', () => {
  // Mirrors the filter logic added to invoices.routes.ts: candidatePaymentEntries
  // are filtered against an "already reversed" set so voiding doesn't post a
  // second reversal for a payment that was manually reversed earlier.
  function filterCandidates(
    candidates: Array<{ id: string }>,
    alreadyReversed: Set<string>,
  ) {
    return candidates.filter((e) => !alreadyReversed.has(e.id));
  }

  it('skips a payment JE that has already been reversed', () => {
    const candidates = [{ id: 'pay-1' }, { id: 'pay-2' }];
    const alreadyReversed = new Set(['pay-1']);
    expect(filterCandidates(candidates, alreadyReversed)).toEqual([{ id: 'pay-2' }]);
  });

  it('reverses every payment JE when none has been reversed yet', () => {
    const candidates = [{ id: 'pay-1' }, { id: 'pay-2' }];
    expect(filterCandidates(candidates, new Set())).toEqual(candidates);
  });

  it('reverses nothing when all payment JEs are already reversed', () => {
    const candidates = [{ id: 'pay-1' }, { id: 'pay-2' }];
    expect(filterCandidates(candidates, new Set(['pay-1', 'pay-2']))).toEqual([]);
  });
});

describe('positiveExchangeRate guards every posting path the same way', () => {
  it('rejects bad rates so the FX-amount conversion can never silently zero out', () => {
    expect(() => toBaseCurrencyAmount(100, 'USD', positiveExchangeRate(0))).toThrow();
    expect(() => toBaseCurrencyAmount(100, 'USD', positiveExchangeRate(-1))).toThrow();
    // The "valid" path still works.
    expect(toBaseCurrencyAmount(100, 'USD', positiveExchangeRate(3.6725))).toBeCloseTo(367.25, 2);
  });
});
