/**
 * Two-track e-invoice status (E1).
 *
 * UAE e-invoicing has two independent outcomes per document, and A-Cube's docs say to keep them
 * apart: "A document may be delivered while tax reporting is still processing, or one of the two
 * operations may fail independently."
 *
 *   Delivery  (corner 2 -> 3 -> 4, Peppol):  draft -> validated -> queued -> sending -> delivered
 *                                            | delivery_failed | rejected
 *   Reporting (corner 2 -> 5, FTA):          pending -> reported | report_failed, or not_required
 *
 * The legacy single `einvoice_status` (einvoice-status.ts) is still written for older readers and
 * the retry job; it is derived from the two tracks with `legacyFromTracks`.
 */
import type { EInvoiceStatus } from "../einvoice-status";

export type DeliveryStatus =
  | "draft"
  | "validated"
  | "queued"
  | "sending"
  | "delivered"
  | "delivery_failed"
  | "rejected"
  // X6a: an ambiguous transport error, then the ASP said it already holds this number without
  // naming the document. It may well have been delivered and reported: never shown as rejected,
  // never sent again; a person links the provider's document.
  | "needs_link";

export type ReportingStatus = "not_required" | "pending" | "reported" | "report_failed";
export type ReportingObservation = "reported" | "report_failed";

export const DELIVERY_STATUSES: DeliveryStatus[] = [
  "draft",
  "validated",
  "queued",
  "sending",
  "delivered",
  "delivery_failed",
  "rejected",
  "needs_link",
];
export const REPORTING_STATUSES: ReportingStatus[] = [
  "not_required",
  "pending",
  "reported",
  "report_failed",
];

export const isDeliveryStatus = (s: unknown): s is DeliveryStatus =>
  typeof s === "string" && (DELIVERY_STATUSES as string[]).includes(s);
export const isReportingStatus = (s: unknown): s is ReportingStatus =>
  typeof s === "string" && (REPORTING_STATUSES as string[]).includes(s);

export function isReportingObservation(status: unknown): status is ReportingObservation {
  return status === "reported" || status === "report_failed";
}

export function reportingEvidenceAt(
  validation: unknown,
  outcome: ReportingObservation
): string | null {
  const value = validation as {
    submission?: { reportingEvidence?: Partial<Record<ReportingObservation, unknown>> };
  } | null;
  const observedAt = value?.submission?.reportingEvidence?.[outcome];
  return typeof observedAt === "string" && !Number.isNaN(Date.parse(observedAt))
    ? observedAt
    : null;
}

/** The old Complyance projection inferred reporting outcomes without storing their proof. */
export function storedReportingEvidence(
  doc:
    | { provider?: string | null; reportingStatus?: string | null; validation?: unknown }
    | null
    | undefined,
  provider = doc?.provider
): ReportingObservation | null {
  const status = doc?.reportingStatus;
  return isReportingObservation(status) &&
    !(provider === "acube" && status === "reported") &&
    (provider !== "complyance" || reportingEvidenceAt(doc?.validation, status))
    ? status
    : null;
}

/** Delivery states in which the ASP holds the document (no new submission). */
export function isDeliveryInFlight(s: string | null | undefined): boolean {
  return s === "queued" || s === "sending" || s === "delivered" || s === "needs_link";
}

