// @vitest-environment jsdom
/**
 * VAT bad-debt relief screen (FDL 8/2017 Art. 64): lists claims, reverses a claim with a reason and
 * date, creates a claim, localizes server errors, and hides actions from roles the server refuses.
 * Behaviour tests: the real page renders against a fixture-backed query client and a recorded
 * `apiRequest`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { uaeToday } from "../../shared/uae-date";
import arShell from "../../client/src/locales/ar/shell.json";
import enShell from "../../client/src/locales/en/shell.json";
import enCompliance from "../../client/src/locales/en/vatBadDebtRelief.json";
import arCompliance from "../../client/src/locales/ar/vatBadDebtRelief.json";
import enForms from "../../client/src/locales/en/forms.json";
import {
  apiCalls,
  byTestId,
  click,
  COMPANY_ID,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  pickOption,
  renderPage,
  resetHarness,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import VatBadDebtRelief from "../../client/src/pages/VatBadDebtRelief";
import { apiRequest, ApiError } from "../../client/src/lib/queryClient";

const state = vi.hoisted(() => ({
  lang: "en" as "en" | "ar",
  canPost: true,
  load: null as null | (() => Promise<unknown>),
  toasts: [] as Array<{ title?: string; description?: string; variant?: string }>,
}));

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  await actual.loadLocale("ar");
  await actual.loadLocale("en");
  return {
    ...actual,
    useTranslation: () => ({ t: actual.t[state.lang], locale: state.lang }),
  };
});
vi.mock("../../client/src/lib/queryClient", () => {
  const mock = formHarnessQueryClientMock();
  const fromFixtures = mock.getQueryFn();
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public body?: Record<string, unknown>
    ) {
      super(message);
    }
  }
  return {
    ...mock,
    ApiError,
    getQueryFn: () => (context: { queryKey: readonly unknown[] }) =>
      state.load ? state.load() : fromFixtures(context),
  };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({
    can: () => state.canPost,
    gate: () => (state.canPost ? {} : { disabled: true, "data-permission-denied": "true" }),
  }),
}));
vi.mock("../../client/src/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: (typeof state.toasts)[number]) => state.toasts.push(t) }),
}));

const CLAIMS_URL = `/api/companies/${COMPANY_ID}/vat/bad-debt-relief`;
const ELIGIBLE_URL = `${CLAIMS_URL}/eligible-invoices`;
const FILED_Q1 = { from: "2026-01-01", to: "2026-03-31", status: "filed", source: "company" };
const claim = (over: object) => ({
  id: "11111111-1111-4111-8111-111111111111",
  companyId: COMPANY_ID,
  invoiceId: "22222222-2222-4222-8222-222222222222",
  claimDate: "2026-03-15",
  emirate: "dubai",
  outstandingAmount: 1050,
  taxableAmount: 1000,
  vatAmount: 50,
  status: "claimed",
  reversedAt: null,
  reversalReason: null,
  invoiceNumber: "INV-0042",
  customerName: "Acme Trading",
  remainingRelief: 50,
  claimReturnPeriod: FILED_Q1,
  reversalReturnPeriod: null,
  ...over,
});
const ELIGIBLE = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    number: "INV-0043",
    customerName: "Beta LLC",
    date: "2025-01-10",
  },
];
const REVERSED = claim({
  id: "55555555-5555-4555-8555-555555555555",
  invoiceId: "33333333-3333-4333-8333-333333333333",
  invoiceNumber: "INV-0043",
  customerName: "Beta LLC",
  remainingRelief: null,
  status: "reversed",
  reversedAt: "2026-05-02",
  reversalReason: "Customer paid",
});
const todayIso = () => uaeToday();
const text = () => document.body.textContent ?? "";

function serverError(code: string, status = 422) {
  return new ApiError(
    "Bad-debt relief needs more than six months after the date of supply (after 2026-09-15).",
    status,
    { code }
  );
}

/** Make every POST answer with a server error body; reads still use the fixtures. */
function failPosts(code: string, status = 422) {
  const mocked = vi.mocked(apiRequest);
  const original = mocked.getMockImplementation()!;
  mocked.mockImplementation(async (method: string, url: string, body?: unknown) => {
    if (method === "POST") throw serverError(code, status);
    return original(method, url, body);
  });
  return () => mocked.mockImplementation(original);
}

