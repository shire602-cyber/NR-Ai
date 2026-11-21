/**
 * Persistence for UAE e-invoicing (migration 0102): per-invoice documents,
 * the immutable five-year archive, inbound supplier documents and buyer
 * participant ids. Every query is scoped by company id.
 */
import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type AppDatabase } from "../../db";
import { DomainError } from "../../errors";
import {
  einvoiceArchive,
  einvoiceBuyerEndpoints,
  einvoiceDocuments,
  einvoiceInboundDocuments,
  invoices,
  type EInvoiceArchiveRow,
  type EInvoiceBuyerEndpoint,
  type EInvoiceDocument,
  type Invoice,
  type EInvoiceInboundDocument,
} from "../../../shared/schema";
import type { EInvoiceProviderEnvironment } from "../einvoice-provider";
import { reportingEvidenceAt, type ReportingObservation } from "./tracks";
import { PINT_AE_CREDIT_NOTE_TYPES } from "./pint-ae-codes";

export const ARCHIVE_RETENTION_YEARS = 5;

export function sha256Hex(xml: string): string {
  return crypto.createHash("sha256").update(xml, "utf8").digest("hex");
}

/** Retain until the end of the fifth year after the year of archiving (FTA: 5 years). */
export function retainUntil(now: Date): string {
  return `${now.getUTCFullYear() + ARCHIVE_RETENTION_YEARS}-12-31`;
}

// ─── Documents ──────────────────────────────────────────────────────────

export type EInvoiceDb = Pick<AppDatabase, "select" | "insert" | "update">;

/** All submission writes lock the tenant's invoice before its document row. */
export async function lockEInvoiceInvoice(companyId: string, invoiceId: string, tx: EInvoiceDb) {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.id, invoiceId)))
    .for("update");
  return invoice;
}

/** Keep any historical submission evidence even when its environment is missing. */
export function documentSubmissionSnapshot(
  doc: Pick<EInvoiceDocument, "validation"> | null | undefined
) {
  const validation = doc?.validation;
  if (!validation || typeof validation !== "object" || !("submission" in validation)) return;
  const submission = validation.submission;
  if (submission && typeof submission === "object" && !Array.isArray(submission)) {
    return submission as Record<string, unknown>;
  }
}

// Kept in the validation JSON beside the validation of this exact XML. Older rows have no pin.
export function documentSubmissionMetadata(
  doc: Pick<EInvoiceDocument, "validation"> | null | undefined
) {
  const metadata = documentSubmissionSnapshot(doc);
  const environment = metadata?.environment;
  if (environment !== "sandbox" && environment !== "production" && environment !== "mock") return;
  return {
    environment: environment as EInvoiceProviderEnvironment,
    operationId: typeof metadata?.operationId === "string" ? metadata.operationId : null,
    actorId: typeof metadata?.actorId === "string" ? metadata.actorId : null,
    invoiceNumber: typeof metadata?.invoiceNumber === "string" ? metadata.invoiceNumber : null,
    supplierTin: typeof metadata?.supplierTin === "string" ? metadata.supplierTin : null,
    supplierTrn: typeof metadata?.supplierTrn === "string" ? metadata.supplierTrn : null,
    legalEntityId: typeof metadata?.legalEntityId === "string" ? metadata.legalEntityId : null,
    sourceName: typeof metadata?.sourceName === "string" ? metadata.sourceName : null,
    scope: typeof metadata?.scope === "string" ? metadata.scope : null,
    reportingRequired:
      typeof metadata?.reportingRequired === "boolean" ? metadata.reportingRequired : null,
    environmentVerifiedAt:
      typeof metadata?.environmentVerifiedAt === "string" ? metadata.environmentVerifiedAt : null,
    providerAttempted:
      typeof metadata?.providerAttempted === "boolean" ? metadata.providerAttempted : null,
    correctableRejection: metadata?.correctableRejection === true,
    verifiedEmailRequired: metadata?.verifiedEmailRequired === true,
    correctionBlocked: metadata?.correctionBlocked === true,
    correctionOf: typeof metadata?.correctionOf === "string" ? metadata.correctionOf : null,
    correctionOriginalHash:
      typeof metadata?.correctionOriginalHash === "string" ? metadata.correctionOriginalHash : null,
    correctionOriginalValidation:
      metadata?.correctionOriginalValidation &&
      typeof metadata.correctionOriginalValidation === "object"
        ? metadata.correctionOriginalValidation
        : null,
    correctionUncertain: metadata?.correctionUncertain === true,
  };
}

