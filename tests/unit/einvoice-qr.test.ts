import { describe, it, expect } from 'vitest';
import {
  buildEInvoiceQrPayload,
  decodeEInvoiceQrPayload,
  EINVOICE_QR_TAGS,
} from '../../server/services/einvoice-qr.service';

describe('e-invoice QR TLV payload', () => {
  const fields = {
    sellerName: 'Acme Trading LLC',
    vatRegistrationNumber: '100123456700003',
    timestamp: new Date('2026-04-01T10:30:00.000Z'),
    invoiceTotalWithVat: 1050.0,
    vatAmount: 50.0,
  };

  it('round-trips through decode', () => {
    const base64 = buildEInvoiceQrPayload(fields);
    const decoded = decodeEInvoiceQrPayload(base64);
    expect(decoded[EINVOICE_QR_TAGS.SELLER_NAME]).toBe(fields.sellerName);
    expect(decoded[EINVOICE_QR_TAGS.VAT_REG_NUMBER]).toBe(fields.vatRegistrationNumber);
    expect(decoded[EINVOICE_QR_TAGS.TIMESTAMP]).toBe('2026-04-01T10:30:00.000Z');
    expect(decoded[EINVOICE_QR_TAGS.INVOICE_TOTAL_WITH_VAT]).toBe('1050.00');
    expect(decoded[EINVOICE_QR_TAGS.VAT_AMOUNT]).toBe('50.00');
  });

  it('encodes TLV with correct tag bytes and length prefixes', () => {
    const base64 = buildEInvoiceQrPayload(fields);
    const buf = Buffer.from(base64, 'base64');
    // First record: tag=1, length=Buffer.byteLength(sellerName)
    expect(buf[0]).toBe(1);
    expect(buf[1]).toBe(Buffer.byteLength(fields.sellerName, 'utf-8'));
  });

  it('rejects missing TRN', () => {
    expect(() =>
      buildEInvoiceQrPayload({ ...fields, vatRegistrationNumber: '' }),
    ).toThrow(/TRN/);
  });

  it('handles unicode (Arabic) seller names within 255-byte limit', () => {
    const arabic = { ...fields, sellerName: 'شركة أكمي للتجارة' };
    const base64 = buildEInvoiceQrPayload(arabic);
    const decoded = decodeEInvoiceQrPayload(base64);
    expect(decoded[EINVOICE_QR_TAGS.SELLER_NAME]).toBe(arabic.sellerName);
  });

  it('formats amounts with two decimals for FTA compliance', () => {
    const decoded = decodeEInvoiceQrPayload(
      buildEInvoiceQrPayload({ ...fields, invoiceTotalWithVat: 100, vatAmount: 4.7619 }),
    );
    expect(decoded[EINVOICE_QR_TAGS.INVOICE_TOTAL_WITH_VAT]).toBe('100.00');
    expect(decoded[EINVOICE_QR_TAGS.VAT_AMOUNT]).toBe('4.76');
  });
});
