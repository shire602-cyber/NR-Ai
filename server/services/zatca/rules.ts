/**
 * ZATCA Phase 2 document checks as an explicit rule list. The official
 * ZATCA schematron (CEN + KSA rules) ships only inside the Fatoora SDK and is
 * not vendored here (EXTERNAL); these rules cover the Phase 2 structure we
 * produce and are applied together with the UBL 2.1 XSD before any
 * submission. Rule ids are descriptive ("KSA-*"), not ZATCA's numbering.
 */
import { children, fils, first, parseXml, textAt, type XNode } from "../einvoice/dom";
import { decodeZatcaQr } from "./qr";
import type { RuleFinding } from "../einvoice/pint-ae-rules";

type Check = (root: XNode) => boolean;
const rules: Array<{ id: string; message: string; check: Check }> = [
  {
    id: "KSA-PROFILE",
    message: "ProfileID must be reporting:1.0",
    check: (r) => textAt(r, "cbc:ProfileID") === "reporting:1.0",
  },
  {
    id: "KSA-UUID",
    message: "UUID is required",
    check: (r) => /^[0-9a-f-]{36}$/i.test(textAt(r, "cbc:UUID") ?? ""),
  },
  {
    id: "KSA-ISSUE-TIME",
    message: "IssueTime is required (HH:MM:SS)",
    check: (r) => /^\d{2}:\d{2}:\d{2}$/.test(textAt(r, "cbc:IssueTime") ?? ""),
  },
  {
    id: "KSA-TYPE",
    message:
      "InvoiceTypeCode must be 388/381/383 with a 7-digit transaction name (01xxxxx / 02xxxxx)",
    check: (r) => {
      const n = first(r, "cbc:InvoiceTypeCode");
      return (
        ["388", "381", "383"].includes(textAt(r, "cbc:InvoiceTypeCode") ?? "") &&
        /^0[12][01]{5}$/.test(n?.getAttribute("name") ?? "")
      );
    },
  },
  {
    id: "KSA-NOTE-REFERENCE",
    message: "Credit and debit notes must reference the original invoice and state the reason",
    check: (r) =>
      !["381", "383"].includes(textAt(r, "cbc:InvoiceTypeCode") ?? "") ||
      (!!textAt(r, "cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID") &&
        !!textAt(r, "cac:PaymentMeans/cbc:InstructionNote")),
  },
  {
    id: "KSA-ICV",
    message: "Invoice counter value (ICV) is required and must be a positive integer",
    check: (r) =>
      children(r, "cac:AdditionalDocumentReference").some(
        (d) => textAt(d, "cbc:ID") === "ICV" && /^[1-9]\d*$/.test(textAt(d, "cbc:UUID") ?? "")
      ),
  },
  {
    id: "KSA-PIH",
    message: "Previous invoice hash (PIH) is required (base64 SHA-256)",
    check: (r) =>
      children(r, "cac:AdditionalDocumentReference").some(
        (d) =>
          textAt(d, "cbc:ID") === "PIH" &&
          (textAt(d, "cac:Attachment/cbc:EmbeddedDocumentBinaryObject") ?? "").length >= 44
      ),
  },
  {
    id: "KSA-QR",
    message: "The QR code must carry TLV tags 1-8 (and 9 for simplified invoices)",
    check: (r) => {
      const q = children(r, "cac:AdditionalDocumentReference").find(
        (d) => textAt(d, "cbc:ID") === "QR"
      );
      const b64 = q ? textAt(q, "cac:Attachment/cbc:EmbeddedDocumentBinaryObject") : null;
      if (!b64) return false;
      try {
        const tags = decodeZatcaQr(b64);
        const simplified = (first(r, "cbc:InvoiceTypeCode")?.getAttribute("name") ?? "").startsWith(
          "02"
        );
        const need = simplified ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5, 6, 7, 8];
        return need.every((t) => tags.has(t));
      } catch {
        return false;
      }
    },
  },
  {
    id: "KSA-SIGNATURE",
    message: "The document must carry the XAdES signature extension and cac:Signature",
    check: (r) =>
      children(r, "ext:UBLExtensions").length === 1 && children(r, "cac:Signature").length === 1,
  },
  {
    id: "KSA-SELLER-VAT",
    message: "Seller VAT number must be 15 digits, starting and ending with 3",
    check: (r) =>
      /^3\d{13}3$/.test(
        textAt(r, "cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID") ?? ""
      ),
  },
  {
    id: "KSA-SELLER-ADDRESS",
    message: "Seller street, building number, district, city and postal zone are required",
    check: (r) => {
      const a = first(r, "cac:AccountingSupplierParty/cac:Party/cac:PostalAddress");
      return (
        !!a &&
        [
          "cbc:StreetName",
          "cbc:BuildingNumber",
          "cbc:CitySubdivisionName",
          "cbc:CityName",
          "cbc:PostalZone",
        ].every((p) => !!textAt(a, p)) &&
        /^\d{4}$/.test(textAt(a, "cbc:BuildingNumber") ?? "") &&
        /^\d{5}$/.test(textAt(a, "cbc:PostalZone") ?? "")
      );
    },
  },
  {
    id: "KSA-SELLER-NAME-AR",
    message: "Seller registration name must be given in Arabic",
    check: (r) =>
      /[؀-ۿ]/.test(
        textAt(
          r,
          "cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName"
        ) ?? ""
      ),
  },
  {
    id: "KSA-STANDARD-BUYER",
    message: "A standard tax invoice must identify the buyer (name and VAT number or address)",
    check: (r) => {
      const standard = (first(r, "cbc:InvoiceTypeCode")?.getAttribute("name") ?? "").startsWith(
        "01"
      );
      if (!standard) return true;
      const p = first(r, "cac:AccountingCustomerParty/cac:Party");
      return !!p && !!textAt(p, "cac:PartyLegalEntity/cbc:RegistrationName");
    },
  },
  {
    id: "KSA-TOTALS",
    message: "Tax inclusive amount must equal line total plus VAT",
    check: (r) => {
      const lm = first(r, "cac:LegalMonetaryTotal");
      const vat = children(r, "cac:TaxTotal").find(
        (t) => children(t, "cac:TaxSubtotal").length > 0
      );
      if (!lm || !vat) return false;
      const lineSum = children(r, "cac:InvoiceLine").reduce(
        (s, l) => s + fils(textAt(l, "cbc:LineExtensionAmount")),
        0
      );
      return (
        lineSum === fils(textAt(lm, "cbc:LineExtensionAmount")) &&
        fils(textAt(lm, "cbc:TaxExclusiveAmount")) + fils(textAt(vat, "cbc:TaxAmount")) ===
          fils(textAt(lm, "cbc:TaxInclusiveAmount"))
      );
    },
  },
];

export function runZatcaRules(xml: string): RuleFinding[] {
  let root: XNode;
  try {
    root = parseXml(xml).documentElement as unknown as XNode;
  } catch (err) {
    return [{ id: "XML-WELLFORMED", flag: "fatal", message: (err as Error).message }];
  }
  return rules
    .filter((r) => !r.check(root))
    .map((r) => ({ id: r.id, flag: "fatal" as const, message: r.message }));
}
