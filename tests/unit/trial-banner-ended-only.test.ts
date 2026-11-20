// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ trial: null }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

async function render(trial: unknown, lang: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  const { TrialBanner } = await import("../../client/src/components/TrialBanner");
  act(() => useI18n.getState().setLocale(lang));
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(createElement(TrialBanner, { trial: trial as never, endedOnly: true }))
  );
  const html = el.textContent ?? "";
  const present = el.querySelector('[data-testid="trial-banner"]') !== null;
  await act(async () => root.unmount());
  el.remove();
  return { html, present };
}

describe("TrialBanner endedOnly (e-invoicing settings after the trial)", () => {
  it("stays hidden while the trial runs", async () => {
    const r = await render({ ended: false, daysLeft: 5 }, "en");
    expect(r.present).toBe(false);
  });
  it("says the workspace is locked once ended (en and ar)", async () => {
    const en = await render({ ended: true, daysLeft: 0 }, "en");
    expect(en.present).toBe(true);
    expect(en.html).toMatch(/workspace is locked/i);
    const ar = await render({ ended: true, daysLeft: 0 }, "ar");
    expect(ar.present).toBe(true);
    expect(ar.html).toContain("مساحة عملك مقفلة");
  });
});

describe("e-invoicing settings layout", () => {
  it("shows the self-serve partner card before the provider status card and the ended banner", () => {
    // Source-order check: rendering the whole settings page needs a dozen queries; the order is
    // static JSX, so it is asserted on the source.
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "client", "src", "pages", "EInvoicingSettings.tsx"),
      "utf8"
    );
    const partner = src.indexOf("<EInvoicePartnerCard");
    const provider = src.indexOf("<EInvoiceProviderCard");
    expect(partner).toBeGreaterThan(0);
    expect(partner).toBeLessThan(provider);
    expect(src).toContain("<TrialBanner endedOnly />");
  });
});
