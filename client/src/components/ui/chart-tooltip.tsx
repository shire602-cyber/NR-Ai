import * as React from "react";

import { Money } from "@/components/ui/money";
import { cn } from "@/lib/utils";

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: string | number;
}

export interface ChartTooltipContentProps {
  /** Injected by Recharts. */
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: React.ReactNode;
  /** Render values as Money in this currency; omit for plain numbers. */
  currency?: string;
  /** Map a dataKey to a translated series name. */
  seriesLabel?: (key: string) => React.ReactNode;
  /** Format the category label (e.g. a month key → "Nov 2026"). */
  labelFormatter?: (label: React.ReactNode) => React.ReactNode;
  valueFormatter?: (value: number) => React.ReactNode;
  className?: string;
}

/**
 * Tooltip content (spec 2.7): popover surface, 12 px, label + Money per series. Never the
 * Recharts default. Use as `<Tooltip content={<ChartTooltipContent currency="AED" />} />`.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  currency,
  seriesLabel,
  labelFormatter,
  valueFormatter,
  className,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className={cn(
        "min-w-36 rounded-lg border border-popover-border bg-popover px-2.5 py-2 text-caption font-normal text-popover-foreground shadow-md",
        className
      )}
    >
      {label !== undefined && label !== "" && (
        <div className="mb-1.5 font-medium text-foreground">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="space-y-1">
        {payload.map((item, i) => {
          const raw = Array.isArray(item.value) ? item.value[1] : item.value;
          const num = typeof raw === "number" ? raw : Number(raw);
          const key = String(item.dataKey ?? item.name ?? i);
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color ?? item.stroke ?? item.fill }}
                  aria-hidden
                />
                <span className="truncate">{seriesLabel ? seriesLabel(key) : item.name}</span>
              </span>
              <span className="font-medium text-foreground tabular-nums">
                {valueFormatter ? (
                  valueFormatter(num)
                ) : currency ? (
                  <Money amount={Number.isFinite(num) ? num : null} currency={currency} />
                ) : Number.isFinite(num) ? (
                  num.toLocaleString("en-US")
                ) : (
                  "—"
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
