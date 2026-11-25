// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "../../client/src/locales/ar/screens.json";
import en from "../../client/src/locales/en/screens.json";
import {
  click,
  COMPANY_ID,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const screens = (await import("../../client/src/locales/ar/screens.json")).default;
  const components = (await import("../../client/src/locales/ar/components.json")).default;
  const pages = (await import("../../client/src/locales/ar/pages.json")).default;
  const purchases = (await import("../../client/src/locales/ar/purchases.json")).default;
  const dict = { ...components, ...pages, ...purchases, ...screens } as Record<string, string>;
  return { ...actual, useTranslation: () => ({ t: dict, locale: "ar" }) };
});
vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

describe("bill pay search", () => {
  afterEach(async () => {
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("announces a no-match search and restores rows and focus when cleared", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({
      [`/api/companies/${COMPANY_ID}/bills`]: [
        {
          id: "b1",
          company_id: COMPANY_ID,
          vendor_name: "Atlas Office Supplies",
          bill_number: "AOS-1",
          bill_date: "2026-11-01",
          due_date: "2026-12-01",
          currency: "AED",
          total_amount: "105",
          amount_paid: "0",
          status: "approved",
        },
      ],
    });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderPage(BillPay);

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(search).toBeTruthy();
    expect(document.querySelector("tbody")?.textContent).toContain("Atlas Office Supplies");

    await act(async () => search.focus());
    await type(search, "zzz-nothing");

    const status = [...document.querySelectorAll('[role="status"]')].find(
      (el) => el.textContent === ar["screens.billsSearchNoMatchTitle"]
    );
    expect(status).toBeTruthy();
    expect(document.querySelector("tbody")).toBeNull();
    expect(document.body.textContent).toContain(ar["screens.billsSearchNoMatchBody"]);

    const clear = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === ar["screens.clearSearch"]
    )!;
    await click(clear);

    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(status?.textContent).toBe("");
    expect(document.querySelector("tbody")?.textContent).toContain("Atlas Office Supplies");
  }, 30_000);

  it("has the new keys in English and Arabic", () => {
    for (const k of ["screens.billsSearchNoMatchTitle", "screens.billsSearchNoMatchBody"]) {
      expect((en as Record<string, string>)[k]).toBeTruthy();
      expect((ar as Record<string, string>)[k]).toMatch(/[؀-ۿ]/);
    }
  });
});
