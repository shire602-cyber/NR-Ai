import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DiscountType } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

const NONE = "none";

interface Props {
  type: DiscountType | null | undefined;
  value: number | string | null | undefined;
  onChange: (next: { type: DiscountType | null; value: number | string | null }) => void;
  /** Sales orders take percent discounts only (a partial invoice must carry the same percent). */
  percentOnly?: boolean;
  disabled?: boolean;
  testId?: string;
  /** Names the line for screen readers, e.g. "Line 2". */
  label: string;
}

/** Discount of one line: none, a percent, or an amount (before VAT). */
export function LineDiscountFields({ type, value, onChange, percentOnly, disabled, testId, label }: Props) {
  const tr = messages.useT();
  return (
    <div className="flex items-center gap-2">
      <Select
        value={type ?? NONE}
        disabled={disabled}
        onValueChange={(v) => onChange(v === NONE ? { type: null, value: null } : { type: v as DiscountType, value: value ?? "" })}
      >
        <SelectTrigger className="h-8 w-[7.5rem] text-xs" aria-label={tr("lineDiscountKind", { line: label })} data-testid={testId ? `${testId}-type` : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{tr("discountNone")}</SelectItem>
          <SelectItem value="percent">{tr("discountPercent")}</SelectItem>
          {!percentOnly && <SelectItem value="amount">{tr("discountAmount")}</SelectItem>}
        </SelectContent>
      </Select>
      {type && (
        <Input
          type="number"
          min={0}
          max={type === "percent" ? 100 : undefined}
          step="0.01"
          dir="ltr"
          className="h-8 w-24 font-mono text-xs"
          disabled={disabled}
          aria-label={tr("lineDiscountValue", { line: label })}
          value={value ?? ""}
          onChange={(e) => onChange({ type, value: e.target.value === "" ? "" : parseFloat(e.target.value) })}
          data-testid={testId ? `${testId}-value` : undefined}
        />
      )}
    </div>
  );
}
