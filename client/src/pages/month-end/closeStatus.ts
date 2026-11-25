/** Pure status model for the month-end close checklist card. */
export type CloseChecklistState = "loading" | "error" | "empty" | "incomplete" | "complete";

export interface CloseChecklistStatus {
  state: CloseChecklistState;
  done: number;
  total: number;
  remaining: number;
}

export function closeChecklistStatus(input: {
  isLoading: boolean;
  isError: boolean;
  items: Array<{ done: boolean }> | undefined;
}): CloseChecklistStatus {
  if (input.isLoading) return { state: "loading", done: 0, total: 0, remaining: 0 };
  // A failed load must never read as "7 remaining" or "all clear".
  if (input.isError || !input.items) return { state: "error", done: 0, total: 0, remaining: 0 };
  const total = input.items.length;
  const done = input.items.filter((i) => i.done).length;
  if (total === 0) return { state: "empty", done: 0, total: 0, remaining: 0 };
  const remaining = total - done;
  return { state: remaining === 0 ? "complete" : "incomplete", done, total, remaining };
}
