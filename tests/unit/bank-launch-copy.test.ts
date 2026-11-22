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
    copy: "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    uploadHint: "CSV files can use commas, semicolons, or tabs",
    banking: enBanking,
    onboarding: enOnboarding,
    errors: enErrors,
  },
  {
    locale: "ar",
    heading: "كشوف الحساب البنكي بصيغة CSV",
    copy: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    uploadHint: "يمكن فصل أعمدة ملف CSV بفاصلة أو فاصلة منقوطة أو علامة جدولة",
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
      expect(banking["banking.import.formatDelimiters"]).toBe(uploadHint);
    });
  }
);
