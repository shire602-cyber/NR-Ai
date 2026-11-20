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

/** Space kept between the newest turn and the composer, and under the page header (N3). */
export const REVEAL_GAP_PX = 16;

/**
 * How far to scroll the thread so the newest turn ends just above the docked composer (N3).
 * The bottom of the visible thread is the composer's top, not the viewport's bottom, because
 * the composer (and on a phone the tab bar under it) cover the end of the scroll area. A turn
 * taller than the space left keeps its question in view instead of scrolling it off the top.
 * Positive scrolls down; 0 when the turn is already fully visible.
 */
export function revealScrollDelta(input: {
  turnTop: number;
  turnBottom: number;
  composerTop: number;
  visibleTop: number;
}): number {
  const overlap = input.turnBottom - (input.composerTop - REVEAL_GAP_PX);
  if (overlap <= 0) return 0;
  const roomAbove = Math.max(0, input.turnTop - (input.visibleTop + REVEAL_GAP_PX));
  return Math.round(Math.min(overlap, roomAbove));
}

// ─── AS1: grounded answers (segments, facts, missing links) ─────────────────

/** One piece of an answer: text, or an amount the client formats (A3). */
export type AnswerSegment =
  | { type: "text"; text: string }
  | { type: "money"; value: number; currency: string }
  | { type: "number"; value: number };

/** A fact the answer rests on, as `/api/ai/nl-gateway` returns it (A4). */
export interface AnswerFigure {
  id: string;
  /** `assistant.fact.<key>` in the catalogs. */
  key: string;
  value: number;
  unit: "AED" | "count";
  params: Record<string, string | number>;
  source: { key: string; href: string };
}

export interface AnswerMissing {
  key: string;
  href: string;
}

const CITATION = /\s*\(?\[\s*F\d+(?:\s*[,،]\s*F\d+)*\s*\]\)?/g;

/** Text of an answer without citation markers (A2), for answers that carry no segments. */
export function stripCitations(text: string): string {
  return text.replace(CITATION, "").replace(/\s+([.,;:!?،؛؟])/g, "$1");
}

/** Segments for an answer: the server's, else the plain text without markers. */
export function answerSegments(answer: {
  response: string;
  segments?: AnswerSegment[];
}): AnswerSegment[] {
  if (answer.segments && answer.segments.length > 0) return answer.segments;
  return [{ type: "text", text: stripCitations(answer.response ?? "") }];
}

/** Facts whose label is the record's own name (a customer, a bank or expense account). */
export const NAME_LABELLED_FACTS: ReadonlySet<string> = new Set([
  "customerOwes",
  "cashAccount",
  "expenseAccount",
]);

/** Catalog keys of the source chips, by the server's source key. */
export const SOURCE_LABEL_KEYS: Record<string, string> = {
  profitLoss: "assistant.srcProfitLoss",
  balanceSheet: "assistant.srcBalanceSheet",
  invoices: "assistant.srcReceivables",
  bills: "assistant.srcBills",
  vat: "assistant.srcVat",
  bank: "assistant.srcBank",
  receipts: "assistant.srcReceipts",
  corporateTax: "assistant.srcCorporateTax",
};

/** Distinct source chips of a set of facts, in first-seen order. */
export function factSources(
  figures: ReadonlyArray<Pick<AnswerFigure, "source">>
): Array<{ labelKey: string; href: string }> {
  const seen = new Set<string>();
  const out: Array<{ labelKey: string; href: string }> = [];
  for (const f of figures) {
    const labelKey = SOURCE_LABEL_KEYS[f.source.key];
    if (!labelKey || seen.has(f.source.key)) continue;
    seen.add(f.source.key);
    out.push({ labelKey, href: f.source.href });
  }
  return out;
}

/**
 * Values for a fact label template: periods and dates in the app's date format (never ISO),
 * names in the active language when an Arabic name exists.
 */
export function factLabelValues(
  params: Record<string, string | number>,
  locale: string,
  fmt: {
    date: (iso: string, locale: string) => string;
    range: (from: string, to: string, locale: string) => string;
  }
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params };
  if (typeof params.from === "string" && typeof params.to === "string") {
    out.period = fmt.range(params.from, params.to, locale);
  }
  for (const k of ["date", "due"] as const) {
    const v = params[k];
    if (typeof v === "string" && v) out[k] = fmt.date(v, locale);
  }
  if (locale === "ar" && typeof params.nameAr === "string" && params.nameAr) {
    out.name = params.nameAr;
  }
  if (params.number === "") out.number = "—";
  // Names and document numbers are data in either script: isolate them so an Arabic customer
  // name inside an English label (or a Latin code inside Arabic) keeps its own direction.
  for (const k of ["name", "number"] as const) {
    const v = out[k];
    if (typeof v === "string" && v) out[k] = `⁨${v}⁩`;
  }
  return out;
}
