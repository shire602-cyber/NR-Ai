// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    companyId: "c1",
    company: { id: "c1" },
    companies: [],
    isLoading: false,
  }),
}));
import { loadNamespaces, useI18n } from "../../client/src/lib/i18n";
import { EmployeesTab } from "../../client/src/pages/payroll/EmployeesTab";
import { RunsTab } from "../../client/src/pages/payroll/RunsTab";
import { SettlementTab } from "../../client/src/pages/payroll/SettlementTab";
import { LeaveTab } from "../../client/src/pages/payroll/LeaveTab";
import { WpsTab } from "../../client/src/pages/payroll/WpsTab";
import { PensionTab } from "../../client/src/pages/payroll/PensionTab";
import enFirm from "../../client/src/locales/en/firm.json";
import arFirm from "../../client/src/locales/ar/firm.json";
import enHr from "../../client/src/locales/en/hr.json";
import arHr from "../../client/src/locales/ar/hr.json";

const TABS = [
  ["employees", EmployeesTab, "/employees", "hr.noEmployees", []],
  ["runs", RunsTab, "/payroll-runs", "hr.noRuns", []],
  ["settlements", SettlementTab, "/payroll/settlements", "hr.noSettlements", []],
  ["leave", LeaveTab, "/payroll/leave-requests", "hr.noLeaveRequests", []],
  ["wps expiries", WpsTab, "/payroll/expiries", "hr.noExpiries", []],
  [
    "pension liability",
    PensionTab,
    "/payroll/pension-liability",
    "hr.pension.empty",
    { funds: [], totalOutstanding: "0.00" },
  ],
] as const;

const COMPANY_PATH = "/api/companies/c1";
const FIXTURES: Record<string, unknown> = {
  "/accounts": [],
  "/bank-accounts": [],
  "/employees": [],
  "/payroll-runs": [],
  "/payroll/leave-types": [],
  "/payroll/pension-payments": [],
  "/payroll/settings": {
    allowSingleOwnerApproval: false,
    adviserConfirmed: true,
    adviserConfirmedAt: null,
    adviserNote: null,
    legalParams: {
      pension: { AE: { employeeRate: "5", employerRate: "12.5", base: "gross", confirmed: true } },
      gratuity: { firstTierDaysPerYear: 21, laterTierDaysPerYear: 30, capMonthsOfBasic: 24 },
      overtime: { normalMultiplier: "1.25", nightOrRestDayMultiplier: "1.5" },
    },
  },
  "/payroll/wps-settings": {
    mohreEstablishmentId: null,
    wpsEmployerRoutingCode: null,
    wpsEmployerIban: null,
    wpsEmployerBankName: null,
    wpsAgentId: null,
  },
  "/team/me": { role: "owner", permissions: [], grantableRoles: [], viaFirmAccess: false },
};
const serverError = () => Object.assign(new Error("500: boom"), { status: 500 });

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function withTab(
  locale: "en" | "ar",
  Tab: (typeof TABS)[number][1],
  endpoint: string,
  request: () => Promise<unknown>,
  test: (node: HTMLDivElement, client: QueryClient) => Promise<void>
) {
  await loadNamespaces(locale, ["common", "firm", "hr", "components"]);
  const prior = useI18n.getState().locale;
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const priorEnv = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  useI18n.setState({ locale });

  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const path = queryKey.join("/");
          if (path === endpoint) return request();
          const fixture = FIXTURES[path.slice(COMPANY_PATH.length)];
          if (fixture === undefined) throw new Error(`Unexpected request: ${path}`);
          return fixture;
        },
      },
    },
  });
  client.setQueryData(["/api/companies", "c1", "billing", "subscription"], null);
  client.setQueryData(["/api/companies", "c1", "billing", "usage"], null);
  const node = document.createElement("div");
  const root = createRoot(node);
  try {
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, {
          client,
          children: createElement(Tab, { companyId: "c1" }),
        })
      );
    });
    await test(node, client);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    useI18n.setState({ locale: prior });
    env.IS_REACT_ACT_ENVIRONMENT = priorEnv;
  }
}

function waitForView(assert: () => void) {
  return vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert();
  });
}

describe.each(["en", "ar"] as const)("payroll tabs: failed loads (%s)", (locale) => {
  const firm = locale === "en" ? enFirm : arFirm;
  const hr = locale === "en" ? enHr : arHr;

  it.each(TABS)(
    "%s shows a localized error and recovers on Retry",
    async (_, Tab, path, key, data) => {
      const initial = deferred();
      const retry = deferred();
      const request = vi
        .fn()
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(retry.promise);
      await withTab(locale, Tab, COMPANY_PATH + path, request, async (node) => {
        const alert = () => node.querySelector('[role="alert"][data-testid="payroll-load-error"]');
        const expectPending = () => {
          expect(node.querySelector('[role="status"]')?.textContent).toBe(hr["hr.loading"]);
          expect(node.textContent).not.toContain(hr[key]);
          expect(alert()).toBeNull();
        };
        expect(request).toHaveBeenCalledTimes(1);
        expectPending();

        await act(async () => initial.reject(serverError()));
        await waitForView(() => {
          expect(alert()?.textContent).toContain(firm["firm.loadFailedTitle"]);
          expect(alert()?.textContent).toContain(firm["firm.loadFailedBody"]);
          if (path === "/payroll/expiries") {
            expect(node.textContent).toContain(hr["hr.legalTitle"]);
          }
        });
        expect(alert()?.textContent).not.toContain("boom");
        expect(node.textContent).not.toContain(hr[key]);
        const button = alert()?.querySelector("button");
        expect(button?.textContent).toBe(firm["firm.retry"]);

        await act(async () => button?.click());
        expect(request).toHaveBeenCalledTimes(2);
        await waitForView(expectPending);

        await act(async () => retry.resolve(data));
        await waitForView(() => expect(node.textContent).toContain(hr[key]));
        expect(alert()).toBeNull();
        expect(node.textContent).not.toContain(hr["hr.loading"]);
      });
    }
  );

  it("keeps previously loaded WPS expiries visible after a failed refresh", async () => {
    const path = COMPANY_PATH + "/payroll/expiries";
    const employeeName = "Samira";
    const request = vi
      .fn()
      .mockResolvedValueOnce([
        { employeeName, document: "passport", expiryDate: "2026-12-01", daysLeft: 6 },
      ])
      .mockRejectedValueOnce(serverError());
    await withTab(locale, WpsTab, path, request, async (node, client) => {
      await waitForView(() => expect(node.textContent).toContain(employeeName));
      await act(async () => {
        await client.invalidateQueries({ queryKey: [path] });
      });
      await waitForView(() => {
        expect(node.querySelector('[role="alert"]')?.textContent).toBe(hr["hr.refreshFailed"]);
      });
      expect(request).toHaveBeenCalledTimes(2);
      expect(node.textContent).toContain(employeeName);
      expect(node.querySelector('[data-testid="payroll-load-error"]')).toBeNull();
    });
  });
});
