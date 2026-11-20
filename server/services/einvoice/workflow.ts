/**
 * Persisted e-invoice workflow: submit / refresh / cancel with the
 * einvoice_documents row, the legacy invoice columns and the archive kept in
 * step. Shared by the HTTP routes and the "einvoice.retry" background job.
 *
 * E1: every outcome is also written as two tracks (delivery, FTA reporting) with history
 * (history.ts); a provider that needs a linked legal entity (A-Cube) is gated on it; a
 * submission is claimed first so two requests never hand the same invoice to the ASP twice.
 */
import { and, eq } from "drizzle-orm";
import {
  companies,
  invoiceLines,
  invoices,
  type Company,
  type EInvoiceDocument,
  type Invoice,
} from "../../../shared/schema";
import { db } from "../../db";
import { createLogger } from "../../config/logger";
import { DomainError } from "../../errors";
import { recordAudit } from "../audit.service";
import type {
  EInvoiceProvider,
  EInvoiceProviderResult,
  EInvoiceSubmission,
} from "../einvoice-provider";
import { getCompanyEInvoiceProvider } from "./providers/company-provider";
import {
  cancelEInvoice,
  prepareEInvoiceSubmission,
  refreshEInvoiceStatus,
  submittedEInvoiceOutcome,
  type EInvoiceUpdate,
  type PreparedSubmission,
  type SubmitErr,
} from "../einvoice-submit.service";
import {
  canTransitionEInvoice,
  EINVOICE_MAX_ATTEMPTS,
  isEInvoiceInFlight,
  nextRetryAt,
} from "../einvoice-status";
import { loadEInvoiceContext } from "./context";
import {
  archiveEInvoiceXml,
  documentSubmissionMetadata,
  documentValidation,
  dueEInvoiceRetries,
  getEInvoiceDocument,
  isQueuedEInvoiceDocument,
  lockEInvoiceInvoice,
  sha256Hex,
  SUBMISSION_LEASE_MS,
  upsertEInvoiceDocument,
  type EInvoiceDb,
} from "./store";
import { applyTracks, recordValidationEvent, type HistorySource } from "./history";
import {
  deliveryFromLegacy,
  legacyFromTracks,
  NEW_DOCUMENT_REQUIRED_CODES,
  reportByDate,
  reportingRequired,
  type DeliveryStatus,
  type ReportingStatus,
} from "./tracks";
import { einvoiceMandateApplies } from "./scope";
import { assertLegalEntityCanSend, companyTin, getLegalEntity } from "./legal-entities";
import { PEPPOL_SCHEME_UAE_TIN } from "./pint-ae-codes";

const log = createLogger("einvoice-workflow");

type CompanyExtras = Company & {
  peppolScheme?: string | null;
  peppolParticipantId?: string | null;
  einvoiceScope?: string | null;
};

/** Does this provider only transmit for a linked legal entity (A-Cube, Complyance)? */
export function providerRequiresLegalEntity(provider: EInvoiceProvider): boolean {
  return provider.requiresLegalEntity === true;
}

/** Whether this invoice must be reported to the FTA (B2B/B2G with a buyer TRN). */
export function invoiceReportingRequired(
  invoice: Invoice,
  company: Company,
  now: Date = new Date()
): boolean {
  return reportingRequired({
    customerTrn: invoice.customerTrn,
    companyScope: (company as CompanyExtras).einvoiceScope ?? null,
    mandateApplies: einvoiceMandateApplies(company as CompanyExtras, now),
  });
}

/**
 * E1 gate (A-Cube; E2 Complyance): the company's legal entity must be active, and the supplier
 * EndpointID we generate (scheme 0235 + TIN) must be the one the provider linked, or it cannot
 * route it (Complyance answers AE-PEPPOL-008 for the same mismatch).
 */
async function assertCanTransmit(
  company: CompanyExtras,
  provider: EInvoiceProvider,
  tx: EInvoiceDb
) {
  if (!providerRequiresLegalEntity(provider)) return;
  const le = await getLegalEntity(company.id, provider.name, provider.environment, tx);
  const displayName = provider.displayName ?? provider.name;
  assertLegalEntityCanSend(le, displayName);
  const scheme = company.peppolScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const tin = companyTin(company);
  if (scheme !== PEPPOL_SCHEME_UAE_TIN || tin !== le?.tin) {
    throw new DomainError(
      "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH",
      422,
      { expected: `${PEPPOL_SCHEME_UAE_TIN}:${le?.tin ?? ""}`, actual: `${scheme}:${tin ?? ""}` },
      `The supplier e-invoicing address on the invoice does not match the TIN linked at ${displayName}.`
    );
  }
}