/** Keep the obligation assessed when the document entered the queue. */
export function documentReportingRequired(
  doc:
    | Pick<EInvoiceDocument, "validation" | "reportBy" | "reportingStatus" | "providerMessageId">
    | null
    | undefined,
  fallback: boolean
): boolean {
  const metadata = documentSubmissionSnapshot(doc);
  if (typeof metadata?.reportingRequired === "boolean") return metadata.reportingRequired;
  // Older queued documents recorded a deadline for required filings and not_required otherwise.
  if (doc?.reportBy) return true;
  if (doc?.reportingStatus === "not_required" && (metadata?.operationId || doc.providerMessageId))
    return false;
  return fallback;
}

/** Retain a legacy document's obligation before its next provider observation replaces the old track. */
export function pinDocumentReporting(
  doc: Pick<EInvoiceDocument, "validation"> | null | undefined,
  required: boolean,
  observed: ReportingObservation | null,
  now: Date
) {
  const validation = doc?.validation;
  const snapshot = documentSubmissionSnapshot(doc);
  const existingEvidence = snapshot?.reportingEvidence;
  const reportingEvidence =
    observed && !reportingEvidenceAt(validation, observed)
      ? {
          ...(existingEvidence && typeof existingEvidence === "object" ? existingEvidence : {}),
          [observed]: now.toISOString(),
        }
      : existingEvidence;
  return {
    ...(validation && typeof validation === "object" && !Array.isArray(validation)
      ? validation
      : {}),
    submission: {
      ...snapshot,
      reportingRequired: required,
      ...(reportingEvidence ? { reportingEvidence } : {}),
    },
  };
}

export function documentProviderEnvironment(
  doc: Pick<EInvoiceDocument, "validation"> | null | undefined
) {
  return documentSubmissionMetadata(doc)?.environment ?? null;
}

/** A completed vendor attempt binds subsequent retries, including after exhaustion. */
export function submissionTriedProvider(doc: EInvoiceDocument | undefined): boolean {
  if (!doc?.provider) return false;
  return documentSubmissionMetadata(doc)?.providerAttempted ?? doc.attempts > 0;
}

/** Unsettled, attempted, and handed-over documents keep their recorded provider. */
export function submissionProviderPin(
  invoice: Pick<Invoice, "einvoiceProviderMessageId">,
  doc: EInvoiceDocument | undefined
) {
  return invoice.einvoiceProviderMessageId ||
    doc?.providerMessageId ||
    doc?.nextRetryAt ||
    doc?.submitClaimedAt ||
    doc?.deliveryStatus === "needs_link" ||
    submissionTriedProvider(doc)
    ? (doc ?? null)
    : undefined;
}

/** Validation available to the UI, excluding transport metadata. */
export function documentValidation(doc: Pick<EInvoiceDocument, "validation"> | null | undefined) {
  const validation = doc?.validation;
  if (!validation || typeof validation !== "object" || !("submission" in validation)) {
    return validation ?? null;
  }
  const summary = { ...validation };
  delete summary.submission;
  return summary;
}

export async function getEInvoiceDocument(
  companyId: string,
  invoiceId: string,
  conn: EInvoiceDb = db,
  lock?: "update" | "skip-locked"
): Promise<EInvoiceDocument | undefined> {
  const query = conn
    .select()
    .from(einvoiceDocuments)
    .where(
      and(eq(einvoiceDocuments.companyId, companyId), eq(einvoiceDocuments.invoiceId, invoiceId))
    )
    .limit(1);
  const rows = await (lock
    ? query.for("update", lock === "skip-locked" ? { skipLocked: true } : undefined)
    : query);
  return rows[0];
}

