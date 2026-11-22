import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  auditLogs,
  companies,
  einvoiceArchive,
  einvoiceDocumentEvents,
  einvoiceDocuments,
  invoices,
  users,
  type Company,
  type EInvoiceDocument,
  type Invoice,
} from "../../../shared/schema";
import { db } from "../../db";
import { DomainError } from "../../errors";
import { scopedCompanyPermissionFailure } from "../../middleware/companyRolePolicy";
import type { EInvoiceOutboundIdentity } from "../einvoice-provider";
import { readEInvoiceDocumentType } from "../einvoice.service";
import { first, parseXml, partyPeppolEndpoint, partyVatTrn, textAt } from "./dom";
import {
  assertLegalEntityCanSend,
  companyTin,
  currentOnboardingEntity,
  getLegalEntity,
  requireCompanyTin,
} from "./legal-entities";
import { isUaeTin, PEPPOL_SCHEME_UAE_TIN, tinFromTrn } from "./pint-ae-codes";
import { AcubeApiError, AcubeEInvoiceProvider } from "./providers/acube";
import { companyProviderConfiguration } from "./providers/company-provider";
import { ComplyanceEInvoiceProvider } from "./providers/complyance";
import type { ProviderEnvironment } from "./providers/types";
import { applyTracks } from "./history";
import {
  archiveEInvoiceXml,
  assertSubmittedArchiveRevision,
  conflictingClearanceRevision,
  documentProviderEnvironment,
  recordedReportingRequired,
  documentSubmissionMetadata,
  documentSubmissionSnapshot,
  getEInvoiceDocument,
  hasUnverifiedComplyanceCorrection,
  lockEInvoiceInvoice,
  outboundArchiveRevisions,
  resetRevisionReporting,
  sha256Hex,
  SUBMISSION_LEASE_MS,
  trackedRevisionReporting,
  upsertEInvoiceDocument,
  type EInvoiceDb,
} from "./store";

type Provider = "acube" | "complyance";
type TrackedReference = { provider: Provider; messageId: string };
const HELD_STATUSES = ["submitted", "accepted", "cleared", "rejected", "failed", "cancelled"];

/** A direct A-Cube validation refusal has no provider resource. A recipient rejection does. */
export function canRetryOriginalRejectedNumber(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined
) {
  const pin = documentSubmissionMetadata(doc);
  return (
    doc?.provider === "acube" &&
    (!invoice.einvoiceProvider || invoice.einvoiceProvider === doc.provider) &&
    doc.status === "rejected" &&
    doc.lastErrorCode === "ACUBE_VALIDATION" &&
    !doc.providerStatus &&
    !doc.providerMessageId &&
    !invoice.einvoiceProviderMessageId &&
    !doc.nextRetryAt &&
    !doc.submitClaimedAt &&
    (pin?.environment === "sandbox" || pin?.environment === "production") &&
    !!pin.scope &&
    pin.invoiceNumber === invoice.number &&
    (!!pin.operationId || doc.attempts === 1)
  );
}

export function correctableComplyanceReference(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined
) {
  const pin = documentSubmissionMetadata(doc);
  const id = doc?.providerMessageId;
  return doc?.provider === "complyance" &&
    invoice.einvoiceProvider === "complyance" &&
    doc.status === "rejected" &&
    doc.providerStatus === "rejected" &&
    doc.lastErrorCode === "COMPLYANCE_VALIDATION" &&
    !doc.nextRetryAt &&
    !doc.submitClaimedAt &&
    !!id &&
    invoice.einvoiceProviderMessageId === id &&
    (pin?.environment === "sandbox" || pin?.environment === "production") &&
    pin.correctableRejection &&
    !pin.correctionBlocked &&
    !pin.correctionUncertain &&
    !!pin.scope &&
    !!pin.supplierTin &&
    !!pin.sourceName &&
    // An environment verification must include proof of the original source version.
    (!pin.environmentVerifiedAt || !!pin.sourceVersion) &&
    pin.invoiceNumber === invoice.number
    ? id
    : null;
}

/** A historical attempt without an ID cannot be replaced just because its configuration changed. */
export function needsLegacySubmissionRecovery(invoice: Invoice, doc: EInvoiceDocument | undefined) {
  if (
    invoice.einvoiceProviderMessageId ||
    doc?.providerMessageId ||
    ((doc?.provider ?? invoice.einvoiceProvider) === "mock" &&
      (!invoice.einvoiceProvider || invoice.einvoiceProvider === "mock")) ||
    canRetryOriginalRejectedNumber(invoice, doc)
  )
    return false;
  const pin = documentSubmissionMetadata(doc);
  if (pin?.operationId)
    return (
      doc?.provider === "complyance" &&
      !doc.nextRetryAt &&
      !doc.submitClaimedAt &&
      ["COMPLYANCE_VALIDATION", "COMPLYANCE_XML_FAILED"].includes(doc.lastErrorCode ?? "")
    );
  return (
    doc?.deliveryStatus === "needs_link" ||
    !!doc?.submitClaimedAt ||
    (doc?.attempts ?? 0) > 0 ||
    !!invoice.einvoiceSubmittedAt ||
    ["submitted", "accepted", "cleared", "rejected"].includes(invoice.einvoiceStatus ?? "") ||
    (invoice.einvoiceStatus === "failed" && !!(invoice.einvoiceProvider || doc?.provider))
  );
}

