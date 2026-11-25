// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesRuleSearch } from "../../client/src/lib/reconciliation-rule-search";
import ar from "../../client/src/locales/ar/banking.json";
import en from "../../client/src/locales/en/banking.json";
import {
  click,
  COMPANY_ID,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { ReconciliationRulesPanel } from "../../client/src/pages/ReconciliationRules";

const failing = { on: false };

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const banking = (await import("../../client/src/locales/ar/banking.json")).default;
  const firm = (await import("../../client/src/locales/ar/firm.json")).default;
  const pageLabels = (await import("../../client/src/locales/ar/pageLabels.json")).default;
  const pages = (await import("../../client/src/locales/ar/pages.json")).default;
  const dict = { ...pages, ...pageLabels, ...firm, ...banking } as Record<string, string>;
  return { ...actual, useTranslation: () => ({ t: dict, locale: "ar" }) };
});
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true, getRequiredTier: () => "pro" }),
}));
vi.mock("../../client/src/lib/queryClient", () => {
  const mock = formHarnessQueryClientMock();
  const original = mock.queryClient.getDefaultOptions().queries!.queryFn as any;
  mock.queryClient.setDefaultOptions({
    ...mock.queryClient.getDefaultOptions(),
    queries: {
      ...mock.queryClient.getDefaultOptions().queries,
      queryFn: async (ctx: any) => {
        if (failing.on && ctx.queryKey.at(-1) === "reconciliation-rules") {
          throw new Error("boom");
        }
        return original(ctx);
      },
    },
  });
  return mock;
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

const rulesUrl = `/api/companies/${COMPANY_ID}/reconciliation-rules`;
const rule = {
  id: "r1",
  companyId: COMPANY_ID,
  name: "Office rent",
  priority: 0,
  matchField: "description",
  matchType: "contains",
  matchValue: "RENT",
  accountId: null,
  vatTreatment: "none",
  requireReview: false,
  direction: "any",
  category: "Premises",
  memo: null,
  isActive: true,
  timesApplied: 2,
  createdAt: "2026-01-01",
};

describe("reconciliation rules screen", () => {
  afterEach(async () => {
    failing.on = false;
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("announces no matches, then restores rows and search focus on clear", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => !!document.querySelector("tbody"));

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toBe("");
    await act(async () => search.focus());
    await type(search, "zzz");

    expect(status?.textContent).toBe(ar["banking.rules.noMatchTitle"]);
    expect(document.querySelector("tbody")).toBeNull();
    expect(document.body.textContent).toContain(ar["banking.rules.noMatchBody"]);
    const clear = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === ar["banking.rules.clearSearch"]
    )!;
    await click(clear);
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(document.querySelector("tbody")?.textContent).toContain("Office rent");
  });

  it("shows a translated retryable error instead of the empty state when loading fails", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failing.on = true;
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => !!document.querySelector('[data-testid="rules-load-error"]'));
    expect(document.body.textContent).toContain(ar["banking.rules.loadErrorTitle"]);
    expect(document.body.textContent).not.toContain(ar["banking.rulesEmptyTitle"]);
  });

  it("localizes the match value placeholder in both languages", () => {
    expect(ar["banking.rules.matchValuePlaceholder"]).not.toBe(
      en["banking.rules.matchValuePlaceholder"]
    );
  });
});

describe("matchesRuleSearch", () => {
  const labels = { field: "الوصف", type: "يحتوي" };
  it("matches name, text, category and labels case-insensitively", () => {
    expect(matchesRuleSearch(rule, "", labels)).toBe(true);
    expect(matchesRuleSearch(rule, " office ", labels)).toBe(true);
    expect(matchesRuleSearch(rule, "rent", labels)).toBe(true);
    expect(matchesRuleSearch(rule, "premis", labels)).toBe(true);
    expect(matchesRuleSearch(rule, "الوصف", labels)).toBe(true);
    expect(matchesRuleSearch(rule, "zzz", labels)).toBe(false);
  });
});
