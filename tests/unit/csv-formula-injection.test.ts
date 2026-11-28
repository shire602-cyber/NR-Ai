// S05: every CSV export must neutralise spreadsheet formula injection (cells starting with
// = + - @ TAB CR) in user-controlled text, without disturbing numbers or safe values.
import { describe, expect, it } from "vitest";
import { csvCell, csvQuotedCell, guardFormula } from "../../shared/csv";
import { toCsv } from "../../server/reporting/http";
import { auditRowsToCsv, type AuditExportRow } from "../../server/services/audit-chain.service";
import { templateCsv, csvEscape } from "../../server/services/migration-import/mappers";
import { vat201PortalCsv } from "../../client/src/lib/vat201-export";

const EVIL = '=HYPERLINK("http://x","y")';

describe("shared csvCell", () => {
  it.each(["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\tcmd", "\rcmd"])("guards %j", (v) => {
    expect(guardFormula(v)).toBe(`'${v}`);
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("quotes the guarded formula payload and doubles inner quotes", () => {
    expect(csvCell(EVIL)).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it("leaves numbers and numeric text untouched", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("-1,234.00")).toBe(`"-1,234.00"`);
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("escapes commas, quotes and newlines and keeps safe values byte-identical", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell(new Date("2026-03-04T10:00:00Z"))).toBe("2026-03-04");
  });

  it("always-quoted variant guards and JSON-encodes objects", () => {
    expect(csvQuotedCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvQuotedCell("ok")).toBe(`"ok"`);
    expect(csvQuotedCell({ a: 1 })).toBe(`"{""a"":1}"`);
    expect(csvQuotedCell(null)).toBe("");
  });
});

describe("CSV builders use the shared guard", () => {
  it("toCsv (sendTabular exports) guards text and keeps negative numbers numeric", () => {
    const csv = toCsv({
      name: "x",
      columns: [
        { header: "Description", key: "d" },
        { header: "Amount", key: "a" },
      ],
      rows: [{ d: EVIL, a: -12.5 }],
    } as never);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")",-12.5\r\n`);
  });

  it("audit export guards free text (user agent, action) and stays always-quoted", () => {
    const row: AuditExportRow = {
      seq: 1,
      id: "i",
      createdAt: "2026-01-01T00:00:00Z",
      userId: null,
      action: "update",
      resourceType: "invoice",
      resourceId: null,
      ipAddress: null,
      userAgent: EVIL,
      before: null,
      after: { memo: "=1+1" },
      details: null,
      prevHash: null,
      hash: "h",
      legacy: false,
    };
    const csv = auditRowsToCsv([row]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain(`"{""memo"":""=1+1""}"`);
  });

  it("chart-of-accounts export/template cells are guarded (csvEscape)", () => {
    expect(csvEscape(EVIL)).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvEscape("Cash")).toBe("Cash");
    expect(templateCsv("customers")).toBe("Name,Email,Phone,TRN,Address,City,Country\n");
  });

  it("VAT 201 portal CSV guards the company TRN/notes cells", () => {
    const csv = vat201PortalCsv(
      {
        periodStart: "2026-04-01",
        periodEnd: "2026-06-30",
        dueDate: "2026-07-28",
        status: "draft",
      } as never,
      { name: "Co", trnVatNumber: "=1+1" }
    );
    expect(csv).toContain("TRN,'=1+1");
  });
});
