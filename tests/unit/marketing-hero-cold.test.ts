// @vitest-environment jsdom
/**
 * Cold visit: the hero h1, lead and CTA labels must be present on the very first render, before
 * any lazy marketing catalog chunk has loaded (this file never calls loadLocale). Otherwise the
 * server-rendered heading would be replaced by an empty one during hydration.
 */
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import arMeta from "../../client/src/locales/ar/marketingMeta.json";
import enMeta from "../../client/src/locales/en/marketingMeta.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Hero on a cold visit", () => {
  it.each([
    ["en", enMeta],
    ["ar", arMeta],
  ] as const)("renders non-empty %s h1 and CTA labels on the first render", async (locale, meta) => {
    const { Hero } = await import("../../client/src/components/marketing/phase/home/Hero");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Hero, { base: `/${locale}`, locale })));

    expect(container.querySelector("h1")?.textContent).toBe(meta["marketing.hxHeroTitle"]);
    expect(container.querySelector("h1")?.textContent).not.toBe("");
    const labels = [
      container.querySelector('[data-testid="button-hero-start"]')?.textContent,
      container.querySelector("small")?.textContent,
      container.querySelector('a[href="#tour"]')?.textContent,
      container.querySelector('a[href="/demo"]')?.textContent,
      container.querySelector('[data-testid="button-hero-demo"]')?.textContent,
      container.querySelector(".mz-lead")?.textContent,
    ];
    for (const label of labels) expect((label ?? "").trim()).not.toBe("");
    expect(container.querySelector("h1")?.textContent).toBe(meta["marketing.hxHeroTitle"]);
    expect(container.querySelector('[data-testid="button-hero-start"]')?.textContent).toContain(
      meta["marketing.hxHeroCtaPrimary"]
    );

    act(() => root.unmount());
    container.remove();
  });
});
