// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNamespaces, t, useI18n } from "@/lib/i18n";
import YearEndCloseCard from "@/pages/month-end/YearEndCloseCard";
import { yearEndRecovery } from "@/pages/month-end/yearEndRecovery";

// Simulates the Arabic yearEndClose catalog chunk failing to load (English loads normally).
vi.mock("@/locales/ar/yearEndClose.json", () => {
  throw new Error("catalog chunk failed");
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
  useI18n.setState({ locale: "en" });
});

describe("year-end card catalog failure", () => {
  it("switching to a failing Arabic catalog replaces the English form with localized failure copy", async () => {
    const reload = vi.spyOn(yearEndRecovery, "reload").mockImplementation(() => undefined);
    const client = new QueryClient();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    unmount = () => {
      act(() => root.unmount());
      client.clear();
      container.remove();
    };

    // English catalogs load, so the English form renders first.
    await loadNamespaces("en", ["yearEndClose", "monthEnd", "launchProof"]);
    useI18n.setState({ locale: "en" });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(YearEndCloseCard, {
            companyId: "company-1",
            fyStartMonth: null,
            postYearEndClosingEntry: false,
          })
        )
      );
    });
    await vi.waitFor(() => {
      expect(document.querySelector("#fiscal-year-end")).not.toBeNull();
    });
    expect(document.querySelector('[data-testid="year-end-close-error"]')).toBeNull();

    // Switch with the real store action; its implicit load must not reject unhandled.
    await act(async () => {
      useI18n.getState().setLocale("ar");
    });
    // Deterministic sync: await the exact expected Arabic load rejection (no broad wait),
    // then flush React so the card observes the failure and renders the fallback.
    await act(async () => {
      await expect(loadNamespaces("ar", ["yearEndClose"])).rejects.toThrow();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const failure = await vi.waitFor(
      () => {
        const el = document.querySelector('[data-testid="year-end-close-error"]');
        expect(el).not.toBeNull();
        return el!;
      },
      { timeout: 5000 }
    );

    // No skeleton and no mixed-language form: the English form is gone.
    expect(document.querySelector('[data-testid="year-end-close-skeleton"]')).toBeNull();
    expect(document.querySelector("#fiscal-year-end")).toBeNull();
    expect(document.querySelector("#year-end-reason")).toBeNull();

    const copy = t.ar;
    expect(failure.querySelector('[role="alert"]')?.textContent).toBe(copy.yearEndCloseUnavailable);
    const retry = failure.querySelector("button")!;
    expect(retry.textContent).toBe(copy.yearEndCloseReload);
    expect(reload).not.toHaveBeenCalled();
    await act(async () => retry.click());
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