/** Called under the accounting document lock, which also orders submission claims. */
export async function assertNoOutstandingEInvoiceHandoff(
  companyId: string,
  invoiceId: string,
  tx: EInvoiceDb
) {
  const document = await getEInvoiceDocument(companyId, invoiceId, tx);
  if (
    document?.submitClaimedAt ||
    document?.deliveryStatus === "needs_link" ||
    (document?.status === "failed" && document.nextRetryAt && document.attempts > 0)
  ) {
    throw new DomainError("EINVOICE_SUBMISSION_IN_PROGRESS", 409);
  }
}

export type EInvoiceDocumentPatch = Partial<
  Omit<EInvoiceDocument, "id" | "companyId" | "invoiceId" | "createdAt">
>;

export async function upsertEInvoiceDocument(
  companyId: string,
  invoiceId: string,
  patch: EInvoiceDocumentPatch,
  conn: EInvoiceDb = db
): Promise<EInvoiceDocument> {
  const now = new Date();
  const [row] = await conn
    .insert(einvoiceDocuments)
    .values({ companyId, invoiceId, status: patch.status ?? "generated", ...patch, updatedAt: now })
    .onConflictDoUpdate({
      target: einvoiceDocuments.invoiceId,
      set: { ...patch, updatedAt: now },
      where: eq(einvoiceDocuments.companyId, companyId),
    })
    .returning();
  if (!row) throw new Error("e-invoice document belongs to another company");
  return row;
}

