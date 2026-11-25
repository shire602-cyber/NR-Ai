// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "../../client/src/locales/ar/screens.json";
import arPages from "../../client/src/locales/ar/pages.json";
import en from "../../client/src/locales/en/screens.json";
import {
  click,
  COMPANY_ID,
  flush,
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
    setFixtures({ [`/api/companies/${COMPANY_ID}/bills`]: [AOS_BILL] });
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

  const AOS_BILL = {
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
  };

  it("does not report a search no-match when the selected status has no rows", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [`/api/companies/${COMPANY_ID}/bills`]: [AOS_BILL] });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderPage(BillPay);

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await type(search, "AOS-1");
    expect(document.querySelector("tbody")?.textContent).toContain("Atlas Office Supplies");

    // "Paid" is the fifth tab, so ScrollTabs (maxVisible 5) keeps it in the "More" menu.
    const more = document.querySelector<HTMLElement>('[data-testid="scroll-tabs-more"]')!;
    expect(more).toBeTruthy();
    await act(async () => {
      more.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false })
      );
    });
    await flush();
    const paidItem = document.querySelector<HTMLElement>('[data-testid="bill-tab-paid"]')!;
    expect(paidItem).toBeTruthy();
    await act(async () => {
      paidItem.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
      paidItem.click();
    });
    await flush();

    expect(document.querySelector("tbody")).toBeNull();
    expect(document.body.textContent).toContain(arPages["pages.noBillsFound"]);
    expect(document.body.textContent).not.toContain(ar["screens.billsSearchNoMatchTitle"]);
    expect(document.body.textContent).not.toContain(ar["screens.billsSearchNoMatchBody"]);
    expect(
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === ar["screens.clearSearch"]
      )
    ).toBe(false);
  }, 30_000);

  it("keeps the search icon and input on one direction (no dir=auto) in RTL", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [`/api/companies/${COMPANY_ID}/bills`]: [AOS_BILL] });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    document.documentElement.setAttribute("dir", "rtl");
    try {
      await renderPage(BillPay);
      const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
      await type(search, "AOS-1");
      // jsdom has no layout, so assert the cause: the input carries no direction of its own
      // (it inherits the UI direction like the icon) and both use paired logical classes.
      expect(search.getAttribute("dir")).toBeNull();
      expect(search.className).toContain("ps-9");
      const icon = search.parentElement!.querySelector("svg")!;
      expect(icon.getAttribute("class")).toContain("start-3");
      expect(search.closest("[dir]")?.getAttribute("dir")).toBe("rtl");
    } finally {
      document.documentElement.removeAttribute("dir");
    }
  }, 30_000);

  it("shows loading, not the empty state, for a paused first fetch; cached rows survive a paused refetch", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [`/api/companies/${COMPANY_ID}/bills`]: [AOS_BILL] });
    const { onlineManager } = await import("@tanstack/react-query");
    const { queryClient } = (await import("../../client/src/lib/queryClient")) as unknown as {
      queryClient: import("@tanstack/react-query").QueryClient;
    };
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    const billsKey = ["/api/companies", COMPANY_ID, "bills"];
    try {
      onlineManager.setOnline(false);
      await renderPage(BillPay);
      expect(queryClient.getQueryState(billsKey)?.fetchStatus).toBe("paused");
      expect(document.body.textContent).not.toContain(arPages["pages.noBillsFound"]);
      expect(document.querySelector('[data-testid="table-skeleton"]')).toBeTruthy();
      expect(document.body.textContent).not.toContain("Atlas Office Supplies");
      await unmountPage();

      onlineManager.setOnline(true);
      await renderPage(BillPay);
      expect(document.querySelector("tbody")?.textContent).toContain("Atlas Office Supplies");
      onlineManager.setOnline(false);
      await act(async () => {
        void queryClient.refetchQueries({ queryKey: billsKey });
      });
      await flush();
      expect(queryClient.getQueryState(billsKey)?.fetchStatus).toBe("paused");
      expect(document.querySelector("tbody")?.textContent).toContain("Atlas Office Supplies");
      expect(document.body.textContent).not.toContain(arPages["pages.noBillsFound"]);
    } finally {
      onlineManager.setOnline(true);
    }
  }, 30_000);
  it("has the new keys in English and Arabic", () => {
    for (const k of ["screens.billsSearchNoMatchTitle", "screens.billsSearchNoMatchBody"]) {
      expect((en as Record<string, string>)[k]).toBeTruthy();
      expect((ar as Record<string, string>)[k]).toMatch(/[؀-ۿ]/);
    }
  });
});