const AMBIGUOUS_CODES: ReadonlySet<string> = new Set([
  "TRANSPORT_ERROR",
  "ACUBE_UNAVAILABLE",
  "ACUBE_NO_DOCUMENT_ID",
  "COMPLYANCE_UNAVAILABLE",
  "COMPLYANCE_NO_DOCUMENT_ID",
]);

const RETRYABLE_BEFORE_HANDOFF: ReadonlySet<string> = new Set([
  "ACUBE_AUTH_FAILED",
  "ACUBE_RATE_LIMITED",
  "COMPLYANCE_AUTH_FAILED",
  "COMPLYANCE_RATE_LIMITED",
]);

function needsLink(): EInvoiceProviderResult {
  return {
    providerMessageId: "",
    status: "submitted",
    delivery: "needs_link",
    reporting: "pending",
    errorCode: "EINVOICE_NEEDS_LINK",
  };
}

function transportFailure(): EInvoiceProviderResult {
  return {
    providerMessageId: "",
    status: "failed",
    delivery: "delivery_failed",
    errorCode: "TRANSPORT_ERROR",
    detail: "The service provider could not be reached.",
  };
}

type QueueArgs = {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  now?: Date;
  source?: HistorySource;
  regenerate?: boolean;
  actorId?: string | null;
};

type QueueResult =
  | {
      ok: true;
      documentRow: EInvoiceDocument;
      update: { einvoiceStatus: "queued" };
      providerMessageId: null;
    }
  | SubmitErr;

function queued(documentRow: EInvoiceDocument): QueueResult {
  return {
    ok: true,
    documentRow,
    update: { einvoiceStatus: "queued" },
    providerMessageId: null,
  };
}

async function updateInvoiceInTransaction(
  tx: EInvoiceDb,
  invoice: Pick<Invoice, "id" | "companyId">,
  patch: EInvoiceUpdate
) {
  await tx
    .update(invoices)
    .set(patch)
    .where(and(eq(invoices.companyId, invoice.companyId), eq(invoices.id, invoice.id)));
}

