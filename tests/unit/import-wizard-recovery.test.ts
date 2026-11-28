// @vitest-environment jsdom
/**
 * PR #147 review 6059457410: stale previews, history states and retry, issue-code recovery
 * guidance, Arabic issue rows, and a review that needs no secondary chunk. Renders the real page
 * with a stubbed fetch.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager, onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthHint, setAuthHint } from "../../client/src/lib/authHint";
// Static so that loading the page's module graph does not count against a test's timeout.
import { ActiveCompanyProvider } from "../../client/src/components/ActiveCompanyProvider";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import ImportWizard from "../../client/src/pages/ImportWizard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HISTORY_KEY = ["/api/companies", "c-1", "imports"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const baseJob = {
  id: "j1",
  kind: "chart_of_accounts",
  sourceSystem: "xero",
  status: "previewed",
  fileName: "x.csv",
  cutOverDate: null,
  rowCount: 1,
  rows: [{ code: "1000" }],
  issues: [] as unknown[],
  summary: {},
  result: null,
  createdAt: "2026-01-01T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;
let companies: Array<{ id: string; name: string }>;
let companiesReply: () => Response | Promise<Response>;
let history: () => Response;
let preview: () => Promise<Response>;
let validate: () => Response;
let historySignals: Array<AbortSignal | null | undefined>;
const toasts = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toasts }),
  toast: (...args: unknown[]) => toasts(...args),
}));

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
  toasts.mockClear();
  window.history.pushState({}, "", "/import");
  companies = [{ id: "c-1", name: "Oasis" }];
  companiesReply = () => json(companies);
  history = () => json([]);
  preview = async () => json(baseJob, 201);
  validate = () => json({ ...baseJob, status: "validated" });
  historySignals = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return companiesReply();
      if (url.endsWith("/imports/preview")) return preview();
      if (url.endsWith("/imports/j1/validate")) return validate();
      if (url.endsWith("/imports")) {
        historySignals.push(init?.signal);
        return history();
      }
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
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  useI18n.getState().setLocale("en");
});

const settle = async () => {
  for (let i = 0; i < 12; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

async function mount(locale: "en" | "ar" = "en") {
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
  await settle();
  return queryClient;
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);

const csv = new File(["a,b\n"], "x.csv", { type: "text/csv" });
Object.defineProperty(csv, "text", { value: async () => "a,b\n" });

async function choose(file: File = csv) {
  const input = q("input-import-file") as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
}

async function clickPreview() {
  await act(async () => (q("button-import-preview") as HTMLButtonElement).click());
  await settle();
}

/** A preview response the test releases when it chooses. */
function delayedPreview() {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((r) => (release = r));
  preview = () => pending;
  return async (response: Response) => {
    await act(async () => release(response));
    await settle();
  };
}

const clearFile = async () => {
  const remove = document.querySelector("button svg.lucide-x")!.closest("button")!;
  await act(async () => remove.click());
  await settle();
};

