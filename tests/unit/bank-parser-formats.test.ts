import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  bankRowKey,
  importSourceFor,
  parseBankStatement,
  planBankImport,
  toLegacyTransactions,
  type ExistingBankRow,
  type ParsedBankRow,
} from "../../server/services/bank-statement-parser.service";

const fixture = (name: string): Buffer =>
  readFileSync(join(process.cwd(), "tests/fixtures/bank-statements", name));

const iso = (row: ParsedBankRow) => row.date?.toISOString().slice(0, 10) ?? null;

describe("bank statement parser: MT940 / CAMT.053 / OFX / XLSX", () => {
  it("R06-23 MT940 statement lines and :86: narratives parse", async () => {
    const result = await parseBankStatement(fixture("statement.sta"));
    expect(result.kind).toBe("mt940");
    expect(result.accountHint).toBe("AE070331234567890123456");
    expect(result.currency).toBe("AED");
    expect(
      result.rows.map((r) => [
        r.rowIndex,
        iso(r),
        r.description,
        r.debit,
        r.credit,
        r.reference,
        r.errors,
      ])
    ).toEqual([
      [1, "2026-11-03", "POS CARREFOUR DUBAI MALL", 125.5, 0, "INV-1001", []],
      [2, "2026-11-04", "SALARY ACME LLC", 0, 15000, "BANKREF2", []],
    ]);
  });

  it("R06-23 MT940 reversal marks (RC/RD) flip the direction and bad :61: lines are row errors", async () => {
    const text = [
      ":20:X",
      ":25:123",
      ":61:2611030103RD10,00NTRFREV1",
      ":86:Reversal of debit",
      ":61:garbage",
      ":86:bad",
    ].join("\n");
    const result = await parseBankStatement(text, { kind: "mt940" });
    expect(result.rows[0]).toMatchObject({ credit: 10, debit: 0, amount: 10 });
    expect(result.rows[1].errors[0]).toContain("Unreadable :61:");
  });

  it("R06-23 CAMT.053 entries parse with XML unescaping and multi-line remittance", async () => {
    const result = await parseBankStatement(fixture("camt053.xml"));
    expect(result.kind).toBe("camt053");
    expect(result.accountHint).toBe("AE070331234567890123456");
    expect(result.currency).toBe("AED");
    expect(
      result.rows.map((r) => [
        r.rowIndex,
        iso(r),
        r.description,
        r.debit,
        r.credit,
        r.reference,
        r.errors,
      ])
    ).toEqual([
      [1, "2026-11-03", "POS PURCHASE & CO", 125.5, 0, "SVC-1", []],
      [2, "2026-11-04", "SALARY ACME LLC", 0, 15000, null, []],
    ]);
  });

  it("R06-23 OFX/QFX (SGML) transactions parse", async () => {
    const result = await parseBankStatement(fixture("statement.ofx"));
    expect(result.kind).toBe("ofx");
    expect(result.currency).toBe("AED");
    expect(result.accountHint).toBe("1234567890");
    expect(
      result.rows.map((r) => [iso(r), r.description, r.debit, r.credit, r.reference, r.errors])
    ).toEqual([
      ["2026-11-03", "POS CARREFOUR - DUBAI MALL", 125.5, 0, "FIT-1", []],
      ["2026-11-04", "SALARY ACME LLC", 0, 15000, "FIT-2", []],
    ]);
  });

  it("R06-23 XLSX statements parse through the same column mapper (Excel dates and numbers)", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Statement");
    sheet.addRow(["Account", "NAJMA TRADING LLC"]);
    sheet.addRow([]);
    sheet.addRow(["Txn Date", "Value Date", "Particulars", "Debit", "Credit", "Balance"]);
    sheet.addRow([
      new Date(Date.UTC(2026, 10, 3)),
      new Date(Date.UTC(2026, 10, 3)),
      "RENT",
      12500,
      null,
      87500,
    ]);
    sheet.addRow([
      new Date(Date.UTC(2026, 10, 18)),
      new Date(Date.UTC(2026, 10, 18)),
      "CLIENT PAYMENT",
      null,
      8400.5,
      95900.5,
    ]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await parseBankStatement(bytes);
    expect(result.kind).toBe("xlsx");
    expect(result.format).toBe("adcb");
    expect(result.headerRowIndex).toBe(3);
    expect(
      result.rows.map((r) => [r.rowIndex, iso(r), r.description, r.debit, r.credit, r.balance])
    ).toEqual([
      [4, "2026-11-03", "RENT", 12500, 0, 87500],
      [5, "2026-11-18", "CLIENT PAYMENT", 0, 8400.5, 95900.5],
    ]);
    expect(result.fileFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("R06-23 file kind is detected from content, not extension", async () => {
    expect((await parseBankStatement(fixture("adcb.csv"))).kind).toBe("csv");
    expect((await parseBankStatement(fixture("statement.sta"))).kind).toBe("mt940");
    expect((await parseBankStatement(fixture("camt053.xml"))).kind).toBe("camt053");
    expect((await parseBankStatement(fixture("statement.ofx"))).kind).toBe("ofx");
  });
});

describe("bank statement import planning (dedupe)", () => {
  const toExisting = (rows: ParsedBankRow[], marker?: string): ExistingBankRow[] =>
    rows.map((r) => ({
      date: r.date as Date,
      amount: r.amount,
      description: r.description,
      reference: r.reference,
      importSource: marker ?? "csv",
    }));

  it("R06-06 two identical same-day rows in one statement both import", async () => {
    const parsed = await parseBankStatement(fixture("coffee.csv"));
    const plan = planBankImport(parsed.rows, [], {
      fileFingerprint: parsed.fileFingerprint,
      kind: parsed.kind,
    });
    expect(plan.toInsert).toHaveLength(3);
    expect(plan.toInsert.filter((r) => r.description === "COFFEE SHOP")).toHaveLength(2);
    expect(plan.skipped).toEqual([]);
  });

  it("R06-06 re-importing the same file is idempotent and reports why rows were skipped", async () => {
    const parsed = await parseBankStatement(fixture("coffee.csv"));
    const first = planBankImport(parsed.rows, [], {
      fileFingerprint: parsed.fileFingerprint,
      kind: parsed.kind,
    });
    const marker = importSourceFor(parsed.kind, parsed.fileFingerprint);
    const again = planBankImport(parsed.rows, toExisting(first.toInsert, marker), {
      fileFingerprint: parsed.fileFingerprint,
      kind: parsed.kind,
    });
    expect(again.fileAlreadyImported).toBe(true);
    expect(again.toInsert).toEqual([]);
    expect(again.skipped.map((s) => [s.rowIndex, s.reason])).toEqual([
      [2, "file_already_imported"],
      [3, "file_already_imported"],
      [4, "file_already_imported"],
    ]);
  });

  it("R06-06 an overlapping statement only adds rows the account does not have", async () => {
    const parsed = await parseBankStatement(fixture("coffee.csv"));
    // Existing account already holds one of the two identical coffee rows (e.g. from another file).
    const existing = toExisting([parsed.rows[0]], "csv:otherfile00000000");
    const plan = planBankImport(parsed.rows, existing, {
      fileFingerprint: parsed.fileFingerprint,
      kind: parsed.kind,
    });
    expect(plan.fileAlreadyImported).toBe(false);
    expect(plan.toInsert.map((r) => r.rowIndex)).toEqual([3, 4]);
    expect(plan.skipped).toMatchObject([{ rowIndex: 2, reason: "already_imported" }]);
  });

  it("R06-06 rows differing only by description are not collapsed", async () => {
    const text =
      "Date,Description,Debit,Credit\n15/06/2026,SHOP A,25.00,\n15/06/2026,SHOP B,25.00,\n";
    const parsed = await parseBankStatement(text);
    expect(
      bankRowKey({
        date: parsed.rows[0].date as Date,
        amount: -25,
        description: "SHOP A",
        reference: null,
      })
    ).not.toBe(
      bankRowKey({
        date: parsed.rows[1].date as Date,
        amount: -25,
        description: "SHOP B",
        reference: null,
      })
    );
    const plan = planBankImport(parsed.rows, [], {
      fileFingerprint: parsed.fileFingerprint,
      kind: "csv",
    });
    expect(plan.toInsert).toHaveLength(2);
  });

  it("R06-06 the user override imports duplicates anyway", async () => {
    const parsed = await parseBankStatement(fixture("coffee.csv"));
    const existing = toExisting(parsed.rows);
    const plan = planBankImport(parsed.rows, existing, {
      fileFingerprint: parsed.fileFingerprint,
      kind: parsed.kind,
      allowDuplicates: true,
    });
    expect(plan.toInsert).toHaveLength(3);
  });

  it("R06-06 invalid rows are skipped with their error, valid rows still import", async () => {
    const text = "Date,Description,Debit,Credit\n99/99/2026,Broken,10.00,\n15/06/2026,Fine,5.00,\n";
    const parsed = await parseBankStatement(text);
    const plan = planBankImport(parsed.rows, [], {
      fileFingerprint: parsed.fileFingerprint,
      kind: "csv",
    });
    expect(plan.toInsert.map((r) => r.description)).toEqual(["Fine"]);
    expect(plan.skipped).toMatchObject([{ rowIndex: 2, reason: "invalid_row" }]);
    expect(plan.skipped[0].detail).toContain("Invalid date");
  });

  it("R06-06 legacy summary keeps old error text for callers of parseBankCsv", async () => {
    const parsed = await parseBankStatement(
      "Date,Description,Debit,Credit\n99/99/2026,Broken,10.00,\n"
    );
    expect(toLegacyTransactions(parsed).errors[0]).toMatch(/^Row 2: Invalid date/);
  });
});
