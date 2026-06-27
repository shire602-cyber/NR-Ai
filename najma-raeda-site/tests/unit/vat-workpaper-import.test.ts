import { describe, expect, it } from "vitest";

import { mapBooksToVatWorkpaperRows } from "../../server/services/firm-vat-workspace.service";
import {
  buildVatWorkpaperTemplateWorkbook,
  parseVatWorkbookRows,
} from "../../server/services/vat-workpaper-export.service";

const PERIOD = {
  periodStart: new Date("2026-04-01"),
  periodEnd: new Date("2026-06-30"),
};

describe("mapBooksToVatWorkpaperRows", () => {
  it("splits an invoice into standard / zero-rated / exempt draft rows", () => {
    const rows = mapBooksToVatWorkpaperRows({
      ...PERIOD,
      companyEmirate: "dubai",
      existingSourceIds: new Set(),
      invoices: [
        {
          id: "inv-1",
          number: "INV-1",
          date: "2026-05-10",
          status: "sent",
          customerName: "Acme LLC",
          customerTrn: "100123456700003",
        },
      ],
      invoiceLines: [
        {
          invoiceId: "inv-1",
          quantity: 2,
          unitPrice: 500,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
        {
          invoiceId: "inv-1",
          quantity: 1,
          unitPrice: 300,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
        { invoiceId: "inv-1", quantity: 1, unitPrice: 200, vatRate: 0, vatSupplyType: "exempt" },
      ],
      receipts: [],
    });

    expect(rows).toHaveLength(3);
    const standard = rows.find((row) => row.rowCategory === "standard_sale");
    expect(standard).toMatchObject({
      taxableAmount: 1000,
      vatAmount: 50,
      status: "draft",
      sourceMethod: "generated",
      sourceDocumentType: "invoice",
      sourceDocumentId: "inv-1",
      counterpartyTrn: "100123456700003",
    });
    expect(rows.find((row) => row.rowCategory === "zero_rated_sale")).toMatchObject({
      taxableAmount: 300,
    });
    expect(rows.find((row) => row.rowCategory === "exempt_sale")).toMatchObject({
      taxableAmount: 200,
    });
  });

  it("skips void/draft invoices, out-of-period documents, and already-pulled ids", () => {
    const rows = mapBooksToVatWorkpaperRows({
      ...PERIOD,
      companyEmirate: "dubai",
      existingSourceIds: new Set(["inv-dup"]),
      invoices: [
        { id: "inv-void", number: "V-1", date: "2026-05-01", status: "void" },
        { id: "inv-early", number: "E-1", date: "2026-03-31", status: "sent" },
        { id: "inv-dup", number: "D-1", date: "2026-05-05", status: "sent" },
      ],
      invoiceLines: [
        { invoiceId: "inv-void", quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { invoiceId: "inv-early", quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { invoiceId: "inv-dup", quantity: 1, unitPrice: 100, vatRate: 0.05 },
      ],
      receipts: [],
    });
    expect(rows).toHaveLength(0);
  });

  it("maps posted receipts to expense rows and reverse-charge inputs", () => {
    const rows = mapBooksToVatWorkpaperRows({
      ...PERIOD,
      companyEmirate: "sharjah",
      existingSourceIds: new Set(),
      invoices: [],
      invoiceLines: [],
      receipts: [
        {
          id: "rec-1",
          date: "2026-05-12",
          posted: true,
          merchant: "Office Co",
          amount: 400,
          vatAmount: 20,
        },
        {
          id: "rec-2",
          date: "2026-05-13",
          posted: true,
          merchant: "Foreign SaaS",
          amount: 900,
          vatAmount: 45,
          reverseCharge: true,
        },
        {
          id: "rec-unposted",
          date: "2026-05-14",
          posted: false,
          merchant: "Draft Store",
          amount: 50,
          vatAmount: 2.5,
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rowCategory: "standard_expense",
      counterpartyName: "Office Co",
      taxableAmount: 400,
      vatAmount: 20,
      status: "draft",
      sourceDocumentType: "receipt",
    });
    expect(rows[1]).toMatchObject({ rowCategory: "reverse_charge_input", taxableAmount: 900 });
  });
});

describe("parseVatWorkbookRows", () => {
  it("parses the downloadable template workbook through the shared paste rules", async () => {
    const buffer = await buildVatWorkpaperTemplateWorkbook();
    const rows = await parseVatWorkbookRows(buffer, "dubai");

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      rowCategory: "standard_sale",
      invoiceNumber: "INV-1001",
      taxableAmount: 1000,
      vatAmount: 50,
      sourceMethod: "import",
      status: "approved",
    });
    expect(rows[1].rowCategory).toBe("zero_rated_sale");
    expect(rows[2].rowCategory).toBe("standard_expense");
  });

  it("returns no rows for an empty workbook", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Blank");
    const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    expect(await parseVatWorkbookRows(buffer, "dubai")).toHaveLength(0);
  });
});
