// @vitest-environment jsdom
/**
 * F7 / R18-02, R18-11: unit-level guard for Arabic runtime completeness. The static i18n
 * scanner cannot see copy that comes from data, hooks or libraries (report catalog labels,
 * chart configs, empty states passed as props), so these tests render the real dashboard
 * sections that the runtime crawl (tests/e2e/arabic-runtime-crawl.mjs) found in English and
 * count rendered text nodes that still read as English, using the same classifier.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

// The dashboard header asks the subscription for a read-only plan action; this guard renders
// it without the company providers, in a workspace that can write.
vi.mock("../../client/src/hooks/useReadOnlyPlanCta", () => ({ useReadOnlyPlanCta: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  // Catalog queries never settle in this test: the launcher renders its local catalog.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined))
  );
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
}

/** Every non-empty rendered text node, plus placeholders, as a "line". */
function renderedLines(): string[] {
  const lines: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (value) lines.push(value);
  }
  for (const el of container.querySelectorAll("[placeholder]")) {
    lines.push(el.getAttribute("placeholder") ?? "");
  }
  return lines;
}

function englishLines(): string[] {
  return renderedLines().filter((line) => isEnglishLine(line));
}

function withQueryClient(child: ReturnType<typeof createElement>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, child);
}

async function fakeModel(locale: "en" | "ar") {
  const { t } = await import("../../client/src/lib/i18n");
  const mutation = { isPending: false, variables: undefined, mutate: () => undefined };
  return {
    t: t[locale],
    locale,
    recentInvoices: [],
    invoicesLoading: false,
    journalEntries: [],
    expenseData: [],
    expenseLoading: false,
    monthlyTrends: [],
    trendsLoading: false,
    selectedCompanyId: null,
    preferredReportWorkspace: { persona: "owner" },
    dashboardPinnedDeliveryAutomationCommand: null,
    queueDashboardReportDeliverySubscription: mutation,
    retryDashboardReportDeliveryRun: mutation,
    dashboardReportDeliveryLauncherPreviewById: {},
    queueDashboardReportDeliverySubscriptionWithHandoffGuard: () => undefined,
    periodChoice: { preset: "month" },
    setPeriodChoice: () => undefined,
    stats: undefined,
    statsLoading: false,
    margin: 0,
  } as never;
}

describe("F7 Arabic runtime render guard (R18-02)", () => {
  it("[R18-02] the report launcher renders catalog labels in Arabic (keyed overlay)", async () => {
    const { ReportLaunchPicker } =
      await import("../../client/src/components/reports/ReportLaunchPicker");
    await setLocale("en");
    act(() =>
      root.render(withQueryClient(createElement(ReportLaunchPicker, { persona: "owner" })))
    );
    // English keeps the catalog source labels.
    expect(container.textContent).toContain("Owner cash control suite");
    expect(container.textContent).toContain("Profit & Loss");

    await setLocale("ar");
    expect(container.textContent).toContain("مجموعة المالك للتحكم في السيولة");
    expect(container.textContent).toContain("الأرباح والخسائر");
    expect(englishLines()).toEqual([]);
  });

  it("[R18-02] every persona of the launcher is Arabic in Arabic mode", async () => {
    const { ReportLaunchPicker } =
      await import("../../client/src/components/reports/ReportLaunchPicker");
    await setLocale("ar");
    for (const persona of ["owner", "freelancer", "accountant"] as const) {
      act(() =>
        root.render(withQueryClient(createElement(ReportLaunchPicker, { key: persona, persona })))
      );
      expect(englishLines(), persona).toEqual([]);
    }
  });

  it("[R18-02] dashboard header actions, recent activity and chart empty states are Arabic", async () => {
    // D2b: the quick-action cards moved into the header (primary, outline and the ⋯ menu).
    const { DashboardHero } = await import("../../client/src/pages/dashboard/DashboardHero");
    const { DashboardActions } = await import("../../client/src/pages/dashboard/DashboardActions");
    const { DashboardRecent } = await import("../../client/src/pages/dashboard/DashboardRecent");
    const { DashboardCharts } = await import("../../client/src/pages/dashboard/DashboardCharts");
    await setLocale("ar");
    const m = await fakeModel("ar");
    act(() =>
      root.render(
        withQueryClient(
          createElement(
            "div",
            null,
            createElement(DashboardHero, { m }),
            createElement(DashboardCharts, { m }),
            createElement(DashboardActions, { m }),
            createElement(DashboardRecent, { m })
          )
        )
      )
    );
    expect(container.textContent).toContain("نظرة عامة");
    expect(container.textContent).toContain("لا توجد فواتير بعد");
    expect(englishLines()).toEqual([]);
  });
});

describe("F7 locale-aware formatting helpers", () => {
  it("[R18-02] month keys render as Arabic month names in Arabic", async () => {
    const { formatMonthKey } = await import("../../client/src/lib/format");
    expect(formatMonthKey("2026-11", "en")).toBe("Nov");
    expect(formatMonthKey("2026-11", "ar")).toMatch(/[؀-ۿ]/);
    expect(isEnglishLine(formatMonthKey("2026-06", "ar"))).toBe(false);
    expect(formatMonthKey("not-a-key", "ar")).toBe("not-a-key");
  });

  it("[R18-02] the dashboard period chip is relabelled client-side", async () => {
    const { dashboardPeriodLabel } = await import("../../client/src/pages/dashboard/period");
    const month = { preset: "month", from: "2026-11-01", to: "2026-11-16", label: "This month" };
    expect(dashboardPeriodLabel(month, "en")).toBe("This month");
    expect(dashboardPeriodLabel(month, "ar")).toBe("هذا الشهر");
    expect(
      dashboardPeriodLabel({ preset: "custom", from: "2026-01-01", to: "2026-03-31" }, "ar")
    ).toBe("2026-01-01 – 2026-03-31");
  });

  it("[R18-02] date-fns options carry the Arabic locale only in Arabic", async () => {
    const { format } = await import("date-fns");
    const { dateFnsOptions } = await import("../../client/src/lib/date-locale");
    const due = new Date(2027, 0, 28);
    expect(format(due, "d MMMM yyyy", dateFnsOptions("en"))).toBe("28 January 2027");
    expect(isEnglishLine(format(due, "d MMMM yyyy", dateFnsOptions("ar")))).toBe(false);
  });
});
