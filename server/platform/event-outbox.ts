/**
 * Durable transactional domain-event outbox (F8, migration 0115).
 *
 *   await withLedgerTx(async (tx) => {
 *     ... write the document ...
 *     await emitDomainEventInTx(tx, "bill.paid", { companyId, entityId: bill.id, amountFils });
 *   });
 *
 * The event row is inserted in `tx`, so it commits or rolls back with the document. Once the
 * outermost withLedgerTx commits, the row is dispatched on a later tick to the ordinary
 * onDomainEvent handlers; whatever is not delivered then (crash, handler error, no commit
 * hook) is picked up by the "events.outboxDispatch" job every minute.
 *
 * Delivery rules:
 *   - a row is claimed with FOR UPDATE SKIP LOCKED and a lease, so two dispatchers never run
 *     the same event at once;
 *   - each (event id, handler key) that succeeds is recorded in domain_event_deliveries and
 *     never run again, so a retried or duplicate dispatch delivers once per handler;
 *   - a failing handler leaves the row `pending` with exponential backoff; after max_attempts
 *     it is dead-lettered (`dead`, last_error kept) for an operator to inspect.
 * Handlers receive the same DomainEvent shape as an in-memory emit plus `payload.eventId`.
 * A crash between a handler's side effect and its delivery record can redeliver that one
 * handler (at-least-once); handlers with external effects can dedupe on `eventId`.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { createLogger } from "../config/logger";
import {
  domainEventDeliveries,
  domainEventOutbox,
  type DomainEventOutboxRow,
} from "../../shared/schema";
import type { LedgerTx } from "../ledger/types";
import { rowsOf, withLedgerTx } from "../ledger/tx";
import {
  buildDomainEvent,
  domainEventHandlersFor,
  trackDomainEventWork,
  type DomainEventInput,
  type DomainEventType,
} from "./domain-events";
import { listJobs, registerJob } from "./job-registry";

const log = createLogger("event-outbox");

export const EVENT_OUTBOX_JOB = "events.outboxDispatch";
export const DEFAULT_EVENT_MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 30_000; // 30 s, 1, 2, 4, 8 min ...
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const RETENTION_DAYS = 30;

export function eventBackoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

export interface EmitInTxOptions {
  maxAttempts?: number;
}

/**
 * Write a durable event inside `tx` (or in its own autocommit insert when `tx` is null) and
 * dispatch it after the commit. Returns the event id. Throws on programmer error (unknown
 * type, missing companyId/entityId) and on a failed insert, which aborts `tx` like any other
 * write in it: a document must not commit without its event.
 */
export async function emitDomainEventInTx<T extends DomainEventType>(
  tx: LedgerTx | null,
  type: T,
  input: DomainEventInput<T>,
  opts: EmitInTxOptions = {}
): Promise<string> {
  const event = buildDomainEvent(type, input);
  const payload = event.payload as unknown as Record<string, unknown>;
  const [row] = await (tx ?? db)
    .insert(domainEventOutbox)
    .values({
      eventType: type,
      companyId: isUuid(payload.companyId) ? String(payload.companyId) : null,
      entityId: String(payload.entityId),
      payload,
      maxAttempts: opts.maxAttempts ?? DEFAULT_EVENT_MAX_ATTEMPTS,
    })
    .returning({ id: domainEventOutbox.id });
  const id = row.id;
  const kick = () => trackDomainEventWork(() => dispatchDomainEvent(id));
  if (tx) {
    // Joins the outermost withLedgerTx's after-commit queue; for a transaction withLedgerTx did
    // not open it runs on the next tick, finds the row not yet visible and leaves it to the job.
    await withLedgerTx(async (_tx, { afterCommit }) => afterCommit(kick), tx);
  } else {
    kick();
  }
  return id;
}

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/** Claim due rows (or one row by id) for this dispatcher. */
async function claim(opts: { id?: string; limit: number }): Promise<DomainEventOutboxRow[]> {
  const res = await db.execute(sql`
    UPDATE domain_event_outbox o
       SET status = 'dispatching',
           attempts = o.attempts + 1,
           locked_until = now() + (${LEASE_MS}::int * interval '1 millisecond'),
           updated_at = now()
     WHERE o.id IN (
       SELECT id FROM domain_event_outbox
        WHERE ((status = 'pending' AND next_attempt_at <= now())
               OR (status = 'dispatching' AND locked_until < now()))
          ${opts.id ? sql`AND id = ${opts.id}` : sql``}
        ORDER BY created_at
        LIMIT ${opts.limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING o.id, o.event_type AS "eventType", o.payload, o.attempts,
              o.max_attempts AS "maxAttempts"`);
  return rowsOf<DomainEventOutboxRow>(res);
}

