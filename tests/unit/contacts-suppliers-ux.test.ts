// @vitest-environment jsdom
import { createElement, act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { filterVendors } from "../../client/src/lib/vendor-filter";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import Vendors from "../../client/src/pages/Vendors";
import CustomerContacts from "../../client/src/pages/CustomerContacts";
import { click, flushUntil, type } from "./helpers/form-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const company = vi.hoisted(() => ({ id: "c-1" as string | undefined }));
vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    companyId: company.id,
    company: { id: company.id, name: "Co" },
    isLoading: false,
    error: null,
  }),
}));

const load = (l: string) =>
  JSON.parse(readFileSync(`client/src/locales/${l}/pages.json`, "utf8")) as Record<string, string>;

const vendors = [
  {
    name: "Gulf Supplies LLC",
    nameAr: "الخليج للتوريد",
    trn: "100123456700003",
    email: "a@gulf.ae",
  },
  { name: "Noor Traders", nameAr: null, trn: null, email: "sales@noor.ae" },
];

describe("supplier search", () => {
  it("returns everything for an empty term", () => {
    expect(filterVendors(vendors, "  ")).toHaveLength(2);
  });
  it("matches name, Arabic name, TRN and email", () => {
    expect(filterVendors(vendors, "noor")).toHaveLength(1);
    expect(filterVendors(vendors, "الخليج")).toHaveLength(1);
    expect(filterVendors(vendors, "1001234")).toHaveLength(1);
    expect(filterVendors(vendors, "SALES@")).toHaveLength(1);
    expect(filterVendors(vendors, "zzz")).toHaveLength(0);
  });
});

describe("contacts and suppliers copy", () => {
  const keys = Object.keys(load("en")).filter(
    (k) =>
      k.startsWith("pages.vendors") ||
      k.startsWith("pages.contactsDelete") ||
      k.startsWith("pages.list") ||
      k === "pages.contactsTab"
  );
  it("has Arabic for every new key, with matching placeholders", () => {
    expect(keys.length).toBeGreaterThanOrEqual(10);
    const en = load("en");
    const ar = load("ar");
    for (const k of keys) {
      expect(ar[k], k).toBeTruthy();
      expect(ar[k], k).not.toBe(en[k]);
      const ph = (s: string) => (s.match(/\{(\w+)/g) ?? []).sort().join();
      expect(ph(ar[k]), k).toBe(ph(en[k]));
    }
  });
  it("pages no longer hardcode the English strings", () => {
    // Source inspection: the delete dialogs sit behind menus and mutations this file does not drive.
    const c = readFileSync("client/src/pages/CustomerContacts.tsx", "utf8");
    expect(c).not.toContain("This action cannot be undone");
    expect(c).not.toContain('"Delete all contacts"');
    const v = readFileSync("client/src/pages/Vendors.tsx", "utf8");
    expect(v).not.toContain('eyebrow="Purchases"');
  });
});

// ── Rendered query states ───────────────────────────────────────────────────

const SUPPLIER = {
  id: "v-1",
  name: "Gulf Supplies LLC",
  nameAr: null,
  trn: null,
  email: "a@gulf.ae",
  phone: null,
  paymentTermsDays: 30,
  currency: "AED",
  iban: null,
};
const CONTACT = { id: "k-1", name: "Noor Traders", email: "sales@noor.ae", isCustomer: true };
const AGING = {
  vendors: [] as unknown[],
  unappliedCredits: 0,
  reconciliation: { glBalance: 0, agingTotal: 0, difference: 0, isReconciled: true },
};
const STATEMENT_TYPES = [
  "bill",
  "payment",
  "debit_note",
  "credit_applied",
  "payment_reversal",
  "prepayment_applied",
] as const;
const line = (kind: string, i: number) => ({
  date: "2026-11-01",
  type: kind,
  reference: `REF-${i}`,
  documentId: `d-${i}`,
  charge: 1,
  credit: 0,
  balance: i + 1,
});

type Reply = unknown | "fail" | "hang";
let replies: { vendors: Reply; aging: Reply; statement: Reply; contacts: Reply };
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as unknown as typeof window.matchMedia;
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  replies = {
    vendors: [SUPPLIER],
    aging: AGING,
    statement: { lines: [], closingBalance: 0 },
    contacts: [CONTACT],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const reply: Reply = url.endsWith("/vendors")
        ? replies.vendors
        : url.endsWith("/vendors/aging")
          ? replies.aging
          : url.endsWith("/statement")
            ? replies.statement
            : url.endsWith("/customer-contacts")
              ? replies.contacts
              : url.endsWith("/portal-summary")
                ? {}
                : [];
      if (reply === "hang") return new Promise<Response>(() => {});
      return new Response(JSON.stringify(reply === "fail" ? { message: "boom" } : reply), {
        status: reply === "fail" ? 500 : 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  queryClient.clear();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  onlineManager.setOnline(true);
  company.id = "c-1";
  vi.unstubAllGlobals();
  await act(async () => useI18n.getState().setLocale("en"));
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

async function mount(Page: ComponentType, locale: "en" | "ar" = "en") {
  await act(async () => useI18n.getState().setLocale(locale));
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Page)));
  });
  await settle();
}