function originalProvider(invoice: Invoice, doc: EInvoiceDocument | undefined): Provider | null {
  const provider = doc?.provider ?? invoice.einvoiceProvider;
  return (provider === "acube" || provider === "complyance") &&
    (!invoice.einvoiceProvider || invoice.einvoiceProvider === provider)
    ? provider
    : null;
}

export function legacyTrackingReference(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined
): TrackedReference | null {
  if (doc && (doc.companyId !== invoice.companyId || doc.invoiceId !== invoice.id)) return null;
  if (
    !HELD_STATUSES.includes(invoice.einvoiceStatus ?? "") &&
    !HELD_STATUSES.includes(doc?.status ?? "")
  )
    return null;

  const provider = originalProvider(invoice, doc);
  const messageId = doc?.providerMessageId ?? invoice.einvoiceProviderMessageId;
  if (
    !provider ||
    !messageId ||
    (invoice.einvoiceProviderMessageId && invoice.einvoiceProviderMessageId !== messageId)
  )
    return null;
  return { provider, messageId };
}

function recoveryPlan(invoice: Invoice, doc: EInvoiceDocument | undefined) {
  if (doc && (doc.companyId !== invoice.companyId || doc.invoiceId !== invoice.id)) return null;
  const existing = legacyTrackingReference(invoice, doc);
  if (existing) return { ...existing, reference: "stored" as const };
  if (!needsLegacySubmissionRecovery(invoice, doc)) return null;
  if (doc?.submitClaimedAt && Date.now() - doc.submitClaimedAt.getTime() < SUBMISSION_LEASE_MS)
    return null;
  const provider = originalProvider(invoice, doc);
  if (!provider) return null;
  return {
    provider,
    messageId: null,
    reference: provider === "acube" ? ("search" as const) : ("manual" as const),
  };
}

function historicalComplyanceRejection(invoice: Invoice, doc: EInvoiceDocument | undefined) {
  const snapshot = documentSubmissionSnapshot(doc);
  return (
    originalProvider(invoice, doc) === "complyance" &&
    (doc?.status ?? invoice.einvoiceStatus) === "rejected" &&
    (!doc?.providerStatus || doc.providerStatus === "rejected") &&
    (!doc?.lastErrorCode || doc.lastErrorCode === "COMPLYANCE_VALIDATION") &&
    !doc?.nextRetryAt &&
    !doc?.submitClaimedAt &&
    !snapshot?.correctionBlocked &&
    !snapshot?.correctionUncertain &&
    (!snapshot?.scope ||
      snapshot.correctableRejection == null ||
      (!!snapshot.environmentVerifiedAt && !stringValue(snapshot.sourceVersion)))
  );
}

function completeStoredTracking(invoice: Invoice, doc: EInvoiceDocument | undefined) {
  return (
    documentProviderEnvironment(doc) &&
    invoice.einvoiceProviderMessageId &&
    doc?.providerMessageId &&
    !historicalComplyanceRejection(invoice, doc) &&
    (doc.status !== "cleared" || (invoice.einvoiceXml && invoice.einvoiceHash && doc.xmlHash))
  );
}

/** Advertise local configuration only. Opening the invoice makes no provider request. */
export async function legacyTrackingAvailability(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined,
  company?: Pick<Company, "einvoicePartner">,
  revision?: { unresolved: boolean; canRepairClearance: boolean }
) {
  const refusal = await legacyRefusalProof(invoice, doc);
  if (refusal) {
    const configuration =
      !company || company.einvoicePartner === "acube"
        ? await companyProviderConfiguration(invoice.companyId, "acube", {
            environment: refusal.environment,
          })
        : null;
    return {
      provider: "acube" as const,
      reference: "refusal" as const,
      environments: configuration ? [refusal.environment] : [],
    };
  }
  const plan = recoveryPlan(invoice, doc);
  const pin = documentProviderEnvironment(doc);
  if (
    !plan ||
    revision?.unresolved ||
    (completeStoredTracking(invoice, doc) && !revision?.canRepairClearance)
  )
    return null;
  const configuration = await companyProviderConfiguration(invoice.companyId, plan.provider);
  return {
    provider: plan.provider,
    reference: plan.reference,
    environments:
      configuration && (!pin || pin === configuration.environment)
        ? [configuration.environment]
        : [],
  };
}

export async function assertCanVerifyEInvoiceTracking(
  actorId: string,
  companyId: string,
  conn: EInvoiceDb = db,
  lock?: "share"
) {
  const query = conn
    .select({
      id: users.id,
      isAdmin: users.isAdmin,
      userType: users.userType,
      firmRole: users.firmRole,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, actorId));
  const [actor] = await (lock ? query.for(lock) : query);
  if (!actor) throw new DomainError("AUTH_REQUIRED", 401);
  const denied = await scopedCompanyPermissionFailure(actor, companyId, "tax.submit", conn, lock);
  if (denied) {
    if (denied.code === "COMPANY_ACCESS_DENIED") throw new DomainError("INVOICE_NOT_FOUND", 404);
    throw new DomainError(denied.code, 403);
  }
  if (!actor.emailVerified) throw new DomainError("EMAIL_VERIFICATION_REQUIRED", 403);
}

const stringValue = (value: unknown) => (typeof value === "string" && value.length ? value : null);

function mismatch() {
  return new DomainError(
    "EINVOICE_ENVIRONMENT_PROOF_MISMATCH",
    422,
    undefined,
    "The provider could not verify this original outbound e-invoice in the selected environment."
  );
}

