// @vitest-environment jsdom
/**
 * D3a: regression guards for the app-screen design pass (sales, purchases, banking, ledger,
 * inventory, fixed assets, cost centres). Behaviour tests render the shared primitives the
 * screens rely on; the CSS checks are source-level because jsdom does not apply stylesheets.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
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

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
}

describe("D3a design pass", () => {
  it("Tabs follow the document direction in Arabic (Radix defaulted every tab panel to LTR)", async () => {
    const { Tabs, TabsContent, TabsList, TabsTrigger } =
      await import("../../client/src/components/ui/tabs");
    const tree = (dir?: "ltr" | "rtl") =>
      createElement(
        Tabs,
        { defaultValue: "a", dir },
        createElement(TabsList, null, createElement(TabsTrigger, { value: "a" }, "A")),
        createElement(TabsContent, { value: "a" }, "panel")
      );
    await setLocale("ar");
    act(() => root.render(tree()));
    expect(container.firstElementChild?.getAttribute("dir")).toBe("rtl");
    // An explicit prop still wins.
    act(() => root.render(tree("ltr")));
    expect(container.firstElementChild?.getAttribute("dir")).toBe("ltr");
    await setLocale("en");
    act(() => root.render(tree()));
    expect(container.firstElementChild?.getAttribute("dir")).toBe("ltr");
  });

  it("RowActions collapseOnMobile hides the visible buttons below md and keeps a menu trigger", async () => {
    const { RowActions, RowActionButton } =
      await import("../../client/src/components/ui/row-actions");
    const { Pencil } = await import("lucide-react");
    act(() =>
      root.render(
        createElement(
          RowActions,
          { collapseOnMobile: true },
          createElement(RowActionButton, { label: "Edit", icon: Pencil, onClick: () => {} })
        )
      )
    );
    const visible = container.querySelector('button[aria-label="Edit"]');
    expect(visible?.parentElement?.className).toContain("hidden");
    expect(visible?.parentElement?.className).toContain("md:flex");
    // The ⋯ trigger exists even with no `menu` prop, so phones can still reach "Edit".
    expect(container.querySelectorAll("button").length).toBe(2);
  });

  it("StatusBadge localises the new purchase / banking / ledger statuses in Arabic", async () => {
    const { StatusBadge } = await import("../../client/src/components/ui/badge");
    await setLocale("ar");
    for (const status of ["reconciled", "unmatched", "suggested", "accepted", "billed", "paused"]) {
      act(() => root.render(createElement(StatusBadge, { status })));
      const text = container.textContent ?? "";
      expect(text, status).toMatch(/[؀-ۿ]/);
      expect(text, status).not.toContain(status);
    }
  });

  it("every screens.* key has English and Arabic copy", () => {
    const en = JSON.parse(read("client/src/locales/en/screens.json")) as Record<string, string>;
    const ar = JSON.parse(read("client/src/locales/ar/screens.json")) as Record<string, string>;
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(ar)) {
      expect(en[key], key).toBeTruthy();
      expect(value, key).toMatch(/[؀-ۿ]/);
    }
  });

  it("CSS: tables keep the document direction and phones get two-line row cards", () => {
    // Source-level: jsdom does not evaluate stylesheets, so the selectors are asserted directly.
    const rtl = read("client/src/styles/rtl.css");
    expect(rtl).not.toContain(".tabular-nums");
    expect(rtl).toMatch(/:where\(th, td\):dir\(rtl\)\s*\{\s*text-align: start/);
    const mobile = read("client/src/styles/mobile.css");
    expect(mobile).toContain('table.row-cards td[data-cell="title"]');
    expect(mobile).toContain('table.row-cards td[data-cell="amount"]');
    expect(mobile).toContain('table.row-cards td[data-cell="status"]');
  });

  it("D3a screens use the shared table frame, money cells and no legacy styling", () => {
    const screens = [
      "Quotes",
      "CreditNotes",
      "RecurringInvoices",
      "Vendors",
      "BillPay",
      "PurchaseOrders",
      "ExpenseClaims",
      "BankAccounts",
      "BankReconciliation",
      "ChartOfAccounts",
      "AccountLedger",
      "Inventory",
      "FixedAssets",
      "CostCenters",
      "CustomerContacts",
    ];
    // Source-level on purpose: this guards how each page is written, across all its data states.
    // Follow the shared wrappers to the table frame. The whitespace after each JSX tag name
    // keeps similarly named types from counting as a render.
    const queryTable = read("client/src/components/contacts/query-state.tsx");
    expect(queryTable.split("export function QueryTableCard")[1]).toMatch(/<DataTableCard\s/);
    const documentTable = read("client/src/components/documents/DocumentListTable.tsx");
    const listQueryTableImport =
      /import \{[^}]*\bListQueryTable\b[^}]*\} from "@\/components\/ui\/list-query-table"/;
    expect(documentTable).toMatch(listQueryTableImport);
    expect(documentTable.split("export function DocumentListTable")[1]).toMatch(
      /<ListQueryTable\s/
    );
    const listQueryTable = read("client/src/components/ui/list-query-table.tsx");
    expect(listQueryTable).toMatch(
      /import \{[^}]*\bDataTableCard\b[^}]*\} from "@\/components\/ui\/data-table"/
    );
    expect(listQueryTable.split("export function ListQueryTable")[1]).toMatch(/<DataTableCard\s/);
    for (const name of screens) {
      const src = read(`client/src/pages/${name}.tsx`);
      if (name === "Vendors" || name === "CustomerContacts") {
        expect(src, name).toMatch(
          /import \{[^}]*\bQueryTableCard\b[^}]*\} from "@\/components\/contacts\/query-state"/
        );
        expect(src, name).toMatch(/<QueryTableCard\s/);
      } else if (name === "Quotes" || name === "CreditNotes") {
        expect(src, name).toMatch(
          /import \{[^}]*\bDocumentListTable\b[^}]*\} from "@\/components\/documents\/DocumentListTable"/
        );
        expect(src, name).toMatch(/<DocumentListTable\s/);
      } else if (
        ["RecurringInvoices", "PurchaseOrders", "ChartOfAccounts", "FixedAssets"].includes(name)
      ) {
        expect(src, name).toMatch(listQueryTableImport);
        expect(src, name).toMatch(/<ListQueryTable\s/);
      } else {
        expect(src, name).toContain("<DataTableCard");
      }
      expect(src, name).not.toMatch(/font-mono|hover:bg-accent|text-\[hsl\(var\(--chart-\d/);
      expect(src, name).not.toMatch(/\b(?:ml|mr|pl|pr)-\d|text-left\b|text-right\b/);
    }
    // Every screen starts with the shared PageHeader.
    for (const name of [...screens, "Receipts", "Journal", "JournalEntryDetail", "Invoices"]) {
      expect(read(`client/src/pages/${name}.tsx`), name).toContain("<PageHeader");
    }
  });
});
