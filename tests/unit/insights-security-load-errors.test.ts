// @vitest-environment jsdom
/**
 * Launch gap: a failed load must not read as "no data". The four Insights views and the
 * Security settings cards show the shared load-error state (with retry) when their queries fail,
 * and still show their real empty state when the query succeeds with nothing.
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

const sec = vi.hoisted(() => ({
  responses: {} as Record<string, unknown>,
}));
vi.mock("../../client/src/lib/securityApi", async (orig) => ({
  ...(await orig<typeof import("../../client/src/lib/securityApi")>()),
  securityFetch: async (_m: string, url: string) => {
    const r = sec.responses[url];
    if (r === "fail") throw new Error("boom");
    return r;
  },
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: null, company: null, isLoading: false }),
}));
vi.mock("../../client/src/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));
vi.mock("../../client/src/pages/security/ChangePasswordCard", () => ({
  ChangePasswordCard: () => null,
}));
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
  responder: (key: string) => unknown
) {
  useI18n.setState({ locale });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const r = responder(String(queryKey[0]));
          if (r === "fail") throw new ApiError(500, "Server exploded", {});
          return (r as { ok: unknown }).ok;
        },
      },
    },
  });
  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
  const { hook } = memoryLocation({ path: "/reports" });
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

const insights: Array<{
  name: string;
  load: () => Promise<{ default: ComponentType<{ companyId: string }> }>;
  empty: string;
  emptyData: (key: string) => unknown;
}> = [
  {
    name: "ageing",
    load: () => import("../../client/src/pages/reports/insights/AgeingView"),
    empty: "insights-ageing-empty",
    emptyData: () =>
      ok({
        asOf: "2026-01-01",
        rows: [],
        documents: [],
        totals: { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 },
      }),
  },
  {
    name: "cash flow",
    load: () => import("../../client/src/pages/reports/insights/CashFlowView"),
    empty: "insights-cash-empty",
    emptyData: (key) =>
      key.includes("/cash-flow/month")
        ? ok([])
        : ok({
            openingCash: 0,
            closingCash: 0,
            netCashChange: 0,
            operating: { total: 0 },
            investing: { total: 0 },
            financing: { total: 0 },
          }),
  },
  {
    name: "budget",
    load: () => import("../../client/src/pages/reports/insights/BudgetView"),
    empty: "insights-budget-empty",
    emptyData: () => ok([]),
  },
  {
    name: "comparison",
    load: () => import("../../client/src/pages/reports/insights/ComparisonView"),
    empty: "insights-comparison-empty",
    emptyData: () =>
      ok({
        current: { from: "2026-01-01", to: "2026-03-31" },
        previous: { from: "2025-10-01", to: "2025-12-31" },
        metrics: [],
      }),
  },
];

describe.each(["en", "ar"] as const)("Insights load errors (%s)", (locale) => {
  it.each(insights)(
    "$name: failed load shows the error with retry, not the empty state",
    async (v) => {
      const View = (await v.load()).default;
      await mount(View as never, { companyId: "co-1" }, locale, () => "fail");
      expect(tid("insights-load-error")).not.toBeNull();
      expect(tid(v.empty)).toBeNull();
      expect(node!.textContent).not.toContain("Server exploded");
      expect(retryButton()).toBeDefined();
    }
  );

  it.each(insights)("$name: successful empty load still shows the empty state", async (v) => {
    const View = (await v.load()).default;
    await mount(View as never, { companyId: "co-1" }, locale, v.emptyData);
    expect(tid(v.empty)).not.toBeNull();
    expect(tid("insights-load-error")).toBeNull();
  });
});

describe("Insights retry", () => {
  it("retry refetches the failed ageing queries and recovers", async () => {
    const View = (await insights[0].load()).default;
    let failing = true;
    await mount(View as never, { companyId: "co-1" }, "en", (key) =>
      failing ? "fail" : insights[0].emptyData(key)
    );
    expect(tid("insights-load-error")).not.toBeNull();
    failing = false;
    await act(async () => retryButton()!.click());
    await settle(10);
    expect(tid("insights-load-error")).toBeNull();
    expect(tid("insights-ageing-empty")).not.toBeNull();
  });
});

describe.each(["en", "ar"] as const)("SecuritySettings load errors (%s)", (locale) => {
  const healthy = {
    "/api/auth/security/overview": {
      mfa: {
        enabled: false,
        enrolledAt: null,
        pendingEnrollment: false,
        recoveryCodesRemaining: 0,
      },
      mfaRequiredByCompanies: [],
      emailVerification: { verified: true, enforced: false, graceEndsAt: null, restricted: false },
    },
    "/api/auth/sessions": { sessions: [] },
    "/api/auth/login-history": { events: [] },
  };

  it("failed overview, sessions and history each show the error with retry", async () => {
    sec.responses = {
      "/api/auth/security/overview": "fail",
      "/api/auth/sessions": "fail",
      "/api/auth/login-history": "fail",
    };
    const Page = (await import("../../client/src/pages/SecuritySettings")).default;
    await mount(Page as never, {}, locale, () => ok(null));
    for (const id of [
      "security-overview-error",
      "security-email-error",
      "security-sessions-error",
      "security-history-error",
    ]) {
      expect(tid(id), id).not.toBeNull();
    }
    expect(tid("button-mfa-start")).toBeNull();
    expect(node!.textContent).not.toContain("boom");
    expect(retryButton()).toBeDefined();
  });

  it("healthy responses show no error and the enable button", async () => {
    sec.responses = healthy;
    const Page = (await import("../../client/src/pages/SecuritySettings")).default;
    await mount(Page as never, {}, locale, () => ok(null));
    expect(node!.querySelector('[data-testid^="security-"][data-testid$="-error"]')).toBeNull();
    expect(tid("button-mfa-start")).not.toBeNull();
  });
});
