// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
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
  return new Response(JSON.stringify({ message: "forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
});

let root: Root;
let container: HTMLDivElement;

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
  it("notification preferences shows a load error, not editable defaults", async () => {
    useI18n.getState().setLocale("ar");
    await renderPage(NotificationPreferences);
    expect(container.querySelector('[data-testid="notification-prefs-load-error"]')).not.toBeNull();
    // Saving defaults over real preferences must not be possible.
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Settings");
    expect(container.textContent).toContain("الإعدادات");
  });

  it.each([
    {
      locale: "en",
      webhooksTab: "Webhooks",
      guidance: "Ask your company owner or administrator to grant you API access.",
    },
    {
      locale: "ar",
      webhooksTab: "الويب هوك (Webhooks)",
      guidance: "اطلب من مالك شركتك أو مسؤولها منحك صلاحية الوصول إلى واجهة برمجة التطبيقات.",
    },
  ] as const)(
    "both Developer Settings tabs show company access guidance on a 403 ($locale)",
    async ({ locale, webhooksTab, guidance }) => {
      useI18n.getState().setLocale(locale);
      await renderPage(DeveloperSettings);
      expect(container.querySelector('[data-testid="api-keys-load-error"]')?.textContent).toContain(
        guidance
      );

      const tab = [...container.querySelectorAll('[role="tab"]')].find(
        (candidate) => candidate.textContent === webhooksTab
      );
      expect(tab).toBeDefined();
      await flush(() =>
        tab!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      );

      const webhooksError = () => container.querySelector('[data-testid="webhooks-load-error"]');
      for (let i = 0; i < 6 && !webhooksError(); i++) await flush();
      expect(webhooksError()?.textContent).toContain(guidance);
    }
  );
});
