// @vitest-environment jsdom
/**
 * "Talk to us" plan mailto links: the subject follows the interface language through the
 * catalogs (it used to stay English in Arabic), the address is unchanged, and there is no body.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UPGRADE_CONTACT_EMAIL } from "../../shared/trial";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function parse(href: string) {
  const url = new URL(href);
  return {
    address: url.pathname,
    subject: url.searchParams.get("subject"),
    keys: [...url.searchParams.keys()],
  };
}

async function renderPricing() {
  const { default: Pricing } = await import("../../client/src/pages/Pricing");
  const { hook } = memoryLocation({ path: "/pricing" });
  await act(async () => {
    root.render(createElement(Router, { hook }, createElement(Pricing)));
  });
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 20)));
}

const mailtos = () =>
  [...container.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]')]
    .map((a) => a.getAttribute("href")!)
    .filter((h) => h.includes("subject="));

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  localStorage.clear();
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("planContactHref", () => {
  it("English subject is unchanged, Arabic follows the catalog, address and body untouched", async () => {
    const { planContactHref } = await import("../../client/src/lib/planContact");
    const { useI18n } = await import("../../client/src/lib/i18n");
    const en = parse(planContactHref("Enterprise"));
    expect(en).toEqual({
      address: UPGRADE_CONTACT_EMAIL,
      subject: "Muhasib.ai Enterprise",
      keys: ["subject"],
    });
    act(() => useI18n.getState().setLocale("ar"));
    const ar = parse(planContactHref("المؤسسات"));
    expect(ar.address).toBe(UPGRADE_CONTACT_EMAIL);
    expect(ar.subject).toBe("باقة المؤسسات من Muhasib.ai");
    expect(ar.keys).toEqual(["subject"]);
    expect(parse(planContactHref()).subject).toBe("استفسار عن باقات Muhasib.ai");
  });
});

describe("/pricing Enterprise mailto", () => {
  it("is English in English and Arabic in Arabic (comparison table and plan cards)", async () => {
    await renderPricing();
    const en = mailtos().map(parse);
    expect(en.length).toBeGreaterThan(0);
    for (const m of en) {
      expect(m.address).toBe(UPGRADE_CONTACT_EMAIL);
      expect(m.subject).toBe("Muhasib.ai Enterprise");
    }
    act(() => root.unmount());
    root = createRoot(container);
    const { useI18n } = await import("../../client/src/lib/i18n");
    act(() => useI18n.getState().setLocale("ar"));
    await renderPricing();
    const ar = mailtos().map(parse);
    expect(ar.length).toBeGreaterThan(0);
    for (const m of ar) {
      expect(m.address).toBe(UPGRADE_CONTACT_EMAIL);
      expect(m.subject).toBe("باقة المؤسسات من Muhasib.ai");
      expect(m.subject).not.toMatch(/Enterprise/);
    }
  });
});
