import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMoneyParts, formatPercentDelta } from "@/lib/format-money";
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
  /** "always" adds "+" to positive amounts (variances, deltas). */
  signDisplay?: "auto" | "always";
}

/**
 * Money — the one way to render an amount (CTO issue 1). Built from isolated spans so
 * the order never depends on the surrounding text direction:
 *
 *   <span class="money-figure" dir="ltr|rtl">
 *     <span class="money" dir="ltr"><span class="money-sign">−</span><span class="money-amount">77,765.65</span></span>
 *     <span class="money-currency" dir="ltr|rtl">AED | د.إ</span>
 *   </span>
 *
 * English puts the code at the inline start (`AED 8,922.33`); Arabic puts it after the
 * number in reading order (`8,922.33 د.إ`). Sign first, true minus, Latin digits.
 */
export function Money({
  amount,
  currency = "AED",
  tone = "none",
  positive = false,
  showCurrency = true,
  signDisplay = "auto",
  className,
  ...props
}: MoneyProps) {
  const { locale } = useTranslation();
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return (
      <span className={cn("money text-muted-foreground", className)} {...props}>
        —
      </span>
    );
  }
  const value = Number(amount);
  const parts = formatMoneyParts(value, currency, locale, { signDisplay });
  const figure = (
    <span className="money" dir="ltr">
      {parts.sign && <span className="money-sign">{parts.sign}</span>}
      <span className="money-amount">{parts.amount}</span>
    </span>
  );
  const currencyNode = showCurrency ? (
    <span className="money-currency" dir={parts.dir}>
      {parts.currency}
    </span>
  ) : null;
  return (
    <span
      className={cn(
        "money-figure",
        tone === "auto" && parts.isNegative && "text-negative",
        tone === "auto" && positive && value > 0 && !parts.isZero && "text-positive",
        className
      )}
      dir={parts.dir}
      data-money-currency={currency}
      {...props}
    >
      {parts.currencyPosition === "start" && currencyNode}
      {figure}
      {parts.currencyPosition === "end" && currencyNode}
    </span>
  );
}

/** Percentage delta pill text with the money sign rules ("+12.4%", "−4.2%"). */
export function PercentDelta({
  value,
  className,
  ...props
}: { value: number } & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">) {
  return (
    <span className={cn("money", className)} dir="ltr" {...props}>
      {formatPercentDelta(value)}
    </span>
  );
}

export interface MoneyCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  amount: number | null | undefined;
  currency?: string;
  tone?: MoneyProps["tone"];
  positive?: boolean;
  showCurrency?: boolean;
  signDisplay?: MoneyProps["signDisplay"];
}

/** Table cell for an amount: end-aligned (right in LTR, left in RTL), tabular. */
export function MoneyCell({
  amount,
  currency,
  tone,
  positive,
  showCurrency,
  signDisplay,
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
        signDisplay={signDisplay}
      />
    </TableCell>
  );
}
