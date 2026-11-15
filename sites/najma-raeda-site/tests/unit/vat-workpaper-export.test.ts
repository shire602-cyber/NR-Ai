import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { parseVatPasteRows } from "../../client/src/lib/vat-workpaper-grid";
import { calculateVatWorkpaperTotals } from "../../server/services/firm-vat-workspace.service";
import {
  buildVatWorkpaperTemplateWorkbook,
  buildVatWorkpaperWorkbook,
  vatWorkpaperExportFilename,
} from "../../server/services/vat-workpaper-export.service";

function fakeDetail() {
  const rows = [
    {
      id: "row-1",
      rowCategory: "standard_sale",
      vat201Box: null,
      invoiceNumber: "INV-1001",
      documentDate: new Date("2026-05-18"),
      counterpartyName: "Acme LLC",
      counterpartyTrn: "100123456700003",
      emirate: "dubai",
      taxableAmount: 1000,
      vatAmount: 50,
      adjustmentAmount: 0,
      grossAmount: 1050,
      status: "approved",
      sourceMethod: "import",
      notes: "May sale",
    },
    {
      id: "row-2",
      rowCategory: "zero_rated_sale",
      vat201Box: null,
      invoiceNumber: "INV-1002",
      documentDate: new Date("2026-05-20"),
      counterpartyName: "Export GmbH",
      counterpartyTrn: null,
      emirate: "dubai",
      taxableAmount: 2000,
      vatAmount: 0,
      adjustmentAmount: 0,
      grossAmount: 2000,
      status: "approved",
      sourceMethod: "manual",
      notes: null,
    },
    {
      id: "row-3",
      rowCategory: "standard_expense",
      vat201Box: null,
      invoiceNumber: "BILL-77",
      documentDate: new Date("2026-05-25"),
      counterpartyName: "Office Supplies Co",
      counterpartyTrn: null,
      emirate: "dubai",
      taxableAmount: 400,
      vatAmount: 20,
      adjustmentAmount: 0,
      grossAmount: 420,
      status: "approved",
      sourceMethod: "ocr",
      notes: null,
    },
    {
      id: "row-4",
      rowCategory: "standard_sale",
      vat201Box: null,
      invoiceNumber: "INV-VOID",
      documentDate: new Date("2026-05-26"),
      counterpartyName: "Voided Customer",
      counterpartyTrn: null,
      emirate: "dubai",
      taxableAmount: 999,
      vatAmount: 49.95,
      adjustmentAmount: 0,
      grossAmount: 1048.95,
      status: "excluded",
      sourceMethod: "manual",
      notes: "voided invoice",
    },
  ];

  return {
    workpaper: {
      id: "wp-1",
      companyId: "company-1",
      periodStart: new Date("2026-04-01"),
      periodEnd: new Date("2026-06-30"),
      dueDate: new Date("2026-07-28"),
      status: "in_review",
    },
    company: { id: "company-1", name: "Pearl Trading LLC", trnVatNumber: "100123456700003" },
    rows,
    attachments: [],
    totals: calculateVatWorkpaperTotals(rows as any),
  } as any;
}

function sheetText(sheet: ExcelJS.Worksheet): string[][] {
  const grid: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cell.value == null ? "" : String(cell.value));
    });
    grid.push(cells);
  });
  return grid;
}

describe("VAT workpaper Excel export", () => {
  it("builds a workbook with the grid sheet and a copy-ready VAT 201 sheet", async () => {
    const buffer = await buildVatWorkpaperWorkbook(fakeDetail());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const gridSheet = workbook.getWorksheet("VAT Workpaper");
    const vat201Sheet = workbook.getWorksheet("VAT 201");
    expect(gridSheet).toBeDefined();
    expect(vat201Sheet).toBeDefined();

    const grid = sheetText(gridSheet!);
    const flatGrid = grid.map((row) => row.join("|")).join("\n");

    // Title block carries client identity and period.
    expect(flatGrid).toContain("Pearl Trading LLC");
    expect(flatGrid).toContain("100123456700003");
    expect(flatGrid).toContain("2026-04-01");

    // All rows present, including the excluded one.
    expect(flatGrid).toContain("INV-1001");
    expect(flatGrid).toContain("INV-1002");
    expect(flatGrid).toContain("BILL-77");
    expect(flatGrid).toContain("INV-VOID");

    // Approved-only totals: taxable 1000 + 2000 + 400 = 3400 (excluded 999 not counted).
    const totalsRow = grid.find((row) => row.join("|").includes("Totals (approved rows)"));
    expect(totalsRow).toBeDefined();
    expect(totalsRow!.join("|")).toContain("3400");
  });

  it("writes VAT 201 box values from approved rows only", async () => {
    const buffer = await buildVatWorkpaperWorkbook(fakeDetail());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const grid = sheetText(workbook.getWorksheet("VAT 201")!);

    const box1b = grid.find((row) => row[0] === "1b");
    expect(box1b).toBeDefined();
    expect(Number(box1b![2])).toBe(1000); // taxable
    expect(Number(box1b![3])).toBe(50); // VAT

    const box4 = grid.find((row) => row[0] === "4");
    expect(Number(box4![2])).toBe(2000);

    const box14 = grid.find((row) => row[0] === "14");
    expect(box14).toBeDefined();
    // Payable = output VAT 50 − input VAT 20 = 30.
    expect(Number(box14![3])).toBe(30);
  });

  it("derives a clean filename from the client and period", () => {
    expect(vatWorkpaperExportFilename(fakeDetail())).toBe(
      "vat-workpaper-pearl-trading-llc-2026-06-30.xlsx"
    );
  });

  it("produces a template whose rows round-trip through the paste importer", async () => {
    const buffer = await buildVatWorkpaperTemplateWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheet = workbook.getWorksheet("VAT Rows");
    expect(sheet).toBeDefined();

    // Reconstruct what an accountant would copy out of the filled template:
    // header row + data rows, tab-delimited.
    const lines: string[] = [];
    sheet!.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cell.value == null ? "" : String(cell.value));
      });
      lines.push(cells.join("\t"));
    });

    const parsed = parseVatPasteRows(lines.join("\n"), "dubai");
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      rowCategory: "standard_sale",
      invoiceNumber: "INV-1001",
      taxableAmount: 1000,
      vatAmount: 50,
    });
    expect(parsed[1].rowCategory).toBe("zero_rated_sale");
    expect(parsed[2].rowCategory).toBe("standard_expense");

    // Category reference sheet exists for the accountant.
    expect(workbook.getWorksheet("Categories")).toBeDefined();
  });
});