/** Validate and freeze the XML, audit history and provider together before reporting it queued. */
export async function enqueueEInvoiceSubmission(args: QueueArgs): Promise<QueueResult> {
  const { provider } = args;
  const now = args.now ?? new Date();
  const source = args.source ?? "user";
  return db.transaction(async (tx) => {
    const fresh = await lockEInvoiceInvoice(args.company.id, args.invoice.id, tx);
    if (!fresh) return { ok: false, status: 404, code: "NOT_FOUND", message: "Invoice not found." };
    const [company] = await tx.select().from(companies).where(eq(companies.id, fresh.companyId));
    if (!company)
      return { ok: false, status: 404, code: "NOT_FOUND", message: "Company not found." };
    const existing = await getEInvoiceDocument(company.id, fresh.id, tx);

    if (
      existing &&
      (isQueuedEInvoiceDocument(existing) || (existing.status === "failed" && existing.nextRetryAt))
    ) {
      return queued(existing);
    }
    if (NEW_DOCUMENT_REQUIRED_CODES.has(existing?.lastErrorCode ?? "")) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_NEW_DOCUMENT_REQUIRED",
        message: "This invoice number cannot be sent again. Issue a credit note and a new invoice.",
      };
    }
    if (
      existing?.deliveryStatus === "needs_link" ||
      (existing?.status === "failed" && existing.providerMessageId)
    ) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_ALREADY_SUBMITTED",
        message: "Check or link the existing service provider document before sending it again.",
      };
    }
    if (providerRequiresLegalEntity(provider) && company.einvoicePartner !== provider.name) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        message: "Select a service provider for this company before submitting.",
      };
    }
    await assertCanTransmit(company, provider, tx);
    const current = fresh.einvoiceStatus ?? "not_generated";
    const regenerate =
      providerRequiresLegalEntity(provider) ||
      args.regenerate ||
      current === "rejected" ||
      current === "failed";
    const invoice =
      regenerate && !isEInvoiceInFlight(current)
        ? { ...fresh, einvoiceXml: null, einvoiceHash: null }
        : fresh;
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id));
    const ctx = await loadEInvoiceContext(invoice, company, lines, tx);
    const built = await prepareEInvoiceSubmission({
      invoice,
      lines,
      company,
      ctx,
      now,
    });
    if (!built.ok) {
      if (built.validation && !existing?.provider) {
        await upsertEInvoiceDocument(
          company.id,
          invoice.id,
          {
            status: existing?.status ?? "generated",
            validation: built.validation,
            validatedAt: now,
          },
          tx
        );
      }
      if (built.validation || built.issues) {
        await recordValidationEvent(
          company.id,
          invoice.id,
          false,
          { source, message: built.message, now },
          tx
        );
      }
      return built;
    }

    const required = invoiceReportingRequired(invoice, company, now);
    await updateInvoiceInTransaction(tx, invoice, {
      einvoiceUuid: built.uuid,
      einvoiceXml: built.xml,
      einvoiceHash: built.hash,
      einvoiceStatus: "queued",
      einvoiceProvider: provider.name,
      einvoiceProviderMessageId: null,
      einvoiceSubmittedAt: null,
      einvoiceStatusDetail: null,
    });
    await recordValidationEvent(company.id, invoice.id, true, { source, now }, tx);
    const doc = await applyTracks(
      company.id,
      invoice.id,
      {
        delivery: "queued",
        reporting: required ? "pending" : "not_required",
        providerStatus: null,
        errorCode: null,
        reportBy: required ? reportByDate(invoice.date) : null,
      },
      {
        source,
        provider: provider.name,
        now,
        recordDelivery: true,
        document: {
          status: "generated",
          attempts: 0,
          clearedAt: null,
          deliveredAt: null,
          reportedAt: null,
          submittedAt: null,
          lastError: null,
          nextRetryAt: now,
          rejectionReasons: null,
          provider: provider.name,
          providerMessageId: null,
          documentType: built.documentType,
          uuid: built.uuid,
          xmlHash: built.hash,
          validation: {
            ...built.validation,
            submission: {
              environment: provider.environment,
              invoiceNumber: invoice.number,
              supplierTin: companyTin(company),
            },
          },
          validatedAt: now,
          submitClaimedAt: null,
        },
      },
      tx
    );
    if (args.actorId) {
      await recordAudit({
        userId: args.actorId,
        companyId: company.id,
        action: args.regenerate ? "invoice.einvoice_resubmit" : "invoice.einvoice_submit",
        entityType: "invoice",
        entityId: invoice.id,
        after: { provider: provider.name, environment: provider.environment, status: "queued" },
        tx,
      });
    }
    return queued(doc);
  });
}

function eligibleSubmission(doc: EInvoiceDocument | undefined, now: Date): doc is EInvoiceDocument {
  return (
    !!doc &&
    (doc.status === "generated" || doc.status === "failed") &&
    !!doc.nextRetryAt &&
    doc.nextRetryAt <= now &&
    (!doc.submitClaimedAt || doc.submitClaimedAt.getTime() <= now.getTime() - SUBMISSION_LEASE_MS)
  );
}

