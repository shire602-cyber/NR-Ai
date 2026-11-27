// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { loadLocale, translateNow, useI18n } from "../../client/src/lib/i18n";
import { apiRequest } from "../../client/src/lib/queryClient";
import NotificationPreferences from "../../client/src/pages/NotificationPreferences";

vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("../../client/src/lib/push", () => ({
  isPushSubscribed: vi.fn(async () => false),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

it.each([
  ["en", "Waiting for a connection to load your notification preferences."],
  ["ar", "بانتظار الاتصال بالإنترنت لتحميل تفضيلات الإشعارات."],
] as const)(
  "keeps notification preferences unavailable until reconnecting (%s)",
  async (locale, notice) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const wasOnline = onlineManager.isOnline();
    const previousLocale = useI18n.getState().locale;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryKey = ["/api/notification-preferences"];
    vi.mocked(apiRequest).mockResolvedValue({ invoiceReminders: false });

    try {
      onlineManager.setOnline(false);
      await loadLocale(locale);
      useI18n.getState().setLocale(locale);
      await act(async () => {
        root.render(
          createElement(QueryClientProvider, { client }, createElement(NotificationPreferences))
        );
      });

      expect(client.getQueryState(queryKey)?.fetchStatus).toBe("paused");
      expect(container.querySelector('[role="status"]')?.textContent).toBe(notice);
      expect(container.querySelector('form, [role="switch"], button[type="submit"]')).toBeNull();
      expect(apiRequest).not.toHaveBeenCalled();

      await act(async () => onlineManager.setOnline(true));
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(container.querySelector('button[type="submit"]:enabled')).not.toBeNull();
      });

      const reminderLabel = Array.from(container.querySelectorAll("label")).find(
        (label) => label.textContent === translateNow("pages.invoiceReminders")
      );
      const reminder = document.getElementById(reminderLabel?.htmlFor ?? "");
      expect(reminder?.getAttribute("aria-checked")).toBe("false");
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(apiRequest).toHaveBeenCalledExactlyOnceWith("GET", queryKey[0]);
    } finally {
      act(() => root.unmount());
      container.remove();
      client.clear();
      onlineManager.setOnline(wasOnline);
      useI18n.getState().setLocale(previousLocale);
      vi.mocked(apiRequest).mockReset();
      vi.unstubAllGlobals();
    }
  }
);
