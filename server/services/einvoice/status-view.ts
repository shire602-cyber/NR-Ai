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
import { validateForEInvoicing } from "../einvoice.service";
import { loadEInvoiceContext } from "./context";
import {
  documentProviderEnvironment,
  documentValidation,
  getEInvoiceDocument,
  isQueuedEInvoiceDocument,
  submissionProviderPin,
} from "./store";
import { listDocumentEvents } from "./history";
import { getLegalEntity } from "./legal-entities";
import { deriveInvoiceTracks, NEW_DOCUMENT_REQUIRED_CODES } from "./tracks";
import { einvoiceMandateApplies } from "./scope";
import { invoiceReportingRequired } from "./workflow";
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

export async function einvoiceStatusView(invoice: Invoice, company: Company, now = new Date()) {
  const doc = await getEInvoiceDocument(company.id, invoice.id);
  const events = await listDocumentEvents(company.id, invoice.id, 100);
  const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
  const ctx = await loadEInvoiceContext(invoice, company, lines);
  const issues = validateForEInvoicing(invoice, lines, company, ctx);
  const required = invoiceReportingRequired(invoice, company, now);
  const providerDocumentId = invoice.einvoiceProviderMessageId ?? null;
  const handedOver = !!providerDocumentId;
  const providerHoldsDocument = handedOver || !!doc?.providerMessageId;
  const pinnedEnvironment = documentProviderEnvironment(doc);
  const tracksProvider = submissionProviderPin(invoice, doc) !== undefined;
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
  const acubeAccepted = handedOver && isAcube && providerStatus === "accepted";
  const receivedByRecipient = handedOver && isAcube && providerStatus === "delivered";
  const storedStatus = invoice.einvoiceStatus ?? "not_generated";
  const legacy =
    handedOver && isAcube && (storedStatus === "accepted" || storedStatus === "cleared")
      ? acubeAccepted
        ? "accepted"
        : "submitted"
      : storedStatus;

  const { delivery, reporting, reportBy, overdue } = deriveInvoiceTracks({
    invoiceDate: invoice.date,
    invoiceStatus: invoice.status,
    legacyStatus: legacy,
    doc: doc
      ? {
          deliveryStatus:
            isAcube && doc.deliveryStatus === "delivered" && !acubeAccepted && !receivedByRecipient
              ? "queued"
              : doc.deliveryStatus,
          // Older A-Cube rows inferred FTA reporting from a downloadable TDD, which is not an
          // authoritative reporting outcome. A-Cube's publication provides no such signal here.
          reportingStatus:
            isAcube && doc.reportingStatus === "reported"
              ? required
                ? "pending"
                : "not_required"
              : doc.reportingStatus,
          reportBy: doc.reportBy as string | null | undefined,
        }
      : null,
    required,
    now,
  });

  // A handed-off invoice can be tracked through its own credentials after a company switches
  // providers or delinks its legal entity. New submissions still require the selected connection.
  const legalEntity = configuration
    ? ((await getLegalEntity(company.id, configuration.module.id, configuration.environment)) ??
      null)
    : null;
  let block: TransmissionBlock = null;
  if (!configuration) block = environment === "mock" ? "test_provider" : "no_provider";
  else if (!handedOver && tracksProvider && company.einvoicePartner !== providerId)
    block = "provider_selection_changed";
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
    delivery === "rejected" || reporting === "report_failed"
      ? "rejected"
      : delivery === "needs_link"
        ? "needs_reconciliation"
        : handedOver && (isAcube ? acubeAccepted : delivery === "delivered")
          ? "accepted"
          : handedOver
            ? "sent"
            : legacy === "queued" || doc?.nextRetryAt
              ? "queued"
              : delivery === "delivery_failed"
                ? "failed"
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
  return {
    status: legacy,
    submissionState,
    detail: invoice.einvoiceStatusDetail ?? null,
    document: doc
      ? {
          ...doc,
          status: isQueuedEInvoiceDocument(doc)
            ? "queued"
            : isAcube && (doc.status === "accepted" || doc.status === "cleared")
              ? legacy
              : doc.status,
          reportingStatus: reporting,
          ...(reporting !== "reported" && isAcube ? { reportedAt: null } : null),
          validation,
        }
      : null,
    tracks: {
      delivery: { status: delivery, at: iso(doc?.deliveryStatusAt) },
      reporting: {
        status: reporting,
        at: reporting === doc?.reportingStatus ? iso(doc.reportingStatusAt) : null,
        required,
        confirmationUnavailable: handedOver && isAcube && reporting === "pending",
        reportBy,
        overdue,
        mandateApplies: einvoiceMandateApplies(company, now),
      },
    },
    transmission: {
      provider: providerId,
      providerDisplayName: module?.displayName ?? null,
      environment,
      connected: block === null,
      block,
      providerDocumentId,
      legalEntityStatus: legalEntity?.status ?? null,
      recipientAcknowledgement: acubeAccepted
        ? "accepted"
        : receivedByRecipient
          ? "received"
          : null,
      canSubmit: maySubmit && submissionState === "draft",
      canRefresh: handedOver && configuration !== null && legacy !== "cleared",
    },
    issues,
    contactId: invoice.contactId ?? null,
    rejection: failed
      ? {
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
            !providerHoldsDocument &&
            !NEW_DOCUMENT_REQUIRED_CODES.has(doc?.lastErrorCode ?? ""),
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
      provider: e.provider,
      providerStatus: e.providerStatus,
      at: iso(e.createdAt),
    })),
  };
}
