import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";

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

const NONE = "__none__";

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

/**
 * WQ2 (11.1): pick a product or service for a bill line. Picking fills the description and the
 * purchase price and links the line to the item: a stock item's line is posted to inventory by
 * the inventory module when the bill is approved (never to an expense account), a service keeps
 * the account chosen on the line. Free-text lines stay possible.
 */
export function BillItemPicker({
  companyId,
  value,
  onPick,
  index,
}: {
  companyId: string | undefined;
  value: string | null | undefined;
  onPick: (item: PurchasableItem | null) => void;
  index: number;
}) {
  const { t, locale } = useTranslation();
  const { data: products = [] } = useQuery<PurchasableItem[]>({
    queryKey: ["/api/companies", companyId, "products"],
    enabled: !!companyId,
    retry: false,
  });
  const active = products.filter((p) => p.isActive !== false);
  if (active.length === 0) return null;
  return (
    <Select
      value={value || NONE}
      onValueChange={(id) => onPick(id === NONE ? null : (active.find((p) => p.id === id) ?? null))}
    >
      <SelectTrigger
        aria-label={t["purchases.item.pick"]}
        data-testid={`select-bill-item-${index}`}
      >
        <SelectValue placeholder={t["purchases.item.pick"]} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t["purchases.item.freeText"]}</SelectItem>
        {active.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {(locale === "ar" && p.nameAr) || p.name}
            {isStockItem(p)
              ? ` · ${t["purchases.item.stock"]}`
              : ` · ${t["purchases.item.service"]}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
