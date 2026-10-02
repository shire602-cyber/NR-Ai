import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detectStatementFormat,
  parseCamt053,
  parseMt940,
  parseOfx,
  parsePdfStatementText,
  parseStatement,
  StatementParseError,
} from "../../server/services/bank-statement-parsers";

const fx = (name: string) => readFileSync(new URL(`../integration/fixtures/bank/${name}`, import.meta.url), "utf8");
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("OFX", () => {
  it("reads SGML OFX: signed amounts, FITID, NAME + MEMO, ledger balance, account", () => {
    const s = parseOfx(fx("statement.ofx"));
    expect(s.lines).toHaveLength(3);
    expect(s.lines.map((l) => l.amount)).toEqual([-820.5, 5250, -150]);
    expect(s.lines.map((l) => l.externalId)).toEqual(["OFX001", "OFX002", "OFX003"]);
    expect(s.lines[0].description).toBe("DEWA UTILITY BILL - Aug 2026 consumption");
    expect(day(s.lines[1].date)).toBe("2026-09-02");
    expect(s.closingBalance).toBe(5279.5);
    expect(s.currency).toBe("AED");
    expect(s.accountId).toBe("AE070331234567890123456");
  });

  it("reads XML OFX with closing tags", () => {
    const xml = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AED</CURDEF><BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260105</DTPOSTED><TRNAMT>-10.5</TRNAMT><FITID>A1</FITID><NAME>Coffee &amp; Co</NAME></STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const s = parseOfx(xml);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].description).toBe("Coffee & Co");
    expect(s.lines[0].amount).toBe(-10.5);
  });

  it("refuses an entity declaration and a missing amount", () => {
    expect(() => parseOfx('<!DOCTYPE x [<!ENTITY a "b">]><OFX></OFX>')).toThrow(StatementParseError);
    expect(() => parseOfx("<OFX><STMTTRN><DTPOSTED>20260105<FITID>1</STMTTRN></OFX>")).toThrow(/TRNAMT/);
  });
});

describe("MT940", () => {
  it("reads :61:/:86:, comma decimals, D/C, balances and the account", () => {
    const s = parseMt940(fx("statement.sta"));
    expect(s.lines.map((l) => l.amount)).toEqual([-1200, 3000, -75.25]);
    expect(day(s.lines[0].date)).toBe("2026-09-10");
    expect(s.lines[0].description).toBe("Gulf Supplies LLC INV-9001 settlement");
    expect(s.lines[2].description).toBe("Monthly account fee");
    expect(s.lines[1].reference).toBe("PEARL-77");
    expect(s.openingBalance).toBe(5279.5);
    expect(s.closingBalance).toBe(7004.25);
    expect(s.currency).toBe("AED");
    expect(s.accountId).toBe("AE070331234567890123456");
  });

  it("treats RC as an outflow and RD as an inflow", () => {
    const text = [":20:X", ":25:123", ":60F:C260101AED100,00", ":61:2601020102RC10,00NTRFNONREF", ":61:2601030103RD5,50NTRFNONREF", ":62F:C260103AED95,50"].join("\n");
    expect(parseMt940(text).lines.map((l) => l.amount)).toEqual([-10, 5.5]);
  });

  it("reads several statements in one file", () => {
    const one = (n: number) => [`:20:S${n}`, ":25:123", ":60F:C260101AED0,00", `:61:260102D${n},00NTRFNONREF`, ":62F:D260102AED" + n + ",00"].join("\n");
    const s = parseMt940(one(1) + "\n" + one(2));
    expect(s.lines).toHaveLength(2);
    expect(s.warnings.join(" ")).toMatch(/2 statements/);
  });

  it("says which line is broken when the file is truncated", () => {
    try {
      parseMt940(fx("statement-truncated.sta"));
      throw new Error("expected a parse error");
    } catch (err) {
      expect(err).toBeInstanceOf(StatementParseError);
      expect((err as StatementParseError).where.line).toBe(7);
    }
  });

  it("refuses a statement with no closing balance", () => {
    const text = [":20:X", ":25:123", ":60F:C260101AED100,00", ":61:260102D10,00NTRFNONREF"].join("\n");
    expect(() => parseMt940(text)).toThrow(/closing balance/);
  });

  it("parses ?NN structured :86: information", () => {
    const text = [":20:X", ":25:123", ":60F:C260101AED100,00", ":61:260102D10,00NTRFNONREF", ":86:020?00UEBERWEISUNG?20RENT SEPTEMBER?21UNIT 4?32LANDLORD LLC", ":62F:C260102AED90,00"].join("\n");
    expect(parseMt940(text).lines[0].description).toBe("RENT SEPTEMBER UNIT 4 LANDLORD LLC");
  });
});