function cannotVerify() {
  return new DomainError(
    "EINVOICE_ENVIRONMENT_VERIFICATION_UNAVAILABLE",
    503,
    undefined,
    "Configure the original provider in the requested environment to verify this document."
  );
}

async function savedSource(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined,
  reference: { provider: Provider; messageId: string | null },
  conn: EInvoiceDb = db
) {
  const authoritative = await clearedEInvoiceSource(invoice, doc, reference, conn);
  if (authoritative) return authoritative;
  if (reference.provider === "complyance" && reference.messageId) {
    if (hasUnverifiedComplyanceCorrection(doc)) throw conflictingClearanceRevision();
    await assertSubmittedArchiveRevision(
      {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        provider: reference.provider,
        providerMessageId: reference.messageId,
      },
      invoice,
      doc,
      conn
    );
  }
  const needsArchive = !invoice.einvoiceXml || (!invoice.einvoiceHash && !doc?.xmlHash);
  const snapshot = documentSubmissionSnapshot(doc);
  const pinnedHash = invoice.einvoiceHash ?? doc?.xmlHash;
  const archives = needsArchive
    ? await conn
        .select({
          xml: einvoiceArchive.xml,
          hash: einvoiceArchive.sha256,
          number: einvoiceArchive.documentNumber,
          uuid: einvoiceArchive.uuid,
        })
        .from(einvoiceArchive)
        .where(
          and(
            eq(einvoiceArchive.companyId, invoice.companyId),
            eq(einvoiceArchive.invoiceId, invoice.id),
            eq(einvoiceArchive.direction, "outbound"),
            eq(einvoiceArchive.kind, "submitted"),
            eq(einvoiceArchive.provider, reference.provider),
            reference.messageId
              ? eq(einvoiceArchive.providerMessageId, reference.messageId)
              : eq(
                  einvoiceArchive.documentNumber,
                  stringValue(snapshot?.invoiceNumber) ?? invoice.number
                ),
            pinnedHash ? eq(einvoiceArchive.sha256, pinnedHash) : undefined
          )
        )
        .limit(2)
    : [];
  if (archives.length > 1) throw mismatch();
  const [archive] = archives;
  const xml = invoice.einvoiceXml ?? archive?.xml;
  const hashes = [invoice.einvoiceHash, doc?.xmlHash, archive?.hash].filter(Boolean);
  if (!xml || !hashes.length) throw mismatch();
  const hash = sha256Hex(xml);
  if (hashes.some((candidate) => candidate !== hash)) throw mismatch();
  return {
    ...sourceIdentity(invoice, doc, { xml, hash, number: archive?.number, uuid: archive?.uuid }),
    clearanceId: null,
    clearedAt: null,
  };
}

/** Download, verification and provider refresh must select the same bytes for a held reference. */
export async function resolveTrackedEInvoiceSource(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined,
  reference: TrackedReference,
  conn: EInvoiceDb = db
) {
  try {
    return await savedSource(invoice, doc, reference, conn);
  } catch (err) {
    if (
      reference.provider === "complyance" &&
      err instanceof DomainError &&
      err.code === "EINVOICE_ENVIRONMENT_PROOF_MISMATCH"
    )
      throw conflictingClearanceRevision();
    throw err;
  }
}

/** Status reads are local and cannot turn contradictory XML evidence into a provider claim. */
export async function inspectComplyanceRevision(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined
) {
  const unresolved = hasUnverifiedComplyanceCorrection(doc);
  const reference = legacyTrackingReference(invoice, doc);
  if (reference?.provider !== "complyance") return { unresolved, canRepairClearance: false };
  try {
    const source = await resolveTrackedEInvoiceSource(invoice, doc, reference);
    return {
      unresolved: false,
      canRepairClearance: !!source.clearanceId && !mirrorsMatchSource(invoice, doc, source),
    };
  } catch (err) {
    if (err instanceof DomainError && err.code === "EINVOICE_CORRECTION_REVISION_UNVERIFIED")
      return { unresolved: true, canRepairClearance: false };
    throw err;
  }
}

function sourceIdentity(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined,
  source: { xml: string; hash: string; number?: string; uuid?: string | null },
  authoritative = false
) {
  const { xml, hash } = source;
  const snapshot = documentSubmissionSnapshot(doc);

  let root: Element;
  try {
    root = parseXml(xml).documentElement;
  } catch {
    throw mismatch();
  }
  const documentNumber = stringValue(snapshot?.invoiceNumber) ?? invoice.number;
  if (
    textAt(root, "cbc:ID") !== documentNumber ||
    (source.number && source.number !== documentNumber)
  )
    throw mismatch();
  const seller = first(root, "cac:AccountingSupplierParty/cac:Party");
  if (!seller) throw mismatch();
  const supplierEndpoint = partyPeppolEndpoint(seller);
  const supplierTrn = partyVatTrn(seller);
  const taxTin = tinFromTrn(supplierTrn);
  const supplierTin =
    supplierEndpoint?.scheme === PEPPOL_SCHEME_UAE_TIN ? supplierEndpoint.value : taxTin;
  if (
    !supplierTin ||
    !isUaeTin(supplierTin) ||
    (supplierTrn && taxTin !== supplierTin) ||
    (snapshot?.supplierTin && snapshot.supplierTin !== supplierTin) ||
    (snapshot?.supplierTrn && snapshot.supplierTrn !== supplierTrn)
  )
    throw mismatch();
  const xmlUuid = textAt(root, "cbc:UUID");
  const expectedUuids = authoritative
    ? [source.uuid]
    : [doc?.uuid, invoice.einvoiceUuid, source.uuid];
  if (xmlUuid && expectedUuids.some((uuid) => uuid && uuid !== xmlUuid)) {
    throw mismatch();
  }
  return {
    invoiceId: invoice.id,
    xml,
    hash,
    documentNumber,
    supplierEndpoint,
    supplierTin,
    supplierTrn,
    documentType: readEInvoiceDocumentType(xml) ?? doc?.documentType ?? null,
    uuid:
      xmlUuid ??
      (authoritative ? source.uuid : (doc?.uuid ?? invoice.einvoiceUuid)) ??
      source.uuid ??
      null,
  };
}

