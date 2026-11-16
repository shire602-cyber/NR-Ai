import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "../../client/src/lib/utils";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("D3b design pass: system fixes", () => {
  it("cn() keeps the design type scale when a colour is merged after it", () => {
    // Before D3b tailwind-merge treated text-h1 as a colour and dropped it.
    expect(cn("text-h3 font-semibold text-foreground", "text-h1 text-negative")).toContain(
      "text-h1"
    );
    expect(cn("text-h3 text-foreground", "text-small text-muted-foreground")).toBe(
      "text-small text-muted-foreground"
    );
    expect(cn("text-sm", "text-caption")).toBe("text-caption");
  });

  it("RTL: tabular figures no longer force whole tables/containers into LTR", () => {
    const rtl = read("client/src/styles/rtl.css");
    expect(rtl).toContain(
      '[dir="rtl"] .tabular-nums:not(table):not(thead):not(tbody):not(tfoot):not(tr):not(:has(*))'
    );
    expect(rtl).not.toMatch(/\[dir="rtl"\] \.tabular-nums \{/);
  });
});

describe("D3b design pass: screens", () => {
  it.each([
    "client/src/pages/CorporateTax.tsx",
    "client/src/pages/Payroll.tsx",
    "client/src/pages/Budgets.tsx",
    "client/src/pages/CashFlowForecast.tsx",
    "client/src/pages/IntegrationsHub.tsx",
    "client/src/pages/MonthEndClose.tsx",
    "client/src/pages/SecuritySettings.tsx",
    "client/src/pages/AICFO.tsx",
    "client/src/pages/firm/FirmHealth.tsx",
  ])("%s starts with the shared PageHeader (no ad-hoc h1)", (file) => {
    const src = read(file);
    expect(src).toContain("<PageHeader");
    expect(src).not.toMatch(/<h1 className="text-(2xl|3xl)/);
  });

  it("notifications are an inbox list: unread dot, no tinted rows, localized priority", () => {
    const src = read("client/src/pages/Notifications.tsx");
    expect(src).toContain("data-unread");
    expect(src).not.toContain("bg-accent/50");
    expect(src).not.toContain(">High<");
    expect(src).toContain('t["pageLabels.notificationsPageTitle"]');
    expect(src).toContain("arLocale");
  });

  it("admin overview shows no fabricated month-over-month deltas", () => {
    const src = read("client/src/pages/Admin.tsx");
    expect(src).not.toMatch(/\+\d+%<\/span> from last month/);
  });

  it("VAT filing shows a true-state checklist and says nothing is transmitted", () => {
    const src = read("client/src/pages/VATFiling.tsx");
    expect(src).toContain('data-testid="vat-filing-checklist"');
    expect(src).toContain("Filed on EmaraTax (by you)");
    expect(src).toContain("Muhasib does not transmit anything to the FTA.");
  });

  it("report center: indicator badge is neutral and statements are a hairline list", () => {
    const parts = read("client/src/pages/reports/StatementParts.tsx");
    expect(parts).toMatch(/variant="neutral"\s+data-testid="data-basis-indicator"/);
    expect(parts).toContain("compact");
  });

  it("payroll runs: one outline next-step action, the rest in the row menu", () => {
    const src = read("client/src/pages/payroll/RunsTab.tsx");
    expect(src).toContain("<RowActions");
    expect(src).toContain('<MoneyCell amount={Number(r.total_net)} currency="AED" />');
  });

  it("client portal layout collapses the sidebar on phones", () => {
    const src = read("client/src/components/layout/PortalLayout.tsx");
    expect(src).toContain("hidden w-60 flex-shrink-0 flex-col border-e");
    expect(src).toContain("md:hidden");
    expect(src).not.toContain("bg-info");
  });

  it("subscription and cash forecast use the shared money/date formatters", () => {
    const sub = read("client/src/pages/Subscription.tsx");
    expect(sub).not.toContain("toLocaleDateString");
    expect(sub).toContain("formatMoneyText");
    const cff = read("client/src/pages/CashFlowForecast.tsx");
    expect(cff).toContain("formatDateRange(proj.weekStart, proj.weekEnd, locale)");
  });
});