async function claimQueuedSubmission(
  candidate: EInvoiceDocument,
  provider: EInvoiceProvider,
  now: Date,
  scope: string | null
) {
  return db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(candidate.companyId, candidate.invoiceId, tx);
    if (!invoice) return null;
    const doc = await getEInvoiceDocument(invoice.companyId, invoice.id, tx);
    if (!eligibleSubmission(doc, now)) return null;
    const metadata = documentSubmissionMetadata(doc);
    if (
      doc.provider !== provider.name ||
      (metadata && metadata.environment !== provider.environment)
    )
      return null;
    const validation = documentValidation(doc) as PreparedSubmission["validation"] | null;
    if (
      !validation ||
      !invoice.einvoiceXml ||
      !doc.uuid ||
      !doc.xmlHash ||
      doc.uuid !== invoice.einvoiceUuid ||
      doc.xmlHash !== invoice.einvoiceHash ||
      doc.xmlHash !== sha256Hex(invoice.einvoiceXml)
    ) {
      await stopQueuedSubmission(tx, invoice, "EINVOICE_SCHEMA_INVALID", now);
      return null;
    }
    const ambiguous = !!doc.submitClaimedAt || AMBIGUOUS_CODES.has(doc.lastErrorCode ?? "");
    const unissued =
      invoice.status === "void" || invoice.status === "draft" || invoice.status === "cancelled";
    if (unissued && !ambiguous) {
      await stopQueuedSubmission(
        tx,
        invoice,
        invoice.status === "draft" ? "EINVOICE_INVOICE_NOT_ISSUED" : "EINVOICE_INVOICE_VOID",
        now
      );
      return null;
    }

    const [company] = await tx.select().from(companies).where(eq(companies.id, invoice.companyId));
    if (!company) return null;
    const selected =
      !unissued &&
      (!providerRequiresLegalEntity(provider) ||
        (company.einvoicePartner === provider.name &&
          invoice.number === metadata?.invoiceNumber &&
          companyTin(company) === metadata?.supplierTin));
    if (!selected && !ambiguous) {
      await stopQueuedSubmission(tx, invoice, "EINVOICE_PROVIDER_NOT_CONFIGURED", now);
      return null;
    }
    if (selected && !ambiguous) await assertCanTransmit(company, provider, tx);
    const pinnedScope = ambiguous ? (metadata?.scope ?? null) : scope;

    await applyTracks(
      invoice.companyId,
      invoice.id,
      { delivery: "sending" },
      {
        source: "job",
        provider: provider.name,
        now,
        recordDelivery: true,
        document: {
          attempts: doc.attempts + 1,
          submitClaimedAt: now,
          validation: {
            ...validation,
            submission: {
              environment: provider.environment,
              invoiceNumber: metadata?.invoiceNumber ?? invoice.number,
              supplierTin: metadata?.supplierTin ?? companyTin(company),
              scope: pinnedScope,
            },
          },
        },
      },
      tx
    );
    return {
      invoice,
      company,
      selected,
      doc,
      ambiguous,
      canReplay: !!pinnedScope && pinnedScope === scope,
      scope: pinnedScope,
      invoiceNumber: metadata?.invoiceNumber ?? invoice.number,
      built: {
        ok: true,
        xml: invoice.einvoiceXml,
        uuid: doc.uuid,
        hash: doc.xmlHash,
        documentType: doc.documentType,
        validation,
      } satisfies PreparedSubmission,
    };
  });
}

async function stopQueuedSubmission(tx: EInvoiceDb, invoice: Invoice, code: string, now: Date) {
  await applyTracks(
    invoice.companyId,
    invoice.id,
    { delivery: "delivery_failed", errorCode: code },
    {
      source: "job",
      now,
      document: { status: "failed", nextRetryAt: null, submitClaimedAt: null },
    },
    tx
  );
  await updateInvoiceInTransaction(tx, invoice, { einvoiceStatus: "failed" });
}

async function sendQueuedSubmission(
  claim: NonNullable<Awaited<ReturnType<typeof claimQueuedSubmission>>>,
  provider: EInvoiceProvider,
  now: Date
): Promise<EInvoiceProviderResult> {
  const { invoice, company, built } = claim;
  const submission: EInvoiceSubmission = {
    invoiceId: invoice.id,
    companyId: company.id,
    invoiceNumber: claim.invoiceNumber,
    uuid: built.uuid,
    xml: built.xml,
    documentType: built.documentType ?? undefined,
    scopeFingerprint: claim.scope ?? undefined,
  };
  if (claim.ambiguous && provider.lookupSubmission) {
    const found = await provider.lookupSubmission(submission).catch(() => null);
    if (found?.providerMessageId) return found;
    // An incomplete search cannot establish that A-Cube did not receive the first request.
    if (provider.name === "acube") {
      return nextRetryAt(claim.doc.attempts + 1, now) ? transportFailure() : needsLink();
    }
  }
  const knownProvider = providerRequiresLegalEntity(provider);
  if (
    !claim.selected ||
    (claim.ambiguous &&
      knownProvider &&
      (!claim.canReplay || claim.doc.attempts >= EINVOICE_MAX_ATTEMPTS))
  ) {
    return needsLink();
  }

  const result = await provider.submit(submission).catch(transportFailure);
  if (result.numberAlreadyHeld) return needsLink();
  if (result.providerMessageId) return result;
  if (claim.ambiguous && knownProvider) {
    // A later failed replay says nothing about whether the original request was accepted.
    const retryable =
      AMBIGUOUS_CODES.has(result.errorCode ?? "") ||
      RETRYABLE_BEFORE_HANDOFF.has(result.errorCode ?? "");
    return retryable && nextRetryAt(claim.doc.attempts + 1, now) ? transportFailure() : needsLink();
  }
  if (result.status !== "failed" && result.status !== "rejected") return transportFailure();
  if (
    AMBIGUOUS_CODES.has(result.errorCode ?? "") &&
    !nextRetryAt(claim.doc.attempts + 1, now) &&
    knownProvider
  )
    return needsLink();
  return result;
}

