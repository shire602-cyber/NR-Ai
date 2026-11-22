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
  window.history.pushState({}, "", "/bank-reconciliation?import=1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (url.endsWith("/bank/providers")) return json({ isConfigured: false, statuses: [] });
      if (/\/api\/companies$/.test(url)) return json([{ id: "c-1", name: "شركة الواحة" }]);
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
  const { default: Page } = await import("../../client/src/pages/BankReconciliation");
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ActiveCompanyProvider, null, createElement(Page))
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
    expect(text).toContain("Comma, semicolon, and tab-delimited Excel exports are supported");
    expect(dialog()?.querySelector('[data-testid="button-confirm-import"]')?.textContent).toContain(
      "Import"
    );
  });

  it("lets the dialog content shrink to a phone (single minmax(0,1fr) column, no min-content growth)", async () => {
    await mountPage("en");
    expect(dialog()?.className).toContain("grid-cols-[minmax(0,1fr)]");
  });
});

it.each([
  [
    "en",
    "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
  ],
  ["ar", "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك"],
] as const)(
  "uses the approved CSV wording in %s in the import dialog and legacy provider error",
  async (locale, copy) => {
    await mountPage(locale);
    expect(dialog()?.textContent).toContain(copy);
    expect(dialog()?.textContent).not.toMatch(/\b(?:XLSX|MT940|CAMT\.053|OFX|PDF)\b/);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).not.toContain(
      "/api/bank/providers"
    );
    const { serverErrorCopy } = await import("../../client/src/lib/validation-messages");
    for (const code of [
      "BANK_CONNECTION_NOT_FOUND",
      "BANK_FEED_ACCOUNT_NOT_LINKED",
      "BANK_FEED_BALANCE_UNAVAILABLE",
      "BANK_FEED_NOT_CONFIGURED",
      "BANK_FEED_NOT_SUPPORTED",
      "BANK_FEED_NO_ACCOUNTS",
      "BANK_FEED_PROVIDER_ERROR",
      "BANK_FEED_RECONNECT_REQUIRED",
      "BANK_FEED_UNKNOWN_PROVIDER",
      "INVALID_OAUTH_STATE",
      "REDIRECT_URI_NOT_ALLOWED",
    ])
      expect(serverErrorCopy(locale, code), code).toBe(copy);
  }
);

it("uses the provider company when local storage is blocked", async () => {
  const { effectiveCompanyId } = await import("../../client/src/lib/activeCompany");
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
    throw new DOMException("Storage is blocked", "SecurityError");
  });
  expect(effectiveCompanyId([{ id: "first" }, { id: "selected" }], "selected")).toBe("selected");
  read.mockRestore();
});

it("lists only CSV in the banking format copy and keeps receipt links free of release promises", async () => {
  const [
    { default: enBank },
    { default: arBank },
    { default: enForms },
    { default: arForms },
    { bankCsvWorkflow },
  ] = await Promise.all([
    import("../../client/src/locales/en/banking.json"),
    import("../../client/src/locales/ar/banking.json"),
    import("../../client/src/locales/en/forms.json"),
    import("../../client/src/locales/ar/forms.json"),
    import("../../shared/banking-copy"),
  ]);
  expect(enBank["banking.import.formats"]).toBe(bankCsvWorkflow.en);
  expect(arBank["banking.import.formats"]).toBe(bankCsvWorkflow.ar);
  expect(enForms["forms.claim.receiptUrlHint"]).toBe("Link to the receipt");
  expect(arForms["forms.claim.receiptUrlHint"]).toBe("رابط الإيصال");
});
