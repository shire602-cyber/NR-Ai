/**
 * WQ2: data helpers of the purchase pickers (supplier type-ahead, bill-line item picker), kept
 * out of the component files so they stay pure and unit-testable.
 */

/** A supplier row from GET /api/companies/:id/vendors. */
export interface SupplierOption {
  id: string;
  name: string;
  nameAr?: string | null;
  trn?: string | null;
  paymentTermsDays?: number | null;
  currency?: string | null;
  defaultExpenseAccountId?: string | null;
  isActive?: boolean | null;
}

export const suppliersQueryKey = (companyId: string | undefined) => [
  "/api/companies",
  companyId,
  "vendors",
];

const MAX_OPTIONS = 8;

/** Suppliers whose name (EN / AR) or TRN contains the typed text. */
export function filterSuppliers(
  suppliers: readonly SupplierOption[],
  query: string
): SupplierOption[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const out = q
    ? suppliers.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (!!s.nameAr && s.nameAr.toLowerCase().includes(q)) ||
          (digits.length >= 3 && !!s.trn && s.trn.includes(digits))
      )
    : [...suppliers];
  return out.slice(0, MAX_OPTIONS);
}

export interface PurchasableItem {
  id: string;
  name: string;
  nameAr?: string | null;
  sku?: string | null;
  unitPrice?: number | string | null;
  costPrice?: number | string | null;
  productType?: string | null;
  trackInventory?: boolean | null;
  isActive?: boolean | null;
}

/** A stock item is costed into inventory by the bill (server: inventory/documents, inventory.on*). */
export function isStockItem(p: PurchasableItem | null | undefined): boolean {
  return !!p && (p.productType ?? "inventory") === "inventory" && p.trackInventory !== false;
}

/** The purchase price a picked item suggests: its cost price, else its selling price. */
export function purchasePriceOf(p: PurchasableItem): number {
  const cost = Number(p.costPrice);
  if (Number.isFinite(cost) && cost > 0) return cost;
  const price = Number(p.unitPrice);
  return Number.isFinite(price) && price > 0 ? price : 0;
}
