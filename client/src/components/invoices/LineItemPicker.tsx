import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";

export interface PickableProduct {
  id: string;
  name: string;
  nameAr?: string | null;
  sku?: string | null;
  unitPrice?: number | string | null;
  vatRate?: number | string | null;
  productType?: string | null;
  isActive?: boolean | null;
}

const NONE = "__none__";

/**
 * X5 (J1 L1): pick a product or service for an invoice line. Picking fills the description,
 * price and VAT treatment, and links the line to the item so it posts to the right income
 * account (services to Service Revenue, goods to Sales). Free-text lines stay possible.
 */
export function LineItemPicker({
  companyId,
  value,
  onPick,
  index,
}: {
  companyId: string | undefined;
  value: string | undefined;
  onPick: (product: PickableProduct | null) => void;
  index: number;
}) {
  const { t, locale } = useTranslation();
  const { data: products = [] } = useQuery<PickableProduct[]>({
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
        className="ms-7 min-w-0 flex-1 sm:ms-0 sm:w-44 sm:flex-none sm:shrink-0"
        aria-label={t["invoices.item.pickLabel"]}
        data-testid={`select-line-item-${index}`}
      >
        <SelectValue placeholder={t["invoices.item.pickLabel"]} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t["invoices.item.freeText"]}</SelectItem>
        {active.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {(locale === "ar" && p.nameAr) || p.name}
            {p.productType === "service" ? ` · ${t["invoices.item.service"]}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
