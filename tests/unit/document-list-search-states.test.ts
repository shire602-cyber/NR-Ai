// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import Quotes from "@/pages/Quotes";
import CreditNotes from "@/pages/CreditNotes";
import DebitNotes from "@/pages/DebitNotes";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", isLoading: false }),
}));
vi.mock("@/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true, gate: () => ({}) }),
}));
vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ canAccess: () => true, isLoading: false }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const parties = ["Oasis Trading", "شركة النور"];
const documentRows = parties.map((customerName, index) => ({
  id: String(index),
  number: `DOC-${index}`,
  customerName,
  date: "2026-03-01",
  expiryDate: "2026-04-01",
  status: "draft",
  currency: "AED",
  total: "100.00",
}));
const debitRows = parties.map((vendor_name, index) => ({
  id: String(index),
  debit_note_number: `DOC-${index}`,
  vendor_name,
  bill_id: `b-${index}`,
  note_date: "2026-03-01",
  total_amount: "100.00",
  amount_applied: "0",
  currency: "AED",
  status: "open",
}));
const bills = [
  { id: "b-0", bill_number: "BILL-FIRST" },
  { id: "b-1", bill_number: "BILL-SECOND" },
];
const pages = [
  {
    name: "quotes",
    Page: Quotes,
    rows: documentRows,
    empty: { en: "No quotes yet", ar: "لا توجد عروض أسعار بعد" },
    reference: "doc-0",
  },
  {
    name: "credit-notes",
    Page: CreditNotes,
    rows: documentRows.map((row) => ({ ...row, invoiceNumber: `INV-${row.id}` })),
    empty: { en: "No credit notes yet", ar: "لا توجد إشعارات دائنة بعد" },
    reference: "inv-0",
  },
  {
    name: "debit-notes",
    Page: DebitNotes,
    rows: debitRows,
    empty: { en: "No supplier credits yet", ar: "لا توجد إشعارات من الموردين بعد" },
    reference: "bill-first",
  },
];
const copy = {
  en: {
    error: "Could not load this data",
    retry: "Retry",
    noMatch: "No matching documents",
    loadingBills: "Loading bill numbers…",
    billsError: "Could not load bill numbers",
  },
  ar: {
    error: "تعذّر تحميل هذه البيانات",
    retry: "إعادة المحاولة",
    noMatch: "لا توجد مستندات مطابقة",
    loadingBills: "جارٍ تحميل أرقام الفواتير…",
    billsError: "تعذّر تحميل أرقام الفواتير",
  },
};

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let listResponse: () => Response;
let billsResponse: () => Response | Promise<Response>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const failed = () => json({ message: "Unavailable" }, 503);

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: { queries: { ...queryClient.getDefaultOptions().queries, retry: false } },
  });
  listResponse = () => json([]);
  billsResponse = () => json(bills);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  useI18n.getState().setLocale("en");
  vi.unstubAllGlobals();
});

async function mount(page: (typeof pages)[number], locale: keyof typeof copy) {
  window.history.replaceState({}, "", `/${page.name}`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/c-1/${page.name}`)) return listResponse();
      if (url.endsWith("/c-1/bills")) return billsResponse();
      return json([]);
    })
  );
  await act(async () => {
    useI18n.getState().setLocale(locale);
    root.render(createElement(QueryClientProvider, { client }, createElement(page.Page)));
  });
}

const table = (name: string) => container.querySelector(`[data-testid="${name}-table"]`)!;
const renderedParties = (name: string) =>
  Array.from(table(name).querySelectorAll('tbody [data-cell="title"]'), (cell) => cell.textContent);
const waitFor = async (assertion: () => void) =>
  vi.waitFor(async () => {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assertion();
  });

async function search(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="input-search-${name}"]`)!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function retry(label: string) {
  const button = container.querySelector<HTMLButtonElement>('[role="alert"] button')!;
  expect(button.textContent).toBe(label);
  await act(async () => button.click());
}

describe.each(["en", "ar"] as const)("document lists (%s)", (locale) => {
  const messages = copy[locale];

  describe.each(pages)("$name", (page) => {
    it("shows the localized load error with a working Retry during a search", async () => {
      listResponse = failed;
      await mount(page, locale);
      await search(page.name, "  oasis  ");
      await waitFor(() =>
        expect(table(page.name).querySelector('[role="alert"]')?.textContent).toContain(
          messages.error
        )
      );
      expect(table(page.name).textContent).not.toContain(messages.noMatch);
      expect(table(page.name).textContent).not.toContain(page.empty[locale]);

      listResponse = () => json(page.rows);
      await retry(messages.retry);
      await waitFor(() => expect(renderedParties(page.name)).toEqual([parties[0]]));
    });

    it("keeps the normal empty state when a search is entered", async () => {
      await mount(page, locale);
      await search(page.name, "unmatched");
      await waitFor(() => expect(table(page.name).textContent).toContain(page.empty[locale]));
      expect(table(page.name).textContent).not.toContain(messages.noMatch);
      expect(table(page.name).querySelector('[role="alert"]')).toBeNull();
    });

    it("announces zero matches in the existing status region", async () => {
      listResponse = () => json(page.rows);
      await mount(page, locale);
      await waitFor(() => expect(renderedParties(page.name)).toEqual(parties));
      const status = table(page.name).querySelector('[role="status"]');
      expect(status?.textContent).toBe("");

      await search(page.name, "unmatched");
      expect(status?.textContent).toContain(messages.noMatch);
      expect(renderedParties(page.name)).toEqual([]);
      expect(table(page.name).textContent).not.toContain(page.empty[locale]);
    });

    it("filters rows by a trimmed case-insensitive reference and an Arabic party name", async () => {
      listResponse = () => json(page.rows);
      await mount(page, locale);
      await waitFor(() => expect(renderedParties(page.name)).toEqual(parties));

      await search(page.name, `  ${page.reference}  `);
      await waitFor(() => expect(renderedParties(page.name)).toEqual([parties[0]]));
      await search(page.name, "  النور  ");
      expect(renderedParties(page.name)).toEqual([parties[1]]);
    });
  });

  it("keeps debit notes visible while bill numbers load or fail, then searches them after Retry", async () => {
    const page = pages[2];
    listResponse = () => json(page.rows);
    let finishBills!: (response: Response) => void;
    billsResponse = () => new Promise((resolve) => (finishBills = resolve));
    await mount(page, locale);
    await search(page.name, "bill-second");
    await waitFor(() =>
      expect(container.querySelector('[role="status"]')?.textContent).toBe(messages.loadingBills)
    );
    expect(renderedParties(page.name)).toEqual(parties);
    expect(container.textContent).not.toContain(messages.noMatch);

    await act(async () => finishBills(failed()));
    await waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(messages.billsError)
    );
    expect(renderedParties(page.name)).toEqual(parties);
    expect(container.textContent).not.toContain(messages.noMatch);

    billsResponse = () => json(bills);
    await retry(messages.retry);
    await waitFor(() => expect(renderedParties(page.name)).toEqual([parties[1]]));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
