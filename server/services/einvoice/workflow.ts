/**
 * Persisted e-invoice workflow: submit / refresh / cancel with the
 * einvoice_documents row, the legacy invoice columns and the archive kept in
 * step. Shared by the HTTP routes and the "einvoice.retry" background job.
 *
 * E1: every outcome is also written as two tracks (delivery, FTA reporting) with history
 * (history.ts); a provider that needs a linked legal entity (A-Cube) is gated on it; a
 * submission is claimed first so two requests never hand the same invoice to the ASP twice.
 */
import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  companies,
  auditLogs,
  einvoiceDocuments,
  invoiceLines,
  invoices,
  users,
  type Company,
  type EInvoiceDocument,
  type EInvoiceLegalEntity,
  type Invoice,
} from "../../../shared/schema";
import { db } from "../../db";
import {
  assertCanVerifyEInvoiceTracking,
  canRetryOriginalRejectedNumber,
  clearedEInvoiceSource,
  correctableComplyanceReference,
  needsLegacySubmissionRecovery,
} from "./legacy-tracking";
import { createLogger } from "../../config/logger";
import { DomainError } from "../../errors";
import { scopedCompanyPermissionFailure } from "../../middleware/companyRolePolicy";
import { recordAudit } from "../audit.service";
import type {
  EInvoiceProvider,
  EInvoiceProviderContext,
  EInvoiceProviderResult,
  EInvoiceSubmission,
  EInvoiceOutboundIdentity,
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
import { invoiceReportingDeadline, invoiceReportingRequired } from "./reporting";
import { frozenEInvoiceDispatchIssue } from "../einvoice.service";
import {
  archiveEInvoiceXml,
  assertSubmittedArchiveRevision,
  conflictingClearanceRevision,
  correctionCandidateReporting,
  recordedReportingRequired,
  documentSubmissionMetadata,
  documentSubmissionSnapshot,
  documentValidation,
  dueEInvoiceRetries,
  getEInvoiceDocument,
  getSubmittedArchiveSource,
  hasUnverifiedComplyanceCorrection,
  isQueuedEInvoiceDocument,
  lockEInvoiceInvoice,
  pinDocumentReporting,
  sha256Hex,
  SUBMISSION_LEASE_MS,
  submissionTriedProvider,
  upsertEInvoiceDocument,
  type EInvoiceDb,
} from "./store";
import { applyTracks, recordValidationEvent, type HistorySource } from "./history";
import {
  canReadComplyanceReporting,
  deliveryFromLegacy,
  isReportingObservation,
  legacyFromProviderTracks,
  projectEInvoiceLegacyStatus,
  NEW_DOCUMENT_REQUIRED_CODES,
  reportingFromEvidence,
  reportingEvidenceAt,
  storedReportingEvidence,
  type DeliveryStatus,
  type ReportingStatus,
} from "./tracks";
import { assertLegalEntityCanSend, getLegalEntity, requireCompanyTin } from "./legal-entities";
import { isUaeTin, PEPPOL_SCHEME_UAE_TIN, tinFromTrn } from "./pint-ae-codes";
import { first, parseXml, partyPeppolEndpoint, partyVatTrn, textAt } from "./dom";

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

/**
 * E1 gate (A-Cube; E2 Complyance): the company's legal entity must be active, and the supplier
 * EndpointID we generate (scheme 0235 + TIN) must be the one the provider linked, or it cannot
 * route it (Complyance answers AE-PEPPOL-008 for the same mismatch).
 */
async function assertCanTransmit(
  company: CompanyExtras,
  provider: EInvoiceProvider,
  tx: EInvoiceDb,
  lock?: "share"
) {
  if (!providerRequiresLegalEntity(provider)) return null;
  const le = await getLegalEntity(company.id, provider.name, provider.environment, tx, lock);
  const displayName = provider.displayName ?? provider.name;
  assertLegalEntityCanSend(le, displayName);
  const scheme = company.peppolScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const tin = requireCompanyTin(company);
  if (scheme !== PEPPOL_SCHEME_UAE_TIN || tin !== le?.tin) {
    throw new DomainError(
      "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH",
      422,
      { expected: `${PEPPOL_SCHEME_UAE_TIN}:${le?.tin ?? ""}`, actual: `${scheme}:${tin ?? ""}` },
      `The supplier e-invoicing address on the invoice does not match the TIN linked at ${displayName}.`
    );
  }
  return le ?? null;
}

function providerContext(legalEntity: EInvoiceLegalEntity | null): EInvoiceProviderContext {
  return { legalEntity: legalEntity ? { providerDetails: legalEntity.providerDetails } : null };
}

function entitySourceField(
  entity: EInvoiceLegalEntity | null | undefined,
  field: "sourceName" | "sourceVersion"
): string | null {
  const details = entity?.providerDetails as Record<string, unknown> | null;
  return typeof details?.[field] === "string" ? details[field] : null;
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

export function canRecoverAcubeSubmission(
  invoice: Pick<Invoice, "einvoiceProviderMessageId">,
  doc: EInvoiceDocument | undefined
) {
  return (
    !invoice.einvoiceProviderMessageId &&
    doc?.provider === "acube" &&
    !doc.providerMessageId &&
    (doc.deliveryStatus === "needs_link" || AMBIGUOUS_CODES.has(doc.lastErrorCode ?? ""))
  );
}

function frozenEInvoice(invoice: Invoice, doc: EInvoiceDocument): PreparedSubmission | null {
  const validation = documentValidation(doc) as PreparedSubmission["validation"] | null;
  return validation?.valid &&
    invoice.einvoiceXml &&
    doc.uuid &&
    doc.xmlHash &&
    doc.uuid === invoice.einvoiceUuid &&
    doc.xmlHash === invoice.einvoiceHash &&
    doc.xmlHash === sha256Hex(invoice.einvoiceXml)
    ? {
        ok: true,
        xml: invoice.einvoiceXml,
        uuid: doc.uuid,
        hash: doc.xmlHash,
        documentType: doc.documentType,
        validation,
      }
    : null;
}

async function frozenCorrectionSource(
  invoice: Invoice,
  doc: EInvoiceDocument,
  provider: EInvoiceProvider,
  conn: EInvoiceDb
) {
  const locallyValidated = frozenEInvoice(invoice, doc);
  if (locallyValidated) return locallyValidated;
  // Historical provider proof lets us retain the old rejected bytes. The new candidate still
  // passes full local preflight and the worker rechecks the provider before sending.
  if (!documentSubmissionMetadata(doc)?.environmentVerifiedAt) return null;
  const source = await frozenComplyanceSource(invoice, doc, provider, conn);
  return source?.uuid
    ? { ...source, documentType: doc.documentType, validation: documentValidation(doc) }
    : null;
}

function needsLink(): EInvoiceProviderResult {
  return {
    providerMessageId: "",
    status: "submitted",
    delivery: "needs_link",
    reporting: "pending",
    errorCode: "EINVOICE_NEEDS_LINK",
  };
}

function correctionRevision(
  built: PreparedSubmission,
  reportingRequired: boolean | null,
  reportBy: string | null
) {
  return { xml: built.xml, hash: built.hash, uuid: built.uuid, reportingRequired, reportBy };
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
    if (!company || company.deletedAt)
      return { ok: false, status: 404, code: "NOT_FOUND", message: "Company not found." };
    const existing = await getEInvoiceDocument(company.id, fresh.id, tx);
    const correctionOf = args.regenerate ? correctableComplyanceReference(fresh, existing) : null;
    if (
      correctionOf &&
      (await clearedEInvoiceSource(
        fresh,
        existing,
        { provider: "complyance", messageId: correctionOf },
        tx
      ))
    ) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_ALREADY_SUBMITTED",
        message: "A cleared revision of this e-invoice is already archived.",
      };
    }
    const definitiveAcubeRefusal = canRetryOriginalRejectedNumber(fresh, existing);
    const verifiedEmailRequired = !!correctionOf || definitiveAcubeRefusal;
    if (NEW_DOCUMENT_REQUIRED_CODES.has(existing?.lastErrorCode ?? "")) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_NEW_DOCUMENT_REQUIRED",
        message: "This invoice number cannot be sent again.",
      };
    }
    if (
      needsLegacySubmissionRecovery(fresh, existing) ||
      existing?.deliveryStatus === "needs_link" ||
      (!correctionOf && (existing?.providerMessageId || fresh.einvoiceProviderMessageId)) ||
      (existing?.provider &&
        existing.provider !== "mock" &&
        !existing.nextRetryAt &&
        AMBIGUOUS_CODES.has(existing.lastErrorCode ?? ""))
    ) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_ALREADY_SUBMITTED",
        message: "Check or link the existing service provider document before sending it again.",
      };
    }
    if (
      existing?.provider === "acube" &&
      existing.status === "rejected" &&
      (!args.regenerate || !definitiveAcubeRefusal)
    ) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_NOT_RESUBMITTABLE",
        message:
          "Correct and explicitly resubmit a validation rejection through its original provider.",
      };
    }
    if (
      existing &&
      (isQueuedEInvoiceDocument(existing) || (existing.status === "failed" && existing.nextRetryAt))
    ) {
      return queued(existing);
    }
    if (existing?.submitClaimedAt) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_SUBMISSION_IN_PROGRESS",
        message: "This e-invoice is already being processed.",
      };
    }
    const original = documentSubmissionMetadata(existing);
    const triedProvider = submissionTriedProvider(existing);
    if (
      triedProvider &&
      (existing?.provider !== provider.name ||
        original?.environment !== provider.environment ||
        (providerRequiresLegalEntity(provider) && company.einvoicePartner !== provider.name))
    ) {
      return retryProviderChanged();
    }
    if (providerRequiresLegalEntity(provider) && company.einvoicePartner !== provider.name) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        message: "Select a service provider for this company before submitting.",
      };
    }
    if (
      providerRequiresLegalEntity(provider) &&
      !(await canAuthorizeSubmission(args.actorId ?? null, company.id, tx, verifiedEmailRequired))
    ) {
      return {
        ok: false,
        status: 403,
        code: "PERMISSION_DENIED",
        message: "E-invoice transmission requires permission for this company.",
      };
    }
    const entity = await assertCanTransmit(company, provider, tx);
    if (
      verifiedEmailRequired &&
      (entity?.tin !== original?.supplierTin ||
        (entity?.legalEntityId ?? null) !== original?.legalEntityId ||
        entitySourceField(entity, "sourceName") !== original?.sourceName)
    )
      return retryProviderChanged();
    const scope =
      (await provider.getSubmissionScope?.(company.id, providerContext(entity))) ?? null;
    if (
      triedProvider &&
      provider.getSubmissionScope &&
      (!original?.scope || original.scope !== scope)
    ) {
      return retryProviderChanged();
    }
    if (provider.getSubmissionScope && !scope) {
      return {
        ok: false,
        status: 409,
        code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        message: "Complete the e-invoicing provider connection before submitting.",
      };
    }
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

    const generated = { ...invoice, einvoiceXml: built.xml };
    const currentRequirement = invoiceReportingRequired(generated, company, now);
    const originalXml =
      correctionOf && existing ? await frozenCorrectionSource(fresh, existing, provider, tx) : null;
    if (correctionOf && !originalXml) return retryProviderChanged();
    if (correctionOf && originalXml) {
      const archive = await archiveEInvoiceXml(
        {
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          direction: "outbound",
          kind: "submitted",
          documentNumber: invoice.number,
          documentType: originalXml.documentType,
          uuid: originalXml.uuid,
          xml: originalXml.xml,
          provider: provider.name,
          providerMessageId: correctionOf,
          now,
        },
        tx
      );
      if (
        archive.invoiceId !== invoice.id ||
        archive.provider !== provider.name ||
        archive.providerMessageId !== correctionOf
      )
        return retryProviderChanged();
    }
    // A correctable refusal permits a new XML revision under the same number and provider ID.
    // Only a retry of the existing attempt keeps its previous reporting obligation.
    const keepOriginalReporting = triedProvider && !correctionOf && !definitiveAcubeRefusal;
    const required = keepOriginalReporting
      ? recordedReportingRequired(existing)
      : currentRequirement;
    const reportBy = keepOriginalReporting
      ? (existing?.reportBy ?? null)
      : required
        ? invoiceReportingDeadline(generated)
        : null;
    const correctionOriginalReporting =
      correctionOf && existing
        ? { required: recordedReportingRequired(existing), reportBy: existing.reportBy }
        : null;
    await updateInvoiceInTransaction(tx, invoice, {
      einvoiceUuid: built.uuid,
      einvoiceXml: built.xml,
      einvoiceHash: built.hash,
      einvoiceStatus: "queued",
      einvoiceProvider: provider.name,
      einvoiceProviderMessageId: null,
      einvoiceSubmittedAt: correctionOf ? fresh.einvoiceSubmittedAt : null,
      einvoiceStatusDetail: null,
    });
    await recordValidationEvent(company.id, invoice.id, true, { source, now }, tx);
    const doc = await applyTracks(
      company.id,
      invoice.id,
      {
        delivery: "queued",
        reporting: required === false ? "not_required" : "pending",
        providerStatus: null,
        errorCode: null,
        reportBy,
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
          submittedAt: correctionOf ? existing?.submittedAt : null,
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
              operationId: randomUUID(),
              invoiceNumber: invoice.number,
              supplierTin: entity?.tin ?? null,
              supplierTrn: company.trnVatNumber ?? null,
              legalEntityId: entity?.legalEntityId ?? null,
              sourceName: entitySourceField(entity, "sourceName"),
              sourceVersion: entitySourceField(entity, "sourceVersion"),
              scope,
              actorId: args.actorId ?? null,
              providerAttempted: triedProvider,
              ...(required === null ? {} : { reportingRequired: required }),
              correctionOf,
              verifiedEmailRequired,
              correctionOriginalHash: originalXml?.hash ?? null,
              correctionOriginalValidation: originalXml?.validation ?? null,
              correctionOriginalReporting,
              confirmedRevisionHash: original?.confirmedRevisionHash ?? originalXml?.hash ?? null,
              correctionCandidate: correctionOf
                ? correctionRevision(built, required, reportBy)
                : null,
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
        ...(correctionOriginalReporting
          ? { before: { ...correctionOriginalReporting, xmlHash: originalXml?.hash } }
          : {}),
        after: {
          provider: provider.name,
          environment: provider.environment,
          status: "queued",
          reportingRequired: required,
          reportBy,
          xmlHash: built.hash,
          ...(correctionOf ? { correctionOf } : {}),
        },
        tx,
      });
    }
    return queued(doc);
  });
}

