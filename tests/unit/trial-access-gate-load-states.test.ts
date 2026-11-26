// @vitest-environment jsdom
// Review 6059230576 on PR 156: what the gate and Billing show while the plan is unknown. Real
// React Query, real hooks; only the signed-in user, the company and the network are stubbed.
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TrialAccessGate } from "../../client/src/components/billing/TrialAccessGate";
import Subscription from "../../client/src/pages/Subscription";
import { loadLocale } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = vi.hoisted(() => ({
  user: { id: "viewer" } as Record<string, unknown>,
  companyError: null as Error | null,
}));
vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: session.user }),
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company", companies: [], error: session.companyError }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true }),
}));
// The settings navigation is not under test.
vi.mock("../../client/src/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => children,
}));

type Endpoint = "subscription" | "usage" | "documents";
const status: Record<Endpoint, number> = { subscription: 200, usage: 200, documents: 200 };
const bodies: Record<Endpoint, unknown> = {
  subscription: {
    subscription: { planId: "starter", status: "active", billingCycle: "monthly" },
    entitlement: { state: "active", planId: "starter", features: null },
    limits: {},
    enforcement: true,
    trialLocked: false,
    checkoutAvailable: true,
  },
  usage: {
    plan: "starter",
    usage: {
      invoices: { used: 3, limit: 10 },
      receipts: { used: 1, limit: 10 },
      aiCredits: { used: 2, limit: 10 },
      users: { used: 1, limit: -1 },
      storage: { used: null, limit: 1024 },
    },
  },
  documents: [],
};
const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const name = String(input).split("/billing/")[1] as Endpoint;
  const code = status[name] ?? 404;
  return code === 200
    ? Response.json(bodies[name])
    : Response.json({ message: "Unavailable" }, { status: code });
});
const requested = () => fetchMock.mock.calls.map((call) => String(call[0]).split("/billing/")[1]);

beforeAll(async () => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // jsdom does not lay out pages.
  Element.prototype.scrollIntoView ??= () => {};
  await loadLocale("en");
});
beforeEach(() => {
  session.user = { id: "viewer" };
  session.companyError = null;
  Object.assign(status, { subscription: 200, usage: 200, documents: 200 });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", "/subscription");
});
afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
});

async function mount(element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, element));
  });
  const find = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const settle = (check: () => void) =>
    vi.waitFor(
      async () => {
        await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
        check();
      },
      { timeout: 5000 }
    );
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
    client.clear();
  };
  return { client, container, find, settle, unmount };
}

const workspace = () => createElement("div", { "data-testid": "workspace" });
const gate = () =>
  createElement(TrialAccessGate, {
    billing: createElement(Subscription),
    children: workspace(),
  });
/** The Billing page as the unlocked workspace shows it. */
const billingPage = () => createElement(TrialAccessGate, { children: createElement(Subscription) });

const click = (button: HTMLElement) => act(async () => button.click());

