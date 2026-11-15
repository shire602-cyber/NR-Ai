/**
 * ZATCA EGS cryptography: secp256k1 keys, the onboarding CSR with the
 * ZATCA-required subject and extensions, and certificate helpers.
 *
 * CSR subject:   C=SA, OU=<branch / org unit>, O=<taxpayer name>, CN=<EGS common name>
 * Extensions:    certificateTemplateName (1.3.6.1.4.1.311.20.2) =
 *                  "TSTZATCA-Code-Signing" (sandbox) | "PREZATCA-Code-Signing" (simulation)
 *                  | "ZATCA-Code-Signing" (production)
 *                subjectAltName dirName:
 *                  SN=1-<solution>|2-<model>|3-<serial>, UID=<VAT no>,
 *                  title=<invoice types, e.g. 1100>, registeredAddress=<address>,
 *                  businessCategory=<industry>
 */
import crypto from "node:crypto";
import {
  OID,
  bitString,
  bool,
  explicit,
  implicitConstructed,
  integer,
  name,
  octetString,
  oid,
  printable,
  seq,
  set,
  tlv,
  utcTime,
  utf8,
} from "./der";

export type ZatcaEnvironment = "sandbox" | "simulation" | "production";

export const CERTIFICATE_TEMPLATE: Record<ZatcaEnvironment, string> = {
  sandbox: "TSTZATCA-Code-Signing",
  simulation: "PREZATCA-Code-Signing",
  production: "ZATCA-Code-Signing",
};

export interface EgsKeyPair {
  privateKeyPem: string;
  publicKeyDer: Buffer;
}

export function generateEgsKeyPair(): EgsKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyDer: publicKey.export({ type: "spki", format: "der" }) as Buffer,
  };
}

export function publicKeyDerFromPrivate(privateKeyPem: string): Buffer {
  return crypto
    .createPublicKey(crypto.createPrivateKey(privateKeyPem))
    .export({ type: "spki", format: "der" }) as Buffer;
}

export interface CsrSubject {
  commonName: string;
  organizationName: string;
  organizationUnit: string;
  /** "1-<solution name>|2-<model/version>|3-<device serial>" */
  serialNumber: string;
  vatNumber: string;
  /** Four flags: standard, simplified, (future), (future) — e.g. "1100". */
  invoiceTypes: string;
  locationAddress: string;
  industry: string;
}

const pem = (label: string, der: Buffer) =>
  `-----BEGIN ${label}-----\n${der
    .toString("base64")
    .match(/.{1,64}/g)
    ?.join("\n")}\n-----END ${label}-----\n`;

export function pemToDer(pemText: string): Buffer {
  return Buffer.from(pemText.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
}

const ecdsaSha256 = () => seq(oid(OID.ecdsaWithSha256));

function subjectName(s: CsrSubject): Buffer {
  return name([
    [OID.countryName, printable("SA")],
    [OID.organizationalUnitName, utf8(s.organizationUnit)],
    [OID.organizationName, utf8(s.organizationName)],
    [OID.commonName, utf8(s.commonName)],
  ]);
}

function egsDirName(s: CsrSubject): Buffer {
  return name([
    [OID.surname, utf8(s.serialNumber)],
    [OID.userId, utf8(s.vatNumber)],
    [OID.title, utf8(s.invoiceTypes)],
    [OID.registeredAddress, utf8(s.locationAddress)],
    [OID.businessCategory, utf8(s.industry)],
  ]);
}

/** Build and sign (ECDSA-SHA256) the PKCS#10 CSR. Returns PEM and base64 (ZATCA API body). */
export function buildZatcaCsr(
  subject: CsrSubject,
  privateKeyPem: string,
  environment: ZatcaEnvironment
): { pem: string; base64: string; der: Buffer } {
  if (!/^3\d{13}3$/.test(subject.vatNumber)) {
    throw new Error("ZATCA VAT number must be 15 digits starting and ending with 3");
  }
  if (!/^[01]{4}$/.test(subject.invoiceTypes)) {
    throw new Error("Invoice types must be four 0/1 flags, e.g. 1100");
  }
  const spki = publicKeyDerFromPrivate(privateKeyPem);
  const extensions = seq(
    seq(
      oid(OID.certificateTemplateName),
      octetString(printable(CERTIFICATE_TEMPLATE[environment]))
    ),
    seq(oid(OID.subjectAltName), octetString(seq(tlv(0xa4, egsDirName(subject)))))
  );
  const attributes = implicitConstructed(0, seq(oid(OID.extensionRequest), set(extensions)));
  const cri = seq(integer(0), subjectName(subject), spki, attributes);
  const signature = crypto.sign("sha256", cri, crypto.createPrivateKey(privateKeyPem));
  const der = seq(cri, ecdsaSha256(), bitString(signature));
  const pemText = pem("CERTIFICATE REQUEST", der);
  return { pem: pemText, base64: Buffer.from(pemText, "utf8").toString("base64"), der };
}

/**
 * Issue an X.509 certificate for `subjectPublicKeyDer`, signed by
 * `issuerPrivateKeyPem`. Used ONLY by the sandbox mock / tests to stand in
 * for the CSID ZATCA issues; production certificates come from ZATCA.
 */
export function issueCertificate(args: {
  subjectPublicKeyDer: Buffer;
  subjectCommonName: string;
  issuerCommonName: string;
  issuerPrivateKeyPem: string;
  serial: bigint;
  notBefore?: Date;
  days?: number;
}): { der: Buffer; pem: string; base64: string } {
  const notBefore = args.notBefore ?? new Date();
  const notAfter = new Date(notBefore.getTime() + (args.days ?? 365) * 86_400_000);
  const issuer = name([
    [OID.countryName, printable("SA")],
    [OID.commonName, utf8(args.issuerCommonName)],
  ]);
  const subject = name([
    [OID.countryName, printable("SA")],
    [OID.commonName, utf8(args.subjectCommonName)],
  ]);
  const tbs = seq(
    explicit(0, integer(2)),
    integer(args.serial),
    ecdsaSha256(),
    issuer,
    seq(utcTime(notBefore), utcTime(notAfter)),
    subject,
    args.subjectPublicKeyDer,
    explicit(3, seq(seq(oid(OID.basicConstraints), octetString(seq(bool(false))))))
  );
  const signature = crypto.sign("sha256", tbs, crypto.createPrivateKey(args.issuerPrivateKeyPem));
  const der = seq(tbs, ecdsaSha256(), bitString(signature));
  return { der, pem: pem("CERTIFICATE", der), base64: der.toString("base64") };
}

/** Normalise a ZATCA binarySecurityToken (base64 of the base64 certificate) to certificate DER. */
export function certificateFromBinarySecurityToken(token: string): Buffer {
  const once = Buffer.from(token, "base64").toString("utf8").trim();
  // ZATCA returns base64( base64(DER) ); accept a single encoding too.
  if (/^MI[A-Za-z0-9+/=\s]+$/.test(once)) return Buffer.from(once.replace(/\s+/g, ""), "base64");
  return Buffer.from(token, "base64");
}
