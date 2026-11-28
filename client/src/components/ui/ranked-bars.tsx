import * as React from "react";
import { Link } from "wouter";

import { Money } from "@/components/ui/money";
import { EmptyState } from "@/components/ui/empty-state";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface RankedBarItem {
  /** Stable key (falls back to the label). */
  id?: string;
  label: React.ReactNode;
  /** Magnitude used for ranking and bar length (absolute value is used). */
  value: number;
  /** Optional end-aligned display; defaults to <Money amount={value} currency={currency}/>. */
  display?: React.ReactNode;
  href?: string;
}

export interface RankedBarsProps {
  items: RankedBarItem[];
  /** Rows shown before the rest fold into "Other" (default 5). */
  limit?: number;
  /** Currency for the default amount display (default "AED"). */
  currency?: string;
  /** Label for the folded remainder (defaults to "Other"). */
  otherLabel?: React.ReactNode;
  /** `sm` empty state sentence when there are no items. */
  emptyLabel?: string;
  /** Accessible name of the list, e.g. "Expense breakdown". */
  "aria-label"?: string;
  className?: string;
  testId?: string;
}

// Spec 2.7: one hue at opacity steps 100 / 70 / 50 / 35 / 25%; "Other" is neutral.
const STEP_OPACITY = [1, 0.7, 0.5, 0.35, 0.25];

/**
 * RankedBars (spec 2.7) — replaces every donut for a money breakdown: label, a thin 6 px bar
 * in `--chart-1` at opacity steps, amount end-aligned; top `limit` + "Other". One hue, reads in
 * both directions and in dark.
 */
export function RankedBars({
  items,
  limit = 5,
  currency = "AED",
  otherLabel,
  emptyLabel,
  className,
  testId,
  "aria-label": ariaLabel,
}: RankedBarsProps) {
  const { t } = useTranslation();
  const sorted = [...items]
    .filter((i) => Number.isFinite(i.value) && i.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (sorted.length === 0) {
    return (
      <EmptyState
        size="sm"
        title={emptyLabel ?? t["components.ui.rankedBarsEmpty"]}
        testId={testId}
      />
    );
  }
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const rows: Array<RankedBarItem & { other?: boolean }> = [...head];
  if (rest.length > 0) {
    rows.push({
      id: "__other",
      label: otherLabel ?? t["components.ui.other"],
      value: rest.reduce((sum, r) => sum + Math.abs(r.value), 0),
      other: true,
    });
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.value))) || 1;

  return (
    <ul className={cn("space-y-3", className)} aria-label={ariaLabel} data-testid={testId}>
      {rows.map((row, index) => {
        const pct = Math.max(2, (Math.abs(row.value) / max) * 100);
        const label = (
          <span className="min-w-0 truncate text-small text-foreground">{row.label}</span>
        );
        return (
          <li key={row.id ?? (typeof row.label === "string" ? row.label : index)}>
            <div className="flex items-baseline justify-between gap-3">
              {row.href ? (
                <Link href={row.href} className="min-w-0 truncate rounded-sm hover:underline">
                  {label}
                </Link>
              ) : (
                label
              )}
              <span className="shrink-0 text-small font-medium text-foreground tabular-nums">
                {row.display ?? <Money amount={row.value} currency={currency} />}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: row.other ? "hsl(var(--chart-neutral))" : "hsl(var(--chart-1))",
                  opacity: row.other ? 1 : STEP_OPACITY[Math.min(index, STEP_OPACITY.length - 1)],
                }}
                aria-hidden
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
