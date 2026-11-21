/**
 * Durable inbox for ASP events (E1, A-Cube; E2 made provider-neutral for Complyance).
 *
 * Webhooks are answered 200 as soon as the signed request is stored in einvoice_provider_events
 * (unique per provider event id, so A-Cube's 15 retries over ~10 h land on one row). The
 * "einvoice.providerEvents" job claims due rows (FOR UPDATE SKIP LOCKED + lease), processes them
 * and backs off on failure; the "einvoice.acubePoll" job is the fallback when a webhook is late
 * or lost: it refreshes documents still in flight and enqueues incoming documents it has not
 * seen, through the same inbox.
 *
 * Processing never trusts the payload's status: it re-reads the resource from the provider. E2: the
 * provider-specific reads go through optional EInvoiceProvider hooks (inboundOwner, fetchSource,
 * legalEntityPatch, listInbound), so this file names no provider; webhook routes normalise each
 * provider's payload to { documentId, documentType, status } before enqueueing.
 *   document.delivered (invoice.outbound / credit_note.outbound) -> refresh delivery + reporting
 *   document.received  (invoice.inbound / credit_note.inbound)   -> fetch source XML ->
 *                        processInboundEInvoice (a DRAFT bill tagged origin "einvoice")
 *   legal_entity.synchronized                                    -> update the legal entity
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import type { EInvoiceDocumentRef, EInvoiceProvider } from "../einvoice-provider";
import { processInboundEInvoice } from "./inbound";
import { refreshAndPersist } from "./workflow";
import {
  findLegalEntitiesByProviderId,
  getLegalEntity,
  peppolAddressFor,
  updateLegalEntityRowIfCurrent,
} from "./legal-entities";
import { getCompanyEInvoiceProvider } from "./providers/company-provider";
import { providerModule } from "./providers/registry";
import { isCreditNoteDocumentType, isUaeTin } from "./pint-ae-codes";
import { projectEInvoiceLegacyStatus } from "./tracks";

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

/** Inbound webhooks and the poll discover the same immutable provider document. */
export function providerEventKey(type: CanonicalEventType, payload: Record<string, unknown>) {
  if (type === "document.received") return `doc:${String(payload.documentId)}:received`;
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
  companyId: string;
}): Promise<{ id: string | null; duplicate: boolean }> {
  const rows = await db
    .insert(einvoiceProviderEvents)
    .values({
      provider: args.provider,
      environment: args.environment,
      eventId: `${args.companyId}:${createHash("sha256").update(args.eventId).digest("hex")}`,
      eventType: args.type,
      companyId: args.companyId,
      payload: args.payload,
    })
    .onConflictDoNothing()
    .returning({ id: einvoiceProviderEvents.id });
  return { id: rows[0]?.id ?? null, duplicate: rows.length === 0 };
}

