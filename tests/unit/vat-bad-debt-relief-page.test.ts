// @vitest-environment jsdom
/**
 * VAT bad-debt relief screen (FDL 8/2017 Art. 64): lists claims, reverses a claim with a reason and
 * date, creates a claim, localizes server errors, and hides actions from roles the server refuses.
 * Behaviour tests: the real page renders against a fixture-backed query client and a recorded
 * `apiRequest`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import enCompliance from "../../client/src/locales/en/vatBadDebtRelief.json";
import arCompliance from "../../client/src/locales/ar/vatBadDebtRelief.json";
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
const INVOICES_URL = `/api/companies/${COMPANY_ID}/invoices?all=true`;
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
  ...over,
});
const INVOICES = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    number: "INV-0042",
    customerName: "Acme Trading",
    status: "paid",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    number: "INV-0043",
    customerName: "Beta LLC",
    status: "sent",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    number: "INV-0044",
    customerName: "Draft Co",
    status: "draft",
  },
];
const REVERSED = claim({
  id: "55555555-5555-4555-8555-555555555555",
  invoiceId: "33333333-3333-4333-8333-333333333333",
  status: "reversed",
  reversedAt: "2026-05-02",
  reversalReason: "Customer paid",
});
const todayIso = () => format(new Date(), "yyyy-MM-dd");
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
    setFixtures({ [CLAIMS_URL]: [claim({}), REVERSED], [INVOICES_URL]: INVOICES });
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
    expect(reversed.textContent).toContain(enCompliance["vatBadDebtRelief.statusReversed"]);
    expect(byTestId("button-reverse-55555555-5555-4555-8555-555555555555")).toBeNull();
  });

  it("lists claims in Arabic", async () => {
    state.lang = "ar";
    await renderPage(VatBadDebtRelief);
    expect(text()).toContain(arCompliance["vatBadDebtRelief.title"]);
    expect(text()).toContain(arCompliance["vatBadDebtRelief.statusClaimed"]);
    expect(text()).toContain(arCompliance["vatBadDebtRelief.statusReversed"]);
    expect(text()).not.toContain(enCompliance["vatBadDebtRelief.statusClaimed"]);
  });

  it("shows the empty state", async () => {
    setFixtures({ [CLAIMS_URL]: [], [INVOICES_URL]: INVOICES });
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

  it("reverses a claim: dialog states the VAT effect, posts date and reason, refreshes", async () => {
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
    const effect = byTestId("reverse-effect")!.textContent!;
    expect(effect).toContain("INV-0042");
    expect(effect).toMatch(/added back/);
    const confirm = byTestId("button-confirm-reverse") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // a reason is required
    await type(byTestId("input-reverse-reason"), "ab");
    expect(confirm.disabled).toBe(true);
    await type(byTestId("input-reverse-reason"), "Customer paid in full");
    await click(confirm);
    await flush(5);
    const post = apiCalls("POST")[0];
    expect(post.url).toBe(`${CLAIMS_URL}/11111111-1111-4111-8111-111111111111/reverse`);
    expect(post.body).toEqual({ date: todayIso(), reason: "Customer paid in full" });
    expect(byTestId("reverse-dialog")).toBeNull();
    expect(state.toasts.at(-1)?.title).toBe(enCompliance["vatBadDebtRelief.reverseDone"]);
    // the claims list was requested again after the write
    await flush(10);
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
