import { describe, expect, it } from "vitest";
import { parseBankCsv } from "../../server/routes/bank-statements.routes";

describe("bank statement CSV import", () => {
  it("parses Arabic UAE statement headers and Arabic-Indic amounts", () => {
    const result = parseBankCsv(
      [
        "تاريخ,البيان,مدين,دائن,الرصيد,مرجع",
        "01/06/2026,فاتورة ديوا,٨٢٠٫٥٠,,٤١٧٩٫٥٠,DEWA-9",
        "02/06/2026,دفعة عميل,,٥٢٥٠٫٠٠,٩٤٢٩٫٥٠,RCPT-77",
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
});
