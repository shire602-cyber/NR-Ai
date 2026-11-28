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
import arForms from "../../client/src/locales/ar/forms.json";
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
const ELIGIBLE_URL = `${CLAIMS_URL}/eligible-invoices`;
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
    // neutral wording naming the date; the server, not the screen, decides the return
    expect(byTestId("relief-period-11111111-1111-4111-8111-111111111111")!.textContent).toBe(
      "Reported in the VAT return for the period containing 15 Mar 2026"
    );
    expect(reversed.textContent).toContain(
      "Reported in the VAT return for the period containing 2 May 2026"
    );
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
    expect(text()).toContain(arCompliance["vatBadDebtRelief.periodNeutral"].replace("{date}", ""));
  });

  const FILED_Q3 = { from: "2026-07-01", to: "2026-09-30", status: "filed", source: "company" };
  const CLAIM_ID = "11111111-1111-4111-8111-111111111111";
  const REVERSED_ID = "55555555-5555-4555-8555-555555555555";

  it("names the exact VAT return and its status for a claim and for a reversal (English)", async () => {
    setFixtures({
      [CLAIMS_URL]: [
        claim({ claimReturn: FILED_Q3 }),
        {
          ...REVERSED,
          claimReturn: { ...FILED_Q3, status: "open" },
          reversalReturns: [
            { from: "2026-04-01", to: "2026-06-30", status: "amendment", source: "company" },
          ],
        },
      ],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    await renderPage(VatBadDebtRelief);
    expect(byTestId(`relief-period-${CLAIM_ID}`)!.textContent).toBe(
      "VAT return 1 Jul 2026–30 Sep 2026 (filed)"
    );
    expect(byTestId(`relief-period-${REVERSED_ID}`)!.textContent).toBe(
      "VAT return 1 Jul 2026–30 Sep 2026 (open)"
    );
    expect(byTestId(`relief-reversal-period-${REVERSED_ID}`)!.textContent).toBe(
      "VAT return 1 Apr 2026–30 Jun 2026 (under amendment)"
    );
  });

  it("marks a return that is only a forecast and lists each add-back return of a payment-closed claim", async () => {
    setFixtures({
      [CLAIMS_URL]: [
        claim({
          status: "reversed",
          reversedAt: "2026-10-01",
          reversalReason: "Payment received after bad-debt relief was claimed",
          claimReturn: {
            from: "2026-07-01",
            to: "2026-09-30",
            status: "forecast",
            source: "forecast",
          },
          reversalReturns: [
            { from: "2026-07-01", to: "2026-09-30", status: "filed", source: "company" },
            { from: "2026-10-01", to: "2026-12-31", status: "forecast", source: "forecast" },
          ],
        }),
      ],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    await renderPage(VatBadDebtRelief);
    expect(byTestId(`relief-period-${CLAIM_ID}`)!.textContent).toBe(
      "VAT return 1 Jul 2026–30 Sep 2026 (forecast, no return recorded yet)"
    );
    const cell = byTestId(`relief-reversal-period-${CLAIM_ID}`)!.textContent!;
    expect(cell).toContain(enCompliance["vatBadDebtRelief.reversalRecoveredLead"]);
    expect(cell).toContain("VAT return 1 Jul 2026–30 Sep 2026 (filed)");
    expect(cell).toContain("VAT return 1 Oct 2026–31 Dec 2026 (forecast, no return recorded yet)");
  });

  it("does not gate the reverse button on the return status (the server owns locks)", async () => {
    setFixtures({
      [CLAIMS_URL]: [claim({ claimReturn: FILED_Q3 })],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    await renderPage(VatBadDebtRelief);
    const button = byTestId(`button-reverse-${CLAIM_ID}`) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("names the exact VAT return and its status in Arabic with no English left over", async () => {
    state.lang = "ar";
    setFixtures({
      [CLAIMS_URL]: [
        claim({ claimReturn: { ...FILED_Q3, status: "amendment" } }),
        {
          ...REVERSED,
          claimReturn: FILED_Q3,
          reversalReturns: [
            { from: "2026-10-01", to: "2026-12-31", status: "open", source: "company" },
          ],
        },
      ],
      [ELIGIBLE_URL]: ELIGIBLE,
    });
    await renderPage(VatBadDebtRelief);
    const claimed = byTestId(`relief-period-${CLAIM_ID}`)!.textContent!;
    expect(claimed).toContain("إقرار ضريبة القيمة المضافة");
    expect(claimed).toContain(arCompliance["vatBadDebtRelief.periodStatus.amendment"]);
    expect(claimed).not.toMatch(/[A-Za-z]/);
    expect(byTestId(`relief-period-${REVERSED_ID}`)!.textContent).toContain(
      arCompliance["vatBadDebtRelief.periodStatus.filed"]
    );
    expect(byTestId(`relief-reversal-period-${REVERSED_ID}`)!.textContent).toContain(
      arCompliance["vatBadDebtRelief.periodStatus.open"]
    );
    expect(text()).not.toContain(
      arCompliance["vatBadDebtRelief.periodNeutral"].replace("{date}", "")
    );
  });

  it.each(["en", "ar"] as const)(
    "says a submitted return is not yet filed, a locked one needs verification, and shows partial recoveries (%s)",
    async (lang) => {
      const SUBMITTED = { ...FILED_Q3, status: "submitted" };
      const LOCKED = { ...FILED_Q3, status: "unverified", source: "group" };
      {
        state.lang = lang;
        const cat = lang === "en" ? enCompliance : arCompliance;
        setFixtures({
          [CLAIMS_URL]: [
            claim({
              claimReturn: SUBMITTED,
              reversalReturns: [{ ...LOCKED, addBack: 25 }],
            }),
          ],
          [ELIGIBLE_URL]: ELIGIBLE,
        });
        await renderPage(VatBadDebtRelief);
        const period = byTestId(`relief-period-${CLAIM_ID}`)!.textContent!;
        expect(period).toContain(cat["vatBadDebtRelief.periodStatus.submitted"]);
        expect(period).not.toContain(cat["vatBadDebtRelief.periodStatus.filed"] + ")");
        const partial = byTestId(`relief-reversal-period-${CLAIM_ID}`)!.textContent!;
        expect(partial).toContain(cat["vatBadDebtRelief.partialRecoveredLead"]);
        expect(partial).toContain(cat["vatBadDebtRelief.periodStatus.unverified"]);
        if (lang === "ar") expect(period).not.toMatch(/[A-Za-z]/);
      }
    }
  );

  it.each(["en", "ar"] as const)(
    "shows a reversed recovery as relief claimed again and leads from the net (%s)",
    async (lang) => {
      state.lang = lang;
      const cat = lang === "en" ? enCompliance : arCompliance;
      setFixtures({
        [CLAIMS_URL]: [
          claim({
            reversalReturns: [
              { ...FILED_Q3, addBack: 25 },
              {
                ...FILED_Q3,
                from: "2026-10-01",
                to: "2026-12-31",
                status: "forecast",
                addBack: -25,
              },
            ],
          }),
        ],
        [ELIGIBLE_URL]: ELIGIBLE,
      });
      await renderPage(VatBadDebtRelief);
      const cell = byTestId(`relief-reversal-period-${CLAIM_ID}`)!.textContent!;
      // Net nil: no "recovered" lead, and the negative return says the relief is claimed again.
      expect(cell).toContain(cat["vatBadDebtRelief.netNilLead"]);
      expect(cell).not.toContain(cat["vatBadDebtRelief.partialRecoveredLead"]);
      expect(cell).toContain(cat["vatBadDebtRelief.claimedAgainAmount"].split("{amount}")[0]);
      expect(cell).toContain(cat["vatBadDebtRelief.periodStatus.forecast"]);
    }
  );

  it("keeps catalogs complete for the status words, with tanween spelled letter, fathatan, alif", () => {
    for (const key of ["open", "submitted", "filed", "amendment", "forecast", "unverified"]) {
      expect(
        enCompliance[`vatBadDebtRelief.periodStatus.${key}` as keyof typeof enCompliance]
      ).toBeTruthy();
      expect(
        arCompliance[`vatBadDebtRelief.periodStatus.${key}` as keyof typeof arCompliance]
      ).toBeTruthy();
    }
    for (const value of Object.values(arCompliance)) {
      // A fathatan sits on the letter before the alif, never after it.
      expect(value).not.toMatch(/اً/);
    }
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

  it("words the reversal effect by date, never naming a return the screen cannot know", async () => {
    await renderPage(VatBadDebtRelief);
    await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
    await type(byTestId("input-reverse-reason"), "Customer paid in full");
    expect(byTestId("reverse-effect")!.textContent).toContain(
      "in the VAT return for the period containing"
    );
    expect((byTestId("button-confirm-reverse") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's translated error when a reversal lands in a filed period (Arabic)", async () => {
    state.lang = "ar";
    const { useI18n } = await import("../../client/src/lib/i18n");
    useI18n.setState({ locale: "ar" } as never);
    const restore = failPosts("VAT_PERIOD_FILED", 409);
    try {
      await renderPage(VatBadDebtRelief);
      await click(byTestId("button-reverse-11111111-1111-4111-8111-111111111111"));
      await type(byTestId("input-reverse-reason"), "سبب كاف");
      await click(byTestId("button-confirm-reverse"));
      await flush(5);
      const toast = state.toasts.at(-1)!;
      expect(toast.variant).toBe("destructive");
      expect(toast.description).toBe(arForms["forms.serverErrors.VAT_PERIOD_FILED"]);
    } finally {
      useI18n.setState({ locale: "en" } as never);
      restore();
    }
  });

  it("labels a claim closed by customer payments without naming one return", async () => {
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
