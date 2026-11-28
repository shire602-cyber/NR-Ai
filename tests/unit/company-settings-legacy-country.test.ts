// @vitest-environment jsdom
/**
 * A company whose stored country is a legacy SA: the settings page never shows the word Saudi
 * (en) or its Arabic equivalent, offers no Saudi option, and keeps the stored value on save.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  flush,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true, isLoading: false }),
}));

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW = {
  id: COMPANY_ID,
  name: "Synthetic Trading LLC",
  baseCurrency: "AED",
  trnVatNumber: "100000000000003",
  locale: "en",
  emirate: "dubai",
  addressCountry: "SA",
  legalStructure: "LLC",
  businessAddress: "Office 1204, Dubai",
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
  setFixtures({ [`/api/companies/${COMPANY_ID}`]: ROW });
});
afterEach(async () => {
  await unmountPage();
  useI18n.getState().setLocale("en");
});

describe.each([
  { locale: "en", legacy: "Other (legacy value)" },
  { locale: "ar", legacy: "أخرى (قيمة قديمة)" },
] as const)("legacy SA country ($locale)", ({ locale, legacy }) => {
  it("shows a neutral label, no Saudi text, and keeps SA on save", async () => {
    useI18n.getState().setLocale(locale);
    const { default: CompanySettings } = await import("../../client/src/pages/CompanySettings");
    await renderPage(CompanySettings);
    await flushUntil(() => !!byTestId("select-address-country"));

    const trigger = byTestId("select-address-country")!;
    expect(trigger.textContent).toContain(legacy);
    expect(trigger.textContent).toContain("SA");

    // Everything rendered except the SAR currency name (a currency, not a country).
    const text = document.body.textContent ?? "";
    expect(text.replace(/SAR\s*[-—]\s*[^\n]*/g, "")).not.toMatch(
      /Saudi Arabia|المملكة العربية السعودية/
    );

    // Edit an unrelated field so the form is dirty; the stored country must ride along unchanged.
    await type(document.querySelector('form [name="name"]'), "Edited Name");
    await flush(5);
    await submit(byTestId("button-save-company-settings"));
    await flushUntil(() => apiCalls("PATCH").length > 0);
    expect((apiCalls("PATCH")[0].body as Record<string, unknown>).addressCountry).toBe("SA");
  });
});
