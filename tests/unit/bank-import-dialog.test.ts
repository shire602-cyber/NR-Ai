// @vitest-environment jsdom
/**
 * Step 1 / F4: the bank statement import dialog is catalog copy in both languages. In Arabic it
 * has no English outside user data and brand names (the "Supported formats" lines and the Import
 * button used to stay English), and its content is allowed to shrink to the phone width.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView ??= () => {};
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  localStorage.setItem("muhasib_auth_hint", "1");
  window.history.pushState({}, "", "/bank-reconciliation?import=1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "شركة الواحة" }]);
      if (url.endsWith("/bank-statements/preview"))
        return json({
          kind: "camt053",
          detectedFormat: "camt053",
          detectedFormatLabel: "CAMT.053",
          headers: [],
          totalRows: 1,
          validRows: 1,
          errorRows: 0,
          warnings: [],
          sampleRows: [
            {
              rowIndex: 1,
              date: "2026-11-20",
              description: "Sample transaction",
              debit: 10,
              credit: 0,
              errors: [],
            },
          ],
        });
      if (url.endsWith("/bank-accounts"))
        return json([
          {
            id: "b-1",
            nameEn: "الحساب التشغيلي",
            bankName: "بنك الإمارات دبي الوطني",
            accountNumber: null,
            iban: null,
            currency: "AED",
            glAccountId: null,
            isActive: true,
          },
        ]);
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  localStorage.removeItem("muhasib_auth_hint");
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function mountPage(locale: "en" | "ar") {
  const i18n = await import("../../client/src/lib/i18n");
  await act(async () => i18n.useI18n.getState().setLocale(locale));
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  const { ActiveCompanyProvider } =
    await import("../../client/src/components/ActiveCompanyProvider");
  const { default: BankReconciliation } = await import("../../client/src/pages/BankReconciliation");
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ActiveCompanyProvider, null, createElement(BankReconciliation))
      )
    );
  });
  for (let i = 0; i < 12; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

describe("bank statement import dialog", () => {
  it("in Arabic: every line is Arabic, including the supported formats and the Import button", async () => {
    await mountPage("ar");
    const d = dialog();
    expect(d).not.toBeNull();
    const lines: string[] = [];
    const walker = document.createTreeWalker(d!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text && !n.parentElement?.closest("[translate=no]")) lines.push(text);
    }
    expect(lines.filter((line) => isEnglishLine(line))).toEqual([]);
    const text = d!.textContent ?? "";
    expect(text).toContain("استيراد");
    expect(text).toContain("الصيغ المدعومة");
    expect(text).toContain("CSV");
    expect(text).not.toContain("PDF");
    expect(d!.querySelector('[data-testid="button-confirm-import"]')?.textContent).toContain(
      "استيراد"
    );
  });

  it("in English: the same lines come from the catalog", async () => {
    await mountPage("en");
    const text = dialog()?.textContent ?? "";
    expect(text).toContain("CSV supports comma, semicolon, and tab delimiters");
    expect(text).not.toMatch(/\b(?:XLSX|MT940|CAMT\.053|OFX)\b/);
    expect(dialog()?.querySelector('[data-testid="button-confirm-import"]')?.textContent).toContain(
      "Import"
    );
  });

  it.each([
    ["en", "Statement recognized", "ltr"],
    ["ar", "تم التعرّف على كشف الحساب", "rtl"],
  ] as const)(
    "shows a localized label for a populated statement preview in %s",
    async (locale, label, dir) => {
      await mountPage(locale);
      const file = new File(["<Document/>"], "statement.xml");
      Object.defineProperty(file, "arrayBuffer", {
        value: async () => new Uint8Array([60, 62]).buffer,
      });
      const input = dialog()?.querySelector('[data-testid="input-bank-statement-file"]');
      expect(input).not.toBeNull();
      Object.defineProperty(input, "files", { value: [file] });
      await act(async () => input!.dispatchEvent(new Event("change", { bubbles: true })));
      await vi.waitFor(() => {
        const mapper = dialog()?.querySelector('[data-testid="panel-statement-mapper"]');
        expect(mapper?.getAttribute("dir")).toBe(dir);
        expect(mapper?.querySelector('[data-testid="statement-recognized"]')?.textContent).toBe(
          label
        );
        expect(mapper?.textContent).toContain("Sample transaction");
        expect(mapper?.textContent).not.toMatch(/MT940|CAMT\.053|OFX|QFX/);
      });
    }
  );

  it("lets the dialog content shrink to a phone (single minmax(0,1fr) column, no min-content growth)", async () => {
    await mountPage("en");
    expect(dialog()?.className).toContain("grid-cols-[minmax(0,1fr)]");
  });
});
