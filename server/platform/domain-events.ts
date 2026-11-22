/**
 * In-process domain events: the decoupled way for one module to react to
 * another (e.g. notifications on invoice.paid) without importing it.
 *
 *   emitDomainEvent("invoice.paid", { companyId, entityId: invoice.id, amountFils });
 *   onDomainEvent("invoice.paid", async (e) => { ... });
 *   onDomainEvent("*", (e) => audit(e));
 *
 * Semantics (frozen):
 *   - Handlers run after the current tick (setImmediate), never inside the
 *     emitter's call stack or transaction. Emit AFTER the DB commit.
 *   - Handler errors (sync throw or rejected promise) are logged and swallowed;
 *     they are never thrown to the emitter and never stop other handlers.
 *   - emitDomainEvent delivery is best-effort and in-memory: not durable across restarts.
 *   - F8: events that must not be lost are written with emitDomainEventInTx
 *     (server/platform/event-outbox.ts) inside the document transaction and delivered from the
 *     durable outbox to the same onDomainEvent handlers, at most once per (event id, handler)
 *     and with retry/backoff. Durable handlers get `payload.eventId`; name a handler with
 *     onDomainEvent(type, fn, { name }) so its delivery record survives a restart.
 */
import { createLogger } from "../config/logger";

const log = createLogger("domain-events");

/** Frozen catalogue of event names. Adding one is an API change. */
export const DOMAIN_EVENT_TYPES = [
  "invoice.created",
  "invoice.issued",
  "invoice.paid",
  "invoice.voided",
  "payment.received",
  "credit_note.issued",
  "bill.approved",
  "bill.paid",
  "contact.created",
  "payroll.approved",
  "payroll.paid",
  "bank.sync_failed",
  "compliance.deadline_due",
  "task.due",
  "receipt.posted",
  "budget.variance_alert",
  "security.suspicious_login",
] as const;
Object.freeze(DOMAIN_EVENT_TYPES);

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** Every payload carries the tenant, the entity id, and when it happened. */
export interface DomainEventBase {
  companyId: string;
  entityId: string;
  /** ISO-8601 timestamp. Filled in by emitDomainEvent when omitted. */
  occurredAt: string;
  /** Acting user, when there is one (scheduler jobs have none). */
  actorUserId?: string | null;
  /** F8: the durable outbox row id (only for events emitted with emitDomainEventInTx). */
  eventId?: string;
}

/**
 * Optional per-event payload extras. Amounts are integer fils (shared/money.ts).
 * Keep these small: handlers should re-read the entity if they need more.
 */
export interface DomainEventExtras {
  "invoice.created": { number?: string; totalFils?: number };
  "invoice.issued": { number?: string; totalFils?: number };
  "invoice.paid": { amountFils?: number };
  "invoice.voided": { reason?: string };
  "payment.received": { invoiceId?: string; amountFils?: number };
  "credit_note.issued": { invoiceId?: string; totalFils?: number };
  "bill.approved": { totalFils?: number };
  "bill.paid": { amountFils?: number };
  "contact.created": { kind?: "customer" | "vendor" | "other" };
  "payroll.approved": { periodMonth?: number; periodYear?: number };
  "payroll.paid": { periodMonth?: number; periodYear?: number };
  "bank.sync_failed": { provider?: string; reason?: string };
  "compliance.deadline_due": { obligation?: string; dueDate?: string };
  "task.due": { dueDate?: string };
  "receipt.posted": { journalEntryId?: string };
  "budget.variance_alert": {
    budgetId?: string;
    lineId?: string;
    period?: string;
    variancePct?: number;
  };
  /** W5-E: entityId is the user; companyId is their first company (or the user id). */
  "security.suspicious_login": { device?: string; network?: string };
}

export type DomainEventPayload<T extends DomainEventType> = DomainEventBase & DomainEventExtras[T];

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  [K in T]: { type: K; payload: DomainEventPayload<K> };
}[T];

export type DomainEventInput<T extends DomainEventType> = Omit<
  DomainEventPayload<T>,
  "occurredAt"
> & { occurredAt?: string | Date };

type Handler<T extends DomainEventType> = (
  event: DomainEvent<T>,
  signal?: AbortSignal
) => void | Promise<void>;
type AnyHandler = Handler<DomainEventType>;

/** Handlers per type, each with its delivery key (durable outbox dedup). */
const handlers = new Map<DomainEventType | "*", Map<AnyHandler, string>>();
const ordinals = new Map<string, number>();
const KNOWN = new Set<string>(DOMAIN_EVENT_TYPES);
let pending = 0;
const idleWaiters: Array<() => void> = [];

