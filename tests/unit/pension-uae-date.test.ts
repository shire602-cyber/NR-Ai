// @vitest-environment jsdom
/**
 * INTEGRATE-F: the pension payment's default date is the UAE calendar date (the date the
 * posting kernel uses), not the browser's UTC date. At 21:30 UTC on 17 Nov it is already
 * 01:30 on 18 Nov in the UAE; the UTC default (17 Nov) was a day early.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  apiCalls,
  byTestId,
  click,
  flush,
  formHarnessQueryClientMock,
  pickOption,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale } from "../../client/src/lib/i18n";
import { uaeToday } from "../../shared/uae-date";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());

beforeAll(async () => {
  await loadLocale("en");
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
});

afterEach(async () => {
  await unmountPage();
  resetHarness();
  vi.useRealTimers();
});

describe("pension payment date", () => {
  it("uaeToday is the Asia/Dubai calendar date", () => {
    expect(uaeToday(new Date("2026-11-17T21:30:00Z"))).toBe("2026-11-18");
    expect(uaeToday(new Date("2026-11-17T19:59:59Z"))).toBe("2026-11-17");
    expect(uaeToday(new Date("2026-11-17T20:00:00Z"))).toBe("2026-11-18");
  });

  it("the pay dialog defaults to the UAE date after 20:00 UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T21:30:00Z"));
    setFixtures({
      [`/api/companies/${COMPANY_ID}/payroll/pension-liability`]: {
        funds: [{ fund: "gpssa", accrued: "1500.00", paid: "0.00", outstanding: "1500.00" }],
        totalOutstanding: "1500.00",
      },
      [`/api/companies/${COMPANY_ID}/payroll/pension-payments`]: [],
      [`/api/companies/${COMPANY_ID}/accounts`]: [
        {
          id: "bank-1",
          code: "1020",
          nameEn: "Bank",
          type: "asset",
          subType: "bank",
          isActive: true,
        },
      ],
    });
    const { PensionTab } = await import("../../client/src/pages/payroll/PensionTab");
    await renderPage(PensionTab, { companyId: COMPANY_ID });
    await click(byTestId("button-pay-pension-gpssa"));
    await flush();
    await pickOption(document.getElementById("pension-account"), /1020/);
    await submit(document.querySelector('[role="dialog"] button[type="submit"]'));
    await flush();
    const post = apiCalls("POST").find((c) => c.url.endsWith("/payroll/pension-payments"));
    expect(post).toBeDefined();
    expect((post!.body as { paymentDate: string }).paymentDate).toBe("2026-11-18");
  });
});
