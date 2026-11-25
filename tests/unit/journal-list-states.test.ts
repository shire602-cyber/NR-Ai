// @vitest-environment jsdom
/**
 * Journal list states: a failed load shows a retryable error (not "No journal entries yet"),
 * and the drafts-only filter has its own empty copy instead of the first-entry prompt.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  byTestId,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
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
  queryClient.clear();
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  // Drop the per-key failing queryFn so later tests use the harness fixtures.
  queryClient.setQueryDefaults(["/api/companies", COMPANY_ID, "journal"], {});
  await unmountPage();
  window.history.replaceState({}, "", "/");
});

describe("journal list", { timeout: 60_000 }, () => {
  it("shows a retryable error, not the empty state, when the load fails", async () => {
    queryClient.setQueryDefaults(["/api/companies", COMPANY_ID, "journal"], {
      queryFn: async () => {
        throw new Error("Failed to fetch");
      },
    });
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!byTestId("journal-load-error"));
    expect(byTestId("journal-load-error")).toBeTruthy();
    expect(byTestId("empty-state-journal")).toBeFalsy();
  });

  it("uses draft-specific empty copy when the drafts filter matches nothing", async () => {
    setFixtures({
      [`/api/companies/${COMPANY_ID}/journal`]: [
        { id: "j1", status: "posted", lifecycleStatus: "posted", lines: [] },
      ],
    });
    window.history.replaceState({}, "", "/journal?status=draft");
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!document.body.textContent?.includes("No draft entries"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("No draft entries");
    expect(text).not.toContain("No journal entries yet");
  });
});
