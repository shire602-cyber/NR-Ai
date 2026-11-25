// @vitest-environment jsdom
// Payroll UX: a failed list load shows a translated, retryable error, never the "no employees /
// runs / settlements" empty state that would tell the user their data is gone.
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

const TABS = [
  ["employees", EmployeesTab, "/employees"],
  ["runs", RunsTab, "/payroll-runs"],
  ["settlements", SettlementTab, "/payroll/settlements"],
  ["leave", LeaveTab, "/payroll/leave-requests"],
  ["wps expiries", WpsTab, "/api/companies"],
] as const;

describe("payroll tabs: failed loads", () => {
  it.each(["en", "ar"] as const)(
    "show a retryable error instead of an empty state (%s)",
    async (locale) => {
      await loadNamespaces(locale, ["common", "firm", "hr", "components"]);
      const prior = useI18n.getState().locale;
      const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
      const priorEnv = env.IS_REACT_ACT_ENVIRONMENT;
      env.IS_REACT_ACT_ENVIRONMENT = true;
      useI18n.setState({ locale });
      try {
        for (const [name, Tab, needle] of TABS) {
          const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          client.setQueryDefaults([], {
            queryFn: ({ queryKey }) => {
              const path = String(queryKey[0]);
              if (path.includes(needle)) {
                return Promise.reject(Object.assign(new Error("500: boom"), { status: 500 }));
              }
              return Promise.resolve([]);
            },
          });
          const node = document.createElement("div");
          const root = createRoot(node);
          await act(async () => {
            root.render(
              createElement(QueryClientProvider, {
                client,
                children: createElement(Tab, { companyId: "c1" }),
              })
            );
          });
          await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
          });
          expect(node.querySelector("[data-testid=payroll-load-error]"), name).not.toBeNull();
          expect(node.textContent, name).not.toContain("boom");
          await act(async () => root.unmount());
          client.clear();
        }
      } finally {
        useI18n.setState({ locale: prior });
        env.IS_REACT_ACT_ENVIRONMENT = priorEnv;
      }
    }
  );
});