/** Clearance is proven by the scoped archive, independently of a legacy mirror's revision. */
export async function clearedEInvoiceSource(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined,
  reference: { provider: Provider; messageId: string | null },
  conn: EInvoiceDb = db
) {
  if (!reference.messageId) return null;
  const archives = await outboundArchiveRevisions(
    {
      companyId: invoice.companyId,
      invoiceId: invoice.id,
      provider: reference.provider,
      providerMessageId: reference.messageId,
    },
    "cleared",
    conn
  );
  if (!archives.length) return null;
  const [archive] = archives;
  if (
    archives.length !== 1 ||
    sha256Hex(archive.xml) !== archive.sha256 ||
    (hasUnverifiedComplyanceCorrection(doc) &&
      documentSubmissionMetadata(doc)?.correctionCandidateHash !== archive.sha256)
  ) {
    throw conflictingClearanceRevision();
  }
  try {
    const source = sourceIdentity(
      invoice,
      doc,
      {
        xml: archive.xml,
        hash: archive.sha256,
        number: archive.documentNumber,
        uuid: archive.uuid,
      },
      true
    );
    if (archive.documentType && source.documentType !== archive.documentType)
      throw conflictingClearanceRevision();
    return { ...source, clearanceId: archive.id, clearedAt: archive.createdAt };
  } catch (err) {
    if (err instanceof DomainError && err.code === "EINVOICE_ENVIRONMENT_PROOF_MISMATCH")
      throw conflictingClearanceRevision();
    throw err;
  }
}

function mirrorsMatchSource(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined,
  source: { xml: string; hash: string }
) {
  return (
    invoice.einvoiceXml === source.xml &&
    invoice.einvoiceHash === source.hash &&
    doc?.xmlHash === source.hash
  );
}

/** A cleared archive is preferred even when the ordinary invoice XML mirror is populated. */
export async function archivedEInvoiceXmlForDownload(invoice: Invoice): Promise<string | null> {
  const doc = await getEInvoiceDocument(invoice.companyId, invoice.id);
  const reference = legacyTrackingReference(invoice, doc);
  if (!reference) {
    const providerHeldDocument =
      [invoice.einvoiceProvider, doc?.provider].some(
        (provider) => provider === "acube" || provider === "complyance"
      ) &&
      (invoice.einvoiceProviderMessageId || doc?.providerMessageId);
    if (documentSubmissionMetadata(doc)?.correctionOf || providerHeldDocument)
      throw conflictingClearanceRevision();
    return invoice.einvoiceXml;
  }
  try {
    return (await resolveTrackedEInvoiceSource(invoice, doc, reference)).xml;
  } catch (err) {
    if (err instanceof DomainError && err.code === "EINVOICE_ENVIRONMENT_PROOF_MISMATCH")
      return null;
    throw err;
  }
}

