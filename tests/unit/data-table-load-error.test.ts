// @vitest-environment jsdom
/**
 * Empty/error states: a failed list query must not read as an empty list. DataTableCard shows
 * a cause-specific, translated error with Retry (never the raw message), in English and Arabic,
 * while a loading list still shows its skeleton and a healthy empty list its empty state.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
});

async function render(props: Record<string, unknown>) {
  const { DataTableCard } = await import("../../client/src/components/ui/data-table");
  act(() =>
    root.render(
      createElement(DataTableCard, {
        empty: { title: "No contacts yet", description: "Add your first contact." },
        ...props,
      })
    )
  );
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe("DataTableCard loadError", () => {
  it("shows the failure with Retry instead of the empty state", async () => {
    const onRetry = vi.fn();
    await render({
      status: "empty",
      loadError: { error: new TypeError("Failed to fetch"), onRetry },
    });
    expect(container.textContent).not.toContain("No contacts yet");
    expect(container.textContent).not.toContain("Failed to fetch");
    expect(container.querySelector('[data-testid="load-error-offline"]')).not.toBeNull();
    const retry = container.querySelector("button") as HTMLButtonElement;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("is translated in Arabic", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    act(() => useI18n.getState().setLocale("ar"));
    await render({ status: "empty", loadError: { error: new TypeError("Failed to fetch") } });
    expect(container.textContent).not.toMatch(/[A-Za-z]{4,}/);
  });

  it("keeps empty and loading states when nothing failed", async () => {
    await render({ status: "empty", loadError: null });
    expect(container.textContent).toContain("No contacts yet");
    await render({ status: "loading", loadError: { error: new Error("x") } });
    expect(container.querySelector('[data-testid^="load-error"]')).toBeNull();
  });
});