function retryProviderChanged(): SubmitErr {
  return {
    ok: false,
    status: 409,
    code: "EINVOICE_RETRY_PROVIDER_CHANGED",
    message: "Restore the original e-invoicing provider connection before retrying this invoice.",
  };
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
  now: Date
) {
  return db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(candidate.companyId, candidate.invoiceId, tx);
    if (!invoice) return null;
    const doc = await getEInvoiceDocument(invoice.companyId, invoice.id, tx, "skip-locked");
    if (!eligibleSubmission(doc, now)) return null;
    const metadata = documentSubmissionMetadata(doc);
    if (
      !metadata?.operationId ||
      metadata.operationId !== documentSubmissionMetadata(candidate)?.operationId ||
      doc.provider !== provider.name ||
      metadata.environment !== provider.environment
    )
      return null;

    if (doc.providerMessageId || invoice.einvoiceProviderMessageId) {
      await upsertEInvoiceDocument(
        invoice.companyId,
        invoice.id,
        { nextRetryAt: null, submitClaimedAt: null },
        tx
      );
      return null;
    }
    const ambiguous = !!doc.submitClaimedAt || AMBIGUOUS_CODES.has(doc.lastErrorCode ?? "");
    const built = frozenEInvoice(invoice, doc);
    if (!built) {
      await stopQueuedSubmission(tx, invoice, "EINVOICE_SCHEMA_INVALID", now, ambiguous);
      return null;
    }
    if (unissuedInvoice(invoice) && !ambiguous) {
      await stopQueuedSubmission(tx, invoice, unissuedInvoiceCode(invoice), now);
      return null;
    }

    const attempt = doc.attempts + 1;
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
          attempts: attempt,
          submitClaimedAt: now,
          // A correction queued before this field was introduced still freezes the candidate
          // in the claim transaction, which commits before any provider request.
          ...(metadata.correctionOf && !metadata.correctionCandidate
            ? {
                validation: {
                  ...documentValidation(doc),
                  submission: {
                    ...documentSubmissionSnapshot(doc),
                    correctionCandidate: correctionRevision(
                      built,
                      recordedReportingRequired(doc),
                      doc.reportBy
                    ),
                  },
                },
              }
            : {}),
        },
      },
      tx
    );
    return {
      invoice,
      scope: metadata.scope,
      operationId: metadata.operationId,
      invoiceNumber: metadata.invoiceNumber ?? invoice.number,
      attempt,
      ambiguous,
      built,
    };
  });
}

