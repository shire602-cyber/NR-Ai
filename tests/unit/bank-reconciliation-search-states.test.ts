// @vitest-environment jsdom
/**
 * Bank reconciliation UX: a search with no hits says so (and offers "clear search") instead of
 * showing the "No bank transactions / import a statement" empty state, in English and Arabic.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthHint, setAuthHint } from "../../client/src/lib/authHint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  setAuthHint();
  window.history.pushState({}, "", "/bank-reconciliation");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "Oasis" }]);
      if (url.endsWith("/bank-statements/transactions"))
        return json([
          {
            id: "t-1",
            companyId: "c-1",
            bankAccountId: null,
            bankStatementAccountId: null,
            transactionDate: "2026-06-13",
            description: "ADCB BANK CHARGE",
            amount: -42,
            balance: null,
            reference: "FEE-0613",
            category: null,
            matchStatus: "unmatched",
            isReconciled: false,
            matchedJournalEntryId: null,
            matchedReceiptId: null,
            matchedInvoiceId: null,
            matchConfidence: null,
            importSource: "csv",
            createdAt: "2026-06-13T00:00:00Z",
          },
        ]);
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  clearAuthHint();
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function mountPage(locale: "en" | "ar") {
  const i18n = await import("../../client/src/lib/i18n");
  await act(async () => i18n.useI18n.getState().setLocale(locale));
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  const { ActiveCompanyProvider } =
    await import("../../client/src/components/ActiveCompanyProvider");
  const { default: BankReconciliation } = await import("../../client/src/pages/BankReconciliation");
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ActiveCompanyProvider, null, createElement(BankReconciliation))
      )
    );
  });
  for (let i = 0; i < 12; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('[data-testid="input-search"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("bank reconciliation search no-match state", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`shows a no-match state with clear-search (${locale})`, async () => {
      await mountPage(locale);
      await search("zzz-nothing");
      expect(document.querySelector('[data-testid="empty-state-bank-search"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="empty-state-bank-transactions"]')).toBeNull();
      const clear = document.querySelector<HTMLButtonElement>(
        '[data-testid="empty-state-bank-search"] button'
      )!;
      await act(async () => clear.click());
      expect(document.querySelector('[data-testid="empty-state-bank-search"]')).toBeNull();
      expect(document.body.textContent).toContain("ADCB");
    }, 60_000);
  }
});
