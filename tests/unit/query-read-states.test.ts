// @vitest-environment jsdom
/**
 * PR #176 review: lists and counts must tell "loading", "failed", "empty" and "refresh failed
 * with cached rows" apart. Each test renders the real page against stubbed API responses.
 */
import { createElement, act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient as client } from "../../client/src/lib/queryClient";

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
type Route = Reply | ((init?: RequestInit) => Reply | Promise<Reply>);

let container: HTMLDivElement;
let root: Root;
const defaultOptions = client.getDefaultOptions();
let routes: Record<string, Route> = {};

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
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const route = routes[path] ?? { body: [] };
      const reply = typeof route === "function" ? await route(init) : route;
      if (reply === "never") return new Promise<Response>(() => {});
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  client.setDefaultOptions({
    queries: { queryFn: defaultOptions.queries?.queryFn, retry: false },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  client.clear();
  client.setDefaultOptions(defaultOptions);
  onlineManager.setOnline(true);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

/** Radix tabs activate on mousedown. */
async function openTab(name: string) {
  const tab = document.querySelector(`[role="tab"][aria-controls$="-content-${name}"]`);
  expect(tab).not.toBeNull();
  await act(async () => {
    tab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await flush();
}

async function clickButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === label
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
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
    // Lost access is not a stale read: cached rows must not be shown.
    for (const status of [401, 403]) {
      expect(queryReadState({ data: [], isError: true, error: new ApiError("no", status) })).toBe(
        "error"
      );
    }
  });

  it("drops cached rows when access is revoked, and restores them on a later success", async () => {
    const { queryReadState } = await import("../../client/src/lib/queryReadState");
    const scoped = ["/api/companies", "c-1", "documents"];
    const unscoped = ["/api/firm/staff"];
    const url = "/api/companies/c-1/documents";
    const read = async (queryKey: string[]) => {
      await client.fetchQuery({ queryKey, staleTime: 0 }).catch(() => undefined);
      const state = client.getQueryState(queryKey)!;
      return {
        data: state.data,
        error: state.error,
        view: queryReadState({
          data: state.data,
          isError: state.status === "error",
          error: state.error,
        }),
      };
    };

    for (const status of [401, 403, 404]) {
      routes[url] = { body: [{ id: "d1" }] };
      expect((await read(scoped)).view).toBe("ready");
      routes[url] = failed;
      expect(await read(scoped)).toMatchObject({ view: "stale", data: [{ id: "d1" }] });
      routes[url] = { status, body: { message: "gone" } };
      const revoked = await read(scoped);
      expect(revoked.view).toBe("error");
      expect(revoked.data).toBeUndefined();
      expect(revoked.error).toMatchObject({ status });
      expect(client.getQueryState(scoped)!.isInvalidated).toBe(true);
    }
    routes[url] = { body: [{ id: "d2" }] };
    expect(await read(scoped)).toMatchObject({ view: "ready", data: [{ id: "d2" }] });

    // A 404 outside a tenant path is an ordinary failed refresh.
    routes["/api/firm/staff"] = { body: [] };
    await read(unscoped);
    routes["/api/firm/staff"] = { status: 404, body: { message: "missing" } };
    expect(await read(unscoped)).toMatchObject({ view: "stale", data: [] });
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

  it("drops cached documents when a refresh is 403: access copy, no old count, no stale notice", async () => {
    routes[documents] = { body: [{ id: "d1" }, { id: "d2" }] };
    await mount(await load());
    expect(byTestId("client-documents-count")?.textContent).toBe("2");
    routes[documents] = { status: 403, body: { message: "forbidden" } };
    await refresh();
    const t = await catalog();
    expect(byTestId("client-documents-count")?.textContent).not.toBe("2");
    expect(byTestId("client-dashboard-stale")).toBeNull();
    expect(text()).toContain(t.en["firm.loadForbiddenBody"]);
  });
});

describe("firm list read states", () => {
  const staffUrl = "/api/firm/staff";
  const clientsUrl = "/api/firm/clients";
  const alertsUrl = "/api/firm/command-center/alerts";
  const comparisonUrl = "/api/firm/command-center/metrics/comparison";
  const alerts = [{ id: "a1", severity: "warning", message: "VAT deadline approaching" }];
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

  it("StaffManagement: distinguishes paused first reads from paused refreshes", async () => {
    const Page = (await import("../../client/src/pages/firm/StaffManagement")).default;
    const t = await catalog();
    onlineManager.setOnline(false);
    await mount(Page);
    expect(byTestId("staff-waiting")?.textContent).toBe(t.en["banking.query.paused"]);
    expect(text()).not.toContain(t.en["pages.loadingStaff"]);

    await act(async () => client.setQueryData([staffUrl], staff));
    await flush();
    expect(byTestId("staff-paused-cached")?.textContent).toBe(t.en["banking.query.pausedCached"]);
    expect(byTestId("staff-clients-waiting")?.textContent).toBe(t.en["banking.query.paused"]);
    expect(byTestId("staff-client-count")?.textContent).toBe("—");
    expect(text()).toContain("Sara Staff");

    await act(async () => client.setQueryData([clientsUrl], [{ id: "c-1" }]));
    await flush();
    expect(byTestId("staff-clients-paused-cached")?.textContent).toBe(
      t.en["banking.query.pausedCached"]
    );
    expect(byTestId("staff-client-count")?.textContent).toBe("1");
  });

  it("StaffManagement: cancels both lists before invalidating after an assignment", async () => {
    const Page = (await import("../../client/src/pages/firm/StaffManagement")).default;
    const t = await catalog();
    routes[staffUrl] = { body: staff };
    routes[clientsUrl] = { body: [{ id: "c-1", name: "Example Client", assignedStaff: [] }] };
    routes["/api/csrf-token"] = { body: { csrfToken: "test-token" } };
    const write = vi.fn(() => ({ body: {} }));
    routes["/api/firm/clients/c-1/assign-staff"] = write;
    const cancel = vi.spyOn(client, "cancelQueries");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await mount(Page);
    await act(async () => byTestId("firm-role-s1")?.closest("div")?.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click());
    await clickButton(t.en["pages.saveChanges"]);

    expect(write).toHaveBeenCalledOnce();
    for (const [index, url] of [staffUrl, clientsUrl].entries()) {
      expect(cancel).toHaveBeenNthCalledWith(index + 1, { queryKey: [url] });
      expect(invalidate).toHaveBeenNthCalledWith(index + 1, { queryKey: [url] });
      expect(cancel.mock.invocationCallOrder[index]).toBeLessThan(
        invalidate.mock.invocationCallOrder[index]
      );
    }
  });

  it("FirmCommandCenter: shows waiting first and keeps rows with a paused refresh notice", async () => {
    const Page = (await import("../../client/src/pages/FirmCommandCenter")).default;
    const t = await catalog();
    routes[comparisonUrl] = "never";
    routes[alertsUrl] = { body: alerts };
    onlineManager.setOnline(false);
    await mount(Page);
    await openTab("alerts");
    expect(byTestId("alerts-waiting")?.textContent).toBe(t.en["banking.query.paused"]);
    expect(byTestId("alerts-loading")).toBeNull();
    expect(text()).not.toContain(t.en["firmCommandCenter.noActiveAlertsClickRefresh"]);

    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(byTestId("alert-a1")).not.toBeNull();
    expect(byTestId("alerts-waiting")).toBeNull();

    await act(async () => {
      onlineManager.setOnline(false);
      await client.invalidateQueries({ queryKey: [alertsUrl] });
    });
    await flush();
    expect(byTestId("alerts-paused-cached")?.textContent).toBe(t.en["banking.query.pausedCached"]);
    expect(byTestId("alert-a1")).not.toBeNull();
  });

  it("FirmCommandCenter: aborts an in-flight first alerts read after Refresh Alerts writes", async () => {
    const Page = (await import("../../client/src/pages/FirmCommandCenter")).default;
    routes[comparisonUrl] = "never";
    let firstSignal: AbortSignal | null | undefined;
    let finishFirst!: (reply: Reply) => void;
    const firstRead = new Promise<Reply>((resolve) => {
      finishFirst = resolve;
    });
    routes[alertsUrl] = (init) => {
      firstSignal = init?.signal;
      return firstRead;
    };
    routes["/api/csrf-token"] = { body: { csrfToken: "test-token" } };
    routes[alertsUrl + "/refresh"] = () => {
      routes[alertsUrl] = { body: alerts };
      return { body: {} };
    };
    await mount(Page);
    await openTab("alerts");
    expect(byTestId("alerts-loading")).not.toBeNull();

    await act(async () => (byTestId("button-refresh-alerts") as HTMLButtonElement).click());
    await flush();
    expect(firstSignal?.aborted).toBe(true);
    expect(byTestId("alert-a1")).not.toBeNull();

    await act(async () => finishFirst({ body: [] }));
    await flush();
    expect(byTestId("alert-a1")).not.toBeNull();
  });

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

  it.each([
    ["Anthropic: provider unavailable; OpenAI: Empty OpenAI response", "ocrEmptyResponse"],
    ["Unable to save bulk OCR receipt", "ocrSaveFailed"],
    ["Unrecognized provider error", "ocrFailed"],
  ])("BulkOperations: localizes OCR error %s and result counts", async (error, errorKey) => {
    const Page = (await import("../../client/src/pages/firm/BulkOperations")).default;
    const { t, useI18n } = await import("../../client/src/lib/i18n");
    await act(async () => useI18n.getState().setLocale("ar"));
    routes["/api/firm/clients"] = { body: [{ id: "c-1", name: "شركة الاختبار" }] };
    routes["/api/csrf-token"] = { body: { csrfToken: "test-token" } };
    routes["/api/firm/bulk/ocr"] = (init) => ({
      body: {
        results: [
          JSON.parse(String(init?.body)).items[0].filename === "good.png"
            ? { success: true, receiptId: "r-1" }
            : { success: false, error },
        ],
      },
    });
    routes["/api/firm/bulk/period-close"] = {
      body: [
        {
          companyId: "c-1",
          companyName: "شركة الاختبار",
          period: "Q4 2026",
          checks: {
            trialBalanceOk: true,
            bankRecDone: false,
            allReceiptsPosted: false,
            vatPrepared: false,
          },
          issues: [
            "2 unposted receipt(s)",
            "3 unreconciled transaction(s)",
            "VAT return not prepared",
          ],
          readyToClose: false,
        },
      ],
    };
    await mount(Page);

    const input = document.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: ["good.png", "bad.png"].map(
        (name) => new File(["image"], name, { type: "image/png" })
      ),
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(text()).toContain("ملفان في الانتظار");
    await clickButton(t.ar["firmOps.bulkProcessAll"]);
    await vi.waitFor(() => {
      expect(text()).toContain("ملف واحد مكتمل");
      expect(text()).toContain("ملف واحد فاشل");
    });
    const failedRow = Array.from(document.querySelectorAll("tbody tr")).find((row) =>
      row.textContent?.includes("bad.png")
    );
    expect(failedRow?.querySelector("[title]")?.getAttribute("title")).toBe(
      t.ar[`components.srv.firm.bulk.${errorKey}`]
    );

    await act(async () => useI18n.getState().setLocale("en"));
    expect(failedRow?.querySelector("[title]")?.getAttribute("title")).toBe(
      t.en[`components.srv.firm.bulk.${errorKey}`]
    );
    expect(text()).toContain("2 files queued");
    expect(text()).toContain("1 file done");
    expect(text()).toContain("1 file failed");

    await act(async () => useI18n.getState().setLocale("ar"));
    await openTab("close");
    await clickButton(t.ar["firmOps.bulkRunChecklist"]);
    expect(text()).toContain("3 ملاحظات");
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

  it("EmailIntake: opens the lazy completeness form in Arabic", async () => {
    const Page = (await import("../../client/src/pages/firm/EmailIntake")).default;
    const { useI18n } = await import("../../client/src/lib/i18n");
    useI18n.getState().setLocale("ar");
    await mount(Page);
    expect(byTestId("select-completeness-client")).toBeNull();

    const tab = byTestId("tab-completeness")!;
    await act(async () => {
      tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      await import("../../client/src/pages/firm/EmailIntakeCompletenessTab");
    });
    await flush();

    const t = await catalog();
    expect(byTestId("select-completeness-client")?.getAttribute("aria-label")).toBe(
      t.ar["pages.client"]
    );
    expect(text()).toContain(t.ar["pages.checkAPeriodForMissingDocuments"]);
  }, 15_000);

  it("EmailIntake: keeps other tabs available and retries a failed completeness import", async () => {
    const Page = (await import("../../client/src/pages/firm/EmailIntake")).default;
    const { t, useI18n } = await import("../../client/src/lib/i18n");
    const modulePath = "../../client/src/pages/firm/EmailIntakeCompletenessTab";
    vi.doMock(modulePath, () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    try {
      await mount(Page);
      await openTab("completeness");
      const error = () => byTestId("email-intake-completeness-error");
      expect(error()?.textContent).toContain(t.en["emailIntake.completenessLoadFailed"]);
      await openTab("tasks");
      expect(byTestId("email-task-boundary")).not.toBeNull();
      await openTab("senders");
      expect(byTestId("button-add-sender")).not.toBeNull();

      await act(async () => useI18n.getState().setLocale("ar"));
      await openTab("completeness");
      expect(error()?.textContent).toContain(t.ar["emailIntake.completenessLoadFailed"]);
      expect(error()?.querySelector("button")?.textContent).toBe(t.ar["components.errorRetry"]);

      vi.doUnmock(modulePath);
      await clickButton(t.ar["components.errorRetry"]);
      expect(error()).toBeNull();
      expect(byTestId("select-completeness-client")).not.toBeNull();
    } finally {
      vi.doUnmock(modulePath);
    }
  });

  it("EmailIntake: reloads on request when the completeness import keeps failing", async () => {
    const Page = (await import("../../client/src/pages/firm/EmailIntake")).default;
    const { t, useI18n } = await import("../../client/src/lib/i18n");
    const modulePath = "../../client/src/pages/firm/EmailIntakeCompletenessTab";
    const rejectImport = vi.fn(() => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    const reload = vi.fn();
    // jsdom's Location methods are non-configurable, so substitute window's location for the test.
    vi.stubGlobal("window", Object.create(window, { location: { value: { reload } } }));
    vi.doMock(modulePath, rejectImport);
    try {
      useI18n.getState().setLocale("ar");
      await mount(Page);
      await openTab("completeness");
      const error = () => byTestId("email-intake-completeness-error");
      expect(error()?.textContent).toContain(t.ar["emailIntake.completenessLoadFailed"]);

      await clickButton(t.ar["components.errorRetry"]);
      expect(rejectImport).toHaveBeenCalledTimes(2);
      expect(error()?.textContent).toContain(t.ar["emailIntake.completenessLoadFailed"]);

      await openTab("tasks");
      expect(byTestId("email-task-boundary")).not.toBeNull();
      await openTab("senders");
      expect(byTestId("button-add-sender")).not.toBeNull();
      await openTab("completeness");
      expect(error()?.textContent).toContain(t.ar["emailIntake.completenessReload"]);
      expect(reload).not.toHaveBeenCalled();
      await clickButton(t.ar["emailIntake.completenessReload"]);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock(modulePath);
    }
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

  const openQueueTab = () => openTab("queue");

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

  it("keeps the requirements list with a warning when a refresh fails", async () => {
    await mount(await load());
    routes[queue] = failed;
    routes[requirements] = failed;
    await refresh();
    expect(byTestId("document-chasing-error")).toBeNull();
    expect(byTestId("requirements-stale")).not.toBeNull();
  });

  it("keeps cached queue rows and blocks bulk send until the queue refresh succeeds", async () => {
    const queued = {
      body: [
        {
          requirement: { id: "r-1", documentType: "trade_license", dueDate: "2026-01-01" },
          nextLevel: "friendly",
          daysOverdue: 1,
        },
      ],
    };
    routes[queue] = queued;
    await mount(await load());
    await openQueueTab();
    const bulkButton = () => byTestId("btn-bulk-send") as HTMLButtonElement;
    expect(bulkButton().disabled).toBe(false);
    expect(byTestId("row-queue-item")).not.toBeNull();

    await act(async () => bulkButton().click());
    const confirmButton = () =>
      document.querySelector<HTMLButtonElement>('[role="alertdialog"] button:last-child');
    expect(confirmButton()?.disabled).toBe(false);

    let finishRefresh!: (reply: Reply) => void;
    const pendingRefresh = new Promise<Reply>((resolve) => {
      finishRefresh = resolve;
    });
    routes[queue] = () => pendingRefresh;
    let refreshDone!: Promise<void>;
    await act(async () => {
      refreshDone = client.refetchQueries({
        queryKey: ["/api/companies", "c-1", "document-chases", "queue"],
      });
    });
    await flush();
    expect(bulkButton().disabled).toBe(true);
    expect(confirmButton()?.disabled).toBe(true);
    expect(byTestId("row-queue-item")).not.toBeNull();
    expect(byTestId("queue-stale")).toBeNull();

    await act(async () => {
      finishRefresh(failed);
      await refreshDone;
    });
    await flush();
    expect(bulkButton().disabled).toBe(true);
    expect(confirmButton()?.disabled).toBe(true);
    expect(byTestId("queue-stale")).not.toBeNull();
    expect(byTestId("row-queue-item")).not.toBeNull();

    routes[queue] = queued;
    await refresh();
    expect(bulkButton().disabled).toBe(false);
    expect(confirmButton()?.disabled).toBe(false);
    expect(byTestId("queue-stale")).toBeNull();
  });

  it("renders Arabic day units in a recurring requirement", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    await act(async () => useI18n.getState().setLocale("ar"));
    await mount(await load());
    await act(async () => (byTestId("btn-add-requirement") as HTMLButtonElement).click());
    await act(async () => document.querySelector<HTMLButtonElement>("#isRecurring")!.click());
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const [count, unit] of [
      ["1", "يوم"],
      ["2", "يومان"],
      ["3", "أيام"],
      ["11", "يومًا"],
    ]) {
      await act(async () => {
        setValue.call(input, count);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(byTestId("recurring-interval-unit")?.textContent).toBe(unit);
    }
  });

  it("calendar and effectiveness: failure with retry, then cached rows marked stale", async () => {
    const calendar = "/api/companies/c-1/compliance-calendar";
    const t = await catalog();
    routes[calendar] = failed;
    routes[effectiveness] = failed;
    await mount(await load());

    await openTab("calendar");
    expect(byTestId("events-error")?.querySelector("button")).toBeTruthy();
    expect(byTestId("events-stale")).toBeNull();
    await openTab("metrics");
    expect(byTestId("effectiveness-error")?.querySelector("button")).toBeTruthy();
    expect(text()).not.toContain(t.en["documentChasing.totalChased"]);
    expect(text()).not.toContain(t.en["documentChasing.responseRate2"]);

    routes[calendar] = {
      body: [
        {
          id: "e1",
          eventType: "vat_return",
          description: "Quarterly VAT return",
          eventDate: "2030-01-01",
          reminderDays: "7",
          status: "pending",
        },
      ],
    };
    routes[effectiveness] = {
      body: { totalChased: 4, totalReceived: 3, responseRate: 0.75, avgDaysToUpload: 2 },
    };
    await refresh();
    expect(text()).toContain(t.en["documentChasing.totalChased"]);

    routes[calendar] = failed;
    routes[effectiveness] = failed;
    await refresh();
    // Kept metrics are labelled stale on the tab and next to the response-rate tile.
    expect(byTestId("effectiveness-stale")).not.toBeNull();
    expect(text()).toContain(t.en["firmOps.chaseResponseRateCached"]);
    expect(text()).toContain(t.en["documentChasing.totalChased"]);
    await openTab("calendar");
    expect(byTestId("events-stale")).not.toBeNull();
    expect(byTestId("row-event")).not.toBeNull();
  });
});

describe("company-list read states", () => {
  it.each([
    {
      load: () => import("../../client/src/pages/DocumentChasing"),
      waitingId: "document-chasing-waiting",
      errorId: "document-chasing-company-error",
      emptyKey: "pages.noCompanySelected",
    },
    {
      load: () => import("../../client/src/pages/BackupRestore"),
      waitingId: "backups-company-waiting",
      errorId: "backups-company-error",
      emptyKey: "pageLabels.pleaseSelectACompanyToManageBackups",
    },
  ])("$errorId: only prompts for a company after a successful empty read", async (fixture) => {
    const Page = (await fixture.load()).default;
    const t = await catalog();
    const retryCompanyList = vi.fn();

    company.value = { companyListState: "waiting" };
    await mount(Page);
    expect(byTestId(fixture.waitingId)).not.toBeNull();
    expect(text()).not.toContain(t.en[fixture.emptyKey]);

    company.value = { companyListState: "error", error: new Error("failed"), retryCompanyList };
    await mount(Page);
    const retry = byTestId(fixture.errorId)?.querySelector("button");
    expect(retry).toBeTruthy();
    expect(text()).not.toContain(t.en[fixture.emptyKey]);
    await act(async () => retry!.click());
    expect(retryCompanyList).toHaveBeenCalledOnce();

    company.value = { companyListState: "empty" };
    await mount(Page);
    expect(byTestId(fixture.errorId)).toBeNull();
    expect(text()).toContain(t.en[fixture.emptyKey]);
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
