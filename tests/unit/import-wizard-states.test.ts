// @vitest-environment jsdom
/**
 * Import wizard states: history loading/empty/error, zero-row preview, error next step, and the
 * Arabic catalog. Behaviour test: renders the real page with a stubbed fetch.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthHint, setAuthHint } from "../../client/src/lib/authHint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let history: () => Response;
let previewJob: Record<string, unknown> | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  setAuthHint();
  window.history.pushState({}, "", "/import");
  history = () => json([]);
  previewJob = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "Oasis" }]);
      if (url.endsWith("/imports/preview")) return json(previewJob, 201);
      if (url.endsWith("/imports")) return history();
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  clearAuthHint();
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function mount(locale: "en" | "ar") {
  const i18n = await import("../../client/src/lib/i18n");
  await act(async () => i18n.useI18n.getState().setLocale(locale));
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  const { ActiveCompanyProvider } =
    await import("../../client/src/components/ActiveCompanyProvider");
  const { default: ImportWizard } = await import("../../client/src/pages/ImportWizard");
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ActiveCompanyProvider, null, createElement(ImportWizard))
      )
    );
  });
  for (let i = 0; i < 12; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);

async function chooseAndPreview(job: Record<string, unknown>) {
  previewJob = job;
  const input = q("input-import-file") as HTMLInputElement;
  const file = new File(["a,b\n"], "x.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => "a,b\n" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => (q("button-import-preview") as HTMLButtonElement).click());
  for (let i = 0; i < 8; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const baseJob = {
  id: "j1",
  kind: "chart_of_accounts",
  sourceSystem: "xero",
  status: "previewed",
  fileName: "x.csv",
  cutOverDate: null,
  rows: [],
  issues: [],
  summary: {},
  result: null,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("import wizard states", () => {
  it("shows empty history and a choose-file hint (en)", async () => {
    await mount("en");
    expect(q("text-import-history-empty")).not.toBeNull();
    expect(q("text-import-choose-file")).not.toBeNull();
  });

  it("shows empty history in Arabic with no English copy", async () => {
    await mount("ar");
    expect(q("text-import-history-empty")!.textContent).toContain("لا توجد عمليات استيراد");
    expect(q("text-import-choose-file")!.textContent).toContain("اختر ملف CSV");
  });

  it("shows a history error instead of an empty list", async () => {
    history = () => json({ message: "boom" }, 500);
    await mount("en");
    expect(q("text-import-history-error")).not.toBeNull();
    expect(q("text-import-history-empty")).toBeNull();
  });

  it("zero-row preview shows a no-rows message, not 'No issues found'", async () => {
    await mount("en");
    await chooseAndPreview({ ...baseJob, rowCount: 0 });
    expect(q("text-import-no-rows")).not.toBeNull();
    expect(document.body.textContent).not.toContain("No issues found.");
    expect(q("text-import-next-fix")).not.toBeNull();
  });

  it("errors give a fix-and-retry next step; clean preview points to validate", async () => {
    await mount("ar");
    await chooseAndPreview({
      ...baseJob,
      rowCount: 1,
      rows: [{ code: "1000" }],
      issues: [{ row: 1, level: "error", code: "x", message: "bad" }],
    });
    expect(q("text-import-next-fix")!.textContent).toContain("صحّح الأخطاء");
    expect(q("text-import-next-validate")).toBeNull();
  });

  it("clean preview points to validate", async () => {
    await mount("en");
    await chooseAndPreview({ ...baseJob, rowCount: 1, rows: [{ code: "1000" }] });
    expect(q("text-import-next-validate")).not.toBeNull();
    expect(q("text-import-next-fix")).toBeNull();
  });
});
