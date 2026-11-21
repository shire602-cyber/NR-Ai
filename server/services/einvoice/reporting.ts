import type { Company, Invoice } from "../../../shared/schema";
import { first, parseXml, partyVatTrn, textAt } from "./dom";
import { einvoiceMandateApplies } from "./scope";
import { reportByDate, reportingRequired } from "./tracks";

type InvoiceBuyer = Pick<Invoice, "customerTrn"> & Partial<Pick<Invoice, "einvoiceXml">>;

function readReportingSource(xml: string | null | undefined) {
  if (!xml) return null;
  try {
    const root = parseXml(xml).documentElement;
    return {
      customerTrn: partyVatTrn(first(root, "cac:AccountingCustomerParty/cac:Party")),
      issueDate: textAt(root, "cbc:IssueDate"),
    };
  } catch {
    return null;
  }
}

/** A frozen document determines whether its buyer was VAT-registered. */
export function invoiceReportingRequired(
  invoice: InvoiceBuyer,
  company: Company,
  now: Date = new Date(),
  resolvedBuyerTrn: string | null | undefined = invoice.customerTrn
): boolean {
  const source = readReportingSource(invoice.einvoiceXml);
  return reportingRequired({
    customerTrn: source ? source.customerTrn : resolvedBuyerTrn,
    companyScope: company.einvoiceScope,
    mandateApplies: einvoiceMandateApplies(company, now),
  });
}

export function invoiceReportingDeadline(invoice: Pick<Invoice, "einvoiceXml" | "date">) {
  return reportByDate(readReportingSource(invoice.einvoiceXml)?.issueDate ?? invoice.date);
}
