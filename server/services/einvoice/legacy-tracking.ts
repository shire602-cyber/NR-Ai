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
import {
  documentProviderEnvironment,
  documentSubmissionSnapshot,
  getEInvoiceDocument,
  lockEInvoiceInvoice,
  sha256Hex,
  upsertEInvoiceDocument,
  type EInvoiceDb,
} from "./store";

type Provider = "acube" | "complyance";
type TrackedReference = { provider: Provider; messageId: string };
const HELD_STATUSES = ["submitted", "accepted", "cleared", "rejected", "failed", "cancelled"];

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

  const provider = doc?.provider ?? invoice.einvoiceProvider;
  const messageId = doc?.providerMessageId ?? invoice.einvoiceProviderMessageId;
  if (
    (provider !== "acube" && provider !== "complyance") ||
    !messageId ||
    (invoice.einvoiceProvider && invoice.einvoiceProvider !== provider) ||
    (invoice.einvoiceProviderMessageId && invoice.einvoiceProviderMessageId !== messageId)
  )
    return null;
  return { provider, messageId };
}

/** Advertise local configuration only. Opening the invoice makes no provider request. */
export async function legacyTrackingAvailability(
  invoice: Invoice,
  doc: EInvoiceDocument | undefined
) {
  const reference = legacyTrackingReference(invoice, doc);
  if (!reference || documentProviderEnvironment(doc)) return null;
  const configuration = await companyProviderConfiguration(invoice.companyId, reference.provider);
  return {
    provider: reference.provider,
    environments: configuration ? [configuration.environment] : [],
  };
}

async function assertCanVerify(
  actorId: string,
  companyId: string,
  conn: EInvoiceDb,
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
  reference: TrackedReference
) {
  const needsArchive = !invoice.einvoiceXml || (!invoice.einvoiceHash && !doc?.xmlHash);
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
            eq(einvoiceArchive.providerMessageId, reference.messageId)
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

  const snapshot = documentSubmissionSnapshot(doc);
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
  reference: TrackedReference,
  environment: ProviderEnvironment,
  source: Awaited<ReturnType<typeof savedSource>>,
  snapshot: ReturnType<typeof documentSubmissionSnapshot>,
  configuration: NonNullable<Awaited<ReturnType<typeof companyProviderConfiguration>>>
) {
  const entity = await getLegalEntity(company.id, reference.provider, environment);
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

  if (reference.provider === "complyance") {
    const provider = new ComplyanceEInvoiceProvider(configuration.env);
    const result = await provider.checkOutboundDocument(reference.messageId, identity);
    if (result === "unavailable") throw new DomainError("EINVOICE_PROVIDER_UNAVAILABLE", 502);
    if (result !== "verified") throw mismatch();
    return identity;
  }
  const provider = new AcubeEInvoiceProvider(configuration.env);
  const ref = { documentType: source.documentType };
  const document = await provider
    .getDocument(reference.messageId, ref)
    .catch(translateAcubeProofError);
  const documentNumber = document.invoiceNumber ?? document.creditNoteNumber;
  if (
    document.direction !== "outgoing" ||
    documentNumber !== source.documentNumber ||
    [document.invoiceNumber, document.creditNoteNumber].some(
      (number) => number != null && number !== source.documentNumber
    ) ||
    [document.uuid, document.invoiceId, document.creditNoteId].some(
      (id) => id != null && id !== reference.messageId
    ) ||
    (document.environment != null && document.environment !== environment) ||
    (document.ownerFiscalId != null && document.ownerFiscalId !== source.supplierTin) ||
    (document.legalEntityUuid != null && document.legalEntityUuid !== identity.legalEntityId)
  ) {
    throw mismatch();
  }
  const remoteXml = await provider
    .fetchSource(reference.messageId, ref)
    .catch(translateAcubeProofError);
  if (remoteXml !== source.xml) throw mismatch();
  return identity;
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
}) {
  const { invoice, company, actorId, environment } = args;
  if (invoice.companyId !== company.id || company.deletedAt)
    throw new DomainError("INVOICE_NOT_FOUND", 404);
  await assertCanVerify(actorId, company.id, db);

  const doc = await getEInvoiceDocument(company.id, invoice.id);
  const reference = legacyTrackingReference(invoice, doc);
  if (!reference) throw cannotVerify();
  const response = { provider: reference.provider, environment, verified: true as const };
  const existingEnvironment = documentProviderEnvironment(doc);
  assertSameEnvironment(existingEnvironment, environment);
  if (existingEnvironment) return response;

  // The configured environment is a contact boundary, even if other encrypted bundles exist.
  const configuration = await companyProviderConfiguration(company.id, reference.provider, {
    environment,
  });
  if (!configuration) throw cannotVerify();
  const source = await savedSource(invoice, doc, reference);
  const snapshot = documentSubmissionSnapshot(doc);
  const identity = await verifyAtProvider(
    company,
    reference,
    environment,
    source,
    snapshot,
    configuration
  );

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
    await assertCanVerify(actorId, company.id, tx, "share");
    const stored = await getEInvoiceDocument(company.id, invoice.id, tx, "update");
    const currentReference = legacyTrackingReference(current, stored);
    if (
      currentReference?.provider !== reference.provider ||
      currentReference.messageId !== reference.messageId
    ) {
      throw mismatch();
    }
    const pinned = documentProviderEnvironment(stored);
    assertSameEnvironment(pinned, environment);
    if (pinned) return response;
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
    const status =
      stored?.status ??
      (HELD_STATUSES.includes(current.einvoiceStatus ?? "")
        ? current.einvoiceStatus!
        : "submitted");
    const { documentNumber, ...owner } = identity;
    await upsertEInvoiceDocument(
      company.id,
      invoice.id,
      {
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
          },
        },
      },
      tx
    );
    // Fill only the missing legacy mirrors needed by the existing polling and XML paths.
    await tx
      .update(invoices)
      .set({
        einvoiceProvider: current.einvoiceProvider ?? reference.provider,
        einvoiceProviderMessageId: current.einvoiceProviderMessageId ?? reference.messageId,
        einvoiceXml: current.einvoiceXml ?? source.xml,
        einvoiceHash: current.einvoiceHash ?? source.hash,
        einvoiceUuid: current.einvoiceUuid ?? source.uuid,
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
        before: { environment: null },
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
