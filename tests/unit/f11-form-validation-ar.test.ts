// @vitest-environment jsdom
/**
 * F11: validation messages follow the UI language. Each D5b form is opened, the language is
 * switched to Arabic, and an invalid (empty) sample is submitted; every message the form shows
 * (inline and in the error summary) must be Arabic with no English letters.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  buttonByText,
  byTestId,
  click,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { act } from "react";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import {
  localizeApiError,
  localizeMessage,
  localizeServerIssue,
  zodErrorMap,
} from "../../client/src/lib/validation-messages";
import { readFileSync } from "node:fs";
import {
  scanBlindSpotSource,
  scanZodMessageSource,
  scanZodMessages,
} from "../../scripts/i18n-scan.mjs";
import { z } from "zod";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: null,
    usage: null,
    limits: null,
    tierName: "enterprise",
    isFreeTier: false,
    canAccess: () => true,
    getRequiredTier: () => "starter",
    isLoading: false,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;
});
beforeEach(() => {
  resetHarness();
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  await unmountPage();
  useI18n.setState({ locale: "en" });
});

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const lastButton = () => [...dialog().querySelectorAll("button:not(.absolute)")].pop()!;
const submitButton = () => dialog().querySelector('button[type="submit"]')!;

async function toArabic() {
  await act(async () => useI18n.setState({ locale: "ar" }));
  await flush();
}

/** Every validation message currently visible: inline messages plus the error-summary reasons. */
function shownMessages(): string[] {
  const out: string[] = [];
  document.querySelectorAll('[id$="-form-item-message"], [id$="-error"]').forEach((el) => {
    if (el.textContent?.trim()) out.push(el.textContent.trim());
  });
  document.querySelectorAll('[data-testid="form-error-summary"] li').forEach((li) => {
    const clone = li.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".font-medium").forEach((n) => n.remove());
    const text = clone.textContent?.replace(/^\s*:\s*/, "").trim();
    if (text) out.push(text);
  });
  return out;
}

function expectArabicMessages(name: string) {
  const messages = shownMessages();
  expect(messages.length, `${name}: expected validation messages`).toBeGreaterThan(0);
  for (const m of messages) {
    expect(m, `${name}: "${m}" is not Arabic`).toMatch(ARABIC);
    expect(m, `${name}: "${m}" contains English letters`).not.toMatch(LATIN);
  }
}

interface FormCase {
  name: string;
  load: () => Promise<{ page: any; props?: object }>;
  fixtures?: Record<string, unknown>;
  open?: () => Promise<void>;
  submit: () => Element | null;
  prepare?: () => Promise<void>;
}

const byId = (id: string) => document.getElementById(id);

