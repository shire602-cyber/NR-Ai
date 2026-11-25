// @vitest-environment jsdom
/** Homepage foundation: locale text hook, placeholder filling and the motion hooks in jsdom. */
import { createElement, act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("useMarketingText", () => {
  it("fills {name} placeholders and leaves unknown ones alone", async () => {
    const { fillPlaceholders } =
      await import("../../client/src/components/marketing/phase/home/text");
    expect(fillPlaceholders("From AED {price} a month, {x}", { price: 59 })).toBe(
      "From AED 59 a month, {x}"
    );
  });

  it.each([
    ["en", "Your books. Your VAT. Your e-invoices. Done."],
    ["ar", "دفاترك. ضريبتك. فواتيرك الإلكترونية. كلها منجزة."],
  ] as const)("reads the URL-forced %s locale", async (locale, title) => {
    const { useMarketingText } =
      await import("../../client/src/components/marketing/phase/home/text");
    function Probe() {
      const text = useMarketingText(locale);
      return createElement("p", null, `${text("hxHeroTitle")}|${text("hxHeroSub", { price: 59 })}`);
    }
    await act(async () => root.render(createElement(Probe)));
    const [heading, sub] = (container.textContent ?? "").split("|");
    expect(heading).toBe(title);
    expect(sub).toContain("59");
    expect(sub).not.toContain("{price}");
  });
});

describe("motion hooks", () => {
  it("useInView is true when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { useInView } = await import("../../client/src/components/marketing/phase/home/motion");
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const inView = useInView(ref);
      return createElement("div", { ref }, String(inView));
    }
    await act(async () => root.render(createElement(Probe)));
    expect(container.textContent).toBe("true");
  });

  it("useCountUp returns the final value under reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }))
    );
    const { useCountUp, usePrefersReducedMotion } =
      await import("../../client/src/components/marketing/phase/home/motion");
    function Probe() {
      const value = useCountUp(11100, { durationMs: 1000, enabled: true });
      return createElement("p", null, `${usePrefersReducedMotion()}|${value}`);
    }
    await act(async () => root.render(createElement(Probe)));
    expect(container.textContent).toBe("true|11100");
  });
});