async function processQueuedSubmission(
  candidate: EInvoiceDocument,
  provider: EInvoiceProvider,
  now: Date
) {
  const scope = (await provider.getSubmissionScope?.(candidate.companyId)) ?? null;
  const claim = await claimQueuedSubmission(candidate, provider, now, scope);
  if (!claim) return null;
  const r = await sendQueuedSubmission(claim, provider, now);
  const { invoice, company, built, doc: before } = claim;
  const result = submittedEInvoiceOutcome(built, provider, r, before.attempts, now);
  const required = before.reportingStatus === "pending" || before.reportingStatus === "reported";
  const delivery: DeliveryStatus = r.delivery ?? deliveryFromLegacy(r.status);
  const reporting: ReportingStatus = !required
    ? "not_required"
    : r.reporting && r.reporting !== "pending"
      ? r.reporting
      : r.status === "cleared"
        ? "reported"
        : "pending";
  const failed = delivery === "delivery_failed" || delivery === "rejected";
  const errorCode =
    r.errorCode ?? (delivery === "rejected" ? "EINVOICE_VALIDATION" : "TRANSPORT_ERROR");
  const retry =
    !r.providerMessageId &&
    (!providerRequiresLegalEntity(provider) ||
      AMBIGUOUS_CODES.has(errorCode) ||
      RETRYABLE_BEFORE_HANDOFF.has(errorCode));

  return db.transaction(async (tx) => {
    await lockEInvoiceInvoice(company.id, invoice.id, tx);
    const current = await getEInvoiceDocument(company.id, invoice.id, tx);
    if (current?.submitClaimedAt?.getTime() !== now.getTime()) return null;
    await updateInvoiceInTransaction(tx, invoice, result.update);
    const documentRow = await applyTracks(
      company.id,
      invoice.id,
      {
        delivery,
        reporting,
        providerStatus: r.providerStatus ?? null,
        errorCode: failed || delivery === "needs_link" ? errorCode : null,
        errorMessage: failed ? (r.detail ?? null) : null,
      },
      {
        source: "job",
        provider: provider.name,
        now,
        document: {
          ...result.document,
          validation: current.validation,
          validatedAt: current.validatedAt,
          nextRetryAt: retry ? result.document.nextRetryAt : null,
          submitClaimedAt: null,
        },
      },
      tx
    );
    if (result.handedOver) {
      const archive = {
        companyId: company.id,
        invoiceId: invoice.id,
        direction: "outbound" as const,
        documentNumber: claim.invoiceNumber,
        documentType: built.documentType,
        uuid: built.uuid,
        xml: built.xml,
        provider: provider.name,
        providerMessageId: result.providerMessageId,
        now,
      };
      await archiveEInvoiceXml({ ...archive, kind: "submitted" }, tx);
      if (result.document.status === "cleared") {
        await archiveEInvoiceXml({ ...archive, kind: "cleared" }, tx);
      }
    }
    return { ...result, documentRow };
  });
}

/** Explicit caller-driven processing still uses the same durable queue and worker claims. */
export async function submitAndPersist(args: QueueArgs) {
  const now = args.now ?? new Date();
  const enqueued = await enqueueEInvoiceSubmission({ ...args, now });
  if (!enqueued.ok) return enqueued;
  return (
    (await processQueuedSubmission(enqueued.documentRow, args.provider, now)) ?? {
      ok: false as const,
      status: 409,
      code: "EINVOICE_SUBMISSION_IN_PROGRESS",
      message: "This e-invoice is queued for processing.",
    }
  );
}

