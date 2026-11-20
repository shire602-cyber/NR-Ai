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
import type { EInvoiceProvider } from "../einvoice-provider";
import { processInboundEInvoice } from "./inbound";
import { refreshAndPersist } from "./workflow";
import {
  findLegalEntitiesByProviderId,
  peppolAddressFor,
  updateLegalEntityRow,
} from "./legal-entities";
import { getCompanyEInvoiceProvider } from "./providers/company-provider";
import { providerModule } from "./providers/registry";

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
          ${opts.companyId ? sql`AND company_id = ${opts.companyId}` : sql``}
          ${opts.provider ? sql`AND provider = ${opts.provider.name} AND environment = ${opts.provider.environment}` : sql``}
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
  if (!r.ok && r.status >= 500) throw new Error("Provider status could not be refreshed");
  return { status: "processed", companyId: company.id };
}

async function handleReceived(row: CompanyEvent, provider: EInvoiceProvider): Promise<Outcome> {
  if (!provider.inboundOwner || !provider.fetchSource) {
    return { status: "ignored", note: "provider has no document API" };
  }
  const payload = row.payload as Record<string, unknown>;
  const documentId = String(payload.documentId ?? "");
  const code = String(payload.documentTypeCode ?? "");
  const documentType =
    code === "81" || code === "480" || code === "381"
      ? code
      : payload.documentType === "credit-note"
        ? "381"
        : "380";
  const owner = await provider.inboundOwner(documentId, { documentType }, payload);
  const matches = await findLegalEntitiesByProviderId(
    row.provider,
    row.environment,
    owner.legalEntityId,
    owner.tin,
    row.companyId
  );
  if (matches.length === 0) {
    return { status: "ignored", note: "document belongs to no company of ours" };
  }
  if (matches.length > 1) {
    // Never post a supplier's invoice into a guessed company.
    return { status: "ignored", note: "legal entity is linked to more than one company" };
  }
  const le = matches[0];
  if (le.status !== "active") return { status: "ignored", note: "legal entity is not active" };
  const company = await storage.getCompany(le.companyId);
  if (!company) return { status: "ignored", note: "company gone" };
  const xml = await provider.fetchSource(documentId, { documentType });
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
    return {
      status: "processed",
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
  const confirmedId = entity.legalEntityId ?? legalEntityId;
  // The event says something changed; the resource says what is true now.
  const current =
    provider.legalEntityPatch && confirmedId
      ? await provider.legalEntityPatch(confirmedId, payload)
      : null;
  if (!current) throw new Error("Legal entity status could not be confirmed");
  if (
    (current.legalEntityId && current.legalEntityId !== confirmedId) ||
    (current.peppolAddress && current.peppolAddress !== peppolAddressFor(entity.tin))
  ) {
    return { status: "ignored", note: "provider returned a different legal entity" };
  }
  if (current.status === "active" && entity.status !== "active") current.activatedAt = new Date();
  await updateLegalEntityRow(entity.id, { ...current, lastError: null });
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
    else failed++;
  }
  return { claimed: rows.length, processed, failed };
}

/**
 * Polling fallback (E1; provider-neutral since E2): refresh the provider's documents still in
 * flight (delivery queued/sending, or delivered but not yet reported) and enqueue incoming
 * documents not seen before. Runs only for `providerName` (each provider has its own job).
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
             OR (${einvoiceDocuments.deliveryStatus} = 'delivered'
                 AND ${einvoiceDocuments.reportingStatus} = 'pending'))`
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
        const payload: Record<string, unknown> = {
          documentId: item.providerMessageId,
          documentNumber: item.documentNumber ?? null,
          documentType:
            item.documentType === "381" || item.documentType === "81" ? "credit-note" : "invoice",
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