async function claimEvents(opts: {
  id?: string;
  companyId?: string;
  provider?: EInvoiceProvider;
  limit: number;
}): Promise<EInvoiceProviderEvent[]> {
  // A later activation can recover legacy onboarding ignores. Routine syncs only update the
  // entity's sync timestamps and do not make a previously ignored event eligible.
  const res = await db.execute(sql`
    UPDATE einvoice_provider_events e
       SET status = 'processing',
           attempts = e.attempts + 1,
           locked_until = now() + (${LEASE_MS}::int * interval '1 millisecond')
     WHERE e.id IN (
       SELECT candidate.id
         FROM einvoice_provider_events candidate
         LEFT JOIN einvoice_legal_entities entity
           ON entity.company_id = candidate.company_id
          AND entity.provider = candidate.provider
          AND entity.environment = candidate.environment
        WHERE ((candidate.status = 'pending' AND candidate.next_attempt_at <= now())
               OR (candidate.status = 'processing' AND candidate.locked_until < now())
               OR (candidate.event_type = 'document.received'
                   AND candidate.status = 'ignored'
                   AND candidate.last_error IN ('document belongs to no company of ours',
                                                'legal entity is not active')
                   AND COALESCE(entity.activated_at, entity.created_at) > candidate.processed_at)
               OR (candidate.event_type = 'document.received' AND candidate.status = 'processed'
                   AND EXISTS (
                     SELECT 1
                       FROM einvoice_inbound_documents incomplete
                       JOIN einvoice_archive archive ON archive.company_id = incomplete.company_id
                        AND archive.sha256 = incomplete.sha256
                      WHERE incomplete.company_id = candidate.company_id
                        AND incomplete.document_type IN ('380', '480')
                        AND incomplete.status IN ('failed', 'received', 'bill_created')
                        AND incomplete.bill_id IS NULL
                        AND archive.direction = 'inbound' AND archive.kind = 'received'
                        AND archive.provider_message_id = candidate.payload->>'documentId'
                        AND (archive.provider IS NULL OR archive.provider = candidate.provider)
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM einvoice_provider_events other
                      WHERE other.company_id = candidate.company_id
                        AND other.event_type = 'document.received'
                        AND other.payload->>'documentId' = candidate.payload->>'documentId'
                        AND (other.provider <> candidate.provider
                             OR other.environment <> candidate.environment)
                   )))
          AND (candidate.event_type <> 'document.received' OR candidate.company_id IS NULL
               OR entity.status = 'active')
          ${opts.id ? sql`AND candidate.id = ${opts.id}` : sql``}
          ${opts.companyId ? sql`AND candidate.company_id = ${opts.companyId}` : sql``}
          ${opts.provider ? sql`AND candidate.provider = ${opts.provider.name} AND candidate.environment = ${opts.provider.environment}` : sql``}
        ORDER BY candidate.received_at
        LIMIT ${opts.limit}
        FOR UPDATE OF candidate SKIP LOCKED)
    RETURNING e.id, e.provider, e.environment, e.event_id AS "eventId",
              e.event_type AS "eventType", e.company_id AS "companyId", e.payload,
              e.status, e.attempts, e.next_attempt_at AS "nextAttemptAt",
              e.locked_until AS "lockedUntil", e.last_error AS "lastError",
              e.received_at AS "receivedAt", e.processed_at AS "processedAt"`);
  return rowsOf<EInvoiceProviderEvent>(res);
}

type Outcome =
  | { status: "processed" | "ignored"; companyId?: string | null; note?: string }
  | { status: "awaiting-onboarding" };
type CompanyEvent = EInvoiceProviderEvent & { companyId: string };

async function handleDelivered(row: CompanyEvent, provider: EInvoiceProvider): Promise<Outcome> {
  const payload = row.payload as Record<string, unknown>;
  const documentId = String(payload.documentId ?? "");
  const docs = await db
    .select()
    .from(einvoiceDocuments)
    .where(
      and(
        eq(einvoiceDocuments.companyId, row.companyId),
        eq(einvoiceDocuments.provider, row.provider),
        eq(einvoiceDocuments.providerMessageId, documentId),
        sql`${einvoiceDocuments.validation}->'submission'->>'environment' = ${row.environment}`
      )
    )
    .limit(2);
  const [doc] = docs;
  if (!doc) {
    // The callback can arrive before the sender commits the provider message ID.
    if (row.attempts < 3) throw new Error("Provider document is not attached yet");
    return { status: "ignored", note: "no document in this company and environment" };
  }
  if (docs.length > 1) {
    return { status: "ignored", note: "provider document id is ambiguous" };
  }
  const invoice = await storage.getInvoice(doc.invoiceId, doc.companyId);
  const company = await storage.getCompany(doc.companyId);
  if (!invoice || !company) return { status: "ignored", note: "invoice or company gone" };
  const observedStatus = projectEInvoiceLegacyStatus(
    provider.name,
    doc.providerStatus,
    invoice.einvoiceStatus,
    doc.reportingStatus
  );
  if (observedStatus === "cleared") {
    return { status: "ignored", companyId: company.id, note: "already delivered and reported" };
  }
  const r = await refreshAndPersist({
    invoice,
    company,
    provider,
    source: "webhook",
    providerEventId: row.eventId,
  });
  if (!r.ok && r.status >= 500) throw new Error("Provider status could not be refreshed");
  return { status: "processed", companyId: company.id };
}

