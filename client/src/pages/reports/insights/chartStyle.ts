// Insights chart styling: a thin view over the shared chartTheme (spec 2.7), so the four views
// keep one vocabulary (primary = money in, neutral = money out / comparison period).
import { chartColors, chartTheme, formatAxisCompact } from "@/components/ui/chart-theme";

export const insightsChart = {
  primary: chartColors.brand,
  neutral: chartColors.neutral,
  negative: chartColors.negative,
  grid: chartColors.grid,
  axis: chartColors.axis,
  axisTick: chartTheme.xAxis.tick,
  animationDuration: 400,
} as const;

/** Axis label: "75k", "1.2M" (Latin digits in both languages, like every figure). */
export const compactAxisValue = formatAxisCompact;

/** False when the viewer asked for reduced motion (charts then draw without animating). */
export const chartAnimates = chartTheme.animate;
