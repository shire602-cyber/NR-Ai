/**
 * ZATCA Phase 2 cryptographic stamp: invoice hash, XAdES-BES enveloped
 * signature (ECDSA secp256k1 / SHA-256), and the TLV QR (tags 1-9).
 *
 *   invoice hash  = base64( SHA-256( C14N( invoice
 *                     minus ext:UBLExtensions, cac:Signature and the QR
 *                     AdditionalDocumentReference ) ) )
 *   signature     = base64( ECDSA-SHA256( hash bytes ) )   (ZATCA convention)
 *   cert digest   = base64( hex( SHA-256( base64 certificate ) ) )
 *   props digest  = base64( hex( SHA-256( C14N(SignedProperties) ) ) )
 *
 * Canonicalisation uses xml-crypto's C14N implementation over an
 * @xmldom/xmldom DOM. Whether ZATCA's validator accepts the stamp is proven
 * by the compliance-invoice step of onboarding (EXTERNAL: needs a Fatoora OTP).
 */
import crypto from "node:crypto";
import { C14nCanonicalization } from "xml-crypto";
import { parseCertificate } from "./der";
import { el, serializeXml } from "../einvoice/xml";
import { descendants, children, first, parseXml, text, textAt, UBL_NS } from "../einvoice/dom";
import { buildZatcaInvoice, zatcaTotals, type ZatcaInvoiceInput } from "./ubl";
import { buildZatcaQr, decodeZatcaQr } from "./qr";
import { publicKeyDerFromPrivate } from "./keys";

const ALG = {
  c14n11: "http://www.w3.org/2006/12/xml-c14n11",
  ecdsaSha256: "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256",
  sha256: "http://www.w3.org/2001/04/xmlenc#sha256",
  xpath: "http://www.w3.org/TR/1999/REC-xpath-19991116",
  signatureProperties: "http://www.w3.org/2000/09/xmldsig#SignatureProperties",
};

const EXCLUDE_XPATHS = [
  "not(//ancestor-or-self::ext:UBLExtensions)",
  "not(//ancestor-or-self::cac:Signature)",
  "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
];

function canonicalize(
  node: Node,
  ancestorNamespaces: { prefix: string; namespaceURI: string }[] = []
): string {
  return new C14nCanonicalization().process(node, { ancestorNamespaces });
}

/** Namespaces declared on the ancestors of `node` (nearest wins), for subtree C14N. */
function inScopeNamespaces(node: Element): { prefix: string; namespaceURI: string }[] {
  const seen = new Map<string, string>();
  let cur: Node | null = node.parentNode;
  while (cur && cur.nodeType === 1) {
    const e = cur as Element;
    for (let i = 0; i < e.attributes.length; i++) {
      const a = e.attributes[i];
      if (a.name === "xmlns" && !seen.has("")) seen.set("", a.value);
      else if (a.name.startsWith("xmlns:")) {
        const p = a.name.slice(6);
        if (!seen.has(p)) seen.set(p, a.value);
      }
    }
    cur = cur.parentNode;
  }
  return [...seen.entries()].map(([prefix, namespaceURI]) => ({ prefix, namespaceURI }));
}

/** ZATCA invoice hash (base64 of the SHA-256 digest) of an unsigned or signed document. */
export function computeZatcaInvoiceHash(xml: string): string {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  // Remove the node and the indentation text in front of it, so a signed
  // document hashes exactly like the unsigned one it was produced from.
  const remove = (n: Element | null) => {
    if (!n?.parentNode) return;
    const prev = n.previousSibling;
    if (prev && prev.nodeType === 3 && !(prev.nodeValue ?? "").trim()) {
      n.parentNode.removeChild(prev);
    }
    n.parentNode.removeChild(n);
  };
  for (const n of children(root as unknown as Element, "ext:UBLExtensions")) remove(n);
  for (const n of children(root as unknown as Element, "cac:Signature")) remove(n);
  for (const n of children(root as unknown as Element, "cac:AdditionalDocumentReference")) {
    if (textAt(n, "cbc:ID") === "QR") remove(n);
  }
  const c14n = canonicalize(root as unknown as Node);
  return crypto.createHash("sha256").update(c14n, "utf8").digest("base64");
}

const hexDigestB64 = (s: string) =>
  Buffer.from(crypto.createHash("sha256").update(s, "utf8").digest("hex"), "utf8").toString(
    "base64"
  );

