/**
 * The per-invoice e-invoice status the UI renders (E1): two tracks, report-by date, missing
 * fields, the rejection state, the finalize checklist (posted · validated · sent · reported) and
 * the history. Every state is real: "sent" is never shown without a provider document id, and
 * with no provider connected the checklist says "blocked: no e-invoicing provider connected".
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  journalEntries,
  type Company,
  type EInvoiceDocument,
  type Invoice,
} from "../../../shared/schema";
import { storage } from "../../storage";
import { validateForEInvoicing } from "../einvoice.service";
import { loadEInvoiceContext } from "./context";
import {
  documentProviderEnvironment,
  documentSubmissionMetadata,
  documentValidation,
  getEInvoiceDocument,
  isQueuedEInvoiceDocument,
  sha256Hex,
  submissionProviderPin,
} from "./store";
import { listDocumentEvents } from "./history";
import { getLegalEntity } from "./legal-entities";
import {
  canRetryOriginalRejectedNumber,
  correctableComplyanceReference,
  inspectComplyanceRevision,
  legacyTrackingAvailability,
  legacyTrackingReference,
  needsLegacySubmissionRecovery,
} from "./legacy-tracking";
import {
  conflictingProviderReceipt,
  deriveInvoiceTracks,
  isReportingObservation,
  NEW_DOCUMENT_REQUIRED_CODES,
  projectEInvoiceLegacyStatus,
  projectRecipientDeliveryEvidence,
  providerRecipientAcknowledgement,
  reportingEvidenceAt,
} from "./tracks";
import { einvoiceMandateApplies } from "./scope";
import { canRecoverAcubeSubmission } from "./workflow";
import { projectInvoiceTracks } from "./reporting";
import { companyProviderConfiguration } from "./providers/company-provider";
import { providerModule } from "./providers/registry";

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
  | "provider_selection_changed"
  | "legal_entity_not_active"
  | "legal_entity_delinked"
  | null;

const iso = (d: Date | string | null | undefined) =>
  d ? (typeof d === "string" ? d : d.toISOString()) : null;

export function projectEInvoiceDocument(
  doc: EInvoiceDocument,
  tracks: ReturnType<typeof deriveInvoiceTracks>
) {
  const status =
    isQueuedEInvoiceDocument(doc) ||
    (doc.status === "failed" && doc.nextRetryAt && !doc.providerMessageId)
      ? "queued"
      : projectEInvoiceLegacyStatus(doc.provider, doc.providerStatus, doc.status, tracks.reporting);
  const pinned = documentProviderEnvironment(doc);
  return {
    ...doc,
    status,
    environment: pinned === "sandbox" || pinned === "production" ? pinned : null,
    deliveryStatus: tracks.delivery,
    deliveryStatusAt: tracks.delivery === doc.deliveryStatus ? doc.deliveryStatusAt : null,
    deliveryConfirmationUnavailable: tracks.deliveryConfirmationUnavailable,
    reportingStatus: tracks.reporting,
    reportingRequired: tracks.reportingRequired,
    reportingObligationKnown: tracks.reportingObligationKnown,
    reportingStatusAt: tracks.reporting === doc.reportingStatus ? doc.reportingStatusAt : null,
    clearedAt: status === "cleared" && tracks.reporting === "reported" ? doc.clearedAt : null,
    reportedAt: tracks.reporting === "reported" ? doc.reportedAt : null,
    reportBy: tracks.reportBy,
    validation: documentValidation(doc),
  };
}

export async function einvoiceStatusView(invoice: Invoice, company: Company, now = new Date()) {
  const doc = await getEInvoiceDocument(company.id, invoice.id);
  const revision = await inspectComplyanceRevision(invoice, doc);
  const correctionRevisionUnverified = revision.unresolved;
  const events = await listDocumentEvents(company.id, invoice.id, 100);
  const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
  const ctx = await loadEInvoiceContext(invoice, company, lines);
  const issues = validateForEInvoicing(invoice, lines, company, ctx);
  const receiptConflict = conflictingProviderReceipt(invoice, doc);
  const providerDocumentId = receiptConflict
    ? null
    : (invoice.einvoiceProviderMessageId ??
      legacyTrackingReference(invoice, doc)?.messageId ??
      null);
  const handedOver = !!providerDocumentId;
  const providerHoldsDocument = handedOver || receiptConflict || !!doc?.providerMessageId;
  const correctableComplyance = !!correctableComplyanceReference(invoice, doc);
  const legacyRecovery = needsLegacySubmissionRecovery(invoice, doc);
  const pinnedEnvironment = documentProviderEnvironment(doc);
  const tracksProvider = legacyRecovery || submissionProviderPin(invoice, doc) !== undefined;
  const providerId = tracksProvider
    ? (doc?.provider ?? invoice.einvoiceProvider ?? null)
    : company.einvoicePartner;
  const module = providerModule(providerId);
  const environment = tracksProvider
    ? pinnedEnvironment
    : (module?.environment(process.env) ?? null);
  const configuration = environment
    ? await companyProviderConfiguration(company.id, providerId, { environment })
    : null;
  const isAcube = providerId === "acube";
  const providerStatus = doc?.providerStatus?.trim().toLowerCase();
  const tracks = projectInvoiceTracks(invoice, doc, company, now, ctx.customer?.trn);
  const {
    delivery,
    reporting,
    reportBy,
    overdue,
    reportingRequired: required,
    reportingObligationKnown,
  } = tracks;
  const legacy = projectEInvoiceLegacyStatus(
    providerId,
    providerStatus,
    invoice.einvoiceStatus,
    reporting
  );
  const sentToRecipient = handedOver && delivery === "delivered";
  const acknowledgement = sentToRecipient
    ? providerRecipientAcknowledgement(providerId, providerStatus)
    : null;
  const receivedByRecipient = acknowledgement === "received";
  const recipientAccepted = acknowledgement === "accepted";
  const retryScheduled = !providerHoldsDocument && !!doc?.nextRetryAt;

  // A handed-off invoice can be tracked through its own credentials after a company switches
  // providers or delinks its legal entity. New submissions still require the selected connection.
  const legalEntity = configuration
    ? ((await getLegalEntity(company.id, configuration.module.id, configuration.environment)) ??
      null)
    : null;
  let block: TransmissionBlock = null;
  if (!handedOver && tracksProvider && company.einvoicePartner !== providerId)
    block = "provider_selection_changed";
  else if (!configuration) block = environment === "mock" ? "test_provider" : "no_provider";
  else if (legalEntity?.status === "inactive") block = "legal_entity_delinked";
  else if (legalEntity?.status !== "active") block = "legal_entity_not_active";

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

  const validation = documentValidation(doc) as { valid?: boolean } | null;
  const submissionState =
    legacyRecovery || correctionRevisionUnverified || receiptConflict
      ? "needs_reconciliation"
      : delivery === "rejected" || reporting === "report_failed"
        ? "rejected"
        : delivery === "needs_link"
          ? "needs_reconciliation"
          : delivery === "delivery_failed" && !retryScheduled
            ? "failed"
            : recipientAccepted || (sentToRecipient && !isAcube && providerId !== "complyance")
              ? "accepted"
              : handedOver
                ? "sent"
                : legacy === "queued" || retryScheduled
                  ? "queued"
                  : "draft";
  const issued = !["draft", "cancelled", "void"].includes(invoice.status);
  const maySubmit = issued && block === null && company.einvoicePartner === providerId;
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
        delivery === "delivered" && !receivedByRecipient
          ? "done"
          : delivery === "queued" ||
              delivery === "sending" ||
              delivery === "needs_link" ||
              receivedByRecipient
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
  const rejectionEnvironment =
    pinnedEnvironment === "production" || pinnedEnvironment === "sandbox"
      ? pinnedEnvironment
      : null;
  const submission = documentSubmissionMetadata(doc);
  const creditNoteRequired =
    rejectionEnvironment === "production" &&
    delivery === "rejected" &&
    !correctionRevisionUnverified &&
    invoice.invoiceType !== "credit_note" &&
    doc?.provider === "complyance" &&
    invoice.einvoiceProvider === doc.provider &&
    !!doc.providerMessageId &&
    doc.providerMessageId === invoice.einvoiceProviderMessageId &&
    doc.lastErrorCode === "COMPLYANCE_FINAL_INVALID" &&
    providerStatus === "final_invalid" &&
    !!(submission?.scope || submission?.environmentVerifiedAt) &&
    !!invoice.einvoiceXml &&
    !!doc.xmlHash &&
    doc.xmlHash === invoice.einvoiceHash &&
    doc.xmlHash === sha256Hex(invoice.einvoiceXml);
  return {
    status: legacy,
    submissionState,
    detail: invoice.einvoiceStatusDetail ?? null,
    document: doc ? projectEInvoiceDocument(doc, tracks) : null,
    tracks: {
      delivery: {
        status: delivery,
        at: delivery === doc?.deliveryStatus ? iso(doc.deliveryStatusAt) : null,
        confirmationUnavailable: tracks.deliveryConfirmationUnavailable,
      },
      reporting: {
        status: reporting,
        at: reporting === doc?.reportingStatus ? iso(doc.reportingStatusAt) : null,
        required,
        obligationKnown: reportingObligationKnown,
        confirmationUnavailable: handedOver && isAcube && reporting === "pending",
        reportBy,
        overdue,
        mandateApplies: einvoiceMandateApplies(company, now),
      },
    },
    transmission: {
      correctionRevisionUnverified,
      provider: providerId,
      providerDisplayName: module?.displayName ?? null,
      environment,
      environmentVerification: await legacyTrackingAvailability(invoice, doc, company, revision),
      connected: block === null,
      block,
      providerDocumentId,
      legalEntityStatus: legalEntity?.status ?? null,
      recipientAcknowledgement: acknowledgement,
      canSubmit: maySubmit && submissionState === "draft" && !legacyRecovery,
      canRefresh:
        !receiptConflict &&
        !correctionRevisionUnverified &&
        configuration !== null &&
        ((handedOver && (legacy !== "cleared" || revision.canRepairClearance)) ||
          (!legacyRecovery && canRecoverAcubeSubmission(invoice, doc))),
    },
    issues,
    contactId: invoice.contactId ?? null,
    rejection: failed
      ? {
          environment: rejectionEnvironment,
          creditNoteRequired,
          code: doc?.lastErrorCode ?? null,
          message: doc?.lastError ?? invoice.einvoiceStatusDetail ?? null,
          reasons: (doc?.rejectionReasons as unknown[] | null) ?? [],
          providerHoldsDocument,
          providerDisplayName: providerModule(doc?.provider)?.displayName ?? null,
          retryScheduledAt: iso(doc?.nextRetryAt),
          // A rejected document needs a corrected one; a delivery failure can be resent as is.
          // E2: after a final rejection the number is used up at some providers.
          resubmittable:
            maySubmit &&
            ["rejected", "delivery_failed"].includes(delivery) &&
            issues.length === 0 &&
            !doc?.nextRetryAt &&
            (!providerHoldsDocument || correctableComplyance) &&
            !legacyRecovery &&
            (providerId !== "acube" ||
              doc?.status !== "rejected" ||
              canRetryOriginalRejectedNumber(invoice, doc)) &&
            !NEW_DOCUMENT_REQUIRED_CODES.has(doc?.lastErrorCode ?? ""),
          newDocumentRequired: NEW_DOCUMENT_REQUIRED_CODES.has(doc?.lastErrorCode ?? ""),
        }
      : null,
    checklist,
    events: events.map((e) => {
      const eventProvider = e.provider ?? providerId;
      const unconfirmed = (outcome: string | null) => {
        if (e.track !== "reporting" || !isReportingObservation(outcome)) return false;
        if (eventProvider === "acube") return outcome === "reported";
        if (eventProvider !== "complyance") return false;
        const confirmedAt = reportingEvidenceAt(doc?.validation, outcome);
        return !confirmedAt || e.createdAt.getTime() < Date.parse(confirmedAt);
      };
      const receipt =
        e.track === "delivery" && e.toStatus === "delivered"
          ? projectRecipientDeliveryEvidence(eventProvider, e.providerStatus, providerDocumentId)
          : null;
      const unconfirmedReporting = unconfirmed(e.toStatus);
      const confirmationUnavailable = unconfirmedReporting || receipt?.confirmationUnavailable;
      const to = unconfirmedReporting ? "pending" : (receipt?.status ?? e.toStatus);
      return {
        id: e.id,
        track: e.track,
        from: unconfirmed(e.fromStatus) ? "pending" : e.fromStatus,
        to,
        recipientAcknowledgement:
          e.track === "delivery" && to === "delivered"
            ? providerRecipientAcknowledgement(eventProvider, e.providerStatus)
            : null,
        ...(confirmationUnavailable ? { confirmationUnavailable } : {}),
        code: confirmationUnavailable ? null : e.code,
        message: confirmationUnavailable ? null : e.message,
        source: e.source,
        provider: e.provider,
        environment: e.provider && e.provider === doc?.provider ? pinnedEnvironment : null,
        providerStatus: e.providerStatus,
        at: iso(e.createdAt),
      };
    }),
  };
}
