// @vitest-environment jsdom
/**
 * Journal list states: a failed load shows a retryable error (not "No journal entries yet"),
 * and the drafts-only filter has its own empty copy instead of the first-entry prompt.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { onlineManager } from "@tanstack/react-query";
import {
  COMPANY,
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
  setWorkspaceCompany,
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

const KEY = ["/api/companies", COMPANY_ID, "journal"];
const ROW = { id: "j1", status: "posted", lifecycleStatus: "posted", lines: [] };
const fixtureKey = `/api/companies/${COMPANY_ID}/journal`;
const fetchStatusOf = () => queryClient.getQueryState(KEY)?.fetchStatus;

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
  // Unmount first so resetting the online state cannot update a mounted tree.
  await unmountPage();
  // Drop the per-key failing queryFn so later tests use the harness fixtures.
  queryClient.setQueryDefaults(KEY, {});
  onlineManager.setOnline(true);
  window.history.replaceState({}, "", "/");
});

describe("journal list", { timeout: 60_000 }, () => {
  it("shows a retryable error, not the empty state, then recovers when Retry is clicked", async () => {
    let calls = 0;
    queryClient.setQueryDefaults(KEY, {
      queryFn: async () => {
        calls += 1;
        if (calls === 1) throw new Error("Failed to fetch");
        return [ROW];
      },
    });
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!byTestId("journal-load-error"));
    expect(byTestId("journal-load-error")).toBeTruthy();
    expect(byTestId("empty-state-journal")).toBeFalsy();
    // The button label comes from the lazily loaded "firm" locale namespace, so wait for it.
    const retryButton = () => {
      const error = byTestId("journal-load-error");
      return error ? buttonByText(/^Try again$/i, error) : null;
    };
    await flushUntil(() => !!retryButton());
    const retry = retryButton();
    expect(retry).toBeTruthy();
    await click(retry);
    await flushUntil(() => !!byTestId("button-proof-journal-j1"));
    expect(byTestId("button-proof-journal-j1")).toBeTruthy();
    expect(calls).toBe(2);
    expect(byTestId("journal-load-error")).toBeFalsy();
    expect(byTestId("empty-state-journal")).toBeFalsy();
  });

  it("shows one neutral paused status, with no empty state, while the first load is paused", async () => {
    onlineManager.setOnline(false);
    setFixtures({ [fixtureKey]: [ROW] });
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!byTestId("journal-paused"));
    expect(fetchStatusOf()).toBe("paused");
    expect(byTestId("journal-paused")?.textContent).toContain("paused");
    expect(byTestId("empty-state-journal")).toBeFalsy();
    expect(byTestId("journal-load-error")).toBeFalsy();
    expect(byTestId("button-proof-journal-j1")).toBeFalsy();
    // Back online: the paused query resumes by itself and the rows appear.
    onlineManager.setOnline(true);
    await flushUntil(() => !!byTestId("button-proof-journal-j1"));
    expect(byTestId("button-proof-journal-j1")).toBeTruthy();
    expect(byTestId("journal-paused")).toBeFalsy();
  });

  it("keeps cached rows visible, without an error or empty state, when a refresh fails", async () => {
    let calls = 0;
    queryClient.setQueryDefaults(KEY, {
      queryFn: async () => {
        calls += 1;
        if (calls === 1) return [ROW];
        throw new Error("Failed to fetch");
      },
    });
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!byTestId("button-proof-journal-j1"));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: KEY }).catch(() => undefined);
    });
    await flush();
    expect(calls).toBe(2);
    expect(queryClient.getQueryState(KEY)?.status).toBe("error");
    expect(byTestId("button-proof-journal-j1")).toBeTruthy();
    expect(byTestId("journal-load-error")).toBeFalsy();
    expect(byTestId("empty-state-journal")).toBeFalsy();
  });

  it("shows the paused status, not the empty state, when a refresh of cached empty results pauses", async () => {
    setFixtures({ [fixtureKey]: [] });
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!byTestId("empty-state-journal"));
    onlineManager.setOnline(false);
    await act(async () => {
      void queryClient.refetchQueries({ queryKey: KEY });
    });
    await flushUntil(() => !!byTestId("journal-paused"));
    expect(fetchStatusOf()).toBe("paused");
    expect(byTestId("empty-state-journal")).toBeFalsy();
    expect(byTestId("journal-load-error")).toBeFalsy();
  });

  it("shows neutral copy and fetches nothing while no company is selected", async () => {
    setWorkspaceCompany({ ...COMPANY, id: "" });
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!byTestId("journal-waiting-company"));
    expect(byTestId("journal-waiting-company")?.textContent).toContain(
      "will appear when a company is selected"
    );
    expect(byTestId("empty-state-journal")).toBeFalsy();
    expect(byTestId("journal-load-error")).toBeFalsy();
    // The journal query is disabled, so it stays idle (nothing loading, paused or failed).
    expect(queryClient.getQueryState(["/api/companies", "", "journal"])?.fetchStatus).toBe("idle");
  });

  it("uses draft-specific empty copy when the drafts filter matches nothing", async () => {
    setFixtures({ [fixtureKey]: [ROW] });
    window.history.replaceState({}, "", "/journal?status=draft");
    const { default: Journal } = await import("../../client/src/pages/Journal");
    await renderPage(Journal);
    await flushUntil(() => !!document.body.textContent?.includes("No draft entries"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("No draft entries");
    expect(text).not.toContain("No journal entries yet");
    expect(text).not.toContain("Every entry has been posted");
  });
});
