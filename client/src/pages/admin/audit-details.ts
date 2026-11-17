/**
 * Admin audit log (spec 3.16): the free-form `details` column is shown as formatted
 * key/value rows in an expander instead of a raw JSON string.
 */
export interface DetailEntry {
  key: string;
  value: string;
}

function humanKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Parsed entries, or a single "Note" entry for plain text; [] when empty. */
export function auditDetailEntries(details: string | null | undefined): DetailEntry[] {
  if (!details || !details.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({
        key: humanKey(k),
        value: show(v),
      }));
    }
    return [{ key: "", value: show(parsed) }];
  } catch {
    return [{ key: "", value: details }];
  }
}
