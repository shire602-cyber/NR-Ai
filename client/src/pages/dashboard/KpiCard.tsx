import { useId, useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { StatCard } from "@/components/ui/stat-card";

// ─── KPI tile (dashboard) ────────────────────────────────────────────────────
// Built on the shared StatCard: neutral figure, a delta pill whose arrow
// follows the sign of the change and whose colour says whether that change is
// good news, and a full-width sparkline underneath.

export interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
  /** "up" = the change is good news, "down" = bad news (colour, not direction). */
  trend?: "up" | "down" | "flat";
  spark?: number[];
  accent: "primary" | "success" | "warning" | "info";
  isLoading?: boolean;
  /** Kept for call-site compatibility; tiles no longer stagger in. */
  delay?: number;
  /** Optional one-line context under the figure. */
  hint?: string;
}

const SPARK_COLOR: Record<KpiCardProps["accent"], string> = {
  primary: "hsl(var(--chart-1))",
  success: "hsl(var(--chart-1))",
  warning: "hsl(var(--chart-3))",
  info: "hsl(var(--chart-2))",
};

export function KpiCard({
  label,
  value,
  delta,
  trend,
  spark,
  accent,
  isLoading,
  hint,
}: KpiCardProps) {
  const gradientId = useId().replace(/:/g, "");
  const sparkColor = SPARK_COLOR[accent];
  const sparkData = useMemo(() => (spark ?? []).map((v, i) => ({ i, v })), [spark]);

  return (
    <StatCard
      className="h-full"
      label={label}
      loading={isLoading}
      hint={hint}
      value={
        <span className="money" data-testid={`text-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </span>
      }
      delta={
        delta === undefined
          ? undefined
          : {
              label: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`,
              direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
              tone: trend === "up" ? "positive" : trend === "down" ? "negative" : "neutral",
            }
      }
      visual={
        sparkData.length > 1 ? (
          <div className="-mx-1 hidden h-10 sm:block" dir="ltr" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor}
                  strokeWidth={1.5}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : undefined
      }
    />
  );
}