export function deliveryFromLegacy(status: string | null | undefined): DeliveryStatus {
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

/** The obligation supplies a fallback only when the provider has not confirmed an outcome. */
export function reportingFromEvidence(
  provider: string | null | undefined,
  required: boolean,
  ...observations: Array<string | null | undefined>
): ReportingStatus {
  for (const status of observations) {
    // A-Cube's prior reported snapshots established TDD availability only.
    if (status === "report_failed" || (status === "reported" && provider !== "acube"))
      return status;
  }
  return required ? "pending" : "not_required";
}

/** Correct historical statuses that treated a receipt or the availability of a TDD as final. */
export function projectEInvoiceLegacyStatus<T extends string>(
  provider: string | null | undefined,
  providerStatus: string | null | undefined,
  status: T | null | undefined,
  reportingStatus?: string | null
): T | "not_generated" | "submitted" | "accepted" {
  const stored = status ?? "not_generated";
  if (stored !== "accepted" && stored !== "cleared") return stored;
  const observed = providerStatus?.trim().toLowerCase();
  if (provider === "acube") {
    return observed === "accepted" ? "accepted" : "submitted";
  }
  if (provider === "complyance") {
    if (observed === "delivery_success") return "submitted";
  }
  if (stored === "cleared" && reportingStatus !== "reported") return "accepted";
  return stored;
}

/**
 * The two tracks and the report-by deadline of one invoice, derived from its stored e-invoice
 * document (if any), its legacy status and whether FTA reporting is required. Shared by the
 * per-invoice status view and the invoice-list compliance pills so both always agree (X6d).
 */
export function deriveInvoiceTracks(args: {
  invoiceDate: Date | string | null | undefined;
  invoiceStatus: string | null | undefined;
  legacyStatus: string | null | undefined;
  provider?: string | null;
  doc: {
    provider?: string | null;
    providerStatus?: string | null;
    deliveryStatus?: string | null;
    reportingStatus?: string | null;
    validation?: unknown;
    reportBy?: string | null;
  } | null;
  required: boolean;
  now?: Date;
}): {
  delivery: DeliveryStatus;
  reporting: ReportingStatus;
  reportingRequired: boolean;
  isDraft: boolean;
  reportBy: string | null;
  overdue: boolean;
} {
  const now = args.now ?? new Date();
  const { doc, required } = args;
  const provider = doc?.provider ?? args.provider;
  const providerStatus = doc?.providerStatus?.trim().toLowerCase();
  const reporting = reportingFromEvidence(
    provider,
    required,
    storedReportingEvidence(doc, provider)
  );
  const legacy = projectEInvoiceLegacyStatus(
    provider,
    providerStatus,
    args.legacyStatus,
    reporting
  );
  let delivery: DeliveryStatus = isDeliveryStatus(doc?.deliveryStatus)
    ? doc.deliveryStatus
    : deliveryFromLegacy(legacy);
  if (provider === "acube" && delivery === "delivered") {
    if (providerStatus === "processed") delivery = "sending";
    else if (providerStatus !== "accepted" && providerStatus !== "delivered") delivery = "queued";
  }
  const isDraft = String(args.invoiceStatus ?? "").toLowerCase() === "draft";
  // No deadline unless the mandate applies to this company; a draft has no deadline either.
  const reportBy = required && !isDraft ? (doc?.reportBy ?? reportByDate(args.invoiceDate)) : null;
  const today = now.toISOString().slice(0, 10);
  return {
    delivery,
    reporting,
    reportingRequired: required,
    isDraft,
    reportBy,
    overdue: !isDraft && !!reportBy && reporting === "pending" && reportBy < today,
  };
}

/** The legacy single status for a pair of tracks. */
export function legacyFromTracks(
  delivery: DeliveryStatus,
  reporting: ReportingStatus
): EInvoiceStatus {
  switch (delivery) {
    case "draft":
      return "not_generated";
    case "validated":
      return "generated";
    case "queued":
    case "sending":
      return "submitted";
    case "delivered":
      return reporting === "reported" ? "cleared" : "accepted";
    case "delivery_failed":
      return "failed";
    case "rejected":
      return "rejected";
    case "needs_link":
      // Possibly held by the ASP: in flight for legacy readers (not retried, not resubmitted).
      return "submitted";
  }
}

/** A-Cube reports recipient receipt before the recipient's final MLS decision. */
export function legacyFromProviderTracks(
  provider: string,
  providerStatus: string | null | undefined,
  delivery: DeliveryStatus,
  reporting: ReportingStatus
): EInvoiceStatus {
  if (delivery === "delivered") {
    return projectEInvoiceLegacyStatus(
      provider,
      providerStatus,
      legacyFromTracks(delivery, reporting),
      reporting
    );
  }
  return legacyFromTracks(delivery, reporting);
}

/**
 * A-Cube's lifecycle treats Peppol handover and provider-managed retries as in flight.
 * `delivered` identifies recipient receipt. The subsequent `accepted` or `rejected` is the MLS.
 * https://docs.acubeapi.com/documentation/gov-ae/documents/lifecycle
 */
export function mapAcubeDeliveryStatus(raw: unknown): DeliveryStatus {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  switch (s) {
    case "new":
    case "valid":
    case "sending_queued":
      return "queued";
    case "sending_started":
    case "processed":
    case "sending_failed":
    case "delivery_failed":
      return "sending";
    case "delivered":
    case "accepted":
      return "delivered";
    case "rejected":
    case "withdrawn":
      return "rejected";
    case "sending_error":
    case "delivery_error":
    case "action_required":
      return "delivery_failed";
    default:
      return "delivery_failed";
  }
}

/** Stable error code for a provider delivery status that is a failure, else null. */
export function acubeStatusErrorCode(raw: unknown): string | null {
  const s = String(raw ?? "").toLowerCase();
  if (s === "sending_error" || s === "sending_failed") return "ACUBE_SENDING_FAILED";
  if (s === "delivery_error" || s === "delivery_failed") return "ACUBE_DELIVERY_FAILED";
  if (s === "action_required") return "ACUBE_ACTION_REQUIRED";
  if (s === "rejected") return "ACUBE_REJECTED";
  if (s === "withdrawn") return "ACUBE_WITHDRAWN";
  if (mapAcubeDeliveryStatus(s) === "delivery_failed") return "ACUBE_UNKNOWN_STATUS";
  return null;
}

/**
 * Must this invoice be reported to the FTA? B2C supplies (no buyer TRN) are out of scope of the
 * UAE mandate's first phases, and a company that set its scope to "none" reports nothing.
 */
export function reportingRequired(args: {
  customerTrn?: string | null;
  companyScope?: string | null;
  /**
   * Does the e-invoicing mandate actually apply to this company yet (go-live reached for its
   * scope/band, or an explicit opt-in go-live date that has been reached)? Defaults to true for
   * callers that only test the buyer/scope rules; invoice-level callers must pass it.
   */
  mandateApplies?: boolean;
}): boolean {
  if (args.mandateApplies === false) return false;
  if (args.companyScope === "none") return false;
  return !!args.customerTrn && /^\d{15}$/.test(args.customerTrn.trim());
}

/**
 * Reporting window in days after the invoice date. ASSUMPTION (documented in
 * docs/einvoicing-acube.md): 14 days unless EINVOICE_REPORT_WINDOW_DAYS says otherwise; confirm
 * against the FTA's published procedure and A-Cube before go-live.
 */
export function reportWindowDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EINVOICE_REPORT_WINDOW_DAYS);
  return Number.isInteger(n) && n > 0 && n <= 90 ? n : 14;
}

