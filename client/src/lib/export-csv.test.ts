import { describe, expect, it } from "vitest";
import { buildCsv, csvField, CSV_BOM } from "./export-csv";

const sheet = (rows: Record<string, unknown>[], sheetName = "S") => ({
  sheetName,
  columns: [
    { header: "Name", key: "name" },
    { header: "Amount", key: "amount" },
  ],
  rows,
});

describe("csvField", () => {
  it("leaves plain text unquoted", () => {
    expect(csvField("Acme")).toBe("Acme");
  });
  it("quotes commas, quotes and line breaks and doubles inner quotes", () => {
    expect(csvField("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField("a\r\nb")).toBe('"a\r\nb"');
  });
  it("writes numbers unformatted", () => {
    expect(csvField(1234567.5)).toBe("1234567.5");
    expect(csvField(-12.25)).toBe("-12.25");
    expect(csvField(0)).toBe("0");
  });
  it("writes null, undefined and non-finite numbers as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(Number.NaN)).toBe("");
  });
  it("neutralises spreadsheet formulas in text but not negative numbers in text", () => {
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("@x")).toBe("'@x");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("-15.5")).toBe("-15.5");
  });
});

describe("buildCsv", () => {
  it("starts with the UTF-8 BOM and ends records with CRLF", () => {
    const csv = buildCsv([sheet([{ name: "Acme", amount: 10 }])]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}Name,Amount\r\nAcme,10\r\n`);
  });
  it("keeps Arabic text intact", () => {
    const csv = buildCsv([sheet([{ name: "شركة النور، ذ.م.م", amount: 5 }, { name: "النور, للتجارة", amount: 6 }])]);
    expect(csv).toContain("شركة النور، ذ.م.م,5");
    expect(csv).toContain('"النور, للتجارة",6');
  });
  it("uses the column order and header labels, missing keys empty", () => {
    const csv = buildCsv([sheet([{ amount: 3 }])]);
    expect(csv).toBe(`${CSV_BOM}Name,Amount\r\n,3\r\n`);
  });
  it("writes several sheets one after another with their names", () => {
    const csv = buildCsv([sheet([{ name: "a", amount: 1 }], "One"), sheet([{ name: "b", amount: 2 }], "Two")]);
    expect(csv).toBe(`${CSV_BOM}One\r\nName,Amount\r\na,1\r\n\r\nTwo\r\nName,Amount\r\nb,2\r\n`);
  });
});
