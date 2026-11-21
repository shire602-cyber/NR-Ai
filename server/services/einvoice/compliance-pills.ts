/**
 * X6d: per-invoice compliance pills for the invoice list. One row per issued (non-draft,
 * non-void) invoice with its report-by date and the two tracks, derived with the same
 * `deriveInvoiceTracks` the status view uses. Established obligations and observed outcomes stay
 * visible after company settings change. Other rows appear when the company is in scope.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  customerContacts,
  einvoiceDocuments,
  invoices,
  type Company,
} from "../../../shared/schema";
import { db } from "../../db";
import { documentReportingRequired } from "./store";
import { projectEInvoiceDocument } from "./status-view";
import { einvoiceMandateApplies } from "./scope";
import {
  deriveInvoiceTracks,
  isReportingObservation,
  type DeliveryStatus,
  type ReportingStatus,
} from "./tracks";
import { invoiceReportingRequired } from "./reporting";

export interface CompliancePill {
  invoiceId: string;
  reportBy: string | null;
  overdue: boolean;
  reportingRequired: boolean;
  delivery: DeliveryStatus;
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
  | "reportingStatus"
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
      invoice: {
        id: invoices.id,
        date: invoices.date,
        status: invoices.status,
        customerTrn: invoices.customerTrn,
        einvoiceStatus: invoices.einvoiceStatus,
        einvoiceProvider: invoices.einvoiceProvider,
      },
      doc: einvoiceDocuments,
      linkedBuyerTrn: customerContacts.trnNumber,
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
    .where(
      and(
        eq(invoices.companyId, company.id),
        invoiceIds ? inArray(invoices.id, invoiceIds) : undefined
      )
    )
    .orderBy(desc(invoices.date));
  const items: CompliancePill[] = [];
  const documents: DocumentEvidence[] = [];
  for (const { invoice, doc, linkedBuyerTrn } of rows) {
    const status = String(invoice.status ?? "").toLowerCase();
    const required = documentReportingRequired(
      doc,
      invoiceReportingRequired(
        invoice,
        company,
        doc?.submittedAt ?? now,
        invoice.customerTrn || linkedBuyerTrn
      )
    );
    const t = deriveInvoiceTracks({
      invoiceDate: invoice.date,
      invoiceStatus: invoice.status,
      legacyStatus: invoice.einvoiceStatus,
      provider: invoice.einvoiceProvider,
      doc,
      required,
      now,
    });
    if (invoiceIds && doc) {
      const {
        invoiceId,
        status,
        provider,
        providerStatus,
        environment,
        providerMessageId,
        deliveryStatus,
        reportingStatus,
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
        reportingStatus,
        reportBy,
      });
    }
    if (status === "draft" || status === "void" || status === "cancelled") continue;
    if (!mandateApplies && !required && !isReportingObservation(t.reporting)) continue;
    items.push({
      invoiceId: invoice.id,
      reportBy: t.reportBy,
      overdue: t.overdue,
      reportingRequired: t.reportingRequired,
      delivery: t.delivery,
      reporting: t.reporting,
    });
  }
  return { mandateApplies, items, ...(invoiceIds ? { documents } : {}) };
}
