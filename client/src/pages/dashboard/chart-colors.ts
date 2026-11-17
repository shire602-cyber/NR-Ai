// Moved into the shared chart theme (WP-A, spec 2.7): `@/components/ui/chart-theme`.
// These aliases keep existing imports compiling; new code imports `chartTheme` directly.
import { chartColors, chartSeries, chartTooltipStyle } from "@/components/ui/chart-theme";

export const CHART_COLORS = {
  primary: chartColors.brand,
  accent: chartColors.brand,
  warning: chartColors.ochre,
  info: chartColors.slate,
  muted: chartColors.teal,
  /** Comparison series (expenses, prior period): neutral-400 light / neutral-500 dark. */
  neutral: chartColors.neutral,
};

export const PIE_PALETTE = [...chartSeries];

/** Shared Recharts tooltip surface. */
export const CHART_TOOLTIP_STYLE = chartTooltipStyle;