describe("CAMT.053", () => {
  it("reads booked entries, skips pending, joins batch details, reads balances", () => {
    const s = parseCamt053(fx("statement-camt053.xml"));
    expect(s.lines.map((l) => l.amount)).toEqual([2500, -300, -49.99]);
    expect(s.lines[0].description).toBe("Desert Logistics - Invoice 2002");
    expect(s.lines[0].reference).toBe("E2E-1");
    expect(s.lines[1].description).toBe("Office Mart - Stationery - Toner");
    expect(s.lines[2].description).toBe("Card fee");
    expect(s.openingBalance).toBe(7004.25);
    expect(s.closingBalance).toBe(9154.26);
    expect(s.accountId).toBe("AE070331234567890123456");
    expect(s.warnings.join(" ")).toMatch(/pending/);
  });

  it("names the missing tag", () => {
    try {
      parseCamt053(fx("statement-camt053-no-amt.xml"));
      throw new Error("expected a parse error");
    } catch (err) {
      expect(err).toBeInstanceOf(StatementParseError);
      expect((err as StatementParseError).where.tag).toBe("Amt");
    }
  });

  it("refuses a DOCTYPE with entities (no expansion)", () => {
    expect(() => parseCamt053(fx("statement-bomb.xml"))).toThrow(StatementParseError);
  });

  it("reverses the sign of a reversal entry", () => {
    const xml = `<Document><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="AED">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><RvslInd>true</RvslInd><Sts>BOOK</Sts><BookgDt><Dt>2026-01-05</Dt></BookgDt></Ntry></Stmt></BkToCstmrStmt></Document>`;
    expect(parseCamt053(xml).lines[0].amount).toBe(10);
  });
});

describe("detection", () => {
  it("auto-detects each format and falls back to CSV", () => {
    expect(detectStatementFormat(fx("statement.ofx"))).toBe("ofx");
    expect(detectStatementFormat(fx("statement.sta"))).toBe("mt940");
    expect(detectStatementFormat(fx("statement-camt053.xml"))).toBe("camt053");
    expect(detectStatementFormat(fx("statement-same-days.csv"))).toBe("csv");
  });

  it("parseStatement returns the format it used", () => {
    expect(parseStatement(fx("statement.ofx")).format).toBe("ofx");
    expect(parseStatement(fx("statement-same-days.csv")).format).toBe("csv");
    expect(() => parseStatement("   ")).toThrow(StatementParseError);
  });

  it("reads CSV dates as UTC midnight and the closing balance", () => {
    const s = parseStatement(fx("statement-same-days.csv"));
    expect(s.lines).toHaveLength(3);
    expect(s.lines[0].date.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(s.closingBalance).toBe(5279.5);
    expect(s.openingBalance).toBe(1000);
  });
});

describe("PDF statement text", () => {
  const text = `Statement period 01/09/2026 to 30/09/2026 Opening balance 1,000.00
    01/09/2026 01/09/2026 DEWA utility bill DEWA-9001 820.50 179.50
    02 Sep 2026 Customer payment Pearl Trading 5,250.00 5,429.50
    03-09-2026 Bank charges 150.00 5,279.50 Closing balance 5,279.50`;

  it("reads rows, signs them from the running balance and reports the balances", () => {
    const r = parsePdfStatementText([text]);
    expect(r.rows.map((x) => x.amount)).toEqual([-820.5, 5250, -150]);
    expect(r.rows[0].reference).toBe("DEWA-9001");
    expect(r.rows[0].valueDate).toBe("2026-09-01");
    expect(r.openingBalance).toBe(1000);
    expect(r.closingBalance).toBe(5279.5);
    expect(r.statementFrom).toBe("2026-09-01");
    expect(r.rows.every((x) => x.issues.length === 0)).toBe(true);
  });

  it("flags a row whose sign cannot be known", () => {
    const r = parsePdfStatementText(["05/09/2026 Mystery movement 12.00"]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].issues).toContain("sign_unknown");
  });

  it("returns no rows for text without dates and amounts", () => {
    expect(parsePdfStatementText(["scanned page without a text layer"]).rows).toEqual([]);
  });

  it("uses CR/DR and parentheses when there is no balance column", () => {
    const r = parsePdfStatementText(["01/09/2026 Salary 5,000.00 CR 02/09/2026 Rent 2,000.00 DR 03/09/2026 Refund (45.00)"]);
    expect(r.rows.map((x) => x.amount)).toEqual([5000, -2000, -45]);
  });

  it("fix 4: a date written right before the opening balance is not a transaction row", () => {
    const r = parsePdfStatementText(["01/09/2026 Opening balance 1,000.00 02/09/2026 Coffee 100.00 900.00"]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].date).toBe("2026-09-02");
    expect(r.openingBalance).toBe(1000);
  });

  it("fix 4: two dates on different lines are two rows, not a booking/value pair", () => {
    const r = parsePdfStatementText(["01/09/2026\n02/09/2026 Coffee 100.00 900.00"]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].date).toBe("2026-09-02");
    expect(r.rows[0].valueDate).toBeNull();
  });
});
