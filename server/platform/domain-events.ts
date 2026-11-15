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
 *   - Delivery is best-effort and in-memory: not durable across restarts.
 *     Anything that must not be lost needs an outbox table (later wave).
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
}

export type DomainEventPayload<T extends DomainEventType> = DomainEventBase & DomainEventExtras[T];

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  [K in T]: { type: K; payload: DomainEventPayload<K> };
}[T];

export type DomainEventInput<T extends DomainEventType> = Omit<
  DomainEventPayload<T>,
  "occurredAt"
> & { occurredAt?: string | Date };

type Handler<T extends DomainEventType> = (event: DomainEvent<T>) => void | Promise<void>;
type AnyHandler = (event: DomainEvent) => void | Promise<void>;

const handlers = new Map<DomainEventType | "*", Set<AnyHandler>>();
const KNOWN = new Set<string>(DOMAIN_EVENT_TYPES);
let pending = 0;
const idleWaiters: Array<() => void> = [];

function settleOne(): void {
  pending -= 1;
  if (pending === 0) for (const resolve of idleWaiters.splice(0)) resolve();
}

/** Subscribe to one event type or "*" (all). Returns an unsubscribe function. */
export function onDomainEvent<T extends DomainEventType>(type: T, handler: Handler<T>): () => void;
export function onDomainEvent(type: "*", handler: AnyHandler): () => void;
export function onDomainEvent(type: DomainEventType | "*", handler: AnyHandler): () => void {
  if (type !== "*" && !KNOWN.has(type)) throw new Error(`Unknown domain event type "${type}"`);
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

/**
 * Emit an event. Returns immediately; handlers run on a later tick. Throws
 * only on programmer error (unknown type, missing companyId/entityId).
 */
export function emitDomainEvent<T extends DomainEventType>(
  type: T,
  input: DomainEventInput<T>
): void {
  if (!KNOWN.has(type)) throw new Error(`Unknown domain event type "${type}"`);
  if (!input || !input.companyId || !input.entityId) {
    throw new Error(`Domain event "${type}" requires companyId and entityId`);
  }
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : (input.occurredAt ?? new Date().toISOString());
  const event = {
    type,
    payload: Object.freeze({ ...input, occurredAt }),
  } as unknown as DomainEvent;

  const targets = [...(handlers.get(type) ?? []), ...(handlers.get("*") ?? [])];
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

/** Resolves once every handler scheduled so far has settled. For tests and shutdown. */
export function drainDomainEvents(): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/** Remove all handlers. Tests only. */
export function resetDomainEventHandlers(): void {
  handlers.clear();
}