const CASES: FormCase[] = [
  {
    name: "invoice",
    fixtures: { [`${C}/invoices?limit=50`]: { items: [], nextCursor: null } },
    load: async () => ({ page: (await import("../../client/src/pages/Invoices")).default }),
    open: () => click(byTestId("button-create-invoice")),
    submit: () => byTestId("button-submit-invoice"),
  },
  {
    name: "quote",
    load: async () => ({ page: (await import("../../client/src/pages/Quotes")).default }),
    open: () => click(buttonByText(/new quote/i)),
    submit: submitButton,
  },
  {
    name: "recurring invoice",
    load: async () => ({
      page: (await import("../../client/src/pages/RecurringInvoices")).default,
    }),
    open: () => click(buttonByText(/new recurring invoice/i)),
    submit: submitButton,
  },
  {
    name: "bill",
    fixtures: { [`${C}/bills/summary`]: null, [`${C}/bills/aging`]: null },
    load: async () => ({ page: (await import("../../client/src/pages/BillPay")).default }),
    open: () => click(buttonByText(/new bill/i)),
    submit: submitButton,
  },
  {
    name: "purchase order",
    load: async () => ({ page: (await import("../../client/src/pages/PurchaseOrders")).default }),
    open: () => click(buttonByText(/new purchase order/i)),
    submit: submitButton,
  },
  {
    name: "expense claim",
    load: async () => ({ page: (await import("../../client/src/pages/ExpenseClaims")).default }),
    open: () => click(buttonByText(/new (expense )?claim/i)),
    submit: submitButton,
  },
  {
    name: "contact",
    load: async () => ({
      page: (await import("../../client/src/pages/CustomerContacts")).default,
    }),
    open: () => click(byTestId("button-add-contact")),
    submit: () => byTestId("button-save-contact"),
  },
  {
    name: "vendor",
    fixtures: { [`${C}/vendors/aging`]: null },
    load: async () => ({ page: (await import("../../client/src/pages/Vendors")).default }),
    open: () => click(buttonByText(/^\s*new vendor\s*$/i)),
    submit: lastButton,
  },
  {
    name: "manual expense",
    load: async () => ({ page: (await import("../../client/src/pages/Receipts")).default }),
    open: () => click(byTestId("button-add-manual-expense")),
    submit: () => byTestId("button-submit-manual-expense"),
  },
  {
    name: "product",
    load: async () => ({ page: (await import("../../client/src/pages/Inventory")).default }),
    open: () => click(buttonByText(/add product/i)),
    submit: submitButton,
  },
  {
    name: "fixed asset",
    fixtures: { [`${C}/fixed-assets/summary`]: null },
    load: async () => ({ page: (await import("../../client/src/pages/FixedAssets")).default }),
    open: () => click(buttonByText(/add asset/i)),
    submit: submitButton,
  },
  {
    name: "journal entry",
    load: async () => ({ page: (await import("../../client/src/pages/Journal")).default }),
    open: () => click(byTestId("button-create-entry")),
    submit: () => byTestId("button-submit-entry"),
  },
  {
    name: "bank account",
    fixtures: { [`${C}/bank-accounts/bank-name-suggestions`]: { suggestions: [] } },
    load: async () => ({ page: (await import("../../client/src/pages/BankAccounts")).default }),
    open: () => click(byTestId("button-add-bank-account")),
    submit: lastButton,
  },
  {
    name: "employee",
    load: async () => ({
      page: (await import("../../client/src/pages/payroll/EmployeesTab")).EmployeesTab,
      props: { companyId: COMPANY_ID },
    }),
    open: () => click(byTestId("button-add-employee")),
    submit: lastButton,
  },
  {
    name: "payroll run",
    load: async () => ({
      page: (await import("../../client/src/pages/payroll/RunsTab")).RunsTab,
      props: { companyId: COMPANY_ID },
    }),
    open: () => click(byTestId("button-new-run")),
    prepare: async () => {
      await type(byId("run-year"), "");
    },
    submit: lastButton,
  },
  {
    name: "budget plan",
    load: async () => ({ page: (await import("../../client/src/pages/Budgets")).default }),
    open: () => click(buttonByText(/new budget/i)),
    submit: submitButton,
  },
  {
    name: "cost centre",
    load: async () => ({ page: (await import("../../client/src/pages/CostCenters")).default }),
    open: () => click(buttonByText(/add cost cent/i)),
    submit: submitButton,
  },
];

describe("[F11] D5b forms show validation messages in Arabic", () => {
  for (const c of CASES) {
    it(`${c.name}: invalid submit shows Arabic-only messages`, async () => {
      if (c.fixtures) setFixtures(c.fixtures);
      const { page, props } = await c.load();
      await renderPage(page, props);
      await c.open?.();
      await toArabic();
      await c.prepare?.();
      await submit(c.submit());
      await flush(20);
      expectArabicMessages(c.name);
    });
  }

  it("company settings: a cleared required field shows Arabic messages", async () => {
    setFixtures({
      [`/api/companies/${COMPANY_ID}`]: { id: COMPANY_ID, name: "Synthetic Trading", locale: "en" },
    });
    const { default: CompanySettings } = await import("../../client/src/pages/CompanySettings");
    await renderPage(CompanySettings);
    await toArabic();
    const form = document.querySelector("form")!;
    await type(form.querySelector('[name="name"]'), "");
    await submit(byTestId("button-save-company-settings"));
    await flush(20);
    expectArabicMessages("company settings");
  });

  it("company profile: missing required fields show Arabic messages", async () => {
    setFixtures({
      [`/api/companies/${COMPANY_ID}`]: { id: COMPANY_ID, name: "Synthetic Trading", locale: "en" },
    });
    const { default: CompanyProfile } = await import("../../client/src/pages/CompanyProfile");
    await renderPage(CompanyProfile);
    await toArabic();
    await submit(byTestId("button-save-company-profile"));
    await flush(20);
    expectArabicMessages("company profile");
  });
});

