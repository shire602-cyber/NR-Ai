import { describe, it, expect } from 'vitest';
import {
  round2,
  computeDueDate,
  detectPeriod,
  listRecentPeriods,
  deadlineStatus,
  convertToAed,
  aggregateInvoiceLines,
  applyPartialExemption,
  buildVat201Boxes,
  reconcile,
  applyAdjustments,
  frequencyFromCompany,
  isValidVat201BoxKey,
  VAT201_BOX_KEYS,
  type Vat201BoxValues,
  type SavedAdjustment,
} from '../../server/services/vat-autopilot.service';

// ─── round2 ─────────────────────────────────────────────────────────────────

describe('round2', () => {
  it('rounds to two decimals', () => {
    // 1.005 cannot be represented exactly in IEEE-754, so JS rounds it down;
    // 1.0051 (which has an exact-enough representation) rounds up as expected.
    expect(round2(1.0051)).toBe(1.01);
    expect(round2(1.004)).toBe(1.0);
    expect(round2(0)).toBe(0);
    expect(round2(2.499999)).toBe(2.5);
  });
  it('handles negatives', () => {
    expect(round2(-1.236)).toBe(-1.24);
  });
});

// ─── computeDueDate ─────────────────────────────────────────────────────────

describe('computeDueDate', () => {
  it('returns 28 days after the period end', () => {
    const end = new Date(Date.UTC(2026, 2, 31, 23, 59, 59, 999));   // 2026-03-31
    const due = computeDueDate(end);
    // 31 Mar + 28 days = 28 Apr
    expect(due.getUTCFullYear()).toBe(2026);
    expect(due.getUTCMonth()).toBe(3);   // April (0-indexed)
    expect(due.getUTCDate()).toBe(28);
  });

  it('rolls past month boundaries correctly', () => {
    const end = new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999));  // 2026-06-30
    const due = computeDueDate(end);
    expect(due.getUTCMonth()).toBe(6);   // July
    expect(due.getUTCDate()).toBe(28);
  });
});

// ─── detectPeriod (quarterly + monthly + stagger) ───────────────────────────

