// @vitest-environment jsdom
/**
 * WP-A (Fable design spec section 2): behaviour tests for the shared primitive contract that
 * WP-B..WP-E build on — rendered in jsdom and inspected, plus the mobile More sheet.
 * CSS-token checks at the end read index.css because jsdom does not apply stylesheets.
 */
import { createElement as h, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  window.matchMedia =
    window.matchMedia ||
    ((q: string) =>
      ({
        matches: false,
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
});

const render = (el: ReactElement) => act(() => root.render(el));

describe("WP-A primitives", () => {
  it("StatCard renders the spec anatomy: no icon, text-kpi figure, sparkline only with >=2 points", async () => {
    const { StatCard } = await import("../../client/src/components/ui/stat-card");
    const { Landmark } = await import("lucide-react");
    render(
      h(StatCard, {
        label: "Revenue",
        value: "AED 1",
        icon: Landmark,
        sparkline: [1, 3, 2],
        delta: { label: "+1%", direction: "up", tone: "positive" },
        testId: "kpi",
      })
    );
    const card = container.querySelector('[data-testid="kpi"]')!;
    expect(card.querySelectorAll("svg.lucide-landmark").length).toBe(0);
    expect(card.querySelector(".text-kpi")?.textContent).toBe("AED 1");
    expect(card.querySelector('[data-testid="stat-sparkline"]')).not.toBeNull();
    render(h(StatCard, { label: "Cash", value: "1", sparkline: [5], testId: "kpi2" }));
    expect(container.querySelector('[data-testid="stat-sparkline"]')).toBeNull();
  });

  it("EmptyState has exactly three sizes; lg shows the ledger backdrop and a ghost preview", async () => {
    const { EmptyState } = await import("../../client/src/components/ui/empty-state");
    const { FileText } = await import("lucide-react");
    render(h(EmptyState, { size: "sm", title: "No runs yet.", action: { label: "Run" } }));
    expect(container.querySelector('[data-size="sm"]')?.textContent).toContain("No runs yet.");
    expect(container.querySelector("h3, h2")).toBeNull();
    render(h(EmptyState, { icon: FileText, title: "No quotes" }));
    expect(container.querySelector('[data-size="md"] h3')?.textContent).toBe("No quotes");
    render(h(EmptyState, { size: "lg", title: "Connect your bank", previewColumns: 3 }));
    const lg = container.querySelector('[data-size="lg"]')!;
    expect(lg.querySelector(".bg-ledger-ruling")).not.toBeNull();
    expect(lg.querySelector("h2")?.className).toContain("text-h2");
    expect(lg.querySelector('[data-testid="empty-state-preview"]')).not.toBeNull();
  });

  it("Alert tone draws the tone icon and announces only warning/danger", async () => {
    const { Alert } = await import("../../client/src/components/ui/alert");
    render(h(Alert, { tone: "info", title: "Heads up" }, "Body"));
    const info = container.querySelector('[data-tone="info"]')!;
    expect(info.getAttribute("role")).toBe("status");
    expect(info.className).toContain("bg-info-subtle");
    expect(info.querySelector("[data-alert-icon]")).not.toBeNull();
    render(h(Alert, { tone: "danger", icon: false }, "Failed"));
    const danger = container.querySelector('[data-tone="danger"]')!;
    expect(danger.getAttribute("role")).toBe("alert");
    expect(danger.querySelector("[data-alert-icon]")).toBeNull();
  });

  it("SetupNotice is neutral, one sentence and an optional action", async () => {
    const { SetupNotice } = await import("../../client/src/components/ui/setup-notice");
    let clicked = 0;
    render(
      h(
        SetupNotice,
        { action: { label: "Download", onClick: () => clicked++ } },
        "Not emailed yet."
      )
    );
    const el = container.querySelector('[data-testid="setup-notice"]')!;
    expect(el.className).toContain("bg-surface-sunken");
    act(() => el.querySelector("button")!.click());
    expect(clicked).toBe(1);
  });

  it("PageHeader puts secondaries, the ⋯ menu and then the one primary at the inline end; no icon tile", async () => {
    const { PageHeader } = await import("../../client/src/components/ui/page-header");
    const { Button } = await import("../../client/src/components/ui/button");
    const { Landmark } = await import("lucide-react");
    render(
      h(PageHeader, {
        title: "Invoices",
        icon: Landmark,
        secondaryActions: h(Button, { variant: "outline" }, "Export"),
        overflow: h("div", null, "Import"),
        primaryAction: h(Button, null, "New invoice"),
      })
    );
    const buttons = [...container.querySelectorAll("header button")].map(
      (b) => b.textContent || b.getAttribute("aria-label")
    );
    expect(buttons).toEqual(["Export", "More actions", "New invoice"]);
    expect(container.querySelector("svg.lucide-landmark")).toBeNull();
    expect(container.querySelector("h1")?.className).toContain("text-h1");
  });

  it("RowActions maxInline keeps one button visible and moves the rest into the menu", async () => {
    const { RowActions, RowActionButton } =
      await import("../../client/src/components/ui/row-actions");
    const { Pencil, Send } = await import("lucide-react");
    render(
      h(
        RowActions,
        { maxInline: 1, menuTestId: "row-menu" },
        h(RowActionButton, { label: "Send", icon: Send, "data-testid": "btn-send" }),
        h(RowActionButton, { label: "Edit", icon: Pencil, "data-testid": "btn-edit" })
      )
    );
    expect(container.querySelector('[data-testid="btn-send"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="btn-edit"]')).toBeNull();
    expect(container.querySelector('[data-testid="row-menu"]')).not.toBeNull();
  });

  it("FileDrop keeps a real file input (with its test id) and reports chosen files", async () => {
    const { FileDrop } = await import("../../client/src/components/ui/file-drop");
    const got: File[] = [];
    render(h(FileDrop, { onFiles: (f: File[]) => got.push(...f), inputTestId: "input-file" }));
    const input = container.querySelector<HTMLInputElement>('[data-testid="input-file"]')!;
    expect(input.type).toBe("file");
    expect(input.getAttribute("aria-label")).toBeTruthy();
    const file = new File(["a,b"], "statement.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(got.map((f) => f.name)).toEqual(["statement.csv"]);
    expect(container.textContent).not.toContain("No file chosen");
  });

  it("RankedBars ranks the top 5 and folds the rest into Other; empty is an sm empty state", async () => {
    const { RankedBars } = await import("../../client/src/components/ui/ranked-bars");
    const items = [1, 7, 3, 9, 5, 2, 4].map((v) => ({
      id: `i${v}`,
      label: `L${v}`,
      value: v * 100,
    }));
    render(h(RankedBars, { items, display: undefined }));
    const rows = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toContain("L9");
    expect(rows[5]).toContain("Other");
    render(h(RankedBars, { items: [] }));
    expect(container.querySelector('[data-size="sm"]')).not.toBeNull();
  });

  it("ScrollTabs moves tabs past maxVisible into a More menu that is itself a tab", async () => {
    const { Tabs, TabsTrigger } = await import("../../client/src/components/ui/tabs");
    const { ScrollTabs } = await import("../../client/src/components/ui/scroll-tabs");
    const values = ["a", "b", "c", "d", "e", "f", "g"];
    render(
      h(
        Tabs,
        { value: "a" },
        h(
          ScrollTabs,
          { maxVisible: 5, value: "a", "aria-label": "Tabs" },
          ...values.map((v) => h(TabsTrigger, { key: v, value: v }, v.toUpperCase()))
        )
      )
    );
    const list = container.querySelector('[role="tablist"]')!;
    const tabs = [...list.children];
    expect(tabs).toHaveLength(5);
    expect(tabs.every((el) => el.getAttribute("role") === "tab")).toBe(true);
    expect(list.querySelector('[data-testid="scroll-tabs-more"]')).not.toBeNull();
  });

  it("chartTheme: brand first, neutral comparison, horizontal grid only, compact axis labels", async () => {
    const { chartTheme, formatAxisCompact } =
      await import("../../client/src/components/ui/chart-theme");
    expect(chartTheme.series[0]).toBe("hsl(var(--chart-1))");
    expect(chartTheme.comparisonLine.stroke).toBe("hsl(var(--chart-neutral))");
    expect(chartTheme.grid.vertical).toBe(false);
    expect(chartTheme.xAxis.axisLine).toBe(false);
    expect(chartTheme.bar("brand").maxBarSize).toBe(28);
    expect(formatAxisCompact(75000)).toBe("75k");
    expect(formatAxisCompact(1250000)).toBe("1.3M");
    expect(formatAxisCompact(-2500)).toBe("−2.5k");
  });

  it("SettingsLayout marks the current section and lists the spec sections", async () => {
    const { Router } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const { SettingsLayout } = await import("../../client/src/components/layout/SettingsLayout");
    const { hook } = memoryLocation({ path: "/backup-restore" });
    render(h(Router, { hook }, h(SettingsLayout, null, h("p", null, "body"))));
    const current = container.querySelector('[aria-current="page"]');
    expect(current?.getAttribute("data-testid")).toBe("settings-nav-data");
    expect(container.querySelectorAll("nav a[href]").length).toBe(11); // WQ3 added Settings › Tax rates
  });

  it("EditorShell renders the form, a labelled preview and a sticky footer", async () => {
    const { EditorShell } = await import("../../client/src/components/ui/editor-shell");
    render(
      h(
        EditorShell,
        { title: "New invoice", preview: h("div", null, "PDF"), footer: h("button", null, "Save") },
        h("form", null, "fields")
      )
    );
    expect(container.querySelector("h1")?.textContent).toBe("New invoice");
    expect(container.querySelector('aside[aria-label="Preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="editor-shell-footer"]')?.className).toContain(
      "sticky"
    );
  });
});

describe("WP-A shell", () => {
  it("the mobile More sheet lists grouped 44px rows with full labels in both languages", async () => {
    const { MobileNav } = await import("../../client/src/components/MobileNav");
    const { useI18n } = await import("../../client/src/lib/i18n");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    for (const locale of ["en", "ar"] as const) {
      act(() => useI18n.getState().setLocale(locale));
      render(h(QueryClientProvider, { client: qc }, h(MobileNav)));
      const more = [...container.querySelectorAll<HTMLButtonElement>(".mobile-nav-tab")].at(-1)!;
      await act(async () => more.click());
      const headings = [...container.querySelectorAll(".mobile-nav-more-heading")].map(
        (el) => el.textContent
      );
      expect(headings.length).toBeGreaterThanOrEqual(6);
      const rows = [
        ...container.querySelectorAll('[data-testid="mobile-more-nav"] .mobile-nav-more-label'),
      ];
      expect(rows.length).toBeGreaterThan(20);
      for (const row of rows) expect(row.textContent?.trim(), locale).toBeTruthy();
      if (locale === "ar") {
        for (const row of rows) expect(row.textContent, row.textContent!).toMatch(/[؀-ۿ]|ZATCA/);
      }
      expect(container.querySelector("details")).toBeNull();
      await act(async () => more.click());
    }
  });

  it("the app 404 renders inside the shell with a dashboard action", async () => {
    const NotFound = (await import("../../client/src/pages/not-found")).default;
    render(h(NotFound));
    expect(container.querySelector("h1")?.textContent).toBe("This page is not in the ledger.");
    expect(container.querySelector('[data-testid="link-not-found-dashboard"]')).not.toBeNull();
  });
});

describe("WP-A tokens (stylesheet source; jsdom applies no CSS)", () => {
  const css = read("client/src/index.css");
  it("defines the inverse surface, chart grid/axis and disabled tokens in light and dark", () => {
    const dark = css.slice(css.indexOf(".dark {"));
    for (const token of [
      "--surface-inverse:",
      "--chart-grid:",
      "--chart-axis:",
      "--disabled-surface:",
    ]) {
      expect(css, token).toContain(token);
      expect(dark, `dark ${token}`).toContain(token);
    }
    expect(css).toContain("--chart-2: 215 45% 45%;");
    expect(dark).toContain("--chart-2: 215 60% 66%;");
  });
  it("widths follow spec 2.2", () => {
    expect(css).toContain("--content-max: 1280px;");
    expect(css).toContain("--content-narrow: 760px;");
  });
});
