// @vitest-environment jsdom
/**
 * E1 (J1-r2 / J2-r2) rendered behaviour the E1 worker left untested (added by INTEGRATE-G):
 * the dashboard's bank-vs-ledger difference reason, the Receipts header with automatic reading
 * off, the onboarding TRN rule (15 digits starting with 100) and the quote customer picker.
 * The AP average payment rule is a server rule: tests/db/e1-launch-fixes.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  apiCalls,
  buttonByText,
  byTestId,
  click,
  editorPage,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  pickOption,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, t as catalogs, useI18n } from "../../client/src/lib/i18n";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
// Onboarding follows the ACTIVE company; a company with no TRN yet starts at "VAT registered?".
vi.mock("../../client/src/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({
    company: { id: "c0000000-0000-4000-8000-000000000001", name: "New Trading", emirate: "dubai" },
    isLoading: false,
  }),
}));
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
const en = () => catalogs.en as Record<string, string>;
const ar = () => catalogs.ar as Record<string, string>;

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
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
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  await unmountPage();
});

describe("E1 dashboard: why the bank does not tie to the ledger", () => {
  const stats = (difference: number) =>
    ({
      cashInOut: [],
      bankVsGl: {
        glCashTotal: 0,
        statementTotal: 0,
        accounts: [
          {
            bankAccountId: "b1",
            name: "Emirates NBD",
            currency: "AED",
            hasStatement: true,
            statementBalance: 1000 + difference,
            glBalance: 1000,
            // dashboard-stats: difference = statement balance - ledger balance.
            difference,
          },
        ],
      },
    }) as never;
  const reason = () => byTestId("bank-vs-gl-reason-b1");

  async function renderCash(difference: number) {
    const { CashMovement } = await import("../../client/src/pages/dashboard/PlanningWidgets");
    await renderPage(CashMovement, { stats: stats(difference), loading: false, locale: "en" });
  }

  it("statement above the books: the money is on the statement but not booked yet", async () => {
    await renderCash(250);
    const text = reason()?.textContent ?? "";
    expect(text).toContain(en()["dashboard.bankDiffStatementAhead"].split("{amount}")[1].trim());
    expect(text).toMatch(/250\.00/);
    expect(text).not.toMatch(/-250/);
    const link = reason()!.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/bank-reconciliation");
    expect(link.textContent).toBe(en()["dashboard.bankDiffReview"]);
  });

  it("books above the statement: posted entries the bank has not shown yet", async () => {
    await renderCash(-75.5);
    const text = reason()?.textContent ?? "";
    expect(text).toContain(en()["dashboard.bankDiffBooksAhead"].split("{amount}")[1].trim());
    expect(text).toMatch(/75\.50/);
  });

  it("a tying account shows no reason; Arabic copy is used in Arabic", async () => {
    await renderCash(0);
    expect(reason()).toBeNull();
    await unmountPage();
    useI18n.setState({ locale: "ar" });
    await renderCash(250);
    const text = reason()?.textContent ?? "";
    expect(text).toContain(ar()["dashboard.bankDiffReview"]);
    expect(text).not.toContain(en()["dashboard.bankDiffReview"]);
  });
});

describe("E1 Receipts header follows automatic reading", () => {
  async function header(aiConfigured: boolean) {
    setFixtures({ "/api/ocr/status": { aiConfigured } });
    const { default: Receipts } = await import("../../client/src/pages/Receipts");
    await renderPage(Receipts);
    await flush();
    return document.body.textContent ?? "";
  }

  it("with automatic reading off the subtitle does not promise AI extraction", async () => {
    const text = await header(false);
    expect(text).toContain(en()["pages.receiptsSubtitleManual"]);
    expect(text).not.toContain(en().receiptScannerSubtitle);
  });

  it("with automatic reading on the AI subtitle stays", async () => {
    const text = await header(true);
    expect(text).toContain(en().receiptScannerSubtitle);
    expect(text).not.toContain(en()["pages.receiptsSubtitleManual"]);
  });
});

describe("E1 onboarding: a UAE TRN is 15 digits starting with 100", () => {
  async function saveWithTrn(trn: string) {
    const { default: Onboarding } = await import("../../client/src/pages/Onboarding");
    await renderPage(Onboarding);
    await click(byTestId("express-vat-yes"));
    await type(byTestId("express-trn"), trn);
    await click(byTestId("onboarding-express"));
    await flush(5);
    return apiCalls().filter((c) => c.method === "PATCH" || c.method === "POST");
  }

  it("refuses 15 digits that do not start with 100, with the prefix message", async () => {
    const writes = await saveWithTrn("200000000000003");
    expect(writes).toHaveLength(0);
    expect(document.body.textContent).toContain(en()["forms.errors.uaeTrnPrefix100"]);
  });

  it("refuses a short TRN with the 15-digit message", async () => {
    const writes = await saveWithTrn("1000000003");
    expect(writes).toHaveLength(0);
    expect(document.body.textContent).toContain(en()["forms.errors.uaeTrn15Digits"]);
    expect(document.body.textContent).not.toContain(en()["forms.errors.uaeTrnPrefix100"]);
  });

  it("saves a TRN that starts with 100", async () => {
    const writes = await saveWithTrn("100000000000003");
    const patch = writes.find((c) => c.url === `/api/companies/${COMPANY_ID}`);
    expect(patch, JSON.stringify(apiCalls())).toBeTruthy();
    expect(patch!.body).toMatchObject({ trnVatNumber: "100000000000003" });
  });
});

describe("E1 quote form: the customer comes from the contact picker", () => {
  it("choosing a contact fills the name and TRN (read-only) and sends contactId", async () => {
    const contactId = "e0000000-0000-4000-8000-000000000001";
    setFixtures({
      [`${C}/customer-contacts`]: [
        { id: contactId, name: "Harbor Design Studio", trnNumber: "100234567800003" },
        { id: "e0000000-0000-4000-8000-000000000002", name: "Noor Retail", trnNumber: null },
      ],
    });
    const { default: Quotes } = await import("../../client/src/pages/Quotes");
    await renderPage(Quotes);
    await click(buttonByText(/new quote/i));
    const named = (n: string) => editorPage().querySelector<HTMLInputElement>(`[name="${n}"]`)!;
    expect(named("customerName").readOnly).toBe(true);
    await pickOption(byTestId("select-quote-contact"), "Harbor Design Studio");
    expect(named("customerName").value).toBe("Harbor Design Studio");
    expect(named("customerTrn").value).toBe("100234567800003");
    await type(named("lines.0.description"), "Brand workshop");
    const numbers = [...editorPage().querySelectorAll('input[type="number"]')];
    await type(numbers[0], "2");
    await type(numbers[1], "100");
    await submit(editorPage().querySelector('button[type="submit"]'));
    const post = apiCalls("POST").find((c) => c.url === `${C}/quotes`);
    expect(post, JSON.stringify(apiCalls())).toBeTruthy();
    expect(post!.body).toMatchObject({
      contactId,
      customerName: "Harbor Design Studio",
      customerTrn: "100234567800003",
      lines: [{ quantity: 2, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" }],
    });
  });
});
