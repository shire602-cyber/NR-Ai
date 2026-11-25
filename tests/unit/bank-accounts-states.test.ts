// @vitest-environment jsdom
/**
 * Bank accounts screen states: search, localized feedback, and account and history query recovery.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { onlineManager } from "@tanstack/react-query";
import {
  COMPANY,
  COMPANY_ID,
  rerenderPage,
  setWorkspaceCompany,
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

let BankAccountsPage: typeof import("../../client/src/pages/BankAccounts").default;

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
  BankAccountsPage = (await import("../../client/src/pages/BankAccounts")).default;
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
  onlineManager.setOnline(true);
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
  await renderPage(BankAccountsPage);
  await flushUntil(
    () =>
      !!document.querySelector('[data-testid="input-search-bank-accounts"]') ||
      !!document.querySelector('[data-testid="bank-accounts-error"]')
  );
}

async function search(value: string) {
  const input = document.querySelector(
    '[data-testid="input-search-bank-accounts"]'
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function appQueryClient() {
  const { queryClient } = (await import("../../client/src/lib/queryClient")) as any;
  return queryClient as import("@tanstack/react-query").QueryClient;
}

async function mountPage() {
  await renderPage(BankAccountsPage);
}

/** Fail the next refetch of every bank query while the cached rows stay in place. */
async function failRefresh(fixtures: Record<string, unknown>) {
  setFixtures(
    Object.fromEntries(Object.keys(fixtures).map((k) => [k, failing()])) as Record<string, unknown>
  );
  const qc = await appQueryClient();
  await act(async () => {
    await qc.invalidateQueries({ queryKey: ["/api/companies"] });
  });
  await flush();
}

