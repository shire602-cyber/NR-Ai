// @vitest-environment jsdom
/** Compliance calendar: error, empty and Arabic states (behaviour: renders the real page). */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", isLoading: false }),
}));
vi.mock("@/pages/TaskCenter", () => ({ TaskListPanel: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const responses: Record<string, unknown> = {};

beforeAll(async () => {
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

async function mount(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
  const { default: ComplianceCalendar } = await import("../../client/src/pages/ComplianceCalendar");
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode: "always",
        queryFn: async ({ queryKey }) => {
          const r = responses[String(queryKey[queryKey.length - 1])];
          if (r instanceof Error) throw r;
          return r;
        },
      },
    },
  });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(ComplianceCalendar)));
  });
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    if (container.textContent && !container.querySelector(".skeleton-shimmer")) break;
  }
}

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe("compliance calendar states", () => {
  it("shows a translated retryable error when deadlines fail to load, not a blank calendar", async () => {
    responses["compliance-tasks"] = Object.assign(new Error("500: boom"), { status: 500 });
    responses["compliance-calendar"] = [];
    await mount("ar");
    expect(container.querySelector('[data-testid="compliance-calendar-error"]')).not.toBeNull();
    expect(container.textContent).toContain("تعذّر تحميل تقويم الامتثال");
    expect(container.textContent).not.toContain("boom");
  });

  it("shows an empty-state explanation and no leftover English in Arabic", async () => {
    responses["compliance-tasks"] = [];
    responses["compliance-calendar"] = [];
    await mount("ar");
    expect(container.textContent).toContain("لا توجد مواعيد بعد");
    const lines: string[] = [];
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (v && n.parentElement?.tagName !== "STYLE") lines.push(v);
    }
    expect(lines.filter((l) => isEnglishLine(l))).toEqual([]);
  });

  it("translates the status badge for a selected day", async () => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`;
    responses["compliance-tasks"] = [
      {
        id: "t1",
        title: "VAT return",
        titleAr: null,
        category: "vat_filing",
        priority: "high",
        status: "pending",
        dueDate: iso,
      },
    ];
    responses["compliance-calendar"] = [];
    await mount("ar");
    const day = container.querySelectorAll("button[aria-pressed]")[14] as HTMLButtonElement;
    await act(async () => day.click());
    expect(container.textContent).toContain("قيد الانتظار");
    expect(container.textContent).not.toContain("pending");
  });
});