describe("PR156 plan load states", () => {
  it("PR156-1: a failed first load on /subscription shows the Billing error and retries the query", async () => {
    status.subscription = 503;
    const view = await mount(gate());
    try {
      await view.settle(() => expect(view.find("subscription-load-error")).not.toBeNull());
      expect(view.find("workspace")).toBeNull();

      status.subscription = 200;
      await click(view.find("subscription-load-error")!.querySelector("button")!);
      await view.settle(() => expect(view.find("workspace")).not.toBeNull());
    } finally {
      view.unmount();
    }
  });

  it.each(["/subscription", "/dashboard"])(
    "PR156-2: opening %s offline says so, keeps the gate closed and recovers",
    async (path) => {
      window.history.pushState({}, "", path);
      onlineManager.setOnline(false);
      const view = await mount(gate());
      try {
        await view.settle(() => expect(view.find("subscription-offline")).not.toBeNull());
        expect(view.find("workspace")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();

        await act(async () => onlineManager.setOnline(true));
        await view.settle(() => expect(view.find("workspace")).not.toBeNull());
      } finally {
        view.unmount();
      }
    }
  );

  it("PR156-2: an exempt customer offline sees no empty states, then the plan", async () => {
    session.user = { id: "staff", isAdmin: true };
    onlineManager.setOnline(false);
    const view = await mount(billingPage());
    try {
      await view.settle(() => expect(view.find("subscription-offline")).not.toBeNull());
      expect(view.find("card-current-plan")).toBeNull();
      expect(view.container.textContent).not.toContain("No paid invoices yet.");

      await act(async () => onlineManager.setOnline(true));
      await view.settle(() => {
        expect(view.find("card-current-plan")?.dataset.planState).toBe("active");
        expect(view.container.textContent).toContain("No paid invoices yet.");
      });
    } finally {
      view.unmount();
    }
  });

  it("PR156-2: a retry waiting for focus while online never claims to be offline", async () => {
    focusManager.setFocused(false);
    status.subscription = 503;
    const view = await mount(gate());
    try {
      await view.settle(() =>
        expect(
          view.client.getQueryState(["/api/companies", "company", "billing", "subscription"])
            ?.fetchStatus
        ).toBe("paused")
      );
      expect(view.find("subscription-offline")).toBeNull();
      expect(view.find("subscription-load-error")).toBeNull();
      expect(view.find("workspace")).toBeNull();

      status.subscription = 200;
      await act(async () => focusManager.setFocused(true));
      await view.settle(() => expect(view.find("workspace")).not.toBeNull());
    } finally {
      view.unmount();
    }
  });

  it("PR156-2: the subscription request carries React Query's abort signal", async () => {
    const view = await mount(gate());
    try {
      await view.settle(() => expect(view.find("workspace")).not.toBeNull());
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      view.unmount();
    }
  });

  it.each(["subscription", "usage", "documents"] as const)(
    "PR156-3: a failed %s refresh keeps the cached values and Retry reloads only that query",
    async (endpoint) => {
      const view = await mount(billingPage());
      const cached = () => {
        expect(view.find("card-current-plan")?.dataset.planState).toBe("active");
        expect(view.find("usage-invoices")?.textContent).toContain("3 / 10");
        expect(view.container.textContent).toContain("No paid invoices yet.");
      };
      try {
        await view.settle(cached);

        status[endpoint] = 503;
        await act(async () => {
          await view.client.refetchQueries({
            queryKey: ["/api/companies", "company", "billing", endpoint],
          });
        });
        await view.settle(() => expect(view.find("billing-refresh-failed")).not.toBeNull());
        cached();
        expect(view.find("subscription-load-error")).toBeNull();

        status[endpoint] = 200;
        fetchMock.mockClear();
        await click(view.find("billing-refresh-failed")!.querySelector("button")!);
        await view.settle(() => expect(view.find("billing-refresh-failed")).toBeNull());
        expect(requested()).toEqual([endpoint]);
      } finally {
        view.unmount();
      }
    }
  );

  it("PR156-3: documents are empty only after a successful empty response", async () => {
    status.documents = 404;
    const view = await mount(billingPage());
    try {
      await view.settle(() => expect(view.find("billing-documents-load-error")).not.toBeNull());
      expect(view.container.textContent).not.toContain("No paid invoices yet.");
    } finally {
      view.unmount();
    }
  });

  it("PR156-3: a missing usage response shows no meters rather than zeros", async () => {
    status.usage = 404;
    const view = await mount(billingPage());
    try {
      await view.settle(() => {
        expect(view.find("card-current-plan")).not.toBeNull();
        expect(view.find("card-usage")).toBeNull();
      });
      expect(view.find("usage-invoices")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it("PR156-4: the linked plan gets focus once a retry recovers the page", async () => {
    session.user = { id: "staff", isAdmin: true };
    window.history.pushState({}, "", "/subscription?choose=professional");
    status.subscription = 503;
    const view = await mount(billingPage());
    try {
      await view.settle(() => expect(view.find("subscription-load-error")).not.toBeNull());

      status.subscription = 200;
      await click(view.find("subscription-load-error")!.querySelector("button")!);
      await view.settle(() =>
        expect((document.activeElement as HTMLElement | null)?.dataset.testid).toBe(
          "plan-upgrade-professional"
        )
      );
    } finally {
      view.unmount();
    }
  });

  it("PR156-3: a company-list refresh failure keeps the cached workspace open", async () => {
    window.history.pushState({}, "", "/dashboard");
    session.companyError = new Error("refresh failed");
    const view = await mount(gate());
    try {
      await view.settle(() => expect(view.find("workspace")).not.toBeNull());
    } finally {
      view.unmount();
    }
  });
});
