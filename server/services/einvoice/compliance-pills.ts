/**
 * X6d: per-invoice compliance pills for the invoice list. One row per issued (non-draft,
 * non-void) invoice with its report-by date and the two tracks, derived with the same
 * `deriveInvoiceTracks` the status view uses. Returns no rows unless the e-invoicing mandate
 * applies to the company (scope chosen and go-live reached), so a company outside scope sees
 * nothing. Transmission is separate: with no provider connected nothing is "sent".
 */
import type { Company } from "../../../shared/schema";
import { storage } from "../../storage";
import { listEInvoiceDocuments } from "./store";
import { einvoiceMandateApplies } from "./scope";
import { deriveInvoiceTracks, type DeliveryStatus, type ReportingStatus } from "./tracks";
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
  if (!mandateApplies) return { mandateApplies, items: [] };
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
    const required = invoiceReportingRequired(invoice, company, now);
    const t = deriveInvoiceTracks({
      invoiceDate: invoice.date,
      invoiceStatus: invoice.status,
      legacyStatus: invoice.einvoiceStatus,
      provider: invoice.einvoiceProvider,
      doc,
      required,
      now,
    });
    items.push({
      invoiceId: invoice.id,
      reportBy: t.reportBy,
      overdue: t.overdue,
      reportingRequired: required,
      delivery: t.delivery,
      reporting: t.reporting,
    });
  }
  return { mandateApplies, items };
}