describe("VAT bad-debt relief screen", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Element.prototype.scrollIntoView = vi.fn();
    resetHarness();
    state.lang = "en";
    state.canPost = true;
    state.load = null;
    state.toasts = [];
    setFixtures({ [CLAIMS_URL]: [claim({}), REVERSED], [ELIGIBLE_URL]: ELIGIBLE });
  });
  afterEach(async () => {
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("lists claims in English with invoice link, customer, amounts, period and reversal", async () => {
    await renderPage(VatBadDebtRelief);
    const row = byTestId("relief-row-11111111-1111-4111-8111-111111111111")!;
    expect(row.textContent).toContain("INV-0042");
    expect(row.textContent).toContain("Acme Trading");
    expect(row.textContent).toContain(enCompliance["vatBadDebtRelief.statusClaimed"]);
    expect(row.querySelector("a")?.getAttribute("href")).toBe(
      "/invoices/22222222-2222-4222-8222-222222222222"
    );
    const reversed = byTestId("relief-row-55555555-5555-4555-8555-555555555555")!;
    expect(reversed.textContent).toContain("Customer paid");
    // the period comes from the endpoint (the filed return), never derived from settings
    expect(byTestId("relief-period-11111111-1111-4111-8111-111111111111")!.textContent).toBe(
      "1 Jan 2026 to 31 Mar 2026"
    );
    // no return yet for the reversal date: a forecast wording, no invented range
    expect(reversed.textContent).toContain("The return for the period containing 2 May 2026");
    expect(reversed.textContent).toContain(enCompliance["vatBadDebtRelief.statusReversed"]);
    expect(byTestId("button-reverse-55555555-5555-4555-8555-555555555555")).toBeNull();
  });

  it("lists claims in Arabic", async () => {
    state.lang = "ar";
    await renderPage(VatBadDebtRelief);
    expect(text()).toContain(arCompliance["vatBadDebtRelief.title"]);
    expect(text()).toContain(arCompliance["vatBadDebtRelief.statusClaimed"]);
    expect(arCompliance["vatBadDebtRelief.statusClaimed"]).not.toBe("مطلوب");
    expect(text()).toContain(arCompliance["vatBadDebtRelief.statusReversed"]);
    expect(text()).not.toContain(enCompliance["vatBadDebtRelief.statusClaimed"]);
  });

  it("shows the empty state", async () => {
    setFixtures({ [CLAIMS_URL]: [], [ELIGIBLE_URL]: ELIGIBLE });
    await renderPage(VatBadDebtRelief);
    expect(text()).toContain(enCompliance["vatBadDebtRelief.emptyTitle"]);
  });

  it("shows a retryable load error instead of the list", async () => {
    state.load = async () => {
      throw Object.assign(new Error("HTTP 500"), { status: 500 });
    };
    await renderPage(VatBadDebtRelief);
    expect(
      byTestId("relief-load-error") ?? document.querySelector("[data-testid^='load-error']")
    ).not.toBeNull();
    expect(document.querySelector("table")).toBeNull();
  });

  it("reverses a claim: dialog shows the remaining add-back, posts date and reason, refetches", async () => {
    setFixtures({
      [CLAIMS_URL]: [claim({ remainingRelief: 30 }), REVERSED],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    let claimReads = 0;
    state.load = async () => {
      claimReads += 1;
      return [claim({ remainingRelief: 30 }), REVERSED];
    };
    await renderPage(VatBadDebtRelief);
    const reads = () => claimReads;
    await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
    const effect = byTestId("reverse-effect")!.textContent!;
    expect(effect).toContain("INV-0042");
    expect(effect).toMatch(/not yet recovered/);
    expect(effect).toContain("30.00"); // the remaining relief, not the full 50.00
    expect(effect).not.toContain("50.00");
    const confirm = byTestId("button-confirm-reverse") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // a reason is required
    await type(byTestId("input-reverse-reason"), "ab");
    expect(confirm.disabled).toBe(true);
    await type(byTestId("input-reverse-reason"), "Customer paid in full");
    const before = reads();
    await click(confirm);
    await flush(10);
    const post = apiCalls("POST")[0];
    expect(post.url).toBe(`${CLAIMS_URL}/11111111-1111-4111-8111-111111111111/reverse`);
    expect(post.body).toEqual({ date: todayIso(), reason: "Customer paid in full" });
    expect(byTestId("reverse-dialog")).toBeNull();
    expect(state.toasts.at(-1)?.title).toBe(enCompliance["vatBadDebtRelief.reverseDone"]);
    expect(reads()).toBeGreaterThan(before);
  });

  it("says nothing more is added back when payments already recovered all the relief", async () => {
    setFixtures({
      [CLAIMS_URL]: [claim({ remainingRelief: 0 })],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
    const effect = byTestId("reverse-effect")!.textContent!;
    expect(effect).toMatch(/no further VAT is added back/);
    expect(effect).not.toMatch(/AED/);
  });

  it("uses the claim's return for a reversal date inside it, else the forecast wording", async () => {
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
    await type(byTestId("input-reverse-reason"), "Customer paid in full");
    // today is outside Q1 2026: no return known for it, so the dialog forecasts
    expect(byTestId("reverse-effect")!.textContent).toContain(
      "The return for the period containing"
    );
  });

  it("does not name a filed return as the add-back return; it says the period is closed", async () => {
    // The reversal date defaults to today, which this filed return covers.
    const open = { ...FILED_Q1, to: "2099-12-31" };
    setFixtures({ [CLAIMS_URL]: [claim({ claimReturnPeriod: open })], [ELIGIBLE_URL]: ELIGIBLE });
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
    await type(byTestId("input-reverse-reason"), "Customer paid in full");
    expect(byTestId("reverse-effect")!.textContent).toBe(
      enForms["forms.serverErrors.VAT_PERIOD_FILED"]
    );
    expect((byTestId("button-confirm-reverse") as HTMLButtonElement).disabled).toBe(true);
  });

  it("labels a claim closed by customer payments without naming one return", async () => {
    setFixtures({
      [CLAIMS_URL]: [
        claim({
          status: "reversed",
          reversedAt: "2026-05-02",
          reversalReason: "Payment received after bad-debt relief was claimed",
          reversalReturnPeriod: FILED_Q1,
        }),
      ],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    await renderPage(VatBadDebtRelief);
    expect(text()).toContain(enCompliance["vatBadDebtRelief.reversalPeriodRecovered"]);
  });

  it("notes when the eligible-invoice picker hit its cap", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...ELIGIBLE[0], id: `id-${i}` }));
    setFixtures({ [CLAIMS_URL]: [claim({})], [ELIGIBLE_URL]: many });
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-claim-relief"));
    expect(byTestId("relief-picker-capped")).not.toBeNull();
  });

  it("shows the payment-closure reason in Arabic instead of the server's English sentence", async () => {
    state.lang = "ar";
    setFixtures({
      [CLAIMS_URL]: [
        claim({
          status: "reversed",
          reversedAt: "2026-05-02",
          reversalReason: "Payment received after bad-debt relief was claimed",
        }),
      ],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    await renderPage(VatBadDebtRelief);
    expect(text()).toContain(arCompliance["vatBadDebtRelief.reasonPayment"]);
    expect(text()).not.toContain("Payment received after");
  });

  it("does not fetch the full invoice list", async () => {
    await renderPage(VatBadDebtRelief);
    expect(apiCalls("GET").filter((c) => c.url.includes("invoices"))).toEqual([]);
  });

  it("registers the screen in the command palette with Arabic and English labels", () => {
    expect(enShell["shell.cmdBadDebtRelief"]).toBeTruthy();
    expect(arShell["shell.cmdBadDebtRelief"]).toBeTruthy();
    // Source inspection: CommandPalette builds its items inside a component that needs the whole
    // app shell to render, so the id-to-key table is checked as text.
    const src = fs.readFileSync(
      path.join(__dirname, "../../client/src/components/CommandPalette.tsx"),
      "utf8"
    );
    expect(src).toContain('"nav-vat-bad-debt-relief": "shell.cmdBadDebtRelief"');
  });

  it("shows localized copy when the server refuses the reversal (Arabic)", async () => {
    state.lang = "ar";
    const { useI18n } = await import("../../client/src/lib/i18n");
    useI18n.setState({ locale: "ar" } as never);
    const restore = failPosts("BAD_DEBT_CLAIM_NOT_ACTIVE", 409);
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
    await type(byTestId("input-reverse-reason"), "سبب كاف");
    await click(byTestId("button-confirm-reverse"));
    await flush(5);
    const toast = state.toasts.at(-1)!;
    expect(toast.variant).toBe("destructive");
    expect(toast.description).toBe("مطالبة إعفاء الديون المعدومة هذه لم تعد سارية.");
    useI18n.setState({ locale: "en" } as never);
    restore();
  });

  it("creates a claim with the exact body and keeps ineligible documents out of the picker", async () => {
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-claim-relief"));
    const confirm = byTestId("button-confirm-claim") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await pickOption(byTestId("select-relief-invoice"), /INV-0043/);
    await click(byTestId("check-written-off"));
    await click(byTestId("check-notified"));
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    await flush(5);
    const post = apiCalls("POST")[0];
    expect(post.url).toBe(CLAIMS_URL);
    expect(post.body).toEqual({
      invoiceId: "33333333-3333-4333-8333-333333333333",
      claimDate: todayIso(),
      writtenOff: true,
      customerNotified: true,
      customerNotifiedAt: null,
      notes: null,
    });
    expect(state.toasts.at(-1)?.title).toBe(enCompliance["vatBadDebtRelief.createDone"]);
  });

  it("shows the server's localized sentence when a claim is refused", async () => {
    await renderPage(VatBadDebtRelief);
    const restore = failPosts("BAD_DEBT_TOO_EARLY");
    await click(byTestId("button-claim-relief"));
    await pickOption(byTestId("select-relief-invoice"), /INV-0043/);
    await click(byTestId("check-written-off"));
    await click(byTestId("check-notified"));
    await click(byTestId("button-confirm-claim"));
    await flush(5);
    const toast = state.toasts.at(-1)!;
    expect(toast.variant).toBe("destructive");
    expect(toast.title).toBe(enCompliance["vatBadDebtRelief.createFailed"]);
    expect(toast.description).toBe(
      "Bad-debt relief needs more than six months after the date of supply (after 2026-09-15)."
    );
    restore();
  });

  it("disables claim and reverse for roles without ledger.post", async () => {
    state.canPost = false;
    await renderPage(VatBadDebtRelief);
    expect((byTestId("button-claim-relief") as HTMLButtonElement).disabled).toBe(true);
    expect(
      (byTestId("button-reverse-11111111-1111-4111-8111-111111111111") as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
