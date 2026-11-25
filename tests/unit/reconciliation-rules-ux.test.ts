// @vitest-environment jsdom
import { act, createElement } from "react";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesRuleSearch } from "../../client/src/lib/reconciliation-rule-search";
import ar from "../../client/src/locales/ar/reconciliationRules.json";
import en from "../../client/src/locales/en/reconciliationRules.json";
import arCommon from "../../client/src/locales/ar/common.json";
import arFirm from "../../client/src/locales/ar/firm.json";
import arHr from "../../client/src/locales/ar/hr.json";
import {
  buttonByText,
  byTestId,
  click,
  COMPANY_ID,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  rerenderPage,
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
  const common = (await import("../../client/src/locales/ar/common.json")).default;
  const hr = (await import("../../client/src/locales/ar/hr.json")).default;
  const rules = (await import("../../client/src/locales/ar/reconciliationRules.json")).default;
  const dict = {
    ...common,
    ...hr,
    ...pages,
    ...pageLabels,
    ...firm,
    ...banking,
    ...rules,
  } as Record<string, string>;
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
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
    await setRetries(false);
    vi.unstubAllGlobals();
  });

  // The harness never retries; a retry is what pauses while the tab is in the background.
  const setRetries = async (retry: number | false) => {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    queryClient.setQueryDefaults(["/api/companies", COMPANY_ID, "reconciliation-rules"], {
      retry,
      retryDelay: 0,
    });
  };
  const setFocused = async (focused: boolean) => {
    await act(async () => focusManager.setFocused(focused));
  };

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

  const retryButton = () => buttonByText(new RegExp(`^${arFirm["firm.retry"]}$`));
  const rows = () => document.querySelector("tbody")?.textContent ?? "";
  const refetchRules = async () => {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      void queryClient.refetchQueries({
        queryKey: ["/api/companies", COMPANY_ID, "reconciliation-rules"],
        exact: true,
      });
    });
  };
  const setOnline = async (online: boolean) => {
    await act(async () => onlineManager.setOnline(online));
  };

  it("keeps cached rows with a retryable warning when a background refresh fails", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => !!document.querySelector("tbody"));

    failing.on = true;
    await refetchRules();
    await flushUntil(() => !!byTestId("rules-refresh-warning"));
    expect(byTestId("rules-refresh-warning")?.textContent).toContain(arHr["hr.refreshFailed"]);
    expect(rows()).toContain("Office rent");
    expect(byTestId("rules-load-error")).toBeNull();

    failing.on = false;
    setFixtures({ [rulesUrl]: [{ ...rule, name: "Warehouse rent" }] });
    await click(retryButton());
    await flushUntil(() => !byTestId("rules-refresh-warning"));
    expect(byTestId("rules-refresh-warning")).toBeNull();
    expect(rows()).toContain("Warehouse rent");
  });

  it("drops Retry while a refresh retry is paused and recovers on reconnection", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => !!document.querySelector("tbody"));
    failing.on = true;
    await refetchRules();
    await flushUntil(() => !!byTestId("rules-refresh-warning"));

    failing.on = false;
    await setOnline(false);
    await click(retryButton());
    expect(retryButton()).toBeNull();
    expect(byTestId("rules-refresh-warning")?.textContent).toContain(
      ar["banking.rules.offlineBody"]
    );
    expect(byTestId("rules-refresh-warning")?.textContent).toContain(
      arCommon["common.errorHeading.offline"]
    );
    expect(byTestId("rules-refresh-warning")?.textContent).not.toContain(arHr["hr.refreshFailed"]);
    expect(rows()).toContain("Office rent");

    await setOnline(true);
    await flushUntil(() => !byTestId("rules-refresh-warning"));
    expect(byTestId("rules-refresh-warning")).toBeNull();
    expect(rows()).toContain("Office rent");
  });

  it("shows connection guidance over stale cached rows when reopened offline", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const Tab = ({ open = true }: { open?: boolean }) =>
      open ? createElement(ReconciliationRulesPanel) : null;
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(Tab);
    await flushUntil(() => !!document.querySelector("tbody"));

    // Leave the tab, let the cache go stale, lose the connection, then come back.
    await rerenderPage(Tab, { open: false });
    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/companies", COMPANY_ID, "reconciliation-rules"],
        exact: true,
      });
    });
    await setOnline(false);
    setFixtures({ [rulesUrl]: [{ ...rule, name: "Warehouse rent" }] });
    await rerenderPage(Tab, { open: true });

    const warning = byTestId("rules-refresh-warning");
    expect(warning?.textContent).toContain(arCommon["common.errorHeading.offline"]);
    expect(warning?.textContent).toContain(ar["banking.rules.offlineBody"]);
    expect(warning?.textContent).not.toContain(arHr["hr.refreshFailed"]);
    expect(rows()).toContain("Office rent");
    expect(retryButton()).toBeNull();
    expect(byTestId("rules-offline")).toBeNull();
    expect(byTestId("rules-load-error")).toBeNull();

    await setOnline(true);
    await flushUntil(() => rows().includes("Warehouse rent"));
    expect(rows()).toContain("Warehouse rent");
    expect(byTestId("rules-refresh-warning")).toBeNull();
  });

  it("shows connection guidance, not an empty state, while the first load is paused", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await setOnline(false);
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);

    expect(byTestId("rules-offline")?.textContent).toContain(
      arCommon["common.errorHeading.offline"]
    );
    expect(byTestId("rules-offline")?.textContent).toContain(ar["banking.rules.offlineBody"]);
    expect(document.body.textContent).not.toContain(ar["banking.rulesEmptyTitle"]);
    expect(byTestId("button-add-rule")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(retryButton()).toBeNull();

    await setOnline(true);
    await flushUntil(() => !!document.querySelector("tbody"));
    expect(rows()).toContain("Office rent");
    expect(byTestId("rules-offline")).toBeNull();
    expect(byTestId("button-add-rule")).not.toBeNull();
  });

  it("shows neutral waiting copy while an online first-load retry waits for the tab", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await setRetries(1);
    failing.on = true;
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => !!byTestId("rules-load-error"));

    await setFocused(false);
    await click(retryButton());
    await flushUntil(() => !!byTestId("rules-waiting"));
    const waiting = byTestId("rules-waiting");
    expect(waiting?.textContent).toContain(ar["banking.rules.waitingTitle"]);
    expect(waiting?.textContent).toContain(ar["banking.rules.waitingBody"]);
    expect(document.body.textContent).not.toContain(arCommon["common.errorHeading.offline"]);
    expect(document.body.textContent).not.toContain(ar["banking.rules.offlineBody"]);
    expect(document.body.textContent).not.toContain(ar["banking.rulesEmptyTitle"]);
    expect(byTestId("rules-load-error")).toBeNull();
    expect(byTestId("rules-offline")).toBeNull();
    expect(byTestId("button-add-rule")).toBeNull();
    expect(retryButton()).toBeNull();

    // Losing the connection while paused switches to the offline copy, and back again.
    await setOnline(false);
    expect(byTestId("rules-offline")?.textContent).toContain(ar["banking.rules.offlineBody"]);
    expect(byTestId("rules-waiting")).toBeNull();
    await setOnline(true);
    expect(byTestId("rules-waiting")).not.toBeNull();

    failing.on = false;
    await setFocused(true);
    await flushUntil(() => !!document.querySelector("tbody"));
    expect(rows()).toContain("Office rent");
    expect(byTestId("rules-waiting")).toBeNull();
    expect(byTestId("button-add-rule")).not.toBeNull();
  });

  it("keeps cached rows while an online refresh retry waits for the tab", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await setRetries(1);
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => !!document.querySelector("tbody"));
    failing.on = true;
    await refetchRules();
    await flushUntil(() => !!retryButton());

    await setFocused(false);
    await click(retryButton());
    await flushUntil(
      () =>
        !!byTestId("rules-refresh-warning")?.textContent?.includes(ar["banking.rules.waitingTitle"])
    );
    const warning = byTestId("rules-refresh-warning");
    expect(warning?.textContent).toContain(ar["banking.rules.waitingTitle"]);
    expect(warning?.textContent).toContain(ar["banking.rules.waitingBody"]);
    expect(warning?.textContent).not.toContain(arCommon["common.errorHeading.offline"]);
    expect(warning?.textContent).not.toContain(ar["banking.rules.offlineBody"]);
    expect(warning?.textContent).not.toContain(arHr["hr.refreshFailed"]);
    expect(retryButton()).toBeNull();
    expect(rows()).toContain("Office rent");

    failing.on = false;
    setFixtures({ [rulesUrl]: [{ ...rule, name: "Warehouse rent" }] });
    await setFocused(true);
    await flushUntil(() => rows().includes("Warehouse rent"));
    expect(rows()).toContain("Warehouse rent");
    expect(byTestId("rules-refresh-warning")).toBeNull();
  });

  it("shows the empty state only once an empty response has arrived", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setFixtures({ [rulesUrl]: [] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => document.body.textContent!.includes(ar["banking.rulesEmptyTitle"]));
    expect(document.body.textContent).toContain(ar["banking.rulesEmptyTitle"]);
  });

  it("shows a translated retryable error instead of the empty state when loading fails", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failing.on = true;
    setFixtures({ [rulesUrl]: [rule] });
    await renderPage(ReconciliationRulesPanel);
    await flushUntil(() => !!document.querySelector('[data-testid="rules-load-error"]'));
    expect(document.body.textContent).toContain(ar["banking.rules.loadErrorTitle"]);
    expect(document.body.textContent).not.toContain(ar["banking.rulesEmptyTitle"]);

    failing.on = false;
    await click(retryButton());
    await flushUntil(() => !!document.querySelector("tbody"));
    expect(rows()).toContain("Office rent");
    expect(byTestId("rules-load-error")).toBeNull();
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
