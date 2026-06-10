import crypto from 'crypto';
import type { Invoice, InvoiceLine, Company } from '../../shared/schema';
import { UAE_VAT_RATE } from '../constants';

/**
 * Escape XML special characters to prevent malformed output.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format a Date as YYYY-MM-DD for UBL IssueDate.
 */
function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

/**
 * Generate UBL 2.1 XML for UAE PINT AE e-invoicing format.
 *
 * Produces a compliant-structured XML document following the PINT AE / Peppol BIS 3.0
 * customization for UAE e-invoicing. Includes seller/buyer parties, tax totals,
 * invoice lines, and monetary totals.
 */
export function generateEInvoiceXML(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  customer?: { name: string; trn?: string }
): { xml: string; uuid: string; hash: string } {
  const uuid = crypto.randomUUID();
  const issueDate = formatDate(invoice.date);
  const currency = invoice.currency || 'AED';

  // Build invoice lines XML
  const invoiceLinesXml = lines
    .map((line, index) => {
      const lineExtension = line.quantity * line.unitPrice;
      const vatRate = line.vatRate ?? UAE_VAT_RATE;
      const vatAmount = lineExtension * vatRate;
      const vatPercent = (vatRate * 100).toFixed(2);

      return `
    <cac:InvoiceLine>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="EA">${line.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${lineExtension.toFixed(2)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${escapeXml(line.description)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>S</cbc:ID>
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
    .join('');

  // Calculate tax breakdown (grouped by VAT rate)
  const taxByRate = new Map<number, { taxable: number; tax: number }>();
  for (const line of lines) {
    const vatRate = line.vatRate ?? UAE_VAT_RATE;
    const lineExtension = line.quantity * line.unitPrice;
    const existing = taxByRate.get(vatRate) || { taxable: 0, tax: 0 };
    existing.taxable += lineExtension;
    existing.tax += lineExtension * vatRate;
    taxByRate.set(vatRate, existing);
  }

  const taxSubtotalsXml = Array.from(taxByRate.entries())
    .map(([rate, amounts]) => {
      const vatPercent = (rate * 100).toFixed(2);
      return `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${escapeXml(currency)}">${amounts.taxable.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${escapeXml(currency)}">${amounts.tax.toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>S</cbc:ID>
          <cbc:Percent>${vatPercent}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>VAT</cbc:ID>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`;
    })
    .join('');

  const customerName = customer?.name || invoice.customerName || 'Cash Customer';
  const customerTrn = customer?.trn || invoice.customerTrn || '';

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
        <cbc:StreetName>${escapeXml(company.businessAddress || '')}</cbc:StreetName>
        <cac:Country>
          <cbc:IdentificationCode>AE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(company.trnVatNumber || '')}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(company.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>${company.contactEmail ? `
      <cac:Contact>
        <cbc:ElectronicMail>${escapeXml(company.contactEmail)}</cbc:ElectronicMail>${company.contactPhone ? `
        <cbc:Telephone>${escapeXml(company.contactPhone)}</cbc:Telephone>` : ''}
      </cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingSupplierParty>

  <!-- Buyer (Customer) -->
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(customerName)}</cbc:Name>
      </cac:PartyName>${customerTrn ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(customerTrn)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
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

  const hash = crypto.createHash('sha256').update(xml).digest('hex');

  return { xml, uuid, hash };
}
