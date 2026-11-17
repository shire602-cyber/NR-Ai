// Insights chart styling (spec 2.7) on the chart tokens; no React so it can be shared freely.

/**
 * Chart styling (spec 2.7) on the chart tokens. Money in = chart-1, money out / prior period =
 * chart-neutral; grid is horizontal only; axis text 11 px.
 */
export const insightsChart = {
  primary: "hsl(var(--chart-1))",
  neutral: "hsl(var(--chart-neutral))",
  negative: "hsl(var(--danger))",
  grid: "hsl(var(--chart-grid, var(--neutral-100)))",
  axis: "hsl(var(--chart-axis, var(--neutral-500)))",
  axisTick: { fontSize: 11, fill: "hsl(var(--chart-axis, var(--neutral-500)))" },
  animationDuration: 400,
} as const;

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Axis label: "75K", "1.2M" (Latin digits in both languages, like every figure). */
export function compactAxisValue(value: number): string {
  return compactFormatter.format(value);
}
