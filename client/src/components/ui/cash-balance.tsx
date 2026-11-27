import type * as React from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { TableCell } from "@/components/ui/table";
import { Money, type MoneyProps } from "@/components/ui/money";
import {
  CASH_BALANCE_LABEL_KEYS,
  cashBalanceState,
  type CashBalanceKind,
} from "@/lib/cash-balance";

export interface CashBalanceProps extends Omit<MoneyProps, "amount" | "tone" | "positive"> {
  /** Balance in major units, natural sign (below zero = overdrawn). Numeric strings accepted. */
  amount: number | string | null | undefined;
  /** "actual" says "Overdrawn" / "مكشوف"; "projected" says "Negative balance" / "رصيد سالب". */
  kind?: CashBalanceKind;
  /** "inline" puts the label after the figure; "stacked" puts it on its own line (narrow cells). */
  layout?: "inline" | "stacked";
}

/**
 * CashBalance — the one way to show a cash or bank balance (P2). A negative balance keeps its
 * minus sign and gets a text label next to it, so the meaning never depends on colour alone;
 * zero and positive balances render exactly like `<Money>`. The figure is the shared `<Money>`
 * (isolated LTR digits, currency placed per locale), and the label is ordinary text in the page
 * direction, so in Arabic it reads after the figure from the right.
 */
export function CashBalance({
  amount,
  kind = "actual",
  layout = "inline",
  className,
  ...props
}: CashBalanceProps) {
  const { t } = useTranslation();
  const state = cashBalanceState(amount);
  const value = state === null ? null : Number(amount);
  if (state !== "overdrawn") {
    return (
      <Money
        amount={value}
        className={className}
        data-cash-balance={state ?? undefined}
        {...props}
      />
    );
  }
  const labelKey = CASH_BALANCE_LABEL_KEYS[kind];
  return (
    <span
      className={cn(
        "cash-balance",
        layout === "stacked"
          ? "inline-flex flex-col items-start gap-0.5"
          : "inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5",
        className
      )}
      data-cash-balance="overdrawn"
    >
      <Money amount={value} tone="auto" {...props} />
      <span
        className="cash-balance-label inline-flex items-center whitespace-nowrap rounded-full bg-danger-subtle px-2 py-0.5 text-xs font-medium leading-4 text-danger-subtle-foreground"
        data-testid="cash-balance-label"
      >
        {t[labelKey] ?? labelKey}
      </span>
    </span>
  );
}

export interface CashBalanceCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  amount: CashBalanceProps["amount"];
  currency?: string;
  showCurrency?: boolean;
  kind?: CashBalanceKind;
  layout?: CashBalanceProps["layout"];
}

/** Table cell for a cash or bank balance: end-aligned like `MoneyCell`, worded like `CashBalance`. */
export function CashBalanceCell({
  amount,
  currency,
  showCurrency,
  kind,
  layout,
  className,
  ...props
}: CashBalanceCellProps) {
  return (
    <TableCell data-numeric="" className={cn("text-end", className)} {...props}>
      <CashBalance
        amount={amount}
        currency={currency}
        showCurrency={showCurrency}
        kind={kind}
        layout={layout}
      />
    </TableCell>
  );
}
