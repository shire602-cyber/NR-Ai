// @vitest-environment jsdom
/**
 * Company settings: leave-without-saving guard (not after save or reset) and the stale-data
 * notice when a refetch fails while the company is shown. Runs in en and ar.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  COMPANY_ID,
  byTestId,
  click,
  flush,
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
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";

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
  addressCountry: "AE",
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
  document.querySelectorAll("a[data-test-link]").forEach((a) => a.remove());
});

function addLink() {
  const a = document.createElement("a");
  a.href = "/dashboard";
  a.setAttribute("data-test-link", "");
  a.textContent = "go";
  document.body.appendChild(a);
  return a;
}

describe.each([
  { locale: "en", body: "Your changes to the company settings will be lost." },
  { locale: "ar", body: "ستفقد التغييرات التي أجريتها على إعدادات الشركة." },
] as const)("company settings leave guard ($locale)", ({ locale, body }) => {
  async function open() {
    useI18n.getState().setLocale(locale);
    const { default: CompanySettings } = await import("../../client/src/pages/CompanySettings");
    await renderPage(CompanySettings);
    await flushUntil(() => !!document.querySelector('form [name="name"]'));
  }
  const nameInput = () => document.querySelector('form [name="name"]') as HTMLInputElement;

  it("does not ask when nothing changed", async () => {
    await open();
    await click(addLink());
    await flush(5);
    expect(byTestId("dialog-leave-without-saving")).toBeNull();
  });

  it("asks when dirty, in the page language, and stays on Stay", async () => {
    await open();
    await type(nameInput(), "Edited Name");
    await flush(5);
    await click(addLink());
    await flushUntil(() => !!byTestId("dialog-leave-without-saving"));
    expect(byTestId("dialog-leave-without-saving")!.textContent).toContain(body);
    await click(byTestId("button-stay-on-editor"));
    expect(byTestId("dialog-leave-without-saving")).toBeNull();
  });

  it("does not ask after a successful save", async () => {
    await open();
    await type(nameInput(), "Edited Name");
    await flush(5);
    await submit(byTestId("button-save-company-settings"));
    await flush(20);
    await click(addLink());
    await flush(5);
    expect(byTestId("dialog-leave-without-saving")).toBeNull();
  });

  it("does not ask after Reset", async () => {
    await open();
    await type(nameInput(), "Edited Name");
    await flush(5);
    await click(byTestId("button-reset"));
    await flush(5);
    await click(addLink());
    await flush(5);
    expect(byTestId("dialog-leave-without-saving")).toBeNull();
  });
});

describe.each([
  { locale: "en", notice: "Couldn't refresh. Showing the last loaded data." },
  { locale: "ar", notice: "تعذّر التحديث. تُعرض آخر بيانات تم تحميلها." },
] as const)("company settings stale notice ($locale)", ({ locale, notice }) => {
  it("keeps the form and warns when a refresh fails", async () => {
    useI18n.getState().setLocale(locale);
    const { default: CompanySettings } = await import("../../client/src/pages/CompanySettings");
    await renderPage(CompanySettings);
    await flushUntil(() => !!document.querySelector('form [name="name"]'));
    expect(byTestId("company-settings-stale-notice")).toBeNull();
    // A later read fails: the query keeps its data and gains an error.
    const query = (queryClient as any)
      .getQueryCache()
      .find({ queryKey: ["/api/companies", COMPANY_ID] });
    expect(query?.state.data).toBeTruthy();
    await act(async () => {
      query.setState({ status: "error", error: new Error("offline"), fetchStatus: "idle" });
    });
    await flushUntil(() => !!byTestId("company-settings-stale-notice"));
    const el = byTestId("company-settings-stale-notice")!;
    expect(el.textContent).toContain(notice);
    expect(document.querySelector('form [name="name"]')).not.toBeNull();
    expect(byTestId("company-settings-load-error")).toBeNull();
  });
});
