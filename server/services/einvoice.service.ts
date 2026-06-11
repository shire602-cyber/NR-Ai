import crypto from "crypto";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { UAE_VAT_RATE } from "../constants";

/**
 * Escape XML special characters to prevent malformed output.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format a Date as YYYY-MM-DD for UBL IssueDate.
 */
function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

/**
 * Generate UBL 2.1 XML for UAE PINT AE e-invoicing format.
 *
 * Produces a compliant-structured XML document following the PINT AE / Peppol BIS 3.0
 * customization for UAE e-invoicing. Includes seller/buyer parties, tax totals,
 * invoice lines, and monetary totals.
 */
/**
 * UAE VAT category codes (UNCL5305 subset used by PINT AE):
 * S standard 5% · Z zero-rated · E exempt · O out of scope.
 */
export function vatCategoryFor(
  line: Pick<InvoiceLine, "vatSupplyType" | "vatRate">
): "S" | "Z" | "E" | "O" {
  switch (line.vatSupplyType) {
    case "zero_rated":
      return "Z";
    case "exempt":
      return "E";
    case "out_of_scope":
      return "O";
    default:
      return (line.vatRate ?? UAE_VAT_RATE) === 0 ? "Z" : "S";
  }
}

export function generateEInvoiceXML(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  customer?: { name: string; trn?: string }
): { xml: string; uuid: string; hash: string } {
  const uuid = crypto.randomUUID();
  const issueDate = formatDate(invoice.date);
  const currency = invoice.currency || "AED";

  // Build invoice lines XML
  const invoiceLinesXml = lines
    .map((line, index) => {
      const lineExtension = line.quantity * line.unitPrice;
      const vatRate = line.vatRate ?? UAE_VAT_RATE;
      const vatAmount = lineExtension * vatRate;
      const category = vatCategoryFor(line);
      const vatPercent = (category === "S" ? vatRate * 100 : 0).toFixed(2);
      void vatAmount;

      return `
    <cac:InvoiceLine>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="EA">${line.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${lineExtension.toFixed(2)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${escapeXml(line.description)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${category}</cbc:ID>
          <cbc:Percent>${vatPercent}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${escapeXml(currency)}">${line.unitPrice.toFixed(2)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
    })
    .join("");

  // Tax breakdown grouped by (VAT category, rate) — Z/E/O lines must not be
  // declared under the standard-rated category.
  const taxByGroup = new Map<
    string,
    { category: string; rate: number; taxable: number; tax: number }
  >();
  for (const line of lines) {
    const category = vatCategoryFor(line);
    const vatRate = category === "S" ? (line.vatRate ?? UAE_VAT_RATE) : 0;
    const lineExtension = line.quantity * line.unitPrice;
    const key = `${category}:${vatRate}`;
    const existing = taxByGroup.get(key) || { category, rate: vatRate, taxable: 0, tax: 0 };
    existing.taxable += lineExtension;
    existing.tax += lineExtension * vatRate;
    taxByGroup.set(key, existing);
  }

  const taxSubtotalsXml = Array.from(taxByGroup.values())
    .map(({ category, rate, taxable, tax }) => {
      const vatPercent = (rate * 100).toFixed(2);
      const amounts = { taxable, tax };
      return `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${escapeXml(currency)}">${amounts.taxable.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${escapeXml(currency)}">${amounts.tax.toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${category}</cbc:ID>
          <cbc:Percent>${vatPercent}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`;
    })
    .join("");

  const customerName = customer?.name || invoice.customerName || "Cash Customer";
  const customerTrn = customer?.trn || invoice.customerTrn || "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(currency)}</cbc:DocumentCurrencyCode>
  <cbc:UUID>${uuid}</cbc:UUID>

  <!-- Seller (Supplier) -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(company.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(company.businessAddress || "")}</cbc:StreetName>
        <cac:Country>
          <cbc:IdentificationCode>AE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(company.trnVatNumber || "")}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(company.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>${
        company.contactEmail
          ? `
      <cac:Contact>
        <cbc:ElectronicMail>${escapeXml(company.contactEmail)}</cbc:ElectronicMail>${
          company.contactPhone
            ? `
        <cbc:Telephone>${escapeXml(company.contactPhone)}</cbc:Telephone>`
            : ""
        }
      </cac:Contact>`
          : ""
      }
    </cac:Party>
  </cac:AccountingSupplierParty>

  <!-- Buyer (Customer) -->
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(customerName)}</cbc:Name>
      </cac:PartyName>${
        customerTrn
          ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(customerTrn)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ""
      }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(customerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <!-- Tax Total -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(currency)}">${invoice.vatAmount.toFixed(2)}</cbc:TaxAmount>${taxSubtotalsXml}
  </cac:TaxTotal>

  <!-- Monetary Totals -->
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${invoice.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(currency)}">${invoice.subtotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(currency)}">${invoice.total.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(currency)}">${invoice.total.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <!-- Invoice Lines -->${invoiceLinesXml}
</Invoice>`;

  const hash = crypto.createHash("sha256").update(xml).digest("hex");

  return { xml, uuid, hash };
}

export interface EInvoiceIssue {
  field: string;
  message: string;
}

const TRN_RE = /^[0-9]{15}$/;

/**
 * Pre-submission validation: every issue here would cause an ASP/FTA
 * rejection. Surfaced to the UI as fix-it errors before generation.
 */
export function validateForEInvoicing(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company
): EInvoiceIssue[] {
  const issues: EInvoiceIssue[] = [];

  if (!company.trnVatNumber) {
    issues.push({
      field: "company.trnVatNumber",
      message: "Supplier TRN is required for e-invoicing",
    });
  } else if (!TRN_RE.test(company.trnVatNumber)) {
    issues.push({
      field: "company.trnVatNumber",
      message: "Supplier TRN must be exactly 15 digits",
    });
  }
  if (!company.name) {
    issues.push({ field: "company.name", message: "Supplier legal name is required" });
  }
  if (!invoice.number) {
    issues.push({ field: "invoice.number", message: "Invoice number is required" });
  }
  if (!invoice.date) {
    issues.push({ field: "invoice.date", message: "Invoice issue date is required" });
  }
  if (!invoice.customerName) {
    issues.push({ field: "invoice.customerName", message: "Buyer name is required" });
  }
  if (invoice.customerTrn && !TRN_RE.test(invoice.customerTrn)) {
    issues.push({
      field: "invoice.customerTrn",
      message: "Buyer TRN must be exactly 15 digits when provided",
    });
  }
  if (lines.length === 0) {
    issues.push({ field: "lines", message: "At least one invoice line is required" });
  }

  let lineSum = 0;
  let lineVat = 0;
  lines.forEach((line, i) => {
    if (!line.description) {
      issues.push({ field: `lines[${i}].description`, message: "Line description is required" });
    }
    if (!(line.quantity > 0)) {
      issues.push({ field: `lines[${i}].quantity`, message: "Line quantity must be positive" });
    }
    if (line.unitPrice < 0) {
      issues.push({
        field: `lines[${i}].unitPrice`,
        message: "Line unit price cannot be negative",
      });
    }
    const ext = line.quantity * line.unitPrice;
    lineSum += ext;
    lineVat += vatCategoryFor(line) === "S" ? ext * (line.vatRate ?? UAE_VAT_RATE) : 0;
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (lines.length > 0) {
    if (Math.abs(round2(lineSum) - round2(invoice.subtotal)) > 0.05) {
      issues.push({
        field: "invoice.subtotal",
        message: `Line totals (${round2(lineSum).toFixed(2)}) do not match the invoice subtotal (${round2(invoice.subtotal).toFixed(2)})`,
      });
    }
    if (Math.abs(round2(lineVat) - round2(invoice.vatAmount)) > 0.05) {
      issues.push({
        field: "invoice.vatAmount",
        message: `Line VAT (${round2(lineVat).toFixed(2)}) does not match the invoice VAT amount (${round2(invoice.vatAmount).toFixed(2)})`,
      });
    }
  }
  if (Math.abs(round2(invoice.subtotal + invoice.vatAmount) - round2(invoice.total)) > 0.05) {
    issues.push({
      field: "invoice.total",
      message: "Subtotal plus VAT does not equal the invoice total",
    });
  }

  return issues;
}
