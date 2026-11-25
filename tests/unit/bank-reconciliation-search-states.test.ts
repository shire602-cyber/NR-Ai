// @vitest-environment jsdom
/**
 * Bank reconciliation UX: a search with no hits says so (and offers "clear search") instead of
 * showing the "No bank transactions / import a statement" empty state, in English and Arabic.
 * Also pins the empty-state precedence (selected account, hidden reconciled rows, normalized
 * query) and the match dialog's offline / empty / failed-refresh states (real React Query).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthHint, setAuthHint } from "../../client/src/lib/authHint";
import enBanking from "../../client/src/locales/en/banking.json";
import arBanking from "../../client/src/locales/ar/banking.json";
import enCommon from "../../client/src/locales/en/common.json";
import arCommon from "../../client/src/locales/ar/common.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const baseTx = {
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
};

const suggestion = {
  bankTransactionId: "t-1",
  matchedType: "invoice",
  matchedId: "inv-1",
  confidence: 90,
  matchReason: "",
  matchedDescription: "INV-1042 ALPHA TRADING",
  matchedAmount: 42,
};

// Per-test fixtures read by the fetch stub.
let transactions: Array<Record<string, unknown>>;
let bankAccounts: Array<Record<string, unknown>>;
let suggestionsReply: () => Response;
let transactionsReply: () => Response | Promise<Response>;

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
  transactions = [{ ...baseTx, id: "t-1" }];
  bankAccounts = [];
  suggestionsReply = () => json([]);
  transactionsReply = () => json(transactions);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "Oasis" }]);
      if (url.endsWith("/bank-statements/transactions")) return transactionsReply();
      if (url.endsWith("/bank-accounts")) return json(bankAccounts);
      if (url.endsWith("/suggestions")) return suggestionsReply();
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  onlineManager.setOnline(true);
  clearAuthHint();
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

const flush = async (ticks = 12) => {
  for (let i = 0; i < ticks; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

async function mountPage(
  locale: "en" | "ar",
  prime?: (client: (typeof import("../../client/src/lib/queryClient"))["queryClient"]) => void
) {
  const i18n = await import("../../client/src/lib/i18n");
  await act(async () => i18n.useI18n.getState().setLocale(locale));
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  prime?.(queryClient);
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
  await flush();
  return queryClient;
}

async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('[data-testid="input-search"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function selectAccount(name: string) {
  const trigger = byTestId("select-bank-account")!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) =>
    o.textContent?.includes(name)
  )!;
  await act(async () => option.click());
  await flush(4);
}

async function openMatchDialog() {
  await act(async () => byTestId("button-match-t-1")!.click());
  await flush();
}

describe("bank reconciliation search no-match state", () => {
  const copy = {
    en: { banking: enBanking, common: enCommon },
    ar: { banking: arBanking, common: arCommon },
  } as const;
  for (const locale of ["en", "ar"] as const) {
    it(`shows a no-match state with clear-search (${locale})`, async () => {
      await mountPage(locale);
      await search("zzz-nothing");
      const state = byTestId("empty-state-bank-search");
      expect(state).not.toBeNull();
      expect(byTestId("empty-state-bank-transactions")).toBeNull();
      const banking = copy[locale].banking as Record<string, string>;
      expect(state!.textContent).toContain(banking["banking.noSearchMatchTitle"]);
      const clear = state!.querySelector<HTMLButtonElement>("button")!;
      expect(clear.textContent?.trim()).toBe(banking["banking.clearSearch"]);
      await act(async () => clear.click());
      expect(byTestId("empty-state-bank-search")).toBeNull();
      expect(document.body.textContent).toContain("ADCB");
    }, 60_000);
  }

  it("trims and case-normalizes the query for filtering and the empty state", async () => {
    await mountPage("en");
    await search("  adcb  ");
    expect(document.body.textContent).toContain("ADCB");
    expect(byTestId("empty-state-bank-search")).toBeNull();
    await search("   ");
    expect(document.body.textContent).toContain("ADCB");
    expect(byTestId("empty-state-bank-search")).toBeNull();
    await search("  ZZZ  ");
    expect(byTestId("empty-state-bank-search")).not.toBeNull();
  }, 60_000);

  it("does not claim a search miss when the selected account has no lines", async () => {
    bankAccounts = [
      { id: "a-1", nameEn: "Operating", bankName: "ADCB", currency: "AED", isActive: true },
      { id: "a-2", nameEn: "Savings", bankName: "FAB", currency: "AED", isActive: true },
    ];
    transactions = [{ ...baseTx, id: "t-1", bankStatementAccountId: "a-2" }];
    await mountPage("en");
    await selectAccount("Operating");
    await search("zzz-nothing");
    expect(byTestId("empty-state-bank-search")).toBeNull();
    expect(byTestId("empty-state-bank-transactions")).not.toBeNull();
  }, 60_000);

  it("keeps the all-reconciled state when only hidden reconciled rows remain, even while searching", async () => {
    transactions = [{ ...baseTx, id: "t-1", isReconciled: true, matchStatus: "matched" }];
    await mountPage("en");
    expect(byTestId("empty-state-all-reconciled")).not.toBeNull();
    await search("zzz-nothing");
    expect(byTestId("empty-state-all-reconciled")).not.toBeNull();
    expect(byTestId("empty-state-bank-search")).toBeNull();
  }, 60_000);
});

describe("bank reconciliation transactions offline state", () => {
  it("shows offline, not the import prompt, while the first transactions fetch is paused, then the real empty state after a successful empty reply", async () => {
    // Company and accounts are already cached and the browser is offline before the page mounts,
    // so the transactions request is paused before it ever runs: no data and no error.
    let reply!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => (reply = resolve));
    let calls = 0;
    transactionsReply = () => {
      calls += 1;
      return held;
    };
    await mountPage("en", (client) => {
      client.setQueryData(["/api/companies"], [{ id: "c-1", name: "Oasis" }]);
      client.setQueryData(["/api/companies", "c-1", "bank-accounts"], []);
      onlineManager.setOnline(false);
    });
    const offline = byTestId("bank-transactions-offline");
    expect(offline).not.toBeNull();
    expect(offline!.textContent).toContain(
      (enCommon as Record<string, string>)["common.errorHeading.offline"]
    );
    // Nothing to retry by hand: the paused query resumes on reconnect.
    expect(offline!.querySelector("button")).toBeNull();
    expect(byTestId("empty-state-bank-transactions")).toBeNull();
    expect(calls).toBe(0);

    // Back online but not yet answered: still no import prompt.
    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(calls).toBe(1);
    expect(byTestId("bank-transactions-offline")).toBeNull();
    expect(byTestId("empty-state-bank-transactions")).toBeNull();

    await act(async () => reply(json([])));
    await flush();
    expect(byTestId("empty-state-bank-transactions")).not.toBeNull();
  }, 60_000);
});

describe("bank reconciliation match dialog states", () => {
  it("shows the offline status, not 'no matches', when the first fetch never ran, then a real empty result after reconnect", async () => {
    await mountPage("en");
    onlineManager.setOnline(false);
    await openMatchDialog();
    expect(byTestId("match-suggestions-offline")).not.toBeNull();
    expect(byTestId("match-suggestions-offline")!.textContent).toBe(
      (enCommon as Record<string, string>)["common.errorHeading.offline"]
    );
    expect(byTestId("match-suggestions-empty")).toBeNull();
    const suggestionCalls = () =>
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
        String(u).endsWith("/suggestions")
      ).length;
    expect(suggestionCalls()).toBe(0);

    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(byTestId("match-suggestions-offline")).toBeNull();
    expect(byTestId("match-suggestions-empty")).not.toBeNull();
    expect(suggestionCalls()).toBeGreaterThan(0);
  }, 60_000);

  it("localizes the offline status in Arabic", async () => {
    await mountPage("ar");
    onlineManager.setOnline(false);
    await openMatchDialog();
    expect(byTestId("match-suggestions-offline")!.textContent).toBe(
      (arCommon as Record<string, string>)["common.errorHeading.offline"]
    );
  }, 60_000);

  it("keeps cached suggestions when a background refresh fails and retry recovers", async () => {
    suggestionsReply = () => json([suggestion]);
    const queryClient = await mountPage("en");
    await openMatchDialog();
    expect(document.body.textContent).toContain("INV-1042 ALPHA TRADING");
    expect(byTestId("match-suggestions-error")).toBeNull();

    // 4xx is not retried by the app's query client, so the refresh fails at once.
    suggestionsReply = () => json({ message: "boom" }, 404);
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["/api/companies", "c-1", "bank-statements", "t-1", "suggestions"],
      });
    });
    await flush(4);
    expect(byTestId("match-suggestions-error")).not.toBeNull();
    expect(document.body.textContent).toContain("INV-1042 ALPHA TRADING");
    expect(byTestId("match-suggestions-empty")).toBeNull();

    suggestionsReply = () =>
      json([{ ...suggestion, matchedId: "inv-2", matchedDescription: "BETA" }]);
    const retry = byTestId("match-suggestions-error")!.querySelector<HTMLButtonElement>("button")!;
    await act(async () => retry.click());
    await flush(4);
    expect(byTestId("match-suggestions-error")).toBeNull();
    expect(document.body.textContent).toContain("BETA");
  }, 60_000);

  it("shows the paused status, not the stale failure, and keeps cached rows when a retry pauses after a failed refresh", async () => {
    suggestionsReply = () => json([suggestion]);
    const queryClient = await mountPage("en");
    await openMatchDialog();
    suggestionsReply = () => json({ message: "boom" }, 404);
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["/api/companies", "c-1", "bank-statements", "t-1", "suggestions"],
      });
    });
    await flush(4);
    expect(byTestId("match-suggestions-error")).not.toBeNull();

    onlineManager.setOnline(false);
    const retry = byTestId("match-suggestions-error")!.querySelector<HTMLButtonElement>("button")!;
    await act(async () => retry.click());
    await flush(4);
    expect(byTestId("match-suggestions-offline")).not.toBeNull();
    expect(byTestId("match-suggestions-error")).toBeNull();
    expect(byTestId("match-suggestions-empty")).toBeNull();
    expect(document.body.textContent).toContain("INV-1042 ALPHA TRADING");

    suggestionsReply = () =>
      json([{ ...suggestion, matchedId: "inv-2", matchedDescription: "BETA" }]);
    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(byTestId("match-suggestions-offline")).toBeNull();
    expect(byTestId("match-suggestions-error")).toBeNull();
    expect(document.body.textContent).toContain("BETA");
  }, 60_000);

  it("shows the error with retry and no empty message when the first fetch fails", async () => {
    suggestionsReply = () => json({ message: "boom" }, 404);
    await mountPage("en");
    await openMatchDialog();
    expect(byTestId("match-suggestions-error")).not.toBeNull();
    expect(byTestId("match-suggestions-empty")).toBeNull();
  }, 60_000);
});
