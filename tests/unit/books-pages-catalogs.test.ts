// @vitest-environment jsdom
/**
 * Accounting-pages verification (2026-11-19), catalog and CSS regressions found in the browser run
 * (tests/e2e/books-pages-flow.mjs):
 *  - every journal source the server writes has a report label in English and Arabic (the
 *    expenses and general-ledger reports showed the raw English word "Reversal" in Arabic);
 *  - the bank rule dialog's labels are catalog keys (they were English literals);
 *  - the phone table rule no longer turns every table cell into a scroll region.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { reportCodeLabel } from "../../client/src/pages/reports/model/reportLabels";

const SOURCES = [
  "reversal",
  "opening_balance",
  "cash_sale",
  "payment_gateway_fee",
  "customer_receipt_fee",
  "invoice_cogs",
  "credit_note_cogs",
  "expense_claim_payment",
  "inventory_adjustment",
  "manual_workpaper",
];

const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("journal source labels", () => {
  it("each source has an English and an Arabic report label", () => {
    const en = read("client/src/locales/en/reportCenter.json");
    const ar = read("client/src/locales/ar/reportCenter.json");
    for (const s of SOURCES) {
      const key = `reportCenter.code.${s}`;
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(ar[key], `ar ${key}`).toBeTruthy();
      expect(/[a-z]{3}/i.test(ar[key]!), `ar ${key} has no Latin words`).toBe(false);
    }
  });

  it("reportCodeLabel renders Arabic for 'reversal' in Arabic", () => {
    useI18n.setState({ locale: "ar" });
    expect(reportCodeLabel("reversal")).toBe("عكس قيد");
    useI18n.setState({ locale: "en" });
    expect(reportCodeLabel("reversal")).toBe("Reversal");
  });
});

describe("bank rule dialog copy", () => {
  it("has the category and memo labels in both languages", () => {
    for (const lang of ["en", "ar"]) {
      const c = read(`client/src/locales/${lang}/reconciliationRules.json`);
      for (const k of ["category", "categoryPlaceholder", "memo"])
        expect(c[`banking.rules.${k}`], `${lang} ${k}`).toBeTruthy();
    }
    const page = readFileSync("client/src/pages/ReconciliationRules.tsx", "utf8");
    // Source inspection: the dialog needs a click path through a rule form to render these
    // labels, which the browser run covers; this pins that no English literal comes back.
    expect(page).not.toContain("Category (optional)");
    expect(page).not.toContain("Memo (optional)");
  });
});

describe("phone table wrapper rule", () => {
  it("scrolls wrappers, not the table cells whose class names mention 'table'", () => {
    const css = readFileSync("client/src/styles/mobile.css", "utf8");
    const after = css.slice(css.indexOf("Responsive Tables"));
    const open = after.indexOf("{", after.indexOf("@media"));
    const list = after
      .slice(open + 1, after.indexOf("overflow-x: auto"))
      .replace(/\{\s*$/, "")
      .trim();
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";
    const cell = document.createElement("td");
    cell.className = "h-11 group-data-[density=compact]/table:h-9";
    const classed = document.createElement("div");
    classed.className = "overflow-table-box";
    expect(wrapper.matches(list)).toBe(true);
    expect(classed.matches(list)).toBe(true);
    expect(cell.matches(list)).toBe(false);
  });
});
