/**
 * E1: shapes and status vocabulary for the e-invoice UI (mirrors
 * server/services/einvoice/status-view.ts and tracks.ts). Labels are locale keys in the
 * "einvoicing" namespace; tones follow the CTO colour semantics (green done, blue with the
 * provider, amber needs action, red failed, neutral not started / not applicable).
 */
import type { StatusTone } from "@/components/ui/status-badge";

export type DeliveryStatus =
  | "draft"
  | "validated"
  | "queued"
  | "sending"
  | "delivered"
  | "delivery_failed"
  | "rejected";
export type ReportingStatus = "not_required" | "pending" | "reported" | "report_failed";
export type ChecklistState =
  | "done"
  | "in_progress"
  | "failed"
  | "blocked"
  | "not_applicable"
  | "todo";
export type TransmissionBlock =
  | "no_provider"
  | "test_provider"
  | "legal_entity_not_active"
  | "legal_entity_delinked"
  | null;

export interface EInvoiceIssue {
  field: string;
  message: string;
}

export interface EInvoiceEvent {
  id: string;
  track: "validation" | "delivery" | "reporting";
  from: string | null;
  to: string;
  code: string | null;
  message: string | null;
  source: "user" | "webhook" | "poll" | "job" | "system";
  providerStatus: string | null;
  at: string | null;
}

export interface EInvoiceStatusView {
  status: string;
  detail: string | null;
  tracks: {
    delivery: { status: DeliveryStatus; at: string | null };
    reporting: {
      status: ReportingStatus;
      at: string | null;
      required: boolean;
      reportBy: string | null;
      overdue: boolean;
    };
  };
  transmission: {
    provider: string | null;
    environment: string | null;
    connected: boolean;
    block: TransmissionBlock;
    providerDocumentId: string | null;
    legalEntityStatus: string | null;
  };
  issues: EInvoiceIssue[];
  rejection: {
    code: string | null;
    message: string | null;
    reasons: Array<{ code?: string; message?: string; field?: string | null }>;
    retryScheduledAt: string | null;
    resubmittable: boolean;
  } | null;
  checklist: Array<{
    key: "posted" | "validated" | "sent" | "reported";
    state: ChecklistState;
    at: string | null;
    code: string | null;
  }>;
  events: EInvoiceEvent[];
}

/** Row of GET /api/companies/:id/einvoicing/documents (list badges). */
export interface EInvoiceDocumentRow {
  invoiceId: string;
  status: string;
  deliveryStatus: DeliveryStatus | null;
  reportingStatus: ReportingStatus | null;
  reportBy: string | null;
}

export const DELIVERY_TONE: Record<DeliveryStatus, StatusTone> = {
  draft: "neutral",
  validated: "neutral",
  queued: "info",
  sending: "info",
  delivered: "success",
  delivery_failed: "danger",
  rejected: "danger",
};

export const REPORTING_TONE: Record<ReportingStatus, StatusTone> = {
  not_required: "neutral",
  pending: "warning",
  reported: "success",
  report_failed: "danger",
};

export const deliveryLabelKey = (s: DeliveryStatus) => `einvoicing.delivery_${s}`;
export const reportingLabelKey = (s: ReportingStatus) => `einvoicing.reporting_${s}`;
export const checklistLabelKey = (k: string) => `einvoicing.check_${k}`;
export const checklistStateKey = (s: ChecklistState) => `einvoicing.checkState_${s}`;
export const blockKey = (b: Exclude<TransmissionBlock, null>) => `einvoicing.block_${b}`;
export const sourceKey = (s: string) => `einvoicing.source_${s}`;

