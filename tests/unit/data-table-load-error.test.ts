// @vitest-environment jsdom
/**
 * Empty/error states: a failed list query must not read as an empty list. ListQueryTable shows
 * a cause-specific, translated error with Retry (never the raw message), in English and Arabic,
 * while a loading list still shows its skeleton and a healthy empty list its empty state.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListQueryTableProps } from "../../client/src/components/ui/list-query-table";

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

async function render(
  query: Partial<ListQueryTableProps["query"]>,
  children?: ListQueryTableProps["children"]
) {
  const { ListQueryTable } = await import("../../client/src/components/ui/list-query-table");
  act(() =>
    root.render(
      createElement(ListQueryTable, {
        query: {
          data: undefined,
          error: null,
          fetchStatus: "idle",
          isLoadingError: false,
          isRefetchError: false,
          refetch: vi.fn(),
          ...query,
        },
        rowCount: query.data?.length ?? 0,
        empty: { title: "No contacts yet", description: "Add your first contact." },
        children,
      })
    )
  );
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe("ListQueryTable initial load", () => {
  it("shows the failure with Retry instead of the empty state", async () => {
    const onRetry = vi.fn();
    await render({
      isLoadingError: true,
      error: new TypeError("Failed to fetch"),
      refetch: onRetry,
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
    await render({ isLoadingError: true, error: new TypeError("Failed to fetch") });
    expect(container.textContent).not.toMatch(/[A-Za-z]{4,}/);
  });

  it("keeps empty and loading states when nothing failed", async () => {
    await render({ data: [] });
    expect(container.textContent).toContain("No contacts yet");
    await render({ fetchStatus: "fetching" });
    expect(container.querySelector('[data-testid^="load-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="table-skeleton"]')).not.toBeNull();
  });

  it("keeps cached content and omits Retry for a forbidden refresh", async () => {
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    await render({ data: ["Oasis Trading"], isRefetchError: true, error }, "Oasis Trading");

    const notice = container.querySelector('[data-testid="stale-data-notice"]');
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(notice?.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Oasis Trading");
  });
});