export async function refreshAndPersist(args: {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  now?: Date;
  source?: HistorySource;
  providerEventId?: string | null;
}) {
  const { invoice, company, provider } = args;
  const now = args.now ?? new Date();
  const existing = await getEInvoiceDocument(company.id, invoice.id);
  const ref = { documentType: existing?.documentType ?? null };
  const result = await refreshEInvoiceStatus({ invoice, provider, now, ref });
  if (!result.ok) return result;
  const required = existing?.reportingStatus
    ? existing.reportingStatus !== "not_required"
    : invoiceReportingRequired(invoice, company);
  const r = result.result;
  const delivery: DeliveryStatus = r.delivery ?? deliveryFromLegacy(r.status);
  // E2: a provider that reports the FTA track in the status itself (Complyance: final_valid /
  // final_invalid) is taken at its word; "pending" from a provider never overrides what we know.
  const providerReporting =
    r.reporting === "reported" || r.reporting === "report_failed" ? r.reporting : null;
  let reporting: ReportingStatus = !required
    ? "not_required"
    : (providerReporting ??
      (r.status === "cleared"
        ? "reported"
        : ((existing?.reportingStatus as ReportingStatus | null) ?? "pending")));
  if (
    required &&
    delivery === "delivered" &&
    reporting === "pending" &&
    provider.getReportingStatus &&
    invoice.einvoiceProviderMessageId
  ) {
    try {
      reporting = (await provider.getReportingStatus(invoice.einvoiceProviderMessageId, ref))
        .reporting;
    } catch {
      log.warn({ invoiceId: invoice.id }, "E-invoice reporting check failed");
    }
  }
  // Two-track providers drive the legacy status from the tracks; others report it directly.
  const legacy = r.delivery ? legacyFromTracks(delivery, reporting) : result.update.einvoiceStatus;
  const failed =
    delivery === "delivery_failed" || delivery === "rejected" || reporting === "report_failed";
  return db.transaction(async (tx) => {
    const fresh = await lockEInvoiceInvoice(company.id, invoice.id, tx);
    const current = await getEInvoiceDocument(company.id, invoice.id, tx);
    if (
      !fresh ||
      fresh.einvoiceProviderMessageId !== invoice.einvoiceProviderMessageId ||
      fresh.einvoiceStatus !== invoice.einvoiceStatus ||
      current?.updatedAt?.getTime() !== existing?.updatedAt?.getTime() ||
      current?.deliveryStatus !== existing?.deliveryStatus ||
      current?.reportingStatus !== existing?.reportingStatus ||
      current?.provider !== existing?.provider ||
      !canTransitionEInvoice(fresh.einvoiceStatus ?? "not_generated", legacy)
    ) {
      return {
        ok: false as const,
        status: 409,
        code: "EINVOICE_INVALID_TRANSITION",
        message: "The e-invoice changed during this status check. Refresh and try again.",
      };
    }
    const doc = await applyTracks(
      company.id,
      invoice.id,
      {
        delivery,
        reporting,
        providerStatus: r.providerStatus ?? null,
        errorCode: failed ? (r.errorCode ?? "EINVOICE_DELIVERY_FAILED") : null,
        errorMessage: failed ? (r.detail ?? null) : null,
      },
      {
        source: args.source ?? "user",
        provider: provider.name,
        providerEventId: args.providerEventId ?? null,
        now,
        document: {
          ...result.document,
          status: legacy,
          clearedAt: legacy === "cleared" ? (current?.clearedAt ?? now) : result.document.clearedAt,
        },
      },
      tx
    );
    const update = { ...result.update, einvoiceStatus: legacy };
    await updateInvoiceInTransaction(tx, fresh, update);
    if (legacy === "cleared" && fresh.einvoiceXml) {
      await archiveEInvoiceXml(
        {
          companyId: company.id,
          invoiceId: invoice.id,
          direction: "outbound",
          kind: "cleared",
          documentNumber: documentSubmissionMetadata(doc)?.invoiceNumber ?? fresh.number,
          documentType: doc.documentType,
          uuid: fresh.einvoiceUuid,
          xml: fresh.einvoiceXml,
          provider: provider.name,
          providerMessageId: fresh.einvoiceProviderMessageId,
          now,
        },
        tx
      );
    }
    return { ...result, update, documentRow: doc };
  });
}

