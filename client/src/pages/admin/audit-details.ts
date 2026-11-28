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

type Translations = Record<string, string | undefined>;

/**
 * Parsed entries, or a single "Note" entry for plain text; [] when empty. With a catalog `t`,
 * known keys read in the active language (`auditDetail.key.<key>`: "Company id", "Method" ...) and
 * boolean values as Yes/No; other keys fall back to the humanised key.
 */
export function auditDetailEntries(
  details: string | null | undefined,
  t?: Translations
): DetailEntry[] {
  if (!details || !details.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({
        key: t?.[`auditDetail.key.${k}`] ?? humanKey(k),
        value:
          typeof v === "boolean" && t?.["auditDetail.yes"]
            ? (t[v ? "auditDetail.yes" : "auditDetail.no"] ?? show(v))
            : show(v),
      }));
    }
    return [{ key: "", value: show(parsed) }];
  } catch {
    return [{ key: "", value: details }];
  }
}
