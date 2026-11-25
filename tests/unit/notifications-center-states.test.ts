// @vitest-environment jsdom
/**
 * Notifications center: a failed load must show a retryable error (not "all caught up"),
 * the eyebrow and news category pills must follow the language, and regulatory news must use
 * its Arabic title/summary in Arabic mode.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let notificationsStatus = 200;

const news = [
  {
    id: "n1",
    title: "VAT change",
    titleAr: "تعديل ضريبة القيمة المضافة",
    summary: "English summary",
    summaryAr: "ملخص عربي",
    category: "corporate_tax",
    importance: "normal",
    publishedAt: new Date().toISOString(),
  },
];

function respond(url: string) {
  const json = (status: number, body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  if (url.includes("/api/notifications")) {
    return notificationsStatus === 200
      ? json(200, { notifications: [], unreadCount: 0 })
      : json(notificationsStatus, { message: "boom internal detail" });
  }
  if (url.includes("/api/regulatory-news")) return json(200, news);
  return json(200, {});
}

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => respond(String(input)))
  );
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  notificationsStatus = 200;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const { default: Notifications } = await import("../../client/src/pages/Notifications");
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Notifications))
    );
  });
}

function waitForView(assert: () => void) {
  return vi.waitFor(async () => {
    // Give React Query's batched observer notifications time to reach React.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert();
  });
}

describe("Notifications center states", () => {
  it("shows a retryable error instead of the empty state when the load fails", async () => {
    notificationsStatus = 500;
    await mount("en");
    const loadError = () =>
      container.querySelector('[role="alert"][data-testid="notifications-load-error"]');
    await waitForView(() => expect(loadError()).not.toBeNull());
    expect(container.textContent).not.toContain("boom internal detail");
    expect(container.textContent).not.toMatch(/all caught up/i);

    const retry = loadError()?.querySelector("button");
    expect(retry?.textContent).toBe("Try again");
    notificationsStatus = 200;
    await act(async () => retry?.click());
    await waitForView(() => expect(container.textContent).toMatch(/all caught up/i));
    expect(loadError()).toBeNull();
  });

  it("localises the eyebrow, news category and Arabic news copy in Arabic mode", async () => {
    await mount("ar");
    const tab = container.querySelector('[data-testid="tab-regulatory"]') as HTMLElement;
    expect(tab).not.toBeNull();
    await act(async () => {
      tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      tab.click();
      tab.focus();
    });
    await waitForView(() => {
      expect(container.querySelector('[data-testid="card-news-n1"]')).not.toBeNull();
    });
    const text = container.textContent ?? "";
    expect(text).not.toContain("Workspace");
    expect(text).toContain("مساحة العمل");
    expect(text).toContain("تعديل ضريبة القيمة المضافة");
    expect(text).toContain("ملخص عربي");
    expect(text).toContain("ضريبة الشركات");
    expect(text).not.toContain("corporate tax");
  });
});
