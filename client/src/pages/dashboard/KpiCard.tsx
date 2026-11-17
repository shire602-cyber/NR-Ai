import type { ReactNode } from "react";
import { StatCard } from "@/components/ui/stat-card";
import { formatPercentDelta } from "@/lib/format-money";

// ─── KPI tile (dashboard) ────────────────────────────────────────────────────
// Built on the shared StatCard: neutral figure (a <Money/>), a delta pill whose
// arrow follows the sign of the change and whose colour says whether that change
// is good news, an optional one-line hint, and a sparkline only when there is a
// series (spec 2.7: the shared 32 px sparkline; a tile row either has them all or none).

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  delta?: number;
  /** "up" = the change is good news, "down" = bad news (colour, not direction). */
  trend?: "up" | "down" | "flat";
  spark?: number[];
  /** Series colour role: brand for income-like figures, neutral for costs. */
  accent?: "brand" | "neutral";
  isLoading?: boolean;
  /** Optional one-line context under the figure. */
  hint?: ReactNode;
  href?: string;
  testId?: string;
  /** Accessible context for the delta, e.g. "vs prior period". */
  deltaContext?: string;
  /** Pre-formatted delta (e.g. percentage points); defaults to a percent change. */
  deltaLabel?: string;
}

export function KpiCard({
  label,
  value,
  delta,
  trend,
  spark,
  accent = "brand",
  isLoading,
  hint,
  href,
  testId,
  deltaContext,
  deltaLabel,
}: KpiCardProps) {
  const hasSeries = (spark?.length ?? 0) > 1 && spark!.some((v) => v !== 0);

  return (
    <StatCard
      className="h-full"
      label={label}
      loading={isLoading}
      hint={hint}
      href={href}
      testId={testId}
      value={value}
      delta={
        delta === undefined || !Number.isFinite(delta)
          ? undefined
          : {
              label: deltaLabel ?? formatPercentDelta(delta),
              direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
              tone: trend === "up" ? "positive" : trend === "down" ? "negative" : "neutral",
              context: deltaContext,
            }
      }
      sparkline={hasSeries ? spark : undefined}
      sparklineTone={accent}
    />
  );
}
