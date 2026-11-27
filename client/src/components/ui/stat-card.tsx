import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
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
  /**
   * @deprecated Spec 2.7: StatCard has no icon. Accepted so existing screens compile; not
   * rendered.
   */
  icon?: LucideIcon;
  /**
   * Spec 2.7: a 32 px full-width sparkline at the bottom. Pass the series values (oldest
   * first); fewer than 2 points renders nothing. In a row, either every tile has one or none.
   */
  sparkline?: number[];
  /** Sparkline colour: `brand` (money in, default) or `neutral` (money out / comparison). */
  sparklineTone?: "brand" | "neutral";
  /** Optional custom visual rendered under the figure (prefer `sparkline`). */
  visual?: React.ReactNode;
  /** Pin the visual to the card bottom edge so it adds no height (tiles in a row stay equal). */
  visualOverlay?: boolean;
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
  sparkline,
  sparklineTone = "brand",
  visual,
  visualOverlay,
  href,
  loading = false,
  className,
  testId,
}: StatCardProps) {
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  const body = (
    <>
      {/* Under 640 px the delta pill sits on its own line under the label so a 2×2 tile never
          truncates the label ("Net m…"). */}
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-2">
        <span className="min-w-0 max-w-full truncate text-caption text-muted-foreground">
          {label}
        </span>
        {delta && !loading && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption",
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
      {/* KPI figure: text-kpi (28/32 desktop, 22/28 mobile), tabular, no count-up (spec 2.5). */}
      {/* The figure fits the tile at any width: the wrapper is a size container and the
          figure scales with it (≈ 14 characters, e.g. "AED 343,532.50", fit in a 2×2 tile at
          390 px), capped at text-kpi. It never wraps or clips. */}
      <div className="mt-3 [container-type:inline-size]">
        <div className="whitespace-nowrap text-kpi text-foreground tabular-nums [font-size:min(var(--text-kpi-size),11.5cqi)] [line-height:min(var(--text-kpi-line),14cqi)]">
          {loading ? <Skeleton className="h-8 w-36" /> : value}
        </div>
      </div>
      {hint && !loading && (
        <div className="mt-1.5 line-clamp-2 break-words text-small text-muted-foreground">
          {hint}
        </div>
      )}
      {sparkline && sparkline.length >= 2 && !loading && (
        <Sparkline values={sparkline} tone={sparklineTone} className="mt-4" />
      )}
      {/* Legacy visual slot: only when there is a series, and only from 640px up. */}
      {visual && !loading && visualOverlay && (
        <div className="absolute inset-x-card bottom-3 hidden sm:block">{visual}</div>
      )}
      {visual && !loading && !visualOverlay && <div className="mt-4 hidden sm:block">{visual}</div>}
    </>
  );

  if (href) {
    return (
      <Card
        interactive
        data-tilt="5"
        className={cn("p-0", className)}
        data-testid={testId}
        aria-busy={loading || undefined}
      >
        <Link
          href={href}
          className="block h-full rounded-xl p-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </Link>
      </Card>
    );
  }
  return (
    <Card
      className={cn("relative p-card", className)}
      data-tilt="5"
      data-testid={testId}
      aria-busy={loading || undefined}
    >
      {body}
    </Card>
  );
}

/**
 * Sparkline — 32 px tall, full width, 1.5 px line with an 8% area fill (spec 2.7). Pure SVG
 * (no chart library), drawn once; decorative (the figure carries the meaning). Values run oldest
 * to newest; in Arabic the page reads right to left, so the line is mirrored (newest at the
 * inline start, like the axis of every other chart) and callers never reverse their series.
 */
export function Sparkline({
  values: series,
  tone = "brand",
  className,
}: {
  values: number[];
  tone?: "brand" | "neutral";
  className?: string;
}) {
  const gradientId = React.useId();
  const { locale } = useTranslation();
  if (series.length < 2) return null;
  const values = locale === "ar" ? [...series].reverse() : series;
  const w = 100;
  const h = 32;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const colour = tone === "neutral" ? "hsl(var(--chart-neutral))" : "hsl(var(--chart-1))";
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("block h-8 w-full overflow-visible", className)}
      aria-hidden
      data-testid="stat-sparkline"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity={0.08} />
          <stop offset="100%" stopColor={colour} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
