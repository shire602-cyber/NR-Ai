/**
 * Durable inbox for ASP events (E1, A-Cube).
 *
 * Webhooks are answered 200 as soon as the signed request is stored in einvoice_provider_events
 * (unique per provider event id, so A-Cube's 15 retries over ~10 h land on one row). The
 * "einvoice.providerEvents" job claims due rows (FOR UPDATE SKIP LOCKED + lease), processes them
 * and backs off on failure; the "einvoice.acubePoll" job is the fallback when a webhook is late
 * or lost: it refreshes documents still in flight and enqueues incoming documents it has not
 * seen, through the same inbox.
 *
 * Processing never trusts the payload's status: it re-reads the resource from A-Cube.
 *   document.delivered (invoice.outbound / credit_note.outbound) -> refresh delivery + reporting
 *   document.received  (invoice.inbound / credit_note.inbound)   -> fetch source XML ->
 *                        processInboundEInvoice (a DRAFT bill tagged origin "einvoice")
 *   legal_entity.synchronized                                    -> update the legal entity
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { rowsOf } from "../../ledger/tx";
import {
  einvoiceDocuments,
  einvoiceLegalEntities,
  einvoiceProviderEvents,
  type Company,
  type EInvoiceProviderEvent,
} from "../../../shared/schema";
import { storage } from "../../storage";
import { createLogger } from "../../config/logger";
import { getEInvoiceProvider, type EInvoiceProvider } from "../einvoice-provider";
import { AcubeEInvoiceProvider, ACUBE_PROVIDER_NAME } from "./providers/acube";
import { processInboundEInvoice } from "./inbound";
import { refreshAndPersist } from "./workflow";
import {
  findLegalEntitiesByProviderId,
  patchFromAcube,
  updateLegalEntityRow,
} from "./legal-entities";

const log = createLogger("einvoice-provider-events");

export const PROVIDER_EVENTS_JOB = "einvoice.providerEvents";
export const ACUBE_POLL_JOB = "einvoice.acubePoll";
const MAX_ATTEMPTS = 10;
const LEASE_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 30_000;

export type CanonicalEventType =
  | "document.delivered"
  | "document.received"
  | "legal_entity.synchronized";

/** A-Cube's prose names and its OpenAPI enum names map to one vocabulary. */
export function canonicalEventType(
  payload: Record<string, unknown>,
  declared?: string | null
): CanonicalEventType | null {
  const t = String(declared ?? payload.eventType ?? payload.event ?? "").toLowerCase();
  if (t === "legal_entity.synchronized" || (!t && payload.legalEntityId && payload.action)) {
    return "legal_entity.synchronized";
  }
  if (t === "document.received" || t === "invoice.inbound" || t === "credit_note.inbound") {
    return "document.received";
  }
  if (t === "document.delivered" || t === "invoice.outbound" || t === "credit_note.outbound") {
    return "document.delivered";
  }
  if (!t && payload.documentId) {
    return String(payload.status ?? "").toLowerCase() === "received"
      ? "document.received"
      : "document.delivered";
  }
  return null;
}

/**
 * Stable dedupe key. legal_entity events carry eventId; document events do not, so the
 * (document, status) pair identifies one notification.
 */
export function providerEventKey(type: CanonicalEventType, payload: Record<string, unknown>) {
  if (typeof payload.eventId === "string" && payload.eventId) return payload.eventId;
  if (type === "legal_entity.synchronized") {
    return `le:${String(payload.legalEntityId)}:${String(payload.action)}:${String(payload.timestamp)}`;
  }
  return `doc:${String(payload.documentId)}:${String(payload.status ?? type)}`;
}

