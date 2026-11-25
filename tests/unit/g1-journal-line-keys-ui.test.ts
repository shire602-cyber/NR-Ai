// @vitest-environment jsdom
/**
 * STEP1-E G1 / G5 (UI): a journal line stored with a key renders in Arabic on the account ledger
 * and the journal entry, with no Latin text outside user data (numbers, party names); an old row
 * with no key still reads Arabic through the matcher; an issued invoice uses one label for
 * "partly paid" in both chips and calls the preview "Document" (not "Live preview").
 */
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  buttonByText,
  byTestId,
  click,
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

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
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
  const load = async (fetchImpl: (params: URLSearchParams) => Response) => {
    const fetchLedger = vi.fn(async (url: string) =>
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

  it("shows the no-match panel when the literal search consists only of whitespace", async () => {
    const search = "   ";
    await load((params) =>
      Response.json(
        params.get("search") === search ? { ...LEDGER, entries: [], totalCount: 0 } : LEDGER
      )
    );
    await flushUntil(() => !!byTestId("row-entry-l1"));
    await type(byTestId("input-search-ledger"), search);
    await flushUntil(() => !!byTestId("empty-ledger-no-match"));
    expect(byTestId("empty-ledger-no-match")?.querySelector("h3")?.textContent).toBe(
      "لا توجد قيود مطابقة"
    );
    expect(byTestId("button-clear-ledger-filters-empty")).toBeTruthy();
  });
});
