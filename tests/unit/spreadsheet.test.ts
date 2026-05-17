import { describe, expect, it } from "vitest";

import { buildXlsxBufferFromRows, parseSpreadsheetBuffer } from "../../server/utils/spreadsheet";

describe("spreadsheet parsing", () => {
  it("parses CSV buffers when the filename has a .csv extension", async () => {
    const parsed = await parseSpreadsheetBuffer(
      Buffer.from("name,email\nCODEX-AUDIT-CSV LLC,client@example.com\n"),
      "clients.csv"
    );

    expect(parsed.sheetName).toBe("CSV");
    expect(parsed.rows).toEqual([
      {
        name: "CODEX-AUDIT-CSV LLC",
        email: "client@example.com",
      },
    ]);
  });

  it("parses XLSX buffers when the filename has a .xlsx extension", async () => {
    const buffer = await buildXlsxBufferFromRows([{ name: "CODEX-AUDIT-XLSX LLC" }], "Clients");

    const parsed = await parseSpreadsheetBuffer(buffer, "clients.xlsx");

    expect(parsed.sheetName).toBe("Clients");
    expect(parsed.rows).toEqual([{ name: "CODEX-AUDIT-XLSX LLC" }]);
  });

  it("rejects legacy .xls files with an actionable message", async () => {
    await expect(parseSpreadsheetBuffer(Buffer.from("not-xls"), "clients.xls")).rejects.toThrow(
      /Legacy \.xls files are not supported/
    );
  });
});