export interface SignedZatcaInvoice {
  xml: string;
  invoiceHash: string;
  signature: string;
  qr: string;
  certificateHash: string;
  signedPropertiesHash: string;
}

const PROPS_PLACEHOLDER = "__SIGNED_PROPERTIES_DIGEST__";

export function signZatcaInvoice(args: {
  input: ZatcaInvoiceInput;
  privateKeyPem: string;
  certificateDer: Buffer;
  signingTime?: Date;
}): SignedZatcaInvoice {
  const { input, privateKeyPem, certificateDer } = args;
  const signingTime = (args.signingTime ?? new Date()).toISOString().slice(0, 19);
  const unsigned = serializeXml(buildZatcaInvoice(input));
  const invoiceHash = computeZatcaInvoiceHash(unsigned);
  const signature = crypto
    .sign("sha256", Buffer.from(invoiceHash, "base64"), crypto.createPrivateKey(privateKeyPem))
    .toString("base64");

  const certBase64 = certificateDer.toString("base64");
  const cert = parseCertificate(certificateDer);
  const certificateHash = hexDigestB64(certBase64);
  const serialDecimal = cert.serialDecimal;

  const signedProperties = el(
    "xades:SignedProperties",
    { Id: "xadesSignedProperties" },
    el(
      "xades:SignedSignatureProperties",
      null,
      el("xades:SigningTime", null, signingTime),
      el(
        "xades:SigningCertificate",
        null,
        el(
          "xades:Cert",
          null,
          el(
            "xades:CertDigest",
            null,
            el("ds:DigestMethod", { Algorithm: ALG.sha256 }),
            el("ds:DigestValue", null, certificateHash)
          ),
          el(
            "xades:IssuerSerial",
            null,
            el("ds:X509IssuerName", null, cert.issuer),
            el("ds:X509SerialNumber", null, serialDecimal)
          )
        )
      )
    )
  );

  const extensions = (propsDigest: string) =>
    el(
      "ext:UBLExtensions",
      null,
      el(
        "ext:UBLExtension",
        null,
        el("ext:ExtensionURI", null, "urn:oasis:names:specification:ubl:dsig:enveloped:xades"),
        el(
          "ext:ExtensionContent",
          null,
          el(
            "sig:UBLDocumentSignatures",
            { "xmlns:sig": UBL_NS.sig, "xmlns:sac": UBL_NS.sac, "xmlns:sbc": UBL_NS.sbc },
            el(
              "sac:SignatureInformation",
              null,
              el("cbc:ID", null, "urn:oasis:names:specification:ubl:signature:1"),
              el(
                "sbc:ReferencedSignatureID",
                null,
                "urn:oasis:names:specification:ubl:signature:Invoice"
              ),
              el(
                "ds:Signature",
                { "xmlns:ds": UBL_NS.ds, Id: "signature" },
                el(
                  "ds:SignedInfo",
                  null,
                  el("ds:CanonicalizationMethod", { Algorithm: ALG.c14n11 }),
                  el("ds:SignatureMethod", { Algorithm: ALG.ecdsaSha256 }),
                  el(
                    "ds:Reference",
                    { Id: "invoiceSignedData", URI: "" },
                    el(
                      "ds:Transforms",
                      null,
                      EXCLUDE_XPATHS.map((x) =>
                        el("ds:Transform", { Algorithm: ALG.xpath }, el("ds:XPath", null, x))
                      ),
                      el("ds:Transform", { Algorithm: ALG.c14n11 })
                    ),
                    el("ds:DigestMethod", { Algorithm: ALG.sha256 }),
                    el("ds:DigestValue", null, invoiceHash)
                  ),
                  el(
                    "ds:Reference",
                    { Type: ALG.signatureProperties, URI: "#xadesSignedProperties" },
                    el("ds:DigestMethod", { Algorithm: ALG.sha256 }),
                    el("ds:DigestValue", null, propsDigest)
                  )
                ),
                el("ds:SignatureValue", null, signature),
                el(
                  "ds:KeyInfo",
                  null,
                  el("ds:X509Data", null, el("ds:X509Certificate", null, certBase64))
                ),
                el(
                  "ds:Object",
                  null,
                  el(
                    "xades:QualifyingProperties",
                    { "xmlns:xades": UBL_NS.xades, Target: "signature" },
                    signedProperties
                  )
                )
              )
            )
          )
        )
      )
    );

  const t = zatcaTotals(input);
  const qr = buildZatcaQr({
    sellerName: input.seller.nameAr,
    vatNumber: input.seller.vatNumber,
    timestamp: `${input.issueDate}T${input.issueTime}`,
    totalWithVat: t.total.toFixed(2),
    vatTotal: t.vatTotal.toFixed(2),
    invoiceHash,
    signature,
    publicKey: publicKeyDerFromPrivate(privateKeyPem),
    certificateSignature: input.profile === "simplified" ? Buffer.from(cert.signature) : null,
  });

  // The SignedProperties digest is taken over the node as it sits in the
  // final document (in-scope namespaces included), then filled in.
  const draft = serializeXml(
    buildZatcaInvoice(input, { extensions: extensions(PROPS_PLACEHOLDER), qr })
  );
  const signedPropertiesHash = signedPropertiesDigest(draft);
  const xml = draft.replace(PROPS_PLACEHOLDER, signedPropertiesHash);
  return { xml, invoiceHash, signature, qr, certificateHash, signedPropertiesHash };
}