async function handleReceived(row: CompanyEvent, provider: EInvoiceProvider): Promise<Outcome> {
  if (!provider.inboundOwner || !provider.fetchSource) {
    return { status: "ignored", note: "provider has no document API" };
  }
  const payload = row.payload as Record<string, unknown>;
  const documentId = String(payload.documentId ?? "");
  const rawCode = String(payload.documentTypeCode ?? "");
  const documentCollection =
    payload.documentCollection === "invoice" || payload.documentCollection === "credit-note"
      ? payload.documentCollection
      : payload.documentType === "credit-note" || isCreditNoteDocumentType(rawCode)
        ? "credit-note"
        : "invoice";
  const ref: EInvoiceDocumentRef = {
    documentCollection,
    documentType: /^\d{2,3}$/.test(rawCode)
      ? rawCode
      : documentCollection === "credit-note"
        ? "381"
        : "380",
  };
  const owner = await provider.inboundOwner(documentId, ref, payload);
  const matches = await findLegalEntitiesByProviderId(
    row.provider,
    row.environment,
    owner.legalEntityId,
    owner.tin,
    row.companyId
  );
  if (matches.length === 0) {
    // Onboarding can change while the provider read is in flight.
    const current = await getLegalEntity(row.companyId, row.provider, row.environment);
    if (current?.status !== "active") return { status: "awaiting-onboarding" };
    return { status: "ignored", note: "document does not match the linked legal entity" };
  }
  if (matches.length > 1) {
    // Never post a supplier's invoice into a guessed company.
    return { status: "ignored", note: "legal entity is linked to more than one company" };
  }
  const le = matches[0];
  if (le.status !== "active") return { status: "awaiting-onboarding" };
  const company = await storage.getCompany(le.companyId);
  if (!company) return { status: "ignored", note: "company gone" };
  const xml = await provider.fetchSource(documentId, ref);
  try {
    const received = await processInboundEInvoice({
      company: company as Company & { peppolParticipantId?: string | null },
      xml,
      provider: row.provider,
      providerMessageId: documentId,
    });
    if (received.status >= 500) throw new Error("Inbound e-invoice processing is unavailable");
    if (received.body.status === "invalid") {
      return {
        status: "processed",
        companyId: company.id,
        note: "inbound document failed validation",
      };
    }
    if (
      received.body.status !== "received" &&
      received.body.status !== "credit_created" &&
      !(received.body.status === "bill_created" && typeof received.body.billId === "string")
    ) {
      throw new Error("Inbound e-invoice processing is incomplete");
    }
  } catch (err) {
    // A rejected document is final. Operational errors (including an unavailable draft owner
    // or a locked accounting period) remain visible to the inbox retry job.
    const code = (err as { code?: string } | null)?.code;
    if (
      ![
        "EINVOICE_INBOUND_INVALID",
        "EINVOICE_INBOUND_UNPARSEABLE",
        "EINVOICE_INBOUND_WRONG_RECIPIENT",
      ].includes(code ?? "")
    )
      throw err;
    return {
      status: "ignored",
      companyId: company.id,
      note: "inbound document failed validation",
    };
  }
  return { status: "processed", companyId: company.id };
}

async function handleLegalEntity(row: CompanyEvent, provider: EInvoiceProvider): Promise<Outcome> {
  const payload = row.payload as Record<string, unknown>;
  const legalEntityId = String(payload.legalEntityId ?? "");
  const tin = typeof payload.tin === "string" ? payload.tin : null;
  const rows = await findLegalEntitiesByProviderId(
    row.provider,
    row.environment,
    legalEntityId,
    tin,
    row.companyId
  );
  if (rows.length === 0) return { status: "ignored", note: "legal entity not reserved by us" };
  const [entity] = rows;
  if (!isUaeTin(entity.tin)) {
    return { status: "ignored", note: "stored taxpayer identity is invalid" };
  }
  if (tin && tin !== entity.tin) {
    return { status: "ignored", note: "event names a different taxpayer" };
  }
  const confirmedId = entity.legalEntityId ?? legalEntityId;
  // The event says something changed; the resource says what is true now.
  const current =
    provider.legalEntityPatch && confirmedId
      ? await provider.legalEntityPatch(confirmedId, payload, entity.tin).catch((err: unknown) => {
          if ((err as { code?: string } | null)?.code === "EINVOICE_PROVIDER_TIN_MISMATCH") {
            return false as const;
          }
          throw err;
        })
      : null;
  if (current === false) {
    return { status: "ignored", note: "provider returned a different legal entity" };
  }
  if (!current) throw new Error("Legal entity status could not be confirmed");
  if (
    (current.legalEntityId && current.legalEntityId !== confirmedId) ||
    (current.peppolAddress && current.peppolAddress !== peppolAddressFor(entity.tin))
  ) {
    return { status: "ignored", note: "provider returned a different legal entity" };
  }
  if (current.status === "active" && entity.status !== "active") current.activatedAt = new Date();
  if (!(await updateLegalEntityRowIfCurrent(entity, { ...current, lastError: null }))) {
    return { status: "ignored", note: "legal entity changed while the event was being verified" };
  }
  return { status: "processed", companyId: entity.companyId };
}

