import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import { isStockItem, type PurchasableItem } from "@/lib/purchase-pickers";

const NONE = "__none__";

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
