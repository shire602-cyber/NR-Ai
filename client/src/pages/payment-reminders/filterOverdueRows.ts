import type { AgingRow } from "./types";

/** Case-insensitive match on customer name or invoice number; blank query keeps every row. */
export function filterOverdueRows(rows: AgingRow[], query: string): AgingRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      (r.invoice.customerName ?? "").toLowerCase().includes(q) ||
      (r.invoice.number ?? "").toLowerCase().includes(q)
  );
}
