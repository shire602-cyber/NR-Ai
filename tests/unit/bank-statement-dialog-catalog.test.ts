// @vitest-environment jsdom
/**
 * The statement dialog body reads the on-demand `bankStatement` catalog: the app-wide load leaves
 * it out, and a failed chunk stays inside the dialog (manual reload, never raw keys).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, t, useI18n } from "@/lib/i18n";
import { StatementDialog } from "@/pages/bank-accounts/StatementDialog";

// Simulates the Arabic bankStatement catalog chunk failing to load; everything else is real.
vi.mock("@/locales/ar/bankStatement.json", () => {
  throw new Error("catalog chunk failed");
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await loadLocale("en");
  await loadLocale("ar");
}, 90_000);

afterEach(() => {
  unmount?.();
  useI18n.setState({ locale: "en" });
});

async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async () => [] } },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  unmount = () => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  };
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(StatementDialog, {
          companyId: "company-1",
          account: { id: "a1", nameEn: "Operating" },
          onClose: () => undefined,
        })
      )
    );
  });
}

async function expectContainedFailure() {
  const alert = await vi.waitFor(
    () => {
      const el = document.querySelector('[role="dialog"] [role="alert"]');
      expect(el).not.toBeNull();
      return el!;
    },
    { timeout: 10_000 }
  );
  expect(alert.textContent).toContain(t.ar["components.errorSectionCouldNotLoad"]);
  expect(alert.querySelector("button")?.textContent).toBe(t.ar["components.errorRetry"]);
  expect(document.getElementById("st-close")).toBeNull();
  expect(document.body.textContent).not.toContain("bankStatement.");
}

describe("statement dialog catalog", () => {
  it("is left out of the app-wide load and arrives with the dialog body", async () => {
    expect(t.en["bankStatement.history"]).toBeUndefined();
    await open();
    await vi.waitFor(
      () =>
        expect(
          document.getElementById("st-close"),
          document.querySelector('[role="dialog"]')?.textContent ?? "no dialog"
        ).not.toBeNull(),
      { timeout: 10_000 }
    );
    expect(document.body.textContent).toContain(t.en["bankStatement.history"]);

    // A language switch while open onto a failing catalog replaces the form, not with raw keys.
    await act(async () => useI18n.getState().setLocale("ar"));
    await expectContainedFailure();
  }, 30_000);

  it("opening with a failing catalog offers a manual reload inside the dialog", async () => {
    useI18n.setState({ locale: "ar" });
    await open();
    await expectContainedFailure();
  }, 30_000);
});
