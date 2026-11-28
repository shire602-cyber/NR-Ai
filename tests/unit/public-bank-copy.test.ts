// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../../client/src/locales/en/marketing.json";
import ar from "../../client/src/locales/ar/marketing.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bankCopyCases = [
  {
    locale: "en",
    question: "How do I reconcile my bank statement?",
    title: "Bank reconciliation",
    copy: "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    catalog: en,
  },
  {
    locale: "ar",
    question: "كيف أطابق كشف حسابي البنكي؟",
    title: "المطابقة البنكية",
    copy: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    catalog: ar,
  },
];

const directFeedClaim = /\b(?:bank|live)\s+feeds?\b|الربط البنكي/i;

let container: HTMLDivElement;
let root: Root;
let originalUrl: string;

beforeEach(() => {
  originalUrl = window.location.href;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, "", originalUrl);
});

async function renderPhase(path: string) {
  window.history.replaceState(null, "", path);
  const { default: PhaseSite } =
    await import("../../client/src/components/marketing/phase/PhaseSite");
  await act(async () => root.render(createElement(PhaseSite)));
}

describe("Public banking copy", () => {
  it.each(bankCopyCases)(
    "uses the exact CSV answer in the $locale homepage FAQ and fallback catalog",
    async ({ locale, question, copy, catalog }) => {
      await renderPhase("/" + locale);

      const faq = [...container.querySelectorAll("details")].find(
        (entry) => entry.querySelector("summary")?.textContent?.trim() === question
      );
      expect(faq?.open).toBe(false);
      await act(async () => faq?.querySelector("summary")?.click());
      expect(faq?.open).toBe(true);
      expect(faq?.querySelector("p")?.textContent).toBe(copy);
      expect(catalog["marketing.faq3Q"]).toBe(question);
      expect(catalog["marketing.faq3A"]).toBe(copy);
    },
    // The first render cold-imports the whole phase site and lazy-loads both catalogs.
    30_000
  );

  it.each(bankCopyCases)(
    "renders the $locale bank reconciliation page with CSV guidance",
    async ({ locale, title, copy }) => {
      await renderPhase("/" + locale + "/product/bank-reconciliation");

      const main = container.querySelector("main");
      expect(main?.querySelector("h1")?.textContent).toBe(title);
      expect(main?.querySelector("h1 + p")?.textContent).toBe(copy);
      expect(main?.textContent).not.toMatch(directFeedClaim);
    }
  );
});
