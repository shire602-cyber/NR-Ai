// @vitest-environment jsdom
/**
 * X3 (J2): launch fixes found in the Arabic end-to-end run. Behaviour tests: render the real
 * components in jsdom / call the real functions.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../client/src/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/queryClient")>();
  return { ...actual, apiRequest: api.apiRequest };
});

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  window.localStorage.clear();
  api.apiRequest.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await setLocale("en");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
}

function englishLines(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || el.closest('[translate="no"], [aria-hidden="true"], .sr-only')) continue;
    const lang = el.closest("[lang]")?.getAttribute("lang");
    if (lang && !lang.startsWith("ar")) continue;
    const value = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (value && isEnglishLine(value)) out.push(value);
  }
  return out;
}

describe("X3 invoice PDF download uses the server PDF", () => {
  it("downloadServerFile GETs the server route with the session cookie and saves the blob", async () => {
    const { downloadServerFile } = await import("../../client/src/lib/export");
    const fetchMock = vi.fn(
      async () =>
        new Response("%PDF-1.4", {
          status: 200,
          headers: { "Content-Disposition": 'attachment; filename="invoice-INV-1.pdf"' },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return "blob:x";
    });
    URL.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked.push(this.download);
    };
    try {
      await downloadServerFile("/api/invoices/abc/pdf", "fallback.pdf");
    } finally {
      HTMLAnchorElement.prototype.click = orig;
      vi.unstubAllGlobals();
    }
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/invoices/abc/pdf");
    expect(init.credentials).toBe("include");
    expect(clicked).toEqual(["invoice-INV-1.pdf"]);
    expect(created).toHaveLength(1);
  });

  it("surfaces the server error instead of saving garbage", async () => {
    const { downloadServerFile } = await import("../../client/src/lib/export");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Invoice not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    try {
      await expect(downloadServerFile("/api/invoices/x/pdf", "f.pdf")).rejects.toThrow(
        "Invoice not found"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("X3 invoice share / send by email", () => {
  async function renderDialog() {
    const { ShareInvoiceDialog } =
      await import("../../client/src/components/invoices/ShareInvoiceDialog");
    await act(async () =>
      root.render(
        createElement(ShareInvoiceDialog, {
          invoice: { id: "inv-1", number: "INV-1" },
          companyId: "co-1",
          onClose: () => {},
        })
      )
    );
  }
  const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);

  function typeEmail(value: string) {
    const input = q("input-invoice-share-email") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("creates the share link and shows the absolute public URL", async () => {
    api.apiRequest.mockResolvedValueOnce({ shareUrl: "/view/invoice/tok", token: "tok" });
    await renderDialog();
    expect(api.apiRequest).toHaveBeenCalledWith("POST", "/api/invoices/inv-1/share", {});
    expect((q("input-invoice-share-link") as HTMLInputElement).value).toBe(
      `${window.location.origin}/view/invoice/tok`
    );
  });

  it("never claims the email was sent when no provider is configured", async () => {
    api.apiRequest
      .mockResolvedValueOnce({ shareUrl: "/view/invoice/tok", token: "tok" })
      .mockResolvedValueOnce({ sent: false, queued: true, emailConfigured: false });
    await renderDialog();
    typeEmail("buyer@example.com");
    await act(async () => {
      (q("button-send-invoice-email") as HTMLButtonElement).click();
    });
    expect(q("invoice-share-email-not_configured")).not.toBeNull();
    expect(q("invoice-share-email-sent")).toBeNull();
    const { t } = await import("../../client/src/lib/i18n");
    expect(q("invoice-share-email-not_configured")!.textContent).toBe(
      t.en["invoices.shareEmailNotConfigured"]
    );
  });

  it.each(["en", "ar"] as const)(
    "lets the server choose the email language from the %s dialog",
    async (locale) => {
      await setLocale(locale);
      api.apiRequest
        .mockResolvedValueOnce({ shareUrl: "/view/invoice/tok", token: "tok" })
        .mockResolvedValueOnce({ sent: true, queued: false, emailConfigured: true });
      await renderDialog();
      typeEmail("buyer@example.com");
      await act(async () => {
        (q("button-send-invoice-email") as HTMLButtonElement).click();
      });
      expect(api.apiRequest).toHaveBeenLastCalledWith(
        "POST",
        "/api/companies/co-1/invoices/inv-1/send-email",
        { to: "buyer@example.com" }
      );
      const { t } = await import("../../client/src/lib/i18n");
      expect(q("invoice-share-email-sent")!.textContent).toBe(
        t[locale]["invoices.shareEmailSent"].replace("{to}", "buyer@example.com")
      );
    }
  );
});

describe("X3 Arabic legal pages", () => {
  it.each(["TermsOfService", "CookiePolicy", "PrivacyPolicy"] as const)(
    "%s shows Arabic text with a notice that the English text governs",
    async (page) => {
      await setLocale("ar");
      const mod = await import(`../../client/src/pages/${page}.tsx`);
      await act(async () => root.render(createElement(mod.default)));
      const { t } = await import("../../client/src/lib/i18n");
      const article = container.querySelector('[data-testid="legal-arabic-copy"]');
      expect(article?.getAttribute("lang")).toBe("ar");
      expect(article?.getAttribute("dir")).toBe("rtl");
      expect(container.textContent).toContain(t.ar["marketing.legalArabicNotice"]);
      expect(englishLines()).toEqual([]);
    }
  );

  it("English mode keeps the authoritative English text", async () => {
    const mod = await import("../../client/src/pages/TermsOfService");
    await act(async () => root.render(createElement(mod.default)));
    expect(container.querySelector('[data-testid="legal-arabic-copy"]')).toBeNull();
    expect(container.querySelector("article")?.getAttribute("lang")).toBe("en");
    expect(container.textContent).toContain("Eligibility");
  });
});

describe("X3 pricing makes only true claims", () => {
  it("does not advertise working AI OCR; e-invoicing is 'ready, switched on when connected'", async () => {
    const mod = await import("../../client/src/pages/Pricing");
    await act(async () => root.render(createElement(mod.default)));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/AI OCR/i);
    // WP-B: qualifiers sit on a sub-line under the row label instead of inside it.
    // WQ7: e-invoicing is in every plan (no partner named); sending needs an accredited
    // provider. The comparison no longer lists an "AI receipt reading" row at all.
    expect(text).not.toMatch(/AI receipt reading/i);
    expect(text).toContain("E-invoicing (PINT AE)");
    expect(text).toContain("Sending needs an accredited service provider");
    expect(text).not.toMatch(/coming\s+soon/i);
  });
});

describe("X3 account and journal memo localisation", () => {
  it("accountDisplayName uses name_ar in Arabic when it exists", async () => {
    const { accountDisplayName } = await import("../../client/src/lib/account-name");
    const acc = { nameEn: "Cash on Hand", nameAr: "النقد في الصندوق" };
    expect(accountDisplayName(acc, "ar")).toBe("النقد في الصندوق");
    expect(accountDisplayName(acc, "en")).toBe("Cash on Hand");
    expect(accountDisplayName({ nameEn: "Rent" }, "ar")).toBe("Rent");
  });

  it("localizeJournalMemo rebuilds server English memos in Arabic and leaves English alone", async () => {
    const { localizeJournalMemo } = await import("../../client/src/lib/journal-memo");
    const { t } = await import("../../client/src/lib/i18n");
    const memo = "Payment received for Invoice INV-2026-0003 - bank";
    expect(localizeJournalMemo(t.en, memo, "en")).toBe(memo);
    const ar = localizeJournalMemo(t.ar, memo, "ar");
    expect(ar).toContain("INV-2026-0003");
    expect(ar).toMatch(/[؀-ۿ]/);
    expect(isEnglishLine(ar)).toBe(false);
    expect(localizeJournalMemo(t.ar, "Sales Invoice INV-9 - شركة", "ar")).toContain("INV-9");
    // A memo a person typed is shown unchanged.
    expect(localizeJournalMemo(t.ar, "Owner top-up", "ar")).toBe("Owner top-up");
  });
});

describe("X3 public invoice page is localised", () => {
  it("renders dates, labels and status in Arabic with no English text", async () => {
    await setLocale("ar");
    const payload = {
      onlinePayment: { available: false, status: "off", provider: null },
      invoice: {
        number: "INV-1",
        customerName: "شركة النجمة",
        customerTrn: "100999888700003",
        date: "2026-12-17T00:00:00.000Z",
        currency: "AED",
        subtotal: 100,
        vatAmount: 5,
        total: 105,
        status: "paid",
        invoiceType: "invoice",
        isTaxInvoice: true,
        amountDue: 0,
        paymentStatus: "paid",
      },
      lines: [
        {
          description: "خدمة",
          quantity: 1,
          unitPrice: 100,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
      company: {
        name: "نجمة",
        trnVatNumber: "100123456700003",
        businessAddress: null,
        contactPhone: null,
        contactEmail: null,
        websiteUrl: null,
        logoUrl: null,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { Router, Route } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const mod = await import("../../client/src/pages/PublicInvoiceView");
    const { hook } = memoryLocation({ path: "/view/invoice/abc" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client: qc },
            createElement(
              Router,
              { hook },
              createElement(Route, { path: "/view/invoice/:token", component: mod.default })
            )
          )
        )
      );
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    } finally {
      vi.unstubAllGlobals();
    }
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/December|Qty|\bPaid\b|\bDate\b/);
    const { t } = await import("../../client/src/lib/i18n");
    expect(text).toContain(t.ar["invoices.publicQty"]);
  });
});
