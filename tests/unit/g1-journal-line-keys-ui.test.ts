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
  byTestId,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
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
