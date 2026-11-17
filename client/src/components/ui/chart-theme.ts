/**
 * chartTheme (spec 2.7) — the one chart look. Every Recharts chart spreads these props; no
 * screen picks its own colours, axis style or tooltip. Colours resolve to the chart tokens in
 * index.css, so light and dark both work.
 *
 *   <CartesianGrid {...chartTheme.grid} />
 *   <XAxis dataKey="month" {...chartTheme.xAxis} />
 *   <YAxis {...chartTheme.yAxis} tickFormatter={formatAxisCompact} />
 *   <Tooltip {...chartTheme.tooltip} content={<ChartTooltipContent currency="AED" />} />
 *   <Area dataKey="income" {...chartTheme.area("brand")} />
 *   <Line dataKey="prior" {...chartTheme.comparisonLine} />
 *   <Bar dataKey="expenses" {...chartTheme.bar("neutral")} />
 */
export const chartColors = {
  /** The primary series. Money in. */
  brand: "hsl(var(--chart-1))",
  slate: "hsl(var(--chart-2))",
  ochre: "hsl(var(--chart-3))",
  plum: "hsl(var(--chart-4))",
  teal: "hsl(var(--chart-5))",
  /** Comparison, prior period, "other". Money out. */
  neutral: "hsl(var(--chart-neutral))",
  /** Only for a negative net. */
  negative: "hsl(var(--negative))",
  grid: "hsl(var(--chart-grid))",
  axis: "hsl(var(--chart-axis))",
} as const;

/** Ordered series palette: brand first, then slate, ochre, plum, teal. */
export const chartSeries = [
  chartColors.brand,
  chartColors.slate,
  chartColors.ochre,
  chartColors.plum,
  chartColors.teal,
] as const;

export type ChartTone = "brand" | "neutral" | "slate" | "ochre" | "plum" | "teal" | "negative";

const toneColour = (tone: ChartTone) => chartColors[tone];

const axisTick = { fontSize: 11, fill: chartColors.axis } as const;

/** Popover-surface tooltip box (for charts that cannot use `ChartTooltipContent`). */
export const chartTooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--popover-border))",
  borderRadius: "8px",
  color: "hsl(var(--popover-foreground))",
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
  boxShadow: "var(--shadow-md)",
  padding: "8px 10px",
} as const;

export const chartTheme = {
  colors: chartColors,
  series: chartSeries,
  /** Horizontal grid only, 1 px, no axis lines. */
  grid: { vertical: false, stroke: chartColors.grid, strokeWidth: 1 },
  xAxis: { tick: axisTick, axisLine: false, tickLine: false, tickMargin: 8 },
  yAxis: { tick: axisTick, axisLine: false, tickLine: false, width: 48, tickMargin: 4 },
  tooltip: {
    cursor: { stroke: chartColors.grid, strokeWidth: 1, fill: "hsl(var(--muted) / 0.5)" },
    contentStyle: chartTooltipStyle,
    wrapperStyle: { outline: "none" },
  },
  /** Line: 1.5 px, no dots except on hover. Draws once (400 ms). */
  line: (tone: ChartTone = "brand") => ({
    type: "monotone" as const,
    stroke: toneColour(tone),
    strokeWidth: 1.5,
    dot: false,
    activeDot: { r: 3, strokeWidth: 0, fill: toneColour(tone) },
    animationDuration: 400,
    animationEasing: "ease-out" as const,
  }),
  /** Area: 1.5 px line with an 8% fill of the series colour. */
  area: (tone: ChartTone = "brand") => ({
    type: "monotone" as const,
    stroke: toneColour(tone),
    strokeWidth: 1.5,
    fill: toneColour(tone),
    fillOpacity: 0.08,
    dot: false,
    activeDot: { r: 3, strokeWidth: 0, fill: toneColour(tone) },
    animationDuration: 400,
    animationEasing: "ease-out" as const,
  }),
  /** Comparison series (prior period, expenses): neutral, 1.5 px dashed. */
  comparisonLine: {
    type: "monotone" as const,
    stroke: chartColors.neutral,
    strokeWidth: 1.5,
    strokeDasharray: "4 4",
    dot: false,
    activeDot: { r: 3, strokeWidth: 0, fill: chartColors.neutral },
    animationDuration: 400,
    animationEasing: "ease-out" as const,
  },
  /** Bars: 4 px top radius, max 28 px wide. Two series = brand + neutral. */
  bar: (tone: ChartTone = "brand") => ({
    fill: toneColour(tone),
    radius: [4, 4, 0, 0] as [number, number, number, number],
    maxBarSize: 28,
    animationDuration: 400,
    animationEasing: "ease-out" as const,
  }),
  /** BarChart props: gap ≥ 40% of the bar. */
  barChart: { barCategoryGap: "40%", barGap: 4 },
  /** Respect reduced motion: pass to every series as `isAnimationActive`. */
  animate: () =>
    typeof window === "undefined" ||
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
} as const;

/** Axis tick formatter: 75000 → "75k", 1250000 → "1.3M" (Latin digits in both locales). */
export function formatAxisCompact(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}k`;
  return `${sign}${trim(abs)}`;
}
function trim(v: number) {
  return v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
}

export { ChartTooltipContent, type ChartTooltipContentProps } from "@/components/ui/chart-tooltip";
