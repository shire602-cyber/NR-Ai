import { describe, it, expect } from "vitest";
import { detectDelimiter, normalizeHeader, parseBoolean, parseDate, parseImportFile, parseNumber, ImportFileError } from "../../server/services/import/parse";

describe("parseNumber", () => {
  it.each([
    ["1,234.50", 1234.5],
    ["AED 1,234.50", 1234.5],
    ["(100.00)", -100],
    ["100.00-", -100],
    ["-100", -100],
    ["  42 ", 42],
    ["1 234.50", 1234.5],
    ["0.05", 0.05],
    [".5", 0.5],
    [7, 7],
  ])("%s -> %s", (input, expected) => {
    expect(parseNumber(input as any)).toBe(expected);
  });
  it("reads European format on request", () => {
    expect(parseNumber("1.234,50", "eu")).toBe(1234.5);
    expect(parseNumber("(1.000,00)", "eu")).toBe(-1000);
  });
  it.each(["abc", "", "12.3.4", "1e3", "--5"])("rejects %s", (s) => {
    expect(parseNumber(s)).toBeNull();
  });
});

describe("parseDate", () => {
  it("dd/MM/yyyy vs MM/dd/yyyy", () => {
    expect(parseDate("03/04/2026", "dd/MM/yyyy")).toBe("2026-04-03");
    expect(parseDate("03/04/2026", "MM/dd/yyyy")).toBe("2026-03-04");
    expect(parseDate("13/04/2026", "MM/dd/yyyy")).toBeNull();
    expect(parseDate("04/13/2026", "dd/MM/yyyy")).toBeNull();
  });
  it("ISO always works and impossible days do not", () => {
    expect(parseDate("2026-10-02", "dd/MM/yyyy")).toBe("2026-10-02");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("31/02/2026", "dd/MM/yyyy")).toBeNull();
    expect(parseDate("29/02/2028", "dd/MM/yyyy")).toBe("2028-02-29");
  });
  it("other formats, Excel dates and serials", () => {
    expect(parseDate("5 Mar 2026", "d MMM yyyy")).toBe("2026-03-05");
    expect(parseDate("05-03-2026", "dd-MM-yyyy")).toBe("2026-03-05");
    expect(parseDate("05.03.2026", "dd.MM.yyyy")).toBe("2026-03-05");
    expect(parseDate(new Date("2026-03-05T00:00:00Z"))).toBe("2026-03-05");
    expect(parseDate(46086)).toBe("2026-03-05");
    expect(parseDate("")).toBeNull();
    expect(parseDate("tomorrow")).toBeNull();
  });
});

describe("headers and booleans", () => {
  it("normalises headers", () => {
    expect(normalizeHeader("*ContactName")).toBe("contactname");
    expect(normalizeHeader(" Billing  Address ")).toBe("billingaddress");
    expect(normalizeHeader("Product/Service")).toBe("productservice");
  });
  it("reads booleans", () => {
    expect(parseBoolean("Active")).toBe(true);
    expect(parseBoolean("no")).toBe(false);
    expect(parseBoolean("maybe")).toBeNull();
  });
});

describe("parseImportFile", () => {
  it("detects semicolons and strips the BOM", async () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    const parsed = await parseImportFile(Buffer.from("﻿Name;Email\nAcme;a@b.com\n"), "x.csv");
    expect(parsed.headers).toEqual(["Name", "Email"]);
    expect(parsed.rows[0].Name).toBe("Acme");
  });
  it("keeps quoted commas and blank headers usable", async () => {
    const parsed = await parseImportFile(Buffer.from('Name,,Note\n"Acme, LLC",x,"say ""hi"""\n'), "x.csv");
    expect(parsed.headers).toEqual(["Name", "Column 2", "Note"]);
    expect(parsed.rows[0].Name).toBe("Acme, LLC");
    expect(parsed.rows[0].Note).toBe('say "hi"');
  });
  it("rejects empty, wrong type and header-less files", async () => {
    await expect(parseImportFile(Buffer.alloc(0), "x.csv")).rejects.toBeInstanceOf(ImportFileError);
    await expect(parseImportFile(Buffer.from("a"), "x.pdf")).rejects.toMatchObject({ code: "FILE_TYPE_UNSUPPORTED" });
    await expect(parseImportFile(Buffer.from("\n\n"), "x.csv")).rejects.toMatchObject({ code: "FILE_NO_HEADERS" });
  });
});
