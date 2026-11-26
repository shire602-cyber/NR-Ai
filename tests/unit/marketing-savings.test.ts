// @vitest-environment jsdom
/**
 * Homepage savings calculator: the pure model (assumptions, cap, software comparison) and the
 * rendered section in English and Arabic. Sliders are native range inputs driven through the
 * input event.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { planPrice } from "../../shared/plans";
import {
  ASSUMPTIONS,
  computeSavings,
  formatAedWhole,
  formatHours,
  type SavingsInput,
} from "../../client/src/components/marketing/phase/home/savings";
import { COMPARATORS } from "../../client/src/components/marketing/phase/home/competitor-prices";
import { PENALTY_AED_PER_MONTH } from "../../client/src/components/marketing/phase/home/deadlines";
import { trialSignupPath } from "../../client/src/components/marketing/phase/route-content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULTS: SavingsInput = {
  invoices: 40,
  receipts: 60,
  hours: 20,
  rate: 120,
  comparator: "wafeq",
  plan: "professional",
};

describe("savings model", () => {
  it("states conservative, capped assumptions", () => {
    expect(ASSUMPTIONS).toEqual({ minutesPerInvoice: 4, minutesPerReceipt: 3, capShare: 0.6 });
  });

  it("gives deterministic numbers for the defaults", () => {
    const r = computeSavings(DEFAULTS);
    expect(r.rawMinutes).toBe(340);
    expect(r.savedMinutes).toBe(340);
    expect(formatHours(r.hoursSaved)).toBe("5.7");
    expect(r.valueMonthFils).toBe(68_000);
    expect(r.valueYearFils).toBe(816_000);
    expect(r.software).toEqual({
      theirsYearAed: 2520,
      oursYearAed: planPrice("professional", "yearly"),
      diffAed: 1330,
    });
  });

  it("never saves more than the capped share of the hours entered", () => {
    const r = computeSavings({ ...DEFAULTS, invoices: 500, receipts: 500, hours: 10 });
    expect(r.rawMinutes).toBe(3500);
    expect(r.savedMinutes).toBe(360);
    expect(r.hoursSaved).toBeLessThanOrEqual(10 * ASSUMPTIONS.capShare);
  });

  it("returns zero for zero inputs and clamps junk", () => {
    const zero = computeSavings({ ...DEFAULTS, invoices: 0, receipts: 0 });
    expect(zero.savedMinutes).toBe(0);
    expect(zero.valueYearFils).toBe(0);
    expect(computeSavings({ ...DEFAULTS, hours: 0 }).savedMinutes).toBe(0);
    expect(computeSavings({ ...DEFAULTS, invoices: Number.NaN, receipts: -5 }).savedMinutes).toBe(
      0
    );
  });

  it("keeps a negative software difference negative (Muhasib dearer)", () => {
    const zoho = computeSavings({ ...DEFAULTS, comparator: "zoho", plan: "enterprise" });
    expect(zoho.software.theirsYearAed).toBe(1134);
    expect(zoho.software.diffAed).toBe(1134 - 2290);
    expect(zoho.software.diffAed).toBeLessThan(0);
    expect(computeSavings({ ...DEFAULTS, comparator: "sheet" }).software.diffAed).toBe(-1190);
  });

  it("has no price for Xero and Other", () => {
    expect(COMPARATORS.find((c) => c.id === "xero")?.perMonth).toBeNull();
    for (const id of ["xero", "other"] as const) {
      const r = computeSavings({ ...DEFAULTS, comparator: id });
      expect(r.software.theirsYearAed).toBeNull();
      expect(r.software.diffAed).toBeNull();
    }
  });

  it("formats money with Western digits", () => {
    expect(formatAedWhole(816_000)).toBe("8,160");
    expect(formatAedWhole(0)).toBe("0");
  });
});

describe("savings render", () => {
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
    vi.unstubAllGlobals();
  });

  async function mount(locale: "en" | "ar") {
    const { SavingsCalculator } =
      await import("../../client/src/components/marketing/phase/home/SavingsCalculator");
    await act(async () => {
      root.render(createElement(SavingsCalculator, { base: `/${locale}`, locale }));
    });
    await vi.waitFor(() => {
      if (!container.querySelector("h2")?.textContent) throw new Error("copy not loaded");
    });
  }

  const byId = (id: string, optional = false) => {
    const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return (optional ? el : el!) as HTMLElement;
  };
  const range = (index: number) =>
    container.querySelectorAll<HTMLInputElement>("input[type=range]")[index];
  function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
    const isSelect = el instanceof HTMLSelectElement;
    const proto = isSelect ? HTMLSelectElement : HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
    act(() => {
      set.call(el, value);
      el.dispatchEvent(new Event(isSelect ? "change" : "input", { bubbles: true }));
    });
  }

  it("renders defaults in English and updates when a slider moves", async () => {
    await mount("en");
    expect(container.querySelector("section#savings")?.getAttribute("data-testid")).toBe(
      "section-savings"
    );
    expect(container.querySelector("h2")?.textContent).toBe("What does switching save you?");
    expect(container.querySelectorAll("input[type=range]")).toHaveLength(4);
    for (const slider of container.querySelectorAll("input[type=range]")) {
      expect(slider.getAttribute("aria-valuetext")).toBeTruthy();
      expect(container.querySelector(`label[for="${slider.id}"]`)).not.toBeNull();
    }
    expect(byId("savings-hours").textContent).toBe("5.7 h");
    expect(byId("savings-month").textContent).toBe("AED 680");
    expect(byId("savings-year").textContent).toBe("AED 8,160");
    expect(byId("savings-headline").textContent).toContain("AED 8,160");
    expect(byId("savings-software").textContent).toContain(
      "Annual subscription cost (VAT included)"
    );
    expect(byId("savings-theirs").textContent).toBe("AED 2,520");
    expect(byId("savings-ours").textContent).toBe("AED 1,190");
    expect(byId("savings-diff").textContent).toBe("Muhasib costs AED 1,330 less per year.");
    expect(container.querySelector("[aria-live=polite]")).not.toBeNull();
    expect(container.textContent).toContain("Estimate");

    setValue(range(0), "100");
    expect(range(0).getAttribute("aria-valuetext")).toBe("100 invoices");
    expect(byId("savings-hours").textContent).toBe("9.7 h");
    expect(byId("savings-month").textContent).toBe("AED 1,160");

    setValue(range(2), "5");
    expect(byId("savings-hours").textContent).toBe("3 h");
    expect(byId("savings-month").textContent).toBe("AED 360");
  });

  it("shows the calculated annual value immediately in Arabic", async () => {
    // Hold animation frames so a count-up cannot reach its final value before the assertion.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    await mount("ar");
    expect(byId("savings-headline").textContent).toContain("8,160 درهم");
  });

  it("shows a dash, never a number, for Xero and an honest higher cost for Zoho", async () => {
    await mount("en");
    const [software] = container.querySelectorAll<HTMLSelectElement>("select");
    setValue(software, "xero");
    expect(byId("savings-theirs").textContent).toBe("-");
    expect(byId("savings-diff").textContent).toBe("No AED list price to compare.");
    expect(byId("savings-software").textContent).toContain("US dollars");
    setValue(software, "zoho");
    expect(byId("savings-theirs").textContent).toBe("AED 1,134");
    expect(byId("savings-diff").textContent).toBe("Muhasib costs AED 56 more per year.");
    expect(byId("savings-diff").getAttribute("data-tone")).toBe("more");
  });

  it("lists assumptions, sources, penalty context and the trial CTA", async () => {
    await mount("en");
    const how = byId("savings-how");
    expect(how.tagName).toBe("DETAILS");
    expect(how.textContent).toContain("How we calculate");
    expect(how.textContent).toContain("4 min");
    expect(how.textContent).toContain("3 min");
    expect(how.textContent).toContain("60%");
    expect(how.textContent).toContain("not measured results");
    expect(how.textContent).toContain("The estimate uses annual billing");
    expect(how.textContent).toContain("The calculator adds 5% UAE VAT to competitor prices.");
    expect(how.querySelector('a[href="https://www.wafeq.com/en-ae/pricing"]')).not.toBeNull();
    expect(how.querySelector('a[href="https://www.zoho.com/ae/books/pricing/"]')).not.toBeNull();
    expect(byId("savings-penalty").textContent).toContain(
      `AED ${PENALTY_AED_PER_MONTH.toLocaleString("en-US")} initially, then AED 5,000 per month or part thereof, capped at AED 50,000 in any 12 consecutive months`
    );
    expect(container.querySelector(`a[href="${trialSignupPath}"]`)?.textContent).toContain(
      "Start saving - 14 days free"
    );
  });

  it("shows a guided zero state and a labelled inputs group", async () => {
    await mount("en");
    expect(byId("savings-empty", true)).toBeNull();
    const group = container.querySelector<HTMLElement>('[role="group"]')!;
    expect(
      container.querySelector(`#${CSS.escape(group.getAttribute("aria-labelledby")!)}`)?.textContent
    ).toBe("Your numbers");
    expect(byId("savings-mini").textContent).toContain("AED 8,160");
    setValue(range(0), "0");
    setValue(range(1), "0");
    expect(byId("savings-year").textContent).toBe("AED 0");
    expect(byId("savings-empty").textContent).toBe(
      "Add your invoices, receipts and hours to see an estimate."
    );
    expect(byId("savings-mini").textContent).toContain("AED 0");
    setValue(range(0), "10");
    expect(byId("savings-empty", true)).toBeNull();
  });

  it("keeps zero-state copy in Arabic and values stay Western-digit", async () => {
    await mount("ar");
    setValue(range(0), "0");
    setValue(range(1), "0");
    expect(byId("savings-empty").textContent).toContain("أضف");
    expect(byId("savings-mini").textContent).toContain("0 درهم");
  });

  it("renders Arabic with Western digits and Arabic copy", async () => {
    await mount("ar");
    expect(byId("savings-software").textContent).toContain("شاملة ضريبة القيمة المضافة");
    expect(byId("savings-ours").textContent).toBe("1,190 درهم");
    expect(container.querySelector("h2")?.textContent).toBe("كم ستوفّر عند الانتقال؟");
    expect(byId("savings-month").textContent).toBe("680 درهم");
    expect(byId("savings-hours").textContent).toBe("5.7 ساعة");
    expect(byId("savings-penalty").textContent).toContain("5,000");
    expect(byId("savings-penalty").textContent).toContain("غرامة");
    expect(byId("savings-how").textContent).toContain("كيف نحسب");
    expect(container.querySelector(`a[href="${trialSignupPath}"]`)).not.toBeNull();
    expect(container.textContent).not.toMatch(/[٠-٩۰-۹]/);
    setValue(range(1), "100");
    expect(byId("savings-month").textContent).toBe("920 درهم");
  });
});
