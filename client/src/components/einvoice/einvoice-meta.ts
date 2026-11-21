/**
 * E1: shapes and status vocabulary for the e-invoice UI (mirrors
 * server/services/einvoice/status-view.ts and tracks.ts). Labels are locale keys in the
 * "einvoicing" namespace; tones follow the CTO colour semantics (green done, blue with the
 * provider, amber needs action, red failed, neutral not started / not applicable).
 */
import type { StatusTone } from "@/components/ui/status-badge";
import { einvoiceIssueTextKey } from "@/lib/einvoice-issues";

export type DeliveryStatus =
  | "draft"
  | "validated"
  | "queued"
  | "sending"
  | "delivered"
  | "delivery_failed"
  | "rejected"
  /** X6a: the provider may hold it after a lost response; a person links it (never resent). */
  | "needs_link";
export type ReportingStatus = "not_required" | "pending" | "reported" | "report_failed";
export type RecipientAcknowledgement = "received" | "accepted" | null;
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
  | "provider_selection_changed"
  | "legal_entity_not_active"
  | "legal_entity_delinked"
  | null;

export interface EInvoiceIssue {
  field: string;
  message: string;
  /** Stable server code (e.g. EINVOICE_BUYER_ENDPOINT_MISSING) with its own localised fix text. */
  code?: string;
}

/** Issue codes the UI explains in the user's language instead of the English validator text. */
const ISSUE_TEXT_KEYS: Record<string, string> = {
  EINVOICE_BUYER_ENDPOINT_MISSING: "einvoicing.issue_buyerEndpointMissing",
  EINVOICE_BUYER_ADDRESS_MISSING: "einvoicing.issue_buyerAddressMissing",
};

export function issueTextKey(code: string | undefined): string | null {
  return code ? (ISSUE_TEXT_KEYS[code] ?? einvoiceIssueTextKey(code)) : null;
}

export interface EInvoiceEvent {
  id: string;
  track: "validation" | "delivery" | "reporting";
  from: string | null;
  to: string;
  confirmationUnavailable?: boolean;
  code: string | null;
  message: string | null;
  source: "user" | "webhook" | "poll" | "job" | "system";
  provider: string | null;
  providerStatus: string | null;
  at: string | null;
}

