// @vitest-environment jsdom
/**
 * A failed load must not read as "no data" or "all clear": the dashboard needs-you strip, the
 * budget-vs-actual widget, the payment-reminder schedule and the company groups page show the
 * shared load-error state (with retry) when their queries fail, and their real empty state
 * when the query succeeds with nothing.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { ApiError } from "../../client/src/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const net = vi.hoisted(() => ({ respond: (_path: string): unknown => null }));
vi.mock("../../client/src/lib/queryClient", async (orig) => {
  const actual = await orig<typeof import("../../client/src/lib/queryClient")>();
  return {
    ...actual,
    apiRequest: async (_m: string, url: string) => {
      const r = net.respond(url);
      if (r === "fail") throw new actual.ApiError(500, "Server exploded", {});
      return (r as { ok: unknown }).ok;
    },
  };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", companies: [], company: null, isLoading: false }),
}));
vi.mock("../../client/src/pages/Reminders", () => ({ AutomaticEmailRules: () => null }));
vi.mock("../../client/src/components/ui/date-picker", () => ({
  DatePicker: () => createElement("input"),
}));

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

let root: Root | null = null;
let node: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  node?.remove();
  root = null;
  node = null;
  useI18n.setState({ locale: "en" });
});

const ok = (data: unknown) => ({ ok: data });
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
};

async function mount(
  Component: ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  locale: "en" | "ar",
  responder: (path: string) => unknown
) {
  useI18n.setState({ locale });
  net.respond = responder;
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const r = responder(queryKey.filter(Boolean).join("/"));
          if (r === "fail") throw new ApiError(500, "Server exploded", {});
          if (r === "hang") return new Promise(() => {});
          return (r as { ok: unknown }).ok;
        },
      },
    },
  });
  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
  const { hook } = memoryLocation({ path: "/" });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Router, { hook }, createElement(Component, props))
      )
    );
  });
  await settle();
}

const tid = (id: string) => node!.querySelector(`[data-testid="${id}"]`);
const retryButton = () =>
  [...node!.querySelectorAll("button")].find((b) =>
    /Try again|أعد المحاولة/.test(b.textContent ?? "")
  );

describe.each(["en", "ar"] as const)("App screen load errors (%s)", (locale) => {
  const strip = { companyId: "c1", invoices: [], compliance: null };
  const budget = { companyId: "c1", asOf: "2026-03-31", locale };

  it("needs-you strip: failed bank lines show an error, never the all-clear", async () => {
    const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
    await mount(NeedsYouStrip as never, strip, locale, (p) =>
      p.includes("bank-statements") ? "fail" : ok({ permissions: [] })
    );
    expect(tid("needs-you-load-error")).not.toBeNull();
    expect(tid("needs-you-clear")).toBeNull();
    expect(node!.textContent).not.toContain("Server exploded");
    expect(retryButton()).toBeDefined();
  });

  it("needs-you strip: failed access lookup shows an error, never the all-clear", async () => {
    const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
    await mount(NeedsYouStrip as never, strip, locale, (p) =>
      p.includes("bank-statements") ? ok([]) : "fail"
    );
    expect(tid("needs-you-load-error")).not.toBeNull();
    expect(tid("needs-you-clear")).toBeNull();
  });

  it("needs-you strip: failed compliance query shows an error, never the all-clear", async () => {
    const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
    const refetch = vi.fn();
    const complianceQuery = {
      isError: true,
      isFetching: false,
      error: new ApiError(500, "Server exploded", {}),
      errorUpdateCount: 1,
      refetch,
    };
    await mount(NeedsYouStrip as never, { ...strip, complianceQuery }, locale, (p) =>
      p.includes("bank-statements") ? ok([]) : ok({ permissions: [] })
    );
    expect(tid("needs-you-load-error")).not.toBeNull();
    expect(tid("needs-you-clear")).toBeNull();
    await act(async () => retryButton()!.click());
    expect(refetch).toHaveBeenCalled();
  });

  it("needs-you strip: a retry after an error does not flash the all-clear", async () => {
    const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
    let bankCalls = 0;
    await mount(NeedsYouStrip as never, strip, locale, (p) => {
      if (!p.includes("bank-statements")) return ok({ permissions: [] });
      return ++bankCalls === 1 ? "fail" : "hang";
    });
    expect(tid("needs-you-load-error")).not.toBeNull();
    await act(async () => retryButton()!.click());
    await settle(5);
    expect(bankCalls).toBe(2);
    expect(tid("needs-you-clear")).toBeNull();
    expect(tid("needs-you-load-error")).not.toBeNull();
  });

  it("needs-you strip: successful empty load still shows the all-clear", async () => {
    const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
    await mount(NeedsYouStrip as never, strip, locale, (p) =>
      p.includes("bank-statements") ? ok([]) : ok({ permissions: [] })
    );
    expect(tid("needs-you-clear")).not.toBeNull();
    expect(tid("needs-you-load-error")).toBeNull();
  });

  it("budget vs actual: failed load shows the error, not the no-budget line", async () => {
    const { BudgetVsActualWidget } =
      await import("../../client/src/pages/dashboard/PlanningWidgets");
    await mount(BudgetVsActualWidget as never, budget, locale, () => "fail");
    expect(tid("budget-load-error")).not.toBeNull();
    expect(node!.textContent).not.toContain("Server exploded");
    expect(retryButton()).toBeDefined();
  });

  it("budget vs actual: successful empty load still shows the empty line", async () => {
    const { BudgetVsActualWidget } =
      await import("../../client/src/pages/dashboard/PlanningWidgets");
    await mount(BudgetVsActualWidget as never, budget, locale, () => ok([]));
    expect(tid("budget-load-error")).toBeNull();
    expect(tid("dashboard-budget-vs-actual")).not.toBeNull();
    expect(tid("dashboard-budget-vs-actual")!.querySelector("table")).toBeNull();
  });

  it("reminder schedule: failed loads show errors, not default settings", async () => {
    const { ScheduleTab } = await import("../../client/src/pages/payment-reminders/ScheduleTab");
    await mount(ScheduleTab as never, { companyId: "c1" }, locale, () => "fail");
    expect(tid("reminders-config-load-error")).not.toBeNull();
    expect(tid("reminders-templates-load-error")).not.toBeNull();
    expect(tid("switch-auto-chase")).toBeNull();
  });

  it("reminder schedule: successful load shows the settings", async () => {
    const { ScheduleTab } = await import("../../client/src/pages/payment-reminders/ScheduleTab");
    await mount(ScheduleTab as never, { companyId: "c1" }, locale, (p) =>
      p.includes("config")
        ? ok({ autoChaseEnabled: true, chaseFrequencyDays: 7, maxLevel: 4, defaultLanguage: "en" })
        : ok([])
    );
    expect(tid("reminders-config-load-error")).toBeNull();
    expect(tid("switch-auto-chase")).not.toBeNull();
  });

  it("company groups: failed load shows the error, not a blank page", async () => {
    const mod = await import("../../client/src/pages/CompanyGroups");
    await mount(mod.default as never, {}, locale, () => "fail");
    expect(tid("company-groups-load-error")).not.toBeNull();
    expect(tid("button-empty-new-group")).toBeNull();
    expect(retryButton()).toBeDefined();
  });

  it("company groups: successful empty load shows the empty state", async () => {
    const mod = await import("../../client/src/pages/CompanyGroups");
    await mount(mod.default as never, {}, locale, () => ok([]));
    expect(tid("company-groups-load-error")).toBeNull();
    expect(tid("button-empty-new-group")).not.toBeNull();
  });
});
