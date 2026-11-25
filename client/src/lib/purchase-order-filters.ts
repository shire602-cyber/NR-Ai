import { getStatusLabel } from "@/components/ui/status-meta";

/** Client-side search over the purchase order list (number, vendor, status). */
export interface SearchablePurchaseOrder {
  number?: string | null;
  vendorName?: string | null;
  status?: string | null;
}

export function filterPurchaseOrders<T extends SearchablePurchaseOrder>(
  orders: readonly T[] | undefined,
  query: string,
  t: Readonly<Record<string, string>>
): T[] {
  const list = orders ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((po) =>
    [po.number, po.vendorName, po.status, getStatusLabel(po.status ?? "", t)].some((v) =>
      String(v ?? "")
        .replace(/_/g, " ")
        .toLowerCase()
        .includes(q)
    )
  );
}