function signedPropertiesDigest(xml: string): string {
  const doc = parseXml(xml);
  const props = descendants(doc as unknown as Element, "xades:SignedProperties")[0];
  if (!props) throw new Error("SignedProperties missing");
  return hexDigestB64(canonicalize(props as unknown as Node, inScopeNamespaces(props)));
}

export interface ZatcaVerification {
  valid: boolean;
  checks: Record<string, boolean>;
  invoiceHash: string;
}

/** Independent verification of a stamped document (used by tests and before submission). */
export function verifyZatcaSignedXml(xml: string): ZatcaVerification {
  const doc = parseXml(xml);
  const root = doc.documentElement as unknown as Element;
  const sig = descendants(root, "ds:Signature")[0];
  const refs = sig ? descendants(sig, "ds:Reference") : [];
  const invoiceRef = refs.find((r) => r.getAttribute("Id") === "invoiceSignedData");
  const propsRef = refs.find((r) => r.getAttribute("URI") === "#xadesSignedProperties");
  const invoiceHash = computeZatcaInvoiceHash(xml);
  const signature = text(sig ? descendants(sig, "ds:SignatureValue")[0] : null) ?? "";
  const certB64 = text(sig ? descendants(sig, "ds:X509Certificate")[0] : null) ?? "";
  let signatureOk = false;
  let certDigestOk = false;
  let publicKey: Buffer | null = null;
  try {
    const cert = parseCertificate(Buffer.from(certB64, "base64"));
    publicKey = cert.publicKeyDer;
    const keyObject = crypto.createPublicKey({ key: publicKey, format: "der", type: "spki" });
    signatureOk = crypto.verify(
      "sha256",
      Buffer.from(invoiceHash, "base64"),
      keyObject,
      Buffer.from(signature, "base64")
    );
    const certDigest = text(
      descendants(sig as Element, "xades:CertDigest").map((c) => first(c, "ds:DigestValue"))[0]
    );
    certDigestOk = certDigest === hexDigestB64(certB64);
  } catch {
    signatureOk = false;
  }
  const qrNode = children(root, "cac:AdditionalDocumentReference").find(
    (n) => textAt(n, "cbc:ID") === "QR"
  );
  const qrB64 = qrNode ? textAt(qrNode, "cac:Attachment/cbc:EmbeddedDocumentBinaryObject") : null;
  let qrOk = false;
  if (qrB64) {
    const tags = decodeZatcaQr(qrB64);
    qrOk =
      tags.get(6)?.toString("utf8") === invoiceHash &&
      tags.get(7)?.toString("utf8") === signature &&
      !!publicKey &&
      Buffer.compare(tags.get(8) ?? Buffer.alloc(0), publicKey) === 0;
  }
  const checks = {
    invoiceDigest: text(invoiceRef ? first(invoiceRef, "ds:DigestValue") : null) === invoiceHash,
    signedPropertiesDigest:
      text(propsRef ? first(propsRef, "ds:DigestValue") : null) === signedPropertiesDigest(xml),
    signature: signatureOk,
    certificateDigest: certDigestOk,
    qr: qrOk,
  };
  return { valid: Object.values(checks).every(Boolean), checks, invoiceHash };
}
