import { describe, it, expect } from 'vitest';
import {
  buildVat201Boxes,
  accumulateImportRow,
  applyAdjustments,
  type ImportAccumulator,
} from '../../server/services/vat-autopilot.service';

// Zero baseline of the non-import components buildVat201Boxes expects.
const ZERO = {
  standardRatedAmount: 0, standardRatedVat: 0,
  zeroRatedAmount: 0, exemptAmount: 0,
  reverseChargeAmount: 0, reverseChargeVat: 0, reverseChargeVatRecoverable: 0,
  totalExpenses: 0, inputVatRecoverable: 0,
  importsAmount: 0, importsVat: 0,
  importAdjAmount: 0, importAdjVat: 0,
  importsVatRecoverable: 0,
};

describe('buildVat201Boxes — imports', () => {
  it('books an import to Box 6 due AND Box 10 recovery (not Box 9)', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 50 },
      'dubai',
    );
    expect(b.box6ImportsAmount).toBe(1000);
    expect(b.box6ImportsVat).toBe(50);
    expect(b.box9ExpensesVat).toBe(0); // imports never touch Box 9
    expect(b.box10ReverseChargeVat).toBe(50); // recovery via Box 10
    expect(b.box8TotalVat).toBe(50); // due side
    expect(b.box13RecoverableTax).toBe(50); // recoverable side
  });

  it('fully-recoverable import nets to zero in Box 14', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 50 },
      'dubai',
    );
    expect(b.box14PayableTax).toBe(0);
  });

  it('partial-exemption import leaves the non-recoverable VAT payable', () => {
    // 50 due, only 30 recoverable -> 20 payable
    const b = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 30 },
      'dubai',
    );
    expect(b.box12TotalDueTax).toBe(50);
    expect(b.box13RecoverableTax).toBe(30);
    expect(b.box14PayableTax).toBe(20);
  });

  it('books an import adjustment to Box 7 + Box 10 recovery', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importAdjAmount: 200, importAdjVat: 10, importsVatRecoverable: 10 },
      'dubai',
    );
    expect(b.box7ImportsAdjAmount).toBe(200);
    expect(b.box7ImportsAdjVat).toBe(10);
    expect(b.box10ReverseChargeVat).toBe(10);
    expect(b.box14PayableTax).toBe(0);
  });

  it('supports a negative Box 7 adjustment (downward correction)', () => {
    const b = buildVat201Boxes(
      { ...ZERO, importAdjAmount: -200, importAdjVat: -10, importsVatRecoverable: -10 },
      'dubai',
    );
    expect(b.box7ImportsAdjVat).toBe(-10);
    expect(b.box8TotalVat).toBe(-10);
    expect(b.box13RecoverableTax).toBe(-10);
    expect(b.box14PayableTax).toBe(0);
  });

  it('keeps reverse-charge isolated from imports (no double count)', () => {
    const b = buildVat201Boxes(
      {
        ...ZERO,
        reverseChargeAmount: 500, reverseChargeVat: 25, reverseChargeVatRecoverable: 25,
        importsAmount: 1000, importsVat: 50, importsVatRecoverable: 50,
      },
      'dubai',
    );
    expect(b.box3ReverseChargeVat).toBe(25);
    expect(b.box6ImportsVat).toBe(50);
    expect(b.box8TotalVat).toBe(75); // 25 RC + 50 import
    expect(b.box10ReverseChargeVat).toBe(75); // 25 RC + 50 import recovery
    expect(b.box14PayableTax).toBe(0);
  });
});

describe('applyAdjustments preserves import VAT (M7)', () => {
  it('keeps Box 6/7 import VAT in Box 8/12/14 after re-deriving totals', () => {
    const boxes = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 50 },
      'dubai',
    );
    expect(boxes.box8TotalVat).toBe(50);
    // Re-deriving totals (even with no adjustments) must NOT drop import VAT.
    const adjusted = applyAdjustments(boxes, []);
    expect(adjusted.box8TotalVat).toBe(50);
    expect(adjusted.box12TotalDueTax).toBe(50);
    expect(adjusted.box14PayableTax).toBe(0);
  });

  it('keeps a partial-exemption import payable after adjustments', () => {
    const boxes = buildVat201Boxes(
      { ...ZERO, importsAmount: 1000, importsVat: 50, importsVatRecoverable: 30 },
      'dubai',
    );
    const adjusted = applyAdjustments(boxes, []);
    expect(adjusted.box8TotalVat).toBe(50);
    expect(adjusted.box13RecoverableTax).toBe(30);
    expect(adjusted.box14PayableTax).toBe(20);
  });
});

describe('accumulateImportRow', () => {
  const fresh = (): ImportAccumulator => ({ importsAmount: 0, importsVat: 0, importAdjAmount: 0, importAdjVat: 0 });

  it('ignores rows that are not flagged as imports', () => {
    const acc = fresh();
    accumulateImportRow(acc, { vatImportRole: null, fallbackAmountAed: 100, fallbackVatAed: 5, importTaxableAmountAed: null, importVatAmountAed: null });
    expect(acc).toEqual(fresh());
  });

  it('uses the customs override when present (differs from subtotal)', () => {
    const acc = fresh();
    // supplier subtotal 1000/50, but customs value (incl. freight+duty) is 1200/60
    accumulateImportRow(acc, { vatImportRole: 'import', fallbackAmountAed: 1000, fallbackVatAed: 50, importTaxableAmountAed: 1200, importVatAmountAed: 60 });
    expect(acc.importsAmount).toBe(1200);
    expect(acc.importsVat).toBe(60);
  });

  it('falls back to document subtotal/vat when no override', () => {
    const acc = fresh();
    accumulateImportRow(acc, { vatImportRole: 'import', fallbackAmountAed: 1000, fallbackVatAed: 50, importTaxableAmountAed: null, importVatAmountAed: null });
    expect(acc.importsAmount).toBe(1000);
    expect(acc.importsVat).toBe(50);
  });

  it('routes import_adjustment (incl. negative) to the adjustment buckets', () => {
    const acc = fresh();
    accumulateImportRow(acc, { vatImportRole: 'import_adjustment', fallbackAmountAed: -200, fallbackVatAed: -10, importTaxableAmountAed: null, importVatAmountAed: null });
    expect(acc.importAdjAmount).toBe(-200);
    expect(acc.importAdjVat).toBe(-10);
  });

  // L2: documents the FX-vs-override interaction for import receipts. The caller
  // passes `fallbackAmountAed` ALREADY converted to AED; the override (when
  // present) overrides that AED value verbatim, not the foreign amount.
  it('uses the AED override even when the fallback came from an FX conversion', () => {
    const acc = fresh();
    // EUR-denominated receipt: 800 EUR x 4.0 = 3200 AED (fallback already converted)
    // but the customs declaration says 3500 AED — the override wins.
    accumulateImportRow(acc, {
      vatImportRole: 'import',
      fallbackAmountAed: 3200,
      fallbackVatAed: 160,
      importTaxableAmountAed: 3500,
      importVatAmountAed: 175,
    });
    expect(acc.importsAmount).toBe(3500);
    expect(acc.importsVat).toBe(175);
  });
});
