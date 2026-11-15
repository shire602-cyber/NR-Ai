/**
 * Minimal ASN.1 DER encoder for the ZATCA CSR and (test/mock) certificates.
 * Only the types those structures use: SEQUENCE, SET, INTEGER, OID,
 * UTF8String, PrintableString, BIT STRING, OCTET STRING, UTCTime, explicit
 * context tags. Kept dependency-free so the CSR bytes are fully under our
 * control (node:crypto signs them with secp256k1).
 */

function lengthBytes(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), lengthBytes(content.length), content]);
}

export const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
export const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
export const printable = (s: string) => tlv(0x13, Buffer.from(s, "ascii"));
export const octetString = (b: Buffer) => tlv(0x04, b);
export const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
export const explicit = (n: number, content: Buffer) => tlv(0xa0 | n, content);
/** [n] IMPLICIT constructed (e.g. CSR attributes [0] SET OF). */
export const implicitConstructed = (n: number, content: Buffer) => tlv(0xa0 | n, content);
export const derNull = () => Buffer.from([0x05, 0x00]);
export const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));

export function integer(value: number | bigint | Buffer): Buffer {
  let bytes: Buffer;
  if (Buffer.isBuffer(value)) {
    bytes = value;
  } else {
    let v = BigInt(value);
    const out: number[] = [];
    if (v === 0n) out.push(0);
    while (v > 0n) {
      out.unshift(Number(v & 0xffn));
      v >>= 8n;
    }
    bytes = Buffer.from(out);
  }
  // Strip redundant leading zeros, then keep the number positive.
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0 && (bytes[i + 1] & 0x80) === 0) i++;
  bytes = bytes.subarray(i);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map((p) => BigInt(p));
  const out: number[] = [Number(parts[0] * 40n + parts[1])];
  for (const part of parts.slice(2)) {
    const stack: number[] = [];
    let v = part;
    stack.unshift(Number(v & 0x7fn));
    v >>= 7n;
    while (v > 0n) {
      stack.unshift(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

export function utcTime(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const s =
    p(d.getUTCFullYear() % 100) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z";
  return tlv(0x17, Buffer.from(s, "ascii"));
}

export const OID = {
  countryName: "2.5.4.6",
  organizationName: "2.5.4.10",
  organizationalUnitName: "2.5.4.11",
  commonName: "2.5.4.3",
  surname: "2.5.4.4", // "SN" in the ZATCA EGS serial
  title: "2.5.4.12",
  registeredAddress: "2.5.4.26",
  businessCategory: "2.5.4.15",
  userId: "0.9.2342.19200300.100.1.1", // "UID" = VAT number
  extensionRequest: "1.2.840.113549.1.9.14",
  subjectAltName: "2.5.29.17",
  certificateTemplateName: "1.3.6.1.4.1.311.20.2",
  ecPublicKey: "1.2.840.10045.2.1",
  secp256k1: "1.3.132.0.10",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  basicConstraints: "2.5.29.19",
} as const;

/** RelativeDistinguishedName entry list → Name (one attribute per RDN). */
export function name(entries: Array<[string, Buffer]>): Buffer {
  return seq(...entries.map(([o, value]) => set(seq(oid(o), value))));
}

// ─── Reader (certificates / CSRs we issue or receive) ─────────────────────

export interface DerNode {
  tag: number;
  /** Full TLV bytes. */
  raw: Buffer;
  /** Content bytes. */
  value: Buffer;
  children: DerNode[];
}

function readOne(buf: Buffer, offset: number): { node: DerNode; next: number } {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let header = 2;
  if (len === undefined) throw new Error("truncated DER");
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("unsupported DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[offset + 2 + i];
    header = 2 + n;
  }
  const end = offset + header + len;
  if (end > buf.length) throw new Error("truncated DER");
  const value = buf.subarray(offset + header, end);
  const children: DerNode[] = [];
  if ((tag & 0x20) !== 0) {
    let p = 0;
    while (p < value.length) {
      const r = readOne(value, p);
      children.push(r.node);
      p = r.next;
    }
  }
  return { node: { tag, raw: buf.subarray(offset, end), value, children }, next: end };
}

export function readDer(buf: Buffer): DerNode {
  return readOne(buf, 0).node;
}

export function oidToString(value: Buffer): string {
  const parts: number[] = [Math.floor(value[0] / 40), value[0] % 40];
  let acc = 0;
  for (const b of value.subarray(1)) {
    acc = (acc << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(acc);
      acc = 0;
    }
  }
  return parts.join(".");
}

const NAME_LABELS: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.4": "SN",
  "2.5.4.12": "title",
  "2.5.4.15": "businessCategory",
  "2.5.4.26": "registeredAddress",
  "0.9.2342.19200300.100.1.1": "UID",
  "0.9.2342.19200300.100.1.25": "DC",
};

/** Name → "CN=x, O=y, C=SA" (RFC 4514 order: last RDN first). */
export function nameToString(n: DerNode): string {
  return n.children
    .map((rdn) => {
      const atv = rdn.children[0];
      const o = oidToString(atv.children[0].value);
      return `${NAME_LABELS[o] ?? o}=${atv.children[1].value.toString("utf8")}`;
    })
    .reverse()
    .join(", ");
}

export interface ParsedCertificate {
  serialHex: string;
  serialDecimal: string;
  issuer: string;
  subject: string;
  /** DER SubjectPublicKeyInfo */
  publicKeyDer: Buffer;
  /** The issuer's signature over the certificate (BIT STRING content). */
  signature: Buffer;
}

export function parseCertificate(der: Buffer): ParsedCertificate {
  const cert = readDer(der);
  const tbs = cert.children[0];
  const i = tbs.children[0].tag === 0xa0 ? 1 : 0; // explicit version
  const serial = tbs.children[i].value;
  return {
    serialHex: serial.toString("hex"),
    serialDecimal: BigInt(`0x${serial.toString("hex") || "0"}`).toString(10),
    issuer: nameToString(tbs.children[i + 2]),
    subject: nameToString(tbs.children[i + 4]),
    publicKeyDer: Buffer.from(tbs.children[i + 5].raw),
    signature: Buffer.from(cert.children[2].value.subarray(1)),
  };
}

export interface ParsedCsr {
  subject: string;
  publicKeyDer: Buffer;
  /** CertificationRequestInfo bytes (what the signature covers). */
  info: Buffer;
  signature: Buffer;
  /** extension OID → extnValue bytes */
  extensions: Map<string, Buffer>;
}

export function parseCsr(der: Buffer): ParsedCsr {
  const req = readDer(der);
  const info = req.children[0];
  const extensions = new Map<string, Buffer>();
  for (const attr of info.children[3]?.children ?? []) {
    if (oidToString(attr.children[0].value) !== OID.extensionRequest) continue;
    for (const ext of attr.children[1].children[0].children) {
      extensions.set(
        oidToString(ext.children[0].value),
        Buffer.from(ext.children[ext.children.length - 1].value)
      );
    }
  }
  return {
    subject: nameToString(info.children[1]),
    publicKeyDer: Buffer.from(info.children[2].raw),
    info: Buffer.from(info.raw),
    signature: Buffer.from(req.children[2].value.subarray(1)),
    extensions,
  };
}
