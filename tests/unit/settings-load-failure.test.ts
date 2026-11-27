// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import CompanySettings from "@/pages/CompanySettings";
import DeveloperSettings from "@/pages/DeveloperSettings";
import NotificationPreferences from "@/pages/NotificationPreferences";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1" }),
}));
vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true }),
}));

// 403 is not retried by the query client, so the failure surfaces immediately.
const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith("/api/csrf-token")) {
    return new Response(JSON.stringify({ csrfToken: "" }), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ message: "forbidden", code: forbiddenCode }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
});

let root: Root;
let container: HTMLDivElement;
let forbiddenCode: string;

async function flush(action?: () => void) {
  await act(async () => {
    action?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage(page: () => unknown) {
  await flush(() =>
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(page as never))
    )
  );
  for (let i = 0; i < 6; i++) await flush();
}

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  fetchMock.mockClear();
  forbiddenCode = "COMPANY_ACCESS_DENIED";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  queryClient.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await flush(() => root.unmount());
  container.remove();
  queryClient.clear();
  useI18n.getState().setLocale("en");
  vi.unstubAllGlobals();
});

describe("Settings screens when the load fails", () => {
  it.each([
    { locale: "en", guidance: "Ask your company owner or administrator to grant you access." },
    { locale: "ar", guidance: "اطلب من مالك شركتك أو مسؤولها منحك صلاحية الوصول." },
  ] as const)(
    "Company Settings shows company access guidance on a 403 ($locale)",
    async ({ locale, guidance }) => {
      useI18n.getState().setLocale(locale);
      await renderPage(CompanySettings);
      expect(fetchMock).toHaveBeenCalledWith("/api/companies/company-1", expect.anything());
      expect(
        container.querySelector('[data-testid="company-settings-load-error"] p')?.textContent
      ).toBe(guidance);
    }
  );

  describe.each([
    {
      locale: "en",
      settingsEyebrow: "Settings",
      webhooksTab: "Webhooks",
      companyGuidance:
        "Ask your company owner or administrator to review your access to Developer Settings.",
      accountGuidance:
        "This feature is unavailable for your account type. Contact support if you think you should have access.",
    },
    {
      locale: "ar",
      settingsEyebrow: "الإعدادات",
      webhooksTab: "الويب هوك (Webhooks)",
      companyGuidance: "اطلب من مالك شركتك أو مسؤولها مراجعة صلاحية وصولك إلى إعدادات المطوّرين.",
      accountGuidance:
        "هذه الميزة غير متاحة لنوع حسابك. تواصل مع فريق الدعم إذا كنت تعتقد أنه ينبغي أن تتمكن من استخدامها.",
    },
  ] as const)(
    "403 guidance in $locale",
    ({ locale, settingsEyebrow, webhooksTab, companyGuidance, accountGuidance }) => {
      it("shows account-type guidance and withholds the Notification Preferences form", async () => {
        forbiddenCode = "ACCESS_RESTRICTED";
        useI18n.getState().setLocale(locale);
        await renderPage(NotificationPreferences);
        expect(fetchMock).toHaveBeenCalledWith("/api/notification-preferences", expect.anything());
        expect(
          container.querySelector('[data-testid="notification-prefs-load-error"] p')?.textContent
        ).toBe(accountGuidance);
        // Saving defaults over real preferences must not be possible.
        expect(container.querySelector("form")).toBeNull();
        expect(container.textContent).toContain(settingsEyebrow);
        if (locale === "ar") expect(container.textContent).not.toContain("Settings");
      });

      it.each([
        ["COMPANY_ACCESS_DENIED", companyGuidance],
        ["PERMISSION_DENIED", companyGuidance],
        ["ACCESS_RESTRICTED", accountGuidance],
      ])(
        "shows the right guidance in both Developer Settings tabs for %s",
        async (code, guidance) => {
          forbiddenCode = code;
          useI18n.getState().setLocale(locale);
          await renderPage(DeveloperSettings);
          expect(fetchMock).toHaveBeenCalledWith(
            "/api/companies/company-1/api-keys",
            expect.anything()
          );
          expect(
            container.querySelector('[data-testid="api-keys-load-error"] p')?.textContent
          ).toBe(guidance);

          const tab = [...container.querySelectorAll('[role="tab"]')].find(
            (candidate) => candidate.textContent === webhooksTab
          );
          expect(tab).toBeDefined();
          await flush(() =>
            tab!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
          );

          const webhooksError = () =>
            container.querySelector('[data-testid="webhooks-load-error"] p');
          for (let i = 0; i < 6 && !webhooksError(); i++) await flush();
          expect(fetchMock).toHaveBeenCalledWith(
            "/api/companies/company-1/webhooks",
            expect.anything()
          );
          expect(webhooksError()?.textContent).toBe(guidance);
        }
      );
    }
  );
});
