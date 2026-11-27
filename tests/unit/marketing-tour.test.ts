// @vitest-environment jsdom
/**
 * Homepage "See it work" tour: the pure model (invoice totals, VAT 201 boxes, bank matching) and the
 * rendered mini-app (ARIA tabs, live totals, issue pipeline, keyboard, RTL, auto-advance).
 * jsdom has no IntersectionObserver, so the tour loads at once; reduced motion makes every
 * sequence jump to its final state on click.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invoiceTotals,
  nextTabIndex,
  parseQty,
  parseUnitFils,
  pearlFigures,
  reconcileBank,
  vat201Boxes,
  withVat,
} from "../../client/src/components/marketing/phase/home/tour/model";
import {
  BANK_ROWS,
  INVOICE_LINES,
  TOUR_CLIENTS,
  TOUR_TRANSACTIONS,
} from "../../client/src/components/marketing/phase/home/tour/sample";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("tour model", () => {
  it("prices lines in fils and adds 5% VAT", () => {
    const totals = invoiceTotals(INVOICE_LINES);
    expect(totals.amounts).toEqual([180_000, 120_000]);
    expect(totals).toMatchObject({ subtotalFils: 300_000, vatFils: 15_000, totalFils: 315_000 });
  });

  it("rounds VAT half-up to whole fils and handles an empty invoice", () => {
    // 0.10 AED x 1 = 10 fils; 5% = 0.5 fil -> 1 fil. 0.30 x 1 = 30 fils -> 1.5 -> 2.
    expect(invoiceTotals([{ qty: 1, unitFils: 10 }]).vatFils).toBe(1);
    expect(invoiceTotals([{ qty: 1, unitFils: 30 }]).vatFils).toBe(2);
    expect(invoiceTotals([{ qty: 3, unitFils: 33 }]).vatFils).toBe(5);
    expect(invoiceTotals([{ qty: 0, unitFils: 12_000 }])).toMatchObject({
      subtotalFils: 0,
      vatFils: 0,
      totalFils: 0,
    });
  });

  it("parses and clamps editable input", () => {
    expect(parseQty("4")).toBe(4);
    expect(parseQty("-3")).toBe(0);
    expect(parseQty("abc")).toBe(0);
    expect(parseQty("12345")).toBe(999);
    expect(parseQty("2.9")).toBe(2);
    expect(parseUnitFils("450")).toBe(45_000);
    expect(parseUnitFils("1,250.505")).toBe(125_051);
    expect(parseUnitFils("-5")).toBe(0);
    expect(parseUnitFils("")).toBe(0);
    expect(parseUnitFils("999999999")).toBe(100_000_000);
  });

  it("builds the VAT 201 boxes from the tour transactions", () => {
    const boxes = vat201Boxes();
    expect(boxes.box1b).toEqual({ amountFils: 1_100_000, vatFils: 55_000 });
    expect(boxes.box4).toEqual({ amountFils: 200_000, vatFils: 0 });
    expect(boxes.box8).toEqual({ amountFils: 1_300_000, vatFils: 55_000 });
    expect(boxes.box9).toEqual({ amountFils: 145_000, vatFils: 7_250 });
    expect(boxes.box11).toEqual(boxes.box9);
    // Box 14 = output VAT less recoverable input VAT = 550.00 - 72.50.
    expect(boxes.box14.vatFils).toBe(47_750);
  });

  it("matches bank lines to documents and leaves one for review", () => {
    const results = reconcileBank();
    expect(results.map((r) => r.ref)).toEqual(["INV-2001", "INV-2002", "EXP-302", "EXP-301", null]);
    expect(results.filter((r) => r.ref === null)).toHaveLength(1);
    // Every matched line equals the gross amount of the document it points at.
    for (const row of BANK_ROWS) {
      const match = results.find((r) => r.rowId === row.id);
      if (!match?.ref) continue;
      const doc = TOUR_TRANSACTIONS.map(withVat).find((d) => d.ref === match.ref);
      expect(doc?.totalFils).toBe(Math.abs(row.amountFils));
    }
  });

  it("never uses one document for two lines", () => {
    const twice = [BANK_ROWS[0], { ...BANK_ROWS[0], id: "dup" }];
    expect(reconcileBank(twice).map((r) => r.ref)).toEqual(["INV-2001", null]);
  });

  it("keeps the first sample client consistent with the transactions", () => {
    const pearl = pearlFigures();
    expect(pearl).toEqual({ openInvoices: 1, openAmountFils: 200_000, review: 1 });
    expect(TOUR_CLIENTS[0]).toMatchObject({
      openInvoices: pearl.openInvoices,
      openAmountFils: pearl.openAmountFils,
      review: pearl.review,
    });
  });

  it("mirrors arrow keys in RTL and supports Home/End", () => {
    expect(nextTabIndex("ArrowRight", 0, 5, false)).toBe(1);
    expect(nextTabIndex("ArrowRight", 0, 5, true)).toBe(4);
    expect(nextTabIndex("ArrowLeft", 0, 5, true)).toBe(1);
    expect(nextTabIndex("ArrowLeft", 0, 5, false)).toBe(4);
    expect(nextTabIndex("Home", 3, 5, false)).toBe(0);
    expect(nextTabIndex("End", 1, 5, true)).toBe(4);
    expect(nextTabIndex("a", 1, 5, false)).toBeNull();
  });
});

describe("tour render", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    const { loadLocale } = await import("../../client/src/lib/i18n");
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
  });

  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce") && reducedMotion,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    reducedMotion = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  let reducedMotion = true;

  async function mount(locale: "en" | "ar", waitForApp = true) {
    const { ProductTour } =
      await import("../../client/src/components/marketing/phase/home/ProductTour");
    const tr = ((pair: readonly [string, string]) => pair[locale === "ar" ? 1 : 0]) as never;
    await act(async () => {
      root.render(createElement(ProductTour, { base: `/${locale}`, locale, tr }));
    });
    if (!waitForApp) return;
    await vi.waitFor(() => {
      if (!container.querySelector('[data-testid="tour-invoice-doc"]'))
        throw new Error("tour not loaded");
    });
  }

  const tabs = () => [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
  const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

  function type(el: HTMLInputElement, value: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const press = (el: Element, key: string) =>
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  const click = (el: Element) =>
    act(() => {
      (el as HTMLElement).click();
    });

  it("renders five ARIA tabs with one selected panel and an explore link", async () => {
    await mount("en");
    const list = container.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe("Product tour");
    expect(tabs().map((t) => t.textContent)).toEqual([
      "Create an invoice",
      "Scan a receipt",
      "Reconcile a bank CSV",
      "VAT 201",
      "Accountant view",
    ]);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
    ]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(panels).toHaveLength(5);
    for (const [i, tab] of tabs().entries()) {
      expect(tab.getAttribute("aria-controls")).toBe(panels[i].id);
      expect(panels[i].getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panels[i].hasAttribute("hidden")).toBe(i !== 0);
    }
    expect(container.querySelector('a[href="/en/product/invoicing"]')?.textContent).toContain(
      "Explore feature"
    );
    expect(container.textContent).toContain("Sample data");
    expect(container.querySelector("section#tour")?.getAttribute("data-testid")).toBe(
      "section-tour"
    );
  });

  it("updates VAT and the total live as the quantity changes", async () => {
    await mount("en");
    expect(byId("tour-vat").textContent).toBe("150.00");
    expect(byId("tour-total").textContent).toBe("3,150.00");
    type(byId("tour-qty-0") as HTMLInputElement, "5");
    expect(byId("tour-vat").textContent).toBe("172.50");
    expect(byId("tour-total").textContent).toBe("3,622.50");
    type(byId("tour-price-1") as HTMLInputElement, "99999999");
    // Out-of-range input is clamped to the maximum unit price (1,000,000.00 AED):
    // 2,250.00 + 10 x 1,000,000.00 = 10,002,250.00; VAT 500,112.50.
    expect(byId("tour-vat").textContent).toBe("500,112.50");
    expect(byId("tour-total").textContent).toBe("10,502,362.50");
  });

  it("keeps nonzero totals for Arabic-Indic quantity and price through focus and blur", async () => {
    await mount("ar");
    const qty = byId("tour-qty-0") as HTMLInputElement;
    const price = byId("tour-price-0") as HTMLInputElement;
    type(qty, "٣");
    type(price, "٥٠٠٫٢٠");
    // 3 x 500.20 + 1,200.00 = 2,700.60; VAT 135.03 (Arabic decimal separator).
    expect(byId("tour-vat").textContent).toBe("135.03");
    expect(byId("tour-total").textContent).toBe("2,835.63");

    for (const input of [qty, price]) {
      act(() => input.focus());
      act(() => input.blur());
    }
    expect(byId("tour-vat").textContent).toBe("135.03");
    expect(byId("tour-total").textContent).toBe("2,835.63");
    // The fields now hold the numeric values rather than the typed Arabic digits.
    expect(Number((byId("tour-qty-0") as HTMLInputElement).value)).toBe(3);
    expect(Number((byId("tour-price-0") as HTMLInputElement).value)).toBe(500.2);
  });

  it("switches the invoice layout, bilingual shows both languages", async () => {
    await mount("en");
    const doc = () => byId("tour-invoice-doc");
    expect(doc().getAttribute("data-layout")).toBe("en");
    const buttons = [...container.querySelectorAll<HTMLElement>(".mz-tour-seg button")];
    click(buttons[2]);
    expect(doc().getAttribute("data-layout")).toBe("both");
    expect(doc().querySelector('[lang="en"]')?.textContent).toContain("Tax invoice");
    expect(doc().querySelector('[lang="ar"][dir="rtl"]')?.textContent).toContain("فاتورة ضريبية");
    click(buttons[1]);
    expect(doc().querySelectorAll("[lang]")).toHaveLength(1);
  });

  it("issues the invoice and ends at Delivered, announced to screen readers", async () => {
    await mount("en");
    click(byId("tour-issue"));
    const steps = [...container.querySelectorAll(".mz-tour-pipeline li")];
    expect(steps).toHaveLength(4);
    expect(steps[3].getAttribute("data-state")).toBe("current");
    expect(steps[3].querySelector(".mz-live")?.textContent).toBe("Delivered");
    expect(byId("tour-invoice-status").textContent).toBe("Status: Delivered");
    expect(container.textContent).toContain("Validated (PINT AE)");
    expect(container.textContent).toContain("Sent via accredited provider");
  });

  it("runs the other four tabs to their final state", async () => {
    await mount("en");
    click(tabs()[1]);
    await vi.waitFor(() => expect(byId("tour-scan")).not.toBeNull());
    click(byId("tour-scan"));
    expect(byId("tour-fields").textContent).toContain("Gulf Stationery Trading");
    expect(byId("tour-fields").textContent).toContain("Office supplies");

    click(tabs()[2]);
    await vi.waitFor(() => expect(byId("tour-match")).not.toBeNull());
    expect(container.textContent).toContain("bank-statement.csv");
    expect(container.textContent).toContain("Upload a CSV exported from your bank");
    click(byId("tour-match"));
    expect(byId("tour-bank-summary").textContent).toBe("4 of 5 lines matched. 1 to review.");
    expect(container.querySelectorAll('tr[data-state="review"]')).toHaveLength(1);

    click(tabs()[3]);
    await vi.waitFor(() => expect(byId("tour-vat-fill")).not.toBeNull());
    expect(container.textContent).toContain("then submit it in EmaraTax.");
    click(byId("tour-vat-fill"));
    expect(container.querySelector('tr[data-box="14"]')?.textContent).toContain("477.50");
    expect((byId("tour-vat-export") as HTMLButtonElement).disabled).toBe(false);
    expect(byId("tour-vat-export").textContent).toContain("Export for EmaraTax");

    click(tabs()[4]);
    await vi.waitFor(() => expect(byId("tour-client-dhow")).not.toBeNull());
    expect(byId("tour-client-summary").textContent).toContain("Pearl Trading LLC");
    click(byId("tour-client-dhow"));
    expect(byId("tour-client-summary").textContent).toContain("Dhow Logistics LLC");
    expect(byId("tour-client-summary").textContent).toContain("28 December 2026");
  });

  it("moves between tabs with the arrow keys, Home and End", async () => {
    await mount("en");
    press(tabs()[0], "ArrowRight");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1]);
    press(tabs()[1], "End");
    expect(tabs()[4].getAttribute("aria-selected")).toBe("true");
    press(tabs()[4], "ArrowRight");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    press(tabs()[0], "ArrowLeft");
    expect(tabs()[4].getAttribute("aria-selected")).toBe("true");
    press(tabs()[4], "Home");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("mirrors the arrow keys and shows Arabic labels in Arabic", async () => {
    await mount("ar");
    expect(tabs().map((t) => t.textContent)).toEqual([
      "أنشئ فاتورة",
      "امسح إيصالًا",
      "طابق كشفًا بنكيًا بصيغة CSV",
      "إقرار VAT 201",
      "عرض المحاسب",
    ]);
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe(
      "جولة في المنتج"
    );
    expect(container.textContent).toContain("بيانات تجريبية");
    expect(container.querySelector('a[href="/ar/product/invoicing"]')?.textContent).toContain(
      "استكشف الميزة"
    );
    press(tabs()[0], "ArrowRight");
    expect(tabs()[4].getAttribute("aria-selected")).toBe("true");
    press(tabs()[4], "ArrowLeft");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    // Money keeps Western digits.
    expect(byId("tour-total").textContent).toBe("3,150.00");
    click(byId("tour-issue"));
    expect(byId("tour-invoice-status").textContent).toBe("الحالة: تم التسليم");
  });

  it("never names a provider or uses banned bank wording", async () => {
    for (const locale of ["en", "ar"] as const) {
      await mount(locale);
      for (let i = 0; i < 5; i += 1) {
        click(tabs()[i]);
        await act(async () => {});
        await vi.waitFor(() =>
          expect(container.querySelector(".mz-tour-stage > *")).not.toBeNull()
        );
        const text = container.textContent ?? "";
        expect(text).not.toMatch(/A-?Cube|Complyance|ZATCA|Saudi|KSA/i);
        expect(text).not.toMatch(/bank feed|live bank|bank sync|connect your bank|direct filing/i);
      }
      act(() => root.render(null));
    }
  });

  it("auto-advances every 8 seconds until the visitor interacts, never under reduced motion", async () => {
    reducedMotion = false;
    vi.useFakeTimers();
    await mount("en", false);
    const selected = () => tabs().findIndex((t) => t.getAttribute("aria-selected") === "true");
    expect(selected()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(8100);
    });
    expect(selected()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(selected()).toBe(2);
    act(() => {
      container
        .querySelector(".mz-tour-shell")
        ?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(40_000);
    });
    expect(selected()).toBe(2);
  });

  it("does not auto-advance under prefers-reduced-motion", async () => {
    vi.useFakeTimers();
    await mount("en", false);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });
});
