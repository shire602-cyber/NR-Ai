// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import Payroll from "../../client/src/pages/Payroll";
import { VatPeriodsPanel } from "../../client/src/pages/VATAutopilot";
import { loadLocale } from "../../client/src/lib/i18n";
import { TrialReadOnlyContext } from "../../client/src/lib/trial-access";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company", isLoading: false }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ data: { id: "owner" } }) }));

beforeAll(() => loadLocale("en"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function withWorkspace(
  Page: ComponentType,
  check: (container: HTMLDivElement) => Promise<void>
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => [] } },
  });
  client.setQueryData(["/api/companies", "company", "team", "me"], {
    role: "owner",
    permissions: ["payroll.manage", "payroll.approve", "reports.read"],
  });
  client.setQueryData(["/api/companies", "company", "billing", "subscription"], {
    enforcement: true,
    trialLocked: true,
    entitlement: { state: "expired", features: { payroll: false } },
  });
  client.setQueryData(
    ["/api/companies/company/payroll-runs"],
    [
      {
        id: "run",
        period_month: 4,
        period_year: 2026,
        status: "approved",
        employee_count: 0,
        total_net: "0",
      },
    ]
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(TrialReadOnlyContext.Provider, { value: true }, createElement(Page))
        )
      );
    });
    await check(container);
  } finally {
    act(() => root.unmount());
    container.remove();
    client.clear();
  }
}

async function waitFor(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
    check();
  });
}

function button(container: HTMLElement, label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label
  );
  expect(match).toBeDefined();
  return match!;
}

it("opens a saved payroll run and downloads its SIF as an expired owner", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (!input.endsWith("/generate-sif")) return Response.json([]);
      requests.push(init?.method ?? "GET");
      return new Response("saved SIF", {
        headers: { "Content-Disposition": 'attachment; filename="saved.SIF"' },
      });
    })
  );
  const downloaded: string[] = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:payroll";
      static revokeObjectURL = () => {};
    }
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloaded.push(this.download);
  });

  await withWorkspace(Payroll, async (container) => {
    expect(button(container, "New payroll run").disabled).toBe(true);
    expect(button(container, "Record payment").disabled).toBe(true);
    act(() => button(container, "View").click());
    expect(container.textContent).toContain("April 2026");
    await act(async () => button(container, "Download SIF").click());
    await waitFor(() => expect(downloaded).toEqual(["saved.SIF"]));
    expect(requests).toEqual(["GET"]);
  });
});

it("shows VAT boxes in preview mode with no adjustment or status actions", async () => {
  const period = {
    start: "2026-07-01",
    end: "2026-09-30",
    dueDate: "2026-10-28",
    frequency: "quarterly",
  };
  const calculations: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname.includes("/periods/")) {
        return Response.json([
          {
            ...period,
            id: "snapshot",
            companyId: "company",
            periodStart: period.start,
            periodEnd: period.end,
            status: "draft",
            outputVat: 50,
            inputVat: 0,
            netVatPayable: 50,
            deadline: { daysUntilDue: 1, level: "warning" },
            calculatedAt: period.end,
          },
        ]);
      }
      if (url.pathname.includes("/calculate/")) {
        calculations.push(url);
        return Response.json({
          period,
          periodId: null,
          reconciliation: { hasDiscrepancy: false },
          invoicesProcessed: 1,
          receiptsProcessed: 0,
          boxes: {
            standardRatedSales: 1000,
            standardRatedVat: 50,
            zeroRatedSales: 0,
            exemptSales: 0,
            reverseChargeAmount: 0,
            reverseChargeVat: 0,
            totalOutputVat: 50,
            totalExpenses: 0,
            inputVatRecoverable: 0,
            reverseChargeVatRecoverable: 0,
            inputVatIrrecoverable: 0,
            totalInputVat: 0,
            netVatPayable: 50,
          },
        });
      }
      return Response.json([]);
    })
  );

  await withWorkspace(VatPeriodsPanel, async (container) => {
    const select = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-testid="button-select-vat-period-2026-07-01"]'
      );
    await waitFor(() => expect(select()).not.toBeNull());
    await act(async () => select()!.click());
    await waitFor(() => expect(container.textContent).toContain("Box 14"));
    expect(calculations.map((url) => url.searchParams.get("persist"))).toEqual(["false"]);
    expect(button(container, "Add manual adjustment").disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="button-mark-ready"]')?.disabled
    ).toBe(true);
  });
});
