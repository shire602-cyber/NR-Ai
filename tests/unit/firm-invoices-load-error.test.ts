// @vitest-environment jsdom
/**
 * Firm audit (2026-11-19) defect 6: when the invoices API fails the list shows an error state
 * with Retry, not zeroed status tiles and "0 invoices" (an accountant would read an empty
 * client). List only: the invoice editor is not touched.
 */
import { act } from "react";
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
afterEach(unmountPage);

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
});
