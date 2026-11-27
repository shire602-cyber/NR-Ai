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
let forbiddenCode: string | undefined;

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

function expectGuidance(testId: string, guidance: string, setupMfa = false) {
  const description = container.querySelector(`[data-testid="${testId}"] p`);
  expect(description?.textContent).toBe(guidance);
  const link = description?.querySelector("a");
  if (setupMfa) {
    expect(link?.textContent).toBe(guidance);
    expect(link?.getAttribute("href")).toBe("/settings/security");
  } else {
    expect(link).toBeNull();
  }
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
  describe.each([
    {
      locale: "en",
      settingsEyebrow: "Settings",
      webhooksTab: "Webhooks",
      companyGuidance: "Ask your company owner or administrator to grant you access.",
      developerGuidance:
        "Ask your company owner or administrator to review your access to Developer Settings.",
      accountGuidance:
        "This feature is unavailable for your account type. Contact support if you think you should have access.",
      mfaGuidance: "Enable two-factor authentication in Security settings to continue.",
      fallbackGuidance:
        "Access to these settings was denied. Contact support if you think you should have access.",
    },
    {
      locale: "ar",
      settingsEyebrow: "الإعدادات",
      webhooksTab: "الويب هوك (Webhooks)",
      companyGuidance: "اطلب من مالك شركتك أو مسؤولها منحك صلاحية الوصول.",
      developerGuidance: "اطلب من مالك شركتك أو مسؤولها مراجعة صلاحية وصولك إلى إعدادات المطوّرين.",
      accountGuidance:
        "هذه الميزة غير متاحة لنوع حسابك. تواصل مع فريق الدعم إذا كنت تعتقد أنه ينبغي أن تتمكن من استخدامها.",
      mfaGuidance: "فعّل المصادقة الثنائية في إعدادات الأمان للمتابعة.",
      fallbackGuidance:
        "تم رفض الوصول إلى هذه الإعدادات. تواصل مع فريق الدعم إذا كنت تعتقد أنه ينبغي أن تتمكن من الوصول إليها.",
    },
  ] as const)(
    "403 guidance in $locale",
    ({
      locale,
      settingsEyebrow,
      webhooksTab,
      companyGuidance,
      developerGuidance,
      accountGuidance,
      mfaGuidance,
      fallbackGuidance,
    }) => {
      it.each([
        ["COMPANY_ACCESS_DENIED", companyGuidance],
        ["PORTAL_USER_APP_DENIED", accountGuidance],
        ["PORTAL_SCOPE", accountGuidance],
        ["MFA_ENROLLMENT_REQUIRED", mfaGuidance],
        ["ORIGIN_NOT_ALLOWED", fallbackGuidance],
        [undefined, fallbackGuidance],
      ])("shows the right Company Settings guidance for %s", async (code, guidance) => {
        forbiddenCode = code;
        useI18n.getState().setLocale(locale);
        await renderPage(CompanySettings);
        expect(fetchMock).toHaveBeenCalledWith("/api/companies/company-1", expect.anything());
        expectGuidance("company-settings-load-error", guidance, code === "MFA_ENROLLMENT_REQUIRED");
      });

      it.each([
        ["ACCESS_RESTRICTED", accountGuidance],
        ["PORTAL_SCOPE", accountGuidance],
        ["ORIGIN_NOT_ALLOWED", fallbackGuidance],
        [undefined, fallbackGuidance],
      ])(
        "shows the right Notification Preferences guidance for %s and withholds the form",
        async (code, guidance) => {
          forbiddenCode = code;
          useI18n.getState().setLocale(locale);
          await renderPage(NotificationPreferences);
          expect(fetchMock).toHaveBeenCalledWith(
            "/api/notification-preferences",
            expect.anything()
          );
          expectGuidance("notification-prefs-load-error", guidance);
          // Saving defaults over real preferences must not be possible.
          expect(container.querySelector("form")).toBeNull();
          expect(container.textContent).toContain(settingsEyebrow);
          if (locale === "ar") expect(container.textContent).not.toContain("Settings");
        }
      );

      it.each([
        ["COMPANY_ACCESS_DENIED", developerGuidance],
        ["PERMISSION_DENIED", developerGuidance],
        ["ACCESS_RESTRICTED", accountGuidance],
        ["PORTAL_SCOPE", accountGuidance],
        ["PORTAL_USER_APP_DENIED", accountGuidance],
        ["MFA_ENROLLMENT_REQUIRED", mfaGuidance],
        ["ORIGIN_NOT_ALLOWED", fallbackGuidance],
        ["UNKNOWN_FORBIDDEN", fallbackGuidance],
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
          const setupMfa = code === "MFA_ENROLLMENT_REQUIRED";
          expectGuidance("api-keys-load-error", guidance, setupMfa);

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
          expectGuidance("webhooks-load-error", guidance, setupMfa);
        }
      );
    }
  );
});
