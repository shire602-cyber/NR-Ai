// @vitest-environment jsdom
/**
 * E1 (J2-r2 High): switching Arabic -> English with an unread notification crashed the whole
 * app, because NotificationBell called `.replace` on a catalog key of the English catalog that
 * had not loaded yet. The translation lookup now falls back to the loaded catalog, then to the
 * key, so it is never undefined while a locale loads.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../client/src/hooks/useNotifications", () => ({
  useNotifications: () => ({
    notifications: [
      {
        id: "n1",
        userId: "u",
        type: "info",
        title: "t",
        message: "m",
        priority: "normal",
        isRead: false,
        isDismissed: false,
        createdAt: new Date().toISOString(),
      },
    ],
    unreadCount: 1,
    markAsRead: async () => {},
    markAllAsRead: async () => {},
    isConnected: false,
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("E1 language switch ar -> en", () => {
  it("never yields an undefined string while the English catalog is still loading", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    // Boot in Arabic: only the Arabic catalogs are loaded.
    await i18n.loadLocale("ar");
    expect(i18n.isLocaleLoaded("en")).toBe(false);
    i18n.useI18n.setState({ locale: "en" });

    let seen: Record<string, string> | undefined;
    function Probe() {
      seen = i18n.useTranslation().t;
      return null;
    }
    await act(async () => {
      root.render(createElement(Probe));
    });
    // Unloaded key: falls back to the Arabic copy (then to the key), never undefined.
    const aria = seen!["components.notificationsUnreadAria"];
    expect(typeof aria).toBe("string");
    expect(() => aria.replace("{count}", "1")).not.toThrow();
    expect(seen!["nonexistent.key"]).toBe("nonexistent.key");
  });

  it("renders NotificationBell with an unread notification across the switch without crashing", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    await i18n.loadLocale("ar");
    i18n.useI18n.setState({ locale: "ar" });
    const { NotificationBell } = await import("../../client/src/components/NotificationBell");
    const { Router } = await import("wouter");
    await act(async () => {
      root.render(createElement(Router, null, createElement(NotificationBell)));
    });
    const btn = () => container.querySelector('[data-testid="button-notifications"]')!;
    expect(btn().getAttribute("aria-label")).toContain("غير مقروءة");

    // The switch: English catalogs are not loaded yet at the first render.
    await act(async () => {
      i18n.useI18n.getState().setLocale("en");
    });
    expect(btn().getAttribute("aria-label")).toBeTruthy();
    await act(async () => {
      await i18n.loadLocale("en");
    });
    expect(btn().getAttribute("aria-label")).toBe("Notifications, 1 unread");
  });
});
