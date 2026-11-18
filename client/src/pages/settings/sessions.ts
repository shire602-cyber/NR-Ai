/**
 * Security → devices (spec 3.15): identical sessions (same device description and
 * network address) collapse into one row with a count; the current device comes first,
 * then the most recently used.
 */
export interface SessionLike {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  current: boolean;
}

export interface SessionGroup<S extends SessionLike> {
  key: string;
  /** The most recently used session of the group (the current one when present). */
  lead: S;
  ids: string[];
  count: number;
  current: boolean;
}

const lastUsed = (s: SessionLike) => Date.parse(s.lastUsedAt ?? s.createdAt) || 0;

export function collapseSessions<S extends SessionLike>(
  sessions: readonly S[],
  describe: (userAgent: string | null) => string
): SessionGroup<S>[] {
  const groups = new Map<string, SessionGroup<S>>();
  for (const s of sessions) {
    const key = `${describe(s.userAgent)}|${s.ipAddress ?? ""}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, lead: s, ids: [s.id], count: 1, current: s.current });
      continue;
    }
    existing.ids.push(s.id);
    existing.count += 1;
    existing.current = existing.current || s.current;
    if (s.current || (!existing.lead.current && lastUsed(s) > lastUsed(existing.lead))) {
      existing.lead = s;
    }
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.current) - Number(a.current) || lastUsed(b.lead) - lastUsed(a.lead)
  );
}

/** How many device rows show before "Show all". */
export const VISIBLE_DEVICE_ROWS = 3;

/**
 * "Chrome · Linux" from a raw user-agent string (the full string stays in the tooltip); null when the
 * client is not a recognised browser (an API client such as "node"): the page says "Unknown device".
 */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (!browser && !os) return null;
  return [browser, os].filter(Boolean).join(" · ");
}