export interface EInvoiceStatusView {
  status: string;
  submissionState?:
    | "draft"
    | "queued"
    | "sent"
    | "accepted"
    | "rejected"
    | "failed"
    | "needs_reconciliation";
  detail: string | null;
  contactId: string | null;
  tracks: {
    delivery: { status: DeliveryStatus; at: string | null };
    reporting: {
      status: ReportingStatus;
      at: string | null;
      required: boolean;
      confirmationUnavailable?: boolean;
      mandateApplies?: boolean;
      reportBy: string | null;
      overdue: boolean;
    };
  };
  transmission: {
    provider: string | null;
    /** E2: the provider's brand name ("A-Cube", "Complyance"). */
    providerDisplayName?: string | null;
    environment: string | null;
    connected: boolean;
    block: TransmissionBlock;
    providerDocumentId: string | null;
    legalEntityStatus: string | null;
    recipientAcknowledgement: RecipientAcknowledgement;
    canSubmit: boolean;
    canRefresh: boolean;
  };
  issues: EInvoiceIssue[];
  rejection: {
    code: string | null;
    message: string | null;
    reasons: Array<{ code?: string; message?: string; field?: string | null }>;
    retryScheduledAt: string | null;
    resubmittable: boolean;
    providerHoldsDocument?: boolean;
    providerDisplayName?: string | null;
    /** E2: the number is used up at the provider: credit note + new invoice. */
    newDocumentRequired?: boolean;
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
  provider: string | null;
  providerStatus: string | null;
  providerMessageId: string | null;
  deliveryStatus: DeliveryStatus | null;
  reportingStatus: ReportingStatus | null;
  reportBy: string | null;
}

/** Row of GET /api/companies/:id/einvoicing/compliance (invoice-list pills, X6d). */
export interface EInvoiceCompliancePill {
  invoiceId: string;
  reportBy: string | null;
  overdue: boolean;
  reportingRequired: boolean;
  delivery: DeliveryStatus;
  reporting: ReportingStatus;
}

/** GET /api/companies/:id/einvoicing/readiness (X6d). */
export interface EInvoiceReadiness {
  mandate: {
    scope: string | null;
    band: string | null;
    goLiveDate: string | null;
    appointAspBy: string | null;
    daysToGoLive: number | null;
    mandatory: boolean;
    source: "override" | "band" | "unset";
  };
  transmission: {
    enabled: boolean;
    provider: string | null;
    environment: string | null;
    reason: "no_provider" | "test_provider" | "legal_entity_not_active" | null;
  };
  items: Array<{
    key: "scope" | "supplier_identity" | "customer_details" | "product_codes" | "provider";
    status: "done" | "todo";
    count: number;
    total: number;
    samples: string[];
    rules: string[];
    fixHref: string;
  }>;
  done: number;
  total: number;
}

export const DELIVERY_TONE: Record<DeliveryStatus, StatusTone> = {
  draft: "neutral",
  validated: "neutral",
  queued: "info",
  sending: "info",
  delivered: "success",
  delivery_failed: "danger",
  rejected: "danger",
  needs_link: "warning",
};

export const REPORTING_TONE: Record<ReportingStatus, StatusTone> = {
  not_required: "neutral",
  pending: "warning",
  reported: "success",
  report_failed: "danger",
};

export const deliveryLabelKey = (
  s: DeliveryStatus,
  queuedForSubmission = false,
  acknowledgement: RecipientAcknowledgement = null
) =>
  acknowledgement === "accepted"
    ? "einvoicing.recipientAccepted"
    : acknowledgement === "received"
      ? "einvoicing.recipientReceived"
      : queuedForSubmission
        ? "einvoicing.submissionQueued"
        : `einvoicing.delivery_${s}`;

export function recipientAcknowledgement(
  provider: string | null | undefined,
  status: string | null | undefined
): RecipientAcknowledgement {
  const rawStatus = status?.trim().toLowerCase();
  if (provider === "acube") {
    return rawStatus === "accepted" ? "accepted" : rawStatus === "delivered" ? "received" : null;
  }
  if (provider === "complyance") {
    return rawStatus === "final_valid"
      ? "accepted"
      : rawStatus === "delivery_success"
        ? "received"
        : null;
  }
  return null;
}
export const reportingLabelKey = (s: ReportingStatus, confirmationUnavailable = false) =>
  confirmationUnavailable ? "einvoicing.reportingUnconfirmed" : `einvoicing.reporting_${s}`;

export function isReportingOnlyFailure(delivery: DeliveryStatus, reporting: ReportingStatus) {
  return reporting === "report_failed" && delivery !== "rejected" && delivery !== "delivery_failed";
}

export const checklistLabelKey = (k: string) => `einvoicing.check_${k}`;
export const checklistStateKey = (s: ChecklistState) => `einvoicing.checkState_${s}`;
export const blockKey = (b: Exclude<TransmissionBlock, null>) => `einvoicing.block_${b}`;
export const sourceKey = (s: string) => `einvoicing.source_${s}`;

const KNOWN_ERRORS = new Set([
  "EINVOICE_PROVIDER_NOT_CONFIGURED",
  "EINVOICE_RETRY_PROVIDER_CHANGED",
  "EINVOICE_LEGAL_ENTITY_NOT_ACTIVE",
  "EINVOICE_LEGAL_ENTITY_DELINKED",
  "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH",
  "EINVOICE_VALIDATION_FAILED",
  "EINVOICE_CANCELLED",
  // X6a: provider-neutral fallbacks when a provider gives no code of its own.
  "EINVOICE_VALIDATION",
  "EINVOICE_DELIVERY_FAILED",
  "EINVOICE_NEEDS_LINK",
  "ACUBE_VALIDATION",
  "ACUBE_BAD_REQUEST",
  "ACUBE_LEGAL_ENTITY_NOT_FOUND",
  "ACUBE_AUTH_FAILED",
  "ACUBE_RATE_LIMITED",
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
  // E2: Complyance
  "COMPLYANCE_VALIDATION",
  "COMPLYANCE_DUPLICATE_NUMBER",
  "COMPLYANCE_XML_FAILED",
  "COMPLYANCE_BAD_REQUEST",
  "COMPLYANCE_SOURCE_NOT_FOUND",
  "COMPLYANCE_SOURCE_AMBIGUOUS",
  "COMPLYANCE_SOURCE_MISSING",
  "COMPLYANCE_MAPPING_NOT_READY",
  "COMPLYANCE_AUTH_FAILED",
  "COMPLYANCE_RATE_LIMITED",
  "COMPLYANCE_UNAVAILABLE",
  "COMPLYANCE_NO_DOCUMENT_ID",
  "COMPLYANCE_DELIVERY_FAILED",
  "COMPLYANCE_FINAL_INVALID",
  "COMPLYANCE_UNKNOWN_STATE",
  "EINVOICE_NEW_DOCUMENT_REQUIRED",
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
    case "queued":
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
    "company.einvoiceTin": "einvoicing.field_supplierTin",
    "company.einvoicePayeeIban": "einvoicing.field_payeeIban",
    "company.sellerIdCountry": "einvoicing.field_passportCountry",
    "customer.address": "einvoicing.field_customerAddress",
    "customer.legalIdCountry": "einvoicing.field_passportCountry",
    "invoice.customerName": "einvoicing.field_customerName",
    "invoice.customerTrn": "einvoicing.field_customerTrn",
    "customer.endpointId": "einvoicing.field_customerEndpoint",
    "invoice.currency": "einvoicing.field_currency",
    "invoice.exchangeRate": "einvoicing.field_exchangeRate",
    "invoice.date": "einvoicing.field_date",
    "invoice.supplyDate": "einvoicing.field_supplyDate",
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
