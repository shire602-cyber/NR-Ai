// Chart colours resolve to the D2 chart tokens (index.css), so light and dark
// mode, and any future brand change, flow through one place.
export const CHART_COLORS = {
  primary: "hsl(var(--chart-1))",
  accent: "hsl(var(--chart-1))",
  warning: "hsl(var(--chart-3))",
  info: "hsl(var(--chart-2))",
  muted: "hsl(var(--chart-5))",
  /** Comparison series (expenses, prior period): neutral-400 light / neutral-500 dark. */
  neutral: "hsl(var(--chart-neutral))",
};

export const PIE_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

/** Shared Recharts tooltip surface. */
export const CHART_TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--popover-border))",
  borderRadius: "8px",
  color: "hsl(var(--popover-foreground))",
  fontSize: "12px",
  fontVariantNumeric: "tabular-nums",
  boxShadow: "var(--shadow-md)",
} as const;
