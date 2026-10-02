import { describe, expect, it } from "vitest";
import type { ReportColumn, ReportRow } from "../../shared/report-result";
import {
  formatCell,
  isNegativeCell,
  isNumericColumn,
  linkColumnIndex,
  sectionHeading,
} from "../../client/src/lib/report-format";

const col = (key: string, type: ReportColumn["type"] = "text"): ReportColumn => ({
  key,
  type,
  label: { en: key, ar: key },
});

describe("report cell formatting", () => {
  it("money has two decimals, grouped, Western digits in both languages", () => {
    expect(formatCell(1234567.5, "money", "en")).toBe("1,234,567.50");
    expect(formatCell(1234567.5, "money", "ar")).toBe("1,234,567.50");
    expect(formatCell(-5, "money", "en")).toMatch(/5\.00$/);
  });

  it("percent has one decimal and a sign-free percent mark; null is empty", () => {
    expect(formatCell(12.345, "percent", "en")).toBe("12.3%");
    expect(formatCell(null, "percent", "en")).toBe("");
  });

  it("numbers keep whole values whole and give fractions two decimals", () => {
    expect(formatCell(3, "number", "en")).toBe("3");
    expect(formatCell(2.5, "number", "en")).toBe("2.50");
  });

  it("text and dates pass through untouched; missing values are empty", () => {
    expect(formatCell("2026-10-02", "date", "en")).toBe("2026-10-02");
    expect(formatCell("=HYPERLINK(1)", "text", "en")).toBe("=HYPERLINK(1)");
    expect(formatCell(undefined, "money", "en")).toBe("");
    expect(formatCell("", "text", "en")).toBe("");
  });

  it("a value the server sent as text where a number is expected is shown, not turned into NaN", () => {
    expect(formatCell("n/a", "money", "en")).toBe("n/a");
  });

  it("only money, number and percent align to the end and go red when negative", () => {
    expect(["text", "date"].some((t) => isNumericColumn(t as any))).toBe(false);
    expect(isNegativeCell(-1, "money")).toBe(true);
    expect(isNegativeCell(0, "money")).toBe(false);
    expect(isNegativeCell(-1, "text")).toBe(false);
    expect(isNegativeCell("-1", "money")).toBe(false);
  });
});

describe("where a row's drill link and section heading sit", () => {
  it("links the column that names the record, not the code before it", () => {
    expect(linkColumnIndex([col("code"), col("name"), col("amount", "money")])).toBe(1);
    expect(
      linkColumnIndex([col("date", "date"), col("number"), col("customer"), col("total", "money")])
    ).toBe(2);
    expect(linkColumnIndex([col("a"), col("b")])).toBe(0);
    expect(linkColumnIndex([col("amount", "money")])).toBe(0);
  });

  it("a section heading is the first text cell that has a value", () => {
    const columns = [col("code"), col("name"), col("amount", "money")];
    const row: ReportRow = { key: "s", kind: "section", cells: { name: "Revenue" } };
    expect(sectionHeading(row, columns)).toBe("Revenue");
    expect(sectionHeading({ key: "s", kind: "section", cells: {} }, columns)).toBe("");
  });
});
