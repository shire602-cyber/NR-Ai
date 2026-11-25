// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBadge } from "../../client/src/components/ui/badge";
import { statusBadgeText } from "../../client/src/components/ui/status-meta";
import { matchesRecurringSearch } from "../../client/src/lib/recurring-search";
import en from "../../client/src/locales/en/invoices.json";
import ar from "../../client/src/locales/ar/invoices.json";
import arScreens from "../../client/src/locales/ar/screens.json";
import arComponents from "../../client/src/locales/ar/components.json";
import {
  click,
  COMPANY_ID,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  setFixtures,
  type,
  unmountPage,
} from "./helpers/form-harness";
import RecurringInvoices from "../../client/src/pages/RecurringInvoices";

// Serve Arabic labels synchronously for the page and StatusBadge.
vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const screens = (await import("../../client/src/locales/ar/screens.json")).default;
  const components = (await import("../../client/src/locales/ar/components.json")).default;
  const invoices = (await import("../../client/src/locales/ar/invoices.json")).default;
  const dict = { ...components, ...screens, ...invoices } as Record<string, string>;
  return { ...actual, useTranslation: () => ({ t: dict, locale: "ar" }) };
});
vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

const labels = { frequency: "Monthly", status: "Active" };

describe("recurring invoice page search", () => {
  afterEach(async () => {
    await unmountPage();
    vi.unstubAllGlobals();
  });

  it("announces no matches and restores the rows and search focus when cleared", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const customerName = "Al Noor Trading";
    setFixtures({
      [`/api/companies/${COMPANY_ID}/recurring-invoices`]: [
        {
          id: "schedule-1",
          customerName,
          currency: "AED",
          frequency: "monthly",
          nextRunDate: "2026-12-01",
          linesJson: "[]",
          totalGenerated: 0,
          isActive: true,
        },
      ],
    });
    await renderPage(RecurringInvoices);

    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toBe("");
    expect(document.querySelector("tbody")?.textContent).toContain(customerName);

    await act(async () => search.focus());
    await type(search, "unmatched query");

    expect(document.activeElement).toBe(search);
    expect(document.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe(ar["invoices.recurring.noMatchTitle"]);
    expect(document.querySelector('[data-testid="empty-state"]')?.textContent).toContain(
      ar["invoices.recurring.noMatchTitle"]
    );
    expect(document.querySelector("tbody")).toBeNull();

    const clear = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === ar["invoices.recurring.clearSearch"]
    )!;
    await act(async () => clear.focus());
    expect(document.activeElement).toBe(clear);
    await click(clear);

    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(document.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe("");
    expect(document.querySelector("tbody")?.textContent).toContain(customerName);
  });
});

describe("recurring invoice search", () => {
  it("matches customer, frequency and status case-insensitively", () => {
    const item = { customerName: "Al Noor Trading", isActive: true };
    expect(matchesRecurringSearch(item, "", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "  noor ", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "month", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "active", labels)).toBe(true);
    expect(matchesRecurringSearch(item, "zzz", labels)).toBe(false);
  });
  it("matches Arabic customer names", () => {
    const item = {
      customerName: "شركة النور",
      isActive: false,
    };
    expect(
      matchesRecurringSearch(item, "النور", {
        frequency: "شهري",
        status: "متوقفة",
      })
    ).toBe(true);
  });
});

describe("recurring invoice catalogs", () => {
  it("has every recurring key in English and Arabic, Arabic not left in English", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("invoices.recurring."));
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) {
      const v = (ar as Record<string, string>)[k];
      expect(v, k).toBeTruthy();
      expect(v, k).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("recurring invoice status search matches the StatusBadge text", () => {
  it("searching the exact Arabic paused badge text finds the paused schedule", () => {
    const dict = { ...arComponents, ...arScreens } as Record<string, string>;
    const badgeHtml = renderToStaticMarkup(createElement(StatusBadge, { status: "paused" }));
    const expected = arScreens["screens.statusPaused"];
    expect(badgeHtml).toContain(expected);
    // The page builds its search label with statusBadgeText over the same dictionary.
    const searchLabel = statusBadgeText("paused", dict);
    expect(searchLabel).toBe(expected);

    const item = { customerName: "Acme", isActive: false };
    expect(matchesRecurringSearch(item, expected, { frequency: "", status: searchLabel })).toBe(
      true
    );
  });

  it("RecurringInvoices derives its status search label from statusBadgeText", () => {
    // Source-level: rendering the whole page needs the API, router and query stack; this pins the
    // wiring so the page cannot go back to a separate status label mapping.
    const src = readFileSync(join(process.cwd(), "client/src/pages/RecurringInvoices.tsx"), "utf8");
    expect(src).toMatch(/statusBadgeText\(active \? "active" : "paused", badgeT\)/);
    expect(src).not.toContain("invoices.recurring.status.paused");
  });
});