const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
const text = () => document.body.textContent ?? "";
const refresh = async () => {
  await act(async () => {
    void queryClient.invalidateQueries();
  });
  await settle();
};
const goOffline = () => act(async () => onlineManager.setOnline(false));
const dialog = () => $('[role="dialog"]')!;
const openStatement = async (label = "Statement") => {
  await click($(`button[aria-label="${label}"]`));
  await settle();
};
const openAging = async () => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find(
    (el) => el.textContent === "Payables aging"
  )!;
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await settle();
};

const PAGES = [
  {
    name: "supplier list",
    Page: Vendors,
    key: "vendors",
    row: "Gulf Supplies LLC",
    empty: "No suppliers yet",
    search: "input-search-vendors",
    noMatch: "No matching suppliers",
  },
  {
    name: "contact list",
    Page: CustomerContacts,
    key: "contacts",
    row: "Noor Traders",
    empty: "No contacts yet",
    search: "input-search-contacts",
    noMatch: "No matching contacts",
  },
] as const;

describe.each(PAGES)("$name query states", ({ Page, key, row, empty, search, noMatch }) => {
  it("shows a loading skeleton, not an empty list, during the first fetch", async () => {
    replies[key] = "hang";
    await mount(Page);
    expect($('[data-testid="table-skeleton"]')).toBeTruthy();
    expect(text()).not.toContain(empty);
  });

  it("waits honestly when the first fetch is paused", async () => {
    await goOffline();
    await mount(Page);
    expect($('[data-testid="query-waiting"]')?.textContent).toContain("Waiting for a connection");
    expect($('[data-testid="table-skeleton"]')).toBeNull();
    expect(text()).not.toContain(empty);
  });

  it("shows an error with a working retry when the first fetch fails", async () => {
    replies[key] = "fail";
    await mount(Page);
    expect($('[role="alert"]')).toBeTruthy();
    expect(text()).not.toContain(empty);
    replies[key] = key === "vendors" ? [SUPPLIER] : [CONTACT];
    await click(
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Try again")!
    );
    await settle();
    expect(text()).toContain(row);
  });

  it("shows the empty state only after a successful empty answer", async () => {
    replies[key] = [];
    await mount(Page);
    expect(text()).toContain(empty);
    expect($('[data-testid^="query-stale"]')).toBeNull();
  });

  it("shows no-match for a search that filters a fresh list to nothing", async () => {
    await mount(Page);
    await type($(`[data-testid="${search}"]`), "zzz");
    expect(text()).toContain(noMatch);
  });

  it("keeps saved rows and reports a failed refresh", async () => {
    await mount(Page);
    replies[key] = "fail";
    await refresh();
    expect(text()).toContain(row);
    expect($('[data-testid="query-stale-error"]')?.textContent).toContain("Couldn't refresh");
  });

  it("keeps saved rows and reports a paused refresh", async () => {
    await mount(Page);
    await goOffline();
    await refresh();
    expect(text()).toContain(row);
    expect($('[data-testid="query-stale-paused"]')?.textContent).toContain("Refresh paused");
  });

  it.each(["fail", "paused"] as const)(
    "does not present a saved empty or filtered-zero result as current after a %s refresh",
    async (how) => {
      const stale = async () => {
        if (how === "fail") replies[key] = "fail";
        else await goOffline();
        await refresh();
      };
      replies[key] = [];
      await mount(Page);
      await stale();
      expect(text()).toContain("Nothing in the last saved copy");
      expect(text()).not.toContain(empty);

      await act(async () => onlineManager.setOnline(true));
      replies[key] = key === "vendors" ? [SUPPLIER] : [CONTACT];
      await refresh();
      await type($(`[data-testid="${search}"]`), "zzz");
      await stale();
      expect(text()).toContain("No matches in the last saved copy");
      expect(text()).not.toContain(noMatch);
    }
  );

  it("speaks Arabic in the waiting state", async () => {
    await goOffline();
    await mount(Page, "ar");
    expect($('[data-testid="query-waiting"]')?.textContent).toContain("بانتظار الاتصال");
  });
});

describe("supplier aging query states", () => {
  it.each([
    ["hang", '[data-testid="table-skeleton"]'],
    ["fail", '[role="alert"]'],
  ] as const)("does not claim nothing is owed when the first fetch is %s", async (reply, sel) => {
    replies.aging = reply;
    await mount(Vendors);
    await openAging();
    expect($(sel)).toBeTruthy();
    expect(text()).not.toContain("Nothing owed to suppliers");
  });

  it("waits when paused", async () => {
    await goOffline();
    await mount(Vendors);
    await openAging();
    expect($('[data-testid="query-waiting"]')).toBeTruthy();
    expect(text()).not.toContain("Nothing owed to suppliers");
  });

  it("shows empty on success, then a saved-copy state after a failed refresh", async () => {
    await mount(Vendors);
    await openAging();
    expect(text()).toContain("Nothing owed to suppliers");
    replies.aging = "fail";
    await refresh();
    expect($('[data-testid="query-stale-error"]')).toBeTruthy();
    expect(text()).toContain("Nothing in the last saved copy");
    expect(text()).not.toContain("Nothing owed to suppliers");
  });
});