export function reportByDate(
  issueDate: Date | string | null | undefined,
  days: number = reportWindowDays()
): string | null {
  if (!issueDate) return null;
  const d = typeof issueDate === "string" ? new Date(issueDate) : issueDate;
  if (Number.isNaN(d.getTime())) return null;
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
  return out.toISOString().slice(0, 10);
}

/** Error codes the UI localises (client/src/locales/{en,ar}/einvoicing.json "einvoicing.err.*"). */
export const EINVOICE_ERROR_CODES = [
  "EINVOICE_PROVIDER_NOT_CONFIGURED",
  "EINVOICE_LEGAL_ENTITY_NOT_ACTIVE",
  "EINVOICE_LEGAL_ENTITY_DELINKED",
  "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH",
  // X6a: provider-neutral fallbacks when a provider gives no code of its own.
  "EINVOICE_VALIDATION",
  "EINVOICE_DELIVERY_FAILED",
  "EINVOICE_NEEDS_LINK",
  "ACUBE_VALIDATION",
  "ACUBE_BAD_REQUEST",
  "ACUBE_LEGAL_ENTITY_NOT_FOUND",
  "ACUBE_AUTH_FAILED",
  "ACUBE_UNAVAILABLE",
  "ACUBE_RATE_LIMITED",
  "ACUBE_SENDING_FAILED",
  "ACUBE_DELIVERY_FAILED",
  "ACUBE_ACTION_REQUIRED",
  "ACUBE_REJECTED",
  "ACUBE_WITHDRAWN",
  "ACUBE_UNKNOWN_STATUS",
  "ACUBE_NO_DOCUMENT_ID",
  "TRANSPORT_ERROR",
  "EINVOICE_REPORT_FAILED",
  // E2: Complyance (providers/complyance.ts)
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
] as const;
export type EInvoiceErrorCode = (typeof EINVOICE_ERROR_CODES)[number];

/**
 * E2: outcomes after which the same document number can never be sent again (Complyance refuses a
 * used number with GETS-HEAD-010): the fix is a credit note and a new invoice, not "resubmit".
 */
export const NEW_DOCUMENT_REQUIRED_CODES: ReadonlySet<string> = new Set([
  "COMPLYANCE_FINAL_INVALID",
  "COMPLYANCE_DUPLICATE_NUMBER",
]);