export async function cancelAndPersist(args: {
  invoice: Invoice;
  company: Company;
  provider: EInvoiceProvider;
  reason: string;
}) {
  return db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(args.company.id, args.invoice.id, tx);
    if (!invoice)
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Invoice not found." };
    const current = await getEInvoiceDocument(invoice.companyId, invoice.id, tx);
    if (
      isQueuedEInvoiceDocument(current) ||
      current?.nextRetryAt ||
      current?.deliveryStatus === "needs_link" ||
      (current?.status === "failed" && current.providerMessageId)
    ) {
      return {
        ok: false as const,
        status: 409,
        code: "EINVOICE_SUBMISSION_IN_PROGRESS",
        message: "This document is still being checked or submitted by the e-invoice worker.",
      };
    }
    const result = await cancelEInvoice({ ...args, invoice });
    if (!result.ok) return result;
    await updateInvoiceInTransaction(tx, invoice, result.update);
    const doc = await applyTracks(
      invoice.companyId,
      invoice.id,
      { delivery: "rejected", errorCode: "EINVOICE_CANCELLED", errorMessage: args.reason },
      { source: "user", provider: args.provider.name, document: result.document },
      tx
    );
    return { ...result, documentRow: doc };
  });
}

/**
 * Send queued documents or recover retryable failures. A fresh process reconstructs all work
 * from Postgres, including uncertain attempts whose worker died after it acquired a claim.
 */
export async function runEInvoiceRetries(
  now: Date = new Date(),
  providerFactory?: (doc: EInvoiceDocument) => EInvoiceProvider | Promise<EInvoiceProvider>
): Promise<{ attempted: number; submitted: number }> {
  const due = await dueEInvoiceRetries(now);
  let attempted = 0;
  let submitted = 0;
  for (const doc of due) {
    try {
      const pin = documentSubmissionMetadata(doc);
      if (!providerFactory && (!doc.provider || !pin)) {
        // Historic rows did not record whether a hand-off targeted sandbox or production.
        await stopUnpinnedSubmission(doc, now);
        continue;
      }
      const provider = providerFactory
        ? await providerFactory(doc)
        : await getCompanyEInvoiceProvider(doc.companyId, {
            provider: doc.provider,
            environment: pin?.environment,
          });
      const result = await processQueuedSubmission(doc, provider, now);
      if (result) {
        attempted++;
        if (result.handedOver) submitted++;
      }
    } catch {
      log.warn({ invoiceId: doc.invoiceId }, "Could not process queued e-invoice");
      await deferQueuedSubmission(doc, now);
    }
  }
  return { attempted, submitted };
}

async function stopUnpinnedSubmission(candidate: EInvoiceDocument, now: Date) {
  await db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(candidate.companyId, candidate.invoiceId, tx);
    if (!invoice) return;
    const doc = await getEInvoiceDocument(invoice.companyId, invoice.id, tx);
    if (!eligibleSubmission(doc, now) || documentSubmissionMetadata(doc)) return;
    const code = "EINVOICE_PROVIDER_NOT_CONFIGURED";
    if (doc.attempts === 0 || doc.provider === "mock") {
      await stopQueuedSubmission(tx, invoice, code, now);
      return;
    }
    // Without the original environment, even looking up the provider document would be unsafe.
    await applyTracks(
      invoice.companyId,
      invoice.id,
      { delivery: "needs_link", errorCode: code },
      { source: "job", now, document: { nextRetryAt: null, submitClaimedAt: null } },
      tx
    );
  });
}

async function deferQueuedSubmission(candidate: EInvoiceDocument, now: Date) {
  await db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(candidate.companyId, candidate.invoiceId, tx);
    if (!invoice) return;
    const doc = await getEInvoiceDocument(invoice.companyId, invoice.id, tx);
    if (!eligibleSubmission(doc, now)) return;
    await upsertEInvoiceDocument(
      invoice.companyId,
      invoice.id,
      {
        nextRetryAt: new Date(now.getTime() + SUBMISSION_LEASE_MS),
      },
      tx
    );
  });
}
