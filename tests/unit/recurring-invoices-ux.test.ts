import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { StatusBadge } from "../../client/src/components/ui/badge";
import { statusBadgeText } from "../../client/src/components/ui/status-meta";
import { matchesRecurringSearch } from "../../client/src/lib/recurring-search";
import en from "../../client/src/locales/en/invoices.json";
import ar from "../../client/src/locales/ar/invoices.json";
import arScreens from "../../client/src/locales/ar/screens.json";
import arComponents from "../../client/src/locales/ar/components.json";

// Real Arabic catalogs served synchronously, so the real StatusBadge renders without the async loader.
vi.mock("../../client/src/lib/i18n", async () => {
  const screens = (await import("../../client/src/locales/ar/screens.json")).default;
  const components = (await import("../../client/src/locales/ar/components.json")).default;
  const dict = { ...components, ...screens } as Record<string, string>;
  return { useTranslation: () => ({ t: dict, locale: "ar" }) };
});

const labels = { frequency: "Monthly", status: "Active" };

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
