// @vitest-environment jsdom
/**
 * STEP1-E G1 / G5 (UI): a journal line stored with a key renders in Arabic on the account ledger
 * and the journal entry, with no Latin text outside user data (numbers, party names); an old row
 * with no key still reads Arabic through the matcher; an issued invoice uses one label for
 * "partly paid" in both chips and calls the preview "Document" (not "Live preview").
 */
import { act, createElement } from "react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  apiCalls,
  buttonByText,
  byTestId,
  click,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  pickOption,
  renderPage,
  resetHarness,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

// The harness stubs, but the real singleton client and the real refreshAfterWrite, so the page and
// the helper share one client (given the harness's defaults: no retry, fixture query function).
vi.mock("../../client/src/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/queryClient")>();
  const harness = formHarnessQueryClientMock();
  actual.queryClient.setDefaultOptions(harness.queryClient.getDefaultOptions());
  return {
    ...harness,
    queryClient: actual.queryClient,
    refreshAfterWrite: actual.refreshAfterWrite,
  };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: null,
    usage: null,
    limits: null,
    tierName: "enterprise",
    isFreeTier: false,
    canAccess: () => true,
    getRequiredTier: () => "starter",
    isLoading: false,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT_ID = "a0000000-0000-4000-8000-0000000000a1";
const ENTRY_ID = "e0000000-0000-4000-8000-0000000000e1";
const ARABIC = /[؀-ۿ]/;

const ACCOUNT = {
  id: ACCOUNT_ID,
  companyId: COMPANY_ID,
  code: "4010",
  nameEn: "Sales Revenue",
  nameAr: "إيرادات المبيعات",
  type: "income",
};

const entry = (over: Record<string, unknown>) => ({
  id: "l1",
  date: "2026-03-01T00:00:00.000Z",
  entryNumber: "JE-2026-0001",
  description: "",
  debit: 0,
  credit: 2000,
  runningBalance: 2000,
  journalEntryId: ENTRY_ID,
  journalLineId: "l1",
  memo: "Sales Invoice INV-2026-00001 - Palm Co",
  memoKey: "salesInvoice",
  memoParams: { ref: "INV-2026-00001", party: "Palm Co" },
  lineKey: null,
  lineParams: null,
  source: "invoice",
  status: "posted",
  ...over,
});

const LEDGER = {
  entries: [
    // A keyed line (migration 0132).
    entry({
      id: "l1",
      description: "Sales revenue - INV-2026-00001",
      lineKey: "salesRevenue",
      lineParams: { ref: "INV-2026-00001" },
    }),
    // An old row with no key: the matcher reads the English text.
    entry({ id: "l2", description: "VAT output - INV-2026-00001", credit: 100 }),
    // A person's own text stays as typed.
    entry({ id: "l3", description: "Office rent", memo: "Office rent", memoKey: null }),
    // No line description: the entry memo (with its key).
    entry({ id: "l4", description: "", credit: 5 }),
  ],
  allEntries: [],
  account: ACCOUNT,
  openingBalance: 0,
  totalDebit: 0,
  totalCredit: 2105,
  closingBalance: 2105,
  totalCount: 4,
};

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
  Element.prototype.scrollIntoView ??= () => undefined;
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;
});
beforeEach(() => {
  resetHarness();
  useI18n.setState({ locale: "ar" });
});
afterEach(async () => {
  onlineManager.setOnline(true);
  await unmountPage();
  useI18n.setState({ locale: "en" });
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("G1 the Arabic account ledger renders line keys", () => {
  it("shows Arabic for a keyed line, an old row and the entry memo; user text is unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(LEDGER), { status: 200 }))
    );
    window.history.replaceState({}, "", `/accounts/${ACCOUNT_ID}/ledger`);
    const { default: AccountLedger } = await import("../../client/src/pages/AccountLedger");
    await renderPage(AccountLedger);
    await flushUntil(() => !!document.querySelector(`[data-testid="row-entry-l1"]`));
    const text = (id: string) =>
      document.querySelector(`[data-testid="row-entry-${id}"]`)?.textContent ?? "";
    // The keyed line, from its key and params.
    expect(text("l1")).toContain("إيرادات المبيعات - INV-2026-00001");
    expect(text("l1")).not.toContain("Sales revenue");
    // An old row without a key, through the matcher.
    expect(text("l2")).toContain("ضريبة القيمة المضافة على المخرجات - INV-2026-00001");
    // The person's own text.
    expect(text("l3")).toContain("Office rent");
    // The entry memo, from the entry key.
    expect(text("l4")).toContain("فاتورة مبيعات INV-2026-00001 - Palm Co");
    // No English wording on the system rows (numbers and the party name are user data).
    for (const id of ["l1", "l2", "l4"]) {
      const words = text(id)
        .replace(/INV-2026-00001|JE-2026-0001|Palm Co/g, "")
        .match(/[A-Za-z]{2,}/g);
      expect(words, `${id}: ${text(id)}`).toBeNull();
    }
  });
});

