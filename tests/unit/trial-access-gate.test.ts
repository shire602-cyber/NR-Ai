// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TrialAccessGate } from "../../client/src/components/billing/TrialAccessGate";
import { loadLocale } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { id: "viewer" } }),
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company", companies: [] }),
}));

beforeAll(() => loadLocale("en"));
afterEach(() => vi.unstubAllGlobals());

describe("trial gate with the billing subscription endpoint", () => {
  it.each([
    { status: 404, body: { message: "Not found" }, visible: "workspace" },
    { status: 503, body: { message: "Unavailable" }, visible: "unavailable" },
    { status: 200, body: { trialLocked: false }, visible: "workspace" },
    { status: 200, body: { trialLocked: true }, visible: "trial-lock-screen" },
  ])("shows $visible when billing responds with $status", async ({ status, body, visible }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status }))
    );
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
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
              children: createElement("div", { "data-testid": "workspace" }, "Workspace"),
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
        visible === "workspace"
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      client.clear();
    }
  });
});
