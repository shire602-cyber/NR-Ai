// @vitest-environment jsdom
/**
 * Bank accounts screen states: search and no-match, load failure with retry (instead of the
 * misleading "no bank accounts yet"), and Arabic with no English leftovers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  COMPANY_ID,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;
const ACCOUNTS = [
  {
    id: "a1",
    nameEn: "Operating",
    bankName: "Emirates NBD",
    accountNumber: "111",
    iban: "AE070331234567890123456",
    currency: "AED",
    glAccountId: null,
    isActive: true,
    openingBalance: 0,
    openingBalanceDate: null,
  },
  {
    id: "a2",
    nameEn: "Savings",
    bankName: "Mashreq",
    accountNumber: "222",
    iban: null,
    currency: "USD",
    glAccountId: null,
    isActive: true,
    openingBalance: 0,
    openingBalanceDate: null,
  },
];

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as any;
}, 90_000);
beforeEach(() => {
  resetHarness();
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  await unmountPage();
  const { queryClient } = (await import("../../client/src/lib/queryClient")) as any;
  await queryClient.cancelQueries();
  queryClient.clear();
  useI18n.setState({ locale: "en" });
});

/** A fixture the harness's query function awaits, so the query fails like a dropped request. */
function failing() {
  const rejected = Promise.reject(new Error("network down"));
  rejected.catch(() => {});
  return rejected;
}

async function mount() {
  const page = (await import("../../client/src/pages/BankAccounts")).default;
  await renderPage(page);
  await flushUntil(
    () =>
      !!document.querySelector('[data-testid="input-search-bank-accounts"]') ||
      !!document.querySelector('[data-testid="bank-accounts-error"]')
  );
}

function search(value: string) {
  const input = document.querySelector(
    '[data-testid="input-search-bank-accounts"]'
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }).then(() => flush());
}

describe("bank accounts states", { timeout: 90_000 }, () => {
  it("shows an error with retry when accounts fail to load, not the empty state", async () => {
    setFixtures({ [`${C}/bank-accounts`]: failing() });
    await mount();
    const err = document.querySelector('[data-testid="bank-accounts-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("Bank accounts could not be loaded");
    expect(document.body.textContent).not.toContain("No bank accounts yet");
    expect(err!.querySelector("button")).not.toBeNull();
  });

  it("renders the search, no-match and error states in Arabic without English text", async () => {
    useI18n.setState({ locale: "ar" });
    setFixtures({ [`${C}/bank-accounts`]: failing() });
    await mount();
    const err = document.querySelector('[data-testid="bank-accounts-error"]')!;
    expect(err.textContent).toMatch(/[؀-ۿ]/);
    expect(err.textContent).not.toMatch(/[A-Za-z]/);
  });

  it("localizes the no-match state in Arabic", async () => {
    useI18n.setState({ locale: "ar" });
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS });
    await mount();
    const input = document.querySelector(
      '[data-testid="input-search-bank-accounts"]'
    ) as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toMatch(/[؀-ۿ]/);
    await search("zzz");
    const text = document.body.textContent ?? "";
    expect(text).toContain("لا توجد حسابات بنكية مطابقة لبحثك");
  });

  it("filters by search and shows a no-match state that is not the empty state", async () => {
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS });
    await mount();
    expect(document.body.textContent).toContain("Operating");
    expect(document.body.textContent).toContain("Savings");

    await search("mashreq");
    expect(document.body.textContent).not.toContain("Operating");
    expect(document.body.textContent).toContain("Savings");

    await search("zzz");
    expect(document.body.textContent).toContain("No bank accounts match your search");
    expect(document.body.textContent).not.toContain("No bank accounts yet");
  });
});
