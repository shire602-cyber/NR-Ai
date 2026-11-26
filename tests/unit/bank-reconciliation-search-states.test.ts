// @vitest-environment jsdom
/**
 * Bank reconciliation UX: a search with no hits says so (and offers "clear search") instead of
 * showing the "No bank transactions / import a statement" empty state, in English and Arabic.
 * Also pins the empty-state precedence (selected account, hidden reconciled rows, normalized
 * query) and the match dialog's offline / empty / failed-refresh states (real React Query).
 * PR163: paused copy while online, match/unmatch cache writes and cancellation, report states.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthHint, setAuthHint } from "../../client/src/lib/authHint";
import enBanking from "../../client/src/locales/en/banking.json";
import arBanking from "../../client/src/locales/ar/banking.json";
import enCommon from "../../client/src/locales/en/common.json";
import arCommon from "../../client/src/locales/ar/common.json";
import arScreens from "../../client/src/locales/ar/screens.json";

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

const report = {
  summary: {
    totalTransactions: 7,
    reconciledCount: 3,
    unreconciledCount: 4,
    suggestedCount: 0,
    reconciledPct: 43,
  },
  amounts: {
    totalCredits: 1234,
    totalDebits: 0,
    netAmount: 1234,
    reconciledCredits: 0,
    reconciledDebits: 0,
    unreconciledCredits: 1234,
    unreconciledDebits: 0,
  },
};

const TRANSACTIONS_KEY = ["/api/companies", "c-1", "bank-statements", "transactions"];
const REPORT_KEY = ["/api/companies", "c-1", "bank-statements", "report", "all"];

// Per-test fixtures read by the fetch stub.
let transactions: Array<Record<string, unknown>>;
let bankAccounts: Array<Record<string, unknown>>;
let suggestionsReply: () => Response;
let transactionsReply: (init?: RequestInit) => Response | Promise<Response>;
let reportReply: (init?: RequestInit) => Response | Promise<Response>;
let matchReply: () => Response | Promise<Response>;
let scanMatches: Array<Record<string, unknown>>;

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
  reportReply = () => json(report);
  matchReply = () => json({});
  scanMatches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "Oasis" }]);
      if (url.endsWith("/bank-statements/transactions")) return transactionsReply(init);
      if (url.includes("/bank-statements/report?")) return reportReply(init);
      if (url.endsWith("/match")) return matchReply();
      if (url.endsWith("/auto-reconcile/apply")) return json({ message: "applied" });
      if (url.endsWith("/auto-reconcile"))
        return json({
          matches: scanMatches,
          autoMatchedCount: 0,
          manualReviewCount: scanMatches.length,
          totalUnreconciled: scanMatches.length,
        });
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
  focusManager.setFocused(undefined);
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

/** Opens a Radix Select by keyboard and returns the options it offers. */
async function openSelect(trigger: HTMLElement) {
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
}

async function pickOption(trigger: HTMLElement, name: string) {
  const option = (await openSelect(trigger)).find((o) => o.textContent?.includes(name))!;
  await act(async () => option.click());
  await flush(4);
}

const selectAccount = (name: string) => pickOption(byTestId("select-bank-account")!, name);

async function openMatchDialog() {
  await act(async () => byTestId("button-match-t-1")!.click());
  await flush();
}

/** Opens the report from the page's overflow menu, in whichever locale is active. */
async function openReport() {
  const { translateNow } = await import("../../client/src/lib/i18n");
  const trigger = document.querySelector<HTMLElement>(
    `button[aria-label="${translateNow("banking.recon.moreActions")}"]`
  )!;
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((o) =>
    o.textContent?.includes(translateNow("banking.recon.report"))
  )!;
  await act(async () => item.click());
  await flush();
}

async function openMatchDialogFor(id: string) {
  await act(async () => byTestId(`button-match-${id}`)!.click());
  await flush();
}
const dialogText = () => document.querySelector('[role="dialog"]')!.textContent ?? "";

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

