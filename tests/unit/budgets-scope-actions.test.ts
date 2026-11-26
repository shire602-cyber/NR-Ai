// @vitest-environment jsdom
/**
 * The Budgets screen's own copy / new-version callbacks: when the response says a cost centre was
 * cleared, no success toast may appear until the user acknowledges the widened scope.
 */
import { createElement, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Budgets from "../../client/src/pages/Budgets";
import { queryClient } from "../../client/src/lib/queryClient";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

// Demo data only. Hoisted so the queryClient mock factory and the tests share it.
const demoPlan = vi.hoisted(() => ({
  id: "demo-plan",
  company_id: "demo-company",
  name: "Demo Budget",
  fiscal_year: 2026,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  status: "approved",
  notes: null,
  created_at: "2026-01-01",
}));

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  apiRequest: vi.fn(),
  // Every read goes through this; a test replaces it to pause, fail or answer differently.
  queryFn: vi.fn(),
}));

const defaultRead = async ({ queryKey }: { queryKey: readonly unknown[] }) =>
  String(queryKey[0]).endsWith("/budget-plans") ? [demoPlan] : [];

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: (ctx) => mocks.queryFn(ctx),
      },
    },
  });
  return {
    apiRequest: mocks.apiRequest,
    queryClient: client,
    // Same behaviour as the real one: cancel in-flight reads, then invalidate (not awaited).
    refreshAfterWrite: (queryKey: readonly unknown[]) => {
      void client.cancelQueries({ queryKey }).then(() => client.invalidateQueries({ queryKey }));
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({
  toast: mocks.toast,
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    company: { id: "demo-company" },
    companyId: "demo-company",
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ gate: () => ({}) }),
}));
// Radix menus need pointer events jsdom lacks: render every item as a plain button.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: () => null,
    DropdownMenuContent: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) =>
      createElement("button", { type: "button", onClick: onSelect }, children),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  expect(done()).toBe(true);
}

const button = (text: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === text);
const dialog = () => document.body.querySelector('[data-testid="budget-scope-dialog"]');

const byTestId = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);

async function renderBudgets() {
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Budgets))
    );
  });
}

beforeEach(async () => {
  // The page and the acknowledgment dialog read the real English catalogs (same app-wide load
  // main.tsx awaits); without it they render raw keys and the acknowledge button is not found.
  await loadLocale("en");
  await act(async () => {
    useI18n.setState({ locale: "en" });
  });
  mocks.toast.mockClear();
  mocks.apiRequest.mockReset();
  mocks.queryFn.mockReset().mockImplementation(defaultRead);
  queryClient.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onlineManager.setOnline(true);
});

describe("Budgets copy / new version with a changed scope", () => {
  it.each([
    ["Copy to next year", "copy", { fiscalYear: 2027 }, "Budget copied"],
    ["New version", "new-version", {}, "New draft version created"],
  ] as const)(
    "%s holds success until the change is acknowledged",
    async (label, route, body, successTitle) => {
      mocks.apiRequest.mockResolvedValue({
        id: "demo-draft",
        name: "Demo Draft",
        clearedPlanCostCenterIds: ["demo-cost-centre"],
        clearedLineCostCenterIds: [],
        clearedLines: [],
      });
      // Start from a loaded page: the test is about the actions, not the initial fetch.
      queryClient.setQueryData(["/api/companies/demo-company/budget-plans"], [demoPlan]);
      await act(async () => {
        root.render(
          createElement(QueryClientProvider, { client: queryClient }, createElement(Budgets))
        );
      });
      await until(() => !!button(label));

      await act(async () => {
        button(label)!.click();
      });
      await until(() => !!dialog());
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        "POST",
        `/api/budget-plans/demo-plan/${route}`,
        body
      );
      expect(mocks.toast).not.toHaveBeenCalled();

      await act(async () => {
        button("I understand, continue")!.click();
      });
      await until(() => !dialog());
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: successTitle }));
    },
    // A cold jsdom mount can exceed the 5s default on a slow Windows machine.
    15_000
  );
});

describe("Budgets list read states", () => {
  const plansKey = ["/api/companies/demo-company/budget-plans"];
  const failPlans = () =>
    mocks.queryFn.mockImplementation(async (ctx: { queryKey: readonly unknown[] }) => {
      if (String(ctx.queryKey[0]).endsWith("/budget-plans")) throw new Error("demo read failure");
      return defaultRead(ctx);
    });
  // Neither a count nor the empty state may appear while the rows are not known.
  const noRowsClaimed = () => {
    expect(byTestId("budgets-count")).toBeNull();
    expect(byTestId("budgets-empty")).toBeNull();
  };

  it("a paused first read is neither empty nor counted", async () => {
    onlineManager.setOnline(false);
    await renderBudgets();
    await until(() => !!byTestId("budgets-load-error-paused"));
    noRowsClaimed();
    expect(mocks.queryFn).not.toHaveBeenCalled();
  });

  it("a failed first read shows an error with a retry that loads the rows", async () => {
    failPlans();
    await renderBudgets();
    await until(() => !!byTestId("budgets-load-error"));
    noRowsClaimed();

    mocks.queryFn.mockImplementation(defaultRead);
    await act(async () => {
      byTestId("budgets-load-error")!.querySelector("button")!.click();
    });
    await until(() => !!byTestId("budgets-count"));
    expect(byTestId("budgets-load-error")).toBeNull();
    expect(document.body.textContent).toContain(demoPlan.name);
  });

  it("keeps cached rows, with a retry notice, when a refresh fails", async () => {
    queryClient.setQueryData(plansKey, [demoPlan]);
    await renderBudgets();
    await until(() => !!byTestId("budgets-count"));

    failPlans();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: plansKey });
    });
    await until(() => !!byTestId("budgets-refresh-failed"));
    expect(byTestId("budgets-count")).not.toBeNull();
    expect(byTestId("budgets-load-error")).toBeNull();
    expect(document.body.textContent).toContain(demoPlan.name);

    mocks.queryFn.mockImplementation(defaultRead);
    await act(async () => {
      byTestId("budgets-refresh-failed")!.querySelector("button")!.click();
    });
    await until(() => !byTestId("budgets-refresh-failed"));
    expect(document.body.textContent).toContain(demoPlan.name);
  });
});