export async function enqueueProviderEvent(args: {
  provider: string;
  environment: string;
  type: CanonicalEventType;
  eventId: string;
  payload: Record<string, unknown>;
  companyId?: string | null;
}): Promise<{ id: string | null; duplicate: boolean }> {
  const rows = await db
    .insert(einvoiceProviderEvents)
    .values({
      provider: args.provider,
      environment: args.environment,
      eventId: args.eventId.slice(0, 255),
      eventType: args.type,
      companyId: args.companyId ?? null,
      payload: args.payload,
    })
    .onConflictDoNothing()
    .returning({ id: einvoiceProviderEvents.id });
  return { id: rows[0]?.id ?? null, duplicate: rows.length === 0 };
}

async function claimEvents(opts: { id?: string; limit: number }): Promise<EInvoiceProviderEvent[]> {
  const res = await db.execute(sql`
    UPDATE einvoice_provider_events e
       SET status = 'processing',
           attempts = e.attempts + 1,
           locked_until = now() + (${LEASE_MS}::int * interval '1 millisecond')
     WHERE e.id IN (
       SELECT id FROM einvoice_provider_events
        WHERE ((status = 'pending' AND next_attempt_at <= now())
               OR (status = 'processing' AND locked_until < now()))
          ${opts.id ? sql`AND id = ${opts.id}` : sql``}
        ORDER BY received_at
        LIMIT ${opts.limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING e.id, e.provider, e.environment, e.event_id AS "eventId",
              e.event_type AS "eventType", e.company_id AS "companyId", e.payload,
              e.status, e.attempts, e.next_attempt_at AS "nextAttemptAt",
              e.locked_until AS "lockedUntil", e.last_error AS "lastError",
              e.received_at AS "receivedAt", e.processed_at AS "processedAt"`);
  return rowsOf<EInvoiceProviderEvent>(res);
}

type Outcome = { status: "processed" | "ignored"; companyId?: string | null; note?: string };

function asAcube(provider: EInvoiceProvider): AcubeEInvoiceProvider | null {
  return provider instanceof AcubeEInvoiceProvider ? provider : null;
}

async function handleDelivered(
  row: EInvoiceProviderEvent,
  provider: EInvoiceProvider
): Promise<Outcome> {
  const payload = row.payload as Record<string, unknown>;
  const documentId = String(payload.documentId ?? "");
  const docs = await db
    .select()
    .from(einvoiceDocuments)
    .where(
      and(
        eq(einvoiceDocuments.provider, row.provider),
        eq(einvoiceDocuments.providerMessageId, documentId)
      )
    )
    .limit(1);
  const doc = docs[0];
  if (!doc) return { status: "ignored", note: "no document with this provider id" };
  const invoice = await storage.getInvoice(doc.invoiceId, doc.companyId);
  const company = await storage.getCompany(doc.companyId);
  if (!invoice || !company) return { status: "ignored", note: "invoice or company gone" };
  if (invoice.einvoiceStatus === "cleared") {
    return { status: "ignored", companyId: company.id, note: "already delivered and reported" };
  }
  const r = await refreshAndPersist({
    invoice,
    company,
    provider,
    source: "webhook",
    providerEventId: row.eventId,
  });
  if (!r.ok && r.status >= 500) throw new Error(r.message);
  return { status: "processed", companyId: company.id };
}

