// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import arFirm from "../../client/src/locales/ar/firm.json";
import {
  click,
  COMPANY_ID,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  flush,
  renderPage,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import CashFlowForecast from "../../client/src/pages/CashFlowForecast";

const FORECAST_URL_PREFIX = `/api/companies/${COMPANY_ID}/cashflow/forecast`;
let failForecast = true;

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const firm = (await import("../../client/src/locales/ar/firm.json")).default;
  const finance = (await import("../../client/src/locales/ar/financeViews.json")).default;
  const dict = { ...finance, ...firm } as Record<string, string>;
  return { ...actual, useTranslation: () => ({ t: dict, locale: "ar" }) };
});
vi.mock("../../client/src/lib/queryClient", async () => {
  const base = formHarnessQueryClientMock();
  const inner = base.apiRequest.getMockImplementation()!;
  base.apiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    if (failForecast && url.startsWith(FORECAST_URL_PREFIX) && !url.includes("/items")) {
      const err = new Error("boom") as Error & { status: number };
      err.status = 500;
      throw err;
    }
    return inner(method, url, body);
  });
  return base;
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

describe("cash flow forecast load failure", () => {
  afterEach(async () => {
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("shows a translated retryable error, not the empty table, and recovers on retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = true;
    setFixtures({});
    await renderPage(CashFlowForecast);
    await flush(50);

    const err = document.querySelector('[data-testid="forecast-load-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain(arFirm["firm.loadFailedTitle"]);
    expect(document.body.textContent).not.toContain("boom");
    expect(document.body.textContent).not.toContain("No projection data");

    failForecast = false;
    setFixtures({
      [`${FORECAST_URL_PREFIX}?days=90&scenario=base&delayReceiptsDays=0`]: {
        currentBalance: 0,
        projections: [],
        insights: [],
        items: [],
        assumptions: [],
        insufficientData: false,
        scenario: "base",
        summary: { receivablesOverdue: 0, minProjectedBalance: 0, projectedShortfall: 0 },
      },
    });
    await click(err!.querySelector("button"));
    await flush(50);
    expect(document.querySelector('[data-testid="forecast-load-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="forecast-empty"]')).not.toBeNull();
  });
});
