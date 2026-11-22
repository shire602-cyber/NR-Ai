// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import arBanking from "../../client/src/locales/ar/banking.json";
import arOnboarding from "../../client/src/locales/ar/onboarding.json";
import arErrors from "../../client/src/locales/ar/serverErrors.json";
import enBanking from "../../client/src/locales/en/banking.json";
import enOnboarding from "../../client/src/locales/en/onboarding.json";
import enErrors from "../../client/src/locales/en/serverErrors.json";
import BankFeedCallback from "../../client/src/pages/BankFeedCallback";
import BankFeeds from "../../client/src/pages/BankFeeds";

const { request, toast } = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1" }),
}));
vi.mock("../../client/src/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));
vi.mock("../../client/src/lib/queryClient", async (original) => ({
  ...(await original<typeof import("../../client/src/lib/queryClient")>()),
  apiRequest: request,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const languages = [
  {
    locale: "en",
    heading: "CSV bank statements",
    callbackHeading: "Returning to bank reconciliation",
    copy: "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    uploadHint: "Upload a CSV exported from your bank",
    banking: enBanking,
    onboarding: enOnboarding,
    errors: enErrors,
  },
  {
    locale: "ar",
    heading: "كشوف الحساب البنكي بصيغة CSV",
    callbackHeading: "جارٍ الرجوع إلى التسوية البنكية",
    copy: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    uploadHint: "ارفع كشف حساب بصيغة CSV صدّرته من مصرفك",
    banking: arBanking,
    onboarding: arOnboarding,
    errors: arErrors,
  },
] as const;

const bankClaim =
  /\b(?:bank|live)\s+feeds?\b|\bopen[-\s]+banking\b|\bcoming\s+(?:soon|later)\b|\bconnect(?:ed|ing)?\b|\bsync(?: now)?\b|ربط|مزامنة|قريب(?:اً|ًا|ا)/iu;

let root: Root;
let element: HTMLDivElement;
let client: QueryClient;
let previousLocale: "en" | "ar";

beforeAll(async () => {
  await Promise.all(languages.map(({ locale }) => loadLocale(locale)));
});

beforeEach(() => {
  previousLocale = useI18n.getState().locale;
  request.mockReset();
  toast.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  element = document.createElement("div");
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  useI18n.setState({ locale: previousLocale });
  window.history.replaceState(null, "", "/");
  sessionStorage.removeItem("bankFeedProvider");
});

async function render(Page: typeof BankFeeds) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(StrictMode, null, createElement(Page))
      )
    );
  });
}

describe.each(languages)(
  "CSV-only bank reconciliation in $locale",
  ({ locale, heading, copy, uploadHint, banking, onboarding, errors }) => {
    it.each([false, true])(
      "ignores a legacy provider cache with configured set to %s",
      async (configured) => {
        useI18n.setState({ locale });
        client.setQueryData(["/api/bank/providers"], {
          isConfigured: configured,
          statuses: [
            {
              id: "lean",
              label: "Lean",
              configured,
              status: configured ? "live" : "requires_external",
            },
          ],
          redirectUris: ["https://example.test/bank-feeds/callback"],
        });
        client.setQueryData(
          ["/api/companies", "company-1", "bank-accounts"],
          [
            { id: "account-1", nameEn: "Current", nameAr: "الحساب الجاري" },
            { id: "account-2", nameEn: "Savings", nameAr: "حساب التوفير" },
          ]
        );
        client.setQueryData(
          ["/api/companies", "company-1", "bank-connections"],
          [{ id: "connection-1", provider: "lean", bankAccountId: "account-1", status: "active" }]
        );

        await render(BankFeeds);

        expect(element.querySelector("h1")?.textContent).toBe(heading);
        expect(Array.from(element.querySelectorAll("p"), (p) => p.textContent)).toContain(copy);
        expect(
          element
            .querySelector('[data-testid="button-feeds-import-statement"]')
            ?.getAttribute("href")
        ).toBe("/bank-reconciliation?import=1");
        expect(element.textContent).not.toMatch(bankClaim);
        expect(element.textContent).not.toMatch(/Lean|الحساب الجاري|حساب التوفير/u);
        expect(
          client
            .getQueryCache()
            .find({ queryKey: ["/api/bank/providers"] })
            ?.getObserversCount()
        ).toBe(0);
      }
    );

    it("uses the approved CSV guidance for setup, errors and upload help", () => {
      expect(errors["serverErrors.BANK_FEED_NOT_CONFIGURED"]).toBe(copy);
      expect(onboarding["onboarding.bankCardDesc"]).toBe(copy);
      expect(banking["banking.import.formats"]).toBe(uploadHint);
    });
  }
);

describe("bank connection callback", () => {
  it.each([
    {
      ...languages[0],
      query: "?provider=lean&code=provider-code&state=provider-state",
      sessionProvider: null,
    },
    {
      ...languages[1],
      query: "?entity_id=provider-code&state=provider-state",
      sessionProvider: "lean",
    },
  ])(
    "completes the callback once with the reconciliation status in $locale",
    async ({ locale, callbackHeading, query, sessionProvider }) => {
      useI18n.setState({ locale });
      window.history.replaceState(null, "", "/bank-feeds/callback" + query);
      if (sessionProvider) sessionStorage.setItem("bankFeedProvider", sessionProvider);
      let complete!: (result: object) => void;
      request.mockImplementationOnce(
        () =>
          new Promise<object>((resolve) => {
            complete = resolve;
          })
      );

      await render(BankFeedCallback);

      expect(window.location.pathname).toBe("/bank-feeds/callback");
      expect(element.querySelector('[role="status"] h1')?.textContent).toBe(callbackHeading);
      expect(element.textContent).not.toMatch(bankClaim);
      expect(request).toHaveBeenCalledExactlyOnceWith(
        "POST",
        "/api/companies/company-1/bank-connections/callback",
        { provider: "lean", code: "provider-code", state: "provider-state" }
      );

      await act(async () => {
        complete({});
        await vi.waitFor(() => expect(window.location.pathname).toBe("/bank-feeds"));
      });
      expect(window.location.search).toBe("");
      expect(request).toHaveBeenCalledTimes(1);
      expect(toast).not.toHaveBeenCalled();
    }
  );

  it("shows the CSV route without submitting an incomplete callback", async () => {
    useI18n.setState({ locale: "en" });
    window.history.replaceState(null, "", "/bank-feeds/callback?code=provider-code");

    await render(BankFeedCallback);

    expect(request).not.toHaveBeenCalled();
    expect(element.querySelector("h1")?.textContent).toBe("CSV bank statements");
    expect(
      element.querySelector('[data-testid="button-feeds-import-statement"]')?.getAttribute("href")
    ).toBe("/bank-reconciliation?import=1");
  });

  it("reports a failed callback and clears its query parameters", async () => {
    useI18n.setState({ locale: "en" });
    window.history.replaceState(
      null,
      "",
      "/bank-feeds/callback?provider=lean&code=provider-code&state=provider-state"
    );
    request.mockRejectedValueOnce(new Error("Invalid callback state"));

    await render(BankFeedCallback);
    await act(async () => {
      await vi.waitFor(() => expect(window.location.pathname).toBe("/bank-feeds"));
    });

    expect(window.location.search).toBe("");
    expect(request).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "Invalid callback state" })
    );
  });
});
