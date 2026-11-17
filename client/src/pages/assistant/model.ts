/**
 * Assistant (spec 3.14) pure helpers: tab ids (including the legacy /ai hub ids),
 * confidence words, and the mapping from a grounded figure to a localized label
 * and the report it came from.
 */

export const ASSISTANT_TABS = ["ask", "review", "automations"] as const;
export type AssistantTab = (typeof ASSISTANT_TABS)[number];

/** Legacy `/ai?tab=` ids keep working: every old surface lands on its new home. */
const LEGACY_TAB: Record<string, AssistantTab> = {
  cfo: "ask",
  chat: "ask",
  assistant: "ask",
  inbox: "review",
  anomalies: "review",
  features: "automations",
};

export function resolveAssistantTab(requested: string | null | undefined): AssistantTab {
  if (!requested) return "ask";
  if ((ASSISTANT_TABS as readonly string[]).includes(requested)) return requested as AssistantTab;
  return LEGACY_TAB[requested] ?? "ask";
}

export type ConfidenceWord = "high" | "medium" | "low";

/** Confidence is shown as a word, never a percentage (it reads as false precision). */
export function confidenceWord(value: number | string | null | undefined): ConfidenceWord {
  const n = typeof value === "string" ? Number.parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "low";
  if (n >= 0.85) return "high";
  if (n >= 0.6) return "medium";
  return "low";
}

export interface GroundedFigure {
  id: string;
  label: string;
  value: number;
  unit: "AED" | "count";
  source?: string;
}

export interface FigurePresentation {
  /** Catalog key for the figure label. */
  labelKey: string;
  /** Catalog key for the source chip. */
  sourceKey: string;
  /** Where the figure can be checked. */
  href: string;
}

// Labels come from server/services/ai/grounding.ts (English, stable prefixes).
const FIGURES: Array<{ prefix: string } & FigurePresentation> = [
  {
    prefix: "Revenue",
    labelKey: "assistant.figRevenue",
    sourceKey: "assistant.srcProfitLoss",
    href: "/reports?tab=pl&report=profit-loss",
  },
  {
    prefix: "Expenses",
    labelKey: "assistant.figExpenses",
    sourceKey: "assistant.srcProfitLoss",
    href: "/reports?tab=pl&report=profit-loss",
  },
  {
    prefix: "Net profit",
    labelKey: "assistant.figNetProfit",
    sourceKey: "assistant.srcProfitLoss",
    href: "/reports?tab=pl&report=profit-loss",
  },
  {
    prefix: "Total assets",
    labelKey: "assistant.figAssets",
    sourceKey: "assistant.srcBalanceSheet",
    href: "/reports?tab=bs&report=balance-sheet",
  },
  {
    prefix: "Total liabilities",
    labelKey: "assistant.figLiabilities",
    sourceKey: "assistant.srcBalanceSheet",
    href: "/reports?tab=bs&report=balance-sheet",
  },
  {
    prefix: "Open receivables",
    labelKey: "assistant.figReceivables",
    sourceKey: "assistant.srcReceivables",
    href: "/invoices",
  },
  {
    prefix: "Open invoices",
    labelKey: "assistant.figOpenInvoices",
    sourceKey: "assistant.srcReceivables",
    href: "/invoices",
  },
  {
    prefix: "Receipts captured",
    labelKey: "assistant.figReceiptsCaptured",
    sourceKey: "assistant.srcReceipts",
    href: "/receipts",
  },
  {
    prefix: "Receipts posted",
    labelKey: "assistant.figReceiptsPosted",
    sourceKey: "assistant.srcReceipts",
    href: "/receipts",
  },
  {
    prefix: "Unposted receipt",
    labelKey: "assistant.figReceiptsUnposted",
    sourceKey: "assistant.srcReceipts",
    href: "/receipts",
  },
];

/** `null` for a figure we cannot label in both languages (it is then left out). */
export function presentFigure(figure: Pick<GroundedFigure, "label">): FigurePresentation | null {
  const hit = FIGURES.find((f) => figure.label.startsWith(f.prefix));
  return hit ? { labelKey: hit.labelKey, sourceKey: hit.sourceKey, href: hit.href } : null;
}

/** Distinct source chips for a set of figures, in first-seen order. */
export function sourcesFor(
  figures: ReadonlyArray<Pick<GroundedFigure, "label">>
): FigurePresentation[] {
  const seen = new Set<string>();
  const out: FigurePresentation[] = [];
  for (const f of figures) {
    const p = presentFigure(f);
    if (p && !seen.has(p.sourceKey)) {
      seen.add(p.sourceKey);
      out.push(p);
    }
  }
  return out;
}
