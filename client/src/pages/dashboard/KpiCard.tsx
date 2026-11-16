import type { ReactNode } from "react";
import { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line } from "recharts";
import { StatCard } from "@/components/ui/stat-card";
import { formatPercentDelta } from "@/lib/format-money";

// ─── KPI tile (dashboard) ────────────────────────────────────────────────────
// Built on the shared StatCard: neutral figure (a <Money/>), a delta pill whose
// arrow follows the sign of the change and whose colour says whether that change
// is good news, an optional one-line hint, and a sparkline only when there is a
// series (StatCard hides it below 640px, so no empty slot is reserved).

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
}

const SPARK_COLOR: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  brand: "hsl(var(--chart-1))",
  neutral: "hsl(var(--chart-neutral))",
};

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
}: KpiCardProps) {
  const sparkColor = SPARK_COLOR[accent];
  const sparkData = useMemo(() => (spark ?? []).map((v, i) => ({ i, v })), [spark]);
  const hasSeries = sparkData.length > 1 && sparkData.some((d) => d.v !== 0);

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
              label: formatPercentDelta(delta),
              direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
              tone: trend === "up" ? "positive" : trend === "down" ? "negative" : "neutral",
              context: deltaContext,
            }
      }
      visual={
        hasSeries ? (
          <div className="-mx-1 h-9" dir="ltr" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                {/* Linear segments: sparse monthly points never overshoot (CTO 6). */}
                <Line
                  type="linear"
                  dataKey="v"
                  stroke={sparkColor}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : undefined
      }
    />
  );
}
