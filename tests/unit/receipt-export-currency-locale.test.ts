import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildOcrReceiptsWorkbook,
  type OcrExportRow,
} from "../../server/services/excel-export.service";

async function load(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0];
}

const mixed: OcrExportRow[] = [
  {
    date: "2026-04-01",
    vendor: "A",
    invoiceNumber: "1",
    amount: 100.1,
    vat: 5.01,
    currency: "AED",
  },
  { date: "2026-04-02", vendor: "B", invoiceNumber: "2", amount: 50, vat: 2.5, currency: "USD" },
  { date: "2026-04-03", vendor: "C", invoiceNumber: "3", amount: 0.2, vat: 0.01, currency: "AED" },
  { date: "2026-04-04", vendor: "D", invoiceNumber: "4", amount: 10, vat: null, currency: "usd" },
];

describe("receipt export: per-currency totals", () => {
  it("writes one total row per currency with its own format and exact sums", async () => {
    const sheet = await load(await buildOcrReceiptsWorkbook(mixed));
    // rows grouped by currency: AED (2), USD (2), then totals
    expect(sheet.getRow(2).getCell(2).value).toBe("A");
    expect(sheet.getRow(3).getCell(2).value).toBe("C");
    expect(sheet.getRow(4).getCell(2).value).toBe("B");
    expect(sheet.getRow(5).getCell(2).value).toBe("D");

    const aed: any = sheet.getRow(6);
    expect(aed.getCell(3).value).toBe("Total (AED)");
    expect(aed.getCell(4).value.formula).toBe("SUM(D2:D3)");
    expect(aed.getCell(4).value.result).toBe(100.3);
    expect(aed.getCell(5).value.result).toBe(5.02);
    expect(aed.getCell(4).numFmt).toContain("AED");
    expect(aed.getCell(4).numFmt).not.toContain("USD");

    const usd: any = sheet.getRow(7);
    expect(usd.getCell(3).value).toBe("Total (USD)");
    expect(usd.getCell(4).value.formula).toBe("SUM(D4:D5)");
    expect(usd.getCell(4).value.result).toBe(60);
    expect(usd.getCell(5).value.result).toBe(2.5);
    expect(usd.getCell(4).numFmt).toContain("USD");
  });

  it("keeps a single plain Total row and the original order for one currency", async () => {
    const sheet = await load(await buildOcrReceiptsWorkbook([mixed[0], mixed[2]]));
    expect(sheet.getRow(2).getCell(2).value).toBe("A");
    expect(sheet.getRow(3).getCell(2).value).toBe("C");
    expect(sheet.getRow(4).getCell(3).value).toBe("Total");
    expect((sheet.getRow(4).getCell(4).value as any).formula).toBe("SUM(D2:D3)");
    expect(sheet.getRow(5).getCell(3).value).toBeNull();
  });
});

describe("receipt export: locale", () => {
  it("defaults to English, left-to-right", async () => {
    const sheet = await load(await buildOcrReceiptsWorkbook(mixed));
    expect(sheet.getRow(1).getCell(1).value).toBe("Date");
    expect(sheet.name).toBe("OCR Receipts");
    expect(sheet.views[0].rightToLeft ?? false).toBe(false);
  });

  it("writes Arabic headers, total label and a right-to-left sheet for ar", async () => {
    const sheet = await load(
      await buildOcrReceiptsWorkbook(mixed, { locale: "ar", sheetName: "Receipts" })
    );
    const headers = [1, 2, 3, 4, 5].map((c) => sheet.getRow(1).getCell(c).value);
    expect(headers).toEqual([
      "التاريخ",
      "المورد",
      "رقم الفاتورة",
      "المبلغ",
      "ضريبة القيمة المضافة",
    ]);
    expect(sheet.name).toBe("الإيصالات");
    expect(sheet.views[0].rightToLeft).toBe(true);
    expect(sheet.getRow(6).getCell(3).value).toBe("الإجمالي (AED)");
    // figures are untouched by the language
    expect(sheet.getRow(2).getCell(4).value).toBe(100.1);
  });

  it("Arabic single-currency total is just the Arabic label", async () => {
    const sheet = await load(await buildOcrReceiptsWorkbook([mixed[0]], { locale: "ar" }));
    expect(sheet.getRow(3).getCell(3).value).toBe("الإجمالي");
  });
});