export type DispatchOutcome = "dispatched" | "retrying" | "dead";

async function deliver(row: DomainEventOutboxRow): Promise<DispatchOutcome> {
  const type = row.eventType as DomainEventType;
  const payload = { ...(row.payload as Record<string, unknown>), eventId: row.id };
  const event = buildDomainEvent(type, payload as unknown as DomainEventInput<typeof type>);
  const done = new Set(
    (
      await db
        .select({ handler: domainEventDeliveries.handler })
        .from(domainEventDeliveries)
        .where(eq(domainEventDeliveries.eventId, row.id))
    ).map((r) => r.handler)
  );
  const errors: string[] = [];
  for (const { key, handler } of domainEventHandlersFor(type)) {
    if (done.has(key)) continue;
    try {
      await handler(event);
    } catch (err) {
      errors.push(`${key}: ${(err as Error)?.message ?? String(err)}`.slice(0, 500));
      continue;
    }
    await db
      .insert(domainEventDeliveries)
      .values({ eventId: row.id, handler: key })
      .onConflictDoNothing();
  }
  if (errors.length === 0) {
    await db
      .update(domainEventOutbox)
      .set({
        status: "dispatched",
        dispatchedAt: new Date(),
        lockedUntil: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(domainEventOutbox.id, row.id));
    return "dispatched";
  }
  const lastError = errors.join("; ").slice(0, 2000);
  if (row.attempts >= row.maxAttempts) {
    await db
      .update(domainEventOutbox)
      .set({
        status: "dead",
        deadAt: new Date(),
        lockedUntil: null,
        lastError,
        updatedAt: new Date(),
      })
      .where(eq(domainEventOutbox.id, row.id));
    log.error({ eventId: row.id, eventType: type, lastError }, "Domain event dead-lettered");
    return "dead";
  }
  await db
    .update(domainEventOutbox)
    .set({
      status: "pending",
      nextAttemptAt: new Date(Date.now() + eventBackoffMs(row.attempts)),
      lockedUntil: null,
      lastError,
      updatedAt: new Date(),
    })
    .where(eq(domainEventOutbox.id, row.id));
  log.warn({ eventId: row.id, eventType: type, attempts: row.attempts }, "Domain event retry");
  return "retrying";
}

/** Dispatch one event now if it is due and unclaimed. Returns null when nothing was claimed. */
export async function dispatchDomainEvent(id: string): Promise<DispatchOutcome | null> {
  const [row] = await claim({ id, limit: 1 });
  return row ? deliver(row) : null;
}

/** One dispatcher tick: deliver due rows and prune old dispatched rows. */
export async function dispatchEventOutbox(
  limit = 200
): Promise<Partial<Record<DispatchOutcome, number>>> {
  const counts: Partial<Record<DispatchOutcome, number>> = {};
  const rows = await claim({ limit });
  for (const row of rows) {
    const outcome = await deliver(row).catch((err: unknown) => {
      log.error({ err, eventId: row.id }, "Domain event delivery crashed; lease will expire");
      return null;
    });
    if (outcome) counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  await db
    .delete(domainEventOutbox)
    .where(
      and(
        eq(domainEventOutbox.status, "dispatched"),
        lt(
          domainEventOutbox.dispatchedAt,
          new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
        )
      )
    );
  return counts;
}

/** Register the dispatcher job (every minute). Idempotent. */
export function registerEventOutboxJob(): void {
  if (listJobs().some((j) => j.name === EVENT_OUTBOX_JOB)) return;
  registerJob({
    name: EVENT_OUTBOX_JOB,
    cron: "* * * * *",
    description:
      "Deliver durable domain events; retry with backoff; dead-letter after max attempts",
    run: async () => {
      const counts = await dispatchEventOutbox();
      if (Object.keys(counts).length) log.info(counts, "Domain event outbox tick");
    },
  });
}
