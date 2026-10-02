import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import { messages } from "./SalesShared.i18n";

export interface PickerProduct {
  id: string;
  name: string;
  nameAr?: string | null;
  sku?: string | null;
  unitPrice?: number | string | null;
  vatRate?: number | string | null;
  isActive?: boolean | null;
  trackInventory?: boolean | null;
}

const MANUAL = "__manual__";

interface Props {
  products: PickerProduct[];
  value: string | null | undefined;
  onPick: (product: PickerProduct | null) => void;
  testId?: string;
}

/** The product of a sales line: a manual line, or an item whose name, price and VAT rate fill the line. */
export function LineProductPicker({ products, value, onPick, testId }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  if (products.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <Label className="whitespace-nowrap text-xs text-muted-foreground">{tr("lineProduct")}</Label>
      <Select value={value || MANUAL} onValueChange={(v) => onPick(v === MANUAL ? null : (products.find((p) => p.id === v) ?? null))}>
        <SelectTrigger className="h-8 text-xs" data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MANUAL}>{tr("lineProductManual")}</SelectItem>
          {products
            .filter((p) => p.isActive !== false)
            .map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.sku ? `${p.sku} - ` : ""}
                {locale === "ar" && p.nameAr ? p.nameAr : p.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