async function verifyAtProvider(
  company: Company,
  plan: NonNullable<ReturnType<typeof recoveryPlan>>,
  suppliedId: string | undefined,
  environment: ProviderEnvironment,
  source: Awaited<ReturnType<typeof savedSource>>,
  snapshot: ReturnType<typeof documentSubmissionSnapshot>,
  configuration: NonNullable<Awaited<ReturnType<typeof companyProviderConfiguration>>>,
  verifyCorrection: boolean
) {
  const entity = await getLegalEntity(company.id, plan.provider, environment);
  const matchingEntity = entity?.tin === source.supplierTin ? entity : null;
  if (
    companyTin(company) !== source.supplierTin &&
    !matchingEntity &&
    snapshot?.supplierTin !== source.supplierTin
  ) {
    throw mismatch();
  }
  const details = matchingEntity?.providerDetails as Record<string, unknown> | null;
  const identity: EInvoiceOutboundIdentity = {
    documentNumber: source.documentNumber,
    supplierEndpoint: source.supplierEndpoint,
    supplierTin: source.supplierTin,
    supplierTrn: source.supplierTrn,
    legalEntityId: stringValue(snapshot?.legalEntityId) ?? matchingEntity?.legalEntityId ?? null,
    sourceName: stringValue(snapshot?.sourceName) ?? stringValue(details?.sourceName),
    sourceVersion: stringValue(snapshot?.sourceVersion),
  };

  if (plan.provider === "complyance") {
    const messageId = plan.messageId ?? suppliedId;
    if (!messageId) throw mismatch();
    const provider = new ComplyanceEInvoiceProvider(configuration.env);
    const active = currentOnboardingEntity(company, entity, plan.provider, environment);
    const context =
      verifyCorrection &&
      source.uuid &&
      source.supplierEndpoint?.scheme === PEPPOL_SCHEME_UAE_TIN &&
      source.supplierEndpoint.value === identity.supplierTin &&
      active?.status === "active" &&
      active.tin === identity.supplierTin &&
      active.legalEntityId === identity.legalEntityId
        ? { legalEntity: active }
        : undefined;
    const result = await provider.checkOutboundRecovery(messageId, identity, context);
    if (result.verdict === "unavailable")
      throw new DomainError("EINVOICE_PROVIDER_UNAVAILABLE", 502);
    if (result.verdict !== "verified") throw mismatch();
    const correctionSource = result.correctionSource;
    const scope =
      context && correctionSource ? await provider.getSubmissionScope(company.id, context) : null;
    return {
      identity,
      reference: { provider: plan.provider, messageId },
      correction:
        scope &&
        correctionSource &&
        result.correctionReasons &&
        (!snapshot?.scope || snapshot.scope === scope)
          ? { scope, source: correctionSource, reasons: result.correctionReasons }
          : null,
    };
  }
  const provider = new AcubeEInvoiceProvider(configuration.env);
  const ref = { documentType: source.documentType };
  let messageId = plan.messageId;
  if (!messageId) {
    const found = await provider
      .lookupSubmission({
        companyId: company.id,
        invoiceId: source.invoiceId,
        invoiceNumber: source.documentNumber,
        uuid: source.uuid ?? "",
        xml: source.xml,
        documentType: source.documentType ?? undefined,
      })
      .catch(translateAcubeProofError);
    if (!found?.providerMessageId) throw mismatch();
    messageId = found.providerMessageId;
  }
  const document = await provider.getDocument(messageId, ref).catch(translateAcubeProofError);
  const documentNumber = document.invoiceNumber ?? document.creditNoteNumber;
  if (
    document.direction !== "outgoing" ||
    documentNumber !== source.documentNumber ||
    [document.invoiceNumber, document.creditNoteNumber].some(
      (number) => number != null && number !== source.documentNumber
    ) ||
    [document.uuid, document.invoiceId, document.creditNoteId].some(
      (id) => id != null && id !== messageId
    ) ||
    (document.environment != null && document.environment !== environment) ||
    (document.ownerFiscalId != null && document.ownerFiscalId !== source.supplierTin) ||
    (document.legalEntityUuid != null && document.legalEntityUuid !== identity.legalEntityId)
  ) {
    throw mismatch();
  }
  const remoteXml = await provider.fetchSource(messageId, ref).catch(translateAcubeProofError);
  if (remoteXml !== source.xml) throw mismatch();
  return { identity, reference: { provider: plan.provider, messageId }, correction: null };
}

function translateAcubeProofError(err: unknown): never {
  if (err instanceof AcubeApiError && [200, 400, 404, 422].includes(err.status)) throw mismatch();
  throw new DomainError("EINVOICE_PROVIDER_UNAVAILABLE", 502);
}

function assertSameEnvironment(current: string | null, requested: ProviderEnvironment) {
  if (current && current !== requested) {
    throw new DomainError(
      "EINVOICE_ENVIRONMENT_ALREADY_VERIFIED",
      409,
      undefined,
      "This e-invoice already has a verified provider environment."
    );
  }
}

/** The old route recorded definitive direct refusals after the single provider attempt. */
async function legacyRefusalProof(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined,
  conn: EInvoiceDb = db
) {
  const snapshot = documentSubmissionSnapshot(doc);
  if (
    !doc ||
    doc.companyId !== invoice.companyId ||
    doc.invoiceId !== invoice.id ||
    invoice.einvoiceProvider !== "acube" ||
    doc.provider !== "acube" ||
    invoice.einvoiceStatus !== "rejected" ||
    doc.status !== "rejected" ||
    doc.deliveryStatus !== "rejected" ||
    doc.lastErrorCode !== "ACUBE_VALIDATION" ||
    doc.providerStatus ||
    doc.attempts !== 1 ||
    invoice.einvoiceProviderMessageId ||
    doc.providerMessageId ||
    invoice.einvoiceSubmittedAt ||
    doc.submittedAt ||
    doc.nextRetryAt ||
    doc.submitClaimedAt ||
    snapshot?.operationId ||
    snapshot?.scope ||
    !invoice.einvoiceXml ||
    !invoice.einvoiceHash ||
    doc.xmlHash !== invoice.einvoiceHash ||
    !invoice.einvoiceUuid ||
    doc.uuid !== invoice.einvoiceUuid
  )
    return null;

  const audits = await conn
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      details: auditLogs.details,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.companyId, invoice.companyId),
        eq(auditLogs.resourceType, "invoice"),
        eq(auditLogs.resourceId, invoice.id),
        inArray(auditLogs.action, ["invoice.einvoice_submit", "invoice.einvoice_resubmit"])
      )
    )
    .limit(2);
  const [audit] = audits;
  if (audits.length !== 1 || audit.action !== "invoice.einvoice_submit") return null;
  const delivery = await conn
    .select({
      code: einvoiceDocumentEvents.code,
      provider: einvoiceDocumentEvents.provider,
      status: einvoiceDocumentEvents.toStatus,
    })
    .from(einvoiceDocumentEvents)
    .where(
      and(
        eq(einvoiceDocumentEvents.companyId, invoice.companyId),
        eq(einvoiceDocumentEvents.invoiceId, invoice.id),
        eq(einvoiceDocumentEvents.track, "delivery"),
        inArray(einvoiceDocumentEvents.toStatus, [
          "queued",
          "sending",
          "delivered",
          "delivery_failed",
          "rejected",
          "needs_link",
        ])
      )
    )
    .limit(2);
  if (
    delivery.length !== 1 ||
    delivery[0].status !== "rejected" ||
    delivery[0].provider !== "acube" ||
    delivery[0].code !== "ACUBE_VALIDATION"
  )
    return null;
  const [archive] = await conn
    .select({ id: einvoiceArchive.id })
    .from(einvoiceArchive)
    .where(
      and(
        eq(einvoiceArchive.companyId, invoice.companyId),
        eq(einvoiceArchive.invoiceId, invoice.id),
        eq(einvoiceArchive.direction, "outbound"),
        inArray(einvoiceArchive.kind, ["submitted", "cleared"])
      )
    )
    .limit(1);
  if (archive) return null;
  let outcome:
    | { provider?: unknown; environment?: unknown; providerMessageId?: unknown; status?: unknown }
    | undefined;
  try {
    outcome = JSON.parse(audit.details ?? "null")?.after;
  } catch {
    return null;
  }
  const environment = outcome?.environment;
  if (
    outcome?.provider !== "acube" ||
    outcome.status !== "rejected" ||
    (outcome.providerMessageId !== "" && outcome.providerMessageId !== null) ||
    (environment !== "sandbox" && environment !== "production") ||
    (snapshot?.environment && snapshot.environment !== environment)
  )
    return null;
  return { auditId: audit.id, environment };
}

