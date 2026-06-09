import { describe, it, expect } from 'vitest';
import { buildReceiptImportFields, ImportValidationError } from '../../server/routes/receipts.routes';
import { buildBillImportFields } from '../../server/routes/bill-pay.routes';

describe('buildReceiptImportFields', () => {
  it('returns nulls when no import role is set', () => {
    expect(buildReceiptImportFields({})).toEqual({
      vatImportRole: null, importTaxableAmountAed: null, importVatAmountAed: null,
      customsDeclarationNumber: null, importDate: null, importEvidenceUrl: null, importAdjustmentReason: null,
    });
  });

  it('captures an import with customs override fields', () => {
    const out = buildReceiptImportFields({
      vatImportRole: 'import', importTaxableAmountAed: 1200, importVatAmountAed: 60,
      customsDeclarationNumber: 'CUS-123', importEvidenceUrl: 'https://x/dec.pdf',
    });
    expect(out.vatImportRole).toBe('import');
    expect(out.importTaxableAmountAed).toBe(1200);
    expect(out.importVatAmountAed).toBe(60);
    expect(out.customsDeclarationNumber).toBe('CUS-123');
  });

  it('rejects import_adjustment without a justification', () => {
    expect(() => buildReceiptImportFields({ vatImportRole: 'import_adjustment' }))
      .toThrow(ImportValidationError);
  });

  it('accepts import_adjustment with a justification (and negative VAT)', () => {
    const out = buildReceiptImportFields({
      vatImportRole: 'import_adjustment', importAdjustmentReason: 'customs value corrected', importVatAmountAed: -10,
    });
    expect(out.vatImportRole).toBe('import_adjustment');
    expect(out.importVatAmountAed).toBe(-10);
    expect(out.importAdjustmentReason).toBe('customs value corrected');
  });

  it('rejects an unknown role', () => {
    expect(() => buildReceiptImportFields({ vatImportRole: 'bogus' }))
      .toThrow(ImportValidationError);
  });

  // M19: a receipt could in principle be flagged as both reverse-charge and
  // import-of-goods at the API surface. The service classifies the import role
  // FIRST (vat-autopilot.service.ts), so the import bucket wins and the row
  // never appears in Box 3/10 — these tests pin that precedence so a future
  // change does not silently start double-counting.
  it('produces a valid ImportFields payload when reverse_charge is ALSO set (import wins)', () => {
    const out = buildReceiptImportFields({ vatImportRole: 'import', reverse_charge: true, importTaxableAmountAed: 1000 });
    expect(out.vatImportRole).toBe('import');
    expect(out.importTaxableAmountAed).toBe(1000);
  });
});

describe('buildBillImportFields', () => {
  it('defaults override amounts to null and role to null', () => {
    const f = buildBillImportFields({});
    expect(f.vatImportRole).toBeNull();
    expect(f.importTaxableAmountAed).toBeNull();
  });

  it('captures import_adjustment with reason and negative VAT', () => {
    const f = buildBillImportFields({ vatImportRole: 'import_adjustment', importAdjustmentReason: 'customs correction', importVatAmountAed: -10 });
    expect(f.vatImportRole).toBe('import_adjustment');
    expect(f.importVatAmountAed).toBe(-10);
    expect(f.importAdjustmentReason).toBe('customs correction');
  });

  it('rejects import_adjustment without reason', () => {
    expect(() => buildBillImportFields({ vatImportRole: 'import_adjustment' })).toThrow();
  });
});
