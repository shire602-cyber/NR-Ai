/**
 * Document state machines (frozen API).
 *
 *   const invoiceMachine = defineMachine({
 *     states: ["draft", "sent", "paid", "void"],
 *     transitions: { draft: ["sent", "void"], sent: ["paid", "void"] },
 *   });
 *   assertTransition(invoiceMachine, inv.status, "sent");      // 409 INVALID_TRANSITION
 *   const row = await transitionRow(tx, invoices, id, "draft", "sent", { sentAt: new Date() },
 *     { machine: invoiceMachine });
 *   if (!row) throw new DomainError("INVOICE_NOT_DRAFT", 409);  // lost the race
 *
 * transitionRow is ONE conditional statement:
 *   UPDATE <table> SET status = $to, ...patch WHERE id = $id AND status IN ($from) RETURNING *
 * so two concurrent callers can never both win. It returns null when no row
 * matched (wrong state, or someone else got there first).
 */
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { DomainError } from "../errors";
import type { LedgerTx } from "./types";

export interface MachineSpec<S extends string> {
  states: readonly S[];
  /** from -> allowed targets. States with no entry are terminal. */
  transitions: Partial<Record<S, readonly S[]>>;
}

export interface Machine<S extends string> {
  readonly states: readonly S[];
  readonly transitions: Readonly<Partial<Record<S, readonly S[]>>>;
  can(from: string, to: string): boolean;
  isTerminal(state: string): boolean;
}

export function defineMachine<S extends string>(spec: MachineSpec<S>): Machine<S> {
  const states = new Set<string>(spec.states);
  if (states.size === 0) throw new Error("defineMachine: no states");
  if (states.size !== spec.states.length) throw new Error("defineMachine: duplicate state");
  for (const [from, tos] of Object.entries(spec.transitions) as Array<[string, readonly S[]]>) {
    if (!states.has(from)) throw new Error(`defineMachine: unknown state "${from}"`);
    for (const to of tos ?? []) {
      if (!states.has(to)) throw new Error(`defineMachine: unknown target "${to}" from "${from}"`);
      if (to === from) throw new Error(`defineMachine: self-transition on "${from}"`);
    }
  }
  const frozen = Object.freeze({
    states: Object.freeze([...spec.states]) as readonly S[],
    transitions: Object.freeze({ ...spec.transitions }),
    can(from: string, to: string): boolean {
      const allowed = (spec.transitions as Record<string, readonly string[] | undefined>)[from];
      return !!allowed && allowed.includes(to);
    },
    isTerminal(state: string): boolean {
      const allowed = (spec.transitions as Record<string, readonly string[] | undefined>)[state];
      return !allowed || allowed.length === 0;
    },
  });
  return frozen;
}

/** Throws DomainError INVALID_TRANSITION (409) unless from -> to is allowed. */
export function assertTransition<S extends string>(
  machine: Machine<S>,
  from: string,
  to: string
): void {
  if (!machine.states.includes(from as S) || !machine.states.includes(to as S)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      409,
      { from, to },
      `Unknown state "${from}" or "${to}"`
    );
  }
  if (!machine.can(from, to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      409,
      { from, to },
      `Cannot move from "${from}" to "${to}"`
    );
  }
}

/** Any drizzle table with an `id` and a `status` column. */
export type StatusTable = PgTable & { id: PgColumn; status: PgColumn };

export interface TransitionOptions<S extends string> {
  /** Validate every (from, to) pair against this machine first (409 INVALID_TRANSITION). */
  machine?: Machine<S>;
  /** Extra WHERE condition, e.g. eq(table.companyId, companyId). */
  where?: SQL;
}

/**
 * Conditional state change. Returns the updated row, or null when the row is
 * not (or no longer) in `from`.
 */
export async function transitionRow<Row = Record<string, unknown>, S extends string = string>(
  tx: LedgerTx,
  table: StatusTable,
  id: string,
  from: S | readonly S[],
  to: S,
  patch: Record<string, unknown> = {},
  opts: TransitionOptions<S> = {}
): Promise<Row | null> {
  const fromList = (Array.isArray(from) ? from : [from]) as readonly S[];
  if (fromList.length === 0) throw new Error("transitionRow: empty from-state list");
  if (opts.machine) for (const f of fromList) assertTransition(opts.machine, f, to);
  if ("status" in patch)
    throw new Error("transitionRow: pass the target state as `to`, not in patch");
  const statusCond =
    fromList.length === 1 ? eq(table.status, fromList[0]) : inArray(table.status, [...fromList]);
  const rows = await tx
    .update(table)
    .set({ ...patch, status: to })
    .where(and(eq(table.id, id), statusCond, opts.where))
    .returning();
  return (rows[0] as Row | undefined) ?? null;
}

// ─── Journal entry lifecycle ─────────────────────────────────────────────
//
// `status` (draft | posted | void) is the LEDGER-EFFECT column every report
// filters on; a reversed or voided original stays status = "posted" because
// its offsetting reversal is posted too (the pair nets to zero). The
// lifecycle below is derived: posted + reversed_by_entry_id + reversal_kind.
// "void" is the legacy status for pre-kernel voids and is terminal.

export const JOURNAL_LIFECYCLE_STATES = ["draft", "posted", "reversed", "voided", "void"] as const;
export type JournalLifecycleState = (typeof JOURNAL_LIFECYCLE_STATES)[number];

export const journalMachine = defineMachine<JournalLifecycleState>({
  states: JOURNAL_LIFECYCLE_STATES,
  transitions: {
    draft: ["posted"],
    posted: ["reversed", "voided"],
  },
});

/** Derive the lifecycle state of a journal entry row. */
export function journalLifecycle(entry: {
  status: string;
  reversedByEntryId?: string | null;
  reversalKind?: string | null;
}): JournalLifecycleState {
  if (entry.status === "draft") return "draft";
  if (entry.status === "void") return "void";
  if (entry.reversedByEntryId) return entry.reversalKind === "voided" ? "voided" : "reversed";
  return "posted";
}