describe("stale preview responses", () => {
  it("shows a delayed success for the unchanged selection", async () => {
    const release = delayedPreview();
    await mount();
    await choose();
    await clickPreview();
    await release(json(baseJob, 201));
    expect(q("button-import-validate")).not.toBeNull();
  });

  it("ignores a success that arrives after clear", async () => {
    const release = delayedPreview();
    await mount();
    await choose();
    await clickPreview();
    await clearFile();
    await release(json(baseJob, 201));
    expect(q("button-import-validate")).toBeNull();
  });

  it.each([
    ["a replacement", new File(["c,d\n"], "y.csv", { type: "text/csv" })],
    ["the same file chosen again", csv],
  ])("ignores a success that arrives after %s", async (_name, next) => {
    if (next !== csv) Object.defineProperty(next, "text", { value: async () => "c,d\n" });
    const release = delayedPreview();
    await mount();
    await choose();
    await clickPreview();
    await choose(next);
    expect((q("button-import-preview") as HTMLButtonElement).disabled).toBe(false);
    await release(json(baseJob, 201));
    expect(q("button-import-validate")).toBeNull();
  });

  it("raises no toast for a failure that arrives after clear", async () => {
    const release = delayedPreview();
    await mount();
    await choose();
    await clickPreview();
    await clearFile();
    await release(json({ message: "boom" }, 500));
    expect(toasts).not.toHaveBeenCalled();
  });

  it("raises a toast for a failure of the current selection", async () => {
    preview = async () => json({ message: "boom" }, 500);
    await mount();
    await choose();
    await clickPreview();
    expect(toasts).toHaveBeenCalledTimes(1);
  });

  it("ignores a success that arrives after the company changed", async () => {
    const release = delayedPreview();
    const client = await mount();
    await choose();
    await clickPreview();
    await act(async () => {
      client.setQueryData(["/api/companies"], [{ id: "c-2", name: "Palm" }]);
    });
    await settle();
    await release(json(baseJob, 201));
    expect(q("button-import-validate")).toBeNull();
  });
});

describe("import history states", () => {
  it("passes an AbortSignal to fetch and shows empty only after a successful load", async () => {
    await mount();
    expect(historySignals[0]).toBeInstanceOf(AbortSignal);
    expect(q("text-import-history-empty")).not.toBeNull();
  });

  it("waits for an unresolved company list, then shows the active company's history", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((r) => (release = r));
    companiesReply = () => pending;
    history = () => json([{ ...baseJob, fileName: "active.csv" }]);
    await mount();
    expect(q("text-import-history-loading")).not.toBeNull();
    expect(q("text-import-history-empty")).toBeNull();
    expect(q("text-import-history-nocompany")).toBeNull();
    expect(historySignals).toHaveLength(0);

    await act(async () => release(json(companies)));
    await settle();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/companies/c-1/imports"),
      expect.anything()
    );
    expect(document.body.textContent).toContain("active.csv");
    expect(q("text-import-history-loading")).toBeNull();
    expect(q("text-import-history-empty")).toBeNull();
    expect(q("text-import-history-error")).toBeNull();
  });

  it("without a company asks for one instead of claiming there are no imports", async () => {
    companies = [];
    await mount();
    expect(q("text-import-history-nocompany")).not.toBeNull();
    expect(q("text-import-history-empty")).toBeNull();
    expect(historySignals).toHaveLength(0);
  });

  it("stays a neutral paused notice, not empty, before and after the connection returns unfocused", async () => {
    const client = await mount();
    await act(async () => {
      focusManager.setFocused(false);
      onlineManager.setOnline(false);
      void client.resetQueries({ queryKey: HISTORY_KEY });
    });
    await settle();
    const expectNeutral = () => {
      const notice = q("text-import-history-paused")!.textContent!;
      expect(notice).toContain("paused");
      expect(notice).not.toMatch(/connection|offline/i);
      expect(q("text-import-history-empty")).toBeNull();
    };
    expectNeutral();
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expectNeutral();
  });

  it("shows a neutral paused notice above cached rows while a refresh is paused", async () => {
    history = () => json([{ ...baseJob, fileName: "kept.csv" }]);
    const client = await mount();
    await act(async () => {
      onlineManager.setOnline(false);
      void client.refetchQueries({ queryKey: HISTORY_KEY });
    });
    await settle();
    expect(q("text-import-history-pausedcached")!.textContent).toContain("paused");
    expect(q("text-import-history-pausedcached")!.textContent).not.toMatch(/connection|offline/i);
    expect(q("text-import-history-paused")).toBeNull();
    expect(document.body.textContent).toContain("kept.csv");
  });

  it("a failed company lookup is an alert, not 'select a company'", async () => {
    // 403, not 5xx: the default query retries a 5xx with a delay that outlasts the test.
    companiesReply = () => json({ message: "boom" }, 403);
    await mount();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(q("text-import-history-companieserror")?.getAttribute("role")).toBe("alert");
    });
    expect(q("text-import-history-companieserror")!.textContent).toContain(
      "Could not load your companies"
    );
    expect(q("text-import-history-nocompany")).toBeNull();
    expect(q("text-import-history-loading")).toBeNull();
    expect(historySignals).toHaveLength(0);
  });

  it("retries a failed load in place and keeps the file and preview", async () => {
    history = () => json({ message: "boom" }, 500);
    await mount();
    await choose();
    await clickPreview();
    expect(q("text-import-history-error")).not.toBeNull();
    expect(q("text-import-history-empty")).toBeNull();

    history = () => json([]);
    await act(async () => (q("button-import-history-retry") as HTMLButtonElement).click());
    await settle();
    expect(q("text-import-history-error")).toBeNull();
    expect(q("text-import-history-empty")).not.toBeNull();
    expect(q("button-import-validate")).not.toBeNull();
    expect(q("text-import-choose-file")).toBeNull();
  });

  it("keeps cached rows when a background refresh fails", async () => {
    history = () => json([{ ...baseJob, fileName: "kept.csv" }]);
    const client = await mount();
    history = () => json({ message: "boom" }, 500);
    await act(async () => {
      await client.refetchQueries({ queryKey: HISTORY_KEY });
    });
    await settle();
    expect(q("text-import-history-stale")).not.toBeNull();
    expect(q("text-import-history-error")).toBeNull();
    expect(document.body.textContent).toContain("kept.csv");
  });
});

