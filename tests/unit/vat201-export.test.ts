import { describe, expect, it } from "vitest";
import { prepareVat201ForExport, vat201ExportFilename } from "../../client/src/lib/vat201-export";

const baseReturn = {
  periodStart: "2026-04-01",
  periodEnd: "2026-06-30",
  dueDate: "2026-07-28",
  status: "pending_review",
  notes: "Prepared from books",
  box1aAbuDhabiAmount: 0,
  box1aAbuDhabiVat: 0,
  box1aAbuDhabiAdj: 0,
  box1bDubaiAmount: 125000,
  box1bDubaiVat: 6250,
  box1bDubaiAdj: 0,
  box1cSharjahAmount: 0,
  box1cSharjahVat: 0,
  box1cSharjahAdj: 0,
  box1dAjmanAmount: 0,
  box1dAjmanVat: 0,
  box1dAjmanAdj: 0,
  box1eUmmAlQuwainAmount: 0,
  box1eUmmAlQuwainVat: 0,
  box1eUmmAlQuwainAdj: 0,
  box1fRasAlKhaimahAmount: 0,
  box1fRasAlKhaimahVat: 0,
  box1fRasAlKhaimahAdj: 0,
  box1gFujairahAmount: 0,
  box1gFujairahVat: 0,
  box1gFujairahAdj: 0,
  box2TouristRefundAmount: 0,
  box2TouristRefundVat: 0,
  box3ReverseChargeAmount: 0,
  box3ReverseChargeVat: 0,
  box4ZeroRatedAmount: 0,
  box5ExemptAmount: 0,
  box6ImportsAmount: 0,
  box6ImportsVat: 0,
  box7ImportsAdjAmount: 0,
  box7ImportsAdjVat: 0,
  box8TotalAmount: 125000,
  box8TotalVat: 6250,
  box8TotalAdj: 0,
  box9ExpensesAmount: 42000,
  box9ExpensesVat: 2100,
  box9ExpensesAdj: 0,
  box10ReverseChargeAmount: 0,
  box10ReverseChargeVat: 0,
  box11TotalAmount: 42000,
  box11TotalVat: 2100,
  box11TotalAdj: 0,
  box12TotalDueTax: 6250,
  box13RecoverableTax: 2100,
  box14PayableTax: 4150,
  adjustmentAmount: null,
  adjustmentReason: null,
};

describe("VAT 201 export helpers", () => {
  it("builds a buyer-friendly VAT 201 workbook shape", () => {
    const sheets = prepareVat201ForExport(baseReturn, {
      name: "Pearl Trading LLC",
      nameAr: "بيرل للتجارة",
      trnVatNumber: "100000000000003",
    });

    expect(sheets).toHaveLength(2);
    expect(sheets[0].sheetName).toBe("VAT 201 Summary");
    expect(sheets[0].columns.map((col) => col.header)).toEqual([
      "Section",
      "Box",
      "Label",
      "Amount (AED)",
      "VAT (AED)",
      "Adjustment (AED)",
    ]);

    const dubaiRow = sheets[0].rows.find((row) => row.box === "1b");
    expect(dubaiRow).toMatchObject({
      label: "Standard rated supplies in Dubai",
      amount: 125000,
      vat: 6250,
    });

    const filingNotes = sheets[1].rows.reduce<Record<string, unknown>>((acc, row) => {
      acc[String(row.field)] = row.value;
      return acc;
    }, {});
    expect(filingNotes.Company).toBe("Pearl Trading LLC");
    expect(filingNotes.TRN).toBe("100000000000003");
    expect(filingNotes["Submission note"]).toContain("Support export only");
  });

  it("builds stable filenames from company and period", () => {
    expect(vat201ExportFilename(baseReturn, { name: "Pearl Trading LLC" })).toBe(
      "vat201-pearl-trading-llc-2026-06-30"
    );
  });
});