type SubmissionClaim = NonNullable<Awaited<ReturnType<typeof claimQueuedSubmission>>>;

function holdsSubmissionClaim(
  current: EInvoiceDocument | undefined,
  claim: SubmissionClaim
): current is EInvoiceDocument {
  return (
    !!current?.submitClaimedAt &&
    !current.providerMessageId &&
    current.attempts === claim.attempt &&
    documentSubmissionMetadata(current)?.operationId === claim.operationId
  );
}

function unissuedInvoice(invoice: Invoice) {
  return invoice.status === "void" || invoice.status === "draft" || invoice.status === "cancelled";
}

function unissuedInvoiceCode(invoice: Invoice) {
  return invoice.status === "draft" ? "EINVOICE_INVOICE_NOT_ISSUED" : "EINVOICE_INVOICE_VOID";
}

type SubmissionDispatch = { result: EInvoiceProviderResult; providerAttempted: boolean };

function blockedSubmission(claim: SubmissionClaim, errorCode: string): SubmissionDispatch {
  return {
    providerAttempted: false,
    result: claim.ambiguous
      ? needsLink()
      : {
          providerMessageId: "",
          status: "failed",
          delivery: "delivery_failed",
          errorCode,
        },
  };
}

async function canAuthorizeSubmission(
  actorId: string | null,
  companyId: string,
  tx: EInvoiceDb,
  requireVerified = false
) {
  if (!actorId) return false;
  const [actor] = await tx
    .select({
      id: users.id,
      isAdmin: users.isAdmin,
      userType: users.userType,
      firmRole: users.firmRole,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, actorId))
    .for("share");
  return (
    !!actor &&
    (!requireVerified || !!actor.emailVerified) &&
    !(await scopedCompanyPermissionFailure(actor, companyId, "tax.submit", tx, "share"))
  );
}

/** Lock the authority rows until the provider operation returns so revocation and dispatch are ordered. */
async function dispatchQueuedSubmission(
  claim: SubmissionClaim,
  provider: EInvoiceProvider,
  now: Date
) {
  return db.transaction(async (tx) => {
    const { companyId, id } = claim.invoice;
    const current = await getEInvoiceDocument(companyId, id, tx, "update");
    if (!holdsSubmissionClaim(current, claim)) return null;
    const metadata = documentSubmissionMetadata(current)!;
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.id, id)));
    if (!invoice || invoice.einvoiceProviderMessageId || invoice.einvoiceHash !== claim.built.hash)
      return null;
    const [company] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .for("share");
    if (!company || company.deletedAt)
      return blockedSubmission(claim, "EINVOICE_PROVIDER_NOT_CONFIGURED");

    // Looking up this exact frozen A-Cube document is read-only. Current dispatch rights and the
    // currently selected partner control a new POST, not recovery of a previous handoff.
    if (claim.ambiguous && provider.name === "acube") {
      const found = await lookupAcubeSubmission(provider, invoice, current, claim.built);
      return {
        providerAttempted: false,
        result: found ?? (nextRetryAt(claim.attempt, now) ? transportFailure() : needsLink()),
      } satisfies SubmissionDispatch;
    }
    if (unissuedInvoice(invoice)) return blockedSubmission(claim, unissuedInvoiceCode(invoice));
    const dispatchIssue = frozenEInvoiceDispatchIssue(claim.built.xml);
    if (dispatchIssue) return blockedSubmission(claim, dispatchIssue);

    let context: EInvoiceProviderContext | undefined;
    if (providerRequiresLegalEntity(provider)) {
      if (company.einvoicePartner !== provider.name || invoice.number !== metadata.invoiceNumber) {
        return blockedSubmission(claim, "EINVOICE_PROVIDER_NOT_CONFIGURED");
      }
      if (
        !(await canAuthorizeSubmission(
          metadata.actorId,
          company.id,
          tx,
          metadata.verifiedEmailRequired
        ))
      ) {
        return blockedSubmission(claim, "PERMISSION_DENIED");
      }
      try {
        const entity = await assertCanTransmit(company, provider, tx, "share");
        if (
          entity?.tin !== metadata.supplierTin ||
          (entity?.legalEntityId ?? null) !== metadata.legalEntityId
        ) {
          return blockedSubmission(claim, "EINVOICE_SUPPLIER_ENDPOINT_MISMATCH");
        }
        context = providerContext(entity);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        return blockedSubmission(claim, err.code);
      }
    }
    if (
      provider.getSubmissionScope &&
      (!metadata.scope ||
        (await provider.getSubmissionScope(company.id, context)) !== metadata.scope)
    )
      return blockedSubmission(claim, "EINVOICE_PROVIDER_NOT_CONFIGURED");
    if (metadata.correctionOf) {
      if (claim.ambiguous) return { providerAttempted: false, result: needsLink() };
      const proof = await provider
        .checkCorrectableRejection?.(
          metadata.correctionOf,
          {
            documentNumber: metadata.invoiceNumber ?? invoice.number,
            supplierTin: metadata.supplierTin,
            supplierTrn: metadata.supplierTrn,
            legalEntityId: metadata.legalEntityId,
            sourceName: metadata.sourceName,
            sourceVersion: metadata.sourceVersion,
          },
          context
        )
        .catch(() => "unavailable");
      if (proof !== "verified") return blockedSubmission(claim, "EINVOICE_PROVIDER_UNAVAILABLE");
    }
    if (
      claim.ambiguous &&
      providerRequiresLegalEntity(provider) &&
      (!claim.scope || claim.attempt > EINVOICE_MAX_ATTEMPTS)
    ) {
      return { providerAttempted: false, result: needsLink() } satisfies SubmissionDispatch;
    }
    return {
      providerAttempted: true,
      result: await sendQueuedSubmission(claim, provider, context, now),
    } satisfies SubmissionDispatch;
  });
}

