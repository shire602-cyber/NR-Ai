/**
 * ZATCA Phase 2 QR code: base64 of TLV records, tags 1-9.
 *   1 seller name           2 VAT number          3 timestamp (ISO 8601)
 *   4 total incl. VAT       5 VAT total           6 invoice hash (base64)
 *   7 ECDSA signature (b64) 8 ECDSA public key    9 ZATCA CA signature over the
 *                             (DER SPKI bytes)       certificate (simplified only)
 * Tags 1-7 carry UTF-8 text; 8 and 9 carry raw bytes.
 */

export const ZATCA_QR_TAGS = {
  SELLER_NAME: 1,
  VAT_NUMBER: 2,
  TIMESTAMP: 3,
  TOTAL_WITH_VAT: 4,
  VAT_TOTAL: 5,
  INVOICE_HASH: 6,
  SIGNATURE: 7,
  PUBLIC_KEY: 8,
  CERTIFICATE_SIGNATURE: 9,
} as const;

export interface ZatcaQrFields {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: string;
  vatTotal: string;
  invoiceHash: string;
  signature: string;
  publicKey: Buffer;
  /** Required for simplified (B2C) invoices; omitted for standard. */
  certificateSignature?: Buffer | null;
}

function tlv(tag: number, value: Buffer): Buffer {
  if (value.length > 255) {
    throw new Error(`QR TLV value for tag ${tag} exceeds 255 bytes (got ${value.length})`);
  }
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export function buildZatcaQr(f: ZatcaQrFields): string {
  if (!f.sellerName || !/^3\d{13}3$/.test(f.vatNumber)) {
    throw new Error("ZATCA QR needs the seller name and a 15-digit VAT number");
  }
  const parts = [
    tlv(1, Buffer.from(f.sellerName, "utf8")),
    tlv(2, Buffer.from(f.vatNumber, "utf8")),
    tlv(3, Buffer.from(f.timestamp, "utf8")),
    tlv(4, Buffer.from(f.totalWithVat, "utf8")),
    tlv(5, Buffer.from(f.vatTotal, "utf8")),
    tlv(6, Buffer.from(f.invoiceHash, "utf8")),
    tlv(7, Buffer.from(f.signature, "utf8")),
    tlv(8, f.publicKey),
  ];
  if (f.certificateSignature) parts.push(tlv(9, f.certificateSignature));
  return Buffer.concat(parts).toString("base64");
}

/** Decode to tag → raw bytes. */
export function decodeZatcaQr(base64: string): Map<number, Buffer> {
  const buf = Buffer.from(base64, "base64");
  const out = new Map<number, Buffer>();
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    if (len === undefined || i + 2 + len > buf.length) throw new Error("truncated TLV payload");
    out.set(tag, buf.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}
