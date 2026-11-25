import { getStatusLabel } from "@/components/ui/status-meta";
import { stripArabicMarks, toAsciiDigits } from "@shared/arabic-text";

/** Client-side search over the purchase order list (number, vendor, status). */
export interface SearchablePurchaseOrder {
  number?: string | null;
  vendorName?: string | null;
  status?: string | null;
}

/**
 * Underscores become spaces; Arabic vowel marks are ignored and Arabic-Indic / Persian digits
 * match ASCII digits, on both sides.
 */
function comparable(value: string): string {
  return stripArabicMarks(toAsciiDigits(value.replace(/_/g, " "))).toLowerCase();
}

export function filterPurchaseOrders<T extends SearchablePurchaseOrder>(
  orders: readonly T[] | undefined,
  query: string,
  t: Readonly<Record<string, string>>
): T[] {
  const list = orders ?? [];
  const q = comparable(query.trim());
  if (!q) return [...list];
  return list.filter((po) =>
    [po.number, po.vendorName, po.status, getStatusLabel(po.status ?? "", t)].some((v) =>
      comparable(String(v ?? "")).includes(q)
    )
  );
}
