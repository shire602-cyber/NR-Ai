import QRCode from 'qrcode';

// ZATCA / UAE FTA Phase 2 e-invoicing QR payload tags.
// The QR code is a base64-encoded sequence of TLV records — one per field —
// where each record is: 1-byte tag, 1-byte length, n bytes UTF-8 value.
// Per spec each value must fit in 255 bytes; longer values would need a
// multi-byte length encoding which the spec does not currently use.
export const EINVOICE_QR_TAGS = {
  SELLER_NAME: 1,
  VAT_REG_NUMBER: 2,
  TIMESTAMP: 3,
  INVOICE_TOTAL_WITH_VAT: 4,
  VAT_AMOUNT: 5,
} as const;

export interface EInvoiceQrFields {
  sellerName: string;
  vatRegistrationNumber: string;
  timestamp: Date;
  invoiceTotalWithVat: number;
  vatAmount: number;
}

function tlv(tag: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf-8');
  if (bytes.length > 255) {
    throw new Error(`TLV value for tag ${tag} exceeds 255 bytes (got ${bytes.length})`);
  }
  const out = Buffer.alloc(2 + bytes.length);
  out[0] = tag;
  out[1] = bytes.length;
  bytes.copy(out, 2);
  return out;
}

function formatAmount(n: number): string {
  return n.toFixed(2);
}

// Build the base64-encoded TLV payload that goes into the QR code.
export function buildEInvoiceQrPayload(fields: EInvoiceQrFields): string {
  if (!fields.sellerName) throw new Error('sellerName is required for QR payload');
  if (!fields.vatRegistrationNumber) {
    throw new Error('vatRegistrationNumber (TRN) is required for QR payload');
  }

  const blob = Buffer.concat([
    tlv(EINVOICE_QR_TAGS.SELLER_NAME, fields.sellerName),
    tlv(EINVOICE_QR_TAGS.VAT_REG_NUMBER, fields.vatRegistrationNumber),
    tlv(EINVOICE_QR_TAGS.TIMESTAMP, fields.timestamp.toISOString()),
    tlv(EINVOICE_QR_TAGS.INVOICE_TOTAL_WITH_VAT, formatAmount(fields.invoiceTotalWithVat)),
    tlv(EINVOICE_QR_TAGS.VAT_AMOUNT, formatAmount(fields.vatAmount)),
  ]);

  return blob.toString('base64');
}

// Decode a TLV payload back into a record of tag → value. Used in tests and
// for verifying QRs scanned from issued PDFs.
export function decodeEInvoiceQrPayload(base64: string): Record<number, string> {
  const buf = Buffer.from(base64, 'base64');
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    if (i + 2 + len > buf.length) {
      throw new Error('truncated TLV payload');
    }
    out[tag] = buf.slice(i + 2, i + 2 + len).toString('utf-8');
    i += 2 + len;
  }
  return out;
}

// Render the QR payload to a PNG buffer suitable for embedding in PDFKit.
// Margin 0 keeps the rendered image tight to the QR data; PDF layout already
// handles the surrounding whitespace.
export async function renderEInvoiceQrPng(
  fields: EInvoiceQrFields,
  options: { width?: number } = {},
): Promise<Buffer> {
  const payload = buildEInvoiceQrPayload(fields);
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'M',
    type: 'png',
    margin: 0,
    width: options.width ?? 240,
  });
}