/** Past the app client's first retry delay (1 s), where an unfocused retry pauses. */
const waitForRetry = async () => {
  await act(async () => new Promise((r) => setTimeout(r, 1_200)));
  await flush(4);
};

describe("bank reconciliation paused copy while online (unfocused retry)", () => {
  const copy = {
    en: { banking: enBanking, common: enCommon },
    ar: { banking: arBanking, common: arCommon },
  } as const;
  const failing = () => json({ message: "boom" }, 500);

  for (const locale of ["en", "ar"] as const) {
    const paused = (copy[locale].banking as Record<string, string>)["banking.query.paused"]!;
    const offline = (copy[locale].common as Record<string, string>)["common.errorHeading.offline"]!;

    it(`does not claim the transaction list is offline (${locale})`, async () => {
      focusManager.setFocused(false);
      transactionsReply = failing;
      await mountPage(locale);
      await waitForRetry();
      expect(onlineManager.isOnline()).toBe(true);
      expect(byTestId("status-transactions-paused")!.textContent).toBe(paused);
      expect(byTestId("bank-transactions-offline")).toBeNull();
      expect(document.body.textContent).not.toContain(offline);
      expect(byTestId("empty-state-bank-transactions")).toBeNull();

      transactionsReply = () => json([]);
      await act(async () => focusManager.setFocused(true));
      await flush();
      expect(byTestId("status-transactions-paused")).toBeNull();
      expect(byTestId("empty-state-bank-transactions")).not.toBeNull();
    }, 60_000);

    it(`does not claim the match search is offline (${locale})`, async () => {
      await mountPage(locale);
      focusManager.setFocused(false);
      suggestionsReply = failing;
      await openMatchDialog();
      await waitForRetry();
      expect(byTestId("status-matches-paused")!.textContent).toBe(paused);
      expect(byTestId("match-suggestions-offline")).toBeNull();
      expect(document.body.textContent).not.toContain(offline);
      expect(byTestId("match-suggestions-empty")).toBeNull();
    }, 60_000);
  }
});

