/**
 * The per-invoice e-invoice status the UI renders (E1): two tracks, report-by date, missing
 * fields, the rejection state, the finalize checklist (posted · validated · sent · reported) and
 * the history. Every state is real: "sent" is never shown without a provider document id, and
 * with no provider connected the checklist says "blocked: no e-invoicing provider connected".
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { journalEntries, type Company, type Invoice } from "../../../shared/schema";
import { storage } from "../../storage";
import { getEInvoiceProvider, type EInvoiceProvider } from "../einvoice-provider";
import { validateForEInvoicing } from "../einvoice.service";
import { loadEInvoiceContext } from "./context";
import { getEInvoiceDocument } from "./store";
import { listDocumentEvents } from "./history";
import { getLegalEntity } from "./legal-entities";
import {
  deliveryFromLegacy,
  isDeliveryStatus,
  isReportingStatus,
  NEW_DOCUMENT_REQUIRED_CODES,
  reportByDate,
  reportingFromLegacy,
  type DeliveryStatus,
  type ReportingStatus,
} from "./tracks";
import { einvoiceMandateApplies } from "./scope";
import { invoiceReportingRequired, providerRequiresLegalEntity } from "./workflow";

export type ChecklistState =
  | "done"
  | "in_progress"
  | "failed"
  | "blocked"
  | "not_applicable"
  | "todo";

export interface ChecklistItem {
  key: "posted" | "validated" | "sent" | "reported";
  state: ChecklistState;
  at: string | null;
  code: string | null;
}

export type TransmissionBlock =
  | "no_provider"
  | "test_provider"
  | "legal_entity_not_active"
  | "legal_entity_delinked"
  | null;

const iso = (d: Date | string | null | undefined) =>
  d ? (typeof d === "string" ? d : d.toISOString()) : null;

function providerOrNull(): EInvoiceProvider | null {
  try {
    return getEInvoiceProvider();
  } catch {
    return null;
  }
}

export async function einvoiceStatusView(invoice: Invoice, company: Company, now = new Date()) {
  const doc = await getEInvoiceDocument(company.id, invoice.id);
  const events = await listDocumentEvents(company.id, invoice.id, 100);
  const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
  const ctx = await loadEInvoiceContext(invoice, company, lines);
  const issues = validateForEInvoicing(invoice, lines, company, ctx);
  const required = invoiceReportingRequired(invoice, company, now);
  const legacy = invoice.einvoiceStatus ?? "not_generated";

  const delivery: DeliveryStatus = isDeliveryStatus(doc?.deliveryStatus)
    ? doc.deliveryStatus
    : deliveryFromLegacy(legacy);
  const storedReporting: ReportingStatus = isReportingStatus(doc?.reportingStatus)
    ? doc.reportingStatus
    : reportingFromLegacy(legacy, required);
  // A "pending" report that is not (yet) required is not a pending obligation.
  const reporting: ReportingStatus =
    !required && storedReporting === "pending" ? "not_required" : storedReporting;
  const isDraft = String(invoice.status ?? "").toLowerCase() === "draft";
  // No deadline unless the mandate applies to this company; a draft has no deadline either.
  const reportBy =
    required && !isDraft
      ? ((doc?.reportBy as string | null | undefined) ?? reportByDate(invoice.date))
      : null;
  const today = now.toISOString().slice(0, 10);

  // Transmission: who would send this, and is anything stopping it?
  const provider = providerOrNull();
  let block: TransmissionBlock = null;
  let legalEntity = null;
  if (!provider) block = "no_provider";
  else if (provider.environment === "mock") block = "test_provider";
  else if (providerRequiresLegalEntity(provider)) {
    legalEntity = (await getLegalEntity(company.id, provider.name, provider.environment)) ?? null;
    if (legalEntity?.status === "inactive") block = "legal_entity_delinked";
    else if (legalEntity?.status !== "active") block = "legal_entity_not_active";
  }

  const [posted] = await db
    .select({
      id: journalEntries.id,
      number: journalEntries.entryNumber,
      date: journalEntries.date,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, company.id),
        eq(journalEntries.source, "invoice"),
        eq(journalEntries.sourceId, invoice.id),
        eq(journalEntries.status, "posted")
      )
    )
    .limit(1);

  const validation = doc?.validation as { valid?: boolean } | null | undefined;
  const handedOver = !!invoice.einvoiceProviderMessageId;
  const checklist: ChecklistItem[] = [
    {
      key: "posted",
      state: posted ? "done" : invoice.status === "void" ? "failed" : "todo",
      at: posted ? iso(posted.date) : null,
      code: invoice.status === "void" ? "INVOICE_VOID" : null,
    },
    {
      key: "validated",
      state:
        issues.length > 0
          ? "failed"
          : validation?.valid
            ? "done"
            : validation && validation.valid === false
              ? "failed"
              : "todo",
      at: validation?.valid ? iso(doc?.validatedAt) : null,
      code: issues.length > 0 ? "EINVOICE_VALIDATION_FAILED" : null,
    },
    {
      key: "sent",
      state:
        delivery === "delivered"
          ? "done"
          : delivery === "queued" || delivery === "sending" || delivery === "needs_link"
            ? "in_progress"
            : delivery === "delivery_failed" || delivery === "rejected"
              ? "failed"
              : block
                ? "blocked"
                : "todo",
      at: delivery === "delivered" ? iso(doc?.deliveredAt) : iso(doc?.submittedAt),
      code:
        delivery === "delivery_failed" || delivery === "rejected" || delivery === "needs_link"
          ? (doc?.lastErrorCode ?? null)
          : block,
    },
    {
      key: "reported",
      state:
        reporting === "not_required"
          ? "not_applicable"
          : reporting === "reported"
            ? "done"
            : reporting === "report_failed"
              ? "failed"
              : handedOver &&
                  (delivery === "delivered" || delivery === "queued" || delivery === "sending")
                ? "in_progress"
                : block
                  ? "blocked"
                  : "todo",
      at: reporting === "reported" ? iso(doc?.reportedAt) : null,
      code: reporting === "report_failed" ? (doc?.lastErrorCode ?? null) : block,
    },
  ];

  const failed =
    delivery === "rejected" || delivery === "delivery_failed" || reporting === "report_failed";
  return {
    status: legacy,
    detail: invoice.einvoiceStatusDetail ?? null,
    document: doc ?? null,
    tracks: {
      delivery: { status: delivery, at: iso(doc?.deliveryStatusAt) },
      reporting: {
        status: reporting,
        at: iso(doc?.reportingStatusAt),
        required,
        reportBy,
        overdue: !isDraft && !!reportBy && reporting === "pending" && reportBy < today,
        mandateApplies: einvoiceMandateApplies(company, now),
      },
    },
    transmission: {
      provider: provider?.name ?? null,
      providerDisplayName: provider?.displayName ?? null,
      environment: provider?.environment ?? null,
      connected: block === null,
      block,
      providerDocumentId: invoice.einvoiceProviderMessageId ?? null,
      legalEntityStatus: legalEntity?.status ?? null,
    },
    issues,
    rejection: failed
      ? {
          code: doc?.lastErrorCode ?? null,
          message: doc?.lastError ?? invoice.einvoiceStatusDetail ?? null,
          reasons: (doc?.rejectionReasons as unknown[] | null) ?? [],
          retryScheduledAt: iso(doc?.nextRetryAt),
          // A rejected document needs a corrected one; a delivery failure can be resent as is.
          // E2: after a final rejection the number is used up at some providers.
          resubmittable:
            issues.length === 0 && !NEW_DOCUMENT_REQUIRED_CODES.has(doc?.lastErrorCode ?? ""),
          newDocumentRequired: NEW_DOCUMENT_REQUIRED_CODES.has(doc?.lastErrorCode ?? ""),
        }
      : null,
    checklist,
    events: events.map((e) => ({
      id: e.id,
      track: e.track,
      from: e.fromStatus,
      to: e.toStatus,
      code: e.code,
      message: e.message,
      source: e.source,
      providerStatus: e.providerStatus,
      at: iso(e.createdAt),
    })),
  };
}
