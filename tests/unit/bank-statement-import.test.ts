import { describe, expect, it } from "vitest";
import { parseBankCsv } from "../../server/routes/bank-statements.routes";

describe("bank statement CSV import", () => {
  it("parses Arabic UAE statement headers and Arabic-Indic amounts", () => {
    const result = parseBankCsv(
      [
        "تاريخ,البيان,مدين,دائن,الرصيد,مرجع",
        "٠١/٠٦/٢٠٢٦,فاتورة ديوا,٨٢٠٫٥٠,,٤١٧٩٫٥٠,DEWA-9",
        "٠٢/٠٦/٢٠٢٦,دفعة عميل,,٥٢٥٠٫٠٠,٩٤٢٩٫٥٠,RCPT-77",
      ].join("\n")
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      description: "فاتورة ديوا",
      debit: 820.5,
      credit: 0,
      balance: 4179.5,
      reference: "DEWA-9",
    });
    expect(result.transactions[1]).toMatchObject({
      description: "دفعة عميل",
      debit: 0,
      credit: 5250,
      balance: 9429.5,
      reference: "RCPT-77",
    });
  });

  it("respects positive amount columns paired with Dr/Cr direction values", () => {
    const result = parseBankCsv(
      [
        "Date,Description,Amount,Type,Balance,Reference",
        "2026-06-01,DEWA utility bill,820.50,Debit,4179.50,DEWA-9",
        "2026-06-02,Customer payment Pearl Trading,5250.00,CR,9429.50,RCPT-77",
      ].join("\r\n")
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      description: "DEWA utility bill",
      debit: 820.5,
      credit: 0,
      balance: 4179.5,
    });
    expect(result.transactions[1]).toMatchObject({
      description: "Customer payment Pearl Trading",
      debit: 0,
      credit: 5250,
      balance: 9429.5,
    });
  });

  it("accepts semicolon-delimited Excel exports and signed debit/credit cells", () => {
    const result = parseBankCsv(
      [
        "Date;Description;Debit;Credit;Balance;Reference",
        "01-06-2026;Office rent;(12,500.00);;87,500.00;RENT-6",
        "02-06-2026;Client settlement;;8,400.00 Cr;95,900.00;RCPT-88",
      ].join("\n")
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      description: "Office rent",
      debit: 12500,
      credit: 0,
      balance: 87500,
      reference: "RENT-6",
    });
    expect(result.transactions[1]).toMatchObject({
      description: "Client settlement",
      debit: 0,
      credit: 8400,
      balance: 95900,
      reference: "RCPT-88",
    });
  });

  it("accepts tab-delimited generic statements from spreadsheet exports", () => {
    const result = parseBankCsv(
      [
        "Date\tDescription\tAmount\tType\tBalance\tReference",
        "2026-06-03\tPayment processor payout\t3190.75\tCredit\t99090.75\tSTRIPE-1",
        "2026-06-04\tBank charges\t52.50\tDr\t99038.25\tFEE-1",
      ].join("\n")
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      description: "Payment processor payout",
      debit: 0,
      credit: 3190.75,
      balance: 99090.75,
    });
    expect(result.transactions[1]).toMatchObject({
      description: "Bank charges",
      debit: 52.5,
      credit: 0,
      balance: 99038.25,
    });
  });

  it("strips a UTF-8 BOM from the first header field", () => {
    const result = parseBankCsv(
      ["﻿Date,Description,Debit,Credit,Balance", "2026-06-01,Salary,,5000.00,5000.00"].join(
        "\n"
      )
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ credit: 5000, debit: 0 });
  });

  it("counts rows skipped for zero amount in skippedRows; invalid-date rows surface as errors", () => {
    // Row 2: invalid date string → parse error (surfaces in errors, not skippedRows)
    // Row 3: valid transaction → imported
    // Row 4: zero amount balance row → ignored (counted in skippedRows)
    const result = parseBankCsv(
      [
        "Date,Description,Debit,Credit,Balance",
        "not-a-date,Opening balance,0,0,10000",
        "2026-06-01,Utility bill,820.50,,9179.50",
        "2026-06-01,Balance carried forward,0,0,9179.50",
      ].join("\n")
    );
    expect(result.transactions).toHaveLength(1);
    // The zero-amount balance row is silently ignored → skippedRows = 1
    expect(result.skippedRows).toBe(1);
    // The invalid-date row is an error row, not a skipped row (it's visible in errors)
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns skippedRows: 0 for a fully-valid file", () => {
    const result = parseBankCsv(
      [
        "Date,Description,Debit,Credit,Balance",
        "2026-06-01,Utility bill,820.50,,9179.50",
        "2026-06-02,Client payment,,5000.00,14179.50",
      ].join("\n")
    );
    expect(result.errors).toEqual([]);
    expect(result.skippedRows).toBe(0);
  });
});
