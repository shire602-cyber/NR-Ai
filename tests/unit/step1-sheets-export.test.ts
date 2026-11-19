// @vitest-environment jsdom
/**
 * STEP1 R1/R3: Reports > Export offers "Export to Google Sheets" only when Sheets is connected
 * (disabled with a link to Integrations otherwise), the two server errors carry codes with Arabic
 * copy, and the exported title uses the reader's date-range format.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let status: unknown = {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (url.includes("/api/integrations/status")) return json(status);
      return json({});
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function openExportMenu() {
  const [{ queryClient }, { ReportsPageContext }, { default: ReportsHeader }] = await Promise.all([
    import("../../client/src/lib/queryClient"),
    import("../../client/src/pages/reports/context"),
    import("../../client/src/pages/reports/panels/ReportsHeader"),
  ]);
  const i18n = await import("../../client/src/lib/i18n");
  queryClient.clear();
  const ctx = new Proxy(
    {
      activeReportWorkspaceTab: "reports",
      backToReportsHref: "/reports",
      dateRange: {},
      handleExportExcel: () => {},
      handleExportGoogleSheets: () => {},
      hasFocusedReportSelection: false,
      hasReportWorkflowContextFilters: false,
      isExporting: false,
      reportViewerGroups: [],
      selectedCompanyId: "c1",
      setDateRange: () => {},
      t: i18n.t.en,
    } as Record<string, unknown>,
    { get: (target, key) => (key in target ? target[key as string] : undefined) }
  );
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ReportsPageContext.Provider,
          { value: ctx as never },
          createElement(ReportsHeader)
        )
      )
    );
  });
  await flush();
  const trigger = container.querySelector('[data-testid="button-export"]') as HTMLElement;
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
    );
  });
  await flush();
}

describe("STEP1 R1: Export to Google Sheets follows the connection", () => {
  it("is disabled, with a link to Integrations, when Sheets is not connected", async () => {
    status = { googleSheets: { connected: false } };
    await openExportMenu();
    const item = document.querySelector('[data-testid="menu-export-sheets"]') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.getAttribute("aria-disabled")).toBe("true");
    const hint = document.querySelector('[data-testid="menu-export-sheets-connect"]');
    expect(hint?.getAttribute("href")).toBe("/integrations-hub");
    expect(hint?.textContent).toContain("Integrations");
  });

  it("is enabled, with no hint, when Sheets is connected", async () => {
    status = { googleSheets: { connected: true } };
    await openExportMenu();
    const item = document.querySelector('[data-testid="menu-export-sheets"]') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.getAttribute("aria-disabled")).toBeNull();
    expect(document.querySelector('[data-testid="menu-export-sheets-connect"]')).toBeNull();
  });
});

describe("STEP1 R1: Sheets error copy", () => {
  it.each(["GOOGLE_SHEETS_NOT_CONNECTED", "INVALID_SHEETS_URL"])(
    "%s reads in Arabic (no generic 'check your input' advice)",
    async (code) => {
      const { useI18n } = await import("../../client/src/lib/i18n");
      const { localizeApiError } = await import("../../client/src/lib/validation-messages");
      useI18n.setState({ locale: "ar" });
      const text = localizeApiError({ code, message: "Google Sheets not connected" })!;
      expect(text).toMatch(/[؀-ۿ]/);
      expect(text).toContain("Google Sheets");
      expect(text).not.toContain("راجع البيانات المدخلة");
      useI18n.setState({ locale: "en" });
    }
  );
});

describe("STEP1 R3: Sheets export title uses the locale's date range", () => {
  it("formats the range with formatDateRange, not 'MMM dd, yyyy'", async () => {
    const { formatDateRange } = await import("../../client/src/lib/format-date");
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 5, 30);
    expect(formatDateRange(from, to, "ar")).toMatch(/[؀-ۿ]/);
    expect(formatDateRange(from, to, "ar")).not.toMatch(/Jan|Jun/);
    // Source check: the hook must call formatDateRange for the title (the hook needs the whole
    // Reports page state to run, so it cannot be rendered in isolation).
    const src = (await import("node:fs")).readFileSync(
      "client/src/pages/reports/hooks/useReportsExports.ts",
      "utf8"
    );
    expect(src).not.toContain('"MMM dd, yyyy"');
    expect(src).toContain("formatDateRange(dateRange.from, dateRange.to");
  });
});