describe("G1 the Arabic journal entry shows each line's description", () => {
  it("renders the line description from its key under the account name", async () => {
    setFixtures({
      [`/api/journal/${ENTRY_ID}`]: {
        id: ENTRY_ID,
        companyId: COMPANY_ID,
        entryNumber: "JE-2026-0001",
        date: "2026-03-01T00:00:00.000Z",
        memo: "Sales Invoice INV-2026-00001 - Palm Co",
        memoKey: "salesInvoice",
        memoParams: { ref: "INV-2026-00001", party: "Palm Co" },
        status: "posted",
        lifecycleStatus: "posted",
        source: "invoice",
        sourceId: null,
        entryKind: "standard",
        approvalStatus: null,
        reversedByEntryId: null,
        reversalOf: null,
        reversedByEntry: null,
        reversalOfEntry: null,
        createdAt: "2026-03-01T00:00:00.000Z",
        attachments: [],
        lines: [
          {
            id: "jl1",
            entryId: ENTRY_ID,
            accountId: ACCOUNT_ID,
            debit: 0,
            credit: 2000,
            description: "Sales revenue - INV-2026-00001",
            lineKey: "salesRevenue",
            lineParams: { ref: "INV-2026-00001" },
            account: ACCOUNT,
          },
        ],
      },
    });
    window.history.replaceState({}, "", `/journal/${ENTRY_ID}`);
    const { default: JournalEntryDetail } =
      await import("../../client/src/pages/JournalEntryDetail");
    // The page reads its id from the route.
    const { Route } = await import("wouter");
    await renderPage(() =>
      createElement(Route, { path: "/journal/:id", component: JournalEntryDetail })
    );
    await flushUntil(() => !!byTestId("text-line-description-0"));
    const line = byTestId("text-line-description-0")!.textContent ?? "";
    expect(line).toBe("إيرادات المبيعات - INV-2026-00001");
    expect(ARABIC.test(line)).toBe(true);
  });
});

describe("G5 issued invoice chips", () => {
  it("one label for partly paid in both chips; the preview is called Document when locked", async () => {
    const { default: en } = await import("../../client/src/locales/en/forms.json");
    const { default: enCommon } = await import("../../client/src/locales/en/common.json");
    const { default: arForms } = await import("../../client/src/locales/ar/forms.json");
    const { default: arCommon } = await import("../../client/src/locales/ar/common.json");
    expect((en as Record<string, string>)["forms.preview.status.partial"]).toBe(
      (enCommon as Record<string, string>)["common.status.partial"]
    );
    expect((arForms as Record<string, string>)["forms.preview.status.partial"]).toBe(
      (arCommon as Record<string, string>)["common.status.partial"]
    );
    expect((en as Record<string, string>)["forms.preview.headingDocument"]).toBe("Document");

    const { InvoicePreview } = await import("../../client/src/components/invoices/InvoicePreview");
    const props = {
      currency: "AED",
      lines: [],
      subtotal: 0,
      vatAmount: 0,
      total: 0,
      ratesLabel: "",
    };
    useI18n.setState({ locale: "en" });
    await renderPage(InvoicePreview, { ...props, status: "partial" });
    const region = document.querySelector('[data-testid="invoice-preview"]')!.textContent ?? "";
    expect(region).toContain("Document");
    expect(region).toContain("Partly paid");
    expect(region).not.toContain("Live preview");
    await unmountPage();
    await renderPage(InvoicePreview, { ...props, status: "draft" });
    const draft = document.querySelector('[data-testid="invoice-preview"]')!.textContent ?? "";
    expect(draft).toContain("Live preview");
  });
});