describe("[F11] message resolution", () => {
  it("resolves catalog keys per language and leaves other text alone", () => {
    expect(localizeMessage("forms.errors.nameRequired")).toBe("Name is required");
    expect(localizeMessage("plain text")).toBe("plain text");
    useI18n.setState({ locale: "ar" });
    expect(localizeMessage("forms.errors.nameRequired")).toMatch(ARABIC);
    expect(localizeMessage("plain text")).toBe("plain text");
  });

  it("zod default issues: Arabic in ar, untouched English defaults in en", () => {
    const schema = z.object({
      name: z.string().min(3),
      email: z.string().email(),
      age: z.coerce.number().min(18),
      tags: z.array(z.string()).min(2),
    });
    const input = { name: "a", email: "x", age: "", tags: [] };
    const en = schema.safeParse(input, { error: zodErrorMap });
    expect(en.success).toBe(false);
    expect(en.error!.issues.map((i) => i.message).join(" ")).toMatch(/String must contain/);
    useI18n.setState({ locale: "ar" });
    const ar = schema.safeParse(input, { error: zodErrorMap });
    const messages = ar.error!.issues.map((i) => i.message);
    expect(messages.length).toBe(4);
    for (const m of messages) {
      expect(m).toMatch(ARABIC);
      expect(m).not.toMatch(LATIN);
    }
    // required (undefined) too
    const missing = z.object({ a: z.string() }).safeParse({}, { error: zodErrorMap });
    expect(missing.error!.issues[0].message).not.toMatch(LATIN);
  });

  it("server validation errors keep the field name with a localised reason", () => {
    const body = {
      code: "VALIDATION_ERROR",
      message: "Validation error",
      fields: { customerName: ["Required"], "lines.0.quantity": ["Number must be greater than 0"] },
    };
    expect(localizeApiError(body)).toBeUndefined(); // English mode keeps the server text
    useI18n.setState({ locale: "ar" });
    const text = localizeApiError(body)!;
    expect(text).toMatch(ARABIC);
    expect(text).toContain("customerName");
    expect(text).toContain("lines.0.quantity");
    expect(text.replace(/customerName|lines\.0\.quantity/g, "")).not.toMatch(LATIN);
    expect(localizeApiError({ code: "VALIDATION_ERROR" })).toMatch(ARABIC);
    expect(localizeApiError({ code: "TIER_LOCKED" })).toMatch(ARABIC);
    expect(localizeApiError({ code: "SOMETHING_UNMAPPED" })).toBeUndefined();
    expect(localizeServerIssue("Totally unknown server text")).toMatch(ARABIC);
  });
});

describe("[F11] guard: no English literal zod messages in client code", () => {
  it("the scanner flags English literals and accepts catalog keys", () => {
    const bad = `import { z } from "zod";\nconst s = z.string().min(1, "Name is required");\nconst r = z.string().refine((v) => v, { message: "Nope here" });`;
    expect(scanZodMessageSource(bad).map((h) => h[1])).toEqual(["Name is required", "Nope here"]);
    const good = `import { z } from "zod";\nconst s = z.string().min(1, "forms.errors.nameRequired");`;
    expect(scanZodMessageSource(good)).toEqual([]);
  });

  it("client/src has none (baseline 0)", () => {
    const { hardcoded, samples } = scanZodMessages();
    expect(samples).toEqual([]);
    expect(hardcoded).toBe(0);
  });
});

describe("[F11] firm onboarding wizard is fully localised", () => {
  it("shows no English on any step in Arabic (brand excepted)", async () => {
    setFixtures({ "/api/companies": [{ id: COMPANY_ID, name: "Synthetic Trading" }] });
    const { FirmOnboarding } = await import("../../client/src/pages/Onboarding");
    useI18n.setState({ locale: "ar" });
    for (const role of ["firm_owner", "firm_admin"] as const) {
      await renderPage(FirmOnboarding, { firmRole: role });
      const seen: string[] = [];
      for (let step = 0; step < 4; step++) {
        seen.push((document.body.textContent ?? "").replace(/Muhasib\.ai|CSV/g, ""));
        const next = byTestId("firm-onboarding-start") ?? byTestId("onboarding-next");
        if (!next) break;
        await click(next);
        await flush(300);
      }
      seen.push((document.body.textContent ?? "").replace(/Muhasib\.ai|CSV/g, ""));
      expect(seen.length).toBeGreaterThanOrEqual(3);
      for (const text of seen) {
        expect(text).toMatch(ARABIC);
        expect(text).not.toMatch(LATIN);
      }
      await unmountPage();
    }
  }, 30000);

  it("firm onboarding source has no multi-line / ternary / attribute English", () => {
    const src = readFileSync("client/src/pages/Onboarding.tsx", "utf8");
    const firm = src.slice(src.indexOf("Firm-owner onboarding"));
    expect(scanBlindSpotSource(firm)).toEqual([]);
  });
});
