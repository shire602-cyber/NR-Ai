// F03 — report read state. A report figure is only shown as a number when the
// read for THIS company/period succeeded. A failed initial read is "error"
// (show retry, never AED 0.00); a failed refetch with last-known data for the
// same query key is "stale" (show the figures with a stale warning); a
// successful read with no rows is "ready" and may legitimately show zero.

export type ReportReadState = "idle" | "loading" | "error" | "stale" | "ready";

export function reportReadState(args: {
  enabled?: boolean;
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
}): ReportReadState {
  if (args.enabled === false) return "idle";
  if (args.isLoading) return "loading";
  if (args.isError) return args.hasData ? "stale" : "error";
  return args.hasData ? "ready" : "loading";
}

/** Report IDs whose data must not be exported because the read failed. */
export function unreadableReportIds(
  requestedReportIds: Iterable<string>,
  states: Record<string, ReportReadState>
): string[] {
  const out: string[] = [];
  for (const id of requestedReportIds) {
    if (states[id] === "error") out.push(id);
  }
  return out;
}
