/**
 * X6d: per-invoice compliance pills for the invoice list. One row per issued (non-draft,
 * non-void) invoice with its report-by date and the two tracks, derived with the same
 * `deriveInvoiceTracks` the status view uses. Established obligations and observed outcomes stay
 * visible after company settings change. Other rows appear when the company is in scope.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  customerContacts,
  einvoiceBuyerEndpoints,
  einvoiceDocuments,
  invoices,
  type Company,
} from "../../../shared/schema";
import { db } from "../../db";
import { projectEInvoiceDocument } from "./status-view";
import { einvoiceMandateApplies } from "./scope";
import { isReportingObservation, type DeliveryStatus, type ReportingStatus } from "./tracks";
import { projectInvoiceTracks, reportingInvoiceColumns } from "./reporting";

export interface CompliancePill {
  invoiceId: string;
  reportBy: string | null;
  overdue: boolean;
  reportingRequired: boolean;
  reportingObligationKnown: boolean;
  delivery: DeliveryStatus;
  deliveryConfirmationUnavailable: boolean;
  reporting: ReportingStatus;
}

type DocumentEvidence = Pick<
  ReturnType<typeof projectEInvoiceDocument>,
  | "invoiceId"
  | "status"
  | "provider"
  | "providerStatus"
  | "environment"
  | "providerMessageId"
  | "deliveryStatus"
  | "deliveryConfirmationUnavailable"
  | "reportingStatus"
  | "reportingRequired"
  | "reportingObligationKnown"
  | "reportBy"
>;

export async function listCompliancePills(
  company: Company,
  now = new Date(),
  invoiceIds?: string[]
) {
  const mandateApplies = einvoiceMandateApplies(company, now);
  const rows = await db
    .select({
      invoice: reportingInvoiceColumns,
      doc: einvoiceDocuments,
      linkedBuyerTrn: customerContacts.trnNumber,
      buyerEndpoint: einvoiceBuyerEndpoints.participantId,
    })
    .from(invoices)
    .leftJoin(
      einvoiceDocuments,
      and(
        eq(einvoiceDocuments.invoiceId, invoices.id),
        eq(einvoiceDocuments.companyId, invoices.companyId)
      )
    )
    .leftJoin(
      customerContacts,
      and(
        eq(customerContacts.companyId, invoices.companyId),
        eq(customerContacts.id, invoices.contactId)
      )
    )
    .leftJoin(
      einvoiceBuyerEndpoints,
      and(
        eq(einvoiceBuyerEndpoints.companyId, invoices.companyId),
        eq(einvoiceBuyerEndpoints.contactId, customerContacts.id)
      )
    )
    .where(
      and(
        eq(invoices.companyId, company.id),
        invoiceIds ? inArray(invoices.id, invoiceIds) : undefined
      )
    )
    .orderBy(desc(invoices.date));
  const items: CompliancePill[] = [];
  const documents: DocumentEvidence[] = [];
  for (const { invoice, doc, linkedBuyerTrn, buyerEndpoint } of rows) {
    const status = String(invoice.status ?? "").toLowerCase();
    const t = projectInvoiceTracks(
      invoice,
      doc,
      company,
      now,
      invoice.customerTrn || linkedBuyerTrn,
      buyerEndpoint
    );
    if (invoiceIds && doc) {
      const {
        invoiceId,
        status,
        provider,
        providerStatus,
        environment,
        providerMessageId,
        deliveryStatus,
        deliveryConfirmationUnavailable,
        reportingStatus,
        reportingRequired,
        reportingObligationKnown,
        reportBy,
      } = projectEInvoiceDocument(doc, t);
      documents.push({
        invoiceId,
        status,
        provider,
        providerStatus,
        environment,
        providerMessageId,
        deliveryStatus,
        deliveryConfirmationUnavailable,
        reportingStatus,
        reportingRequired,
        reportingObligationKnown,
        reportBy,
      });
    }
    if (status === "draft" || status === "void" || status === "cancelled") continue;
    if (
      t.delivery !== "not_applicable" &&
      !mandateApplies &&
      t.reportingObligationKnown &&
      !t.reportingRequired &&
      !isReportingObservation(t.reporting)
    )
      continue;
    items.push({
      invoiceId: invoice.id,
      reportBy: t.reportBy,
      overdue: t.overdue,
      reportingRequired: t.reportingRequired,
      reportingObligationKnown: t.reportingObligationKnown,
      delivery: t.delivery,
      deliveryConfirmationUnavailable: t.deliveryConfirmationUnavailable,
      reporting: t.reporting,
    });
  }
  return { mandateApplies, items, ...(invoiceIds ? { documents } : {}) };
}
