import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { motion } from "framer-motion";

// ─── Editorial KPI Card ──────────────────────────────────────────────────────

export interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
  trend?: "up" | "down" | "flat";
  spark?: number[];
  accent: "primary" | "success" | "warning" | "info";
  isLoading?: boolean;
  delay?: number;
}

export function KpiCard({
  label,
  value,
  delta,
  trend,
  spark,
  accent,
  isLoading,
  delay = 0,
}: KpiCardProps) {
  const accentClasses = {
    primary: "text-foreground",
    success: "text-success-subtle-foreground",
    warning: "text-warning-subtle-foreground",
    info: "text-info-subtle-foreground",
  }[accent];

  const sparkColor = {
    primary: "hsl(var(--chart-1))",
    success: "hsl(var(--success))",
    warning: "hsl(var(--warning))",
    info: "hsl(var(--info))",
  }[accent];

  const sparkData = useMemo(() => (spark ?? []).map((v, i) => ({ i, v })), [spark]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
    >
      <Card className="group h-full overflow-hidden hover-lift border-card-border">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
              {label}
            </div>
            {delta !== undefined && (
              <div
                className={
                  "inline-flex items-center gap-0.5 text-[11px] font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded " +
                  (trend === "up"
                    ? "bg-success-subtle text-success-subtle-foreground"
                    : trend === "down"
                      ? "bg-danger-subtle text-danger-subtle-foreground"
                      : "bg-neutral-subtle text-neutral-subtle-foreground")
                }
              >
                {trend === "up" ? (
                  <TrendingUp className="w-3 h-3" />
                ) : trend === "down" ? (
                  <TrendingDown className="w-3 h-3" />
                ) : null}
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)}%
              </div>
            )}
          </div>

          <div className="mt-4 flex items-end justify-between gap-3">
            {isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <div
                className={
                  "font-mono font-semibold tracking-tight tabular-nums text-[26px] leading-none " +
                  accentClasses
                }
                data-testid={`text-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {value}
              </div>
            )}
            {sparkData.length > 1 && (
              <div className="w-20 h-10 -mb-1 opacity-90">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparkData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={sparkColor} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={sparkColor}
                      strokeWidth={1.5}
                      fill={`url(#spark-${accent})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
