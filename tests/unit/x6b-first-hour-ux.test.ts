// @vitest-environment jsdom
/**
 * X6b first-hour fixes: invoice exchange-rate field (USD peg prefill, inline validation),
 * payroll read-only notice for a viewer, Arabic plural forms, Arabic system memos, and a guard
 * that every toast the app can show is catalogued in English and Arabic.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useForm } from "react-hook-form";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ hookTimeout: 15000 });

const perm = vi.hoisted(() => ({ can: true, known: true }));
const api = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../../client/src/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("../../client/src/lib/queryClient")>(
    "../../client/src/lib/queryClient"
  );
  return {
    ...actual,
    apiRequest: async (...args: unknown[]) => {
      api.calls.push(args);
      return {
        delivery: "link",
        inviteUrl: "https://example.test/invite",
        invitation: { email: "a@b.co" },
      };
    },
  };
});
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({
    can: () => perm.can,
    canRead: () => !perm.known || perm.can,
    gate: () => ({}),
    known: perm.known,
  }),
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", isLoading: false }),
}));
vi.mock("../../client/src/pages/payroll/RunsTab", () => ({ RunsTab: () => null }));
vi.mock("../../client/src/pages/payroll/EmployeesTab", () => ({ EmployeesTab: () => null }));
vi.mock("../../client/src/pages/payroll/LeaveTab", () => ({ LeaveTab: () => null }));
vi.mock("../../client/src/pages/payroll/PayslipsTab", () => ({ PayslipsTab: () => null }));
vi.mock("../../client/src/pages/payroll/SettlementTab", () => ({ SettlementTab: () => null }));
vi.mock("../../client/src/pages/payroll/WpsTab", () => ({ WpsTab: () => null }));

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  perm.can = true;
  perm.known = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
}

describe("X6b invoice exchange rate", () => {
  async function renderFields(currency: string, exchangeRate = "") {
    const { InvoiceCurrencyFields } =
      await import("../../client/src/components/invoices/InvoiceCurrencyFields");
    const { Form } = await import("../../client/src/components/ui/form");
    function Harness() {
      const form = useForm({
        defaultValues: { currency, exchangeRate, date: new Date("2026-11-10") },
      });
      return createElement(
        Form,
        form as never,
        createElement(InvoiceCurrencyFields as never, {
          form,
          companyId: "c1",
          baseCurrency: "AED",
        })
      );
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
    });
    return container.querySelector<HTMLInputElement>("[data-testid=input-invoice-exchange-rate]");
  }

  it("prefills USD at the 3.6725 peg with a Peg badge", async () => {
    const input = await renderFields("USD");
    expect(input?.value).toBe("3.6725");
    expect(container.querySelector("[data-testid=badge-rate-peg]")?.textContent).toBe("Peg");
    expect(container.textContent).toContain("pegged to the US dollar at 3.6725");
  });

  it("does not show the peg for another currency", async () => {
    await renderFields("EUR");
    expect(container.querySelector("[data-testid=badge-rate-peg]")).toBeNull();
  });

  it("flags an invalid rate inline as soon as it is typed", async () => {
    const input = await renderFields("USD");
    expect(container.querySelector("[data-testid=error-invoice-exchange-rate]")).toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(input, "3,67");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const error = container.querySelector("[data-testid=error-invoice-exchange-rate]");
    expect(error?.textContent).toBe("Enter a positive rate with up to 6 decimals.");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("[data-testid=badge-rate-peg]")).toBeNull();
  });
});

describe("X6b draft invoice row actions", () => {
  it("hides Record payment, E-invoice and Credit note on a draft and offers them once issued", async () => {
    const { invoiceRowActions } = await import("../../client/src/lib/invoice-row-actions");
    expect(invoiceRowActions({ status: "draft" })).toEqual({
      canRecordPayment: false,
      canGenerateEinvoice: false,
      canCreateCreditNote: false,
    });
    expect(invoiceRowActions({ status: "sent", invoiceType: "invoice" })).toEqual({
      canRecordPayment: true,
      canGenerateEinvoice: true,
      canCreateCreditNote: true,
    });
    expect(
      invoiceRowActions({ status: "sent", invoiceType: "credit_note" }).canCreateCreditNote
    ).toBe(false);
  });
});

describe("X6b invite form", () => {
  it("submits the invitation from the form (what Enter in the email field does)", async () => {
    api.calls.length = 0;
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: async ({ queryKey }) => {
            if (queryKey.includes("me"))
              return {
                role: "owner",
                permissions: ["team.manage", "reports.read"],
                grantableRoles: ["accountant", "viewer"],
                viaFirmAccess: false,
              };
            return [];
          },
        },
      },
    });
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(TeamManagement))
      );
    });
    for (let i = 0; i < 20 && !container.querySelector("[data-testid=button-invite-member]"); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    const open = container.querySelector<HTMLButtonElement>("[data-testid=button-invite-member]");
    expect(open).not.toBeNull();
    await act(async () => {
      open!.click();
    });
    const email = document.querySelector<HTMLInputElement>("[data-testid=input-invite-email]")!;
    const form = email.closest("form") as HTMLFormElement;
    expect(form).not.toBeNull();
    const submit = document.querySelector<HTMLButtonElement>(
      "[data-testid=button-confirm-invite]"
    )!;
    expect(submit.type).toBe("submit");
    expect(submit.getAttribute("form")).toBe(form.id);
    expect(submit.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(email, "new.member@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    await act(async () => {
      form.requestSubmit();
    });
    const invite = api.calls.find((c) => String(c[1]).endsWith("/team/invite"));
    expect(invite?.[0]).toBe("POST");
    expect(invite?.[2]).toMatchObject({ email: "new.member@example.com", role: "accountant" });
  });
});

describe("X6b payroll for a viewer", () => {
  it("shows a notice instead of loading payroll data the viewer cannot read", async () => {
    perm.can = false;
    const { default: Payroll } = await import("../../client/src/pages/Payroll");
    await act(async () => {
      root.render(createElement(Payroll));
    });
    const notice = container.querySelector("[data-testid=payroll-no-access]");
    expect(notice?.textContent).toContain("Payroll is not available to your role");
    expect(container.querySelector("[role=tablist]")).toBeNull();
  });

  it("shows the tabs to a role that can manage payroll", async () => {
    const { default: Payroll } = await import("../../client/src/pages/Payroll");
    await act(async () => {
      root.render(createElement(Payroll));
    });
    expect(container.querySelector("[data-testid=payroll-no-access]")).toBeNull();
    expect(container.querySelector("[role=tablist]")).not.toBeNull();
  });
});

describe("X6b Arabic plural rules", () => {
  it("never renders '1 فواتير': one, two, few, many follow the Arabic forms", async () => {
    await setLocale("ar");
    const { formatMessage, t } = await import("../../client/src/lib/i18n");
    const tpl = t.ar["screens.invoicesCount"];
    expect(formatMessage(tpl, { count: 0 })).toBe("لا فواتير");
    expect(formatMessage(tpl, { count: 1 })).toBe("فاتورة واحدة");
    expect(formatMessage(tpl, { count: 2 })).toBe("فاتورتان");
    expect(formatMessage(tpl, { count: 5 })).toBe("5 فواتير");
    expect(formatMessage(tpl, { count: 11 })).toBe("11 فاتورة");
    expect(formatMessage(tpl, { count: 100 })).toBe("100 فاتورة");
  });

  it("English counts read '1 invoice' / '2 invoices' and surrounding placeholders still fill", async () => {
    const { formatMessage, t } = await import("../../client/src/lib/i18n");
    expect(formatMessage(t.en["screens.invoicesCount"], { count: 1 })).toBe("1 invoice");
    expect(formatMessage(t.en["screens.invoicesCount"], { count: 3 })).toBe("3 invoices");
    expect(formatMessage(t.en["dashboard.receivablesHint"], { open: 1, overdue: 0 })).toBe(
      "1 invoice · 0 overdue"
    );
  });
});

describe("X6b Arabic system memos", () => {
  it("translates opening stock, payroll and bill posting descriptions", async () => {
    const { t } = await import("../../client/src/lib/i18n");
    const { localizeJournalMemo } = await import("../../client/src/lib/journal-memo");
    const ar = t.ar as Record<string, string>;
    const tr = (m: string) => localizeJournalMemo(ar, m, "ar");
    expect(tr("Opening stock - SKU-1")).toBe("مخزون افتتاحي - SKU-1");
    expect(tr("Opening stock")).toBe("مخزون افتتاحي");
    expect(tr("Payroll 11/2026 - 4 employee(s)")).toBe("رواتب 11/2026 - 4 موظف");
    expect(tr("Salary payment - payroll 11/2026")).toBe("دفع الرواتب - كشف رواتب 11/2026");
    expect(tr("Vendor Bill 2026-01-15 - Acme")).toContain("2026-01-15");
    expect(tr("Input VAT - Bill SUP-77")).toBe("ضريبة المدخلات - فاتورة مورّد SUP-77");
    for (const m of ["Opening stock - SKU-1", "Salary payment - payroll 11/2026"]) {
      expect(tr(m)).not.toMatch(/[A-Za-z]{4,}/);
    }
  });
});

describe("X6b firm sign-up is not public", () => {
  it("the landing page has no accounting-firm sign-up section or anchor", async () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
    const { default: Landing } = await import("../../client/src/pages/MuhasibLanding");
    await act(async () => {
      root.render(createElement(Landing));
    });
    expect(container.querySelector("#firms")).toBeNull();
    expect(container.textContent).not.toContain("Run every client's books from one workspace");
    const navHrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(navHrefs).not.toContain("/#firms");
    expect(navHrefs).not.toContain("#firms");
  });
});

describe("X6b every toast is catalogued", () => {
  // A source scan is the only way to cover every call site (a toast is only built when its action
  // runs), so this guard reads the sources; the catalogs themselves are checked as data.
  const root0 = path.resolve(__dirname, "../../client/src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "locales") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("no toast title or description is an English string literal", () => {
    const offenders: string[] = [];
    for (const file of walk(root0)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\btoast\(\s*\{/g)) {
        let depth = 1;
        let i = m.index! + m[0].length;
        const start = i;
        let quote: string | null = null;
        while (i < src.length && depth > 0) {
          const c = src[i];
          if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
          } else if (c === '"' || c === "'" || c === "`") quote = c;
          else if (c === "{") depth++;
          else if (c === "}") depth--;
          i++;
        }
        const body = src.slice(start, i - 1);
        for (const f of body.matchAll(/\b(title|description)\s*:\s*(["'`])([^"'`\n]*)\2/g)) {
          // Words outside `${...}` placeholders are what a reader sees; pure data is fine.
          if (/[A-Za-z]{3}/.test(f[3].replace(/\$\{[^}]*\}/g, ""))) {
            offenders.push(`${path.relative(root0, file)}: ${f[1]}: ${f[3]}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every catalogued toast key exists in English and Arabic with the same placeholders", () => {
    const load = (loc: string, ns: string) =>
      JSON.parse(fs.readFileSync(path.join(root0, "locales", loc, `${ns}.json`), "utf8")) as Record<
        string,
        string
      >;
    const used = new Set<string>();
    for (const file of walk(root0)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/translateNow\("((?:toasts|shell\.toast)[\w.]*)"\)/g))
        used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(300);
    const en = { ...load("en", "toasts"), ...load("en", "shell") };
    const ar = { ...load("ar", "toasts"), ...load("ar", "shell") };
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    for (const key of used) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(ar[key], `ar ${key}`).toBeTruthy();
      expect(ph(ar[key]), key).toEqual(ph(en[key]));
      if (!/^\{\w+\}/.test(en[key]) || /[A-Za-z]{4}/.test(en[key].replace(/\{\w+\}/g, ""))) {
        expect(/[؀-ۿ]/.test(ar[key]), `ar ${key} is Arabic`).toBe(true);
      }
    }
  });

  it("server error codes for the launch caps have Arabic copy", async () => {
    await setLocale("ar");
    const { localizeApiError } = await import("../../client/src/lib/validation-messages");
    for (const code of [
      "STORAGE_LIMIT_REACHED",
      "COMPANY_LIMIT_REACHED",
      "USAGE_LIMIT_REACHED",
      "AI_QUOTA_EXCEEDED",
      "STRIPE_NOT_CONFIGURED",
      "AI_NOT_CONFIGURED",
    ]) {
      const msg = localizeApiError({ code });
      expect(msg, code).toBeTruthy();
      expect(/[؀-ۿ]/.test(msg!), code).toBe(true);
    }
  });
});