describe("recovery guidance and Arabic issues", () => {
  async function review(job: Record<string, unknown>, locale: "en" | "ar" = "en") {
    preview = async () => json({ ...baseJob, ...job }, 201);
    await mount(locale);
    await choose();
    await clickPreview();
    return q("text-import-next-fix")?.textContent ?? "";
  }
  const error = (code: string, message: string) => ({ row: null, level: "error", code, message });
  const empty = { rowCount: 0, rows: [] };
  const issueRow = () =>
    document.querySelector("li svg.text-destructive")!.closest("li")!.textContent!;

  it("NO_ROWS gives the no-data guidance", async () => {
    await review({ ...empty, issues: [error("NO_ROWS", "The file has no data rows")] });
    expect(q("text-import-no-rows")).not.toBeNull();
    // A genuinely empty file (no detected rows) keeps the server text on the issue row.
    expect(issueRow()).toContain("The file has no data rows");
  });

  it("a missing column with data present is not reported as no data", async () => {
    const next = await review({
      ...empty,
      summary: { detectedRows: 3 },
      issues: [error("COLUMN_MISSING", 'No column found for "type". Headers seen: Code, Name')],
    });
    expect(q("text-import-no-rows")).toBeNull();
    expect(next).toContain("Fix the errors in your CSV file");
  });

  it("NO_ROWS with detected data rows says none can be imported", async () => {
    const next = await review({
      ...empty,
      summary: { detectedRows: 2 },
      issues: [error("NO_ROWS", "The file has no data rows")],
    });
    expect(q("text-import-no-rows")).toBeNull();
    expect(issueRow()).toContain("No rows in the file can be imported");
    expect(issueRow()).not.toContain("The file has no data rows");
    expect(next).toContain("The file has data");
    expect(next).toContain("none of its rows can be imported");
  });

  it.each([
    ["CUT_OVER_REQUIRED", "Choose the cut-over date above"],
    ["V_CUT_OVER_IN_FUTURE", "not in the future"],
    ["V_AR_WITHOUT_DOCUMENTS", "Under Receivables and payables"],
    ["V_OPENING_ALREADY_IMPORTED", "Do not import them again"],
    ["V_UNKNOWN_ACCOUNT", "Update the chart of accounts"],
    ["V_NO_EXCHANGE_RATE", "under Exchange rates"],
    ["V_GRATUITY_WITHOUT_EMPLOYEES", "in Payroll"],
    ["V_PPE_WITHOUT_REGISTER", "fixed-asset register"],
    ["V_INVENTORY_WITHOUT_STOCK", "opening stock"],
    ["SOMETHING_NEW", "Resolve the errors listed above"],
  ])("%s points to its own action", async (code, expected) => {
    const next = await review({ issues: [error(code, "server text")] });
    expect(next).toContain(expected);
    expect(next).not.toContain("Fix the errors in your CSV file");
  });

  it("shows an Arabic issue row that keeps the details", async () => {
    await review(
      {
        ...empty,
        issues: [error("COLUMN_MISSING", 'No column found for "type". Headers seen: Code, Name')],
      },
      "ar"
    );
    const row = issueRow();
    expect(row).toContain("لم نجد عمودًا للحقل");
    expect(row).toContain("type");
    expect(row).toContain("Code, Name");
    expect(row).not.toContain("No column found");
  });

  it("falls back to an Arabic sentence naming an unknown code", async () => {
    await review({ issues: [error("SOMETHING_NEW", "server text")] }, "ar");
    const row = issueRow();
    expect(row).toContain("SOMETHING_NEW");
    expect(row).not.toContain("server text");
  });
});

