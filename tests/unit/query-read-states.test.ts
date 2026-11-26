// @vitest-environment jsdom
/**
 * PR #176 review: lists and counts must tell "loading", "failed", "empty" and "refresh failed
 * with cached rows" apart. Each test renders the real page against stubbed API responses.
 */
import { createElement, act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { name: "Test User" } }),
}));

const company = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => company.value,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reply = { status?: number; body: unknown } | "never";

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let routes: Record<string, Reply> = {};

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);
const text = () => document.body.textContent ?? "";

async function catalog() {
  return (await import("../../client/src/lib/i18n")).t;
}

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  routes = {};
  company.value = { companyId: "c-1", companyListState: "ready", isLoading: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const reply = routes[path] ?? { body: [] };
      if (reply === "never") return new Promise<Response>(() => {});
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  const { getQueryFn } = await import("../../client/src/lib/queryClient");
  client = new QueryClient({
    defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  client.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(Component: ComponentType<any>, props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Component, props)));
  });
  await flush();
}

/** Refetch everything mounted, as a focus or reconnect would. */
async function refresh() {
  await act(async () => {
    await client.refetchQueries();
  });
  await flush();
}

const failed: Reply = { status: 500, body: { message: "boom" } };

describe("queryReadState", () => {
  it("separates pending, first-load failure, success and stale reads", async () => {
    const { queryReadState } = await import("../../client/src/lib/queryReadState");
    const { ApiError } = await import("../../client/src/lib/queryClient");
    const server = new ApiError("x", 500);
    expect(queryReadState({ data: undefined, isError: false })).toBe("pending");
    expect(queryReadState({ data: undefined, isError: true, error: server })).toBe("error");
    expect(queryReadState({ data: [], isError: false })).toBe("ready");
    expect(queryReadState({ data: [], isError: true, error: server })).toBe("stale");
    // Cached rows stay visible even when the failed refresh was a 403.
    expect(queryReadState({ data: [], isError: true, error: new ApiError("no", 403) })).toBe(
      "stale"
    );
  });
});

describe("ClientDashboard read states", () => {
  const documents = "/api/companies/c-1/documents";
  const tasks = "/api/companies/c-1/compliance-tasks";
  const load = async () => (await import("../../client/src/pages/ClientDashboard")).default;

  it("asks for a company only when the list is known to be empty", async () => {
    company.value = { companyId: undefined, companyListState: "empty" };
    await mount(await load());
    expect(byTestId("client-dashboard-no-company")).not.toBeNull();
  });

  it("shows no counts or empty copy while loading", async () => {
    routes[documents] = "never";
    routes[tasks] = "never";
    routes["/api/companies/c-1/journal"] = "never";
    await mount(await load());
    const t = await catalog();
    expect(byTestId("client-documents-count")).toBeNull();
    expect(byTestId("client-tasks-count")).toBeNull();
    expect(text()).not.toContain(t.en["pageLabels.noRecentUpdatesYet"]);
    expect(text()).not.toContain(t.en["pages.allClear"]);
    expect(text()).not.toContain(t.en["pageLabels.noUpcomingDeadlines"]);
  });

  it("shows empty copy and all clear after successful empty reads", async () => {
    await mount(await load());
    const t = await catalog();
    expect(byTestId("client-documents-count")?.textContent).toBe("0");
    expect(text()).toContain(t.en["pageLabels.noRecentUpdatesYet"]);
    expect(text()).toContain(t.en["pages.allClear"]);
    expect(text()).toContain(t.en["pageLabels.noUpcomingDeadlines"]);
  });

  it("shows a retryable failure instead of zero", async () => {
    routes[documents] = failed;
    await mount(await load());
    expect(byTestId("client-dashboard-load-error")).not.toBeNull();
    expect(byTestId("client-documents-count")?.textContent).toBe("—");
  });

  it("keeps the last count when a refresh fails", async () => {
    routes[documents] = { body: [{ id: "d1" }, { id: "d2" }] };
    await mount(await load());
    expect(byTestId("client-documents-count")?.textContent).toBe("2");
    routes[documents] = failed;
    await refresh();
    expect(byTestId("client-documents-count")?.textContent).toBe("2");
    expect(byTestId("client-dashboard-stale")).not.toBeNull();
  });
});

