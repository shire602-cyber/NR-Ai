import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildGenericWorkbook,
  buildOcrReceiptsWorkbook,
  buildExportFilename,
  normalizeGenericCell,
  receiptToExportRow,
  type OcrExportRow,
} from "../../server/services/excel-export.service";

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS expects an ArrayBuffer; Buffer is structurally compatible.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe("excel-export.service", () => {
  const sampleRows: OcrExportRow[] = [
    {
      date: "2026-04-01",
      vendor: "Carrefour Hypermarket",
      invoiceNumber: "INV-001",
      amount: 105,
      vat: 5,
      currency: "AED",
    },
    {
      date: new Date("2026-04-15T00:00:00Z"),
      vendor: "Office Pro LLC",
      invoiceNumber: null,
      amount: "210.50",
      vat: 10.02,
      currency: "AED",
    },
  ];

  it("produces a non-empty XLSX buffer", async () => {
    const buf = await buildOcrReceiptsWorkbook(sampleRows);
    expect(buf.length).toBeGreaterThan(1000);
    // XLSX files are ZIP archives — check the magic bytes (PK\x03\x04).
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("writes the expected header row with bold styling", async () => {
    const wb = await loadWorkbook(await buildOcrReceiptsWorkbook(sampleRows));
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1);
    const cells = ["Date", "Vendor", "Invoice No.", "Amount", "VAT"];
    cells.forEach((label, idx) => {
      const cell = header.getCell(idx + 1);
      expect(cell.value).toBe(label);
      const font = cell.font ?? {};
      expect(font.bold).toBe(true);
    });
  });

  it("writes data rows with currency formatting on Amount and VAT columns", async () => {
    const wb = await loadWorkbook(await buildOcrReceiptsWorkbook(sampleRows));
    const sheet = wb.worksheets[0];

    const firstData = sheet.getRow(2);
    expect(firstData.getCell(1).value).toBe("2026-04-01");
    expect(firstData.getCell(2).value).toBe("Carrefour Hypermarket");
    expect(firstData.getCell(3).value).toBe("INV-001");
    expect(firstData.getCell(4).value).toBe(105);
    expect(firstData.getCell(5).value).toBe(5);
    expect(firstData.getCell(4).numFmt ?? "").toContain("AED");
    expect(firstData.getCell(5).numFmt ?? "").toContain("AED");

    const secondData = sheet.getRow(3);
    // String amount "210.50" should be coerced to a real number.
    expect(secondData.getCell(4).value).toBe(210.5);
    expect(secondData.getCell(5).value).toBe(10.02);
    // Date provided as Date object should be normalised to YYYY-MM-DD.
    expect(secondData.getCell(1).value).toBe("2026-04-15");
    // Null invoice number renders as empty, not the string "null".
    const inv = secondData.getCell(3).value;
    expect(inv === null || inv === "" || inv === undefined).toBe(true);
  });

  it("appends a totals row that sums Amount and VAT", async () => {
    const wb = await loadWorkbook(await buildOcrReceiptsWorkbook(sampleRows));
    const sheet = wb.worksheets[0];
    // 2 data rows + 1 header + 1 totals = row 4
    const totalsRow = sheet.getRow(4);
    expect(String(totalsRow.getCell(3).value)).toBe("Total");
    const amountCell: any = totalsRow.getCell(4).value;
    const vatCell: any = totalsRow.getCell(5).value;
    expect(amountCell?.formula ?? "").toMatch(/SUM\(D2:D3\)/i);
    expect(vatCell?.formula ?? "").toMatch(/SUM\(E2:E3\)/i);
  });

  it("handles an empty rows array without throwing", async () => {
    const buf = await buildOcrReceiptsWorkbook([]);
    expect(buf.length).toBeGreaterThan(500);
    const wb = await loadWorkbook(buf);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toBe("Date");
    // No data → no totals row added.
    const secondRow = sheet.getRow(2).getCell(1).value;
    expect(secondRow === null || secondRow === undefined || secondRow === "").toBe(true);
  });

  it("respects custom currency in the format code", async () => {
    const wb = await loadWorkbook(
      await buildOcrReceiptsWorkbook([{ ...sampleRows[0], currency: "usd" }])
    );
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(2).getCell(4).numFmt ?? "").toContain("USD");
  });

  it("maps a saved receipt to a tax-exclusive Amount, preferring stored subtotal", () => {
    // receipts.amount IS the net subtotal — prefer it even when total is present.
    const row = receiptToExportRow({
      date: "2026-04-12",
      merchant: "Etisalat",
      invoiceNumber: "INV-9000",
      amount: 100,
      total: 105,
      vatAmount: 5,
      currency: "AED",
    });
    expect(row).toEqual({
      date: "2026-04-12",
      vendor: "Etisalat",
      invoiceNumber: "INV-9000",
      amount: 100,
      vat: 5,
      currency: "AED",
    });
  });

  it("derives Amount from total - vatAmount when subtotal is missing", () => {
    const row = receiptToExportRow({
      date: "2026-04-12",
      merchant: "Etisalat",
      total: 105,
      vatAmount: 5,
    });
    expect(row.amount).toBe(100);
    expect(row.vat).toBe(5);
  });

  it("falls back to amount when total is missing", () => {
    const row = receiptToExportRow({
      date: "2026-04-12",
      merchant: "Etisalat",
      amount: 50,
      vatAmount: null,
    });
    expect(row.amount).toBe(50);
    expect(row.vat).toBe(null);
    expect(row.currency).toBe("AED");
  });

  it("builds a dated filename with the .xlsx extension", () => {
    const name = buildExportFilename();
    expect(name.endsWith(".xlsx")).toBe(true);
    expect(name).toMatch(/^muhasib-ocr-receipts-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("builds generic multi-sheet XLSX exports without browser ExcelJS", async () => {
    const wb = await loadWorkbook(
      await buildGenericWorkbook(
        [
          {
            sheetName: "Invoices",
            columns: [
              { header: "Invoice #", key: "number", width: 18 },
              { header: "Customer", key: "customerName", width: 28 },
              { header: "Total", key: "total", width: 16 },
            ],
            rows: [{ number: "INV-001", customerName: "Najma Trading", total: 1050.25 }],
          },
          {
            sheetName: "VAT Summary",
            columns: [
              { header: "Box", key: "box" },
              { header: "Amount", key: "amount" },
            ],
            rows: [{ box: "Box 1 - Dubai", amount: 500 }],
          },
        ],
        { title: "Report Export" }
      )
    );

    expect(wb.worksheets).toHaveLength(2);
    expect(wb.worksheets[0].name).toBe("Invoices");
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe("Invoice #");
    expect(wb.worksheets[0].getRow(2).getCell(3).value).toBe(1050.25);
    expect(wb.worksheets[0].getRow(2).getCell(3).numFmt).toBe("#,##0.00");
    expect(wb.worksheets[1].name).toBe("VAT Summary");
    expect(wb.title).toBe("Report Export");
  });
  it("preserves receipt references and formats incomplete OCR exports", async () => {
    const workbook = await loadWorkbook(
      await buildOcrReceiptsWorkbook(
        [
          { ...sampleRows[0], date: "April 15, 2026 UTC", amount: "1,050.25", currency: "" },
          { date: new Date(Number.NaN), vendor: null, invoiceNumber: "00021", amount: NaN, vat: "" },
          { date: "Unreadable", vendor: "Source image", invoiceNumber: null, amount: undefined, vat: null },
          { date: null, vendor: null, invoiceNumber: null, amount: null, vat: undefined },
        ],
        { title: "Reviewed receipts", sheetName: "Receipt review" }
      )
    );
    const sheet = workbook.getWorksheet("Receipt review")!;
    expect(workbook.title).toBe("Reviewed receipts");
    expect(sheet.getCell("A2").value).toBe("2026-04-15");
    expect(sheet.getCell("D2").value).toBe(1050.25);
    expect(sheet.getCell("D2").numFmt).toContain("AED");
    expect(sheet.getCell("C3").value).toBe("00021");
    expect(sheet.getCell("D3").value).toBeNull();
    expect(sheet.getCell("E3").value).toBeNull();
    expect(sheet.getCell("A4").value).toBe("Unreadable");
  });

  it("uses Arabic worksheet direction and safely names generic export sheets", async () => {
    const columns = [{ header: "المبلغ", key: "amount" }, { header: "مرجع", key: "reference" }];
    const wb = await loadWorkbook(
      await buildGenericWorkbook([
        { columns, rtl: true, rows: [{ amount: " 15.20 ", reference: "0012" }, { amount: false }] },
        { columns, sheetName: "[]*?", rows: [] },
      ])
    );
    const [arabic, sanitized] = wb.worksheets;
    expect(wb.title).toBe("Muhasib Export");
    expect(arabic.name).toBe("Sheet 1");
    expect(arabic.views[0].rightToLeft).toBe(true);
    expect(arabic.getCell("A1").alignment.horizontal).toBe("right");
    expect(arabic.getCell("A2").value).toBe(15.2);
    expect(arabic.getCell("B2").value).toBe("0012");
    expect(arabic.getCell("A3").value).toBe(false);
    expect(sanitized.name).toBe("Sheet");
  });

  it("omits invalid generic amounts and keeps dates, booleans, and account labels", () => {
    const date = new Date("2026-04-15T00:00:00.000Z");
    expect(normalizeGenericCell(date)).toBe(date);
    expect(normalizeGenericCell(Infinity)).toBe("");
    expect(normalizeGenericCell(0)).toBe(0);
    expect(normalizeGenericCell(false)).toBe(false);
    expect(normalizeGenericCell(null)).toBe("");
    expect(normalizeGenericCell(undefined)).toBe("");
    expect(normalizeGenericCell(["1200"])).toBe("1200");
    expect(receiptToExportRow({ invoiceNumber: "00021", total: "10.50" })).toMatchObject({
      invoiceNumber: "00021",
      amount: 10.5,
    });
  });

});
