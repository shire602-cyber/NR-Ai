// @vitest-environment jsdom
/** Compliance calendar: error, empty and Arabic states (behaviour: renders the real page). */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCopy from "../../client/src/locales/en/documentsEvidence.json";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", isLoading: false }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; some List view controls may measure themselves.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
/** Per source: data, an Error to throw, or a function returning a promise. */
const responses: Record<string, unknown> = {};

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  window.history.replaceState(null, "", "/compliance-calendar");
  responses["compliance-tasks"] = [];
  responses["compliance-calendar"] = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  onlineManager.setOnline(true);
  container.remove();
});

/** Polls (inside act) until the assertions pass. */
async function until(check: () => void) {
  for (let i = 0; ; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    try {
      check();
      return;
    } catch (error) {
      if (i >= 250) throw error;
    }
  }
}

async function mount(locale: "en" | "ar", networkMode: "always" | "online" = "always") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
  const { default: ComplianceCalendar } = await import("../../client/src/pages/ComplianceCalendar");
  client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode,
        queryFn: async ({ queryKey }) => {
          const r = responses[String(queryKey[queryKey.length - 1])];
          if (r instanceof Error) throw r;
          if (typeof r === "function") return r();
          return r;
        },
      },
    },
  });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(ComplianceCalendar)));
  });
  await until(() => expect(container.textContent).toBeTruthy());
}

const serverError = () => Object.assign(new Error("500: boom"), { status: 500 });
const q = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const text = (testId: string) => q(testId)?.textContent ?? "";

