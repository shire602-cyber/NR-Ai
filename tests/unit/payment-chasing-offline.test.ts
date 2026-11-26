// @vitest-environment jsdom
// PR #149 review: the payment-reminders page must not read a paused (offline) overdue fetch as
// "Nothing is overdue", and pause/resume must be immediate-only (never queued or replayed).
import { act, createElement } from "react";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "../../client/src/lib/csrf";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import PaymentChasing from "../../client/src/pages/PaymentChasing";
import en from "../../client/src/locales/en/invoices.json";

const toast = vi.hoisted(() => vi.fn());

vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", company: { id: "c1" }, companies: [] }),
}));

const OVERDUE_KEY = ["/api/chasing/overdue", "c1"];
const overdueBody = {
  rows: [
    {
      invoice: {
        id: "inv-1",
        number: "INV-001",
        customerName: "Acme Trading",
        currency: "AED",
        doNotChase: false,
        chaseLevel: 0,
      },
      paidAmount: 0,
      outstanding: 100,
      daysOverdue: 5,
      bucket: "1-7",
      recommendedLevel: 1,
    },
  ],
  buckets: { "1-7": 1, "8-30": 0, "31-60": 0, "60+": 0 },
  totalOutstanding: 100,
};
const queueBody = { queue: [], config: {} };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("payment chasing offline behaviour", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  let patchResponse: () => Promise<Response>;

  const setConnection = (online: boolean) => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(online);
    act(() => onlineManager.setOnline(online));
  };
  const calls = (method: string, part: string) =>
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes(part) &&
        ((init as RequestInit | undefined)?.method ?? "GET") === method
    );
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await settle();
    expect(check()).toBe(true);
  };
  const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const render = async () => {
    act(() => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(PaymentChasing))
      );
    });
    await settle();
  };

  beforeAll(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await loadLocale("en");
    useI18n.getState().setLocale("en");
  });

  beforeEach(() => {
    toast.mockClear();
    patchResponse = async () => json({ ok: true });
    fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/csrf-token")) return json({ csrfToken: "t" });
      if (init?.method === "PATCH") return patchResponse();
      if (u.includes("/api/chasing/overdue/")) {
        // Like a real browser, a request made without a connection fails.
        if (!window.navigator.onLine) throw new TypeError("Failed to fetch");
        return json(overdueBody);
      }
      if (u.includes("/api/chasing/queue/")) return json(queueBody);
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    onlineManager.setOnline(true);
  });

  it("shows offline feedback, not 'Nothing is overdue', when the page mounts offline, and recovers on reconnect", async () => {
    // A cold start while offline: only the browser knows. No offline event reaches this mount and
    // TanStack's online manager still says online.
    const browserOnLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await render();

    const expectOffline = () => {
      expect(byId("overdue-offline")?.textContent).toContain(en["invoices.reminders.offlineTitle"]);
      expect(container.textContent).not.toContain(en["invoices.reminders.loadError"]);
      expect(container.textContent).not.toContain(en["invoices.reminders.emptyOverdueTitle"]);
      // The aging tiles render without rows only while loading.
      expect(byId("bucket-1-7")).toBeNull();
      expect(calls("GET", "/api/chasing/overdue/")).toHaveLength(0);
    };
    expectOffline();

    // Offline Retry keeps the same honest state and sends nothing.
    act(() => byId("button-retry-overdue")!.click());
    await settle();
    expectOffline();

    // Reconnect: the browser event alone re-enables the query and the list replaces the notice.
    browserOnLine.mockReturnValue(true);
    await act(async () => void window.dispatchEvent(new Event("online")));
    await waitFor(() => byId("overdue-row-INV-001") !== null);
    expect(byId("overdue-offline")).toBeNull();
    expect(container.textContent).not.toContain(en["invoices.reminders.emptyOverdueTitle"]);
    expect(calls("GET", "/api/chasing/overdue/").length).toBeGreaterThan(0);
  });

  it("shows 'Nothing is overdue' only after a successful empty response", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/api/chasing/queue/")
        ? json(queueBody)
        : json({ rows: [], buckets: {}, totalOutstanding: 0 })
    );
    await render();
    await waitFor(() =>
      (container.textContent ?? "").includes(en["invoices.reminders.emptyOverdueTitle"])
    );
    expect(byId("overdue-offline")).toBeNull();
  });

  it("keeps the cached list, unmutated, with a notice while a refresh is paused", async () => {
    queryClient.setQueryData(OVERDUE_KEY, overdueBody);
    const cached = queryClient.getQueryData(OVERDUE_KEY);
    const snapshot = JSON.stringify(cached);
    await render();
    await waitFor(() => byId("overdue-row-INV-001") !== null);
    expect(byId("overdue-stale")).toBeNull();

    setConnection(false);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: OVERDUE_KEY, refetchType: "none" });
      void queryClient.refetchQueries({ queryKey: OVERDUE_KEY });
    });
    await settle();

    expect(byId("overdue-row-INV-001")).not.toBeNull();
    expect(byId("overdue-stale")?.textContent).toBe(en["invoices.reminders.staleNotice"]);
    expect(byId("overdue-offline")).toBeNull();
    expect(queryClient.getQueryData(OVERDUE_KEY)).toBe(cached);
    expect(JSON.stringify(cached)).toBe(snapshot);
  });

  it("shows the load error with Retry above the cached list when an online refresh fails, and recovers on Retry", async () => {
    const older = {
      ...overdueBody.rows[0],
      invoice: { ...overdueBody.rows[0].invoice, id: "inv-0", number: "INV-000" },
      daysOverdue: 40,
    };
    const twoRows = { ...overdueBody, rows: [overdueBody.rows[0], older] };
    queryClient.setQueryData(OVERDUE_KEY, twoRows);
    await render();
    await waitFor(() => byId("overdue-row-INV-001") !== null);

    const respond = fetchMock.getMockImplementation()!;
    let failOverdue = true;
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) =>
      failOverdue && String(url).includes("/api/chasing/overdue/")
        ? json({ message: "boom" }, 400)
        : respond(url, init)
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: OVERDUE_KEY });
    });
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain(en["invoices.reminders.loadError"]);
    expect(alert.contains(byId("button-retry-overdue"))).toBe(true);
    // The cached rows stay, sorted by days overdue, below the error.
    const first = byId("overdue-row-INV-000")!;
    const second = byId("overdue-row-INV-001")!;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toContain(en["invoices.reminders.emptyOverdueTitle"]);

    failOverdue = false;
    act(() => byId("button-retry-overdue")!.click());
    await waitFor(() => container.querySelector('[role="alert"]') === null);
    expect(byId("overdue-row-INV-001")).not.toBeNull();
  });

  async function openPauseItem() {
    queryClient.setQueryData(OVERDUE_KEY, overdueBody);
    await render();
    await waitFor(() => byId("button-row-menu-INV-001") !== null);
  }
  async function clickPause() {
    act(() => {
      byId("button-row-menu-INV-001")!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
      );
    });
    await waitFor(() => document.body.querySelector('[data-testid="button-dnc-INV-001"]') !== null);
    act(() =>
      document.body.querySelector<HTMLElement>('[data-testid="button-dnc-INV-001"]')!.click()
    );
    await settle();
  }

  it("pause/resume is immediate-only: offline it fails at once and is never replayed on reconnect", async () => {
    await openPauseItem();
    setConnection(false);
    await clickPause();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: en["invoices.reminders.pauseOffline"],
      variant: "destructive",
    });
    expect(calls("PATCH", "do-not-chase")).toHaveLength(0);

    setConnection(true);
    await settle();
    await settle();
    expect(calls("PATCH", "do-not-chase")).toHaveLength(0);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("does not send a pause when the connection drops while the CSRF token is pending", async () => {
    clearCsrfToken();
    let releaseCsrf!: (res: Response) => void;
    const pendingCsrf = new Promise<Response>((resolve) => (releaseCsrf = resolve));
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) =>
      String(url).includes("/api/csrf-token") ? pendingCsrf : respond(url, init)
    );
    await openPauseItem();

    // Started online: the request is now waiting for its CSRF token.
    setConnection(true);
    await clickPause();
    await waitFor(() => calls("GET", "/api/csrf-token").length === 1);
    expect(toast).not.toHaveBeenCalled();

    setConnection(false);
    await act(async () => releaseCsrf(json({ csrfToken: "t" })));
    await waitFor(() => toast.mock.calls.length > 0);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: en["invoices.reminders.pauseOffline"],
      variant: "destructive",
    });
    expect(calls("PATCH", "do-not-chase")).toHaveLength(0);

    setConnection(true);
    await settle();
    await settle();
    expect(calls("PATCH", "do-not-chase")).toHaveLength(0);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("separates a server refusal from an unconfirmed network failure", async () => {
    await openPauseItem();

    patchResponse = async () => json({ message: "Invoice is locked" }, 409);
    await clickPause();
    expect(toast.mock.calls.at(-1)![0].title).toBe(en["invoices.reminders.pauseError"]);
    expect(calls("PATCH", "do-not-chase")).toHaveLength(1);

    const overdueFetches = calls("GET", "/api/chasing/overdue/").length;
    patchResponse = async () => {
      throw new TypeError("Failed to fetch");
    };
    await clickPause();
    expect(toast.mock.calls.at(-1)![0].title).toBe(en["invoices.reminders.pauseUnconfirmed"]);
    expect(toast.mock.calls.at(-1)![0].title).not.toBe(en["invoices.reminders.pauseError"]);
    await waitFor(() => calls("GET", "/api/chasing/overdue/").length > overdueFetches);
  });
});