describe("supplier statement dialog query states", () => {
  it.each([
    ["hang", '[data-testid="table-skeleton"]'],
    ["fail", '[role="alert"]'],
  ] as const)("shows its own %s state on the first fetch", async (reply, sel) => {
    replies.statement = reply;
    await mount(Vendors);
    await openStatement();
    expect(dialog().querySelector(sel)).toBeTruthy();
    expect(dialog().textContent).not.toContain("No transactions");
  });

  it("waits when paused", async () => {
    await mount(Vendors);
    await goOffline();
    await openStatement();
    expect(dialog().querySelector('[data-testid="query-waiting"]')).toBeTruthy();
    expect(dialog().querySelector("table")).toBeNull();
  });

  it("shows an empty statement without a header-only table, then marks it saved", async () => {
    await mount(Vendors);
    await openStatement();
    expect(dialog().textContent).toContain("No transactions for this supplier yet");
    expect(dialog().querySelector("table")).toBeNull();
    replies.statement = "fail";
    await refresh();
    expect(dialog().querySelector('[data-testid="query-stale-error"]')).toBeTruthy();
    expect(dialog().textContent).toContain("No transactions in the last saved copy");
    expect(dialog().textContent).not.toContain("No transactions for this supplier yet");
  });

  it("keeps saved lines through a paused refresh", async () => {
    replies.statement = { lines: [line("bill", 0)], closingBalance: 1 };
    await mount(Vendors);
    await openStatement();
    await goOffline();
    await refresh();
    expect(dialog().textContent).toContain("REF-0");
    expect(dialog().querySelector('[data-testid="query-stale-paused"]')).toBeTruthy();
  });

  it.each([
    [
      "en",
      "Statement",
      ["Bill", "Payment", "Debit note", "Credit applied", "Payment reversal", "Prepayment applied"],
    ],
    [
      "ar",
      "كشف حساب",
      ["فاتورة مورد", "دفعة", "إشعار مدين", "رصيد مطبق", "عكس دفعة", "دفعة مقدمة مطبقة"],
    ],
  ] as const)("translates all six line types in %s", async (locale, label, expected) => {
    replies.statement = { lines: STATEMENT_TYPES.map(line), closingBalance: 6 };
    await mount(Vendors, locale);
    await openStatement(label);
    const types = [...dialog().querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelectorAll("td")[1].textContent
    );
    expect(types).toEqual(expected);
  });
});

describe("new supplier dialog (loaded on demand)", () => {
  it("keeps typed values through a manual close and resets after a save", async () => {
    const button = (label: string) =>
      [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
    const name = () => document.getElementById("vendor-name") as HTMLInputElement | null;
    const openForm = async () => {
      await click(button("New supplier"));
      await flushUntil(() => name() !== null);
    };
    await mount(Vendors);
    expect($('[data-testid="dialog-vendor-form"]')).toBeNull();

    await openForm();
    await type(name(), "Atlas Office Supplies");
    await click(button("Cancel"));
    await settle();
    expect(name()).toBeNull();

    await openForm();
    expect(name()!.value).toBe("Atlas Office Supplies");

    await click(button("Save"));
    await settle();
    expect(name()).toBeNull();

    await openForm();
    expect(name()!.value).toBe("");
  });
});

describe("no company and saved data after a failed refresh", () => {
  it.each([
    ["supplier list", Vendors, "No suppliers yet"],
    ["contact list", CustomerContacts, "No contacts yet"],
  ] as const)("%s says no company is selected, never an empty list", async (_n, Page, empty) => {
    company.id = undefined;
    await mount(Page);
    expect($('[data-testid="query-no-company"]')?.textContent).toContain("No company selected");
    expect(text()).not.toContain(empty);
    expect($('[data-testid="query-waiting"]')).toBeNull();
  });

  it("keeps cached aging rows through a failed refresh", async () => {
    replies.aging = {
      ...AGING,
      vendors: [{ vendorId: "v-9", name: "Aging Cached Co", total: 50000 }],
    };
    await mount(Vendors);
    await openAging();
    expect(text()).toContain("Aging Cached Co");
    replies.aging = "fail";
    await refresh();
    expect(text()).toContain("Aging Cached Co");
    expect($('[data-testid="query-stale-error"]')).toBeTruthy();
  });

  it("keeps cached statement lines through a failed refresh", async () => {
    replies.statement = { lines: [line("bill", 0)], closingBalance: 1 };
    await mount(Vendors);
    await openStatement();
    expect(dialog().textContent).toContain("REF-0");
    replies.statement = "fail";
    await refresh();
    expect(dialog().textContent).toContain("REF-0");
    expect(dialog().querySelector('[data-testid="query-stale-error"]')).toBeTruthy();
  });
});