const KNOWN_ERRORS = new Set([
  "EINVOICE_PROVIDER_NOT_CONFIGURED",
  "EINVOICE_LEGAL_ENTITY_NOT_ACTIVE",
  "EINVOICE_LEGAL_ENTITY_DELINKED",
  "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH",
  "EINVOICE_VALIDATION_FAILED",
  "EINVOICE_CANCELLED",
  "ACUBE_VALIDATION",
  "ACUBE_BAD_REQUEST",
  "ACUBE_LEGAL_ENTITY_NOT_FOUND",
  "ACUBE_AUTH_FAILED",
  "ACUBE_UNAVAILABLE",
  "ACUBE_SENDING_FAILED",
  "ACUBE_DELIVERY_FAILED",
  "ACUBE_ACTION_REQUIRED",
  "ACUBE_REJECTED",
  "ACUBE_WITHDRAWN",
  "ACUBE_UNKNOWN_STATUS",
  "ACUBE_NO_DOCUMENT_ID",
  "TRANSPORT_ERROR",
  "EINVOICE_REPORT_FAILED",
]);

/** Locale key for an error code, or null when the code has no localised text. */
export function errorKey(code: string | null | undefined): string | null {
  return code && KNOWN_ERRORS.has(code) ? `einvoicing.err_${code}` : null;
}

/** Delivery track for a document stored before the two-track columns existed. */
export function deliveryFromLegacyStatus(status: string | null | undefined): DeliveryStatus {
  switch (status) {
    case "generated":
      return "validated";
    case "submitted":
      return "queued";
    case "accepted":
    case "cleared":
      return "delivered";
    case "rejected":
    case "cancelled":
      return "rejected";
    case "failed":
      return "delivery_failed";
    default:
      return "draft";
  }
}

/** The overall state the compact list cell shows. */
export function listTone(delivery: DeliveryStatus, reporting: ReportingStatus): StatusTone {
  if (delivery === "rejected" || delivery === "delivery_failed" || reporting === "report_failed") {
    return "danger";
  }
  return DELIVERY_TONE[delivery];
}

/** Map a validation issue's field ("company.addressCity") to a readable label key. */
export function fieldLabelKey(field: string): string | null {
  const known: Record<string, string> = {
    "company.trnVatNumber": "einvoicing.field_companyTrn",
    "company.addressCity": "einvoicing.field_companyCity",
    "company.addressStreet": "einvoicing.field_companyStreet",
    "company.emirate": "einvoicing.field_companyEmirate",
    "company.tradeLicenceNo": "einvoicing.field_companyTradeLicence",
    "company.name": "einvoicing.field_companyName",
    "customer.address": "einvoicing.field_customerAddress",
    "invoice.customerName": "einvoicing.field_customerName",
    "invoice.customerTrn": "einvoicing.field_customerTrn",
    "invoice.currency": "einvoicing.field_currency",
    "invoice.date": "einvoicing.field_date",
    "invoice.dueDate": "einvoicing.field_dueDate",
    "invoice.number": "einvoicing.field_number",
    "invoice.originalInvoiceId": "einvoicing.field_originalInvoice",
    "invoice.subtotal": "einvoicing.field_totals",
    "invoice.total": "einvoicing.field_totals",
    "invoice.vatAmount": "einvoicing.field_totals",
    lines: "einvoicing.field_lines",
  };
  if (known[field]) return known[field];
  if (/^lines\[\d+\]/.test(field)) return "einvoicing.field_lines";
  if (field.startsWith("document.")) return "einvoicing.field_document";
  return null;
}

/** One-line rejection reason for the header strip: the first provider reason (with its field or
 * rule), else the localised error code, else the stored message. `code`/`field` are returned so the
 * caller can render them as LTR isolates. */
export function rejectionSummary(rejection: EInvoiceStatusView["rejection"]): {
  message: string | null;
  field: string | null;
  rule: string | null;
  errorCode: string | null;
} | null {
  if (!rejection) return null;
  const first = rejection.reasons.find((r) => r.message || r.field || r.code);
  return {
    message: first?.message ?? rejection.message ?? null,
    field: first?.field ?? null,
    rule: first?.code ?? null,
    errorCode: rejection.code,
  };
}