async function processRow(row: CompanyEvent, provider: EInvoiceProvider) {
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

async function settle(row: EInvoiceProviderEvent, provider?: EInvoiceProvider) {
  const claim = and(
    eq(einvoiceProviderEvents.id, row.id),
    eq(einvoiceProviderEvents.attempts, row.attempts),
    eq(einvoiceProviderEvents.status, "processing")
  );
  try {
    const { companyId } = row;
    const out: Outcome = companyId
      ? await processRow(
          { ...row, companyId },
          provider ??
            (await getCompanyEInvoiceProvider(companyId, {
              provider: row.provider,
              environment: row.environment,
            }))
        )
      : { status: "ignored", note: "event had no verified company scope" };
    if (out.status === "awaiting-onboarding") {
      await db
        .update(einvoiceProviderEvents)
        .set({ status: "pending", processedAt: null, lockedUntil: null, lastError: null })
        .where(claim);
      return "deferred";
    }
    await db
      .update(einvoiceProviderEvents)
      .set({
        status: out.status,
        processedAt: new Date(),
        lockedUntil: null,
        lastError: out.note ?? null,
        companyId: out.companyId ?? row.companyId ?? null,
      })
      .where(claim);
    return out.status;
  } catch {
    const dead = row.attempts >= MAX_ATTEMPTS;
    await db
      .update(einvoiceProviderEvents)
      .set({
        status: dead ? "dead" : "pending",
        processedAt: null,
        lockedUntil: null,
        lastError: "Provider event could not be processed",
        nextAttemptAt: new Date(Date.now() + eventBackoffMs(row.attempts)),
      })
      .where(claim);
    log.warn({ id: row.id, eventType: row.eventType, attempts: row.attempts }, "event retry");
    return dead ? "dead" : "retrying";
  }
}

/** Process due inbox rows (or one row by id). */
export async function runProviderEvents(
  opts: { id?: string; companyId?: string; limit?: number; provider?: EInvoiceProvider } = {}
): Promise<{ claimed: number; processed: number; failed: number }> {
  const provider = opts.companyId || opts.id ? opts.provider : undefined;
  const rows = await claimEvents({ ...opts, limit: opts.limit ?? 25, provider });
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    const out = await settle(row, provider);
    if (out === "processed" || out === "ignored") processed++;
    else if (out !== "deferred") failed++;
  }
  return { claimed: rows.length, processed, failed };
}

/**
 * Polling fallback (E1; provider-neutral since E2): refresh the provider's documents still in
 * flight (delivery, recipient decision or reporting) and enqueue incoming documents not seen before.
 * Runs only for `providerName` (each provider has its own job).
 */