async function confirmLegacyRefusal(args: {
  invoice: Invoice;
  actorId: string;
  environment: ProviderEnvironment;
  auditId: string;
}) {
  const { invoice, actorId, environment, auditId } = args;
  return db.transaction(async (tx) => {
    const current = await lockEInvoiceInvoice(invoice.companyId, invoice.id, tx);
    const [company] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, invoice.companyId))
      .for("share");
    if (!current || !company || company.deletedAt) throw new DomainError("INVOICE_NOT_FOUND", 404);
    await assertCanVerifyEInvoiceTracking(actorId, company.id, tx, "share");
    const doc = await getEInvoiceDocument(company.id, invoice.id, tx, "update");
    assertSameEnvironment(documentProviderEnvironment(doc), environment);
    const response = {
      provider: "acube" as const,
      environment,
      verified: true as const,
      retryEligible: true as const,
    };
    if (
      documentSubmissionSnapshot(doc)?.legacyRefusalAuditId === auditId &&
      canRetryOriginalRejectedNumber(current, doc)
    )
      return response;
    const proof = await legacyRefusalProof(current, doc, tx);
    if (
      proof?.auditId !== auditId ||
      proof.environment !== environment ||
      current.einvoiceHash !== invoice.einvoiceHash
    )
      throw mismatch();
    const config = await companyProviderConfiguration(company.id, "acube", { environment });
    if (company.einvoicePartner !== "acube" || !config) throw cannotVerify();
    const source = await savedSource(current, doc, { provider: "acube", messageId: null });
    if (source.documentNumber !== current.number) throw mismatch();
    const entity = await getLegalEntity(company.id, "acube", environment, tx, "share");
    assertLegalEntityCanSend(entity, "A-Cube");
    if (entity?.tin !== source.supplierTin || requireCompanyTin(company) !== source.supplierTin)
      throw mismatch();
    const scope = await new AcubeEInvoiceProvider(config.env).getSubmissionScope(company.id);
    const now = new Date();
    const required = recordedReportingRequired(doc);
    await upsertEInvoiceDocument(
      company.id,
      invoice.id,
      {
        validation: {
          ...(doc?.validation as Record<string, unknown>),
          submission: {
            ...documentSubmissionSnapshot(doc),
            environment,
            scope,
            invoiceNumber: source.documentNumber,
            supplierTin: source.supplierTin,
            supplierTrn: source.supplierTrn,
            legalEntityId: entity.legalEntityId,
            providerAttempted: true,
            ...(required === null ? {} : { reportingRequired: required }),
            legacyRefusalAuditId: proof.auditId,
            environmentVerifiedAt: now.toISOString(),
          },
        },
      },
      tx
    );
    await tx.insert(auditLogs).values({
      userId: actorId,
      companyId: company.id,
      action: "invoice.einvoice_refusal_verified",
      resourceType: "invoice",
      resourceId: invoice.id,
      details: JSON.stringify({
        after: {
          provider: "acube",
          environment,
          invoiceNumber: source.documentNumber,
          originalAuditId: proof.auditId,
        },
      }),
    });
    return response;
  });
}

