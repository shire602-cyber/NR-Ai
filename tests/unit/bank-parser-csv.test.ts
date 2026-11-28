import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeStatementBytes,
  parseAmountCell,
  parseBankStatement,
  parseStatementDate,
  type BankParseResult,
  type ParsedBankRow,
} from "../../server/services/bank-statement-parser.service";

const fixture = (name: string): Buffer =>
  readFileSync(join(process.cwd(), "tests/fixtures/bank-statements", name));

const iso = (row: ParsedBankRow) => row.date?.toISOString().slice(0, 10) ?? null;

const summary = (result: BankParseResult) =>
  result.rows.map((r) => ({
    line: r.rowIndex,
    date: iso(r),
    description: r.description,
    debit: r.debit,
    credit: r.credit,
    balance: r.balance,
    reference: r.reference,
    errors: r.errors,
  }));

const warningCodes = (result: BankParseResult) => result.warnings.map((w) => w.code);

describe("bank statement parser: CSV fixtures", () => {
  it("R06-07 ADCB export (Txn Date / Value Date / Particulars) parses row by row", async () => {
    const result = await parseBankStatement(fixture("adcb.csv"));
    expect(result.format).toBe("adcb");
    expect(summary(result)).toEqual([
      {
        line: 2,
        date: "2026-11-03",
        description: "POS PURCHASE CARREFOUR DUBAI",
        debit: 125.5,
        credit: 0,
        balance: 9874.5,
        reference: null,
        errors: [],
      },
      {
        line: 3,
        date: "2026-11-04",
        description: "SALARY TRANSFER ACME LLC",
        debit: 0,
        credit: 15000,
        balance: 24874.5,
        reference: null,
        errors: [],
      },
      {
        line: 4,
        date: "2026-11-15",
        description: "DEWA UTILITY PAYMENT",
        debit: 1320.75,
        credit: 0,
        balance: 23553.75,
        reference: null,
        errors: [],
      },
    ]);
    // Txn Date (not Value Date) is the posting date.
    expect(result.mapping.date).toBe(0);
    expect(result.dateOrder).toBe("DMY");
  });

  it("R06-08 single Amount + Dr/Cr column works for a named bank format", async () => {
    const result = await parseBankStatement(fixture("enbd_amt.csv"));
    expect(result.format).toBe("emiratesnbd");
    expect(summary(result).map((r) => [r.date, r.description, r.debit, r.credit])).toEqual([
      ["2026-11-03", "ATM WITHDRAWAL MARINA", 500, 0],
      ["2026-11-04", "CUSTOMER RECEIPT PEARL TRADING", 0, 5250],
      ["2026-11-17", "BANK CHARGES", 52.5, 0],
    ]);
    expect(result.rows.map((r) => r.amount)).toEqual([-500, 5250, -52.5]);
    expect(result.rows.every((r) => r.errors.length === 0)).toBe(true);
  });

  it("R06-09 statement preamble (account, IBAN, period lines) is skipped", async () => {
    const result = await parseBankStatement(fixture("preamble.csv"));
    expect(result.headerRowIndex).toBe(6);
    expect(warningCodes(result)).toContain("PREAMBLE_SKIPPED");
    expect(summary(result)).toEqual([
      {
        line: 7,
        date: "2026-11-03",
        description: "OFFICE RENT NOVEMBER",
        debit: 12500,
        credit: 0,
        balance: 87500,
        reference: null,
        errors: [],
      },
      {
        line: 8,
        date: "2026-11-18",
        description: "CLIENT SETTLEMENT",
        debit: 0,
        credit: 8400,
        balance: 95900,
        reference: null,
        errors: [],
      },
    ]);
  });

  it("R06-10 semicolon file with decimal commas reads '10,50' as 10.50 and says so", async () => {
    const result = await parseBankStatement(fixture("semi.csv"));
    expect(result.delimiter).toBe(";");
    expect(result.decimalSeparator).toBe(",");
    expect(warningCodes(result)).toContain("DECIMAL_SEPARATOR_INFERRED");
    expect(summary(result).map((r) => [r.date, r.debit, r.credit, r.balance])).toEqual([
      ["2026-11-03", 10.5, 0, 990],
      ["2026-11-04", 0, 1250.75, 2240.75],
    ]);
  });

  it("R06-10 an explicit decimal separator overrides detection and ambiguous '1,234' warns", async () => {
    const text =
      'Date,Description,Amount,Type\n15/06/2026,Rent,"1,234",Debit\n16/06/2026,Fee,"5,000",Debit\n';
    const guessed = await parseBankStatement(text);
    expect(guessed.warnings.find((w) => w.code === "AMBIGUOUS_DECIMAL")?.requiresChoice).toBe(true);
    expect(guessed.rows.map((r) => r.debit)).toEqual([1234, 5000]);
    const european = await parseBankStatement(text, { decimalSeparator: "," });
    expect(european.warnings.some((w) => w.code === "AMBIGUOUS_DECIMAL")).toBe(false);
    expect(european.rows.map((r) => r.debit)).toEqual([1.23, 5]);
  });

  it("R06-11 US-style dates are detected from the data, never wrapped by JS Date overflow", async () => {
    const result = await parseBankStatement(fixture("usdate.csv"));
    expect(result.dateOrder).toBe("MDY");
    expect(warningCodes(result)).toContain("DATE_ORDER_DETECTED");
    expect(summary(result).map((r) => [r.date, r.debit, r.credit, r.errors])).toEqual([
      ["2026-11-13", 200, 0, []],
      ["2026-11-05", 0, 300, []],
    ]);
  });

  it("R06-11 11/13/2026 under a declared DD/MM order is a row error, not 2027-01-11", async () => {
    const result = await parseBankStatement(fixture("usdate.csv"), { dateOrder: "DMY" });
    const [first, second] = result.rows;
    expect(first.date).toBeNull();
    expect(first.errors).toEqual(["Invalid date '11/13/2026' for DD/MM/YYYY"]);
    expect(iso(second)).toBe("2026-05-11");
    expect(parseStatementDate("11/13/2026", "DMY").date).toBeNull();
    expect(parseStatementDate("31/02/2026", "DMY").error).toContain("Invalid date");
    expect(iso({ date: parseStatementDate("29/02/2028", "DMY").date } as ParsedBankRow)).toBe(
      "2028-02-29"
    );
  });

  it("R06-11 all-ambiguous dates default to DD/MM and require a user choice", async () => {
    const result = await parseBankStatement(fixture("coffee.csv"));
    const warning = result.warnings.find((w) => w.code === "AMBIGUOUS_DATE_ORDER");
    expect(warning?.requiresChoice).toBe(true);
    expect(warning?.options).toEqual(["DMY", "MDY"]);
    expect(result.dateOrder).toBe("DMY");
    const us = await parseBankStatement(fixture("coffee.csv"), { dateOrder: "MDY" });
    expect(us.warnings.some((w) => w.code === "AMBIGUOUS_DATE_ORDER")).toBe(false);
    expect(iso(us.rows[0])).toBe("2026-03-11");
  });

  it("R06-06 two identical coffee rows in one file are both parsed with their own row index", async () => {
    const result = await parseBankStatement(fixture("coffee.csv"));
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.rowIndex)).toEqual([2, 3, 4]);
    expect(result.rows[0].description).toBe("COFFEE SHOP");
    expect(result.rows[1].description).toBe("COFFEE SHOP");
    expect(result.rows[0].raw).toBe("03/11/2026,COFFEE SHOP,25.00,,975.00");
  });

  it("R06-23 Arabic headers and Arabic-Indic digits parse", async () => {
    const result = await parseBankStatement(fixture("arabic-headers.csv"));
    expect(result.dateOrder).toBe("DMY");
    expect(summary(result)).toEqual([
      {
        line: 2,
        date: "2026-06-01",
        description: "فاتورة ديوا",
        debit: 820.5,
        credit: 0,
        balance: 4179.5,
        reference: "DEWA-9",
        errors: [],
      },
      {
        line: 3,
        date: "2026-06-15",
        description: "دفعة عميل",
        debit: 0,
        credit: 5250,
        balance: 9429.5,
        reference: "RCPT-77",
        errors: [],
      },
    ]);
  });

  it("R06-23 BOM and quoted commas/quotes are handled", async () => {
    const result = await parseBankStatement(fixture("bom-quoted.csv"));
    expect(result.headers[0]).toBe("Date");
    expect(summary(result)).toEqual([
      {
        line: 2,
        date: "2026-11-03",
        description: "ACME, TRADING LLC - invoice 1,200",
        debit: 0,
        credit: 1200,
        balance: null,
        reference: "REF,001",
        errors: [],
      },
      {
        line: 3,
        date: "2026-11-04",
        description: 'Payment "special" order',
        debit: 75.25,
        credit: 0,
        balance: null,
        reference: null,
        errors: [],
      },
    ]);
  });

  it("R06-09 header is the first row matching two known tokens, in English or Arabic", async () => {
    const text = [
      "كشف حساب,شركة النجمة",
      "الفترة,يونيو 2026",
      "تاريخ,البيان,مدين,دائن",
      "15/06/2026,تحويل,100.00,",
    ].join("\n");
    const result = await parseBankStatement(text);
    expect(result.headerRowIndex).toBe(3);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].debit).toBe(100);
  });

  it("R06-09 CRLF files, summary rows and repeated headers do not produce bad rows", async () => {
    const text = [
      "Date,Description,Debit,Credit,Balance",
      "15/06/2026,Rent,500.00,,1000.00",
      "Date,Description,Debit,Credit,Balance",
      ",Closing balance,,,500.00",
      "16/06/2026,Refund,,20.00,520.00",
      "",
    ].join("\r\n");
    const result = await parseBankStatement(text);
    expect(result.rows.map((r) => r.description)).toEqual(["Rent", "Refund"]);
    expect(result.ignored.map((r) => r.reason)).toEqual(["no date or amount"]);
  });

  it("R06-11 rows with an amount but a bad date or bad amount become row errors", async () => {
    const text = [
      "Date,Description,Debit,Credit",
      "99/99/2026,Broken date,10.00,",
      "15/06/2026,Broken amount,abc,",
      "15/06/2026,Fine,5.00,",
    ].join("\n");
    const result = await parseBankStatement(text);
    expect(result.rows[0].errors[0]).toContain("Invalid date '99/99/2026'");
    expect(result.rows[1].errors[0]).toContain("Invalid debit amount 'abc'");
    expect(result.rows[2].errors).toEqual([]);
  });

  it("R06-23 a user-supplied column mapping overrides auto-detection", async () => {
    const text = "When,What,Out,In\n15/06/2026,Taxi,30.00,\n16/06/2026,Refund,,12.00\n";
    const auto = await parseBankStatement(text);
    expect(auto.warnings.some((w) => w.code === "HEADER_NOT_FOUND")).toBe(true);
    const mapped = await parseBankStatement(text, {
      mapping: { date: 0, description: 1, debit: 2, credit: 3 },
      headerRow: 1,
    });
    expect(mapped.rows.map((r) => [iso(r), r.description, r.debit, r.credit])).toEqual([
      ["2026-06-15", "Taxi", 30, 0],
      ["2026-06-16", "Refund", 0, 12],
    ]);
  });

  it("R06-08 every bank profile accepts Amount + Dr/Cr (Mashreq, FAB, RAKBANK, CBD, Wio)", async () => {
    const headers: Array<[string, string]> = [
      ["mashreq", "Posting Date,Transaction Details,Amount,Dr/Cr"],
      ["fab", "Trans Date,Description,Amount,Dr/Cr"],
      ["rakbank", "Date,Narrative,Amount,Dr/Cr"],
      ["cbd", "Booking Date,Description,Amount,Dr/Cr"],
      ["wio", "Date,Counterparty,Amount,Dr/Cr"],
    ];
    for (const [format, header] of headers) {
      const result = await parseBankStatement(
        `${header}\n15/06/2026,Shop,12.50,Dr\n16/06/2026,Client,40.00,Cr\n`
      );
      expect(result.format).toBe(format);
      expect(result.rows.map((r) => [r.debit, r.credit, r.errors.length])).toEqual([
        [12.5, 0, 0],
        [0, 40, 0],
      ]);
    }
  });

  it("R06-23 UTF-16LE and Windows-1256 files decode", async () => {
    const csv = "Date,Description,Debit,Credit\n15/06/2026,دفعة,10.00,\n";
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, "utf16le")]);
    const r1 = await parseBankStatement(utf16);
    expect(r1.rows[0].description).toBe("دفعة");
    const cp1256 = Buffer.from([
      ...Buffer.from("Date,Description,Debit,Credit\n15/06/2026,", "latin1"),
      0xcf,
      0xe3,
      0xda,
      0xc9, // دفعة in windows-1256
      ...Buffer.from(",10.00,\n", "latin1"),
    ]);
    expect(decodeStatementBytes(cp1256)).toContain("دمعة");
    const r2 = await parseBankStatement(cp1256);
    expect(r2.rows).toHaveLength(1);
    expect(r2.rows[0].errors).toEqual([]);
  });

  it("R06-10 amount cells: parentheses, trailing Dr/Cr, minus, currency, Arabic digits", () => {
    expect(parseAmountCell("(12,500.00)", ".")).toMatchObject({ value: 12500, direction: "debit" });
    expect(parseAmountCell("8,400.00 Cr", ".")).toMatchObject({ value: 8400, direction: "credit" });
    expect(parseAmountCell("-52.50", ".")).toMatchObject({ value: 52.5, direction: "debit" });
    expect(parseAmountCell("AED 1,000.00", ".").value).toBe(1000);
    expect(parseAmountCell("١٢٣٫٤٥", ".").value).toBe(123.45);
    expect(parseAmountCell("1.234,56", ",").value).toBe(1234.56);
    expect(parseAmountCell("1'234.50", ".").value).toBe(1234.5);
    expect(parseAmountCell("abc", ".").ok).toBe(false);
    expect(parseAmountCell("", ".").empty).toBe(true);
  });

  it("R06-06 fileFingerprint is the sha256 of the file bytes and stable across re-reads", async () => {
    const a = await parseBankStatement(fixture("adcb.csv"));
    const b = await parseBankStatement(fixture("adcb.csv"));
    const c = await parseBankStatement(fixture("coffee.csv"));
    expect(a.fileFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fileFingerprint).toBe(b.fileFingerprint);
    expect(a.fileFingerprint).not.toBe(c.fileFingerprint);
  });
});
