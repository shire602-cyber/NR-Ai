// @vitest-environment jsdom
/** Homepage hero package: hero + CTAs, live stage final frame, trust chips, announcement bar. */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE } from "../../client/src/components/marketing/sample";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const SECTIONS = {
  Hero: async () => (await import("../../client/src/components/marketing/phase/home/Hero")).Hero,
  TrustChips: async () =>
    (await import("../../client/src/components/marketing/phase/home/TrustChips")).TrustChips,
  AnnouncementBar: async () =>
    (await import("../../client/src/components/marketing/phase/home/AnnouncementBar"))
      .AnnouncementBar,
};

async function renderSection(name: keyof typeof SECTIONS, locale: "en" | "ar") {
  const Section = await SECTIONS[name]();
  await act(async () => root.render(createElement(Section, { base: `/${locale}`, locale })));
  for (
    let i = 0;
    i < 20 && name === "Hero" && !container.querySelector('[data-testid="hero-stage"]');
    i++
  ) {
    await flush();
  }
  await flush();
}

describe("Hero", () => {
  it.each([
    ["en", "Your books. Your VAT. Your e-invoices. Done."],
    ["ar", "دفاترك. ضريبتك. فواتيرك الإلكترونية. كلها منجزة."],
  ] as const)("renders the h1 and the CTAs in %s", async (locale, title) => {
    await renderSection("Hero", locale);
    expect(container.querySelector("h1")?.textContent).toBe(title);
    const { trialSignupPath } =
      await import("../../client/src/components/marketing/phase/route-content");
    expect(container.querySelector('[data-testid="button-hero-start"]')?.getAttribute("href")).toBe(
      trialSignupPath
    );
    expect(container.querySelector('a[href="#tour"]')).not.toBeNull();
    expect(container.querySelector('a[href="/demo"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-hero-demo"]')?.getAttribute("href")).toBe(
      `/${locale}/book-demo`
    );
  });

  it("shows the static final frame without IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await renderSection("Hero", "en");
    const stage = container.querySelector('[data-testid="hero-stage"]');
    expect(stage?.getAttribute("role")).toBe("img");
    expect(stage?.getAttribute("data-animated")).toBe("false");
    expect(stage?.querySelector("a, button, input, [tabindex]")).toBeNull();
    const shown = stage?.textContent ?? "";
    expect(shown).toContain("Delivered");
    expect(shown).toContain("Sample data");
    expect(shown).toContain("11,100.00");
  });

  it("shows the final frame under prefers-reduced-motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    await renderSection("Hero", "ar");
    const stage = container.querySelector('[data-testid="hero-stage"]');
    expect(stage?.getAttribute("dir")).toBe("rtl");
    expect(stage?.getAttribute("data-animated")).toBe("false");
    expect(stage?.textContent).toContain("تم التسليم");
    expect(stage?.textContent).toContain("11,100.00");
  });
});

describe("hero model", () => {
  it("VAT on the sample invoice is exactly 5% of the net, in integer fils", async () => {
    const { INVOICE, vatOnNet, formatFils, RECEIPT } =
      await import("../../client/src/components/marketing/phase/home/hero/model");
    expect(INVOICE.vatFils).toBe(vatOnNet(INVOICE.netFils));
    expect(INVOICE.vatFils * 20).toBe(INVOICE.netFils);
    expect(Number.isInteger(INVOICE.vatFils)).toBe(true);
    expect(
      INVOICE.lines.reduce((sum: number, line: { netFils: number }) => sum + line.netFils, 0)
    ).toBe(INVOICE.netFils);
    expect(INVOICE.totalFils).toBe(SAMPLE.invoices[0].total * 100);
    expect(formatFils(INVOICE.totalFils)).toBe("19,425.00");
    expect(RECEIPT.vatFils).toBe(6000);
  });
});

describe("TrustChips", () => {
  it("renders six chips in English", async () => {
    await renderSection("TrustChips", "en");
    const chips = [...container.querySelectorAll(".mz-chip")].map((el) => el.textContent);
    expect(chips).toEqual([
      "Prices in AED",
      "English + Arabic invoices",
      "VAT 201 ready for EmaraTax",
      "PINT AE e-invoicing",
      "WPS payroll file",
      "No card to try",
    ]);
  });

  it("renders six chips in Arabic", async () => {
    await renderSection("TrustChips", "ar");
    const chips = [...container.querySelectorAll(".mz-chip")].map((el) => el.textContent ?? "");
    expect(chips).toHaveLength(6);
    expect(chips[0]).toBe("الأسعار بالدرهم");
    for (const chip of chips) expect(chip).toMatch(/[؀-ۿ]/);
  });
});

describe("AnnouncementBar", () => {
  it("links to the e-invoicing guide and stays hidden once dismissed", async () => {
    await renderSection("AnnouncementBar", "en");
    const bar = container.querySelector('[data-testid="section-announcement"]');
    expect(bar?.getAttribute("aria-label")).toBe("Announcement");
    expect(bar?.querySelector("a")?.getAttribute("href")).toBe("/en/uae-e-invoicing");
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Dismiss announcement");
    await act(async () => button?.click());
    expect(container.querySelector('[data-testid="section-announcement"]')).toBeNull();
    expect(window.sessionStorage.getItem("mz-announcement-dismissed")).toBe("1");
  });

  it("starts hidden when it was dismissed earlier in the session", async () => {
    window.sessionStorage.setItem("mz-announcement-dismissed", "1");
    await renderSection("AnnouncementBar", "en");
    expect(container.querySelector('[data-testid="section-announcement"]')).toBeNull();
  });
});
