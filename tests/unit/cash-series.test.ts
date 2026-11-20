// @vitest-environment jsdom
/**
 * CASH-SERIES (owner decision 2026-11-18): cash sales have their own number series.
 *   - Settings › Numbering shows a "Cash sales" row (en + ar) and saves it to its own doc type;
 *   - the cash sale editor shows the next number from the cash sale series (not the invoice
 *     series), written left-to-right inside Arabic text.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  COMPANY_ID,
  apiCalls,
  byTestId,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, t, useI18n } from "../../client/src/lib/i18n";
import { permissionsForRole } from "../../shared/permissions";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: null,
    usage: null,
    limits: null,
    tierName: "enterprise",
    isFreeTier: false,
    canAccess: () => true,
    getRequiredTier: () => "starter",
    isLoading: false,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;
const row = (docType: string, prefix: string, last: number) => ({
  docType,
  prefix,
  padding: 5,
  yearlyReset: true,
  lastIssued: last,
  nextNumber: last + 1,
  nextFormatted: `${prefix}-2026-${String(last + 1).padStart(5, "0")}`,
});
const NUMBERING = {
  numbering: [
    row("invoice", "INV", 41),
    row("cash_sale", "CS", 3),
    row("credit_note", "CN", 0),
    row("debit_note", "DN", 0),
    row("quote", "QT", 0),
  ],
};

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
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
beforeEach(() => {
  resetHarness();
  setFixtures({
    [`${C}/numbering`]: NUMBERING,
    [`${C}/team/me`]: {
      role: "owner",
      permissions: permissionsForRole("owner"),
      grantableRoles: [],
      viaFirmAccess: false,
    },
  });
});
afterEach(async () => {
  await unmountPage();
  act(() => useI18n.getState().setLocale("en"));
});

describe.each(["en", "ar"] as const)("CASH-SERIES (%s)", (locale) => {
  beforeEach(() => {
    act(() => useI18n.getState().setLocale(locale));
  });

  it("Settings › Numbering has its own Cash sales row and saves it to the cash_sale series", async () => {
    const { default: Numbering } = await import("../../client/src/pages/settings/Numbering");
    await renderPage(Numbering);
    await flushUntil(() => !!byTestId("numbering-cash_sale"));
    const card = byTestId("numbering-cash_sale")!;
    expect(card.textContent).toContain(t[locale]["settingsPages.numberingDoc_cash_sale"]);
    expect(t[locale]["settingsPages.numberingDoc_cash_sale"]).not.toBe(
      t[locale]["settingsPages.numberingDoc_invoice"]
    );
    if (locale === "ar") expect(card.textContent).toMatch(/[؀-ۿ]/);
    expect((byTestId("numbering-prefix-cash_sale") as HTMLInputElement).value).toBe("CS");
    expect(card.textContent).toContain("CS-2026-00004");

    await type(byTestId("numbering-prefix-cash_sale"), "pos");
    await submit(byTestId("numbering-save-cash_sale"));
    const puts = apiCalls("PUT");
    expect(puts.map((c) => c.url)).toEqual([`${C}/numbering/cash_sale`]);
    expect(puts[0].body).toEqual({ prefix: "pos", padding: 5, yearlyReset: true });
  });

  it("the cash sale editor shows the next number of the cash sale series, not the invoice one", async () => {
    const { default: CashSale } = await import("../../client/src/pages/sales/CashSale");
    await renderPage(CashSale);
    await flushUntil(() => byTestId("cash-sale-next-number")?.textContent === "CS-2026-00004");
    const box = byTestId("cash-sale-number")!;
    expect(box.textContent).toContain(t[locale]["invoices.cashSale.number"]);
    expect(box.textContent).toContain(t[locale]["invoices.cashSale.numberHint"]);
    expect(box.textContent).not.toContain("INV-2026-00042");
    const num = byTestId("cash-sale-next-number")!;
    expect(num.getAttribute("dir")).toBe("ltr");
    if (locale === "ar") {
      expect(t.ar["invoices.cashSale.number"]).toMatch(/[؀-ۿ]/);
      expect(t.ar["invoices.cashSale.numberHint"]).toMatch(/[؀-ۿ]/);
    }
    expect(box.querySelector('a[href="/settings/numbering"]')).not.toBeNull();
  });
});
