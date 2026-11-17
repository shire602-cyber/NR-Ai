/**
 * D2b: regression guards for the CTO D2 checkpoint fixes (design/CTO-CHECKPOINT-D2.md).
 * Source-level checks for the shared primitives, tokens, shell and dashboard.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDashboardSource } from "./dashboardSource";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("D2b CTO checkpoint guards", () => {
  it("1: Money renders isolated sign/amount/currency spans from the one formatter", () => {
    const money = read("client/src/components/ui/money.tsx");
    expect(money).toContain("formatMoneyParts");
    expect(money).toContain('className="money-sign"');
    expect(money).toContain('className="money-amount"');
    expect(money).toContain('className="money-currency"');
    expect(money).not.toMatch(/Intl\.NumberFormat/);
    const format = read("client/src/lib/format.ts");
    expect(format).toMatch(/return formatMoneyText\(/);
    // The dashboard renders amounts through <Money>, never ad-hoc Intl.
    expect(readDashboardSource()).not.toMatch(/Intl\.NumberFormat/);
  });

  it("2: Arabic stack keeps Latin + digits in Geist and loads only the Arabic Noto subset", () => {
    const css = read("client/src/index.css");
    expect(css).toMatch(/--font-arabic: "Geist Sans", "Noto Sans Arabic"/);
    // WP-A (Fable spec 2.1): Arabic body is 15 / 26.
    expect(css).toMatch(/\[dir="rtl"\] body \{\s*font-size: 0\.9375rem;\s*line-height: 1\.625rem;/);
    expect(read("client/src/components/RTLProvider.tsx")).toContain(
      "@fontsource/noto-sans-arabic/arabic-400.css"
    );
    expect(read("tailwind.config.ts")).toContain('mono: ["var(--font-figures)"]');
  });

  it("3: table rows are 44px (36px compact), headers 36px, row actions overflow into a menu", () => {
    const table = read("client/src/components/ui/table.tsx");
    expect(table).toContain('"h-9 px-4 text-start');
    expect(table).toContain("h-11 px-4 py-2");
    expect(table).toContain("group-data-[density=compact]/table:h-9");
    expect(table).toContain("[&[data-nowrap]]:whitespace-nowrap");
    expect(read("client/src/components/ui/row-actions.tsx")).toContain("MoreHorizontal");
    const invoices = read("client/src/pages/Invoices.tsx");
    expect(invoices).toContain("<RowActions");
    // Row actions are muted icons; no coloured action glyphs in the table.
    expect(invoices).not.toContain('<FileCode className="w-4 h-4 text-info" />');
    expect(invoices).not.toContain('<DollarSign className="w-4 h-4 text-success" />');
    expect(invoices).not.toContain('<RotateCcw className="w-4 h-4 text-warning" />');
  });

  it("4: dashboard shows each figure once and the sparkline slot only with a series", () => {
    const dash = readDashboardSource();
    expect(dash).not.toContain("DrillThroughTiles");
    expect(dash).not.toContain("TaxWidgets");
    expect(dash).toContain('testId="tile-receivables"');
    expect(dash).toContain("dashboard.receivablesHint");
    expect(read("client/src/components/ui/stat-card.tsx")).toContain(
      '<div className="mt-4 hidden sm:block">{visual}</div>'
    );
  });

  it("5: the dashboard launcher is compact: Open + overflow menu, five rows", () => {
    const picker = read("client/src/components/reports/ReportLaunchPicker.tsx");
    expect(picker).toContain("compact ? reports.slice(0, 5) : reports");
    expect(picker).toContain("components.launchViewAll");
    expect(picker).not.toContain("uppercase");
    expect(read("client/src/pages/dashboard/DashboardActions.tsx")).toContain("compact");
  });

  it("6: charts are thin, brand for revenue, neutral dashed for expenses (spec 2.7 chartTheme)", () => {
    // WP-C: the dashboard charts spread the shared chartTheme instead of local props, so the
    // contract is that the theme is used for each series (the theme pins 1.5 px / dashed).
    const charts = read("client/src/pages/dashboard/DashboardCharts.tsx");
    expect(charts).toContain('chartTheme.area("brand")');
    expect(charts).toContain("chartTheme.comparisonLine");
    expect(charts).not.toContain("PieChart");
    // Owner/coordinator decision over spec 2.3 (neutral-400, 2.62:1): the expense/comparison
    // series must reach WCAG 2.1 SC 1.4.11 non-text contrast (3:1 for graphics); 220 9% 56% is
    // 3.40:1 on the white card.
    expect(read("client/src/index.css")).toContain("--chart-neutral: 220 9% 56%");
  });

  it("7: StatusBadge carries localized overdue days", () => {
    const badge = read("client/src/components/ui/badge.tsx");
    expect(badge).toContain("components.statusOverdueDays");
    const ar = JSON.parse(read("client/src/locales/ar/components.json"));
    expect(ar["components.statusOverdueDays"]).toBe("متأخر {days} يومًا");
  });

  it("8: mobile top bar has the brand mark + company switcher; theme moves to More", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('<CompanySwitcher variant="compact" />');
    expect(app).toContain('<ThemeToggle className="hidden md:inline-flex" />');
    expect(app).toContain("hidden text-muted-foreground hover:text-foreground md:inline-flex");
    expect(read("client/src/components/MobileNav.tsx")).toContain("mobile-theme-options");
  });

  it("9: dark primary is a deep emerald with white text; surfaces step off the canvas", () => {
    const css = read("client/src/index.css");
    expect(css).toContain("--primary: 159 66% 31%;");
    expect(css).toMatch(/\.dark \{[\s\S]*--primary-foreground: 0 0% 100%;/);
    expect(css).toContain("--card: 223 24% 11%;");
    expect(css).toContain("--popover: 223 22% 13%;");
  });

  it("10: no marketing chip or info pills in the chrome; notification count caps at 9+", () => {
    expect(read("client/src/App.tsx")).not.toContain("uaeTaxReady");
    expect(readDashboardSource()).not.toContain("pageLabels.realTime");
    expect(read("client/src/components/NotificationBell.tsx")).toContain(
      'unreadCount > 9 ? "9+" : unreadCount'
    );
  });

  it("12: expand chevrons never mirror in RTL; KPI figures use the h1 step", () => {
    expect(read("client/src/pages/dashboard/ReportWorkspaceToggle.tsx")).toContain("ChevronDown");
    // WP-A: the More sheet's chevrons are lucide ChevronRight with rtl:rotate-180 (they point
    // into the row in both directions); the old collapsible summary chevron was deleted.
    expect(read("client/src/components/MobileNav.tsx")).toContain(
      'ChevronRight className="mobile-nav-more-chevron rtl:rotate-180"'
    );
    const stat = read("client/src/components/ui/stat-card.tsx");
    // WP-A (Fable spec 2.1/2.7): the KPI figure uses the responsive `text-kpi` step.
    expect(stat).toContain("text-kpi");
    expect(stat).not.toContain('DeltaIcon className="h-3 w-3 rtl:-scale-x-100"');
  });
});