describe("account ledger states", () => {
  const load = async (fetchImpl: (params: URLSearchParams) => Response | Promise<Response>) => {
    const fetchLedger = vi.fn(async (url: string, _init?: RequestInit) =>
      fetchImpl(new URL(url, window.location.origin).searchParams)
    );
    vi.stubGlobal("fetch", fetchLedger);
    window.history.replaceState({}, "", `/accounts/${ACCOUNT_ID}/ledger`);
    const { default: AccountLedger } = await import("../../client/src/pages/AccountLedger");
    await renderPage(AccountLedger);
    return fetchLedger;
  };

  it("hides the summary on an uncached error and restores the ledger when Retry succeeds", async () => {
    let available = false;
    const fetchLedger = await load(() =>
      available ? Response.json(LEDGER) : new Response("{}", { status: 500 })
    );
    await flushUntil(() => !!byTestId("error-ledger"));
    const err = byTestId("error-ledger")!;
    expect(err.textContent).toContain("تعذّر تحميل دفتر الأستاذ");
    expect(err.textContent).not.toMatch(/[A-Za-z]{3,}/);
    const summaryIds = [
      "text-opening-balance",
      "text-total-debit",
      "text-total-credit",
      "text-closing-balance",
    ];
    for (const id of summaryIds) expect(byTestId(id)).toBeNull();
    expect(byTestId("empty-state")).toBeNull();

    available = true;
    await click(buttonByText(/^إعادة المحاولة$/, err));
    await flushUntil(() => !!byTestId("row-entry-l1"));
    expect(fetchLedger).toHaveBeenCalledTimes(2);
    expect(byTestId("error-ledger")).toBeNull();
    expect(byTestId("row-entry-l4")).toBeTruthy();
    for (const id of summaryIds) expect(byTestId(id)).toBeTruthy();
  });

  it("clears the search, date preset and pagination from the no-match panel", async () => {
    await load((params) => {
      if (params.get("offset") === "25") {
        return Response.json({ ...LEDGER, entries: [], totalCount: 0 });
      }
      const filtered = params.has("search") && params.has("dateStart") && params.has("dateEnd");
      return Response.json({ ...LEDGER, totalCount: filtered ? 26 : LEDGER.totalCount });
    });
    await flushUntil(() => !!byTestId("row-entry-l1"));
    const preset = byTestId("select-date-preset")!;
    const startLabel = byTestId("button-date-from")!.textContent;
    const endLabel = byTestId("button-date-to")!.textContent;
    await pickOption(preset, /^(This Month|هذا الشهر)$/i);
    expect(preset.hasAttribute("data-placeholder")).toBe(false);
    expect(byTestId("button-clear-dates")).toBeTruthy();
    const input = byTestId("input-search-ledger") as HTMLInputElement;
    await type(input, "INV");
    await flushUntil(() => !!byTestId("button-next-page"));
    await click(byTestId("button-next-page"));
    await flushUntil(() => !!byTestId("empty-ledger-no-match"));
    const panel = byTestId("empty-ledger-no-match")!;
    expect(panel.querySelector("h3")?.textContent).toBe("لا توجد قيود مطابقة");
    await click(panel.querySelector('[data-testid="button-clear-ledger-filters-empty"]'));

    await flushUntil(() => !!byTestId("row-entry-l1"));
    expect(byTestId("row-entry-l4")).toBeTruthy();
    expect(byTestId("empty-ledger-no-match")).toBeNull();
    expect(byTestId("button-clear-ledger-filters")).toBeNull();
    expect(byTestId("button-clear-dates")).toBeNull();
    expect(byTestId("select-date-preset")?.hasAttribute("data-placeholder")).toBe(true);
    expect(byTestId("button-date-from")?.textContent).toBe(startLabel);
    expect(byTestId("button-date-to")?.textContent).toBe(endLabel);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  const SUMMARY_IDS = [
    "text-opening-balance",
    "text-total-debit",
    "text-total-credit",
    "text-closing-balance",
  ];
  const summary = () => SUMMARY_IDS.map((id) => byTestId(id)?.textContent);
  const queryClient = async () => (await import("../../client/src/lib/queryClient")).queryClient;

  it("keeps the cached rows, balances and page when a refresh fails, and Retry clears the warning", async () => {
    let available = true;
    await load(() =>
      available ? Response.json({ ...LEDGER, totalCount: 30 }) : new Response("{}", { status: 500 })
    );
    await flushUntil(() => !!byTestId("button-next-page"));
    await click(byTestId("button-next-page"));
    await flushUntil(
      () => !!byTestId("row-entry-l1") && !!byTestId("button-next-page")?.matches(":disabled")
    );
    expect(byTestId("warning-ledger-refresh")).toBeNull();
    const before = summary();
    const footer = byTestId("button-next-page")!.parentElement!.parentElement!;
    const footerText = footer.textContent;

    available = false;
    const client = await queryClient();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["/api/accounts", ACCOUNT_ID, "ledger"] });
    });
    await flushUntil(() => !!byTestId("warning-ledger-refresh"));
    const warning = byTestId("warning-ledger-refresh")!;
    expect(warning.textContent).toContain("تعذّر تحديث دفتر الأستاذ");
    expect(warning.textContent).not.toMatch(/[A-Za-z]{3,}/);
    expect(byTestId("error-ledger")).toBeNull();
    expect(byTestId("row-entry-l1")).toBeTruthy();
    expect(byTestId("row-entry-l4")).toBeTruthy();
    expect(summary()).toEqual(before);
    expect(footer.isConnected).toBe(true);
    expect(footer.textContent).toBe(footerText);

    available = true;
    await click(buttonByText(/^إعادة المحاولة$/, warning));
    await flushUntil(() => !byTestId("warning-ledger-refresh"));
    expect(byTestId("row-entry-l4")).toBeTruthy();
  });

  it.each(["search", "date"])(
    "announces a deferred %s no-match through a status region that was already mounted",
    async (filter) => {
      let release: (() => void) | undefined;
      await load((params) => {
        if (!params.has("search") && !params.has("dateStart")) return Response.json(LEDGER);
        return new Promise<Response>((resolve) => {
          release = () => resolve(Response.json({ ...LEDGER, entries: [], totalCount: 0 }));
        });
      });
      await flushUntil(() => !!byTestId("row-entry-l1"));
      const region = byTestId("ledger-live")!;
      expect(region.getAttribute("role")).toBe("status");
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.textContent).toBe("");

      const input = byTestId("input-search-ledger") as HTMLInputElement;
      if (filter === "search") {
        input.focus();
        await type(input, "zzz");
      } else {
        await pickOption(byTestId("select-date-preset"), /^(This Month|هذا الشهر)$/i);
      }
      await flushUntil(() => !!release);
      expect(byTestId("ledger-live")).toBe(region);
      expect(region.textContent).toBe("");

      await act(async () => release!());
      await flushUntil(() => !!byTestId("empty-ledger-no-match"));
      expect(byTestId("ledger-live")).toBe(region);
      expect(region.textContent).toBe("لا توجد قيود مطابقة");
      if (filter === "search") expect(document.activeElement).toBe(input);
    }
  );

  it("treats a whitespace-only search as no filter and still sends a typed search literally", async () => {
    // The endpoint matches literally; with no search parameter it returns every row.
    const spaced = entry({ id: "s1", description: "Office   rent", memo: null, memoKey: null });
    const fetchLedger = await load((params) => {
      const search = params.get("search") ?? "";
      const matches = spaced.description.includes(search);
      return Response.json({
        ...LEDGER,
        entries: matches ? [spaced] : [],
        allEntries: matches ? [spaced] : [],
        openingBalance: 500,
        totalCredit: 2000,
        closingBalance: 2500,
        totalCount: matches ? 1 : 0,
      });
    });
    await flushUntil(() => !!byTestId("row-entry-s1"));
    const input = byTestId("input-search-ledger") as HTMLInputElement;
    await type(input, "   ");
    await flushUntil(() => input.value === "   ");
    // Same query as the empty search: no new request, no filter state, the server's balances.
    expect(fetchLedger).toHaveBeenCalledTimes(1);
    const firstUrl = new URL(fetchLedger.mock.calls[0][0], window.location.origin);
    expect(firstUrl.searchParams.has("search")).toBe(false);
    expect(byTestId("row-entry-s1")).toBeTruthy();
    expect(byTestId("empty-ledger-no-match")).toBeNull();
    expect(byTestId("button-clear-ledger-filters")).toBeNull();
    expect(byTestId("ledger-live")?.textContent).toBe("");
    expect(summary().map((card) => card?.match(/\d[\d,]*\.\d\d/)?.[0])).toEqual([
      "500.00",
      "0.00",
      "2,000.00",
      "2,500.00",
    ]);
    const keys = (await queryClient())
      .getQueryCache()
      .getAll()
      .map((q) => (q.queryKey[3] as { searchQuery: string }).searchQuery);
    expect(keys).toEqual([""]);

    await type(input, "Office   rent");
    await flushUntil(() => fetchLedger.mock.calls.length === 2);
    await flushUntil(() => !!byTestId("row-entry-s1"));
    const spacedUrl = new URL(fetchLedger.mock.calls[1][0], window.location.origin);
    expect(spacedUrl.searchParams.get("search")).toBe("Office   rent");

    // A real zero-row answer (count zero) is the only thing that shows the no-match panel.
    await type(input, "zzz");
    await flushUntil(() => !!byTestId("empty-ledger-no-match"));
    expect(byTestId("ledger-live")?.textContent).toBe("لا توجد قيود مطابقة");
  });

  it("moves to the last valid page when a page past the end returns no rows but a count", async () => {
    // 30 rows: page 1 has 25, page 2 has 5. The server later holds only 12, so page 2 is empty.
    let shrunk = false;
    const fetchLedger = await load((params) => {
      const offset = Number(params.get("offset"));
      if (!shrunk) return Response.json({ ...LEDGER, totalCount: 30 });
      return Response.json({
        ...LEDGER,
        // The fallback page answers with fresh rows that the earlier answers did not have.
        entries: offset === 0 ? [entry({ id: "fresh1" })] : [],
        totalCount: 12,
      });
    });
    await flushUntil(() => !!byTestId("row-entry-l1"));
    // An active search, so a wrong "no match" announcement would show here.
    await type(byTestId("input-search-ledger"), "INV");
    await flushUntil(() => !!byTestId("button-next-page"));
    await click(byTestId("button-next-page"));
    await flushUntil(() => !!byTestId("button-next-page")?.matches(":disabled"));

    const region = byTestId("ledger-live")!;
    const announced: string[] = [];
    const observer = new MutationObserver(() => announced.push(region.textContent ?? ""));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    shrunk = true;
    const client = await queryClient();
    await act(async () => {
      void client.invalidateQueries({ queryKey: ["/api/accounts", ACCOUNT_ID, "ledger"] });
    });
    // 12 rows is one page: the footer goes and the page falls back to page 1 with fresh rows.
    await flushUntil(() => !byTestId("button-next-page") && !!byTestId("row-entry-fresh1"));
    observer.disconnect();
    const offsets = fetchLedger.mock.calls.map((call) =>
      new URL(call[0], window.location.origin).searchParams.get("offset")
    );
    const empty = offsets.lastIndexOf("25");
    expect(empty).toBeGreaterThan(-1);
    expect(offsets.slice(empty + 1)).toContain("0");
    // Never presented as an empty or no-match ledger on the way.
    expect(announced.filter(Boolean)).toEqual([]);
    expect(byTestId("empty-state")).toBeNull();
    expect(byTestId("empty-ledger-no-match")).toBeNull();
    expect(byTestId("ledger-live")?.textContent).toBe("");
    expect(byTestId("row-entry-l1")).toBeNull();
  });

  it("shows the paused state instead of an empty ledger while offline, then loads on reconnect", async () => {
    onlineManager.setOnline(false);
    const fetchLedger = await load(() => Response.json(LEDGER));
    await flushUntil(() => !!byTestId("ledger-paused"));
    expect(byTestId("ledger-paused")!.textContent).toContain("بانتظار الاتصال");
    expect(byTestId("ledger-paused")!.textContent).not.toMatch(/[A-Za-z]{3,}/);
    expect(byTestId("empty-state")).toBeNull();
    expect(byTestId("empty-ledger-no-match")).toBeNull();
    expect(byTestId("error-ledger")).toBeNull();
    expect(fetchLedger).not.toHaveBeenCalled();

    await act(async () => onlineManager.setOnline(true));
    await flushUntil(() => !!byTestId("row-entry-l1"));
    expect(byTestId("ledger-paused")).toBeNull();
    expect(fetchLedger).toHaveBeenCalledTimes(1);
  });

  it("keeps the cached rows and totals visible while a refresh is paused", async () => {
    await load(() => Response.json(LEDGER));
    await flushUntil(() => !!byTestId("row-entry-l1"));
    const before = summary();

    onlineManager.setOnline(false);
    const client = await queryClient();
    await act(async () => {
      void client.invalidateQueries({ queryKey: ["/api/accounts", ACCOUNT_ID, "ledger"] });
    });
    await flushUntil(() => !!byTestId("warning-ledger-paused"));
    expect(byTestId("warning-ledger-paused")!.textContent).toContain("أنت غير متصل");
    expect(byTestId("ledger-paused")).toBeNull();
    expect(byTestId("row-entry-l4")).toBeTruthy();
    expect(summary()).toEqual(before);

    await act(async () => onlineManager.setOnline(true));
    await flushUntil(() => !byTestId("warning-ledger-paused"));
    expect(byTestId("row-entry-l4")).toBeTruthy();
  });

  it("a reversal cancels an older in-flight read of a never-cached page, so its rows do not land afterwards", async () => {
    // The real refreshAfterWrite runs against the one shared client. Page 2 has no cache entry, so
    // only the cancel (not a plain invalidate of cached data) keeps the stale answer out.
    const reversed = () => apiCalls("POST").length > 0;
    let releaseStale: (() => void) | undefined;
    let page2Calls = 0;
    const fetchLedger = await load((params) => {
      if (params.get("offset") === "0") return Response.json({ ...LEDGER, totalCount: 30 });
      page2Calls += 1;
      if (page2Calls === 1) {
        // Began before the reversal; answers after it, with the old rows.
        return new Promise<Response>((resolve) => {
          releaseStale = () =>
            resolve(Response.json({ ...LEDGER, entries: [entry({ id: "old2" })], totalCount: 30 }));
        });
      }
      return Response.json({
        ...LEDGER,
        entries: [entry({ id: reversed() ? "new2" : "old2" })],
        totalCount: 30,
      });
    });
    await flushUntil(() => !!byTestId("row-entry-l1"));

    // Open the reversal dialog on page 1, then move to page 2 (a first, uncached read).
    await click(byTestId("button-reverse-l1"));
    await click(byTestId("button-next-page"));
    await flushUntil(() => !!releaseStale);

    await click(byTestId("button-confirm-reversal"));
    await flushUntil(() => !!byTestId("row-entry-new2"));
    expect(apiCalls("POST")[0].url).toBe(`/api/journal/${ENTRY_ID}/reverse`);

    await act(async () => releaseStale!());
    await flush();
    expect(byTestId("row-entry-old2")).toBeNull();
    expect(byTestId("row-entry-new2")).toBeTruthy();
    expect(fetchLedger.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("forwards the query's AbortSignal to fetch, so a superseded search is aborted", async () => {
    const fetchLedger = await load((params) =>
      params.get("search") === "IN" ? new Promise<Response>(() => {}) : Response.json(LEDGER)
    );
    await flushUntil(() => !!byTestId("row-entry-l1"));
    const input = byTestId("input-search-ledger");
    await type(input, "IN");
    await flushUntil(() => fetchLedger.mock.calls.length === 2);
    const signal = fetchLedger.mock.calls[1][1]?.signal;
    expect(signal?.aborted).toBe(false);

    await type(input, "INV");
    await flushUntil(() => fetchLedger.mock.calls.length === 3);
    expect(signal?.aborted).toBe(true);
    expect(fetchLedger.mock.calls[2][1]?.signal?.aborted).toBe(false);
  });

  it.each(["en", "ar"] as const)(
    "takes the unfiltered empty description from the %s catalog",
    async (locale) => {
      useI18n.setState({ locale });
      const { default: catalog } = await import(
        `../../client/src/locales/${locale}/financeViews.json`
      );
      const expected = (catalog as Record<string, string>)["accountLedger.emptyBody"];
      expect(expected).toBeTruthy();
      await load(() => Response.json({ ...LEDGER, entries: [], totalCount: 0 }));
      await flushUntil(() => !!byTestId("empty-state")?.textContent?.includes(expected));
      expect(byTestId("ledger-live")?.textContent).toBe("");
    }
  );
});
