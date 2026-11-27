// F04 — month-end checklist progress, derived ONLY from a successful checklist
// response. No fabricated defaults: an unloaded / failed / empty checklist is
// reported as its own state, never as "0 of 7" or "All Clear".

export interface ChecklistItemLike {
  id: number | string;
  status: "complete" | "incomplete" | string;
}

export type ChecklistProgress =
  | { state: "loading" }
  | { state: "error" }
  | { state: "empty" }
  | {
      state: "ready";
      total: number;
      completed: number;
      remaining: number;
      allComplete: boolean;
      openItemIds: Array<number | string>;
    };

export function deriveChecklistProgress(args: {
  isLoading: boolean;
  isError: boolean;
  checklist: readonly ChecklistItemLike[] | null | undefined;
}): ChecklistProgress {
  if (args.isLoading) return { state: "loading" };
  if (args.isError || !Array.isArray(args.checklist)) return { state: "error" };
  if (args.checklist.length === 0) return { state: "empty" };
  const openItemIds = args.checklist.filter((i) => i.status !== "complete").map((i) => i.id);
  const total = args.checklist.length;
  const remaining = openItemIds.length;
  return {
    state: "ready",
    total,
    completed: total - remaining,
    remaining,
    allComplete: remaining === 0,
    openItemIds,
  };
}

export type CloseReadinessDecision =
  | { ok: true; openItemIds: Array<number | string> }
  | {
      ok: false;
      status: 409 | 422;
      code: "CLOSE_CHECKLIST_EMPTY" | "CLOSE_NOT_READY" | "CLOSE_STALE_CHECKLIST";
      message: string;
      openItemIds: Array<number | string>;
    };

/**
 * Server-side gate for the final lock transition. The server recomputes the
 * checklist and compares it against what the client last saw:
 *  - empty checklist → refuse (nothing was verified);
 *  - open items and no acknowledgement → refuse with the open items;
 *  - acknowledgement given for a different open-item set (stale screen) →
 *    refuse so the client revalidates before locking.
 */
export function evaluateCloseReadiness(args: {
  checklist: readonly ChecklistItemLike[];
  acknowledgedOpenItemIds?: ReadonlyArray<number | string> | null;
}): CloseReadinessDecision {
  if (args.checklist.length === 0) {
    return {
      ok: false,
      status: 422,
      code: "CLOSE_CHECKLIST_EMPTY",
      message: "The close checklist returned no items; the period cannot be verified.",
      openItemIds: [],
    };
  }
  const openItemIds = args.checklist.filter((i) => i.status !== "complete").map((i) => i.id);
  if (openItemIds.length === 0) return { ok: true, openItemIds };

  const ack = args.acknowledgedOpenItemIds;
  if (!ack) {
    return {
      ok: false,
      status: 409,
      code: "CLOSE_NOT_READY",
      message: `${openItemIds.length} checklist item(s) remain open. Review them or acknowledge to lock anyway.`,
      openItemIds,
    };
  }
  const key = (ids: ReadonlyArray<number | string>) => ids.map(String).sort().join(",");
  if (key(ack) !== key(openItemIds)) {
    return {
      ok: false,
      status: 409,
      code: "CLOSE_STALE_CHECKLIST",
      message: "The checklist changed since it was loaded. Review the refreshed checklist before locking.",
      openItemIds,
    };
  }
  return { ok: true, openItemIds };
}