describe("bank reconciliation match and unmatch cache writes", () => {
  const PREFIX = ["/api/companies", "c-1", "bank-statements"];
  const suggested = {
    ...baseTx,
    id: "t-1",
    matchStatus: "suggested",
    matchedJournalEntryId: "je-1",
  };
  // Prefer the enabled button: a row with a write in flight disables its own action, so with
  // two rows showing the same label (e.g. Unmatch) the enabled one is the row still to act on.
  const mobileButton = (label: string) => {
    const matches = Array.from(
      byTestId("mobile-bank-transaction-list")!.querySelectorAll("button")
    ).filter((b) => b.textContent?.trim() === label);
    return (matches.find((b) => !b.disabled) ?? matches[0])!;
  };

  /** Hold a transactions refresh and the write, so the optimistic state can be observed. */
  async function startWrite(
    client: Awaited<ReturnType<typeof mountPage>>,
    click: () => void
  ): Promise<{ signal: AbortSignal; fail: () => Promise<void> }> {
    let signal!: AbortSignal;
    transactionsReply = (init) => {
      signal = init!.signal!;
      return new Promise<Response>(() => {});
    };
    await act(async () => {
      void client.refetchQueries({ queryKey: TRANSACTIONS_KEY, exact: true });
    });
    await flush(4);
    expect(signal.aborted).toBe(false);
    let respond!: (response: Response) => void;
    matchReply = () => new Promise<Response>((resolve) => (respond = resolve));
    await act(async () => click());
    await flush();
    const held = signal;
    return {
      signal: held,
      fail: async () => {
        transactionsReply = () => new Promise<Response>(() => {});
        await act(async () => respond(json({ message: "nope" }, 409)));
        await flush();
      },
    };
  }

  type Rows = Array<Record<string, unknown>>;
  const reconciled = {
    ...baseTx,
    id: "t-1",
    isReconciled: true,
    matchStatus: "matched",
    matchedType: "invoice",
    matchedInvoiceId: "inv-1",
    matchedReceiptId: "rc-1",
    matchedJournalEntryId: "je-1",
    matchConfidence: 1,
  };
  const showReconciledRows = async () =>
    act(async () => document.getElementById("show-reconciled")!.click());

  for (const [name, row, label, expected] of [
    [
      "match",
      suggested,
      "pages.accept",
      {
        matchStatus: "matched",
        isReconciled: true,
        matchedType: "journal",
        matchedJournalEntryId: "je-1",
        matchedReceiptId: null,
        matchedInvoiceId: null,
        matchConfidence: 1,
      },
    ],
    [
      "unmatch",
      reconciled,
      "pageLabels.unmatch",
      {
        matchStatus: "unmatched",
        isReconciled: false,
        matchedType: null,
        matchedJournalEntryId: null,
        matchedReceiptId: null,
        matchedInvoiceId: null,
        matchConfidence: null,
      },
    ],
  ] as const) {
    it(`${name} aborts the in-flight list read, writes the list key and rolls back`, async () => {
      transactions = [row];
      const client = await mountPage("en");
      if (row.isReconciled) await showReconciledRows();
      const { translateNow } = await import("../../client/src/lib/i18n");
      const before = client.getQueryData<Rows>(TRANSACTIONS_KEY)!;
      const original = structuredClone(before);
      const write = await startWrite(client, () => mobileButton(translateNow(label)).click());

      expect(write.signal.aborted).toBe(true);
      const optimistic = client.getQueryData<Rows>(TRANSACTIONS_KEY)!;
      expect(optimistic[0]).toEqual({ ...row, ...expected });
      expect(optimistic).not.toBe(before);
      expect(before).toEqual(original);
      expect(client.getQueryState(PREFIX)).toBeUndefined();
      if (name === "match") {
        // Reconciled rows are hidden by default, so the accepted row leaves the view.
        expect(byTestId("empty-state-all-reconciled")).not.toBeNull();
      } else {
        expect(byTestId("mobile-button-match-t-1")).not.toBeNull();
      }

      await write.fail();
      expect(client.getQueryData(TRANSACTIONS_KEY)).toEqual(original);
      expect(mobileButton(translateNow(label))).toBeDefined();
    }, 60_000);
  }

  it("rolls back only the failed row when a match and an unmatch overlap", async () => {
    transactions = [suggested, { ...reconciled, id: "t-2" }];
    const client = await mountPage("en");
    await showReconciledRows();
    const { translateNow } = await import("../../client/src/lib/i18n");
    transactionsReply = () => new Promise<Response>(() => {});
    const responders: Array<(response: Response) => void> = [];
    matchReply = () => new Promise<Response>((resolve) => responders.push(resolve));
    for (const label of ["pages.accept", "pageLabels.unmatch"]) {
      await act(async () => mobileButton(translateNow(label)).click());
      await flush();
    }
    expect(responders).toHaveLength(2);

    await act(async () => responders[0]!(json({ message: "nope" }, 409)));
    await flush();
    const rows = client.getQueryData<Rows>(TRANSACTIONS_KEY)!;
    expect(rows[0]).toEqual(suggested);
    expect(rows[1]).toMatchObject({
      matchStatus: "unmatched",
      isReconciled: false,
      matchedInvoiceId: null,
    });
    await act(async () => responders[1]!(json({})));
    await flush();
  }, 60_000);

  for (const outcome of ["both succeed", "one fails"] as const) {
    it(`refreshes once after two writes settle together (${outcome})`, async () => {
      transactions = [suggested, { ...suggested, id: "t-2", matchedJournalEntryId: "je-2" }];
      const client = await mountPage("en");
      const { translateNow } = await import("../../client/src/lib/i18n");
      const responders: Array<(response: Response) => void> = [];
      matchReply = () => new Promise<Response>((resolve) => responders.push(resolve));
      for (let i = 0; i < 2; i++) {
        await act(async () => mobileButton(translateNow("pages.accept")).click());
        await flush();
      }
      expect(responders).toHaveLength(2);

      // With both writes held, open the report and cache one row's suggestions.
      let listReads = 0;
      transactionsReply = () => {
        listReads += 1;
        return json(transactions);
      };
      let reportReads = 0;
      let serverReport = report;
      reportReply = () => {
        reportReads += 1;
        return json(serverReport);
      };
      await openReport();
      const suggestionsKey = [...PREFIX, "t-1", "suggestions"];
      client.setQueryData(suggestionsKey, [suggestion]);
      serverReport = {
        ...report,
        amounts: {
          ...report.amounts,
          totalCredits: 5678,
          netAmount: 5678,
          unreconciledCredits: 5678,
        },
      };
      expect(listReads).toBe(0);
      expect(reportReads).toBe(1);
      expect(dialogText()).toContain("1,234");
      expect(client.getQueryState(suggestionsKey)!.isInvalidated).toBe(false);

      await act(async () => {
        responders[0]!(json({}));
        responders[1]!(outcome === "one fails" ? json({ message: "nope" }, 409) : json({}));
      });
      await flush();
      expect(listReads).toBe(1);
      expect(reportReads).toBe(2);
      expect(dialogText()).toContain("5,678");
      expect(dialogText()).not.toContain("1,234");
      expect(client.getQueryState(suggestionsKey)!.isInvalidated).toBe(true);
    }, 60_000);
  }

  it("does not create a transactions cache entry when there is none", async () => {
    suggestionsReply = () => json([suggestion]);
    const client = await mountPage("en");
    await openMatchDialog();
    // The mounted list refetches on its next render; hold that so the cache stays empty.
    transactionsReply = () => new Promise<Response>(() => {});
    client.removeQueries({ queryKey: TRANSACTIONS_KEY, exact: true });
    let respond!: (response: Response) => void;
    matchReply = () => new Promise<Response>((resolve) => (respond = resolve));
    const card = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] p')).find((p) =>
      p.textContent?.includes("INV-1042")
    )!;
    await act(async () => card.click());
    await flush();
    expect(client.getQueryData(TRANSACTIONS_KEY)).toBeUndefined();
    expect(client.getQueryData(PREFIX)).toBeUndefined();

    await act(async () => respond(json({})));
    await flush();
  }, 60_000);

  const writes = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET")
      .map(([url, init]) => `${init!.method} ${String(url).replace(/^.*bank-statements/, "")}`);
  const closeDialog = async () => {
    const { translateNow } = await import("../../client/src/lib/i18n");
    const close = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === translateNow("banking.common.close")
    )!;
    await act(async () => close.click());
    await flush(4);
  };

  it("keeps both Match controls shut while Unmatch is held, then restores the row after a failure", async () => {
    transactions = [reconciled, { ...baseTx, id: "t-2" }];
    const client = await mountPage("en");
    await showReconciledRows();
    const { translateNow } = await import("../../client/src/lib/i18n");
    transactionsReply = () => new Promise<Response>(() => {});
    let respond!: (response: Response) => void;
    matchReply = () => new Promise<Response>((resolve) => (respond = resolve));

    // Two events in one tick (before any rerender) reach the server once.
    const unmatch = mobileButton(translateNow("pageLabels.unmatch"));
    await act(async () => {
      unmatch.click();
      unmatch.click();
    });
    await flush();
    expect(writes()).toEqual(["DELETE /t-1/match"]);

    // The optimistic row shows Match on desktop and mobile, but neither can open the actions.
    for (const id of ["button-match-t-1", "mobile-button-match-t-1"]) {
      const match = byTestId(id) as HTMLButtonElement;
      expect(match.disabled).toBe(true);
      await act(async () => match.click());
      await flush(4);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }

    // A different row still opens its actions.
    await openMatchDialogFor("t-2");
    expect(byTestId("bank-line-actions")).not.toBeNull();
    await closeDialog();

    await act(async () => respond(json({ message: "nope" }, 409)));
    await flush();
    expect(client.getQueryData<Rows>(TRANSACTIONS_KEY)![0]).toEqual(reconciled);
    expect(byTestId("button-match-t-1")).toBeNull();
    expect(byTestId("mobile-button-match-t-1")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(writes()).toEqual(["DELETE /t-1/match"]);
  }, 60_000);
  it("neither offers nor writes a selected transfer counterpart while its Unmatch is held", async () => {
    bankAccounts = [
      { id: "a-1", nameEn: "Operating", bankName: "ADCB", currency: "AED", isActive: true },
      { id: "a-2", nameEn: "Savings", bankName: "FAB", currency: "AED", isActive: true },
    ];
    const line = { ...baseTx, id: "t-1", bankStatementAccountId: "a-1" };
    const other = {
      ...baseTx,
      id: "t-2",
      bankStatementAccountId: "a-2",
      amount: 42,
      description: "INCOMING TRANSFER",
    };
    transactions = [line, other];
    const client = await mountPage("en");
    await showReconciledRows();
    const { translateNow } = await import("../../client/src/lib/i18n");
    const action = (key: string) =>
      Array.from(byTestId("bank-line-actions")!.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === translateNow(key)
      )!;
    const select = (index: number) =>
      byTestId("bank-line-actions")!.querySelectorAll<HTMLElement>('[role="combobox"]')[index]!;
    const offersCounterpart = async () => {
      const options = await openSelect(select(1));
      expect(options.length).toBeGreaterThan(0);
      const offered = options.some((o) => o.textContent?.includes(other.description));
      // Escape closes only the select (the top layer) and keeps its current value.
      await act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });
      await flush(4);
      expect(document.querySelector('[role="option"]')).toBeNull();
      return offered;
    };

    // Pick the counterpart while it is still eligible.
    await openMatchDialogFor("t-1");
    await act(async () => action("banking.line.transfer").click());
    await pickOption(select(0), "Savings");
    await pickOption(select(1), other.description);

    // It turns out to be reconciled, then its Unmatch is held (the row sits behind the dialog).
    await act(async () => {
      client.setQueryData(TRANSACTIONS_KEY, [
        line,
        { ...reconciled, ...other, isReconciled: true },
      ]);
    });
    await flush(4);
    let respond!: (response: Response) => void;
    matchReply = () => new Promise<Response>((resolve) => (respond = resolve));
    await act(async () => mobileButton(translateNow("pageLabels.unmatch")).click());
    await flush();
    expect(writes()).toEqual(["DELETE /t-2/match"]);
    expect(client.getQueryData<Rows>(TRANSACTIONS_KEY)![1]).toMatchObject({
      id: "t-2",
      isReconciled: false,
    });

    expect(await offersCounterpart()).toBe(false);
    await act(async () => action("banking.line.applyTransfer").click());
    await flush();
    expect(writes()).toEqual(["DELETE /t-2/match"]);

    // Once the Unmatch settles, the same selection is offered and written.
    matchReply = () => json({});
    await act(async () => respond(json({})));
    await flush();
    expect(await offersCounterpart()).toBe(true);
    await act(async () => action("banking.line.applyTransfer").click());
    await flush();
    expect(writes()).toEqual(["DELETE /t-2/match", "POST /t-1/match"]);
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      matchedType: "transfer",
      matchedId: "a-2",
      counterpartTransactionId: "t-2",
    });
  }, 60_000);

  it("hides create-entry, split, transfer and exclude while a dialog match is pending, and restores them after a failure", async () => {
    suggestionsReply = () => json([suggestion]);
    const client = await mountPage("en");
    await openMatchDialogFor("t-1");
    expect(byTestId("bank-line-actions")).not.toBeNull();
    transactionsReply = () => new Promise<Response>(() => {});
    let respond!: (response: Response) => void;
    matchReply = () => new Promise<Response>((resolve) => (respond = resolve));
    const card = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] p')).find((p) =>
        p.textContent?.includes("INV-1042")
      )!;
    await act(async () => {
      card().click();
      card().click();
    });
    await flush();
    expect(writes()).toEqual(["POST /t-1/match"]);
    expect(byTestId("bank-line-actions")).toBeNull();
    expect(byTestId("button-create-entry")).toBeNull();

    await act(async () => respond(json({ message: "nope" }, 409)));
    await flush();
    expect(client.getQueryData<Rows>(TRANSACTIONS_KEY)![0]).toMatchObject({
      isReconciled: false,
      matchStatus: "unmatched",
    });
    expect(byTestId("bank-line-actions")).not.toBeNull();
    expect(writes()).toEqual(["POST /t-1/match"]);
  }, 60_000);

  /** The bodies of every apply request the Suggestions tab sent. */
  const applies = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/auto-reconcile/apply"))
      .map(([, init]) => JSON.parse(String(init!.body)) as { matches: unknown[] });
  const scanMatch = (id: string) => ({
    ...suggestion,
    bankTransactionId: id,
    matchedId: `inv-${id}`,
  });
  const sent = (id: string) => ({
    bankTransactionId: id,
    matchedType: "invoice",
    matchedId: `inv-${id}`,
  });
  const click = async (id: string) => {
    const button = byTestId(id) as HTMLButtonElement;
    // The guard under test is the submit-time one: the control itself is clickable.
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await flush();
  };

  for (const [held, row, label] of [
    ["Unmatch", reconciled, "pageLabels.unmatch"],
    ["Match", suggested, "pages.accept"],
  ] as const) {
    /** Holds a row write on t-1 from the list, then runs "Find matches" on the real page. */
    const holdThenScan = async () => {
      const client = await mountPage("en");
      if (row.isReconciled) await showReconciledRows();
      const { translateNow } = await import("../../client/src/lib/i18n");
      transactionsReply = () => new Promise<Response>(() => {});
      let respond!: (response: Response) => void;
      matchReply = () => new Promise<Response>((resolve) => (respond = resolve));
      await act(async () => mobileButton(translateNow(label)).click());
      await flush();
      expect(client.isMutating()).toBe(1);
      await act(async () => byTestId("button-auto-reconcile")!.click());
      await flush();
      expect(byTestId("suggestion-t-1")).not.toBeNull();
      return async () => {
        await act(async () => respond(json({})));
        await flush();
      };
    };

    it(`Accept and Accept confident send no apply while the only row's ${held} is held`, async () => {
      transactions = [row];
      scanMatches = [scanMatch("t-1")];
      const settle = await holdThenScan();

      await click("button-accept-t-1");
      expect(applies()).toEqual([]);
      await click("button-accept-confident");
      expect(applies()).toEqual([]);

      // The same control writes once the held request has settled.
      await settle();
      await click("button-accept-t-1");
      expect(applies()).toEqual([{ matches: [sent("t-1")] }]);
    }, 60_000);

    it(`Accept confident applies only the eligible row while another row's ${held} is held`, async () => {
      transactions = [row, { ...baseTx, id: "t-2" }];
      scanMatches = [scanMatch("t-1"), scanMatch("t-2")];
      const settle = await holdThenScan();

      await click("button-accept-t-1");
      expect(applies()).toEqual([]);
      await click("button-accept-confident");
      expect(applies()).toEqual([{ matches: [sent("t-2")] }]);

      await settle();
    }, 60_000);
  }

  for (const [failedName, failed] of [
    ["match", 0],
    ["unmatch", 1],
  ] as const) {
    it(`cancels a read started during pending writes before rolling back a failed ${failedName}, and ignores its late reply`, async () => {
      const originals = [suggested, { ...reconciled, id: "t-2" }];
      transactions = originals;
      const client = await mountPage("en");
      await showReconciledRows();
      const { translateNow } = await import("../../client/src/lib/i18n");
      const responders: Array<(response: Response) => void> = [];
      matchReply = () => new Promise<Response>((resolve) => responders.push(resolve));
      for (const label of ["pages.accept", "pageLabels.unmatch"]) {
        await act(async () => mobileButton(translateNow(label)).click());
        await flush();
      }
      expect(responders).toHaveLength(2);
      const optimistic = structuredClone(client.getQueryData<Rows>(TRANSACTIONS_KEY)!);
      expect(optimistic[failed]).not.toEqual(originals[failed]);

      // A read that starts while both writes are pending. The transport ignores the signal.
      let reads = 0;
      let signal!: AbortSignal;
      let late!: (response: Response) => void;
      transactionsReply = (init) => {
        reads += 1;
        signal = init!.signal!;
        return new Promise<Response>((resolve) => (late = resolve));
      };
      await act(async () => {
        void client.refetchQueries({ queryKey: TRANSACTIONS_KEY, exact: true });
      });
      await flush(4);
      expect(reads).toBe(1);
      expect(signal.aborted).toBe(false);
      let rowAtAbort: unknown;
      signal.addEventListener("abort", () => {
        rowAtAbort = client.getQueryData<Rows>(TRANSACTIONS_KEY)![failed];
      });

      await act(async () => responders[failed]!(json({ message: "nope" }, 409)));
      await flush();
      // Cancelled first (the row was still optimistic then), rolled back afterwards.
      expect(signal.aborted).toBe(true);
      expect(rowAtAbort).toEqual(optimistic[failed]);
      const rolledBack = optimistic.map((r, i) => (i === failed ? originals[i] : r));
      expect(client.getQueryData(TRANSACTIONS_KEY)).toEqual(rolledBack);

      await act(async () => late(json(optimistic)));
      await flush();
      expect(client.getQueryData(TRANSACTIONS_KEY)).toEqual(rolledBack);
      // The other write is still pending, so no refresh has run to paper over a bad value.
      expect(client.isMutating()).toBe(1);
      expect(reads).toBe(1);

      transactionsReply = () => json(originals);
      await act(async () => responders[1 - failed]!(json({})));
      await flush();
    }, 60_000);
  }
});