async function stopQueuedSubmission(
  tx: EInvoiceDb,
  invoice: Invoice,
  code: string,
  now: Date,
  ambiguous = false
) {
  const current = await getEInvoiceDocument(invoice.companyId, invoice.id, tx);
  const pin = documentSubmissionMetadata(current);
  if (pin?.correctionOf) {
    const original = await correctionSource(tx, invoice, current?.provider, pin);
    const originalReporting = pin.correctionOriginalReporting;
    await updateInvoiceInTransaction(tx, invoice, {
      einvoiceStatus: "submitted",
      einvoiceProviderMessageId: pin.correctionOf,
      einvoiceXml: original.xml,
      einvoiceHash: original.sha256,
      einvoiceUuid: original.uuid,
    });
    await applyTracks(
      invoice.companyId,
      invoice.id,
      {
        delivery: "queued",
        errorCode: code,
        ...(originalReporting
          ? {
              reporting: originalReporting.required === false ? "not_required" : "pending",
              reportBy: originalReporting.reportBy,
            }
          : {}),
      },
      {
        source: "job",
        now,
        document: {
          status: "submitted",
          providerMessageId: pin.correctionOf,
          submittedAt: current?.submittedAt ?? null,
          nextRetryAt: null,
          submitClaimedAt: null,
          uuid: original.uuid,
          xmlHash: original.sha256,
          documentType: original.documentType,
          validation: {
            ...pin.correctionOriginalValidation,
            submission: {
              ...pin,
              reportingRequired: originalReporting
                ? originalReporting.required
                : pin.reportingRequired,
              correctionOf: null,
              correctionOriginalHash: null,
              correctionOriginalValidation: null,
              correctionOriginalReporting: null,
              correctionUncertain: ambiguous,
              correctionCandidateHash: ambiguous ? (current?.xmlHash ?? null) : null,
              correctionCandidate: ambiguous ? pin.correctionCandidate : null,
            },
          },
        },
      },
      tx
    );
    return;
  }
  const status = ambiguous ? "submitted" : "failed";
  await applyTracks(
    invoice.companyId,
    invoice.id,
    {
      delivery: ambiguous ? "needs_link" : "delivery_failed",
      errorCode: ambiguous ? "EINVOICE_NEEDS_LINK" : code,
    },
    {
      source: "job",
      now,
      document: { status, nextRetryAt: null, submitClaimedAt: null },
    },
    tx
  );
  await updateInvoiceInTransaction(tx, invoice, { einvoiceStatus: status });
}

async function correctionSource(
  tx: EInvoiceDb,
  invoice: Pick<Invoice, "id" | "companyId">,
  provider: string | null | undefined,
  pin: NonNullable<ReturnType<typeof documentSubmissionMetadata>>
) {
  if (!provider || !pin.correctionOf || !pin.correctionOriginalHash)
    throw new Error("The previous outbound e-invoice source was not pinned");
  const original = await getSubmittedArchiveSource(
    {
      companyId: invoice.companyId,
      invoiceId: invoice.id,
      provider,
      providerMessageId: pin.correctionOf,
      sha256: pin.correctionOriginalHash,
    },
    tx
  );
  if (!original?.uuid) throw new Error("Could not restore the previous outbound e-invoice source");
  return { ...original, uuid: original.uuid };
}

async function sendQueuedSubmission(
  claim: SubmissionClaim,
  provider: EInvoiceProvider,
  context: EInvoiceProviderContext | undefined,
  now: Date
): Promise<EInvoiceProviderResult> {
  const { invoice, built } = claim;
  const submission: EInvoiceSubmission = {
    invoiceId: invoice.id,
    companyId: invoice.companyId,
    invoiceNumber: claim.invoiceNumber,
    uuid: built.uuid,
    xml: built.xml,
    documentType: built.documentType ?? undefined,
    scopeFingerprint: claim.scope ?? undefined,
    context,
  };
  const knownProvider = providerRequiresLegalEntity(provider);
  const result = await provider.submit(submission).catch(transportFailure);
  if (result.numberAlreadyHeld) return needsLink();
  if (result.providerMessageId) return result;
  if (claim.ambiguous && knownProvider) {
    // A later failed replay says nothing about whether the original request was accepted.
    const retryable =
      AMBIGUOUS_CODES.has(result.errorCode ?? "") ||
      RETRYABLE_BEFORE_HANDOFF.has(result.errorCode ?? "");
    return retryable && nextRetryAt(claim.attempt, now) ? transportFailure() : needsLink();
  }
  if (result.status !== "failed" && result.status !== "rejected") return transportFailure();
  if (
    AMBIGUOUS_CODES.has(result.errorCode ?? "") &&
    !nextRetryAt(claim.attempt, now) &&
    knownProvider
  )
    return needsLink();
  return result;
}

function reportingForResult(
  provider: string,
  required: boolean,
  result: EInvoiceProviderResult,
  previous?: string | null
): ReportingStatus {
  const legacyConfirmation =
    provider !== "acube" &&
    provider !== "complyance" &&
    result.reporting == null &&
    result.status === "cleared"
      ? "reported"
      : undefined;
  return reportingFromEvidence(provider, required, result.reporting, legacyConfirmation, previous);
}

