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
// Static so that loading the page's module graph does not count against a test's timeout.
import { ActiveCompanyProvider } from "../../client/src/components/ActiveCompanyProvider";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import ImportWizard from "../../client/src/pages/ImportWizard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let history: () => Response;
let previewJob: Record<string, unknown> | null = null;
let previewReply: () => Response | Promise<Response>;
let previewCalls = 0;
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("../../client/src/hooks/use-toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/hooks/use-toast")>();
  return { ...actual, useToast: () => ({ ...actual.useToast(), toast: toastSpy }) };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  setAuthHint();
  window.history.pushState({}, "", "/import");
  history = () => json([]);
  previewJob = null;
  previewReply = () => json(previewJob, 201);
  previewCalls = 0;
  toastSpy.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "Oasis" }]);
      if (url.endsWith("/imports/preview")) {
        previewCalls += 1;
        return previewReply();
      }
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
  useI18n.getState().setLocale("en");
});

async function mount(locale: "en" | "ar") {
  await act(async () => useI18n.getState().setLocale(locale));
  queryClient.clear();
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
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(q("button-import-validate")).not.toBeNull();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Selects a file whose text() stays pending until the test settles it. */
async function choosePending(name: string) {
  const read = deferred<string>();
  const input = q("input-import-file") as HTMLInputElement;
  const file = new File(["a,b\n"], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: () => read.promise });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  return read;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

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
    await vi.waitFor(() => {
      const alert = q("text-import-history-error");
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(alert?.textContent).toContain("Could not load the import history.");
    });
    expect(q("text-import-history-empty")).toBeNull();
  });

  it("zero-row preview shows a no-rows message, not 'No issues found'", async () => {
    await mount("en");
    // The server always explains zero rows with an issue (NO_ROWS or COLUMN_MISSING).
    await chooseAndPreview({
      ...baseJob,
      rowCount: 0,
      issues: [
        { row: null, level: "error", code: "NO_ROWS", message: "The file has no data rows" },
      ],
    });
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

  it("a pending replacement read drops the old review and blocks Preview", async () => {
    await mount("en");
    const jobA = { ...baseJob, rowCount: 1, rows: [{ code: "1000" }] };
    await chooseAndPreview(jobA);
    const previewButton = () => q("button-import-preview") as HTMLButtonElement;
    const drop = () => q("file-drop")!;

    // A second preview of A is still in flight when B is chosen.
    const staleReply = deferred<Response>();
    previewReply = () => staleReply.promise;
    await act(async () => previewButton().click());
    await vi.waitFor(() => expect(previewCalls).toBe(2));

    const readB = await choosePending("b.csv");
    expect(q("button-import-validate")).toBeNull();
    expect(drop().textContent).toContain("b.csv");
    expect(previewButton().disabled).toBe(true);

    staleReply.resolve(json(jobA, 201));
    await flush();
    await act(async () => previewButton().click());
    expect(q("button-import-validate")).toBeNull();
    expect(previewCalls).toBe(2);

    // Another replacement during the read; B's late failure is ignored.
    const readC = await choosePending("c.csv");
    readB.reject(new Error("stale"));
    await flush();
    expect(drop().textContent).toContain("c.csv");
    expect(toastSpy).not.toHaveBeenCalled();

    // Clear during the read; C's late success is ignored.
    await act(async () => drop().querySelector<HTMLButtonElement>("button[aria-label]")!.click());
    readC.resolve("a,b\n");
    await flush();
    expect(drop().textContent).not.toContain("c.csv");
    expect(previewButton().disabled).toBe(true);
    expect(q("text-import-choose-file")).not.toBeNull();

    // A current read failure clears the file and raises the existing toast.
    const readD = await choosePending("d.csv");
    readD.reject(new Error("unreadable"));
    await flush();
    expect(drop().textContent).not.toContain("d.csv");
    expect(previewButton().disabled).toBe(true);
    expect(toastSpy).toHaveBeenCalledWith({
      title: "Could not read the file",
      variant: "destructive",
    });
  });

  it("clean preview points to validate", async () => {
    await mount("en");
    await chooseAndPreview({ ...baseJob, rowCount: 1, rows: [{ code: "1000" }] });
    expect(q("text-import-next-validate")).not.toBeNull();
    expect(q("text-import-next-fix")).toBeNull();
  });
});
