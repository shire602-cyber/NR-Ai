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
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-muted-foreground">
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
            <DeltaIcon className="h-3 w-3 rtl:-scale-x-100" aria-hidden />
            <span className="money">{delta.label}</span>
            {delta.context && <span className="sr-only">{delta.context}</span>}
          </span>
        )}
      </div>
      <div className="mt-3 text-[1.625rem] font-semibold leading-8 tracking-[-0.02em] text-foreground tabular-nums">
        {loading ? <Skeleton className="h-8 w-36" /> : value}
      </div>
      {hint && !loading && <div className="mt-1 text-small text-muted-foreground">{hint}</div>}
      {visual && !loading && <div className="mt-4">{visual}</div>}
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
          className="block rounded-xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </Link>
      </Card>
    );
  }
  return (
    <Card className={cn("p-5", className)} data-testid={testId} aria-busy={loading || undefined}>
      {body}
    </Card>
  );
}