async function handleReceived(
  row: EInvoiceProviderEvent,
  provider: EInvoiceProvider
): Promise<Outcome> {
  const acube = asAcube(provider);
  if (!acube) return { status: "ignored", note: "provider has no document API" };
  const payload = row.payload as Record<string, unknown>;
  const documentId = String(payload.documentId ?? "");
  const documentType =
    String(payload.documentType ?? "") === "credit-note" ||
    String(payload.documentTypeCode ?? "") === "381"
      ? "381"
      : "380";
  const meta = await acube.getDocument(documentId, { documentType });
  const matches = await findLegalEntitiesByProviderId(
    row.provider,
    row.environment,
    (meta.legalEntityUuid as string | undefined) ?? null,
    (meta.ownerFiscalId as string | undefined) ?? null
  );
  if (matches.length === 0) {
    return { status: "ignored", note: "document belongs to no company of ours" };
  }
  if (matches.length > 1) {
    // Never post a supplier's invoice into a guessed company.
    return { status: "ignored", note: "legal entity is linked to more than one company" };
  }
  const le = matches[0];
  const company = await storage.getCompany(le.companyId);
  if (!company) return { status: "ignored", note: "company gone" };
  const xml = await acube.fetchSource(documentId, { documentType });
  try {
    await processInboundEInvoice({
      company: company as Company & { peppolParticipantId?: string | null },
      xml,
      providerMessageId: documentId,
    });
  } catch (err) {
    // Business outcomes (invalid / wrong recipient) are recorded by processInboundEInvoice and
    // are final; only infrastructure errors (5xx) are retried.
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) throw err;
    return { status: "processed", companyId: company.id, note: (err as Error).message };
  }
  return { status: "processed", companyId: company.id };
}

async function handleLegalEntity(
  row: EInvoiceProviderEvent,
  provider: EInvoiceProvider
): Promise<Outcome> {
  const payload = row.payload as Record<string, unknown>;
  const legalEntityId = String(payload.legalEntityId ?? "");
  const tin = typeof payload.tin === "string" ? payload.tin : null;
  const rows = await findLegalEntitiesByProviderId(
    row.provider,
    row.environment,
    legalEntityId,
    tin
  );
  if (rows.length === 0) return { status: "ignored", note: "legal entity not reserved by us" };
  const acube = asAcube(provider);
  // The event says something changed; the resource says what is true now.
  const current = acube ? await acube.getLegalEntity(legalEntityId) : null;
  for (const le of rows) {
    const patch = patchFromAcube({
      ...(current ?? {
        legalEntityId,
        tin: tin ?? le.tin,
        status: String(payload.status ?? ""),
        nameEn: (payload.name as string | undefined) ?? undefined,
      }),
      action: typeof payload.action === "string" ? payload.action : null,
    });
    if (patch.status === "active" && le.status !== "active") patch.activatedAt = new Date();
    patch.lastError = null;
    await updateLegalEntityRow(le.id, patch);
  }
  return { status: "processed", companyId: rows.length === 1 ? rows[0].companyId : null };
}

async function processRow(row: EInvoiceProviderEvent, provider: EInvoiceProvider) {
  switch (row.eventType as CanonicalEventType) {
    case "document.delivered":
      return handleDelivered(row, provider);
    case "document.received":
      return handleReceived(row, provider);
    case "legal_entity.synchronized":
      return handleLegalEntity(row, provider);
    default:
      return { status: "ignored", note: `unknown event ${row.eventType}` } as Outcome;
  }
}

export function eventBackoffMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

async function settle(row: EInvoiceProviderEvent, provider: EInvoiceProvider) {
  try {
    const out = await processRow(row, provider);
    await db
      .update(einvoiceProviderEvents)
      .set({
        status: out.status,
        processedAt: new Date(),
        lockedUntil: null,
        lastError: out.note ?? null,
        companyId: out.companyId ?? row.companyId ?? null,
      })
      .where(eq(einvoiceProviderEvents.id, row.id));
    return out.status;
  } catch (err) {
    const message = ((err as Error)?.message ?? String(err)).slice(0, 1000);
    const dead = row.attempts >= MAX_ATTEMPTS;
    await db
      .update(einvoiceProviderEvents)
      .set({
        status: dead ? "dead" : "pending",
        lockedUntil: null,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + eventBackoffMs(row.attempts)),
      })
      .where(eq(einvoiceProviderEvents.id, row.id));
    log.warn({ id: row.id, eventType: row.eventType, attempts: row.attempts }, "event retry");
    return dead ? "dead" : "retrying";
  }
}

