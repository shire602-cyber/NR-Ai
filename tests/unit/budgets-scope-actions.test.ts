// @vitest-environment jsdom
/**
 * The Budgets screen's own copy / new-version callbacks: when the response says a cost centre was
 * cleared, no success toast may appear until the user acknowledges the widened scope.
 */
import { createElement, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Budgets from "../../client/src/pages/Budgets";
import { queryClient } from "../../client/src/lib/queryClient";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), apiRequest: vi.fn() }));

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

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: mocks.apiRequest,
    queryClient: new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          queryFn: async ({ queryKey }) =>
            String(queryKey[0]).endsWith("/budget-plans") ? [demoPlan] : [],
        },
      },
    }),
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

beforeEach(() => {
  mocks.toast.mockClear();
  mocks.apiRequest.mockReset();
  queryClient.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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
