// @vitest-environment jsdom
/**
 * Regression tests for the broken paths found by the pre-release sweep
 * (tests/e2e/broken-path-sweep.mjs, docs/release/BROKEN-PATH-SWEEP.md). Each test renders the
 * component against the API shapes the real server returns.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ method: string; url: string; body: unknown }> = [];
let routes: Array<[string, (url: string, body: unknown) => { status?: number; body: unknown }]> =
  [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  calls = [];
  routes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      for (const [key, fn] of routes) {
        const [m, pattern] = key.split(" ");
        if (m === method && new RegExp(pattern).test(url)) {
          const r = fn(url, body);
          return json(r.body, r.status ?? 200);
        }
      }
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

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(el: ReturnType<typeof createElement>) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, el));
  });
  await flush();
}

describe("sweep: Invoices > Customer deposits dialog", () => {
  it("opens against the real paged invoice list (was: TypeError filter is not a function)", async () => {
    const invoice = {
      id: "i-1",
      number: "INV-1",
      customerName: "Palm Co",
      status: "sent",
      total: 1050,
      currency: "AED",
      invoiceType: "invoice",
    };
    // The server answers the bare list with a page and `all=true` with the array.
    routes.push(["GET /invoices\\?all=true", () => ({ body: [invoice] })]);
    routes.push(["GET /invoices$", () => ({ body: { items: [invoice], nextCursor: null } })]);
    routes.push(["GET /customer-deposits", () => ({ body: [] })]);
    routes.push(["GET /accounts", () => ({ body: [] })]);
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    const { CustomerDepositsDialog } =
      await import("../../client/src/pages/invoices/CustomerDepositsDialog");
    await mount(
      createElement(CustomerDepositsDialog, {
        companyId: "c-1",
        open: true,
        onOpenChange: () => {},
      })
    );
    spy.mockRestore();
    expect(document.querySelector('[data-testid="dialog-customer-deposits"]')).not.toBeNull();
    expect(calls.some((c) => c.url.includes("/api/companies/c-1/invoices?all=true"))).toBe(true);
    expect(errors.filter((e) => String(e).includes("is not a function"))).toEqual([]);
  });
});

describe("STEP1 F1: deposit dialog sends AED once (server validator converts to fils)", () => {
  it("create and apply bodies carry the typed AED amount, never fils", async () => {
    const { depositBody, applyBody } = await import("../../client/src/lib/deposit-body");
    const body = depositBody({
      contactId: "c-1",
      date: "2026-11-01",
      amount: " 1050 ",
      vatTreatment: "standard",
      paymentAccountId: "acc",
      reference: "",
    });
    expect(body.amount).toBe("1050");
    expect(body.amount).not.toBe(105000);
    expect(body.contactId).toBe("c-1");
    expect(applyBody("inv-1", "525.50")).toEqual({ invoiceId: "inv-1", amount: "525.50" });
  });
});

describe("STEP1: deposit dialog field-level validation", () => {
  it("names each missing or invalid field", async () => {
    const { validateDeposit, validateApply } = await import("../../client/src/lib/deposit-body");
    const base = {
      contactId: "c",
      date: "2026-11-01",
      amount: "10.50",
      vatTreatment: "standard",
      paymentAccountId: "a",
      reference: "",
    };
    expect(validateDeposit(base)).toEqual({});
    expect(validateDeposit({ ...base, contactId: "", paymentAccountId: "", amount: "" })).toEqual({
      contactId: "required",
      paymentAccountId: "required",
      amount: "required",
    });
    for (const amount of ["0", "-5", "abc", "1.234"])
      expect(validateDeposit({ ...base, amount }).amount, amount).toBe("amount");
    expect(validateApply("", "0")).toEqual({ invoice: true, amount: true });
    expect(validateApply("i", "5")).toEqual({});
  });

  it.each(["en", "ar"] as const)("an empty submit shows field messages in %s", async (locale) => {
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale(locale));
    const { CustomerDepositsDialog } =
      await import("../../client/src/pages/invoices/CustomerDepositsDialog");
    await mount(
      createElement(CustomerDepositsDialog, {
        companyId: "c-1",
        open: true,
        onOpenChange: () => {},
      })
    );
    const submit = document.querySelector(
      '[data-testid="dialog-customer-deposits"] form button[type="submit"]'
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    await flush();
    const alerts = [
      ...document.querySelectorAll(
        '[data-testid="dialog-customer-deposits"] [role="alert"], [data-testid="dialog-customer-deposits"] [id$="-error"]'
      ),
    ];
    expect(alerts.length).toBeGreaterThanOrEqual(3);
    if (locale === "ar") for (const a of alerts) expect(a.textContent).toMatch(/[؀-ۿ]/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("sweep: bill preview decodes the chosen file without fetch (CSP connect-src 'self')", () => {
  it("turns a base64 data URL into a typed Blob with the same bytes", async () => {
    const { dataUrlToBlob } = await import("../../client/src/lib/purchase-files");
    const blob = dataUrlToBlob("data:application/pdf;base64,JVBERi0xLjQ=");
    expect(blob.type).toBe("application/pdf");
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe("%PDF-1.4");
    expect(calls).toEqual([]);
  });
});

describe("sweep: approver steps keep the partner's proper names out of the Arabic copy", () => {
  it("renders the partner label inside a translate=no span", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale("ar"));
    const { EmaraTaxSteps } = await import("../../client/src/components/einvoice/EmaraTaxSteps");
    await mount(
      createElement(EmaraTaxSteps, {
        partner: {
          id: "p",
          displayName: "A-Cube",
          legalName: "Platform ACube Technologies LLC",
          accreditationNumber: "188961",
        } as never,
        companyName: "شركة الواحة",
      })
    );
    const exempt = [...container.querySelectorAll('[translate="no"]')].map((e) => e.textContent);
    expect(exempt.join(" ")).toContain("Platform ACube Technologies LLC");
    expect(container.textContent).toContain("ابحث عن");
  });
});

describe("sweep: AI bank categorisation memos and notice in Arabic", () => {
  it("rebuilds the AI draft memo from the catalog and keeps the description", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale("ar"));
    const { localizeJournalMemo } = await import("../../client/src/lib/journal-memo");
    const t = new Proxy({}, { get: (_o, key: string) => i18n.translateNow(key) }) as Record<
      string,
      string
    >;
    const out = localizeJournalMemo(t, "AI Draft (review required): دفعة عميل", "ar");
    expect(out).toContain("دفعة عميل");
    expect(out).not.toMatch(/AI Draft|review required/);
  });

  it("the drafts notice is catalog copy with a link to a real page", async () => {
    const { NOTIFICATION_TITLE_TEMPLATES } = await import("../../shared/server-copy");
    expect(NOTIFICATION_TITLE_TEMPLATES.map((x) => x.key)).toContain(
      "notification.aiDraftsReview.title"
    );
    // Rows stored with the old English wording are still recognised (and so localised).
    const { describeNotificationCopy } = await import("../../shared/server-copy");
    const old = describeNotificationCopy({
      title: "2 AI draft journal entries need review",
      message:
        "The AI categorized 2 bank transactions with high confidence. Review and approve each draft journal entry before it posts to the GL.",
    });
    expect(old.titleKey).toBe("notification.aiDraftsReview.title");
    expect(old.messageKey).toBe("notification.aiDraftsReview.message");
    expect(old.titleParams.count).toBe("2");
  });
});

describe("sweep: New company dialog (second company had no way in)", () => {
  it("validates the name, creates the company and opens onboarding for it", async () => {
    routes.push(["POST /api/companies$", () => ({ body: { id: "c-2", name: "Second Palm" } })]);
    const { NewCompanyDialog } = await import("../../client/src/components/NewCompanyDialog");
    let open = true;
    await mount(
      createElement(NewCompanyDialog, { open, onOpenChange: (v: boolean) => (open = v) })
    );
    const submit = document.querySelector(
      '[data-testid="button-save-new-company"]'
    ) as HTMLButtonElement;
    await act(async () => submit.click());
    await flush();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(document.body.textContent).toContain("Enter the company name.");
    const input = document.querySelector(
      '[data-testid="input-new-company-name"]'
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "Second Palm");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => submit.click());
    await flush();
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/companies"));
    expect(post?.body).toEqual({ name: "Second Palm" });
    expect(open).toBe(false);
    expect(window.location.pathname).toBe("/onboarding");
  });
});

describe("sweep: Reports > Trial balance in Arabic", () => {
  it("shows Arabic account names, translated types and no English headings or dates", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale("ar"));
    const { ReportsPageContext } = await import("../../client/src/pages/reports/context");
    const { default: TrialBalanceTab } =
      await import("../../client/src/pages/reports/tabs/TrialBalanceTab");
    const t = new Proxy({}, { get: (_o, key: string) => i18n.translateNow(key) });
    const state = {
      dateRange: { from: new Date("2026-07-01T00:00:00"), to: new Date("2026-09-30T00:00:00") },
      t,
      trialBalanceLoading: false,
      tbFetchStatus: "idle" as const,
      reportLoadErrors: { pl: null, bs: null, vat: null, tb: null },
      trialBalanceSummary: { isBalanced: true, activeAccounts: 1, foreignCurrencyAccounts: 0 },
      trialBalance: {
        reportCurrency: "AED",
        totals: { sumDebits: 100, sumCredits: 100, difference: 0 },
        rows: [
          {
            accountId: "a1",
            accountName: "Rent Expense",
            accountNameAr: "مصروف الإيجار",
            accountCode: "5100",
            accountType: "expense",
            totalDebit: 100,
            totalCredit: 0,
            balance: 100,
            hasForeignLines: false,
          },
        ],
      },
    };
    await mount(
      createElement(
        ReportsPageContext.Provider,
        { value: state as never },
        createElement(TrialBalanceTab)
      )
    );
    const text = container.textContent ?? "";
    expect(text).toContain("مصروف الإيجار");
    expect(text).not.toContain("Rent Expense");
    expect(text).not.toMatch(/\bexpense\b|Debit \/ credit|\bCode\b|\bType\b|Sep 30/);
  });
});
