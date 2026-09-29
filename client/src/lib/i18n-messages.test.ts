import { describe, it, expect } from "vitest";
import { interpolate, plural, pluralCategory, defineMessages, resolveMessage } from "./i18n-messages";

const invoiceForms = {
  zero: "لا توجد فواتير",
  one: "فاتورة واحدة",
  two: "فاتورتان",
  few: "{count} فواتير",
  many: "{count} فاتورة",
  other: "{count} فاتورة",
};

describe("interpolate", () => {
  it("fills named placeholders regardless of order", () => {
    expect(interpolate("{b} then {a}", { a: 1, b: "x" })).toBe("x then 1");
  });
  it("leaves unknown placeholders visible and tolerates no params", () => {
    expect(interpolate("Hello {name}")).toBe("Hello {name}");
    expect(interpolate("Hello {name}", {})).toBe("Hello {name}");
  });
  it("renders null/undefined values as empty text", () => {
    expect(interpolate("[{v}]", { v: null })).toBe("[]");
  });
});

describe("Arabic plural categories", () => {
  it.each([
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [10, "few"],
    [11, "many"],
    [99, "many"],
    [100, "other"],
    [102, "other"],
    [103, "few"],
    [111, "many"],
  ])("%i -> %s", (n, expected) => {
    expect(pluralCategory("ar", n)).toBe(expected);
  });
});

describe("plural()", () => {
  it("picks the correct Arabic form for 0, 1, 2, few, many", () => {
    expect(plural("ar", 0, invoiceForms)).toBe("لا توجد فواتير");
    expect(plural("ar", 1, invoiceForms)).toBe("فاتورة واحدة");
    expect(plural("ar", 2, invoiceForms)).toBe("فاتورتان");
    expect(plural("ar", 5, invoiceForms)).toBe("5 فواتير");
    expect(plural("ar", 25, invoiceForms)).toBe("25 فاتورة");
    expect(plural("ar", 1200, invoiceForms)).toBe("1,200 فاتورة");
  });
  it("uses one/other in English and honours an explicit zero form", () => {
    const en = { zero: "No invoices", one: "{count} invoice", other: "{count} invoices" };
    expect(plural("en", 0, en)).toBe("No invoices");
    expect(plural("en", 1, en)).toBe("1 invoice");
    expect(plural("en", 2, en)).toBe("2 invoices");
  });
  it("falls back to `other` when a category is missing", () => {
    expect(plural("ar", 2, { one: "one", other: "{count} items" })).toBe("2 items");
  });
});

describe("defineMessages", () => {
  const m = defineMessages(
    "TestPage",
    { hello: "Hello {name}", n_one: "{count} item", n_other: "{count} items", bad: "Required" },
    { hello: "مرحبًا {name}", n_one: "عنصر واحد", n_other: "{count} عنصر", bad: "مطلوب" }
  );

  it("translates with named placeholders in the active language", () => {
    // default locale of the store is "en"
    expect(m.t("hello", { name: "Sara" })).toBe("Hello Sara");
  });

  it("resolves a deferred marker for either language", () => {
    const marker = m.marker("bad");
    expect(resolveMessage(marker, "en")).toBe("Required");
    expect(resolveMessage(marker, "ar")).toBe("مطلوب");
    expect(resolveMessage("plain text", "ar")).toBe("plain text");
    expect(resolveMessage(undefined, "ar")).toBeUndefined();
  });

  it("carries params through a marker", () => {
    const marker = m.marker("hello", { name: "Omar" });
    expect(resolveMessage(marker, "ar")).toBe("مرحبًا Omar");
  });
});