/** Verify one recorded outbound reference and persist its environment without dispatching work. */
export async function confirmLegacyEInvoiceEnvironment(args: {
  invoice: Invoice;
  company: Company;
  actorId: string;
  environment: ProviderEnvironment;
  documentId?: string;
}) {
  const { invoice, company, actorId, environment, documentId } = args;
  if (invoice.companyId !== company.id || company.deletedAt)
    throw new DomainError("INVOICE_NOT_FOUND", 404);
  await assertCanVerifyEInvoiceTracking(actorId, company.id);

  const doc = await getEInvoiceDocument(company.id, invoice.id);
  if (
    documentSubmissionSnapshot(doc)?.legacyRefusalAuditId &&
    canRetryOriginalRejectedNumber(invoice, doc)
  ) {
    if (documentId) throw mismatch();
    assertSameEnvironment(documentProviderEnvironment(doc), environment);
    return {
      provider: "acube" as const,
      environment,
      verified: true as const,
      retryEligible: true as const,
    };
  }
  const refusal = await legacyRefusalProof(invoice, doc);
  if (refusal) {
    if (documentId) throw mismatch();
    assertSameEnvironment(refusal.environment, environment);
    return confirmLegacyRefusal({ invoice, actorId, environment, auditId: refusal.auditId });
  }
  const plan = recoveryPlan(invoice, doc);
  if (!plan) throw cannotVerify();
  if (
    (plan.reference === "search" && documentId) ||
    (plan.reference === "manual" && !documentId) ||
    (plan.messageId && documentId && plan.messageId !== documentId)
  )
    throw mismatch();
  const existingEnvironment = documentProviderEnvironment(doc);
  assertSameEnvironment(existingEnvironment, environment);
  const storedSource = plan.messageId
    ? await resolveTrackedEInvoiceSource(invoice, doc, { ...plan, messageId: plan.messageId })
    : null;
  if (
    completeStoredTracking(invoice, doc) &&
    storedSource &&
    mirrorsMatchSource(invoice, doc, storedSource)
  ) {
    return { provider: plan.provider, environment, verified: true as const };
  }

  // The configured environment is a contact boundary, even if other encrypted bundles exist.
  const configuration = await companyProviderConfiguration(company.id, plan.provider, {
    environment,
  });
  if (!configuration) throw cannotVerify();
  const source = storedSource ?? (await savedSource(invoice, doc, plan));
  const verifyCorrection = !source.clearanceId && historicalComplyanceRejection(invoice, doc);
  const snapshot = documentSubmissionSnapshot(doc);
  const { identity, reference, correction } = await verifyAtProvider(
    company,
    plan,
    documentId,
    environment,
    source,
    snapshot,
    configuration,
    verifyCorrection
  );
  const recovered = plan.messageId === null;
  const response = {
    provider: reference.provider,
    environment,
    verified: true as const,
    ...(recovered ? { providerDocumentId: reference.messageId } : {}),
  };

  return db.transaction(async (tx) => {
    // Serialize adoption of the same provider reference even across different invoice rows.
    const scope = JSON.stringify([
      company.id,
      reference.provider,
      environment,
      reference.messageId,
    ]);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
    const current = await lockEInvoiceInvoice(company.id, invoice.id, tx);
    if (!current) throw new DomainError("INVOICE_NOT_FOUND", 404);
    const [currentCompany] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, company.id))
      .for("share");
    if (!currentCompany || currentCompany.deletedAt)
      throw new DomainError("INVOICE_NOT_FOUND", 404);
    await assertCanVerifyEInvoiceTracking(actorId, company.id, tx, "share");
    const stored = await getEInvoiceDocument(company.id, invoice.id, tx, "update");
    const currentPlan = recoveryPlan(current, stored);
    if (
      currentPlan?.provider !== reference.provider ||
      (currentPlan.messageId !== plan.messageId && currentPlan.messageId !== reference.messageId)
    ) {
      throw mismatch();
    }
    const pinned = documentProviderEnvironment(stored);
    assertSameEnvironment(pinned, environment);
    const preserveRejection = !source.clearanceId && historicalComplyanceRejection(current, stored);
    const currentSource = plan.messageId
      ? await resolveTrackedEInvoiceSource(current, stored, reference, tx)
      : ((await clearedEInvoiceSource(current, stored, reference, tx)) ??
        (await savedSource(current, stored, plan, tx)));
    if (currentSource.hash !== source.hash || currentSource.clearanceId !== source.clearanceId)
      throw conflictingClearanceRevision();
    if (completeStoredTracking(current, stored) && mirrorsMatchSource(current, stored, source))
      return response;
    const [duplicate] = await tx
      .select({ id: einvoiceDocuments.id })
      .from(einvoiceDocuments)
      .where(
        and(
          eq(einvoiceDocuments.companyId, company.id),
          ne(einvoiceDocuments.invoiceId, invoice.id),
          eq(einvoiceDocuments.provider, reference.provider),
          eq(einvoiceDocuments.providerMessageId, reference.messageId),
          sql`${einvoiceDocuments.validation}->'submission'->>'environment' = ${environment}`
        )
      )
      .limit(1);
    if (duplicate) throw mismatch();

    if (
      current.einvoiceXml !== invoice.einvoiceXml ||
      current.einvoiceHash !== invoice.einvoiceHash ||
      current.einvoiceUuid !== invoice.einvoiceUuid ||
      current.einvoiceStatus !== invoice.einvoiceStatus ||
      current.number !== invoice.number ||
      stored?.id !== doc?.id ||
      stored?.updatedAt?.getTime() !== doc?.updatedAt?.getTime() ||
      stored?.attempts !== doc?.attempts ||
      stored?.submitClaimedAt?.getTime() !== doc?.submitClaimedAt?.getTime() ||
      stored?.xmlHash !== doc?.xmlHash ||
      stored?.uuid !== doc?.uuid ||
      JSON.stringify(documentSubmissionSnapshot(stored)) !== JSON.stringify(snapshot)
    )
      throw mismatch();

    if (correction && preserveRejection) {
      const entity = currentOnboardingEntity(
        currentCompany,
        await getLegalEntity(company.id, "complyance", environment, tx, "share"),
        "complyance",
        environment
      );
      const credentials = await companyProviderConfiguration(company.id, "complyance", {
        environment,
      });
      if (
        entity?.status !== "active" ||
        entity.legalEntityId !== identity.legalEntityId ||
        entity.tin !== identity.supplierTin ||
        !credentials ||
        (await new ComplyanceEInvoiceProvider(credentials.env).getSubmissionScope(company.id, {
          legalEntity: entity,
        })) !== correction.scope
      )
        throw mismatch();
    }

    const now = new Date();
    const { replacesRevision, required, reportBy } = trackedRevisionReporting(
      current,
      stored,
      source
    );
    const validation = replacesRevision
      ? resetRevisionReporting(stored, required)
      : stored?.validation;
    const status = preserveRejection
      ? "rejected"
      : recovered || replacesRevision
        ? "submitted"
        : (stored?.status ??
          (HELD_STATUSES.includes(current.einvoiceStatus ?? "")
            ? current.einvoiceStatus!
            : "submitted"));
    const { documentNumber, ...owner } = identity;
    const document = {
      status,
      provider: reference.provider,
      providerMessageId: reference.messageId,
      documentType: source.documentType,
      xmlHash: source.hash,
      uuid: source.uuid,
      validation: {
        ...(validation && typeof validation === "object" && !Array.isArray(validation)
          ? validation
          : {}),
        submission: {
          ...documentSubmissionSnapshot({ validation }),
          ...owner,
          invoiceNumber: documentNumber,
          environment,
          environmentVerifiedAt: now.toISOString(),
          providerAttempted: true,
          ...(required === null ? {} : { reportingRequired: required }),
          ...(replacesRevision
            ? {
                confirmedRevisionHash: source.hash,
                correctableRejection: false,
                correctionUncertain: false,
                correctionCandidateHash: null,
                correctionCandidate: null,
              }
            : {}),
          ...(correction && preserveRejection
            ? {
                scope: correction.scope,
                sourceName: correction.source.name,
                sourceVersion: correction.source.version,
                correctableRejection: true,
              }
            : {}),
          ...(stored?.lastErrorCode === "COMPLYANCE_XML_FAILED" ? { correctionBlocked: true } : {}),
        },
      },
    };
    if (recovered || replacesRevision || (correction && preserveRejection)) {
      const providerStatus = preserveRejection
        ? correction
          ? "rejected"
          : (stored?.providerStatus ?? null)
        : null;
      const errorCode = preserveRejection
        ? correction
          ? "COMPLYANCE_VALIDATION"
          : (stored?.lastErrorCode ?? null)
        : null;
      const rejectionReasons = preserveRejection
        ? (stored?.rejectionReasons ?? correction?.reasons ?? null)
        : null;
      const lastError = preserveRejection
        ? (stored?.lastError ??
          correction?.reasons.map(({ message }) => message).join("; ") ??
          null)
        : null;
      await applyTracks(
        company.id,
        invoice.id,
        {
          delivery: preserveRejection ? "rejected" : "queued",
          errorCode,
          errorMessage: lastError,
          providerStatus,
          ...(replacesRevision
            ? {
                reporting: required === false ? ("not_required" as const) : ("pending" as const),
                reportBy,
              }
            : {}),
        },
        {
          source: "user",
          now,
          provider: reference.provider,
          recordDelivery: true,
          document: {
            ...document,
            nextRetryAt: null,
            submitClaimedAt: null,
            lastError,
            rejectionReasons,
            ...(replacesRevision ? { reportedAt: null, deliveredAt: null } : {}),
          },
        },
        tx
      );
    } else {
      await upsertEInvoiceDocument(company.id, invoice.id, document, tx);
    }
    if (recovered) {
      await archiveEInvoiceXml(
        {
          companyId: company.id,
          invoiceId: invoice.id,
          direction: "outbound",
          kind: "submitted",
          documentNumber,
          documentType: source.documentType,
          uuid: source.uuid,
          xml: source.xml,
          provider: reference.provider,
          providerMessageId: reference.messageId,
          now,
        },
        tx
      );
    }
    // Fill only the missing legacy mirrors needed by the existing polling and XML paths.
    await tx
      .update(invoices)
      .set({
        einvoiceProvider: current.einvoiceProvider ?? reference.provider,
        einvoiceProviderMessageId: current.einvoiceProviderMessageId ?? reference.messageId,
        einvoiceXml: source.clearanceId ? source.xml : (current.einvoiceXml ?? source.xml),
        einvoiceHash: source.clearanceId ? source.hash : (current.einvoiceHash ?? source.hash),
        einvoiceUuid: source.clearanceId ? source.uuid : (current.einvoiceUuid ?? source.uuid),
        ...(recovered || replacesRevision
          ? {
              einvoiceStatus: status,
              einvoiceStatusDetail: preserveRejection ? current.einvoiceStatusDetail : null,
              einvoiceSubmittedAt: recovered
                ? (current.einvoiceSubmittedAt ?? now)
                : current.einvoiceSubmittedAt,
            }
          : {}),
      })
      .where(and(eq(invoices.companyId, company.id), eq(invoices.id, invoice.id)));

    // Unlike a best-effort action log, this proof and its audit commit together.
    await tx.insert(auditLogs).values({
      userId: actorId,
      companyId: company.id,
      action: "invoice.einvoice_environment_verified",
      resourceType: "invoice",
      resourceId: invoice.id,
      details: JSON.stringify({
        before: { environment: existingEnvironment, providerMessageId: plan.messageId },
        after: {
          provider: reference.provider,
          environment,
          providerMessageId: reference.messageId,
          ...(correction && preserveRejection
            ? {
                correctableRejection: true,
                sourceName: correction.source.name,
                sourceVersion: correction.source.version,
              }
            : {}),
        },
      }),
    });
    return response;
  });
}
