// Display label of a status id the API returns (`draft`, `in_review`, `overdue`, ...): never show
// the raw enum. Unknown ids fall back to the id with spaces.
type Catalog = Record<string, string | undefined>;

export function statusLabel(t: Catalog, status: string | null | undefined): string {
  if (!status) return "—";
  return t[`common.status.${status}`] ?? status.replace(/_/g, " ");
}
