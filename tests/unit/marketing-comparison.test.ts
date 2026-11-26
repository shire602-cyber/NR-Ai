// @vitest-environment jsdom
/**
 * Competitor comparison table (/compare pages only): the config (every cell has a value or a dash,
 * never "No", Muhasib prices from shared/plans.ts) and the rendered table in English and Arabic,
 * with and without the single-competitor focus. Also the homepage "switching" strip that links to
 * those pages without showing a competitor price.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKETING_BRAND } from "../../shared/marketing-brand";
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

  it("adds VAT to competitor list prices and carries a source on every competitor cell", () => {
    const entry = COMPARISON_ROWS.find((r) => r.id === "entry")!;
    expect(entry.cells.wafeq.vars).toEqual({ monthly: 72.45, yearly: 59.85 });
    expect(entry.cells.zoho.vars).toEqual({ price: 63 });
    const top = COMPARISON_ROWS.find((r) => r.id === "top")!;
    expect(top.cells.wafeq.vars).toEqual({ monthly: 261.45, yearly: 210 });
    expect(top.cells.zoho.vars).toEqual({ price: 294 });
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

  it("sources Wafeq bilingual invoices and the multi-client accountant workspace", () => {
    const bilingual = COMPARISON_ROWS.find((r) => r.id === "bilingual")!;
    const firm = COMPARISON_ROWS.find((r) => r.id === "firm")!;
    expect(bilingual.cells.wafeq.key).toBe("hxCmpYes");
    expect(bilingual.cells.wafeq.source).toBe("https://www.wafeq.com/en-ae/create-invoice-online");
    expect(bilingual.cells.wafeq.sourceLabelKey).toBe("hxCmpSrcWafeqInvoices");
    expect(firm.cells.wafeq.key).toBe("hxCmpFirmWafeq");
    expect(firm.cells.wafeq.source).toBe("https://www.wafeq.com/en-ae/accountants");
    expect(firm.cells.wafeq.sourceLabelKey).toBe("hxCmpSrcWafeqAccountants");
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
      await import("../../client/src/components/marketing/phase/pages/ComparisonTable");
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
      "E-invoicing is included in every Muhasib plan."
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
    expect(entry.querySelector('td[data-column="muhasib"]')?.textContent).toBe(
      "AED 59 with monthly billing"
    );
    expect(entry.querySelector('td[data-column="wafeq"]')?.textContent).toBe(
      "AED 72.45 with monthly billing or AED 59.85 per month with annual billing"
    );
    expect(entry.querySelector('td[data-column="zoho"]')?.textContent).toBe(
      "Free plan or AED 63 per month with annual billing"
    );
    expect(table.querySelector('tr[data-row="top"] td[data-column="muhasib"]')?.textContent).toBe(
      "AED 229 with monthly billing"
    );
    expect(container.textContent).not.toMatch(/A-Cube|Complyance|ZATCA/i);
  });

  it("renders the footnote, sources and compare links", async () => {
    await mount("en");
    const foot = container.querySelector('[data-testid="compare-footnote"]')!;
    expect(foot.textContent).toContain("All prices shown include 5% UAE VAT.");
    expect(foot.textContent).toContain("trademarks of their owners");
    expect(foot.querySelector('a[href="https://www.wafeq.com/en-ae/pricing"]')).not.toBeNull();
    expect(foot.querySelector('a[href="https://www.zoho.com/ae/books/pricing/"]')).not.toBeNull();
    const zohoEinvoicing = container.querySelector(
      'tr[data-row="einvoicing"] td[data-column="zoho"]'
    )!;
    expect(zohoEinvoicing.textContent).toContain(
      "The first 100 transactions each year are included on Professional and higher plans. Additional packs are paid add-ons."
    );
    const einvLink = zohoEinvoicing.querySelector(
      'a[href="https://www.zoho.com/ae/books/e-invoicing/"]'
    );
    // The source label is neutral: no vendor name in the link text.
    expect(einvLink?.textContent).toBe("UAE e-invoicing documentation");
    expect(einvLink?.textContent).not.toMatch(/Zoho/i);
    const zohoBilingual = container.querySelector(
      'tr[data-row="bilingual"] td[data-column="zoho"]'
    )!;
    expect(zohoBilingual.textContent).toContain(
      "English and Arabic PDF for invoices sent via Peppol."
    );
    expect(
      zohoBilingual.querySelector('a[href="https://www.zoho.com/ae/books/help/e-invoicing/"]')
        ?.textContent
    ).toBe("UAE e-invoicing documentation");
    const wafeqBilingual = container.querySelector(
      'tr[data-row="bilingual"] td[data-column="wafeq"]'
    )!;
    expect(wafeqBilingual.getAttribute("data-dash")).not.toBe("true");
    expect(wafeqBilingual.textContent).toContain("Yes");
    expect(
      wafeqBilingual.querySelector('a[href="https://www.wafeq.com/en-ae/create-invoice-online"]')
        ?.textContent
    ).toBe("Create invoice online");
    const wafeqFirm = container.querySelector('tr[data-row="firm"] td[data-column="wafeq"]')!;
    expect(wafeqFirm.getAttribute("data-dash")).not.toBe("true");
    expect(wafeqFirm.textContent).toContain("Multi-client management");
    expect(wafeqFirm.textContent).not.toContain("client portal");
    expect(
      wafeqFirm.querySelector('a[href="https://www.wafeq.com/en-ae/accountants"]')?.textContent
    ).toBe("For accountants");
    expect(container.querySelector('a[href="/en/compare/wafeq"]')).not.toBeNull();
    expect(container.querySelector('a[href="/en/compare/zoho"]')).not.toBeNull();
  });

  it("renders two columns for a focused competitor", async () => {
    await mount("en", "wafeq");
    expect(container.querySelectorAll("thead th[scope=col]")).toHaveLength(3);
    expect(container.querySelector('td[data-column="zoho"]')).toBeNull();
    expect(container.querySelector('td[data-column="wafeq"]')).not.toBeNull();
    expect(container.querySelector("caption")?.textContent).toContain("Wafeq");
    expect(container.querySelector(".mz-lead")?.textContent).toBe(
      "A fact-based comparison with Wafeq, drawn from public vendor pages."
    );
    // Sources and the page link: only Wafeq is sourced, and the link goes to the other comparison.
    const foot = container.querySelector('[data-testid="compare-footnote"]')!;
    expect(foot.querySelector('a[href="https://www.wafeq.com/en-ae/pricing"]')).not.toBeNull();
    expect(foot.querySelector('a[href="https://www.zoho.com/ae/books/pricing/"]')).toBeNull();
    expect(foot.textContent).toContain("Vendor list prices checked 24 Nov 2026.");
    expect(container.querySelector('a[href="/en/compare/wafeq"]')).toBeNull();
    expect(container.querySelector('a[href="/en/compare/zoho"]')).not.toBeNull();
  });

  it("renders Arabic copy with Western digits", async () => {
    await mount("ar");
    expect(container.querySelector("h2")?.textContent).toBe(
      "الفوترة الإلكترونية مشمولة في كل باقات محاسب."
    );
    const entry = container.querySelector('tr[data-row="entry"]')!;
    expect(entry.querySelector('td[data-column="muhasib"]')?.textContent).toBe(
      "59 درهم بالدفع الشهري"
    );
    expect(entry.querySelector('td[data-column="wafeq"]')?.textContent).toBe(
      "72.45 درهم بالدفع الشهري أو 59.85 درهم شهريًا بالدفع السنوي"
    );
    expect(entry.querySelector('td[data-column="zoho"]')?.textContent).toBe(
      "باقة مجانية أو 63 درهم شهريًا بالدفع السنوي"
    );
    expect(container.querySelector('[data-testid="compare-footnote"]')?.textContent).toContain(
      "جميع الأسعار المعروضة شاملة ضريبة القيمة المضافة في الإمارات بنسبة 5%."
    );
    const arEinv = container.querySelector('tr[data-row="einvoicing"] td[data-column="zoho"]')!;
    expect(arEinv.textContent).toContain("أول 100 معاملة سنويًا. تتوفّر حزم إضافية مدفوعة.");
    expect(arEinv.querySelector("a")?.textContent).toBe("وثائق الفوترة الإلكترونية في الإمارات");
    expect(arEinv.querySelector("a")?.textContent).not.toMatch(/Zoho/i);
    expect(
      container.querySelector('tr[data-row="bilingual"] td[data-column="zoho"]')?.textContent
    ).toContain("ملف PDF بالإنجليزية والعربية للفواتير المرسلة عبر");
    const arBilingualWafeq = container.querySelector(
      'tr[data-row="bilingual"] td[data-column="wafeq"]'
    )!;
    expect(arBilingualWafeq.getAttribute("data-dash")).not.toBe("true");
    expect(arBilingualWafeq.textContent).toContain("نعم");
    expect(arBilingualWafeq.querySelector("a")?.textContent).toBe("إنشاء فاتورة عبر الإنترنت");
    const arFirmWafeq = container.querySelector('tr[data-row="firm"] td[data-column="wafeq"]')!;
    expect(arFirmWafeq.getAttribute("data-dash")).not.toBe("true");
    expect(arFirmWafeq.textContent).toContain("إدارة متعددة العملاء");
    expect(arFirmWafeq.querySelector("a")?.textContent).toBe("للمحاسبين");
    expect(container.querySelector('a[href="/ar/compare/wafeq"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/[٠-٩۰-۹]/);
    for (const cell of container.querySelectorAll("tbody td")) {
      expect(cell.textContent!.trim()).not.toBe("");
    }
  });

  describe.each(["en", "ar"] as const)("switching strip (%s)", (locale) => {
    it("names what Muhasib includes and links to both compare pages, with no prices", async () => {
      const { SwitchStrip } =
        await import("../../client/src/components/marketing/phase/home/SwitchStrip");
      await act(async () => {
        root.render(createElement(SwitchStrip, { base: `/${locale}`, locale }));
      });
      const strip = container.querySelector('section#switch[data-testid="section-switch"]')!;
      expect(strip.querySelector("h2")?.textContent).toBe(
        locale === "ar" ? "هل تنتقل من Wafeq أو Zoho Books؟" : "Switching from Wafeq or Zoho Books?"
      );
      expect(strip.getAttribute("aria-labelledby")).toBe(strip.querySelector("h2")?.id);
      const points = [...strip.querySelectorAll("li[data-point]")].map((li) => li.textContent);
      expect(points).toEqual(
        locale === "ar"
          ? [
              "ملف WPS للرواتب",
              "مساحة عمل متعددة العملاء للمحاسب وبوابة للعميل",
              "فواتير ضريبية ثنائية اللغة بالعربية والإنجليزية",
              "الفوترة الإلكترونية في كل الباقات",
            ]
          : [
              "WPS payroll file",
              "Accountant multi-client workspace and client portal",
              "Bilingual English and Arabic tax invoices",
              "E-invoicing on every plan",
            ]
      );
      const links = [...strip.querySelectorAll("a")];
      expect(links.map((a) => a.getAttribute("href"))).toEqual([
        `/${locale}/compare/wafeq`,
        `/${locale}/compare/zoho`,
      ]);
      const brand = MARKETING_BRAND.name[locale];
      expect(links.map((a) => a.textContent?.trim())).toEqual(
        locale === "ar"
          ? [`${brand} مقابل Wafeq`, `${brand} مقابل Zoho Books`]
          : [`${brand} vs Wafeq`, `${brand} vs Zoho Books`]
      );
      // No table, no price, no outbound vendor link: those belong to the compare pages.
      expect(strip.querySelector("table")).toBeNull();
      expect(strip.querySelector('a[href^="http"]')).toBeNull();
      expect(strip.textContent).not.toMatch(/\d/);
      expect(strip.textContent).not.toMatch(/AED|درهم/);
    });
  });
});
