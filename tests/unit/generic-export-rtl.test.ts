import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildGenericWorkbook } from "../../server/services/excel-export.service";

const read = async (rtl: boolean | undefined) => {
  const buffer = await buildGenericWorkbook([
    { sheetName: "S", rtl, columns: [{ header: "A", key: "a" }], rows: [{ a: "x" }] },
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  return wb.worksheets[0];
};

describe("STEP1 F5: generic Excel export honours right-to-left sheets", () => {
  it("sets rightToLeft for an Arabic sheet and leaves English sheets left-to-right", async () => {
    expect((await read(true)).views[0]?.rightToLeft).toBe(true);
    expect((await read(undefined)).views[0]?.rightToLeft).toBeFalsy();
  });
});