describe("bank accounts offline and refresh states", { timeout: 90_000 }, () => {
  it("shows offline feedback, never the empty states, then loads once back online", async () => {
    onlineManager.setOnline(false);
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS, [IMPORTS_PATH]: [] });
    await mountPage();
    await flushUntil(() => byTestId("bank-accounts-offline") !== null);
    expect(byTestId("bank-accounts-offline")!.textContent).toContain("You are offline");
    expect(byTestId("bank-imports-offline")!.textContent).toContain("You are offline");
    expect(document.body.textContent).not.toContain("No bank accounts yet");
    expect(document.body.textContent).not.toContain("No imports yet");

    await act(async () => onlineManager.setOnline(true));
    await flushUntil(() => document.body.textContent?.includes("Operating") === true);
    expect(byTestId("bank-accounts-offline")).toBeNull();
    await flushUntil(() => document.body.textContent?.includes("No imports yet") === true);
    expect(document.body.textContent).toContain("No imports yet");
  });

  it("localizes offline feedback in Arabic", async () => {
    useI18n.setState({ locale: "ar" });
    onlineManager.setOnline(false);
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS });
    await mountPage();
    await flushUntil(() => byTestId("bank-accounts-offline") !== null);
    const text = byTestId("bank-accounts-offline")!.textContent ?? "";
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).not.toMatch(/[A-Za-z]/);
  });

  it("shows offline feedback for saved reconciliations instead of the empty state", async () => {
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS, [RECONCILIATIONS_PATH]: [] });
    await mount();
    onlineManager.setOnline(false);
    await click(document.querySelector('button[aria-label="Reconciliation statement"]'));
    const dialog = document.querySelector('[role="dialog"]')!;
    await flushUntil(() => byTestId("bank-history-offline") !== null);
    expect(dialog.textContent).toContain("You are offline");
    expect(dialog.textContent).not.toContain("No saved reconciliations yet");
    await act(async () => onlineManager.setOnline(true));
    await flushUntil(() => dialog.textContent?.includes("No saved reconciliations yet") === true);
    expect(byTestId("bank-history-offline")).toBeNull();
  });

  it("keeps cached accounts and imports with a retry when a background refresh fails", async () => {
    const batch = {
      id: "b1",
      bankAccountId: "a1",
      fileName: "march.csv",
      rowCount: 3,
      importedCount: 3,
      status: "completed",
      continuityWarning: null,
      createdAt: "2026-03-01T00:00:00Z",
      removedCount: null,
    };
    const good = { [`${C}/bank-accounts`]: ACCOUNTS, [IMPORTS_PATH]: [batch] };
    setFixtures(good);
    await mount();
    await flushUntil(() => document.body.textContent?.includes("march.csv") === true);

    await failRefresh(good);
    await flushUntil(() => byTestId("bank-accounts-refresh-error") !== null);
    expect(byTestId("bank-imports-refresh-error")).not.toBeNull();
    expect(byTestId("bank-accounts-error")).toBeNull();
    expect(document.body.textContent).toContain("Operating");
    expect(document.body.textContent).toContain("march.csv");
    expect(document.querySelector('button[aria-label="Undo import"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Reconciliation statement"]')).not.toBeNull();

    setFixtures(good);
    await click(buttonByText(/^Retry$/, byTestId("bank-accounts-refresh-error")!));
    await click(buttonByText(/^Retry$/, byTestId("bank-imports-refresh-error")!));
    await flushUntil(() => byTestId("bank-accounts-refresh-error") === null);
    expect(byTestId("bank-imports-refresh-error")).toBeNull();
    expect(document.body.textContent).toContain("Operating");
  });

  it("keeps cached empty data empty (with a retry) when the refresh fails", async () => {
    const good = { [`${C}/bank-accounts`]: [], [IMPORTS_PATH]: [] };
    setFixtures(good);
    await mount();
    await flushUntil(() => document.body.textContent?.includes("No imports yet") === true);
    await failRefresh(good);
    await flushUntil(() => byTestId("bank-imports-refresh-error") !== null);
    expect(byTestId("bank-accounts-error")).toBeNull();
    expect(document.body.textContent).toContain("No bank accounts yet");
    expect(document.body.textContent).toContain("No imports yet");
  });

  it("keeps saved reconciliations visible with a retry when their refresh fails", async () => {
    const row = {
      id: "r1",
      periodEnd: "2026-03-31",
      statementClosingBalance: 100,
      difference: 0,
      status: "draft",
      signedOffAt: null,
    };
    const good = { [`${C}/bank-accounts`]: ACCOUNTS, [RECONCILIATIONS_PATH]: [row] };
    setFixtures(good);
    await mount();
    await click(document.querySelector('button[aria-label="Reconciliation statement"]'));
    const dialog = document.querySelector('[role="dialog"]')!;
    await flushUntil(() => dialog.textContent?.includes("2026-03-31") === true);
    await failRefresh(good);
    await flushUntil(() => byTestId("bank-history-refresh-error") !== null);
    expect(dialog.textContent).toContain("2026-03-31");
    expect(buttonByText(/Sign off/, dialog)).not.toBeNull();
    expect(
      dialog.querySelector(`a[href="${C}/bank-reconciliations/r1/export?format=pdf"]`)
    ).not.toBeNull();
    setFixtures(good);
    await click(buttonByText(/^Retry$/, byTestId("bank-history-refresh-error")!));
    await flushUntil(() => byTestId("bank-history-refresh-error") === null);
    expect(dialog.textContent).toContain("2026-03-31");
  });

  it("scopes the search to its company when the company changes in place", async () => {
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS });
    await mount();
    await search("zzz");
    expect(document.body.textContent).toContain("No bank accounts match your search");
    // The no-match state keeps its search input reachable so the search can be cleared.
    expect(document.querySelector('[data-testid="input-search-bank-accounts"]')).not.toBeNull();

    const second = { ...COMPANY, id: "c0000000-0000-4000-8000-000000000002" };
    const third = { ...COMPANY, id: "c0000000-0000-4000-8000-000000000003" };
    const S = `/api/companies/${second.id}`;
    const T = `/api/companies/${third.id}`;

    // Switch straight to a company whose successful response is empty: the true empty view.
    setFixtures({
      [`${C}/bank-accounts`]: ACCOUNTS,
      [`${S}/bank-accounts`]: [],
      [`${T}/bank-accounts`]: [ACCOUNTS[1]],
    });
    setWorkspaceCompany(second);
    await rerenderPage(BankAccountsPage);
    await flushUntil(() => document.body.textContent?.includes("No bank accounts yet") === true);
    expect(document.body.textContent).toContain("No bank accounts yet");
    expect(document.body.textContent).not.toContain("No bank accounts match your search");

    // Move to a company with accounts: the first company's term is not applied there.
    setWorkspaceCompany(third);
    await rerenderPage(BankAccountsPage);
    await flushUntil(() => document.body.textContent?.includes("Savings") === true);
    expect(document.body.textContent).toContain("Savings");
    const input = document.querySelector(
      '[data-testid="input-search-bank-accounts"]'
    ) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain("No bank accounts match your search");
  });

  it("matches Arabic-Indic digits and Arabic spelling variants", async () => {
    const arabic = {
      ...ACCOUNTS[0],
      id: "a3",
      nameEn: "الحساب الجاري",
      bankName: "مصرف الإمارات",
      accountNumber: "7654",
    };
    setFixtures({ [`${C}/bank-accounts`]: [...ACCOUNTS, arabic] });
    await mount();

    await search("٧٦٥٤"); // Arabic-Indic digits for the account number 7654
    expect(document.body.textContent).toContain("الحساب الجاري");
    expect(document.body.textContent).not.toContain("Savings");

    await search("امارات"); // alef without hamza matches "الإمارات"
    expect(document.body.textContent).toContain("مصرف الإمارات");
    expect(document.body.textContent).not.toContain("Savings");

    await search("جاري");
    expect(document.body.textContent).toContain("الحساب الجاري");

    await search("زززز");
    expect(document.body.textContent).toContain("No bank accounts match your search");
  });
});

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
