import {
  invoices,
  type Company,
  type EInvoiceDocument,
  type Invoice,
} from "../../../shared/schema";
import { isB2cCashSale } from "./applicability";
import { first, parseXml, partyVatTrn, textAt } from "./dom";
import { einvoiceMandateApplies } from "./scope";
import { deriveInvoiceTracks, reportByDate, reportingRequired } from "./tracks";
import {
  documentSubmissionSnapshot,
  recordedReportingRequired,
  submissionProviderPin,
} from "./store";

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

export const reportingInvoiceColumns = {
  id: invoices.id,
  date: invoices.date,
  status: invoices.status,
  source: invoices.source,
  customerTrn: invoices.customerTrn,
  einvoiceStatus: invoices.einvoiceStatus,
  einvoiceProvider: invoices.einvoiceProvider,
  einvoiceSubmittedAt: invoices.einvoiceSubmittedAt,
  einvoiceProviderMessageId: invoices.einvoiceProviderMessageId,
};

type ReportingInvoice = Pick<Invoice, keyof typeof reportingInvoiceColumns>;

const historicalStatuses = new Set([
  "queued",
  "submitted",
  "accepted",
  "cleared",
  "rejected",
  "failed",
  "cancelled",
]);

/** Only work that has not entered the submission workflow can use the live filing preview. */
export function projectReportingObligation(
  invoice: ReportingInvoice | null | undefined,
  doc: EInvoiceDocument | null | undefined,
  company: Company,
  now: Date,
  resolvedBuyerTrn: string | null | undefined = invoice?.customerTrn
) {
  const attempted =
    !invoice ||
    !!invoice.einvoiceSubmittedAt ||
    submissionProviderPin(invoice, doc ?? undefined) !== undefined ||
    !!doc?.submittedAt ||
    !!documentSubmissionSnapshot(doc)?.operationId ||
    historicalStatuses.has(invoice.einvoiceStatus ?? "") ||
    historicalStatuses.has(doc?.status ?? "");
  if (attempted) {
    const recorded = recordedReportingRequired(doc);
    return {
      required: recorded === true,
      known: recorded !== null,
      reportBy: doc?.reportBy ?? null,
    };
  }
  // Generate can leave XML behind before submission. Only a queued revision freezes the buyer.
  const required = invoiceReportingRequired(
    { customerTrn: resolvedBuyerTrn ?? null },
    company,
    now
  );
  return { required, known: true, reportBy: required ? reportByDate(invoice.date) : null };
}

export function projectInvoiceTracks(
  invoice: ReportingInvoice | null | undefined,
  doc: EInvoiceDocument | null | undefined,
  company: Company,
  now: Date,
  resolvedBuyerTrn: string | null | undefined = invoice?.customerTrn,
  buyerEndpoint?: string | null
) {
  if (
    invoice &&
    isB2cCashSale(invoice, { trn: resolvedBuyerTrn, endpointId: buyerEndpoint }) &&
    !invoice.einvoiceSubmittedAt &&
    !doc?.submittedAt &&
    submissionProviderPin(invoice, doc ?? undefined) === undefined
  ) {
    return {
      delivery: "not_applicable" as const,
      deliveryConfirmationUnavailable: false,
      reporting: "not_required" as const,
      reportingRequired: false,
      reportingObligationKnown: true,
      isDraft: invoice.status === "draft",
      reportBy: null,
      overdue: false,
    };
  }
  return deriveInvoiceTracks({
    invoiceStatus: invoice?.status,
    legacyStatus: invoice?.einvoiceStatus ?? doc?.status,
    provider: invoice?.einvoiceProvider,
    providerMessageId: invoice?.einvoiceProviderMessageId,
    doc: doc ?? null,
    obligation: projectReportingObligation(invoice, doc, company, now, resolvedBuyerTrn),
    now,
  });
}