/** Process due inbox rows (or one row by id). */
export async function runProviderEvents(
  opts: { id?: string; limit?: number; provider?: EInvoiceProvider } = {}
): Promise<{ claimed: number; processed: number; failed: number }> {
  let provider: EInvoiceProvider;
  try {
    provider = opts.provider ?? getEInvoiceProvider();
  } catch {
    return { claimed: 0, processed: 0, failed: 0 };
  }
  const rows = await claimEvents({ id: opts.id, limit: opts.limit ?? 25 });
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    const out = await settle(row, provider);
    if (out === "processed" || out === "ignored") processed++;
    else failed++;
  }
  return { claimed: rows.length, processed, failed };
}

/**
 * Polling fallback: refresh A-Cube documents still in flight (delivery queued/sending, or
 * delivered but not yet reported) and enqueue incoming documents not seen before.
 */
export async function runAcubePoll(
  opts: { provider?: EInvoiceProvider; now?: Date } = {}
): Promise<{ refreshed: number; enqueued: number }> {
  let provider: EInvoiceProvider;
  try {
    provider = opts.provider ?? getEInvoiceProvider();
  } catch {
    return { refreshed: 0, enqueued: 0 };
  }
  const acube = asAcube(provider);
  if (!acube) return { refreshed: 0, enqueued: 0 };
  const linked = await db
    .select({ id: einvoiceLegalEntities.id })
    .from(einvoiceLegalEntities)
    .where(
      and(
        eq(einvoiceLegalEntities.provider, ACUBE_PROVIDER_NAME),
        eq(einvoiceLegalEntities.environment, acube.environment),
        eq(einvoiceLegalEntities.status, "active")
      )
    )
    .limit(1);
  if (linked.length === 0) return { refreshed: 0, enqueued: 0 };

  const inFlight = await db
    .select()
    .from(einvoiceDocuments)
    .where(
      and(
        eq(einvoiceDocuments.provider, ACUBE_PROVIDER_NAME),
        sql`${einvoiceDocuments.providerMessageId} IS NOT NULL`,
        sql`(${einvoiceDocuments.deliveryStatus} IN ('queued', 'sending')
             OR (${einvoiceDocuments.deliveryStatus} = 'delivered'
                 AND ${einvoiceDocuments.reportingStatus} = 'pending'))`
      )
    )
    .limit(100);
  let refreshed = 0;
  for (const doc of inFlight) {
    const invoice = await storage.getInvoice(doc.invoiceId, doc.companyId);
    const company = await storage.getCompany(doc.companyId);
    if (!invoice || !company) continue;
    try {
      const r = await refreshAndPersist({ invoice, company, provider, source: "poll" });
      if (r.ok) refreshed++;
    } catch (err) {
      log.warn({ invoiceId: doc.invoiceId, err: (err as Error).message }, "poll refresh failed");
    }
  }

  let enqueued = 0;
  for (const item of await acube.listInbound()) {
    const payload = {
      documentId: item.providerMessageId,
      documentNumber: item.documentNumber ?? null,
      documentType: item.documentType === "381" ? "credit-note" : "invoice",
      status: "received",
      source: "poll",
    };
    // Same key as the webhook, so a document seen by both is processed once.
    const res = await enqueueProviderEvent({
      provider: ACUBE_PROVIDER_NAME,
      environment: acube.environment,
      type: "document.received",
      eventId: providerEventKey("document.received", payload),
      payload,
    });
    if (!res.duplicate) enqueued++;
  }
  return { refreshed, enqueued };
}

/** Counts for the settings card (last events, failures needing attention). */
export async function providerEventSummary(companyId: string) {
  const rows = await db
    .select({ status: einvoiceProviderEvents.status, n: sql<number>`count(*)::int` })
    .from(einvoiceProviderEvents)
    .where(
      and(
        eq(einvoiceProviderEvents.companyId, companyId),
        inArray(einvoiceProviderEvents.status, ["pending", "processing", "dead"])
      )
    )
    .groupBy(einvoiceProviderEvents.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
