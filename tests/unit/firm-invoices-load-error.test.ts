// @vitest-environment jsdom
/**
 * Firm audit (2026-11-19) defect 6: when the invoices API fails the list shows an error state
 * with Retry, not zeroed status tiles and "0 invoices" (an accountant would read an empty
 * client). List only: the invoice editor is not touched.
 */
import { act } from "react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  unmountPage,
  COMPANY_ID,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";

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
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  resetHarness();
  window.localStorage.clear();
});
afterEach(async () => {
  await unmountPage();
  vi.mocked((await import("../../client/src/lib/queryClient")).apiRequest).mockReset();
});

describe("invoice list load failure", () => {
  it("shows an error state with Retry and no zero tiles or '0 invoices'", async () => {
    const qc = (await import("../../client/src/lib/queryClient")) as unknown as {
      apiRequest: ReturnType<typeof vi.fn>;
      ApiError: new (m: string) => Error;
    };
    const original = qc.apiRequest.getMockImplementation()!;
    qc.apiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "GET" && url.includes(`/api/companies/${COMPANY_ID}/invoices`)) {
        throw new qc.ApiError("Internal error injected");
      }
      return original(method, url, body);
    });
    setFixtures({});
    const { default: Invoices } = await import("../../client/src/pages/Invoices");
    await renderPage(Invoices);
    await flush(20);
    const text = document.body.textContent ?? "";
    expect(document.querySelector('[data-testid="invoices-load-error"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="invoice-status-tiles"]')).toBeNull();
    expect(text).not.toMatch(/\b0 invoices\b/);
    expect(text).not.toContain("Internal error injected");
    const retry = [...document.querySelectorAll("button")].find((b) =>
      /try again/i.test(b.textContent ?? "")
    );
    expect(retry).toBeTruthy();
    await act(async () => retry!.click());
  });

  it("shows waiting before the first read and identifies cached invoices during a paused refresh", async () => {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { default: Invoices } = await import("../../client/src/pages/Invoices");
    const { t } = await import("../../client/src/lib/i18n");
    const path = `/api/companies/${COMPANY_ID}/invoices`;
    setFixtures({
      [`${path}?all=true`]: [],
      [path]: {
        items: [
          {
            id: "i-1",
            number: "INV-1",
            customerName: "Palm Co",
            status: "sent",
            total: 100,
            currency: "AED",
            invoiceType: "invoice",
          },
        ],
        nextCursor: null,
      },
    });
    const state = (id: string) => document.querySelector(`[data-testid="${id}"]`);
    const wasOnline = onlineManager.isOnline();
    onlineManager.setOnline(false);
    try {
      await renderPage(Invoices);
      expect(state("invoices-waiting")?.textContent).toBe(t.en["banking.query.paused"]);
      expect(state("invoices-loading")).toBeNull();

      await act(async () => onlineManager.setOnline(true));
      await flush();
      expect(state("invoices-waiting")).toBeNull();
      expect(state("mobile-invoice-list")?.textContent).toContain("Palm Co");

      await act(async () => {
        onlineManager.setOnline(false);
        void queryClient.refetchQueries({ queryKey: ["/api/companies", COMPANY_ID, "invoices"] });
      });
      await flush();
      expect(state("invoices-paused-cached")?.textContent).toBe(t.en["banking.query.pausedCached"]);
      expect(state("mobile-invoice-list")?.textContent).toContain("Palm Co");
    } finally {
      await act(async () => onlineManager.setOnline(wasOnline));
    }
  });
});
