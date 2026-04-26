import { describe, it, expect } from 'vitest';
import { formatInvoiceNumber } from '../../server/services/invoice-numbering.service';

describe('formatInvoiceNumber', () => {
  it('zero-pads to 5 digits for invoices', () => {
    expect(formatInvoiceNumber('invoice', 2026, 1)).toBe('INV-2026-00001');
    expect(formatInvoiceNumber('invoice', 2026, 42)).toBe('INV-2026-00042');
    expect(formatInvoiceNumber('invoice', 2026, 99999)).toBe('INV-2026-99999');
  });

  it('uses CN prefix for credit notes', () => {
    expect(formatInvoiceNumber('credit_note', 2026, 1)).toBe('CN-2026-00001');
  });

  it('does not truncate numbers above five digits', () => {
    // FTA does not specify a maximum width — once we cross 99999 we keep the
    // natural number rather than wrapping. Padding is a minimum, not a cap.
    expect(formatInvoiceNumber('invoice', 2026, 100000)).toBe('INV-2026-100000');
  });
});