function settleOne(): void {
  pending -= 1;
  if (pending === 0) for (const resolve of idleWaiters.splice(0)) resolve();
}

export interface DomainEventHandlerOptions {
  /**
   * Stable handler name (F8). The durable outbox records each (event id, handler name) it
   * delivered, so a retried or duplicate dispatch never runs the handler twice. Unnamed
   * handlers get a key from their registration order.
   */
  name?: string;
}

/**
 * Subscribe to one event type or "*" (all). Returns an unsubscribe function.
 * Durable dispatch supplies a signal that aborts on its handler deadline. In-memory delivery
 * leaves it undefined.
 */
export function onDomainEvent<T extends DomainEventType>(
  type: T,
  handler: Handler<T>,
  opts?: DomainEventHandlerOptions
): () => void;
export function onDomainEvent(
  type: "*",
  handler: AnyHandler,
  opts?: DomainEventHandlerOptions
): () => void;
export function onDomainEvent(
  type: DomainEventType | "*",
  handler: AnyHandler,
  opts: DomainEventHandlerOptions = {}
): () => void {
  if (type !== "*" && !KNOWN.has(type)) throw new Error(`Unknown domain event type "${type}"`);
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Map()));
  let key = opts.name;
  if (!key) {
    const n = (ordinals.get(type) ?? 0) + 1;
    ordinals.set(type, n);
    key = `anon#${n}`;
  }
  set.set(handler, `${type}:${key}`);
  return () => {
    set?.delete(handler);
  };
}

/** Handlers (with delivery keys) that receive an event of `type`: its own plus "*". */
export function domainEventHandlersFor(
  type: DomainEventType
): Array<{ key: string; handler: AnyHandler }> {
  const out: Array<{ key: string; handler: AnyHandler }> = [];
  for (const scope of [type, "*"] as const) {
    for (const [handler, key] of handlers.get(scope) ?? []) out.push({ key, handler });
  }
  return out;
}

/** Build the frozen event object handlers receive (shared with the durable outbox). */
export function buildDomainEvent<T extends DomainEventType>(
  type: T,
  input: DomainEventInput<T>
): DomainEvent {
  if (!KNOWN.has(type)) throw new Error(`Unknown domain event type "${type}"`);
  if (!input || !input.companyId || !input.entityId) {
    throw new Error(`Domain event "${type}" requires companyId and entityId`);
  }
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : (input.occurredAt ?? new Date().toISOString());
  return {
    type,
    payload: Object.freeze({ ...input, occurredAt }),
  } as unknown as DomainEvent;
}

/**
 * Run `work` on a later tick and count it as in flight for drainDomainEvents (the durable
 * outbox's after-commit dispatch uses it, so tests and shutdown wait for it like an emit).
 */
export function trackDomainEventWork(work: () => Promise<unknown>): void {
  pending += 1;
  setImmediate(() => {
    Promise.resolve()
      .then(work)
      .catch((err: unknown) => log.error({ err }, "Domain event dispatch failed"))
      .finally(settleOne);
  });
}

/**
 * Emit an event. Returns immediately; handlers run on a later tick. Throws
 * only on programmer error (unknown type, missing companyId/entityId).
 */
export function emitDomainEvent<T extends DomainEventType>(
  type: T,
  input: DomainEventInput<T>
): void {
  const event = buildDomainEvent(type, input);
  const targets = domainEventHandlersFor(type).map((t) => t.handler);
  for (const handler of targets) {
    pending += 1;
    setImmediate(() => {
      let result: void | Promise<void>;
      try {
        result = handler(event);
      } catch (err) {
        log.error({ err, eventType: type }, "Domain event handler threw");
        settleOne();
        return;
      }
      Promise.resolve(result)
        .catch((err: unknown) =>
          log.error({ err, eventType: type }, "Domain event handler rejected")
        )
        .finally(settleOne);
    });
  }
}

/**
 * Resolves once every handler scheduled so far has settled. For tests and shutdown.
 * Yields one tick first so after-commit callbacks already queued by withLedgerTx (which
 * start durable outbox dispatches, F8) are counted.
 */
export async function drainDomainEvents(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (pending === 0) return;
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/** Remove all handlers. Tests only. */
export function resetDomainEventHandlers(): void {
  handlers.clear();
  ordinals.clear();
}