describe("preview settings invalidate a held review", () => {
  const changeCutOver = async () => {
    await act(async () => (document.getElementById("cut-over") as HTMLButtonElement).click());
    // react-day-picker v8 (as in d5b-form-payloads.test.ts): day buttons are button[name=day].
    const day = [...document.querySelectorAll<HTMLButtonElement>('button[name="day"]')].find(
      (b) => b.textContent?.trim() === "15" && !b.className.includes("day_outside")
    )!;
    await act(async () => day.click());
  };
  // Radix Select from the keyboard (as tests/unit/helpers/form-harness.ts pickOption).
  const changeMode = async () => {
    const trigger = q("select-import-mode")!;
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    await settle();
    const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
      (o.textContent ?? "").includes("Carry A/R and A/P by importing open invoices")
    )!;
    await act(async () => (option as HTMLElement).click());
  };

  it.each([
    ["cut-over date", changeCutOver],
    ["A/R and A/P mode", changeMode],
  ])("a changed %s drops a validated trial balance but keeps the file", async (_name, change) => {
    window.history.pushState({}, "", "/import?kind=trial_balance&cutover=2026-01-31");
    const validated = { ...baseJob, kind: "trial_balance", status: "validated" };
    preview = async () => json({ ...validated, status: "previewed" }, 201);
    validate = () => json(validated);
    await mount();
    await choose();
    await clickPreview();
    expect((q("button-import-commit") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (q("button-import-validate") as HTMLButtonElement).click());
    await settle();
    expect((q("button-import-commit") as HTMLButtonElement).disabled).toBe(false);

    await change();
    await settle();

    expect(q("button-import-validate")).toBeNull();
    expect(q("button-import-commit")).toBeNull();
    expect(q("file-drop")!.textContent).toContain("x.csv");
    expect((q("button-import-preview") as HTMLButtonElement).disabled).toBe(false);

    preview = async () => json({ ...validated, status: "previewed" }, 201);
    await clickPreview();
    expect(q("text-import-next-validate")).not.toBeNull();
    expect((q("button-import-commit") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("review chunk", () => {
  // Source inspection: vitest cannot fail a built chunk, and a dynamic import resolves here, so
  // only the import form shows that the review ships with the wizard route.
  it("is imported statically with the wizard", () => {
    const source = readFileSync(resolve("client/src/pages/ImportWizard.tsx"), "utf8");
    expect(source).toMatch(/^import ImportReview from "\.\/import-wizard\/ImportReview";$/m);
    expect(source).not.toMatch(/\blazy\(|import\(/);
  });
});
