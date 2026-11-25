// @vitest-environment jsdom
/**
 * Bank accounts screen states: search, localized feedback, and account and history query recovery.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  COMPANY_ID,
  buttonByText,
  byTestId,
  click,
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
const IMPORTS_PATH = `${C}/bank-statements/imports`;
const RECONCILIATIONS_PATH = `${C}/bank-accounts/a1/reconciliations`;
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

function pendingRequest() {
  let rejectRequest!: (error: Error) => void;
  const response = new Promise<never>((_, reject) => {
    rejectRequest = reject;
  });
  return { response, fail: () => rejectRequest(new Error("network down")) };
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
  it("recovers when retrying a failed accounts request", async () => {
    setFixtures({ [`${C}/bank-accounts`]: failing() });
    await mount();
    const err = byTestId("bank-accounts-error");
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("Bank accounts could not be loaded");
    expect(document.body.textContent).not.toContain("No bank accounts yet");

    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS });
    await click(buttonByText(/^Retry$/, err!));
    await flushUntil(() => document.body.textContent?.includes("Operating") === true);
    expect(document.body.textContent).toContain("Operating");
    expect(byTestId("bank-accounts-error")).toBeNull();
  });

  it("shows import history loading, failure and an empty state after a successful retry", async () => {
    const request = pendingRequest();
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS, [IMPORTS_PATH]: request.response });
    await mount();
    const imports = document.querySelector("section")!;
    expect(imports.querySelector('[data-testid="table-skeleton"]')).not.toBeNull();
    expect(imports.textContent).not.toContain("No imports yet");

    request.fail();
    await flushUntil(() => byTestId("bank-imports-error") !== null);
    const err = byTestId("bank-imports-error")!;
    expect(err.textContent).toContain("Import history could not be loaded");
    expect(imports.textContent).not.toContain("No imports yet");

    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS, [IMPORTS_PATH]: [] });
    await click(buttonByText(/^Retry$/, err));
    await flushUntil(() => imports.textContent?.includes("No imports yet") === true);
    expect(imports.textContent).toContain("No imports yet");
    expect(byTestId("bank-imports-error")).toBeNull();
  });

  it("shows saved reconciliations loading, failure and an empty state after a successful retry", async () => {
    const request = pendingRequest();
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS, [RECONCILIATIONS_PATH]: request.response });
    await mount();
    await click(document.querySelector('button[aria-label="Reconciliation statement"]'));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe("Loading…");
    expect(dialog.textContent).not.toContain("No saved reconciliations yet");

    request.fail();
    await flushUntil(() => dialog.querySelector('[role="alert"]') !== null);
    const err = dialog.querySelector('[role="alert"]')!;
    expect(err.textContent).toContain("Saved reconciliations could not be loaded");
    expect(dialog.textContent).not.toContain("No saved reconciliations yet");

    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS, [RECONCILIATIONS_PATH]: [] });
    await click(buttonByText(/^Retry$/, err));
    await flushUntil(() => dialog.textContent?.includes("No saved reconciliations yet") === true);
    expect(dialog.textContent).toContain("No saved reconciliations yet");
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
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
    const input = document.querySelector(
      '[data-testid="input-search-bank-accounts"]'
    ) as HTMLInputElement;
    const wrap = input.parentElement!;
    expect(input.getAttribute("dir")).toBe("auto");
    for (const variant of [
      "[&:dir(ltr)>input:dir(ltr)]:ps-9",
      "[&:dir(ltr)>input:dir(rtl)]:pe-9",
      "[&:dir(rtl)>input:dir(ltr)]:pe-9",
      "[&:dir(rtl)>input:dir(rtl)]:ps-9",
    ]) {
      expect(wrap.className).toContain(variant);
    }
    expect(wrap.className).not.toMatch(/(^|\s)(pl|pr|left|right)-/);
    expect(wrap.querySelector("svg")?.getAttribute("class")).toContain("start-3");
    expect(input.className).not.toMatch(/(^|\s)(ps|pe|pl|pr)-9(\s|$)/);

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
