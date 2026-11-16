import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface StatDelta {
  /** Pre-formatted change, e.g. "+12.4%". */
  label: string;
  direction: "up" | "down" | "flat";
  /** Whether this change is good news (green), bad news (red) or neutral. */
  tone: "positive" | "negative" | "neutral";
  /** Accessible context, e.g. "vs last month". */
  context?: string;
}

export interface StatCardProps {
  label: React.ReactNode;
  /** The figure — pass a <Money/> or a formatted string. */
  value: React.ReactNode;
  delta?: StatDelta;
  /** One line under the value, e.g. "12 invoices · 3 overdue". */
  hint?: React.ReactNode;
  icon?: LucideIcon;
  /** Optional chart/sparkline rendered under the figure. */
  visual?: React.ReactNode;
  href?: string;
  loading?: boolean;
  className?: string;
  testId?: string;
}

const DELTA_TONE: Record<StatDelta["tone"], string> = {
  positive: "bg-success-subtle text-success-subtle-foreground",
  negative: "bg-danger-subtle text-danger-subtle-foreground",
  neutral: "bg-neutral-subtle text-neutral-subtle-foreground",
};

/**
 * StatCard / KPI tile — label, one large tabular figure, optional delta pill,
 * hint and visual. Use in a responsive grid (`grid gap-4 sm:grid-cols-2
 * xl:grid-cols-4`). With `href` the whole tile is a link.
 */
export function StatCard({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  visual,
  href,
  loading = false,
  className,
  testId,
}: StatCardProps) {
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  const body = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-2 text-small font-medium text-muted-foreground">
          {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />}
          <span className="truncate">{label}</span>
        </div>
        {delta && !loading && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
              DELTA_TONE[delta.tone]
            )}
            title={delta.context}
          >
            {/* Trend arrows show up/down, which does not mirror in RTL (CTO 12). */}
            <DeltaIcon className="h-3 w-3" aria-hidden />
            <span className="money" dir="ltr">
              {delta.label}
            </span>
            {delta.context && <span className="sr-only">{delta.context}</span>}
          </span>
        )}
      </div>
      {/* KPI figure: 28px / 600 / -0.02em on desktop, 20px in the mobile 2x2 grid (CTO 4, 12). */}
      <div className="figure-display mt-2 text-xl leading-7 text-foreground sm:mt-3 sm:text-h1">
        {loading ? <Skeleton className="h-8 w-36" /> : value}
      </div>
      {hint && !loading && (
        <div className="mt-1 truncate text-caption text-muted-foreground sm:text-small">{hint}</div>
      )}
      {/* The sparkline slot exists only when there is a series, and only from 640px up. */}
      {visual && !loading && <div className="mt-4 hidden sm:block">{visual}</div>}
    </>
  );

  if (href) {
    return (
      <Card
        interactive
        className={cn("p-0", className)}
        data-testid={testId}
        aria-busy={loading || undefined}
      >
        <Link
          href={href}
          className="block h-full rounded-xl p-4 focus-visible:outline-none sm:p-5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </Link>
      </Card>
    );
  }
  return (
    <Card
      className={cn("p-4 sm:p-5", className)}
      data-testid={testId}
      aria-busy={loading || undefined}
    >
      {body}
    </Card>
  );
}