export async function runProviderPoll(
  providerName: string,
  opts: { provider?: EInvoiceProvider; companyId?: string; now?: Date } = {}
): Promise<{ refreshed: number; enqueued: number }> {
  const module = providerModule(providerName);
  if (!module || (opts.provider && opts.provider.name !== providerName)) {
    return { refreshed: 0, enqueued: 0 };
  }
  const environment = opts.provider?.environment ?? module.environment(process.env);
  const providers = new Map<string, Promise<EInvoiceProvider | null>>();
  function resolve(companyId: string): Promise<EInvoiceProvider | null> {
    const existing = providers.get(companyId);
    if (existing) return existing;
    const provider =
      opts.provider && opts.companyId === companyId
        ? Promise.resolve(opts.provider)
        : getCompanyEInvoiceProvider(companyId, { provider: providerName, environment }).catch(
            () => null
          );
    providers.set(companyId, provider);
    return provider;
  }

  // Both providers can acknowledge recipient receipt before the final buyer decision.
  const awaitingFollowUp =
    providerName === "acube"
      ? sql`(${einvoiceDocuments.status} = 'submitted'
             OR (${einvoiceDocuments.status} IN ('accepted', 'cleared')
                 AND lower(btrim(${einvoiceDocuments.providerStatus})) IS DISTINCT FROM 'accepted'))`
      : sql`(${einvoiceDocuments.reportingStatus} = 'pending'
             OR lower(btrim(${einvoiceDocuments.providerStatus})) = 'delivery_success')`;
  const retryableDeliveryFailure =
    providerName === "acube"
      ? sql`OR ${einvoiceDocuments.deliveryStatus} = 'delivery_failed'`
      : sql``;
  const inFlight = await db
    .select()
    .from(einvoiceDocuments)
    .where(
      and(
        eq(einvoiceDocuments.provider, providerName),
        opts.companyId ? eq(einvoiceDocuments.companyId, opts.companyId) : undefined,
        sql`${einvoiceDocuments.validation}->'submission'->>'environment' = ${environment}`,
        sql`${einvoiceDocuments.providerMessageId} IS NOT NULL`,
        sql`(${einvoiceDocuments.deliveryStatus} IN ('queued', 'sending')
             ${retryableDeliveryFailure}
             OR (${einvoiceDocuments.deliveryStatus} = 'delivered'
                 AND ${awaitingFollowUp}))`
      )
    )
    .orderBy(asc(einvoiceDocuments.updatedAt), asc(einvoiceDocuments.id));
  let refreshed = 0;
  for (const doc of inFlight) {
    const provider = await resolve(doc.companyId);
    if (!provider?.capabilities.getStatus) continue;
    try {
      const invoice = await storage.getInvoice(doc.invoiceId, doc.companyId);
      const company = await storage.getCompany(doc.companyId);
      if (!invoice || !company) continue;
      const r = await refreshAndPersist({ invoice, company, provider, source: "poll" });
      if (r.ok) refreshed++;
    } catch {
      log.warn({ invoiceId: doc.invoiceId }, "poll refresh failed");
    }
  }

  const linked = await db
    .select({
      companyId: einvoiceLegalEntities.companyId,
      legalEntityId: einvoiceLegalEntities.legalEntityId,
      tin: einvoiceLegalEntities.tin,
    })
    .from(einvoiceLegalEntities)
    .where(
      and(
        eq(einvoiceLegalEntities.provider, providerName),
        eq(einvoiceLegalEntities.environment, environment),
        eq(einvoiceLegalEntities.status, "active"),
        opts.companyId ? eq(einvoiceLegalEntities.companyId, opts.companyId) : undefined
      )
    );
  let enqueued = 0;
  for (const entity of linked) {
    if (!entity.legalEntityId) continue;
    const provider = await resolve(entity.companyId);
    if (!provider?.listInbound) continue;
    try {
      for (const item of await provider.listInbound({ legalEntityIds: [entity.legalEntityId] })) {
        if (item.legalEntityId && item.legalEntityId !== entity.legalEntityId) continue;
        if (!item.legalEntityId && item.ownerFiscalId && item.ownerFiscalId !== entity.tin)
          continue;
        const documentCollection =
          item.documentCollection ??
          (isCreditNoteDocumentType(item.documentType) ? "credit-note" : "invoice");
        const payload: Record<string, unknown> = {
          documentId: item.providerMessageId,
          documentNumber: item.documentNumber ?? null,
          documentType: documentCollection,
          documentCollection,
          documentTypeCode: item.documentType,
          status: "received",
          source: "poll",
        };
        if (item.legalEntityId) payload.ownerLegalEntityId = item.legalEntityId;
        const res = await enqueueProviderEvent({
          provider: providerName,
          environment,
          companyId: entity.companyId,
          type: "document.received",
          eventId: providerEventKey("document.received", payload),
          payload,
        });
        if (!res.duplicate) enqueued++;
      }
    } catch {
      log.warn(
        { companyId: entity.companyId, provider: providerName },
        "provider inbox poll failed"
      );
    }
  }
  return { refreshed, enqueued };
}

/** E1: the A-Cube poll job (einvoice.acubePoll); see runProviderPoll. */
export function runAcubePoll(
  opts: { provider?: EInvoiceProvider; companyId?: string; now?: Date } = {}
): Promise<{ refreshed: number; enqueued: number }> {
  return runProviderPoll("acube", opts);
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