async function persistSubmissionOutcome(args: {
  invoice: Invoice;
  current: EInvoiceDocument;
  built: PreparedSubmission;
  provider: EInvoiceProvider;
  dispatch: SubmissionDispatch;
  source: HistorySource;
  now: Date;
  tx: EInvoiceDb;
}) {
  const { invoice, current, built, provider, dispatch, source, now, tx } = args;
  const metadata = documentSubmissionMetadata(current);
  const correctionId = metadata?.correctionOf;
  const originalStillTracked = !!correctionId && dispatch.result.providerMessageId !== correctionId;
  const correctionUncertain =
    !!correctionId &&
    dispatch.result.providerMessageId !== correctionId &&
    (dispatch.providerAttempted || dispatch.result.delivery === "needs_link");
  const r: EInvoiceProviderResult = originalStillTracked
    ? {
        providerMessageId: correctionId,
        status: "submitted",
        delivery: "queued",
        errorCode: dispatch.result.errorCode,
      }
    : dispatch.result;
  const originalReporting = originalStillTracked ? metadata?.correctionOriginalReporting : null;
  const required = originalReporting
    ? originalReporting.required
    : recordedReportingRequired(current);
  const delivery: DeliveryStatus = r.delivery ?? deliveryFromLegacy(r.status);
  const reporting = reportingForResult(
    provider.name,
    required !== false,
    r,
    storedReportingEvidence(current)
  );
  const observedReporting =
    provider.name === "complyance" && isReportingObservation(r.reporting) ? r.reporting : null;
  const status = r.delivery
    ? legacyFromProviderTracks(provider.name, r.providerStatus, delivery, reporting)
    : projectEInvoiceLegacyStatus(provider.name, r.providerStatus, r.status, reporting);
  const result = submittedEInvoiceOutcome(
    built,
    provider,
    { ...r, status },
    current.attempts - 1,
    now
  );
  const failed =
    delivery === "delivery_failed" || delivery === "rejected" || reporting === "report_failed";
  const errorCode =
    r.errorCode ??
    (delivery === "rejected"
      ? "EINVOICE_VALIDATION"
      : reporting === "report_failed"
        ? "EINVOICE_REPORT_FAILED"
        : "TRANSPORT_ERROR");
  const retry =
    !r.providerMessageId &&
    (!providerRequiresLegalEntity(provider) ||
      AMBIGUOUS_CODES.has(errorCode) ||
      RETRYABLE_BEFORE_HANDOFF.has(errorCode));
  const validationSnapshot = metadata
    ? {
        ...(originalStillTracked ? metadata.correctionOriginalValidation : built.validation),
        submission: {
          ...metadata,
          providerAttempted:
            dispatch.providerAttempted || submissionTriedProvider(current) || result.handedOver,
          reportingRequired: required,
          correctableRejection: r.correctableRejection === true,
          correctionBlocked: r.errorCode === "COMPLYANCE_XML_FAILED",
          correctionOf: null,
          correctionOriginalHash: null,
          correctionOriginalValidation: null,
          correctionOriginalReporting: null,
          correctionUncertain,
          correctionCandidateHash: correctionUncertain ? built.hash : null,
          correctionCandidate: correctionUncertain ? metadata.correctionCandidate : null,
          confirmedRevisionHash:
            provider.name === "complyance" && result.handedOver && !originalStillTracked
              ? built.hash
              : metadata.confirmedRevisionHash,
        },
      }
    : current.validation;
  const validation = pinDocumentReporting(
    { validation: validationSnapshot },
    required,
    observedReporting,
    now
  );
  const { companyId, id: invoiceId } = invoice;
  if (originalStillTracked && metadata?.correctionOriginalHash) {
    const original = await correctionSource(tx, invoice, provider.name, metadata);
    Object.assign(result.update, {
      einvoiceXml: original.xml,
      einvoiceHash: original.sha256,
      einvoiceUuid: original.uuid,
      einvoiceSubmittedAt: invoice.einvoiceSubmittedAt,
    });
    Object.assign(result.document, {
      xmlHash: original.sha256,
      uuid: original.uuid,
      documentType: original.documentType,
      submittedAt: current.submittedAt,
      validation: null,
    });
  }
  await updateInvoiceInTransaction(tx, invoice, result.update);
  const documentRow = await applyTracks(
    companyId,
    invoiceId,
    {
      delivery,
      reporting,
      reportBy: originalReporting?.reportBy,
      providerStatus: r.providerStatus ?? null,
      errorCode: failed || delivery === "needs_link" ? errorCode : null,
      errorMessage: failed ? (r.detail ?? null) : null,
    },
    {
      source,
      provider: provider.name,
      now,
      recordReporting:
        !!observedReporting && !reportingEvidenceAt(current.validation, observedReporting),
      document: {
        ...result.document,
        validation,
        validatedAt: current.validatedAt,
        nextRetryAt: retry ? result.document.nextRetryAt : null,
        submitClaimedAt: null,
      },
    },
    tx
  );
  if (result.handedOver && !originalStillTracked) {
    const archive = {
      companyId,
      invoiceId,
      direction: "outbound" as const,
      documentNumber: metadata?.invoiceNumber ?? invoice.number,
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
}

async function processQueuedSubmission(
  candidate: EInvoiceDocument,
  provider: EInvoiceProvider,
  now: Date
) {
  const claim = await claimQueuedSubmission(candidate, provider, now);
  if (!claim) return null;
  const dispatch = await dispatchQueuedSubmission(claim, provider, now);
  if (!dispatch) return null;
  const { companyId, id } = claim.invoice;
  return db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(companyId, id, tx);
    const current = await getEInvoiceDocument(companyId, id, tx, "update");
    if (!invoice || invoice.einvoiceProviderMessageId || !holdsSubmissionClaim(current, claim))
      return null;
    return persistSubmissionOutcome({
      invoice,
      current,
      built: claim.built,
      provider,
      dispatch,
      source: "job",
      now,
      tx,
    });
  });
}

async function lookupAcubeSubmission(
  provider: EInvoiceProvider,
  invoice: Invoice,
  doc: EInvoiceDocument,
  built: PreparedSubmission
) {
  const metadata = documentSubmissionMetadata(doc);
  if (
    provider.name !== "acube" ||
    doc.provider !== provider.name ||
    doc.invoiceId !== invoice.id ||
    doc.companyId !== invoice.companyId ||
    metadata?.environment !== provider.environment ||
    !provider.lookupSubmission
  )
    return null;
  const result = await provider
    .lookupSubmission({
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      invoiceNumber: metadata.invoiceNumber ?? invoice.number,
      uuid: built.uuid,
      xml: built.xml,
      documentType: built.documentType ?? undefined,
    })
    .catch(() => null);
  return result?.providerMessageId ? result : null;
}

/** Adopt a provider reference after a successful, document-specific read-only proof. */
export async function adoptRecoveredEInvoice(args: {
  invoice: Invoice;
  document: EInvoiceDocument;
  provider: EInvoiceProvider;
  result: EInvoiceProviderResult;
  now?: Date;
  actorId?: string;
}) {
  const { invoice: originalInvoice, document, provider, result } = args;
  const now = args.now ?? new Date();
  const original = documentSubmissionMetadata(document);
  if (
    !original ||
    document.provider !== provider.name ||
    original.environment !== provider.environment ||
    !result.providerMessageId
  )
    return null;
  return db.transaction(async (tx) => {
    const key = JSON.stringify([
      originalInvoice.companyId,
      provider.name,
      provider.environment,
      result.providerMessageId,
    ]);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const invoice = await lockEInvoiceInvoice(originalInvoice.companyId, originalInvoice.id, tx);
    if (!invoice || invoice.einvoiceProviderMessageId) return null;
    if (args.actorId)
      await assertCanVerifyEInvoiceTracking(args.actorId, invoice.companyId, tx, "share");
    const current = await getEInvoiceDocument(invoice.companyId, invoice.id, tx, "update");
    const metadata = documentSubmissionMetadata(current);
    if (
      !current ||
      current.providerMessageId ||
      current.provider !== document.provider ||
      metadata?.operationId !== original.operationId ||
      metadata?.environment !== original.environment ||
      metadata?.scope !== original.scope ||
      current.xmlHash !== document.xmlHash ||
      (current.deliveryStatus !== "needs_link" &&
        current.lastErrorCode !== "COMPLYANCE_DUPLICATE_NUMBER" &&
        !canRecoverAcubeSubmission(invoice, current))
    )
      return null;
    const built = frozenEInvoice(invoice, current);
    if (!built) return null;
    const [duplicate] = await tx
      .select({ id: einvoiceDocuments.id })
      .from(einvoiceDocuments)
      .where(
        and(
          eq(einvoiceDocuments.companyId, invoice.companyId),
          ne(einvoiceDocuments.invoiceId, invoice.id),
          eq(einvoiceDocuments.provider, provider.name),
          eq(einvoiceDocuments.providerMessageId, result.providerMessageId),
          sql`${einvoiceDocuments.validation}->'submission'->>'environment' = ${provider.environment}`
        )
      )
      .limit(1);
    if (duplicate) return null;
    if (args.actorId)
      await tx.insert(auditLogs).values({
        userId: args.actorId,
        companyId: invoice.companyId,
        action:
          provider.name === "complyance"
            ? "invoice.einvoice_complyance_link"
            : "invoice.einvoice_environment_verified",
        resourceType: "invoice",
        resourceId: invoice.id,
        details: JSON.stringify({
          after: {
            provider: provider.name,
            environment: provider.environment,
            providerMessageId: result.providerMessageId,
          },
        }),
      });
    return persistSubmissionOutcome({
      invoice,
      current,
      built,
      provider,
      dispatch: { result, providerAttempted: false },
      source: "user",
      now,
      tx,
    });
  });
}