function dayInMonth(day: number) {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const task = (id: string, title: string, status: string | null = "pending") => ({
  id,
  title,
  titleAr: null,
  description: null,
  category: "vat_filing",
  priority: "high",
  status,
  dueDate: dayInMonth(15),
});

const obligation = (id: string, title: string) => ({
  id,
  source: "generated",
  obligationType: "vat_return",
  eventType: "vat_filing",
  title,
  titleAr: null,
  dueDate: dayInMonth(15),
  status: "upcoming",
  statusDerived: false,
  legalSource: null,
  description: "",
  completedAt: null,
  daysUntilDue: 0,
});

async function selectDay(day: number) {
  const button = container.querySelectorAll("button[aria-pressed]")[day - 1] as HTMLButtonElement;
  await act(async () => button.click());
}

async function clickRetry(testId: string) {
  const button = q(testId)?.querySelector("button");
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

async function refetchAll() {
  await act(async () => {
    await client.refetchQueries();
  });
}

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe("compliance calendar states", () => {
  it("shows a translated retryable error when deadlines fail to load, and recovers on Retry", async () => {
    responses["compliance-tasks"] = serverError();
    await mount("ar");
    await until(() => expect(q("compliance-calendar-error")).not.toBeNull());
    expect(container.textContent).toContain("تعذّر تحميل مهام الامتثال");
    expect(container.textContent).not.toContain("boom");
    expect(container.textContent).not.toContain("لا توجد مواعيد بعد");

    responses["compliance-tasks"] = [task("t1", "Manual filing task")];
    await clickRetry("compliance-calendar-error");
    await until(() => {
      expect(q("compliance-calendar-error")).toBeNull();
      expect(container.textContent).toContain("Manual filing task");
    });
  });

  it("shows an empty-state explanation and no leftover English in Arabic", async () => {
    await mount("ar");
    await until(() => expect(container.textContent).toContain("لا توجد مواعيد بعد"));
    const lines: string[] = [];
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (v && n.parentElement?.tagName !== "STYLE") lines.push(v);
    }
    expect(lines.filter((l) => isEnglishLine(l))).toEqual([]);
  });

  it("makes no empty claim while obligations are pending, and updates one live region", async () => {
    let resolve: (value: unknown[]) => void = () => {};
    const pending = new Promise<unknown[]>((r) => {
      resolve = r;
    });
    responses["compliance-calendar"] = () => pending;
    await mount("en");
    const loading = enCopy["complianceCalendar.stillLoading"];
    const noEvents = enCopy["complianceCalendar.noEventsOnDay"];
    const noDeadlines = enCopy["complianceCalendar.noDeadlinesYet"];
    await until(() => expect(text("compliance-upcoming-empty")).toContain(loading));
    expect(text("compliance-sources-status")).toContain(loading);
    expect(container.textContent).not.toContain(noDeadlines);

    const region = q("compliance-day-status");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.textContent).toBe("");
    await selectDay(10);
    expect(q("compliance-day-status")).toBe(region);
    expect(region?.textContent).toContain(loading);
    expect(region?.textContent).not.toContain(noEvents);

    await act(async () => resolve([]));
    await until(() => expect(region?.textContent).toContain(noEvents));
    expect(container.textContent).toContain(noDeadlines);
    const first = region?.textContent;
    await selectDay(11);
    expect(q("compliance-day-status")).toBe(region);
    expect(region?.textContent).toContain(noEvents);
    expect(region?.textContent).not.toBe(first);
  });

  it("says it is waiting for a connection while queries are paused", async () => {
    onlineManager.setOnline(false);
    await mount("en", "online");
    const waiting = enCopy["complianceCalendar.waitingForConnection"];
    await until(() => expect(text("compliance-sources-status")).toContain(waiting));
    await selectDay(10);
    expect(text("compliance-day-status")).toContain(waiting);
    expect(container.textContent).not.toContain(enCopy["complianceCalendar.noDeadlinesYet"]);
  });

  it("keeps the available rows when one source fails", async () => {
    responses["compliance-tasks"] = serverError();
    responses["compliance-calendar"] = [obligation("o1", "Generated filing")];
    await mount("en");
    await until(() => expect(q("compliance-calendar-error")).not.toBeNull());
    expect(container.textContent).toContain("Generated filing");
    expect(q("compliance-calendar-obligations-error")).toBeNull();
    await selectDay(10);
    expect(text("compliance-day-status")).toContain(
      enCopy["complianceCalendar.deadlinesIncomplete"]
    );
    expect(text("compliance-day-status")).not.toContain(enCopy["complianceCalendar.noEventsOnDay"]);
  });

  it("keeps cached rows and says so when a refresh fails", async () => {
    responses["compliance-tasks"] = [task("t1", "Manual filing task")];
    responses["compliance-calendar"] = [obligation("o1", "Generated filing")];
    await mount("en");
    await until(() => expect(container.textContent).toContain("Generated filing"));

    responses["compliance-tasks"] = serverError();
    responses["compliance-calendar"] = serverError();
    await refetchAll();
    await until(() => {
      expect(text("compliance-calendar-error")).toContain(
        enCopy["complianceCalendar.tasksRefreshErrorTitle"]
      );
      expect(text("compliance-calendar-obligations-error")).toContain(
        enCopy["complianceCalendar.obligationsRefreshErrorTitle"]
      );
    });
    expect(container.textContent).toContain("Manual filing task");
    expect(container.textContent).toContain("Generated filing");
    await selectDay(10);
    expect(text("compliance-day-status")).not.toContain(enCopy["complianceCalendar.noEventsOnDay"]);
  });

  it("shows errors above the real List view, keeps rows and hides totals until Retry works", async () => {
    window.history.replaceState(null, "", "/compliance-calendar?view=list");
    responses["compliance-tasks"] = serverError();
    responses["compliance-calendar"] = [obligation("o1", "Generated filing")];
    await mount("en");
    await until(() => {
      expect(q("task-o1")).not.toBeNull();
      expect(q("compliance-calendar-error")).not.toBeNull();
    });
    const banner = q("compliance-calendar-error")!;
    expect(
      banner.compareDocumentPosition(q("task-o1")!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    for (const id of ["stat-tasks-open", "stat-tasks-due-week", "stat-tasks-overdue"]) {
      expect(text(id)).toContain("—");
    }

    responses["compliance-tasks"] = [task("t1", "Manual filing task")];
    await clickRetry("compliance-calendar-error");
    await until(() => {
      expect(q("compliance-calendar-error")).toBeNull();
      expect(q("task-t1")).not.toBeNull();
    });
    expect(q("task-o1")).not.toBeNull();
    expect(text("stat-tasks-open")).toContain("2");
    expect(text("stat-tasks-open")).not.toContain("—");
  });

  it("gives no List empty feedback until both sources succeed", async () => {
    window.history.replaceState(null, "", "/compliance-calendar?view=list");
    responses["compliance-tasks"] = serverError();
    responses["compliance-calendar"] = serverError();
    await mount("en");
    await until(() => {
      expect(q("compliance-calendar-error")).not.toBeNull();
      expect(q("compliance-calendar-obligations-error")).not.toBeNull();
      expect(q("task-list-incomplete")).not.toBeNull();
    });
    expect(q("task-list-empty")).toBeNull();

    // Only one source recovers: its banner clears, the other stays, still no empty claim.
    responses["compliance-calendar"] = [];
    await clickRetry("compliance-calendar-obligations-error");
    await until(() => expect(q("compliance-calendar-obligations-error")).toBeNull());
    expect(q("compliance-calendar-error")).not.toBeNull();
    expect(q("task-list-empty")).toBeNull();

    responses["compliance-tasks"] = [];
    await clickRetry("compliance-calendar-error");
    await until(() => expect(q("task-list-empty")).not.toBeNull());
    expect(q("compliance-calendar-error")).toBeNull();
    expect(q("compliance-calendar-obligations-error")).toBeNull();
  });

  it("translates the status badge for a selected day", async () => {
    responses["compliance-tasks"] = [task("t1", "VAT return")];
    await mount("ar");
    await until(() => expect(container.textContent).toContain("VAT return"));
    await selectDay(15);
    expect(text("compliance-event-status")).toBe("قيد الانتظار");
    expect(container.textContent).not.toContain("pending");
  });

  it("translates cancelled and omits the badge for a null status", async () => {
    responses["compliance-tasks"] = [
      task("t1", "Cancelled task", "cancelled"),
      task("t2", "Statusless task", null),
    ];
    await mount("ar");
    await until(() => expect(container.textContent).toContain("Statusless task"));
    await selectDay(15);
    const badges = container.querySelectorAll('[data-testid="compliance-event-status"]');
    expect(Array.from(badges, (b) => b.textContent)).toEqual(["ملغى"]);
  });
});