describe("bank reconciliation match dialog in Arabic", () => {
  const banking = arBanking as Record<string, string>;
  const screens = arScreens as Record<string, string>;
  const types = [
    ["journal_entry", 90, "screens.confidenceHigh"],
    ["invoice", 85, "screens.confidenceHigh"],
    ["receipt", 70, "screens.confidenceMedium"],
    ["bill", 40, "screens.confidenceLow"],
  ] as const;

  for (const [direction, amount] of [
    ["credit", 42],
    ["debit", -42],
  ] as const) {
    it(`shows the ${direction} direction, suggestion types and confidence in Arabic`, async () => {
      transactions = [{ ...baseTx, id: "t-1", amount }];
      suggestionsReply = () =>
        json(
          types.map(([matchedType, confidence]) => ({
            ...suggestion,
            matchedType,
            matchedId: `id-${matchedType}`,
            matchedDescription: `DOC ${matchedType}`,
            confidence,
          }))
        );
      await mountPage("ar");
      await openMatchDialog();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const texts = Array.from(dialog.querySelectorAll("*")).map((el) => el.textContent?.trim());
      const other = direction === "credit" ? "debit" : "credit";
      expect(texts).toContain(banking[`banking.line.direction.${direction}`]);
      expect(texts).not.toContain(banking[`banking.line.direction.${other}`]);

      for (const [matchedType, confidence, confidenceKey] of types) {
        const description = Array.from(dialog.querySelectorAll("p")).find(
          (p) => p.textContent === `DOC ${matchedType}`
        )!;
        // The type label sits directly above the matched document's description.
        expect(description.previousElementSibling!.textContent).toBe(
          banking[`banking.suggest.type.${matchedType}`]
        );
        const adjective = `${confidence}% ${screens[confidenceKey]}`;
        expect(texts).toContain(adjective);
        expect(dialog.querySelector(`[aria-label="${adjective}"]`)).not.toBeNull();
      }
      expect(dialog.textContent).not.toMatch(/Journal entry|Invoice|Receipt|High|Medium|Low/);
    }, 60_000);
  }
});