export async function recoverAcubeSubmission(
  invoice: Invoice,
  doc: EInvoiceDocument,
  provider: EInvoiceProvider
) {
  if (!canRecoverAcubeSubmission(invoice, doc)) return null;
  const built = frozenEInvoice(invoice, doc);
  if (!built) return null;
  const result = await lookupAcubeSubmission(provider, invoice, doc, built);
  return result ? adoptRecoveredEInvoice({ invoice, document: doc, provider, result }) : null;
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

export async function trackedEInvoiceProviderMatches(
  doc: EInvoiceDocument | undefined,
  provider: EInvoiceProvider
): Promise<boolean> {
  const metadata = documentSubmissionMetadata(doc);
  if (doc?.provider !== provider.name || metadata?.environment !== provider.environment)
    return false;
  if (!provider.getSubmissionScope) return true;
  return (
    !!metadata.scope &&
    (await provider.getSubmissionScope(doc.companyId).catch(() => null)) === metadata.scope
  );
}

/** A stored ID can still be read under new credentials when the ASP proves it is this document. */
async function canReadTrackedEInvoice(
  doc: EInvoiceDocument | undefined,
  invoice: Invoice,
  provider: EInvoiceProvider,
  outboundIdentity?: EInvoiceOutboundIdentity
) {
  const metadata = documentSubmissionMetadata(doc);
  const id = invoice.einvoiceProviderMessageId;
  if (
    !id ||
    doc?.providerMessageId !== id ||
    doc.provider !== provider.name ||
    metadata?.environment !== provider.environment
  )
    return false;
  if (provider.name === "complyance") return Boolean(outboundIdentity);
  if (await trackedEInvoiceProviderMatches(doc, provider)) return true;

  if (
    provider.name === "acube" &&
    provider.fetchSource &&
    invoice.einvoiceXml &&
    doc.xmlHash &&
    doc.xmlHash === invoice.einvoiceHash &&
    doc.xmlHash === sha256Hex(invoice.einvoiceXml)
  ) {
    const source = await provider
      .fetchSource(id, { documentType: doc.documentType })
      .catch(() => null);
    return source === invoice.einvoiceXml;
  }
  if (!provider.verifyOutboundDocument) return false;
  const identity = await frozenEInvoiceOwner(invoice, doc, provider);
  return !!identity && provider.verifyOutboundDocument(id, identity).catch(() => false);
}

async function frozenComplyanceSource(
  invoice: Invoice,
  doc: EInvoiceDocument,
  provider: EInvoiceProvider,
  conn: EInvoiceDb = db
) {
  const pin = documentSubmissionMetadata(doc);
  const id = invoice.einvoiceProviderMessageId;
  if (
    doc.companyId !== invoice.companyId ||
    doc.invoiceId !== invoice.id ||
    doc.provider !== provider.name ||
    (invoice.einvoiceProvider && invoice.einvoiceProvider !== provider.name) ||
    pin?.environment !== provider.environment ||
    doc.providerMessageId !== id ||
    !id
  )
    return;

  const clearance = await clearedEInvoiceSource(
    invoice,
    doc,
    { provider: "complyance", messageId: id },
    conn
  );
  if (clearance) {
    return {
      ...clearance,
      identity: {
        documentNumber: clearance.documentNumber,
        supplierEndpoint: clearance.supplierEndpoint,
        supplierTin: clearance.supplierTin,
        supplierTrn: clearance.supplierTrn,
        legalEntityId: pin.legalEntityId,
        sourceName: pin.sourceName,
      },
    };
  }

  const pinnedHash = doc.xmlHash || invoice.einvoiceHash;
  if (
    (doc.xmlHash && invoice.einvoiceHash && doc.xmlHash !== invoice.einvoiceHash) ||
    (pinnedHash && invoice.einvoiceXml && pinnedHash !== sha256Hex(invoice.einvoiceXml))
  )
    return;

  // A resource ID is shared by every correction. Do not treat a stale mirror of an older
  // submission as the latest handoff when the immutable archive records another revision.
  const reference = {
    companyId: invoice.companyId,
    invoiceId: invoice.id,
    provider: provider.name,
    providerMessageId: id,
  };
  await assertSubmittedArchiveRevision(reference, invoice, doc, conn);

  const hasMirrors = !!invoice.einvoiceXml && !!invoice.einvoiceHash && !!doc.xmlHash;
  const archive = hasMirrors
    ? null
    : await getSubmittedArchiveSource({ ...reference, sha256: pinnedHash }, conn);
  const xml = hasMirrors ? invoice.einvoiceXml : archive?.xml;
  const hash = pinnedHash ?? archive?.sha256;
  if (!xml || !hash || (invoice.einvoiceXml && invoice.einvoiceXml !== xml)) return;

  try {
    const root = parseXml(xml).documentElement;
    const documentNumber = textAt(root, "cbc:ID");
    const uuid = textAt(root, "cbc:UUID");
    const party = first(root, "cac:AccountingSupplierParty/cac:Party");
    if (!documentNumber || !party) return;
    const supplierEndpoint = partyPeppolEndpoint(party);
    const supplierTrn = partyVatTrn(party);
    const taxTin = tinFromTrn(supplierTrn);
    const supplierTin =
      supplierEndpoint?.scheme === PEPPOL_SCHEME_UAE_TIN ? supplierEndpoint.value : taxTin;
    if (
      !supplierTin ||
      !isUaeTin(supplierTin) ||
      (supplierTrn && supplierTin !== taxTin) ||
      (pin.supplierTin && pin.supplierTin !== supplierTin) ||
      (pin.supplierTrn && pin.supplierTrn !== supplierTrn) ||
      (pin.invoiceNumber && pin.invoiceNumber !== documentNumber) ||
      (!pinnedHash && !pin.invoiceNumber && invoice.number !== documentNumber) ||
      (archive && archive.documentNumber !== documentNumber) ||
      [doc.uuid, invoice.einvoiceUuid, archive?.uuid].some(
        (expected) => expected && expected !== uuid
      )
    )
      return;
    return {
      identity: {
        documentNumber,
        supplierEndpoint,
        supplierTin,
        supplierTrn,
        legalEntityId: pin.legalEntityId,
        sourceName: pin.sourceName,
        sourceVersion: pin.sourceVersion,
      },
      xml,
      uuid,
      hash,
      clearanceId: null,
      clearedAt: null,
    };
  } catch {
    return;
  }
}

/** The seller and document number frozen before dispatch, used to verify a sales resource. */
export async function frozenEInvoiceOwner(
  invoice: Invoice,
  doc: EInvoiceDocument,
  provider: EInvoiceProvider
): Promise<EInvoiceOutboundIdentity | null> {
  const metadata = documentSubmissionMetadata(doc);
  if (
    metadata?.environmentVerifiedAt &&
    metadata.invoiceNumber &&
    metadata.supplierTin &&
    doc.invoiceId === invoice.id &&
    doc.companyId === invoice.companyId &&
    doc.provider === provider.name &&
    metadata.environment === provider.environment &&
    invoice.einvoiceXml &&
    doc.xmlHash &&
    doc.xmlHash === invoice.einvoiceHash &&
    doc.xmlHash === sha256Hex(invoice.einvoiceXml)
  ) {
    return {
      documentNumber: metadata.invoiceNumber,
      supplierTin: metadata.supplierTin,
      supplierTrn: metadata.supplierTrn,
      legalEntityId: metadata.legalEntityId,
      sourceName: metadata.sourceName,
      sourceVersion: metadata.sourceVersion,
    };
  }
  const built = frozenEInvoice(invoice, doc);
  if (
    !built ||
    !metadata ||
    doc.invoiceId !== invoice.id ||
    doc.companyId !== invoice.companyId ||
    doc.provider !== provider.name ||
    metadata.environment !== provider.environment
  )
    return null;
  try {
    const root = parseXml(built.xml).documentElement;
    const party = first(root, "cac:AccountingSupplierParty/cac:Party");
    if (!party) return null;
    const supplierEndpoint = partyPeppolEndpoint(party);
    const supplierTin =
      metadata.supplierTin ??
      (supplierEndpoint?.scheme === PEPPOL_SCHEME_UAE_TIN ? supplierEndpoint.value : null);
    const entity = await getLegalEntity(invoice.companyId, provider.name, provider.environment);
    const matchingEntity =
      entity &&
      supplierTin &&
      entity.tin === supplierTin &&
      (!metadata.legalEntityId || entity.legalEntityId === metadata.legalEntityId)
        ? entity
        : null;
    return {
      documentNumber: metadata.invoiceNumber ?? invoice.number,
      supplierEndpoint,
      supplierTin,
      supplierTrn: metadata.supplierTrn ?? partyVatTrn(party),
      legalEntityId: metadata.legalEntityId ?? matchingEntity?.legalEntityId ?? null,
      sourceName: metadata.sourceName ?? entitySourceField(matchingEntity, "sourceName"),
      sourceVersion: metadata.sourceVersion,
    };
  } catch {
    return null;
  }
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
  const outboundSource =
    provider.name === "complyance" && existing
      ? await frozenComplyanceSource(invoice, existing, provider)
      : undefined;
  if (hasUnverifiedComplyanceCorrection(existing) && !outboundSource?.clearanceId)
    throw conflictingClearanceRevision();
  const outboundIdentity = outboundSource?.identity;
  if (
    invoice.einvoiceProviderMessageId &&
    !(await canReadTrackedEInvoice(existing, invoice, provider, outboundIdentity))
  ) {
    return {
      ok: false as const,
      status: 409,
      code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
      message: "Restore the original provider connection to verify this document.",
    };
  }
  const ref = {
    documentType: existing?.documentType ?? null,
    outboundIdentity,
    knownCredentialScope:
      !!outboundIdentity && (await trackedEInvoiceProviderMatches(existing, provider)),
  };
  const acube = provider.name === "acube";
  const verifiedCurrentStatus = projectEInvoiceLegacyStatus(
    provider.name,
    existing?.providerStatus,
    invoice.einvoiceStatus ?? "not_generated",
    storedReportingEvidence(existing)
  );
  // An incomplete subsequent final_valid response cannot erase a verified reporting result.
  const recoveringClearance = !!outboundSource?.clearanceId && verifiedCurrentStatus === "rejected";
  const statusForProviderRead = recoveringClearance
    ? "submitted"
    : provider.name === "complyance" &&
        verifiedCurrentStatus === "cleared" &&
        storedReportingEvidence(existing) === "reported"
      ? "accepted"
      : verifiedCurrentStatus;
  const result = await refreshEInvoiceStatus({
    invoice: { ...invoice, einvoiceStatus: statusForProviderRead },
    provider,
    now,
    ref,
  });
  if (!result.ok) return result;
  const candidateReporting = outboundSource?.clearanceId
    ? correctionCandidateReporting(existing, outboundSource.hash)
    : null;
  const recordedRevision = existing?.xmlHash ?? invoice.einvoiceHash;
  const replacesRevision = !!(
    outboundSource?.clearanceId &&
    recordedRevision &&
    recordedRevision !== outboundSource.hash
  );
  const required = candidateReporting
    ? candidateReporting.reportingRequired
    : replacesRevision
      ? null
      : recordedReportingRequired(existing);
  const reportBy = candidateReporting
    ? candidateReporting.reportBy
    : replacesRevision
      ? null
      : undefined;
  const r = result.result;
  const delivery: DeliveryStatus = r.delivery ?? deliveryFromLegacy(r.status);
  let reporting = reportingForResult(
    provider.name,
    required !== false,
    r,
    replacesRevision ? null : storedReportingEvidence(existing)
  );
  let observedReporting =
    provider.name === "complyance" && isReportingObservation(r.reporting) ? r.reporting : null;
  if (
    required !== false &&
    reporting === "pending" &&
    provider.getReportingStatus &&
    invoice.einvoiceProviderMessageId &&
    (provider.name !== "complyance" || canReadComplyanceReporting(r.providerStatus, r.errorCode))
  ) {
    try {
      const observed = await provider.getReportingStatus(invoice.einvoiceProviderMessageId, ref);
      reporting = reportingFromEvidence(provider.name, true, observed.reporting, reporting);
      if (provider.name === "complyance" && isReportingObservation(observed.reporting))
        observedReporting = observed.reporting;
    } catch {
      log.warn({ invoiceId: invoice.id }, "E-invoice reporting check failed");
    }
  }
  // Two-track providers drive the legacy status from the tracks; others report it directly.
  const legacy = r.delivery
    ? legacyFromProviderTracks(provider.name, r.providerStatus, delivery, reporting)
    : projectEInvoiceLegacyStatus(
        provider.name,
        r.providerStatus,
        result.update.einvoiceStatus,
        reporting
      );
  const failed =
    delivery === "delivery_failed" || delivery === "rejected" || reporting === "report_failed";
  return db.transaction(async (tx) => {
    const fresh = await lockEInvoiceInvoice(company.id, invoice.id, tx);
    const current = await getEInvoiceDocument(company.id, invoice.id, tx);
    if (
      !fresh ||
      fresh.einvoiceProviderMessageId !== invoice.einvoiceProviderMessageId ||
      fresh.einvoiceStatus !== invoice.einvoiceStatus ||
      fresh.einvoiceXml !== invoice.einvoiceXml ||
      fresh.einvoiceHash !== invoice.einvoiceHash ||
      fresh.einvoiceUuid !== invoice.einvoiceUuid ||
      current?.xmlHash !== existing?.xmlHash ||
      current?.updatedAt?.getTime() !== existing?.updatedAt?.getTime() ||
      current?.deliveryStatus !== existing?.deliveryStatus ||
      current?.reportingStatus !== existing?.reportingStatus ||
      current?.provider !== existing?.provider ||
      current?.providerMessageId !== existing?.providerMessageId ||
      current?.providerStatus !== existing?.providerStatus ||
      documentSubmissionMetadata(current)?.operationId !==
        documentSubmissionMetadata(existing)?.operationId ||
      !(
        canTransitionEInvoice(verifiedCurrentStatus, legacy) ||
        (recoveringClearance && legacy === "cleared")
      )
    ) {
      return {
        ok: false as const,
        status: 409,
        code: "EINVOICE_INVALID_TRANSITION",
        message: "The e-invoice changed during this status check. Refresh and try again.",
      };
    }
    if (outboundSource) {
      const verified = current && (await frozenComplyanceSource(fresh, current, provider, tx));
      if (
        verified?.hash !== outboundSource.hash ||
        verified.clearanceId !== outboundSource.clearanceId
      )
        throw conflictingClearanceRevision();
    }
    const doc = await applyTracks(
      company.id,
      invoice.id,
      {
        delivery,
        reporting,
        reportBy,
        providerStatus: r.providerStatus ?? null,
        errorCode: failed ? (r.errorCode ?? "EINVOICE_DELIVERY_FAILED") : null,
        errorMessage: failed ? (r.detail ?? null) : null,
      },
      {
        source: args.source ?? "user",
        provider: provider.name,
        providerEventId: args.providerEventId ?? null,
        recordDelivery: !!r.providerStatus && r.providerStatus !== current?.providerStatus,
        recordReporting:
          !!observedReporting &&
          (replacesRevision || !reportingEvidenceAt(current?.validation, observedReporting)),
        now,
        document: {
          ...result.document,
          status: legacy,
          ...(outboundSource ? { xmlHash: outboundSource.hash, uuid: outboundSource.uuid } : {}),
          validation: (() => {
            const reportingSource = replacesRevision
              ? {
                  validation: {
                    ...documentValidation(current),
                    submission: {
                      ...documentSubmissionSnapshot(current),
                      reportingEvidence: null,
                      reportingRequired: required,
                    },
                  },
                }
              : current;
            const pinned = pinDocumentReporting(reportingSource, required, observedReporting, now);
            const correction = documentSubmissionMetadata(current);
            if (provider.name !== "complyance" || !correction?.scope) return pinned;
            return {
              ...pinned,
              submission: {
                ...pinned.submission,
                correctableRejection:
                  r.correctableRejection === true &&
                  !correction.correctionBlocked &&
                  !correction.correctionUncertain,
                ...(outboundSource && legacy === "cleared"
                  ? {
                      confirmedRevisionHash: outboundSource.hash,
                      correctionUncertain: false,
                      correctionCandidateHash: null,
                      correctionCandidate: null,
                      ...(candidateReporting
                        ? { reportingRequired: candidateReporting.reportingRequired }
                        : {}),
                    }
                  : {}),
              },
            };
          })(),
          ...((acube || replacesRevision) && reporting !== "reported" ? { reportedAt: null } : {}),
          clearedAt:
            legacy === "cleared"
              ? (outboundSource?.clearedAt ??
                (storedReportingEvidence(current) === "reported" ? current?.clearedAt : null) ??
                now)
              : result.document.clearedAt,
        },
      },
      tx
    );
    const update: EInvoiceUpdate = {
      ...result.update,
      einvoiceStatus: legacy,
      ...(outboundSource
        ? {
            einvoiceXml: outboundSource.xml,
            einvoiceHash: outboundSource.hash,
            ...(outboundSource.uuid ? { einvoiceUuid: outboundSource.uuid } : {}),
          }
        : {}),
    };
    await updateInvoiceInTransaction(tx, fresh, update);
    const clearedXml = outboundSource?.xml ?? fresh.einvoiceXml;
    if (legacy === "cleared" && clearedXml && !outboundSource?.clearanceId) {
      await archiveEInvoiceXml(
        {
          companyId: company.id,
          invoiceId: invoice.id,
          direction: "outbound",
          kind: "cleared",
          documentNumber:
            outboundIdentity?.documentNumber ??
            documentSubmissionMetadata(doc)?.invoiceNumber ??
            fresh.number,
          documentType: doc.documentType,
          uuid: outboundSource?.uuid ?? fresh.einvoiceUuid,
          xml: clearedXml,
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
      current?.submitClaimedAt ||
      current?.nextRetryAt ||
      current?.deliveryStatus === "needs_link" ||
      needsLegacySubmissionRecovery(invoice, current) ||
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
  now?: Date,
  providerFactory?: (doc: EInvoiceDocument) => EInvoiceProvider | Promise<EInvoiceProvider>
): Promise<{ attempted: number; submitted: number }> {
  const due = await dueEInvoiceRetries(now ?? new Date());
  let attempted = 0;
  let submitted = 0;
  for (const doc of due) {
    try {
      const pin = documentSubmissionMetadata(doc);
      if (!doc.provider || !pin?.operationId) {
        // Historic queued work lacks the actor and account authorization needed for an automatic handoff.
        await stopUnpinnedSubmission(doc, now ?? new Date());
        continue;
      }
      const provider = providerFactory
        ? await providerFactory(doc)
        : await getCompanyEInvoiceProvider(doc.companyId, {
            provider: doc.provider,
            environment: pin?.environment,
          });
      const result = await processQueuedSubmission(doc, provider, now ?? new Date());
      if (result) {
        attempted++;
        if (result.handedOver) submitted++;
      }
    } catch {
      log.warn({ invoiceId: doc.invoiceId }, "Could not process queued e-invoice");
      await deferQueuedSubmission(doc, now ?? new Date());
    }
  }
  return { attempted, submitted };
}

async function stopUnpinnedSubmission(candidate: EInvoiceDocument, now: Date) {
  await db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(candidate.companyId, candidate.invoiceId, tx);
    if (!invoice) return;
    const doc = await getEInvoiceDocument(invoice.companyId, invoice.id, tx, "skip-locked");
    if (!eligibleSubmission(doc, now) || documentSubmissionMetadata(doc)?.operationId) return;
    // An untracked attempt may already have reached a provider. Preserve the hold for investigation.
    if (doc.providerMessageId || invoice.einvoiceProviderMessageId) {
      await upsertEInvoiceDocument(
        invoice.companyId,
        invoice.id,
        { nextRetryAt: null, submitClaimedAt: null },
        tx
      );
      return;
    }
    const ambiguous =
      doc.provider !== "mock" &&
      (doc.attempts > 0 || !!doc.submitClaimedAt || AMBIGUOUS_CODES.has(doc.lastErrorCode ?? ""));
    await stopQueuedSubmission(tx, invoice, "EINVOICE_PROVIDER_NOT_CONFIGURED", now, ambiguous);
  });
}

async function deferQueuedSubmission(candidate: EInvoiceDocument, now: Date) {
  await db.transaction(async (tx) => {
    const invoice = await lockEInvoiceInvoice(candidate.companyId, candidate.invoiceId, tx);
    if (!invoice) return;
    const doc = await getEInvoiceDocument(invoice.companyId, invoice.id, tx, "skip-locked");
    if (
      !eligibleSubmission(doc, now) ||
      documentSubmissionMetadata(doc)?.operationId !==
        documentSubmissionMetadata(candidate)?.operationId
    )
      return;
    if (doc.provider === "acube" || doc.provider === "complyance") {
      if (documentSubmissionMetadata(doc)?.correctionOf) {
        await stopQueuedSubmission(
          tx,
          invoice,
          "EINVOICE_PROVIDER_NOT_CONFIGURED",
          now,
          !!doc.submitClaimedAt
        );
        return;
      }
      const [company] = await tx
        .select({ partner: companies.einvoicePartner, deletedAt: companies.deletedAt })
        .from(companies)
        .where(eq(companies.id, invoice.companyId));
      if (!company || company.deletedAt || company.partner !== doc.provider) {
        const ambiguous = !!doc.submitClaimedAt || AMBIGUOUS_CODES.has(doc.lastErrorCode ?? "");
        await stopQueuedSubmission(tx, invoice, "EINVOICE_PROVIDER_NOT_CONFIGURED", now, ambiguous);
        return;
      }
    }
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
