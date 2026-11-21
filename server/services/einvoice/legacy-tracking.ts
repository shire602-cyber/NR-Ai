import { and, eq, ne, sql } from "drizzle-orm";
import {
  auditLogs,
  companies,
  einvoiceArchive,
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
import { attr, first, parseXml, text, textAt } from "./dom";
import { companyTin, getLegalEntity } from "./legal-entities";
import { isUaeTin, PEPPOL_SCHEME_UAE_TIN, tinFromTrn } from "./pint-ae-codes";
import { AcubeApiError, AcubeEInvoiceProvider } from "./providers/acube";
import { companyProviderConfiguration } from "./providers/company-provider";
import { ComplyanceEInvoiceProvider } from "./providers/complyance";
import type { ProviderEnvironment } from "./providers/types";
import { applyTracks } from "./history";
import {
  archiveEInvoiceXml,
  documentProviderEnvironment,
  documentSubmissionMetadata,
  documentSubmissionSnapshot,
  getEInvoiceDocument,
  lockEInvoiceInvoice,
  sha256Hex,
  SUBMISSION_LEASE_MS,
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
    !pin.correctionUncertain &&
    !!pin.scope &&
    !!pin.supplierTin &&
    !!pin.sourceName &&
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

/** Advertise local configuration only. Opening the invoice makes no provider request. */
export async function legacyTrackingAvailability(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined
) {
  const plan = recoveryPlan(invoice, doc);
  const pin = documentProviderEnvironment(doc);
  if (!plan || (pin && invoice.einvoiceProviderMessageId && doc?.providerMessageId)) return null;
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
  reference: { provider: Provider; messageId: string | null }
) {
  const needsArchive = !invoice.einvoiceXml || (!invoice.einvoiceHash && !doc?.xmlHash);
  const snapshot = documentSubmissionSnapshot(doc);
  const archives = needsArchive
    ? await db
        .select({
          xml: einvoiceArchive.xml,
          hash: einvoiceArchive.sha256,
          number: einvoiceArchive.documentNumber,
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
                )
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

  let root: Element;
  try {
    root = parseXml(xml).documentElement;
  } catch {
    throw mismatch();
  }
  const documentNumber = stringValue(snapshot?.invoiceNumber) ?? archive?.number ?? invoice.number;
  if (textAt(root, "cbc:ID") !== documentNumber) throw mismatch();
  const seller = first(root, "cac:AccountingSupplierParty/cac:Party");
  if (!seller) throw mismatch();
  const endpoint = first(seller, "cbc:EndpointID");
  const supplierTrn = textAt(seller, "cac:PartyTaxScheme/cbc:CompanyID");
  const taxTin = tinFromTrn(supplierTrn);
  const supplierTin =
    attr(endpoint, "schemeID") === PEPPOL_SCHEME_UAE_TIN ? text(endpoint) : taxTin;
  if (
    !supplierTin ||
    !isUaeTin(supplierTin) ||
    (supplierTrn && taxTin !== supplierTin) ||
    (snapshot?.supplierTin && snapshot.supplierTin !== supplierTin) ||
    (snapshot?.supplierTrn && snapshot.supplierTrn !== supplierTrn)
  )
    throw mismatch();
  const xmlUuid = textAt(root, "cbc:UUID");
  if (xmlUuid && [doc?.uuid, invoice.einvoiceUuid].some((uuid) => uuid && uuid !== xmlUuid)) {
    throw mismatch();
  }
  return {
    invoiceId: invoice.id,
    xml,
    hash,
    documentNumber,
    supplierTin,
    supplierTrn,
    documentType: readEInvoiceDocumentType(xml) ?? doc?.documentType ?? null,
    uuid: xmlUuid ?? doc?.uuid ?? invoice.einvoiceUuid,
  };
}

async function verifyAtProvider(
  company: Company,
  plan: NonNullable<ReturnType<typeof recoveryPlan>>,
  suppliedId: string | undefined,
  environment: ProviderEnvironment,
  source: Awaited<ReturnType<typeof savedSource>>,
  snapshot: ReturnType<typeof documentSubmissionSnapshot>,
  configuration: NonNullable<Awaited<ReturnType<typeof companyProviderConfiguration>>>
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
    supplierTin: source.supplierTin,
    supplierTrn: source.supplierTrn,
    legalEntityId: stringValue(snapshot?.legalEntityId) ?? matchingEntity?.legalEntityId ?? null,
    sourceName: stringValue(snapshot?.sourceName) ?? stringValue(details?.sourceName),
  };

  if (plan.provider === "complyance") {
    const messageId = plan.messageId ?? suppliedId;
    if (!messageId) throw mismatch();
    const provider = new ComplyanceEInvoiceProvider(configuration.env);
    const result = await provider.checkOutboundDocument(messageId, identity);
    if (result === "unavailable") throw new DomainError("EINVOICE_PROVIDER_UNAVAILABLE", 502);
    if (result !== "verified") throw mismatch();
    return { identity, reference: { provider: plan.provider, messageId } };
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
  return { identity, reference: { provider: plan.provider, messageId } };
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
  if (existingEnvironment && invoice.einvoiceProviderMessageId && doc?.providerMessageId) {
    return { provider: plan.provider, environment, verified: true as const };
  }

  // The configured environment is a contact boundary, even if other encrypted bundles exist.
  const configuration = await companyProviderConfiguration(company.id, plan.provider, {
    environment,
  });
  if (!configuration) throw cannotVerify();
  const source = await savedSource(invoice, doc, plan);
  const snapshot = documentSubmissionSnapshot(doc);
  const { identity, reference } = await verifyAtProvider(
    company,
    plan,
    documentId,
    environment,
    source,
    snapshot,
    configuration
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
      .select({ deletedAt: companies.deletedAt })
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
    if (pinned && current.einvoiceProviderMessageId && stored?.providerMessageId) return response;
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
      current.number !== invoice.number ||
      stored?.id !== doc?.id ||
      stored?.attempts !== doc?.attempts ||
      stored?.submitClaimedAt?.getTime() !== doc?.submitClaimedAt?.getTime() ||
      stored?.xmlHash !== doc?.xmlHash ||
      stored?.uuid !== doc?.uuid ||
      JSON.stringify(documentSubmissionSnapshot(stored)) !== JSON.stringify(snapshot)
    )
      throw mismatch();

    const now = new Date();
    const validation =
      stored?.validation &&
      typeof stored.validation === "object" &&
      !Array.isArray(stored.validation)
        ? stored.validation
        : {};
    const status = recovered
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
        ...validation,
        submission: {
          ...snapshot,
          ...owner,
          invoiceNumber: documentNumber,
          environment,
          environmentVerifiedAt: now.toISOString(),
          providerAttempted: true,
          ...(stored?.lastErrorCode === "COMPLYANCE_XML_FAILED" ? { correctionBlocked: true } : {}),
        },
      },
    };
    if (recovered) {
      await applyTracks(
        company.id,
        invoice.id,
        { delivery: "queued", errorCode: null, providerStatus: null },
        {
          source: "user",
          now,
          provider: reference.provider,
          recordDelivery: true,
          document: {
            ...document,
            nextRetryAt: null,
            submitClaimedAt: null,
            lastError: null,
            rejectionReasons: null,
          },
        },
        tx
      );
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
    } else {
      await upsertEInvoiceDocument(company.id, invoice.id, document, tx);
    }
    // Fill only the missing legacy mirrors needed by the existing polling and XML paths.
    await tx
      .update(invoices)
      .set({
        einvoiceProvider: current.einvoiceProvider ?? reference.provider,
        einvoiceProviderMessageId: current.einvoiceProviderMessageId ?? reference.messageId,
        einvoiceXml: current.einvoiceXml ?? source.xml,
        einvoiceHash: current.einvoiceHash ?? source.hash,
        einvoiceUuid: current.einvoiceUuid ?? source.uuid,
        ...(recovered
          ? {
              einvoiceStatus: "submitted",
              einvoiceStatusDetail: null,
              einvoiceSubmittedAt: current.einvoiceSubmittedAt ?? now,
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
        },
      }),
    });
    return response;
  });
}
