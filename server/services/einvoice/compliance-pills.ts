/**
 * X6d: per-invoice compliance pills for the invoice list. One row per issued (non-draft,
 * non-void) invoice with its report-by date and the two tracks, derived with the same
 * `deriveInvoiceTracks` the status view uses. Established obligations and observed outcomes stay
 * visible after company settings change. Other rows appear when the company is in scope.
 */
import type { Company } from "../../../shared/schema";
import { storage } from "../../storage";
import { documentReportingRequired, listEInvoiceDocuments } from "./store";
import { einvoiceMandateApplies } from "./scope";
import {
  deriveInvoiceTracks,
  isReportingObservation,
  type DeliveryStatus,
  type ReportingStatus,
} from "./tracks";
import { invoiceReportingRequired } from "./workflow";

export interface CompliancePill {
  invoiceId: string;
  reportBy: string | null;
  overdue: boolean;
  reportingRequired: boolean;
  delivery: DeliveryStatus;
  reporting: ReportingStatus;
}

export async function listCompliancePills(
  company: Company,
  now = new Date()
): Promise<{ mandateApplies: boolean; items: CompliancePill[] }> {
  const mandateApplies = einvoiceMandateApplies(company, now);
  const [invoices, docs] = await Promise.all([
    storage.getInvoicesByCompanyId(company.id),
    listEInvoiceDocuments(company.id, 500),
  ]);
  const byInvoice = new Map(docs.map((d) => [d.invoiceId, d]));
  const items: CompliancePill[] = [];
  for (const invoice of invoices) {
    const status = String(invoice.status ?? "").toLowerCase();
    if (status === "draft" || status === "void" || status === "cancelled") continue;
    const doc = byInvoice.get(invoice.id) ?? null;
    const required = documentReportingRequired(
      doc,
      invoiceReportingRequired(invoice, company, now)
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
  return { mandateApplies, items };
}
