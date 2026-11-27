// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TrialAccessGate } from "../../client/src/components/billing/TrialAccessGate";
import { useCompanyPermission } from "../../client/src/hooks/useCompanyPermission";
import { loadLocale } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { id: "viewer" } }),
}));
const defaultCompany = vi.hoisted(() => ({
  state: { companyId: "company" as string | undefined, error: undefined as Error | undefined },
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ ...defaultCompany.state, companies: [], isLoading: false }),
}));

beforeAll(() => loadLocale("en"));
afterEach(() => {
  vi.unstubAllGlobals();
  defaultCompany.state = { companyId: "company", error: undefined };
  window.history.replaceState(null, "", "/");
});

function WorkspaceControls() {
  const { gate } = useCompanyPermission();
  return createElement(
    "div",
    { "data-testid": "workspace" },
    createElement("button", { "data-testid": "create-invoice", ...gate("documents.write") }),
    createElement("button", { "data-testid": "open-report", ...gate("reports.read") })
  );
}

describe("trial gate with the billing subscription endpoint", () => {
  it.each([
    { status: 404, body: { message: "Not found" }, visible: "workspace" },
    { status: 503, body: { message: "Unavailable" }, visible: "unavailable" },
    { status: 200, body: { trialLocked: false }, visible: "workspace" },
    { status: 200, body: { trialLocked: true }, visible: "trial-readonly-banner" },
  ])("shows $visible when billing responds with $status", async ({ status, body, visible }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status }))
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retryDelay: 0,
          queryFn: async () => ({ permissions: ["documents.write", "reports.read"] }),
        },
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(TrialAccessGate, {
              children: createElement(WorkspaceControls),
            })
          )
        );
      });
      await vi.waitFor(async () => {
        // React Query schedules observer updates after the cached result settles.
        await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
        if (visible === "unavailable") {
          expect(container.textContent).toContain("We couldn’t check your workspace access.");
        } else {
          expect(container.querySelector(`[data-testid="${visible}"]`)).not.toBeNull();
        }
      });
      expect(container.querySelector('[data-testid="workspace"]') !== null).toBe(
        visible !== "unavailable"
      );
      if (visible !== "unavailable") {
        const control = (name: string) =>
          container.querySelector<HTMLButtonElement>(`[data-testid="${name}"]`)!;
        expect(control("create-invoice").disabled).toBe(visible === "trial-readonly-banner");
        expect(control("open-report").disabled).toBe(false);
      }
    } finally {
      act(() => root.unmount());
      container.remove();
      client.clear();
    }
  });
});

describe("trial gate company-list failure recovery", () => {
  async function renderAt(path: string, billingStatus = 200) {
    window.history.replaceState(null, "", path);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ trialLocked: false }, { status: billingStatus }))
    );
    // The subscription query sets its own retry, so only the delay can be shortened here.
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(TrialAccessGate, {
            children: createElement("div", { "data-testid": "workspace" }),
          })
        )
      );
    });
    await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
    return {
      container,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
        client.clear();
      },
    };
  }
  const unavailable = "We couldn’t check your workspace access.";
  const waitForUnavailable = (container: HTMLElement) =>
    vi.waitFor(async () => {
      await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
      expect(container.textContent).toContain(unavailable);
    });

  it.each(["/vat-filing?period=q1", "/vat-filing/"])(
    "lets the VAT filing screen own a failed company list with no company at %s",
    async (path) => {
      defaultCompany.state = { companyId: undefined, error: new Error("companies failed") };
      const view = await renderAt(path);
      try {
        expect(view.container.querySelector('[data-testid="workspace"]')).not.toBeNull();
        expect(view.container.textContent).not.toContain(unavailable);
      } finally {
        view.cleanup();
      }
    }
  );

  it("still blocks a viewer on other routes when the company list failed", async () => {
    defaultCompany.state = { companyId: undefined, error: new Error("companies failed") };
    const view = await renderAt("/invoices");
    try {
      expect(view.container.querySelector('[data-testid="workspace"]')).toBeNull();
      expect(view.container.textContent).toContain(unavailable);
    } finally {
      view.cleanup();
    }
  });

  it("keeps the billing gate on the VAT route when a company exists", async () => {
    defaultCompany.state = { companyId: "company", error: new Error("stale company error") };
    const view = await renderAt("/vat-filing", 503);
    try {
      await waitForUnavailable(view.container);
      expect(view.container.querySelector('[data-testid="workspace"]')).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("blocks the VAT route when only the active company's billing check fails", async () => {
    const view = await renderAt("/vat-filing", 503);
    try {
      await waitForUnavailable(view.container);
      expect(view.container.querySelector('[data-testid="workspace"]')).toBeNull();
    } finally {
      view.cleanup();
    }
  });
});
