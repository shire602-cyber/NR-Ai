import { describe, expect, it } from "vitest";
import { looksBinary } from "../../server/services/bank-statement-parser.service";
import { parseStatementCsv } from "../../server/services/bank-import.service";

const csv = "Date,Description,Amount\n2026-03-10,Stationery,-12.50\n2026-03-11,Deposit,100.00\n";
const pad = (head: number[], len = 200) =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(len, 0x41)]);

describe("looksBinary content sniff", () => {
  it.each([
    ["PDF", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")],
    ["PNG", pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["JPEG", pad([0xff, 0xd8, 0xff, 0xe0])],
    ["GIF", Buffer.from("GIF89a" + "x".repeat(50))],
    ["OLE xls", pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ["NUL bytes", Buffer.from("Date,Description\n2026-03-10,Sta\0tionery\n")],
    ["control-char noise", Buffer.from(Array.from({ length: 300 }, (_, i) => (i % 5) + 1))],
  ])("flags %s", (_n, bytes) => {
    expect(looksBinary(bytes)).toBe(true);
  });

  it.each([
    ["plain CSV", Buffer.from(csv)],
    ["UTF-8 BOM CSV", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv)])],
    ["Arabic UTF-8 CSV", Buffer.from("التاريخ,الوصف,المبلغ\n2026-03-10,قرطاسية,-12.50\n", "utf8")],
    ["UTF-16LE BOM CSV", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, "utf16le")])],
    ["UTF-16LE no BOM CSV", Buffer.from(csv, "utf16le")],
    ["Latin-1 CSV", Buffer.from("Date,Description,Amount\n2026-03-10,Caf\xe9,-4.00\n", "latin1")],
    [
      "Windows-1256 bytes",
      Buffer.from([0xc7, 0xe1, 0xca, 0xc7, 0xd1, 0xed, 0xce, 0x2c, 0x31, 0x32, 0x2e, 0x35, 0x0a]),
    ],
    ["empty", Buffer.alloc(0)],
  ])("accepts %s", (_n, bytes) => {
    expect(looksBinary(bytes)).toBe(false);
  });
});

describe("parseStatementCsv refuses binary uploads", () => {
  it.each([
    ["PDF", Buffer.from("%PDF-1.7\n" + "x".repeat(100))],
    ["PNG", pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["JPEG", pad([0xff, 0xd8, 0xff, 0xe0])],
    ["non-xlsx ZIP", pad([0x50, 0x4b, 0x03, 0x04])],
  ])("rejects %s with STATEMENT_CSV_REQUIRED (400)", (_n, bytes) => {
    expect(() => parseStatementCsv(bytes)).toThrow(
      expect.objectContaining({ code: "STATEMENT_CSV_REQUIRED", statusCode: 400 })
    );
  });

  it("still parses a UTF-16 BOM CSV", () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, "utf16le")]);
    expect(parseStatementCsv(bytes).rows).toHaveLength(2);
  });
});
