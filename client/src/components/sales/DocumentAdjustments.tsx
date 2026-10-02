import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import type { DiscountType, PreviewResult, ShippingForm } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

const NONE = "none";

interface AdjustmentsProps {
  discountType: DiscountType | null | undefined;
  discountValue: number | string | null | undefined;
  onDiscountChange: (next: { type: DiscountType | null; value: number | string | null }) => void;
  shipping: ShippingForm;
  onShippingChange: (next: ShippingForm) => void;
  percentOnly?: boolean;
  disabled?: boolean;
}

/** Document-level discount (percent of the item total, or an amount) and the shipping charge with its VAT rate. */
export function DocumentAdjustments({ discountType, discountValue, onDiscountChange, shipping, onShippingChange, percentOnly, disabled }: AdjustmentsProps) {
  const tr = messages.useT();
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="document-adjustments">
      <div className="space-y-1.5">
        <Label>{tr("documentDiscount")}</Label>
        <div className="flex items-center gap-2">
          <Select
            value={discountType ?? NONE}
            disabled={disabled}
            onValueChange={(v) => onDiscountChange(v === NONE ? { type: null, value: null } : { type: v as DiscountType, value: discountValue ?? "" })}
          >
            <SelectTrigger className="w-[8.5rem]" aria-label={tr("documentDiscount")} data-testid="select-document-discount-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{tr("discountNone")}</SelectItem>
              <SelectItem value="percent">{tr("discountPercent")}</SelectItem>
              {!percentOnly && <SelectItem value="amount">{tr("discountAmount")}</SelectItem>}
            </SelectContent>
          </Select>
          {discountType && (
            <Input
              type="number"
              min={0}
              max={discountType === "percent" ? 100 : undefined}
              step="0.01"
              dir="ltr"
              className="font-mono"
              disabled={disabled}
              aria-label={tr("documentDiscountValue")}
              value={discountValue ?? ""}
              onChange={(e) => onDiscountChange({ type: discountType, value: e.target.value === "" ? "" : parseFloat(e.target.value) })}
              data-testid="input-document-discount-value"
            />
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{tr("shipping")}</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            className="font-mono"
            placeholder={tr("shippingAmountPlaceholder")}
            disabled={disabled}
            aria-label={tr("shippingAmount")}
            value={shipping.amount}
            onChange={(e) => onShippingChange({ ...shipping, amount: e.target.value === "" ? "" : parseFloat(e.target.value) })}
            data-testid="input-shipping-amount"
          />
          <Select
            value={String(Math.round(shipping.vatRate * 100))}
            disabled={disabled}
            onValueChange={(v) => onShippingChange({ ...shipping, vatRate: parseFloat(v) / 100 })}
          >
            <SelectTrigger className="w-24 font-mono" aria-label={tr("shippingVat")} data-testid="select-shipping-vat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0%</SelectItem>
              <SelectItem value="5">5%</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

interface TotalsProps {
  preview: PreviewResult;
  currency: string;
  /** The advances deducted on this invoice (shown as "Less advance ..." rows). */
  advances?: Array<{ advanceNumber: string; netAmount: number }>;
}

/** Items, discount, shipping, advances, subtotal, VAT and total: the same arithmetic the server posts. */
export function SalesTotalsSummary({ preview, currency, advances }: TotalsProps) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  if (!preview) return null;
  if (!preview.ok) {
    return (
      <p role="alert" className="text-sm text-destructive" data-testid="totals-error">
        {preview.code === "DISCOUNT_EXCEEDS_LINE"
          ? tr("errDiscountExceedsLine")
          : preview.code === "DISCOUNT_EXCEEDS_SUBTOTAL"
            ? tr("errDiscountExceedsSubtotal")
            : preview.code === "ADVANCE_EXCEEDS_INVOICE"
              ? tr("errAdvanceExceedsInvoice")
              : tr("errDiscountInvalid")}
      </p>
    );
  }
  const t = preview.totals;
  const money = (n: number) => formatCurrency(n, currency, locale);
  const rows: Array<{ key: string; label: string; value: string; testId: string; strong?: boolean }> = [];
  const hasAdjustments = t.discountAmount > 0 || t.shippingAmount > 0 || (advances?.length ?? 0) > 0;
  if (hasAdjustments) rows.push({ key: "items", label: tr("itemsSubtotal"), value: money(t.itemsSubtotal + t.discountAmount), testId: "total-items" });
  if (t.discountAmount > 0) rows.push({ key: "discount", label: tr("discountTotal"), value: `-${money(t.discountAmount)}`, testId: "total-discount" });
  if (t.shippingAmount > 0) rows.push({ key: "shipping", label: tr("shipping"), value: money(t.shippingAmount), testId: "total-shipping" });
  for (const a of advances ?? []) {
    rows.push({ key: `adv-${a.advanceNumber}`, label: tr("lessAdvance", { number: a.advanceNumber }), value: `-${money(a.netAmount)}`, testId: "total-advance" });
  }
  rows.push({ key: "subtotal", label: tr("subtotal"), value: money(t.subtotal), testId: "total-subtotal" });
  rows.push({ key: "vat", label: tr("vat"), value: money(t.vatAmount), testId: "total-vat" });
  rows.push({ key: "total", label: tr("total"), value: money(t.total), testId: "total-total", strong: true });
  return (
    <div className="space-y-1.5" data-testid="sales-totals">
      {rows.map((r) => (
        <div key={r.key} className={r.strong ? "flex justify-between border-t pt-2 text-lg font-semibold" : "flex justify-between text-sm"}>
          <span className={r.strong ? undefined : "text-muted-foreground"}>{r.label}</span>
          <span dir="ltr" className="font-mono" data-testid={r.testId}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
