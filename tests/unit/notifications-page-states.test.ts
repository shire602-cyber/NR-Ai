// @vitest-environment jsdom
// PR #152 review (Sol): regulatory-news failure, offline first load and offline row actions on the
// Notifications page. Renders the real page against a real QueryClient and the real online manager.
import { createElement, act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, t } from "../../client/src/lib/i18n";

const h = vi.hoisted(() => ({
  client: null as unknown,
  apiRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    apiRequest: (...args: unknown[]) => h.apiRequest(...args),
    get queryClient() {
      return h.client;
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
// Radix menus need pointer events jsdom lacks; the page logic only needs items that can be
// selected and disabled, so render them inline.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => children,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    asChild,
    ...rest
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
    asChild?: boolean;
    "data-testid"?: string;
  }) =>
    asChild
      ? children
      : createElement("button", { ...rest, disabled, onClick: () => onSelect?.() }, children),
}));

import Notifications from "../../client/src/pages/Notifications";
import { ApiError } from "../../client/src/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = () => Promise<unknown>;
let handlers: Record<string, Handler>;
let root: Root;
let container: HTMLElement;

const unreadRow = {
  id: "n1",
  type: "system",
  priority: "normal",
  title: "Backup finished",
  message: "Nightly backup completed.",
  isRead: false,
  actionUrl: null,
  createdAt: new Date().toISOString(),
};
const listResponse = (rows = [unreadRow]) => ({
  notifications: rows,
  unreadCount: rows.filter((r) => !r.isRead).length,
});

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
        queryFn: ({ queryKey }) => handlers[String(queryKey[0])](),
      },
      mutations: { retry: false },
    },
  });
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  const client = makeClient();
  h.client = client;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Notifications)));
  });
  await flush();
}

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
};
const setOnline = async (online: boolean) => {
  await act(async () => {
    onlineManager.setOnline(online);
  });
  await flush();
};
const newsTabListHidden = () =>
  byId("tab-regulatory")?.parentElement?.className.split(/\s+/).includes("hidden") ?? true;

beforeAll(async () => {
  await loadLocale("en");
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  onlineManager.setOnline(true);
  h.apiRequest.mockReset();
  h.toast.mockReset();
  handlers = {
    "/api/notifications": async () => listResponse(),
    "/api/regulatory-news": async () => [],
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  onlineManager.setOnline(true);
});

describe("Notifications regulatory news states", () => {
  it("keeps the news tab and its retry panel reachable when the first load fails", async () => {
    let newsFails = true;
    handlers["/api/regulatory-news"] = async () => {
      if (newsFails) throw new ApiError("boom", 500);
      return [];
    };
    await mount();

    expect(newsTabListHidden()).toBe(false);
    await act(async () => {
      byId("tab-regulatory")!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 })
      );
    });
    await flush();
    const panel = byId("news-load-error");
    expect(panel).not.toBeNull();

    newsFails = false;
    await click(panel!.querySelector("button")!);
    // A successful empty response removes the tab again and never shows the error panel.
    expect(byId("news-load-error")).toBeNull();
    expect(newsTabListHidden()).toBe(true);
  });

  it("keeps the selected news tab visible while a retry loads, then restores the toolbar on []", async () => {
    let attempt = 0;
    let finishRetry: (v: unknown[]) => void = () => undefined;
    handlers["/api/regulatory-news"] = () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new ApiError("boom", 500));
      return new Promise((r) => (finishRetry = r as (v: unknown[]) => void));
    };
    await mount();
    await act(async () => {
      byId("tab-regulatory")!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 })
      );
    });
    await flush();
    // On the news tab the Notifications toolbar is not shown.
    expect(byId("button-mark-all-read")).toBeNull();

    await click(byId("news-load-error")!.querySelector("button")!);
    // Retry in flight with no data: the strip and the selected tab survive.
    expect(newsTabListHidden()).toBe(false);
    expect(byId("tab-regulatory")!.getAttribute("data-state")).toBe("active");

    await act(async () => finishRetry([]));
    await flush();
    // Empty news hides the tab; the derived selection is Notifications, so the toolbar is back.
    expect(newsTabListHidden()).toBe(true);
    expect(byId("button-mark-all-read")).not.toBeNull();
  });

  it("hides the news tab for a successful empty response", async () => {
    await mount();
    expect(newsTabListHidden()).toBe(true);
    expect(byId("news-load-error")).toBeNull();
  });
});

