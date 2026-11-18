// @vitest-environment jsdom
/**
 * E3 (J1-r3 / J2-r3 Medium): Reports > Payables aging showed the balances KPI strip
 * (Customer open balance / Vendor open balance / Net AR less AP) as 0.00 while the table below was
 * right: the strip is shown on AP aging but its balance-summaries query only loaded for the
 * customer / vendor balance reports. The strip and the query now share one report list.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY,
  COMPANY_ID,
  apiCalls,
  byTestId,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";
import { permissionsForRole } from "../../shared/permissions";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;

beforeAll(async () => {
  await loadLocale("en");
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;
});
beforeEach(() => resetHarness());
afterEach(async () => {
  await unmountPage();
});

const bucket = (count: number, amount: number) => ({ count, amount });
const row = (name: string, open: number, overdue: number) => ({
  name,
  currency: "AED",
  invoiceCount: 1,
  billCount: 1,
  totalInvoiced: open,
  totalBilled: open,
  paidAmount: 0,
  openBalance: open,
  openBalanceAed: open,
  overdueBalance: overdue,
  overdueBalanceAed: overdue,
  maxDaysOverdue: overdue ? 10 : 0,
});

describe("[E3][J1-r3] AP aging KPI strip", () => {
  it("reads the open balances on the payables aging report", async () => {
    window.history.replaceState(null, "", "/reports?tab=balances&report=ap-aging");
    setFixtures({
      [C]: { ...COMPANY },
      [`${C}/team/me`]: {
        role: "owner",
        permissions: permissionsForRole("owner"),
        grantableRoles: [],
        viaFirmAccess: false,
      },
      [`${C}/reports/balance-summaries`]: {
        generatedAt: "2026-11-18T00:00:00.000Z",
        customers: [row("Acme", 8758.75, 0)],
        vendors: [row("Supplier", 2306.75, 0)],
      },
      [`${C}/bills/aging`]: {
        current: bucket(2, 2306.75),
        days_1_30: bucket(0, 0),
        days_31_60: bucket(0, 0),
        days_61_90: bucket(0, 0),
        days_90_plus: bucket(0, 0),
      },
    });
    const { default: Reports } = await import("../../client/src/pages/Reports");
    await renderPage(Reports);
    await flushUntil(() =>
      (byTestId("balances-kpi-strip")?.textContent ?? "").includes("6,452.00")
    );
    const strip = byTestId("balances-kpi-strip");
    expect(strip, "KPI strip rendered on AP aging").not.toBeNull();
    expect(apiCalls("GET").some((c) => c.url.endsWith("/reports/balance-summaries"))).toBe(true);
    const text = strip!.textContent ?? "";
    expect(text).toContain("8,758.75");
    expect(text).toContain("2,306.75");
    expect(text).toContain("6,452.00");
  }, 30_000);
});
