export type SectionKind = "loading" | "offline" | "error" | "ready";

/**
 * What a list section may show. Empty UI is only allowed once a successful response supplied
 * data (`ready`); a paused (offline) uncached load, a failed first load and a disabled query are
 * never "empty". A failed background refresh keeps the cached data (`refreshFailed`).
 */
export function sectionState(q: {
  data: unknown;
  isError: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
}): { kind: SectionKind; refreshFailed: boolean } {
  if (q.data !== undefined) return { kind: "ready", refreshFailed: q.isError };
  if (q.fetchStatus === "paused") return { kind: "offline", refreshFailed: false };
  if (q.isError) return { kind: "error", refreshFailed: false };
  return { kind: "loading", refreshFailed: false };
}
