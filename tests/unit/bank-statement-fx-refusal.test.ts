// @vitest-environment jsdom
/**
 * FX reconciliation guard (client): a foreign-currency account either shows its statement in the
 * account currency or the localized 409 FX_RECONCILIATION_UNSUPPORTED refusal, never AED figures.
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
const ACCOUNTS = [
  {
    id: "a2",
    nameEn: "Savings",
    bankName: "Mashreq",
    accountNumber: "222",
    iban: null,
    currency: "USD",
    glAccountId: "g2",
    isActive: true,
    openingBalance: 0,
    openingBalanceDate: null,
  },
];
const STATEMENT_PATH = `${C}/bank-accounts/a2/reconciliation-statement`;

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
  const { queryClient } = (await import("../../client/src/lib/queryClient")) as any;
  await queryClient.cancelQueries();
  queryClient.clear();
  useI18n.setState({ locale: "en" });
});

async function openAndPreview() {
  await renderPage(BankAccountsPage);
  await flushUntil(() => !!document.querySelector('button[aria-label="Reconciliation statement"]'));
  await click(document.querySelector('button[aria-label="Reconciliation statement"]'));
  await flushUntil(() => document.getElementById("st-close") !== null);
  const input = document.getElementById("st-close") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, "1050");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  const dialog = document.querySelector('[role="dialog"]')!;
  await click(buttonByText(/^Preview$/, dialog));
  return dialog;
}

describe("FX reconciliation guard (client)", { timeout: 90_000 }, () => {
  it("shows the refusal and no statement when the server answers FX_RECONCILIATION_UNSUPPORTED", async () => {
    const { ApiError } = (await import("../../client/src/lib/queryClient")) as any;
    const err = new ApiError("Not reconcilable in USD");
    err.status = 409;
    err.body = { code: "FX_RECONCILIATION_UNSUPPORTED" };
    const rejected = Promise.reject(err);
    rejected.catch(() => {});
    setFixtures({ [`${C}/bank-accounts`]: ACCOUNTS, [STATEMENT_PATH]: rejected });
    const dialog = await openAndPreview();
    await flushUntil(() => byTestId("bank-statement-fx-refusal") !== null);
    expect(byTestId("bank-statement-fx-refusal")!.textContent).toContain("Not reconcilable in USD");
    expect(dialog.textContent).not.toContain("Reconciled");
    expect(dialog.textContent).not.toContain("Amounts in");
  });

  it("labels the statement with the account currency", async () => {
    setFixtures({
      [`${C}/bank-accounts`]: ACCOUNTS,
      [STATEMENT_PATH]: {
        currency: "USD",
        differenceFils: 0,
        totals: {
          statementClosingBalance: "1050.00",
          depositsInTransit: "0.00",
          outstandingPayments: "0.00",
          adjustedBankBalance: "1050.00",
          glBalance: "1050.00",
          unrecordedReceipts: "0.00",
          unrecordedPayments: "0.00",
          adjustedBookBalance: "1050.00",
          difference: "0.00",
        },
        depositsInTransit: [],
        outstandingPayments: [],
        unrecordedReceipts: [],
        unrecordedPayments: [],
      },
    });
    const dialog = await openAndPreview();
    await flushUntil(() => dialog.textContent?.includes("Amounts in USD") === true);
    expect(byTestId("bank-statement-fx-refusal")).toBeNull();
  });
});
