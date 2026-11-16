/**
 * Dashboard period selection (R13-19). The server resolves the preset against
 * the UAE calendar and the company fiscal year; the client only carries the
 * choice (preset, plus from/to for custom) and remembers it per viewer.
 */
import { useCallback, useState } from "react";

export type DashboardPreset = "month" | "quarter" | "ytd" | "custom";

export interface DashboardPeriodChoice {
  preset: DashboardPreset;
  from?: string;
  to?: string;
}

export const DASHBOARD_PRESETS: DashboardPreset[] = ["month", "quarter", "ytd", "custom"];

/** Localized preset labels (shared by the selector and the server-resolved period chip). */
export const DASHBOARD_PRESET_LABELS: Record<DashboardPreset, { en: string; ar: string }> = {
  month: { en: "This month", ar: "هذا الشهر" },
  quarter: { en: "This quarter", ar: "هذا الربع" },
  ytd: { en: "Year to date", ar: "منذ بداية السنة" },
  custom: { en: "Custom", ar: "فترة مخصصة" },
};

/**
 * Display label for the period the server resolved. The server's `label` is English, so
 * presets are relabelled here and a custom range is rendered as "from – to" (R18-02).
 */
export function dashboardPeriodLabel(
  period: { preset?: string; from?: string; to?: string; label?: string } | undefined,
  locale: string
): string {
  if (!period) return "";
  const preset = period.preset as DashboardPreset | undefined;
  const lang = locale === "ar" ? "ar" : "en";
  if (preset && preset !== "custom" && DASHBOARD_PRESET_LABELS[preset]) {
    return DASHBOARD_PRESET_LABELS[preset][lang];
  }
  if (period.from && period.to) return `${period.from} – ${period.to}`;
  return period.label ?? "";
}

const STORAGE_KEY = "muhasib.dashboard.period";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCompleteChoice(choice: DashboardPeriodChoice): boolean {
  if (choice.preset !== "custom") return true;
  return Boolean(
    choice.from &&
    choice.to &&
    ISO_DATE.test(choice.from) &&
    ISO_DATE.test(choice.to) &&
    choice.from <= choice.to
  );
}

/** Query string for the stats / expense-breakdown endpoints ("" for the default month view). */
export function periodQueryString(choice: DashboardPeriodChoice): string {
  if (choice.preset === "month") return "";
  // An unfinished custom range keeps showing the default month until both dates are valid.
  if (choice.preset === "custom" && !isCompleteChoice(choice)) return "";
  const params = new URLSearchParams({ preset: choice.preset });
  if (choice.preset === "custom" && isCompleteChoice(choice)) {
    params.set("from", choice.from as string);
    params.set("to", choice.to as string);
  }
  return `?${params.toString()}`;
}

function readStored(): DashboardPeriodChoice {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { preset: "month" };
    const parsed = JSON.parse(raw) as DashboardPeriodChoice;
    if (!DASHBOARD_PRESETS.includes(parsed.preset)) return { preset: "month" };
    return parsed.preset === "custom" && !isCompleteChoice(parsed) ? { preset: "month" } : parsed;
  } catch {
    return { preset: "month" };
  }
}

/** Remembers the selected period in this browser only (a per-viewer convenience). */
export function useDashboardPeriod() {
  const [choice, setChoice] = useState<DashboardPeriodChoice>(readStored);
  const update = useCallback((next: DashboardPeriodChoice) => {
    setChoice(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage can be blocked; the choice then lasts for this page view only
    }
  }, []);
  return { choice, setChoice: update, query: periodQueryString(choice) };
}