describe("read cancellation reaches fetch", () => {
  it("passes the signal to the shared loader's request and its retry after a session refresh", async () => {
    const { getQueryFn } = await import("../../client/src/lib/queryClient");
    const signals: Array<AbortSignal | null | undefined> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (url.endsWith("/api/auth/refresh")) return json({});
      signals.push(init?.signal);
      return signals.length === 1 ? json({ message: "expired" }, 401) : json([]);
    });
    const { signal } = new AbortController();
    await getQueryFn({ on401: "throw" })({
      queryKey: ["/api/things"],
      signal,
    } as never);
    expect(signals).toEqual([signal, signal]);
  });
});

describe("bank reconciliation report dialog states", () => {
  const retry = async (id: string) => {
    await act(async () => byTestId(id)!.querySelector<HTMLButtonElement>("button")!.click());
    await flush();
  };
  const refresh = async (client: Awaited<ReturnType<typeof mountPage>>) => {
    await act(async () => {
      void client.refetchQueries({ queryKey: REPORT_KEY, exact: true });
    });
    await flush();
  };

  for (const locale of ["en", "ar"] as const) {
    it(`localizes the positive suggested-matches notice (${locale})`, async () => {
      reportReply = () => json({ ...report, summary: { ...report.summary, suggestedCount: 5 } });
      await mountPage(locale);
      await openReport();
      const { formatMessage } = await import("../../client/src/lib/i18n");
      const bank = (locale === "en" ? enBanking : arBanking) as Record<string, string>;
      expect(dialogText()).toContain(
        formatMessage(bank["banking.report.suggestedNotice"]!, { count: 5 })
      );
    }, 60_000);
  }

  it("shows loading, then aborts the held request when it is cancelled", async () => {
    let signal!: AbortSignal;
    reportReply = (init) => {
      signal = init!.signal!;
      return new Promise<Response>(() => {});
    };
    const client = await mountPage("en");
    await openReport();
    expect(byTestId("report-loading")).not.toBeNull();
    expect(signal.aborted).toBe(false);
    await act(async () => client.cancelQueries({ queryKey: REPORT_KEY, exact: true }));
    expect(signal.aborted).toBe(true);
  }, 60_000);

  it("offers retry after a failed first load, then keeps totals through a failed refresh", async () => {
    reportReply = () => json({ message: "boom" }, 404);
    const client = await mountPage("en");
    await openReport();
    expect(byTestId("report-load-error")).not.toBeNull();
    expect(byTestId("report-loading")).toBeNull();
    expect(dialogText()).not.toContain("1,234");

    reportReply = () => json(report);
    await retry("report-load-error");
    expect(byTestId("report-load-error")).toBeNull();
    expect(dialogText()).toContain("1,234");

    reportReply = () => json({ message: "boom" }, 404);
    await refresh(client);
    expect(byTestId("report-refresh-error")!.textContent).toContain(
      (enBanking as Record<string, string>)["banking.common.refreshFailed"]
    );
    expect(dialogText()).toContain("1,234");

    reportReply = () => json(report);
    await retry("report-refresh-error");
    expect(byTestId("report-refresh-error")).toBeNull();

    await act(async () => onlineManager.setOnline(false));
    await refresh(client);
    expect(byTestId("report-refresh-paused")).not.toBeNull();
    expect(dialogText()).toContain("1,234");
  }, 60_000);

  it("shows a paused first load, with offline wording only when known offline", async () => {
    await mountPage("en");
    await act(async () => onlineManager.setOnline(false));
    await openReport();
    expect(byTestId("report-paused")).not.toBeNull();
    expect(byTestId("report-offline")).not.toBeNull();
    expect(byTestId("report-loading")).toBeNull();

    focusManager.setFocused(false);
    reportReply = () => json({ message: "boom" }, 500);
    await act(async () => onlineManager.setOnline(true));
    await waitForRetry();
    expect(byTestId("report-paused")).not.toBeNull();
    expect(byTestId("report-offline")).toBeNull();
  }, 60_000);
});
