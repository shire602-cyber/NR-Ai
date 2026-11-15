/**
 * R07-14: ZATCA Phase 2 — CSR, signing, hash chain, QR (tags 1-9), XSD/rule
 * validation and the Fatoora client against recorded sandbox responses.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCertificate, parseCsr } from "../../server/services/zatca/der";
import {
  buildZatcaCsr,
  certificateFromBinarySecurityToken,
  generateEgsKeyPair,
  issueCertificate,
  publicKeyDerFromPrivate,
} from "../../server/services/zatca/keys";
import {
  computeZatcaInvoiceHash,
  signZatcaInvoice,
  verifyZatcaSignedXml,
} from "../../server/services/zatca/sign";
import { buildZatcaQr, decodeZatcaQr } from "../../server/services/zatca/qr";
import {
  ZATCA_INITIAL_PIH,
  zatcaInvoiceXml,
  type ZatcaInvoiceInput,
} from "../../server/services/zatca/ubl";
import { runZatcaRules } from "../../server/services/zatca/rules";
import { validateUblXsd } from "../../server/services/einvoice/validate";
import { ZatcaClient, zatcaConfig } from "../../server/services/zatca/client";
import { createMockFatoora } from "../fixtures/zatca/mock-fatoora";

const subject = {
  commonName: "EGS-Riyadh-POS-1",
  organizationName: "شركة اللؤلؤة للتجارة",
  organizationUnit: "Riyadh Branch",
  serialNumber: "1-Muhasib|2-1.0|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
  vatNumber: "399999999900003",
  invoiceTypes: "1100",
  locationAddress: "King Fahd Road, Riyadh",
  industry: "Trading",
};

const keys = generateEgsKeyPair();
const ca = generateEgsKeyPair();
const cert = issueCertificate({
  subjectPublicKeyDer: publicKeyDerFromPrivate(keys.privateKeyPem),
  subjectCommonName: subject.commonName,
  issuerCommonName: "Test ZATCA CA",
  issuerPrivateKeyPem: ca.privateKeyPem,
  serial: 4242n,
});

function input(
  icv: number,
  previousHash: string,
  over: Partial<ZatcaInvoiceInput> = {}
): ZatcaInvoiceInput {
  return {
    profile: "simplified",
    kind: "invoice",
    number: `SME-${String(icv).padStart(5, "0")}`,
    uuid: crypto.randomUUID(),
    issueDate: "2027-02-01",
    issueTime: "10:15:00",
    icv,
    previousHash,
    seller: {
      nameAr: "شركة اللؤلؤة للتجارة",
      nameEn: "Pearl Trading Co",
      vatNumber: "399999999900003",
      crn: "1010010000",
      address: {
        street: "King Fahd Road",
        buildingNumber: "1234",
        district: "Olaya",
        city: "Riyadh",
        postalZone: "12345",
      },
    },
    buyer: null,
    lines: [
      {
        name: "Coffee beans 1kg",
        nameAr: "بن قهوة",
        quantity: 2,
        unitPrice: "50.00",
        vatRate: 0.15,
        category: "S",
      },
      {
        name: "Export packaging",
        quantity: 1,
        unitPrice: "20.00",
        vatRate: 0,
        category: "Z",
        exemptionCode: "VATEX-SA-32",
        exemptionReason: "Export of goods",
      },
    ],
    ...over,
  };
}

describe("R07-14 CSR with the ZATCA-required subject and extensions", () => {
  const csr = buildZatcaCsr(subject, keys.privateKeyPem, "sandbox");
  const req = parseCsr(csr.der);

  it("parses with C=SA, OU, O, CN", () => {
    expect(req.subject).toBe(
      `CN=${subject.commonName}, O=${subject.organizationName}, OU=Riyadh Branch, C=SA`
    );
  });

  it("carries certificateTemplateName and the EGS dirName SAN", () => {
    expect([...req.extensions.keys()]).toEqual(["1.3.6.1.4.1.311.20.2", "2.5.29.17"]);
    expect(req.extensions.get("1.3.6.1.4.1.311.20.2")?.toString("latin1")).toContain(
      "TSTZATCA-Code-Signing"
    );
    const san = (req.extensions.get("2.5.29.17") as Buffer).toString("utf8");
    for (const v of [
      subject.serialNumber,
      subject.vatNumber,
      "1100",
      subject.locationAddress,
      subject.industry,
    ]) {
      expect(san).toContain(v);
    }
  });

  it("is signed by the EGS secp256k1 key (signature verifies over the request info)", () => {
    expect(req.publicKeyDer.equals(publicKeyDerFromPrivate(keys.privateKeyPem))).toBe(true);
    const ok = crypto.verify(
      "sha256",
      req.info,
      crypto.createPublicKey({ key: req.publicKeyDer, format: "der", type: "spki" }),
      req.signature
    );
    expect(ok).toBe(true);
  });

  it("OpenSSL parses and verifies the CSR (independent check)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zatca-csr-"));
    const file = path.join(dir, "egs.csr");
    fs.writeFileSync(file, csr.pem);
    let out: string;
    try {
      out = execFileSync("openssl", ["req", "-in", file, "-noout", "-verify", "-text"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(out).toContain("secp256k1");
    expect(out).toContain("C = SA");
    expect(out).toContain("TSTZATCA-Code-Signing");
  });

  it("uses the production template name only in production", () => {
    const prod = parseCsr(buildZatcaCsr(subject, keys.privateKeyPem, "production").der);
    const v = (prod.extensions.get("1.3.6.1.4.1.311.20.2") as Buffer).toString("latin1");
    expect(v).toContain("ZATCA-Code-Signing");
    expect(v).not.toContain("TSTZATCA");
  });

  it("the mock CA certificate parses with issuer, serial and SPKI", () => {
    const c = parseCertificate(cert.der);
    expect(c.issuer).toBe("CN=Test ZATCA CA, C=SA");
    expect(c.serialDecimal).toBe("4242");
    expect(c.publicKeyDer.equals(publicKeyDerFromPrivate(keys.privateKeyPem))).toBe(true);
  });
});

describe("R07-14 signed XML verifies with the generated key", () => {
  const signed = signZatcaInvoice({
    input: input(1, ZATCA_INITIAL_PIH),
    privateKeyPem: keys.privateKeyPem,
    certificateDer: cert.der,
  });

  it("all XAdES checks pass", () => {
    const v = verifyZatcaSignedXml(signed.xml);
    expect(v.checks).toEqual({
      invoiceDigest: true,
      signedPropertiesDigest: true,
      signature: true,
      certificateDigest: true,
      qr: true,
    });
    expect(v.invoiceHash).toBe(signed.invoiceHash);
  });

  it("the hash ignores the signature block and QR (re-hash of the signed doc is stable)", () => {
    expect(computeZatcaInvoiceHash(signed.xml)).toBe(signed.invoiceHash);
  });

  it("tampering with an amount breaks verification", () => {
    const tampered = signed.xml.replace(
      '<cbc:PriceAmount currencyID="SAR">50.00</cbc:PriceAmount>',
      '<cbc:PriceAmount currencyID="SAR">5.00</cbc:PriceAmount>'
    );
    expect(tampered).not.toBe(signed.xml);
    const v = verifyZatcaSignedXml(tampered);
    expect(v.valid).toBe(false);
    expect(v.checks.invoiceDigest).toBe(false);
  });

  it("a different key does not verify", () => {
    const other = generateEgsKeyPair();
    const forged = signZatcaInvoice({
      input: input(1, ZATCA_INITIAL_PIH),
      privateKeyPem: other.privateKeyPem,
      certificateDer: cert.der,
    });
    expect(verifyZatcaSignedXml(forged.xml).checks.signature).toBe(false);
  });

  it("validates against the UBL 2.1 XSD and the ZATCA rule list", async () => {
    const xsd = await validateUblXsd(signed.xml);
    expect(xsd.available).toBe(true);
    expect(xsd.errors).toEqual([]);
    expect(runZatcaRules(signed.xml)).toEqual([]);
  }, 30_000);

  it("carries Arabic seller and item names", () => {
    expect(signed.xml).toContain(
      "<cbc:RegistrationName>شركة اللؤلؤة للتجارة</cbc:RegistrationName>"
    );
    expect(signed.xml).toContain("بن قهوة / Coffee beans 1kg");
  });
});

describe("R07-14 QR TLV decodes to the nine tags", () => {
  const signed = signZatcaInvoice({
    input: input(1, ZATCA_INITIAL_PIH),
    privateKeyPem: keys.privateKeyPem,
    certificateDer: cert.der,
  });
  const tags = decodeZatcaQr(signed.qr);

  it("has tags 1-9 for a simplified invoice", () => {
    expect([...tags.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tags.get(1)?.toString("utf8")).toBe("شركة اللؤلؤة للتجارة");
    expect(tags.get(2)?.toString("utf8")).toBe("399999999900003");
    expect(tags.get(3)?.toString("utf8")).toBe("2027-02-01T10:15:00");
    expect(tags.get(4)?.toString("utf8")).toBe("135.00"); // 120 + 15% of 100
    expect(tags.get(5)?.toString("utf8")).toBe("15.00");
    expect(tags.get(6)?.toString("utf8")).toBe(signed.invoiceHash);
    expect(tags.get(7)?.toString("utf8")).toBe(signed.signature);
    expect(tags.get(8)?.equals(publicKeyDerFromPrivate(keys.privateKeyPem))).toBe(true);
    expect(tags.get(9)?.length).toBeGreaterThan(60);
  });

  it("standard invoices omit tag 9", () => {
    const std = signZatcaInvoice({
      input: input(1, ZATCA_INITIAL_PIH, {
        profile: "standard",
        buyer: {
          name: "شركة المشتري",
          vatNumber: "300000000000003",
          address: {
            street: "Tahlia",
            buildingNumber: "2222",
            district: "Sulaimaniyah",
            city: "Riyadh",
            postalZone: "12241",
          },
        },
      }),
      privateKeyPem: keys.privateKeyPem,
      certificateDer: cert.der,
    });
    expect([...decodeZatcaQr(std.qr).keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(runZatcaRules(std.xml)).toEqual([]);
  });

  it("refuses an invalid VAT number", () => {
    expect(() =>
      buildZatcaQr({
        sellerName: "x",
        vatNumber: "100",
        timestamp: "t",
        totalWithVat: "1",
        vatTotal: "0",
        invoiceHash: "h",
        signature: "s",
        publicKey: Buffer.alloc(1),
      })
    ).toThrow();
  });
});

describe("R07-14 hash chain continuity over 5 invoices", () => {
  it("each document's PIH is the previous document's hash and ICV increments", () => {
    let pih = ZATCA_INITIAL_PIH;
    const docs = [];
    for (let icv = 1; icv <= 5; icv++) {
      const kind = icv === 4 ? "credit_note" : icv === 5 ? "debit_note" : "invoice";
      const s = signZatcaInvoice({
        input: input(
          icv,
          pih,
          kind === "invoice"
            ? {}
            : { kind, billingReference: "SME-00001", noteReason: "Price adjustment" }
        ),
        privateKeyPem: keys.privateKeyPem,
        certificateDer: cert.der,
      });
      docs.push({ icv, pih, hash: s.invoiceHash, xml: s.xml });
      pih = s.invoiceHash;
    }
    expect(docs[0].pih).toBe(ZATCA_INITIAL_PIH);
    for (let i = 1; i < docs.length; i++) {
      expect(docs[i].pih).toBe(docs[i - 1].hash);
      expect(docs[i].xml).toContain(`<cbc:UUID>${docs[i].icv}</cbc:UUID>`);
      expect(docs[i].xml).toContain(docs[i - 1].hash);
    }
    expect(new Set(docs.map((d) => d.hash)).size).toBe(5);
    expect(docs[3].xml).toContain('<cbc:InvoiceTypeCode name="0200000">381</cbc:InvoiceTypeCode>');
    expect(docs[4].xml).toContain('<cbc:InvoiceTypeCode name="0200000">383</cbc:InvoiceTypeCode>');
    for (const d of docs) expect(runZatcaRules(d.xml)).toEqual([]);
  });

  it("the initial PIH is base64 of the hex SHA-256 of '0'", () => {
    const hex = crypto.createHash("sha256").update("0").digest("hex");
    expect(Buffer.from(ZATCA_INITIAL_PIH, "base64").toString("utf8")).toBe(hex);
  });

  it("the unsigned body is what is hashed", () => {
    const i = input(1, ZATCA_INITIAL_PIH);
    expect(computeZatcaInvoiceHash(zatcaInvoiceXml(i))).toBe(
      signZatcaInvoice({ input: i, privateKeyPem: keys.privateKeyPem, certificateDer: cert.der })
        .invoiceHash
    );
  });
});

describe("R07-14 Fatoora client (recorded sandbox responses)", () => {
  it("is not configured without ZATCA_ENV", () => {
    expect(zatcaConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(zatcaConfig({ ZATCA_ENV: "simulation" } as never)?.baseUrl).toBe(
      "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation"
    );
  });

  it("onboards: compliance CSID (OTP) → compliance invoice → production CSID, then clears", async () => {
    const mock = createMockFatoora({ validOtp: "123456" });
    const client = new ZatcaClient(zatcaConfig({ ZATCA_ENV: "sandbox" } as never)!, mock.fetch);
    const csr = buildZatcaCsr(subject, keys.privateKeyPem, "sandbox");
    const bad = await client.complianceCsid(csr.base64, "000000");
    expect(bad.httpStatus).toBe(400);
    const cc = await client.complianceCsid(csr.base64, "123456");
    expect(cc.ok).toBe(true);
    const creds = {
      binarySecurityToken: String(cc.body.binarySecurityToken),
      secret: String(cc.body.secret),
    };
    const ccert = certificateFromBinarySecurityToken(creds.binarySecurityToken);
    const signed = signZatcaInvoice({
      input: input(1, ZATCA_INITIAL_PIH),
      privateKeyPem: keys.privateKeyPem,
      certificateDer: ccert,
    });
    const check = await client.complianceInvoice(creds, {
      invoiceHash: signed.invoiceHash,
      uuid: "u",
      invoice: Buffer.from(signed.xml).toString("base64"),
    });
    expect(check.body.validationResults?.status).toBe("PASS");
    expect(mock.received[0].verified).toBe(true);
    const prod = await client.productionCsid(creds, String(cc.body.requestID));
    expect(prod.ok).toBe(true);
    expect(mock.calls.map((c) => c.path)).toEqual([
      "/compliance",
      "/compliance",
      "/compliance/invoices",
      "/production/csids",
    ]);
    expect(mock.calls[1].headers.OTP).toBe("123456");
    expect(mock.calls[2].headers.Authorization).toBe(
      `Basic ${Buffer.from(`${creds.binarySecurityToken}:${creds.secret}`).toString("base64")}`
    );
    const cleared = await client.clearance(
      {
        binarySecurityToken: String(prod.body.binarySecurityToken),
        secret: String(prod.body.secret),
      },
      {
        invoiceHash: signed.invoiceHash,
        uuid: "u",
        invoice: Buffer.from(signed.xml).toString("base64"),
      }
    );
    expect(cleared.body.clearanceStatus).toBe("CLEARED");
    expect(mock.calls[4].headers["Clearance-Status"]).toBe("1");
  });
});