describe("Notifications offline first load", () => {
  it("shows the offline panel instead of caught-up, then the list on reconnect", async () => {
    onlineManager.setOnline(false);
    await mount();

    expect(byId("notifications-offline")).not.toBeNull();
    expect(container.textContent).toContain(t.en["firm.loadOfflineBody"]);
    expect(container.textContent).not.toContain(t.en["pageLabels.noNotifications"]);

    await setOnline(true);
    expect(byId("notifications-offline")).toBeNull();
    expect(byId("card-notification-n1")).not.toBeNull();
  });

  it("still says caught up for a successful empty list", async () => {
    handlers["/api/notifications"] = async () => listResponse([]);
    await mount();
    expect(container.textContent).toContain(t.en["pageLabels.noNotifications"]);
    expect(byId("notifications-offline")).toBeNull();
  });
});

describe("Notifications row actions", () => {
  it("tells the user a paused action is waiting, blocks duplicates, and resumes on reconnect", async () => {
    let resolveRead: (v: unknown) => void = () => undefined;
    h.apiRequest.mockImplementation(() => new Promise((r) => (resolveRead = r)));
    await mount();

    await setOnline(false);
    await click(byId("action-read-n1")!);

    // Actually paused: the row shows a localized inline status (no request has been sent).
    expect(byId("status-paused-n1")?.textContent).toBe(
      t.en["pageLabels.notificationActionOffline"]
    );
    expect(h.apiRequest).not.toHaveBeenCalled();
    // The pending row cannot be read again or dismissed meanwhile.
    expect((byId("action-read-n1") as HTMLButtonElement).disabled).toBe(true);
    expect((byId("action-dismiss-n1") as HTMLButtonElement).disabled).toBe(true);
    await click(byId("action-read-n1")!);
    await click(byId("action-dismiss-n1")!);
    expect(h.toast).not.toHaveBeenCalled();

    await setOnline(true);
    expect(byId("status-paused-n1")).toBeNull();
    expect(h.apiRequest).toHaveBeenCalledTimes(1);
    expect(h.apiRequest).toHaveBeenCalledWith("PATCH", "/api/notifications/n1/read");

    handlers["/api/notifications"] = async () => listResponse([{ ...unreadRow, isRead: true }]);
    await act(async () => resolveRead({}));
    await flush();
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    // Read now, so only dismiss remains and it is available again.
    expect(byId("action-read-n1")).toBeNull();
    expect((byId("action-dismiss-n1") as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports a failed action and frees the row for another try", async () => {
    h.apiRequest.mockRejectedValueOnce(new ApiError("nope", 500));
    await mount();

    await click(byId("action-dismiss-n1")!);
    expect(h.toast).toHaveBeenCalledWith({
      title: t.en["pageLabels.notificationActionFailed"],
      variant: "destructive",
    });
    expect(byId("status-paused-n1")).toBeNull();
    expect((byId("action-dismiss-n1") as HTMLButtonElement).disabled).toBe(false);
  });

  it("tracks several paused rows independently", async () => {
    const second = { ...unreadRow, id: "n2", title: "Second" };
    handlers["/api/notifications"] = async () => listResponse([unreadRow, second]);
    h.apiRequest.mockImplementation(() => new Promise(() => undefined));
    await mount();

    await setOnline(false);
    await click(byId("action-read-n1")!);
    expect(byId("status-paused-n1")).not.toBeNull();
    expect(byId("status-paused-n2")).toBeNull();
    expect((byId("action-read-n2") as HTMLButtonElement).disabled).toBe(false);

    await click(byId("action-dismiss-n2")!);
    expect(byId("status-paused-n2")).not.toBeNull();
    expect((byId("action-read-n1") as HTMLButtonElement).disabled).toBe(true);
  });
});
