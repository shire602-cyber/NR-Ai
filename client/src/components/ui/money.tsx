import * as React from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { TableCell } from "@/components/ui/table";

export interface MoneyProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Amount in major units (e.g. 1250.5 = AED 1,250.50). `null` renders an em dash. */
  amount: number | null | undefined;
  currency?: string;
  /**
   * Colour by sign: `auto` tints negatives red (and positives green when
   * `positive` is set); `none` keeps the inherited text colour.
   */
  tone?: "auto" | "none";
  /** With tone="auto", also tint positive amounts green (P&L deltas, cash in). */
  positive?: boolean;
  /** Show the currency code/symbol (default true). */
  showCurrency?: boolean;
}

/**
 * Money — the one way to render an amount. Tabular figures, never wraps, and
 * always LTR digits (also inside Arabic text) via the `.money` class.
 */
export function Money({
  amount,
  currency = "AED",
  tone = "none",
  positive = false,
  showCurrency = true,
  className,
  ...props
}: MoneyProps) {
  const { locale } = useTranslation();
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return (
      <span className={cn("money text-muted-foreground", className)} {...props}>
        —
      </span>
    );
  }
  const text = showCurrency
    ? formatCurrency(amount, currency, locale)
    : new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
  return (
    <span
      className={cn(
        "money",
        tone === "auto" && amount < 0 && "text-negative",
        tone === "auto" && positive && amount > 0 && "text-positive",
        className
      )}
      data-currency={currency}
      {...props}
    >
      {text}
    </span>
  );
}

export interface MoneyCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  amount: number | null | undefined;
  currency?: string;
  tone?: MoneyProps["tone"];
  positive?: boolean;
  showCurrency?: boolean;
}

/** Table cell for an amount: end-aligned (right in LTR, left in RTL), tabular. */
export function MoneyCell({
  amount,
  currency,
  tone,
  positive,
  showCurrency,
  className,
  ...props
}: MoneyCellProps) {
  return (
    <TableCell data-numeric="" className={cn("text-end", className)} {...props}>
      <Money
        amount={amount}
        currency={currency}
        tone={tone}
        positive={positive}
        showCurrency={showCurrency}
      />
    </TableCell>
  );
}