export async function listEInvoiceDocuments(
  companyId: string,
  limit = 100
): Promise<EInvoiceDocument[]> {
  return db
    .select()
    .from(einvoiceDocuments)
    .where(eq(einvoiceDocuments.companyId, companyId))
    .orderBy(desc(einvoiceDocuments.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export const SUBMISSION_LEASE_MS = 5 * 60_000;

/** Local queue entries retain the existing generated status allowed by the database. */
export function isQueuedEInvoiceDocument(
  doc: Pick<EInvoiceDocument, "status" | "nextRetryAt"> | null | undefined
) {
  return doc?.status === "generated" && doc.nextRetryAt !== null;
}

/** Durable first attempts or retries whose backoff and any previous lease have elapsed. */
export async function dueEInvoiceRetries(now: Date, limit = 50): Promise<EInvoiceDocument[]> {
  return db
    .select()
    .from(einvoiceDocuments)
    .where(
      and(
        inArray(einvoiceDocuments.status, ["generated", "failed"]),
        lte(einvoiceDocuments.nextRetryAt, now),
        or(
          isNull(einvoiceDocuments.submitClaimedAt),
          lte(einvoiceDocuments.submitClaimedAt, new Date(now.getTime() - SUBMISSION_LEASE_MS))
        )
      )
    )
    .orderBy(einvoiceDocuments.nextRetryAt)
    .limit(limit);
}

// ─── Archive ────────────────────────────────────────────────────────────

export interface ArchiveInput {
  companyId: string;
  invoiceId?: string | null;
  direction: "outbound" | "inbound";
  kind: "submitted" | "cleared" | "received";
  documentNumber: string;
  documentType?: string | null;
  uuid?: string | null;
  xml: string;
  provider?: string | null;
  providerMessageId?: string | null;
  now?: Date;
}

/**
 * Write-once: identical content (same company/direction/kind/hash) returns the
 * existing row; the table itself rejects UPDATE/DELETE (migration trigger).
 */
export async function archiveEInvoiceXml(
  input: ArchiveInput,
  conn: EInvoiceDb = db
): Promise<EInvoiceArchiveRow> {
  const now = input.now ?? new Date();
  const sha256 = sha256Hex(input.xml);
  const inserted = await conn
    .insert(einvoiceArchive)
    .values({
      companyId: input.companyId,
      invoiceId: input.invoiceId ?? null,
      direction: input.direction,
      kind: input.kind,
      documentNumber: input.documentNumber,
      documentType: input.documentType ?? null,
      uuid: input.uuid ?? null,
      xml: input.xml,
      sha256,
      provider: input.provider ?? null,
      providerMessageId: input.providerMessageId ?? null,
      retainUntil: retainUntil(now),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const existing = await conn
    .select()
    .from(einvoiceArchive)
    .where(
      and(
        eq(einvoiceArchive.companyId, input.companyId),
        eq(einvoiceArchive.direction, input.direction),
        eq(einvoiceArchive.kind, input.kind),
        eq(einvoiceArchive.sha256, sha256)
      )
    )
    .limit(1);
  return existing[0];
}

export type ArchiveListItem = Omit<EInvoiceArchiveRow, "xml" | "companyId"> & { sizeBytes: number };

export async function listArchive(
  companyId: string,
  opts: { limit?: number; before?: Date | null } = {}
): Promise<ArchiveListItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return db
    .select({
      id: einvoiceArchive.id,
      invoiceId: einvoiceArchive.invoiceId,
      direction: einvoiceArchive.direction,
      kind: einvoiceArchive.kind,
      documentNumber: einvoiceArchive.documentNumber,
      documentType: einvoiceArchive.documentType,
      uuid: einvoiceArchive.uuid,
      sha256: einvoiceArchive.sha256,
      provider: einvoiceArchive.provider,
      providerMessageId: einvoiceArchive.providerMessageId,
      retainUntil: einvoiceArchive.retainUntil,
      createdAt: einvoiceArchive.createdAt,
      sizeBytes: sql<number>`octet_length(${einvoiceArchive.xml})`,
    })
    .from(einvoiceArchive)
    .where(
      and(
        eq(einvoiceArchive.companyId, companyId),
        opts.before ? lt(einvoiceArchive.createdAt, opts.before) : undefined
      )
    )
    .orderBy(desc(einvoiceArchive.createdAt))
    .limit(limit);
}

export async function getArchiveEntry(
  companyId: string,
  id: string
): Promise<EInvoiceArchiveRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const rows = await db
    .select()
    .from(einvoiceArchive)
    .where(and(eq(einvoiceArchive.companyId, companyId), eq(einvoiceArchive.id, id)))
    .limit(1);
  return rows[0];
}

// ─── Inbound ────────────────────────────────────────────────────────────

export async function findInboundDuplicate(
  companyId: string,
  supplierKey: string,
  documentNumber: string,
  tx?: EInvoiceDb
): Promise<EInvoiceInboundDocument | undefined> {
  const query = (tx ?? db)
    .select()
    .from(einvoiceInboundDocuments)
    .where(
      and(
        eq(einvoiceInboundDocuments.companyId, companyId),
        eq(einvoiceInboundDocuments.supplierKey, supplierKey),
        eq(einvoiceInboundDocuments.documentNumber, documentNumber)
      )
    )
    .limit(1);
  const [row] = await (tx ? query.for("update") : query);
  return row;
}

/** Claim the (company, supplier, document id) slot; null when it already exists. */
export async function insertInboundDocument(
  values: typeof einvoiceInboundDocuments.$inferInsert,
  conn: EInvoiceDb = db
): Promise<EInvoiceInboundDocument | null> {
  const rows = await conn
    .insert(einvoiceInboundDocuments)
    .values(values)
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

export async function updateInboundDocument(
  companyId: string,
  id: string,
  patch: Partial<typeof einvoiceInboundDocuments.$inferInsert>,
  conn: EInvoiceDb = db
): Promise<void> {
  await conn
    .update(einvoiceInboundDocuments)
    .set(patch)
    .where(
      and(eq(einvoiceInboundDocuments.companyId, companyId), eq(einvoiceInboundDocuments.id, id))
    );
}

export type InboundListItem = Pick<
  EInvoiceInboundDocument,
  | "id"
  | "supplierName"
  | "supplierTrn"
  | "documentNumber"
  | "documentType"
  | "status"
  | "billId"
  | "archiveId"
  | "error"
  | "validation"
  | "receivedAt"
> & { vendorCreditReviewable: boolean };

export async function listInboundDocuments(
  companyId: string,
  limit = 100
): Promise<InboundListItem[]> {
  return queryInboundDocuments(companyId, Math.min(Math.max(limit, 1), 500));
}

export async function listInboundVendorCredits(companyId: string, limit: number, cursor?: string) {
  const rows = await queryInboundDocuments(companyId, limit + 1, { cursor });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

async function queryInboundDocuments(
  companyId: string,
  limit: number,
  review?: { cursor?: string }
): Promise<InboundListItem[]> {
  const vendorCreditReviewable = and(
    eq(einvoiceInboundDocuments.status, "received"),
    inArray(einvoiceInboundDocuments.documentType, PINT_AE_CREDIT_NOTE_TYPES),
    isNotNull(einvoiceArchive.id),
    isNull(einvoiceInboundDocuments.billId),
    isNull(einvoiceInboundDocuments.debitNoteId)
  );
  const cursorRow = alias(einvoiceInboundDocuments, "inbound_cursor");
  const before = review?.cursor
    ? db
        .select({ receivedAt: cursorRow.receivedAt, id: cursorRow.id })
        .from(cursorRow)
        .where(and(eq(cursorRow.companyId, companyId), eq(cursorRow.id, review.cursor)))
    : undefined;
  return db
    .select({
      id: einvoiceInboundDocuments.id,
      supplierName: einvoiceInboundDocuments.supplierName,
      supplierTrn: einvoiceInboundDocuments.supplierTrn,
      documentNumber: einvoiceInboundDocuments.documentNumber,
      documentType: einvoiceInboundDocuments.documentType,
      status: einvoiceInboundDocuments.status,
      billId: einvoiceInboundDocuments.billId,
      archiveId: einvoiceInboundDocuments.archiveId,
      error: einvoiceInboundDocuments.error,
      validation: einvoiceInboundDocuments.validation,
      receivedAt: einvoiceInboundDocuments.receivedAt,
      vendorCreditReviewable: sql<boolean>`coalesce(${vendorCreditReviewable}, false)`,
    })
    .from(einvoiceInboundDocuments)
    .leftJoin(
      einvoiceArchive,
      and(
        eq(einvoiceArchive.id, einvoiceInboundDocuments.archiveId),
        eq(einvoiceArchive.companyId, einvoiceInboundDocuments.companyId)
      )
    )
    .where(
      and(
        eq(einvoiceInboundDocuments.companyId, companyId),
        review ? vendorCreditReviewable : undefined,
        before
          ? sql`(${einvoiceInboundDocuments.receivedAt}, ${einvoiceInboundDocuments.id}) < (${before})`
          : undefined
      )
    )
    .orderBy(desc(einvoiceInboundDocuments.receivedAt), desc(einvoiceInboundDocuments.id))
    .limit(limit);
}

// ─── Buyer endpoints ────────────────────────────────────────────────────

export async function getBuyerEndpoint(
  companyId: string,
  contactId: string | null | undefined,
  conn: Pick<EInvoiceDb, "select"> = db
): Promise<EInvoiceBuyerEndpoint | undefined> {
  if (!contactId) return undefined;
  const rows = await conn
    .select()
    .from(einvoiceBuyerEndpoints)
    .where(
      and(
        eq(einvoiceBuyerEndpoints.companyId, companyId),
        eq(einvoiceBuyerEndpoints.contactId, contactId)
      )
    )
    .limit(1);
  return rows[0];
}

export async function upsertBuyerEndpoint(
  companyId: string,
  contactId: string,
  values: Pick<
    EInvoiceBuyerEndpoint,
    "participantId" | "scheme" | "legalId" | "legalIdType" | "legalAuthority"
  >
): Promise<EInvoiceBuyerEndpoint> {
  const now = new Date();
  const [row] = await db
    .insert(einvoiceBuyerEndpoints)
    .values({ companyId, contactId, ...values, updatedAt: now })
    .onConflictDoUpdate({
      target: [einvoiceBuyerEndpoints.companyId, einvoiceBuyerEndpoints.contactId],
      set: { ...values, updatedAt: now },
    })
    .returning();
  return row;
}