describe("firm list read states", () => {
  const staff = [
    {
      id: "s1",
      name: "Sara Staff",
      email: "sara@example.test",
      firmRole: "preparer",
      lastLoginAt: null,
      createdAt: "2026-01-01",
      assignedClients: [],
      assignedClientCount: 0,
    },
  ];

  it("StaffManagement: first-load failure, then cached rows on a failed refresh", async () => {
    const Page = (await import("../../client/src/pages/firm/StaffManagement")).default;
    routes["/api/firm/staff"] = failed;
    await mount(Page);
    const t = await catalog();
    expect(byTestId("staff-load-error")).not.toBeNull();
    expect(text()).not.toContain(t.en["pages.noStaffMembersFound"]);

    routes["/api/firm/staff"] = { body: staff };
    await refresh();
    expect(text()).toContain("Sara Staff");

    routes["/api/firm/staff"] = failed;
    await refresh();
    expect(text()).toContain("Sara Staff");
    expect(byTestId("staff-stale")).not.toBeNull();
  });

  it("StaffManagement: shows empty copy after a successful empty read", async () => {
    const Page = (await import("../../client/src/pages/firm/StaffManagement")).default;
    await mount(Page);
    const t = await catalog();
    expect(text()).toContain(t.en["pages.noStaffMembersFound"]);
  });

  it("BulkOperations: pending, then a retryable failure", async () => {
    const Page = (await import("../../client/src/pages/firm/BulkOperations")).default;
    routes["/api/firm/clients"] = "never";
    await mount(Page);
    expect(byTestId("bulk-clients-loading")).not.toBeNull();
    act(() => root.unmount());
    client.clear();
    root = createRoot(container);
    routes["/api/firm/clients"] = failed;
    await mount(Page);
    expect(byTestId("bulk-clients-error")).not.toBeNull();
  });

  it("EmailIntake: failure is not an empty list; status is localized in Arabic", async () => {
    const Page = (await import("../../client/src/pages/firm/EmailIntake")).default;
    const sources = "/api/firm/email-intake/sources";
    routes[sources] = failed;
    await mount(Page);
    const t = await catalog();
    expect(byTestId("email-intake-sources-error")).not.toBeNull();
    expect(text()).not.toContain(t.en["pages.noSendersLinkedYet"]);

    const { useI18n } = await import("../../client/src/lib/i18n");
    await act(async () => useI18n.getState().setLocale("ar"));
    routes[sources] = {
      body: {
        featureEnabled: true,
        mailboxConfigured: true,
        sources: [
          {
            id: "src-1",
            companyId: "c-1",
            senderEmail: "billing@example.test",
            label: null,
            status: "paused",
            requireDkimPass: true,
            createdAt: "2026-01-01",
          },
        ],
      },
    };
    await refresh();
    const row = byTestId("row-source-src-1");
    expect(row?.textContent).toContain(t.ar["firmOps.intakeStatusPaused"]);
    expect(row?.textContent).not.toContain("paused");
  });
});

describe("DocumentChasing handles its two lists independently", () => {
  const requirements = "/api/companies/c-1/document-requirements";
  const queue = "/api/companies/c-1/document-chases/queue";
  const effectiveness = "/api/companies/c-1/document-chases/effectiveness";

  beforeEach(() => {
    routes[effectiveness] = {
      body: { totalChased: 0, totalReceived: 0, responseRate: 0, avgDaysToUpload: null },
    };
  });

  const load = async () => (await import("../../client/src/pages/DocumentChasing")).default;

  /** Radix tabs activate on mousedown, not click. */
  async function openQueueTab() {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(
      (el) =>
        el.id.endsWith("-trigger-queue") ||
        el.getAttribute("aria-controls")?.endsWith("-content-queue")
    );
    expect(tab).toBeDefined();
    await act(async () => {
      tab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    await flush();
  }

  it("a failed queue does not block the requirements list", async () => {
    routes[queue] = failed;
    await mount(await load());
    const t = await catalog();
    expect(byTestId("document-chasing-error")).toBeNull();
    expect(text()).toContain(t.en["documentChasing.nothingMissingAllCaughtUp"]);
    await openQueueTab();
    expect(byTestId("queue-error")).not.toBeNull();
  });

  it("shows independent errors and retries when both lists fail", async () => {
    routes[queue] = failed;
    routes[requirements] = failed;
    await mount(await load());
    expect(byTestId("requirements-error")).not.toBeNull();
    expect(byTestId("requirements-error")?.querySelector("button")).toBeTruthy();
    await openQueueTab();
    expect(byTestId("queue-error")).not.toBeNull();
    expect(byTestId("queue-error")?.querySelector("button")).toBeTruthy();
  });

  it("keeps the page with a warning when a refresh fails", async () => {
    await mount(await load());
    routes[queue] = failed;
    routes[requirements] = failed;
    await refresh();
    expect(byTestId("document-chasing-error")).toBeNull();
    expect(byTestId("requirements-stale")).not.toBeNull();
  });
});

describe("UpgradePrompt", () => {
  it("names the target plan in the active language, in the body and the button", async () => {
    const { UpgradePrompt } = await import("../../client/src/components/UpgradePrompt");
    const { useI18n, formatMessage } = await import("../../client/src/lib/i18n");
    const t = await catalog();
    await act(async () => useI18n.getState().setLocale("ar"));
    await mount(UpgradePrompt, { feature: "payroll", requiredTier: "professional" });
    const plan = t.ar["marketing.prPlan_professional"];
    expect(text()).toContain(formatMessage(t.ar["components.upgradeAvailableOn"], { plan }));
    expect(document.querySelector("button")?.textContent).toBe(
      formatMessage(t.ar["components.upgradeTo"], { plan })
    );
    expect(text()).not.toContain("Professional");
  });
});
