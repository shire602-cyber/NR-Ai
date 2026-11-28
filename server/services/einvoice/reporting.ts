import { sql } from "drizzle-orm";
import {
  invoices,
  type Company,
  type EInvoiceDocument,
  type Invoice,
} from "../../../shared/schema";
import { isB2cCashSale } from "./applicability";
import { first, parseXml, partyVatTrn, textAt } from "./dom";
import { PEPPOL_SCHEME_UAE_TIN, tinFromTrn, uaePeppolEndpointIssue } from "./pint-ae-codes";
import { einvoiceMandateApplies } from "./scope";
import { deriveInvoiceTracks, reportByDate, reportingRequired } from "./tracks";
import {
  documentSubmissionSnapshot,
  recordedReportingRequired,
  submissionProviderPin,
} from "./store";

type InvoiceBuyer = Pick<Invoice, "customerTrn"> &
  Partial<Pick<Invoice, "einvoiceXml" | "buyerType">>;

type BuyerEndpoint = { endpointScheme?: string | null; endpointId?: string | null };

export const reportingBuyerContact = sql<string>`coalesce(${invoices.einvoiceBuyerContactId}, ${invoices.contactId})`;

function readReportingSource(xml: string | null | undefined) {
  if (!xml) return null;
  try {
    const root = parseXml(xml).documentElement;
    const party = first(root, "cac:AccountingCustomerParty/cac:Party");
    const endpoint = party && first(party, "cbc:EndpointID");
    return {
      customerTrn: partyVatTrn(party),
      endpointId: endpoint?.textContent ?? null,
      endpointScheme: endpoint?.getAttribute("schemeID") ?? null,
      issueDate: textAt(root, "cbc:IssueDate"),
    };
  } catch {
    return null;
  }
}

/** Use the issued XML for buyer identity when freezing the transaction obligation. */
export function invoiceReportingRequired(
  invoice: InvoiceBuyer,
  company: Company,
  now: Date = new Date(),
  resolvedBuyerTrn: string | null | undefined = invoice.customerTrn,
  liveEndpoint?: BuyerEndpoint
): boolean {
  const source = readReportingSource(invoice.einvoiceXml);
  const customerTrn = source ? source.customerTrn : resolvedBuyerTrn;
  const endpoint = source ?? liveEndpoint;
  const scheme = endpoint?.endpointScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const id = endpoint?.endpointId?.trim();
  return reportingRequired({
    buyerType: invoice.buyerType,
    customerTrn,
    hasBuyerEndpoint:
      !!id &&
      /^\d{4}$/.test(scheme) &&
      !uaePeppolEndpointIssue(scheme, id, tinFromTrn(customerTrn)),
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
  buyerType: invoices.buyerType,
  einvoiceBuyerContactId: invoices.einvoiceBuyerContactId,
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
  resolvedBuyerTrn: string | null | undefined = invoice?.customerTrn,
  liveEndpoint?: BuyerEndpoint
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
    { buyerType: invoice.buyerType, customerTrn: resolvedBuyerTrn ?? null },
    company,
    now,
    resolvedBuyerTrn,
    liveEndpoint
  );
  const buyerUnknown =
    !required &&
    invoice.source === "cash_sale" &&
    !invoice.buyerType &&
    einvoiceMandateApplies(company, now);
  return { required, known: !buyerUnknown, reportBy: required ? reportByDate(invoice.date) : null };
}

export function projectInvoiceTracks(
  invoice: ReportingInvoice | null | undefined,
  doc: EInvoiceDocument | null | undefined,
  company: Company,
  now: Date,
  resolvedBuyerTrn: string | null | undefined = invoice?.customerTrn,
  liveEndpoint?: BuyerEndpoint
) {
  if (
    invoice &&
    isB2cCashSale(invoice) &&
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
    obligation: projectReportingObligation(
      invoice,
      doc,
      company,
      now,
      resolvedBuyerTrn,
      liveEndpoint
    ),
    now,
  });
}
