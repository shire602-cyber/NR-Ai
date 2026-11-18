import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";

export interface CostCentreOption {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  isActive?: boolean | null;
}

const NONE = "__none__";

/**
 * WQ1 (7.2i): the cost centre of an invoice line. The revenue line it posts carries the cost
 * centre, so the cost-centre P&L shows the sale. Hidden while the company has no cost centres.
 */
export function LineCostCentrePicker({
  options,
  value,
  onChange,
  index,
}: {
  options: CostCentreOption[];
  value: string | undefined;
  onChange: (costCenterId: string | undefined) => void;
  index: number;
}) {
  const { t, locale } = useTranslation();
  if (options.length === 0) return null;
  return (
    <Select value={value || NONE} onValueChange={(id) => onChange(id === NONE ? undefined : id)}>
      <SelectTrigger
        className="ms-7 min-w-0 flex-1 sm:ms-0 sm:w-40 sm:flex-none sm:shrink-0"
        aria-label={t["invoices.costCentre.label"]}
        title={t["invoices.costCentre.label"]}
        data-testid={`select-line-cost-centre-${index}`}
      >
        <SelectValue placeholder={t["invoices.costCentre.none"]} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t["invoices.costCentre.none"]}</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.code} · {(locale === "ar" && c.nameAr) || c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
