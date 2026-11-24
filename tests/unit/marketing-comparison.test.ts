// @vitest-environment jsdom
/**
 * Homepage comparison table: the config (every cell has a value or a dash, never "No", Muhasib
 * prices from shared/plans.ts) and the rendered table in English and Arabic, with and without
 * the single-competitor focus used by the /compare pages.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_MONTHLY_PRICES } from "../../shared/plans";
import {
  COMPARISON_ROWS,
  visibleColumns,
} from "../../client/src/components/marketing/phase/home/comparison";
import { COMPETITOR_PRICES } from "../../client/src/components/marketing/phase/home/competitor-prices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("comparison config", () => {
  it("keeps the price config dated and Xero without an AED price", () => {
    expect(COMPETITOR_PRICES.lastChecked).toBe("2026-11-24");
    expect(COMPETITOR_PRICES.xero.aedListPrice).toBeNull();
  });

  it("never names an accredited provider or calls a competitor one, in English or Arabic", () => {
    const forbidden = [
      /as your ASP/i,
      /\bas (an )?ASP\b/i,
      /\bASP\b.{0,40}(Wafeq|Zoho)|(Wafeq|Zoho).{0,40}\bASP\b/i,
      /(Wafeq|Zoho)[^.]{0,60}(accredited|مزوّد|مزود)|(accredited|مزوّد|مزود)[^.]{0,60}(Wafeq|Zoho)/i,
      /A-?Cube/i,
      /Complyance/i,
    ];
    for (const locale of ["en", "ar"]) {
      for (const file of ["marketing", "marketingMeta", "marketingHome"]) {
        const path = `client/src/locales/${locale}/${file}.json`;
        const catalog = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
        for (const [key, value] of Object.entries(catalog)) {
          for (const pattern of forbidden) {
            expect(value, `${path} ${key} matches ${pattern}`).not.toMatch(pattern);
          }
        }
      }
    }
  });

  it("reads Muhasib prices from shared/plans.ts", () => {
    const entry = COMPARISON_ROWS.find((r) => r.id === "entry")!;
    const top = COMPARISON_ROWS.find((r) => r.id === "top")!;
    expect(entry.cells.muhasib.vars?.price).toBe(PLAN_MONTHLY_PRICES.starter);
    expect(top.cells.muhasib.vars?.price).toBe(PLAN_MONTHLY_PRICES.enterprise);
    expect([entry.cells.muhasib.vars?.price, top.cells.muhasib.vars?.price]).toEqual([59, 229]);
  });

  it("carries competitor list prices and a source on every competitor cell", () => {
    const entry = COMPARISON_ROWS.find((r) => r.id === "entry")!;
    expect(entry.cells.wafeq.vars).toEqual({ monthly: 69, yearly: 57 });
    expect(entry.cells.zoho.vars).toEqual({ price: 60 });
    const top = COMPARISON_ROWS.find((r) => r.id === "top")!;
    expect(top.cells.wafeq.vars).toEqual({ monthly: 249, yearly: 200 });
    expect(top.cells.zoho.vars).toEqual({ price: 280 });
    for (const row of COMPARISON_ROWS) {
      for (const column of ["wafeq", "zoho"] as const) {
        expect(row.cells[column].source).toMatch(/^https:\/\//);
        expect(row.cells[column].checked).toBe("2026-11-24");
      }
    }
  });

  it("picks the visible columns", () => {
    expect(visibleColumns()).toEqual(["muhasib", "wafeq", "zoho"]);
    expect(visibleColumns("zoho")).toEqual(["muhasib", "zoho"]);
  });
});

describe("comparison render", () => {
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
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(locale: "en" | "ar", focus?: "wafeq" | "zoho") {
    const { ComparisonTable } =
      await import("../../client/src/components/marketing/phase/home/ComparisonTable");
    await act(async () => {
      root.render(createElement(ComparisonTable, { base: `/${locale}`, locale, focus }));
    });
    await vi.waitFor(() => {
      if (!container.querySelector("h2")?.textContent) throw new Error("copy not loaded");
    });
  }

  it("renders a real table with three columns, no empty cells and no 'No'", async () => {
    await mount("en");
    const section = container.querySelector("section#compare");
    expect(section?.getAttribute("data-testid")).toBe("section-compare");
    expect(container.querySelector("h2")?.textContent).toBe(
      "Everything you need. Nothing you pay extra for."
    );
    const table = container.querySelector("table")!;
    expect(table.querySelector("caption")?.textContent).toBeTruthy();
    expect(table.querySelectorAll("thead th[scope=col]")).toHaveLength(4);
    expect(table.querySelectorAll("tbody th[scope=row]")).toHaveLength(COMPARISON_ROWS.length);
    const cells = [...table.querySelectorAll("tbody td")];
    expect(cells).toHaveLength(COMPARISON_ROWS.length * 3);
    for (const cell of cells) {
      const text = cell.textContent!.trim();
      expect(text).not.toBe("");
      expect(text.toLowerCase()).not.toBe("no");
      if (cell.getAttribute("data-dash") === "true") {
        expect(text).toBe("-");
        expect(cell.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
          "Not confirmed on the vendor's public site"
        );
      }
    }
    const entry = table.querySelector('tr[data-row="entry"]')!;
    expect(entry.querySelector('td[data-column="muhasib"]')?.textContent).toBe("AED 59");
    expect(entry.querySelector('td[data-column="wafeq"]')?.textContent).toBe(
      "AED 69 (AED 57 billed yearly)"
    );
    expect(entry.querySelector('td[data-column="zoho"]')?.textContent).toBe(
      "Free plan, or AED 60 billed annually"
    );
    expect(table.querySelector('tr[data-row="top"] td[data-column="muhasib"]')?.textContent).toBe(
      "AED 229"
    );
    expect(container.textContent).not.toMatch(/A-Cube|Complyance|ZATCA/i);
  });

  it("renders the footnote, sources and compare links", async () => {
    await mount("en");
    const foot = container.querySelector('[data-testid="compare-footnote"]')!;
    expect(foot.textContent).toContain("As listed on vendor sites, 24 Nov 2026, excl. VAT.");
    expect(foot.textContent).toContain("trademarks of their owners");
    expect(foot.querySelector('a[href="https://www.wafeq.com/en-ae/pricing"]')).not.toBeNull();
    expect(foot.querySelector('a[href="https://www.zoho.com/ae/books/pricing/"]')).not.toBeNull();
    expect(container.querySelector('a[href="/en/compare/wafeq"]')).not.toBeNull();
    expect(container.querySelector('a[href="/en/compare/zoho"]')).not.toBeNull();
  });

  it("renders two columns for a focused competitor", async () => {
    await mount("en", "wafeq");
    expect(container.querySelectorAll("thead th[scope=col]")).toHaveLength(3);
    expect(container.querySelector('td[data-column="zoho"]')).toBeNull();
    expect(container.querySelector('td[data-column="wafeq"]')).not.toBeNull();
    expect(container.querySelector('a[href="/en/compare/zoho"]')).toBeNull();
    expect(container.querySelector("caption")?.textContent).toContain("Wafeq");
  });

  it("renders Arabic copy with Western digits", async () => {
    await mount("ar");
    expect(container.querySelector("h2")?.textContent).toBe("كل ما تحتاجه. دون رسوم إضافية.");
    const entry = container.querySelector('tr[data-row="entry"]')!;
    expect(entry.querySelector('td[data-column="muhasib"]')?.textContent).toBe("59 درهم");
    expect(container.querySelector('a[href="/ar/compare/wafeq"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/[٠-٩۰-۹]/);
    for (const cell of container.querySelectorAll("tbody td")) {
      expect(cell.textContent!.trim()).not.toBe("");
    }
  });
});
