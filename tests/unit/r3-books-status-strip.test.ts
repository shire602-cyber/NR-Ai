// @vitest-environment jsdom
// R3 (CTO 23): the books-status strip renders the trial-balance and period-lock state it gets
// from the API, and renders nothing for an unexpected payload (as in form harness mocks).
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadLocale } from "../../client/src/lib/i18n";
import { BooksStatusStrip } from "../../client/src/components/reports/BooksStatusStrip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await loadLocale("en");
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function render(tb: unknown, lock: unknown) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, queryFn: () => new Promise(() => {}) },
    },
  });
  client.setQueryData(["/api/companies/c1/reports/trial-balance"], tb);
  client.setQueryData(["/api/companies/c1/period-lock"], lock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(BooksStatusStrip, { companyId: "c1" })
      )
    );
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

describe("BooksStatusStrip", () => {
  it("shows books balanced and the lock-through date", async () => {
    const el = await render(
      {
        to: "2026-11-16",
        totals: { sumDebits: 10, sumCredits: 10, difference: 0 },
        isBalanced: true,
      },
      { lockThroughDate: "2026-08-31" }
    );
    const balance = el.querySelector('[data-testid="books-status-balance"]')!;
    expect(balance.getAttribute("data-balanced")).toBe("true");
    expect(balance.textContent).toContain("Books balanced");
    expect(balance.textContent).toContain("16 Nov 2026");
    expect(el.querySelector('[data-testid="books-status-lock"]')!.textContent).toContain(
      "Locked through 31 Aug 2026"
    );
  });

  it("flags an out-of-balance trial balance and an unlocked ledger", async () => {
    const el = await render(
      {
        to: "2026-11-16",
        totals: { sumDebits: 10, sumCredits: 7.5, difference: 2.5 },
        isBalanced: false,
      },
      { lockThroughDate: null }
    );
    const balance = el.querySelector('[data-testid="books-status-balance"]')!;
    expect(balance.getAttribute("data-balanced")).toBe("false");
    expect(balance.textContent).toContain("Books out of balance");
    expect(balance.textContent).toContain("2.50");
    expect(el.querySelector('[data-testid="books-status-lock"]')!.textContent).toContain(
      "No period locked yet"
    );
  });

  it("renders nothing for unexpected payloads", async () => {
    const el = await render({ ok: true }, {});
    expect(el.querySelector('[data-testid="books-status-strip"]')).toBeNull();
  });
});
