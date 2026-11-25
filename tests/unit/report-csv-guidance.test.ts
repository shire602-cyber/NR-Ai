// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadLocale, t, useI18n } from "../../client/src/lib/i18n";
import { reportAutomationStarters } from "../../client/src/lib/reportCatalog";
import { createCatalogText } from "../../client/src/lib/reportCatalogText";
import { ReportWorkspacePartF } from "../../client/src/pages/dashboard/ReportWorkspaceF";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function setLocale(locale: "en" | "ar") {
  await loadLocale(locale);
  act(() => useI18n.getState().setLocale(locale));
}

it.each(["en", "ar"] as const)(
  "renders the CSV checklist in the %s report workspace",
  async (locale) => {
    await setLocale(locale);
    const starter = reportAutomationStarters.find(
      ({ id }) => id === "owner-cash-control-autopilot"
    )!;
    const ct = createCatalogText(t[locale], locale);
    const model = {
      t: t[locale],
      preferredReportWorkspace: { navLabel: "Reports" },
      preferredReportPackTemplates: [],
      preferredReportAutomationStarters: [
        {
          ...ct.deep(starter),
          readyReports: 0,
          reports: [],
          playbooks: [],
          href: "/reports",
        },
      ],
    } as unknown as Parameters<typeof ReportWorkspacePartF>[0]["m"];
    await act(async () => root.render(createElement(ReportWorkspacePartF, { m: model })));
    const card = container.querySelector(
      '[data-testid="dashboard-report-automation-starter-owner-cash-control-autopilot"]'
    );
    expect(card?.textContent).toContain(BANK_RECONCILIATION_COPY[locale]);
    expect(card?.textContent).not.toMatch(
      /connect invoice and bank refreshes|اربط تحديثات الفواتير والبنك/i
    );
  }
);