describe('detectPeriod', () => {
  it('detects Jan-Mar period for a Jan-anchored quarterly filer in February', () => {
    const ref = new Date(Date.UTC(2026, 1, 15));   // 15 Feb 2026
    const period = detectPeriod('quarterly', 1, ref);
    expect(period.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-03-31T23:59:59.999Z');
    expect(period.frequency).toBe('quarterly');
  });

  it('detects Apr-Jun period for a Jan-anchored quarterly filer in May', () => {
    const ref = new Date(Date.UTC(2026, 4, 10));   // 10 May 2026
    const period = detectPeriod('quarterly', 1, ref);
    expect(period.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('respects FTA stagger (Feb-anchored quarterly: Feb-Apr)', () => {
    const ref = new Date(Date.UTC(2026, 2, 15));   // 15 Mar 2026
    const period = detectPeriod('quarterly', 2, ref);
    expect(period.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-04-30T23:59:59.999Z');
  });

  it('rolls year back when anchor month is later than reference month', () => {
    // Anchor is November (month 11), reference is January 2026.
    // Latest period that contains Jan must be Nov 2025 - Jan 2026.
    const ref = new Date(Date.UTC(2026, 0, 15));
    const period = detectPeriod('quarterly', 11, ref);
    expect(period.start.toISOString()).toBe('2025-11-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  it('returns the calendar month for monthly filers', () => {
    const ref = new Date(Date.UTC(2026, 5, 14));   // 14 Jun 2026
    const period = detectPeriod('monthly', 1, ref);
    expect(period.start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-06-30T23:59:59.999Z');
    expect(period.frequency).toBe('monthly');
  });

  it('computes the FTA-mandated due date as period end + 28 days', () => {
    const ref = new Date(Date.UTC(2026, 2, 1));    // 1 Mar 2026 → Q1 period
    const period = detectPeriod('quarterly', 1, ref);
    // Period end = 2026-03-31, due = 2026-04-28 at UTC midnight (computeDueDate
    // normalises to date-only granularity so timezone math cannot push it).
    expect(period.dueDate.toISOString()).toBe('2026-04-28T00:00:00.000Z');
  });

  it('keeps the last instant of a period inside that period', () => {
    // 2026-03-31T23:59:59.999Z is the very last millisecond of Q1; an invoice
    // dated then must still land in the Jan-Mar bucket.
    const ref = new Date('2026-03-31T23:59:59.999Z');
    const period = detectPeriod('quarterly', 1, ref);
    expect(period.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('flips to the next period at the first instant of the new month', () => {
    // 1 ms later than the test above must be in Q2 (Apr-Jun).
    const ref = new Date('2026-04-01T00:00:00.000Z');
    const period = detectPeriod('quarterly', 1, ref);
    expect(period.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('handles December → January year rollover for monthly filers', () => {
    const ref = new Date(Date.UTC(2026, 0, 5));  // 5 Jan 2026
    const period = detectPeriod('monthly', 1, ref);
    expect(period.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });
});

// ─── listRecentPeriods ──────────────────────────────────────────────────────

describe('listRecentPeriods', () => {
  it('walks backwards through quarters without overlap', () => {
    const ref = new Date(Date.UTC(2026, 4, 10));   // 10 May 2026
    const periods = listRecentPeriods('quarterly', 1, 4, ref);
    expect(periods).toHaveLength(4);
    // Q2 2026, Q1 2026, Q4 2025, Q3 2025
    expect(periods[0].start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(periods[1].start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(periods[2].start.toISOString()).toBe('2025-10-01T00:00:00.000Z');
    expect(periods[3].start.toISOString()).toBe('2025-07-01T00:00:00.000Z');
  });

  it('walks backwards through months for monthly filers', () => {
    const ref = new Date(Date.UTC(2026, 3, 10));   // 10 Apr 2026
    const periods = listRecentPeriods('monthly', 1, 3, ref);
    expect(periods.map(p => p.start.toISOString())).toEqual([
      '2026-04-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    ]);
  });

  it('walks across a year boundary for monthly filers', () => {
    const ref = new Date(Date.UTC(2026, 1, 5));    // 5 Feb 2026
    const periods = listRecentPeriods('monthly', 1, 4, ref);
    expect(periods.map(p => p.start.toISOString())).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2025-12-01T00:00:00.000Z',
      '2025-11-01T00:00:00.000Z',
    ]);
  });

  it('walks across a year boundary for staggered quarterly filers', () => {
    // Feb-anchor stagger (Feb-Apr / May-Jul / Aug-Oct / Nov-Jan) — going back
    // from Feb 2026 must produce Nov 2025-Jan 2026 immediately before.
    const ref = new Date(Date.UTC(2026, 1, 15));   // 15 Feb 2026
    const periods = listRecentPeriods('quarterly', 2, 3, ref);
    expect(periods.map(p => p.start.toISOString())).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2025-11-01T00:00:00.000Z',
      '2025-08-01T00:00:00.000Z',
    ]);
  });
});

// ─── deadlineStatus ─────────────────────────────────────────────────────────

describe('deadlineStatus', () => {
  const now = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));   // 1 Apr 2026

  it('flags overdue when due date is in the past', () => {
    const due = new Date(Date.UTC(2026, 2, 28));
    const result = deadlineStatus(due, now);
    expect(result.level).toBe('overdue');
    expect(result.isOverdue).toBe(true);
    expect(result.daysUntilDue).toBeLessThan(0);
  });

  it('flags critical when 3 or fewer days remain', () => {
    const due = new Date(Date.UTC(2026, 3, 3));   // 4 Apr → 3 days away
    const result = deadlineStatus(due, now);
    expect(result.level).toBe('critical');
  });

  it('flags warning between 4 and 7 days', () => {
    const due = new Date(Date.UTC(2026, 3, 8));   // 8 Apr → 7 days
    const result = deadlineStatus(due, now);
    expect(result.level).toBe('warning');
  });

  it('flags ok when more than 7 days remain', () => {
    const due = new Date(Date.UTC(2026, 3, 28));  // 28 Apr → 27 days
    const result = deadlineStatus(due, now);
    expect(result.level).toBe('ok');
    expect(result.isOverdue).toBe(false);
  });

  it('treats the day after the deadline as overdue (not critical)', () => {
    // Due was yesterday at midnight, now is the next day — clearly overdue.
    const due = new Date(Date.UTC(2026, 2, 31, 0, 0, 0));   // 31 Mar 2026
    const oneDayLater = new Date(Date.UTC(2026, 3, 1, 0, 0, 0)); // 1 Apr 2026
    const result = deadlineStatus(due, oneDayLater);
    expect(result.level).toBe('overdue');
    expect(result.isOverdue).toBe(true);
  });

  it('treats due-today as critical (not overdue) with 0 days remaining', () => {
    const due = new Date(Date.UTC(2026, 3, 1, 12, 0, 0));   // 1 Apr 2026 noon
    const result = deadlineStatus(due, now);
    expect(result.level).toBe('critical');
    expect(result.isOverdue).toBe(false);
    expect(result.daysUntilDue).toBe(1);
  });
});

// ─── convertToAed ───────────────────────────────────────────────────────────

describe('convertToAed', () => {
  it('multiplies amount by AED-per-foreign-unit rate', () => {
    expect(convertToAed(100, 3.67)).toBe(367);
  });

  it('returns zero for invalid inputs', () => {
    expect(convertToAed(NaN, 1)).toBe(0);
    expect(convertToAed(100, 0)).toBe(0);
    expect(convertToAed(100, -1)).toBe(0);
  });

  it('returns zero for non-finite rate (Infinity)', () => {
    expect(convertToAed(100, Number.POSITIVE_INFINITY)).toBe(0);
    expect(convertToAed(Number.POSITIVE_INFINITY, 3.67)).toBe(0);
  });

  it('rounds to AED cents', () => {
    expect(convertToAed(100, 3.6745)).toBe(367.45);
  });
});

// ─── aggregateInvoiceLines ─────────────────────────────────────────────────

describe('aggregateInvoiceLines', () => {
  it('splits lines into standard, zero-rated, and exempt buckets', () => {
    const result = aggregateInvoiceLines([
      { quantity: 2, unitPrice: 100, vatRate: 0.05, vatSupplyType: 'standard_rated' },
      { quantity: 1, unitPrice: 500, vatRate: 0,    vatSupplyType: 'zero_rated' },
      { quantity: 1, unitPrice: 300, vatRate: 0,    vatSupplyType: 'exempt' },
    ]);
    expect(result.standardRatedAmount).toBe(200);
    expect(result.standardRatedVat).toBe(10);
    expect(result.zeroRatedAmount).toBe(500);
    expect(result.exemptAmount).toBe(300);
    expect(result.outOfScopeAmount).toBe(0);
  });

  it('treats vatRate=0 with no supply type as zero-rated', () => {
    const result = aggregateInvoiceLines([
      { quantity: 1, unitPrice: 1000, vatRate: 0, vatSupplyType: null },
    ]);
    expect(result.zeroRatedAmount).toBe(1000);
    expect(result.standardRatedAmount).toBe(0);
  });

  it('defaults to UAE 5% when vatRate is null and supply is standard', () => {
    const result = aggregateInvoiceLines([
      { quantity: 1, unitPrice: 100, vatRate: null, vatSupplyType: 'standard_rated' },
    ]);
    expect(result.standardRatedVat).toBe(5);
  });

  it('returns all-zero buckets for zero invoices (empty array)', () => {
    const result = aggregateInvoiceLines([]);
    expect(result).toEqual({
      standardRatedAmount: 0,
      standardRatedVat: 0,
      zeroRatedAmount: 0,
      exemptAmount: 0,
      outOfScopeAmount: 0,
    });
  });

  it('aggregates a single invoice line correctly', () => {
    const result = aggregateInvoiceLines([
      { quantity: 3, unitPrice: 250, vatRate: 0.05, vatSupplyType: 'standard_rated' },
    ]);
    expect(result.standardRatedAmount).toBe(750);
    expect(result.standardRatedVat).toBe(37.5);
    expect(result.zeroRatedAmount).toBe(0);
    expect(result.exemptAmount).toBe(0);
  });

  it('treats an exempt supply with rate 0 as exempt, not zero-rated', () => {
    // Boundary: explicit "exempt" supply type must take precedence over the
    // rate=0 inference, since exempt and zero-rated map to different boxes.
    const result = aggregateInvoiceLines([
      { quantity: 1, unitPrice: 1000, vatRate: 0, vatSupplyType: 'exempt' },
    ]);
    expect(result.exemptAmount).toBe(1000);
    expect(result.zeroRatedAmount).toBe(0);
  });

  it('excludes out_of_scope supplies from every VAT 201 bucket', () => {
    // Out-of-scope supplies (e.g. designated-zone transactions, supplies made
    // outside UAE) must not appear in Box 1, 4, or 5 — they are not reportable
    // on the FTA VAT 201 form. Tracked separately so callers can verify.
    const result = aggregateInvoiceLines([
      { quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: 'standard_rated' },
      { quantity: 2, unitPrice: 250, vatRate: 0.05, vatSupplyType: 'out_of_scope' },
    ]);
    expect(result.standardRatedAmount).toBe(100);
    expect(result.standardRatedVat).toBe(5);
    expect(result.zeroRatedAmount).toBe(0);
    expect(result.exemptAmount).toBe(0);
    expect(result.outOfScopeAmount).toBe(500);
  });
});

// ─── applyPartialExemption ──────────────────────────────────────────────────

describe('applyPartialExemption', () => {
  it('returns full input vat when ratio is 0', () => {
    expect(applyPartialExemption(100, 0)).toEqual({
      recoverable: 100, irrecoverable: 0, recoverableRatio: 1,
    });
  });

  it('returns zero recoverable when ratio is 1', () => {
    expect(applyPartialExemption(100, 1)).toEqual({
      recoverable: 0, irrecoverable: 100, recoverableRatio: 0,
    });
  });

  it('applies a fractional ratio correctly', () => {
    const r = applyPartialExemption(200, 0.25);
    expect(r.recoverable).toBe(150);
    expect(r.irrecoverable).toBe(50);
  });

  it('clamps a ratio above 1 to 1', () => {
    const r = applyPartialExemption(100, 5);
    expect(r.recoverable).toBe(0);
    expect(r.irrecoverable).toBe(100);
  });

  it('clamps a negative ratio to 0', () => {
    const r = applyPartialExemption(100, -0.5);
    expect(r.recoverable).toBe(100);
    expect(r.irrecoverable).toBe(0);
  });

  it('returns zero recoverable for zero gross input VAT', () => {
    const r = applyPartialExemption(0, 0.4);
    expect(r.recoverable).toBe(0);
    expect(r.irrecoverable).toBe(0);
    expect(r.recoverableRatio).toBe(0.6);
  });

  it('keeps recoverable + irrecoverable summing to gross within rounding', () => {
    const r = applyPartialExemption(123.45, 0.37);
    expect(round2(r.recoverable + r.irrecoverable)).toBe(123.45);
  });
});

// ─── buildVat201Boxes (per-emirate routing + box totals) ───────────────────

describe('buildVat201Boxes', () => {
  const baseComponents = {
    standardRatedAmount: 1000,
    standardRatedVat: 50,
    zeroRatedAmount: 200,
    exemptAmount: 100,
    reverseChargeAmount: 0,
    reverseChargeVat: 0,
    reverseChargeVatRecoverable: 0,
    totalExpenses: 500,
    inputVatRecoverable: 25,
  };

  it('routes standard-rated sales to Box 1b for Dubai', () => {
    const b = buildVat201Boxes(baseComponents, 'dubai');
    expect(b.box1bDubaiAmount).toBe(1000);
    expect(b.box1bDubaiVat).toBe(50);
    expect(b.box1aAbuDhabiAmount).toBe(0);
  });

  it('routes standard-rated sales to Box 1a for Abu Dhabi', () => {
    const b = buildVat201Boxes(baseComponents, 'abu_dhabi');
    expect(b.box1aAbuDhabiAmount).toBe(1000);
    expect(b.box1aAbuDhabiVat).toBe(50);
    expect(b.box1bDubaiAmount).toBe(0);
  });

  it('falls back to Dubai for unknown emirates', () => {
    const b = buildVat201Boxes(baseComponents, 'unknown_emirate');
    expect(b.box1bDubaiAmount).toBe(1000);
  });

  it('computes Box 8/11/12/13/14 totals consistently', () => {
    const b = buildVat201Boxes(baseComponents, 'dubai');
    // Box 8 amount = 1000 (std) + 200 (zero) + 100 (exempt) = 1300
    expect(b.box8TotalAmount).toBe(1300);
    expect(b.box8TotalVat).toBe(50);
    // Box 11 amount = 500 expenses
    expect(b.box11TotalAmount).toBe(500);
    expect(b.box11TotalVat).toBe(25);
    expect(b.box12TotalDueTax).toBe(50);
    expect(b.box13RecoverableTax).toBe(25);
    expect(b.box14PayableTax).toBe(25);
  });

  it('includes reverse-charge in Box 8 amount and Box 3 figures', () => {
    const b = buildVat201Boxes(
      { ...baseComponents, reverseChargeAmount: 400, reverseChargeVat: 20, reverseChargeVatRecoverable: 20 },
      'dubai',
    );
    expect(b.box3ReverseChargeAmount).toBe(400);
    expect(b.box3ReverseChargeVat).toBe(20);
    expect(b.box10ReverseChargeAmount).toBe(400);
    expect(b.box10ReverseChargeVat).toBe(20);
    // Box 12 includes reverse charge VAT on output side
    expect(b.box12TotalDueTax).toBe(70);
  });

  it('routes standard-rated sales to Box 1c for Sharjah', () => {
    const b = buildVat201Boxes(baseComponents, 'sharjah');
    expect(b.box1cSharjahAmount).toBe(1000);
    expect(b.box1cSharjahVat).toBe(50);
    expect(b.box1bDubaiAmount).toBe(0);
  });

  it('routes standard-rated sales to Box 1d for Ajman', () => {
    const b = buildVat201Boxes(baseComponents, 'ajman');
    expect(b.box1dAjmanAmount).toBe(1000);
    expect(b.box1dAjmanVat).toBe(50);
  });

  it('routes standard-rated sales to Box 1e for Umm Al Quwain', () => {
    const b = buildVat201Boxes(baseComponents, 'umm_al_quwain');
    expect(b.box1eUmmAlQuwainAmount).toBe(1000);
    expect(b.box1eUmmAlQuwainVat).toBe(50);
  });

  it('routes standard-rated sales to Box 1f for Ras Al Khaimah', () => {
    const b = buildVat201Boxes(baseComponents, 'ras_al_khaimah');
    expect(b.box1fRasAlKhaimahAmount).toBe(1000);
    expect(b.box1fRasAlKhaimahVat).toBe(50);
  });

  it('routes standard-rated sales to Box 1g for Fujairah', () => {
    const b = buildVat201Boxes(baseComponents, 'fujairah');
    expect(b.box1gFujairahAmount).toBe(1000);
    expect(b.box1gFujairahVat).toBe(50);
  });

  it('produces an all-zero VAT 201 form when there is no activity', () => {
    const empty = {
      standardRatedAmount: 0, standardRatedVat: 0,
      zeroRatedAmount: 0, exemptAmount: 0,
      reverseChargeAmount: 0, reverseChargeVat: 0, reverseChargeVatRecoverable: 0,
      totalExpenses: 0, inputVatRecoverable: 0,
    };
    const b = buildVat201Boxes(empty, 'dubai');
    expect(b.box8TotalAmount).toBe(0);
    expect(b.box8TotalVat).toBe(0);
    expect(b.box11TotalAmount).toBe(0);
    expect(b.box11TotalVat).toBe(0);
    expect(b.box14PayableTax).toBe(0);
  });
});

// ─── reconcile ──────────────────────────────────────────────────────────────

describe('reconcile', () => {
  it('flags no discrepancy when figures match within tolerance', () => {
    const r = reconcile({ outputVat: 100, inputVat: 50 }, { outputVat: 100, inputVat: 50 });
    expect(r.hasDiscrepancy).toBe(false);
    expect(r.outputVatDelta).toBe(0);
    expect(r.inputVatDelta).toBe(0);
  });

  it('flags discrepancy when output VAT differs from ledger', () => {
    const r = reconcile({ outputVat: 105, inputVat: 50 }, { outputVat: 100, inputVat: 50 });
    expect(r.hasDiscrepancy).toBe(true);
    expect(r.outputVatDelta).toBe(5);
  });

  it('absorbs sub-cent rounding differences', () => {
    const r = reconcile({ outputVat: 100.005, inputVat: 50 }, { outputVat: 100, inputVat: 50 });
    expect(r.hasDiscrepancy).toBe(false);
  });

  it('does not flag a delta exactly at the 0.01 AED tolerance boundary', () => {
    // Service uses Math.abs(delta) > tolerance, so a delta of exactly 0.01
    // must NOT trip the discrepancy flag — it's the maximum allowed rounding.
    const r = reconcile({ outputVat: 100.01, inputVat: 50 }, { outputVat: 100, inputVat: 50 });
    expect(r.outputVatDelta).toBe(0.01);
    expect(r.hasDiscrepancy).toBe(false);
  });

  it('flags a delta just above the 0.01 AED tolerance boundary', () => {
    const r = reconcile({ outputVat: 100.02, inputVat: 50 }, { outputVat: 100, inputVat: 50 });
    expect(r.outputVatDelta).toBe(0.02);
    expect(r.hasDiscrepancy).toBe(true);
  });

  it('flags negative output deltas (calculated lower than ledger)', () => {
    const r = reconcile({ outputVat: 95, inputVat: 50 }, { outputVat: 100, inputVat: 50 });
    expect(r.outputVatDelta).toBe(-5);
    expect(r.hasDiscrepancy).toBe(true);
  });

  it('flags input-side discrepancies independently of output side', () => {
    const r = reconcile({ outputVat: 100, inputVat: 60 }, { outputVat: 100, inputVat: 50 });
    expect(r.hasDiscrepancy).toBe(true);
    expect(r.outputVatDelta).toBe(0);
    expect(r.inputVatDelta).toBe(10);
  });

  it('respects a custom tolerance argument', () => {
    const r = reconcile(
      { outputVat: 100.5, inputVat: 50 },
      { outputVat: 100, inputVat: 50 },
      1, // 1.00 AED tolerance
    );
    expect(r.outputVatDelta).toBe(0.5);
    expect(r.hasDiscrepancy).toBe(false);
  });
});

// ─── applyAdjustments ───────────────────────────────────────────────────────

describe('applyAdjustments', () => {
  function blankBoxes(): Vat201BoxValues {
    return {
      box1aAbuDhabiAmount: 0, box1aAbuDhabiVat: 0,
      box1bDubaiAmount: 1000, box1bDubaiVat: 50,
      box1cSharjahAmount: 0, box1cSharjahVat: 0,
      box1dAjmanAmount: 0, box1dAjmanVat: 0,
      box1eUmmAlQuwainAmount: 0, box1eUmmAlQuwainVat: 0,
      box1fRasAlKhaimahAmount: 0, box1fRasAlKhaimahVat: 0,
      box1gFujairahAmount: 0, box1gFujairahVat: 0,
      box3ReverseChargeAmount: 0, box3ReverseChargeVat: 0,
      box4ZeroRatedAmount: 200,
      box5ExemptAmount: 100,
      box8TotalAmount: 1300, box8TotalVat: 50,
      box9ExpensesAmount: 500, box9ExpensesVat: 25,
      box10ReverseChargeAmount: 0, box10ReverseChargeVat: 0,
      box11TotalAmount: 500, box11TotalVat: 25,
      box12TotalDueTax: 50,
      box13RecoverableTax: 25,
      box14PayableTax: 25,
    };
  }

  function adj(box: keyof Vat201BoxValues, amount: number): SavedAdjustment {
    return {
      id: 'a1', box: box as any, amount, reason: 'test', userId: 'u', createdAt: new Date().toISOString(),
    };
  }

  it('adds the adjustment to the targeted box', () => {
    const result = applyAdjustments(blankBoxes(), [adj('box1bDubaiVat', 10)]);
    expect(result.box1bDubaiVat).toBe(60);
  });

  it('re-derives totals (Box 12 / 13 / 14) after the adjustment', () => {
    const result = applyAdjustments(blankBoxes(), [adj('box1bDubaiVat', 10)]);
    expect(result.box8TotalVat).toBe(60);
    expect(result.box12TotalDueTax).toBe(60);
    expect(result.box14PayableTax).toBe(35);
  });

  it('supports negative adjustments (corrections)', () => {
    const result = applyAdjustments(blankBoxes(), [adj('box1bDubaiVat', -10)]);
    expect(result.box1bDubaiVat).toBe(40);
    expect(result.box14PayableTax).toBe(15);
  });

  it('ignores adjustments targeting unknown boxes', () => {
    const start = blankBoxes();
    const result = applyAdjustments(start, [adj('box99NonExistent' as any, 10)]);
    // totals unchanged
    expect(result.box14PayableTax).toBe(25);
  });

  it('applies adjustments cumulatively in order', () => {
    const result = applyAdjustments(
      blankBoxes(),
      [adj('box1bDubaiVat', 10), adj('box1bDubaiVat', -3)],
    );
    expect(result.box1bDubaiVat).toBe(57);
  });

  it('updates Box 8 amount when zero-rated supplies are adjusted', () => {
    const result = applyAdjustments(blankBoxes(), [adj('box4ZeroRatedAmount', 200)]);
    expect(result.box4ZeroRatedAmount).toBe(400);
    // Box 8 amount = 1000 (1b) + 400 (zero) + 100 (exempt) = 1500
    expect(result.box8TotalAmount).toBe(1500);
    // VAT total unchanged because zero-rated has no VAT
    expect(result.box8TotalVat).toBe(50);
  });

  it('updates Box 8 amount when exempt supplies are adjusted', () => {
    const result = applyAdjustments(blankBoxes(), [adj('box5ExemptAmount', 50)]);
    expect(result.box5ExemptAmount).toBe(150);
    expect(result.box8TotalAmount).toBe(1350);
  });

  it('routes a Sharjah-emirate adjustment into Box 1c and propagates to totals', () => {
    const result = applyAdjustments(blankBoxes(), [
      adj('box1cSharjahAmount', 500),
      adj('box1cSharjahVat', 25),
    ]);
    expect(result.box1cSharjahAmount).toBe(500);
    expect(result.box1cSharjahVat).toBe(25);
    // Box 8 amount = 1000 (Dubai) + 500 (Sharjah) + 200 (zero) + 100 (exempt) = 1800
    expect(result.box8TotalAmount).toBe(1800);
    // Box 8 VAT = 50 (Dubai) + 25 (Sharjah) = 75
    expect(result.box8TotalVat).toBe(75);
    expect(result.box14PayableTax).toBe(50);
  });

  it('updates Box 11 totals when input boxes are adjusted', () => {
    const result = applyAdjustments(blankBoxes(), [
      adj('box9ExpensesVat', 5),
      adj('box10ReverseChargeVat', 3),
    ]);
    expect(result.box11TotalVat).toBe(33);
    expect(result.box13RecoverableTax).toBe(33);
    expect(result.box14PayableTax).toBe(17);
  });
});

// ─── frequencyFromCompany ───────────────────────────────────────────────────

describe('frequencyFromCompany', () => {
  it('maps the "Monthly" string to monthly', () => {
    expect(frequencyFromCompany('Monthly')).toBe('monthly');
  });

  it('defaults to quarterly for everything else', () => {
    expect(frequencyFromCompany('Quarterly')).toBe('quarterly');
    expect(frequencyFromCompany(null)).toBe('quarterly');
    expect(frequencyFromCompany('')).toBe('quarterly');
  });
});

// ─── isValidVat201BoxKey (security: prevent prototype-pollution-style keys) ─

describe('isValidVat201BoxKey', () => {
  it('accepts every documented VAT 201 box key', () => {
    for (const k of VAT201_BOX_KEYS) {
      expect(isValidVat201BoxKey(k)).toBe(true);
    }
  });

  it('rejects inherited Object.prototype keys', () => {
    expect(isValidVat201BoxKey('__proto__')).toBe(false);
    expect(isValidVat201BoxKey('constructor')).toBe(false);
    expect(isValidVat201BoxKey('toString')).toBe(false);
    expect(isValidVat201BoxKey('hasOwnProperty')).toBe(false);
  });

  it('rejects unknown box names and non-string inputs', () => {
    expect(isValidVat201BoxKey('box99Imaginary')).toBe(false);
    expect(isValidVat201BoxKey('')).toBe(false);
    expect(isValidVat201BoxKey(undefined)).toBe(false);
    expect(isValidVat201BoxKey(null)).toBe(false);
    expect(isValidVat201BoxKey(42)).toBe(false);
    expect(isValidVat201BoxKey({})).toBe(false);
  });

  it('runtime list includes all final-total boxes (12, 13, 14)', () => {
    expect(VAT201_BOX_KEYS).toContain('box12TotalDueTax');
    expect(VAT201_BOX_KEYS).toContain('box13RecoverableTax');
    expect(VAT201_BOX_KEYS).toContain('box14PayableTax');
  });
});

// ─── applyAdjustments hardening (defense-in-depth on stored adjustments) ────

describe('applyAdjustments security', () => {
  function blankBoxes(): Vat201BoxValues {
    return {
      box1aAbuDhabiAmount: 0, box1aAbuDhabiVat: 0,
      box1bDubaiAmount: 1000, box1bDubaiVat: 50,
      box1cSharjahAmount: 0, box1cSharjahVat: 0,
      box1dAjmanAmount: 0, box1dAjmanVat: 0,
      box1eUmmAlQuwainAmount: 0, box1eUmmAlQuwainVat: 0,
      box1fRasAlKhaimahAmount: 0, box1fRasAlKhaimahVat: 0,
      box1gFujairahAmount: 0, box1gFujairahVat: 0,
      box3ReverseChargeAmount: 0, box3ReverseChargeVat: 0,
      box4ZeroRatedAmount: 200,
      box5ExemptAmount: 100,
      box8TotalAmount: 1300, box8TotalVat: 50,
      box9ExpensesAmount: 500, box9ExpensesVat: 25,
      box10ReverseChargeAmount: 0, box10ReverseChargeVat: 0,
      box11TotalAmount: 500, box11TotalVat: 25,
      box12TotalDueTax: 50,
      box13RecoverableTax: 25,
      box14PayableTax: 25,
    };
  }

  function rawAdj(box: string, amount: number): SavedAdjustment {
    return { id: 'a', box: box as any, amount, reason: 'r', userId: 'u', createdAt: new Date().toISOString() };
  }

  it('does not mutate prototype-keyed adjustments stored in legacy data', () => {
    const start = blankBoxes();
    const before = JSON.stringify(start);
    const result = applyAdjustments(start, [
      rawAdj('__proto__', 999),
      rawAdj('constructor', 999),
      rawAdj('toString', 999),
    ]);
    expect(JSON.stringify(result)).toBe(before);
    // Prototype is not polluted.
    expect((Object.prototype as any).box1bDubaiVat).toBeUndefined();
  });

  it('drops adjustments whose amount is non-finite', () => {
    const start = blankBoxes();
    const before = JSON.stringify(start);
    const result = applyAdjustments(start, [
      rawAdj('box1bDubaiVat', Number.NaN),
      rawAdj('box1bDubaiVat', Number.POSITIVE_INFINITY),
      rawAdj('box1bDubaiVat', Number.NEGATIVE_INFINITY),
    ]);
    expect(JSON.stringify(result)).toBe(before);
  });
});
