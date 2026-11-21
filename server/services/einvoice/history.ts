/**
 * Two-track persistence and per-invoice history (E1, migration 0116).
 *
 * `applyTracks` writes the delivery / reporting tracks on einvoice_documents (with their
 * timestamps, the raw provider status and the error code) and records one
 * einvoice_document_events row per track that changed, so the status drawer can show the full
 * story: validated, handed to A-Cube, delivered, reported, or where it failed and why.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  einvoiceDocumentEvents,
  type EInvoiceDocument,
  type EInvoiceDocumentEvent,
} from "../../../shared/schema";
import {
  getEInvoiceDocument,
  upsertEInvoiceDocument,
  type EInvoiceDb,
  type EInvoiceDocumentPatch,
} from "./store";
import type { DeliveryStatus, ReportingStatus } from "./tracks";

export type HistorySource = "user" | "webhook" | "poll" | "job" | "system";

export interface TrackPatch {
  delivery?: DeliveryStatus;
  reporting?: ReportingStatus;
  providerStatus?: string | null;
  /** null clears a previous error. */
  errorCode?: string | null;
  errorMessage?: string | null;
  reportBy?: string | null;
}

export interface TrackMeta {
  source: HistorySource;
  provider?: string | null;
  providerEventId?: string | null;
  now?: Date;
  /** Extra document-row fields written in the same upsert (legacy status, attempts ...). */
  document?: EInvoiceDocumentPatch;
  /** A resend or recovery attempt can enter the same delivery state as the preceding attempt. */
  recordDelivery?: boolean;
  /** Provider confirmation can establish an outcome that an earlier snapshot only inferred. */
  recordReporting?: boolean;
}

export async function applyTracks(
  companyId: string,
  invoiceId: string,
  patch: TrackPatch,
  meta: TrackMeta,
  conn: EInvoiceDb = db
): Promise<EInvoiceDocument> {
  const now = meta.now ?? new Date();
  const current = await getEInvoiceDocument(companyId, invoiceId, conn);
  const row: EInvoiceDocumentPatch = { ...(meta.document ?? {}) };
  const events: Array<typeof einvoiceDocumentEvents.$inferInsert> = [];
  const base = {
    companyId,
    invoiceId,
    provider: meta.provider ?? current?.provider ?? null,
    providerStatus: patch.providerStatus ?? null,
    source: meta.source,
    providerEventId: meta.providerEventId ?? null,
    createdAt: now,
  };
  const errorChanged =
    patch.errorCode !== undefined && (patch.errorCode ?? null) !== (current?.lastErrorCode ?? null);

  if (
    patch.delivery &&
    (patch.delivery !== current?.deliveryStatus || errorChanged || meta.recordDelivery)
  ) {
    row.deliveryStatus = patch.delivery;
    row.deliveryStatusAt = now;
    if (patch.delivery === "delivered" && !current?.deliveredAt) row.deliveredAt = now;
    events.push({
      ...base,
      track: "delivery",
      fromStatus: current?.deliveryStatus ?? null,
      toStatus: patch.delivery,
      code: patch.errorCode ?? null,
      message: patch.errorCode ? (patch.errorMessage ?? null) : null,
    });
  }
  if (row.providerMessageId && !current?.submittedAt) row.submittedAt = now;
  if (patch.reporting && (patch.reporting !== current?.reportingStatus || meta.recordReporting)) {
    row.reportingStatus = patch.reporting;
    row.reportingStatusAt = now;
    if (patch.reporting === "reported" && (!current?.reportedAt || meta.recordReporting))
      row.reportedAt = now;
    events.push({
      ...base,
      track: "reporting",
      fromStatus: current?.reportingStatus ?? null,
      toStatus: patch.reporting,
      code: patch.reporting === "report_failed" ? (patch.errorCode ?? null) : null,
      message: patch.reporting === "report_failed" ? (patch.errorMessage ?? null) : null,
    });
  }
  if (patch.providerStatus !== undefined) row.providerStatus = patch.providerStatus;
  if (patch.errorCode !== undefined) row.lastErrorCode = patch.errorCode;
  if (patch.reportBy !== undefined) row.reportBy = patch.reportBy;

  const doc = await upsertEInvoiceDocument(companyId, invoiceId, row, conn);
  if (events.length) await conn.insert(einvoiceDocumentEvents).values(events);
  return doc;
}

/** A validation outcome (generate / re-check / submit) in the history. */
export async function recordValidationEvent(
  companyId: string,
  invoiceId: string,
  valid: boolean,
  meta: { source: HistorySource; message?: string | null; now?: Date },
  conn: EInvoiceDb = db
): Promise<void> {
  await conn.insert(einvoiceDocumentEvents).values({
    companyId,
    invoiceId,
    track: "validation",
    toStatus: valid ? "passed" : "failed",
    message: meta.message ?? null,
    source: meta.source,
    createdAt: meta.now ?? new Date(),
  });
}

export async function listDocumentEvents(
  companyId: string,
  invoiceId: string,
  limit = 100
): Promise<EInvoiceDocumentEvent[]> {
  return db
    .select()
    .from(einvoiceDocumentEvents)
    .where(
      and(
        eq(einvoiceDocumentEvents.companyId, companyId),
        eq(einvoiceDocumentEvents.invoiceId, invoiceId)
      )
    )
    .orderBy(desc(einvoiceDocumentEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
