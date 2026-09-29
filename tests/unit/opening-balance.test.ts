import { describe, expect, it } from "vitest";
import {
  buildOpeningBalanceLines,
  parseOpeningCsv,
  reconcileSubledgers,
  validateOpeningDate,
  validateOpeningGrid,
} from "../../server/services/opening-balance";

const accounts = [
  { id: "a-bank", code: "1020", nameEn: "Bank Accounts", type: "asset" },
  { id: "a-ar", code: "1040", nameEn: "Accounts Receivable", type: "asset" },
  { id: "a-ap", code: "2010", nameEn: "Accounts Payable", type: "liability" },
  { id: "a-cap", code: "3010", nameEn: "Capital", type: "equity" },
  { id: "a-rev", code: "4010", nameEn: "Sales", type: "income" },
];

const sumSide = (lines: Array<{ debit: number; credit: number }>, k: "debit" | "credit") =>
  Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;

describe("validateOpeningDate", () => {
  it("must be a real calendar date", () => {
    expect(validateOpeningDate("2026-13-01", null, "2026-09-29")).toMatchObject({ ok: false, code: "OPENING_DATE_INVALID" });
    expect(validateOpeningDate("31/12/2025", null, "2026-09-29")).toMatchObject({ ok: false });
  });
  it("cannot be in the future", () => {
    expect(validateOpeningDate("2026-10-01", null, "2026-09-29")).toMatchObject({ ok: false, code: "OPENING_DATE_IN_FUTURE" });
  });
  it("must be before the first transaction (the day before is the natural choice)", () => {
    expect(validateOpeningDate("2026-01-01", "2026-01-01", "2026-09-29")).toMatchObject({ ok: false, code: "OPENING_DATE_NOT_BEFORE_FIRST_TRANSACTION" });
    expect(validateOpeningDate("2025-12-31", "2026-01-01", "2026-09-29")).toEqual({ ok: true, date: "2025-12-31" });
    expect(validateOpeningDate("2025-06-30", "2026-01-01", "2026-09-29").ok).toBe(true);
  });
  it("with no transactions any past date is fine", () => {
    expect(validateOpeningDate("2026-01-01", null, "2026-09-29").ok).toBe(true);
  });
});

describe("validateOpeningGrid", () => {
  it("accepts balance sheet accounts, reports totals, and rounds to fils", () => {
    const r = validateOpeningGrid(
      [
        { accountCode: "1020", debit: 5000.005, credit: 0 },
        { accountCode: "1040", debit: 1000, credit: 0 },
        { accountCode: "2010", debit: 0, credit: 400 },
      ],
      accounts
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(3);
      expect(r.totalDebit).toBe(6000.01);
      expect(r.totalCredit).toBe(400);
    }
  });
  it("drops all-zero rows", () => {
    const r = validateOpeningGrid([{ accountCode: "1020", debit: 0, credit: 0 }, { accountCode: "1040", debit: 10, credit: 0 }], accounts);
    expect(r.ok && r.rows.length).toBe(1);
  });
  it("rejects unknown codes, income/expense accounts, both sides on one row, negatives, duplicates and NaN", () => {
    const r = validateOpeningGrid(
      [
        { accountCode: "9999", debit: 1, credit: 0 },
        { accountCode: "4010", debit: 1, credit: 0 },
        { accountCode: "1020", debit: 5, credit: 5 },
        { accountCode: "1040", debit: -1, credit: 0 },
        { accountCode: "2010", debit: 1, credit: 0 },
        { accountCode: "2010", debit: 2, credit: 0 },
        { accountCode: "3010", debit: Number.NaN, credit: 0 },
      ],
      accounts
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const codes = r.errors.map((e) => e.code);
      expect(codes).toEqual(expect.arrayContaining(["ACCOUNT_UNKNOWN", "ACCOUNT_NOT_BALANCE_SHEET", "BOTH_SIDES", "AMOUNT_INVALID", "ACCOUNT_DUPLICATE"]));
      expect(r.errors.find((e) => e.code === "ACCOUNT_UNKNOWN")?.row).toBe(1);
    }
  });
  it("needs at least one non-zero row", () => {
    const r = validateOpeningGrid([], accounts);
    expect(r.ok).toBe(false);
  });
});

describe("buildOpeningBalanceLines", () => {
  it("posts the difference to Opening Balance Equity so the entry balances (credit when debits exceed)", () => {
    const grid = validateOpeningGrid(
      [{ accountCode: "1020", debit: 5000, credit: 0 }, { accountCode: "1040", debit: 1000, credit: 0 }, { accountCode: "2010", debit: 0, credit: 400 }],
      accounts
    );
    if (!grid.ok) throw new Error("grid");
    const lines = buildOpeningBalanceLines(grid.rows, "OBE");
    expect(sumSide(lines, "debit")).toBe(sumSide(lines, "credit"));
    const obe = lines.find((l) => l.accountId === "OBE")!;
    expect(obe.credit).toBe(5600);
    expect(obe.debit).toBe(0);
  });
  it("debits Opening Balance Equity when credits exceed", () => {
    const grid = validateOpeningGrid([{ accountCode: "2010", debit: 0, credit: 900 }, { accountCode: "1020", debit: 100, credit: 0 }], accounts);
    if (!grid.ok) throw new Error("grid");
    const lines = buildOpeningBalanceLines(grid.rows, "OBE");
    expect(lines.find((l) => l.accountId === "OBE")).toMatchObject({ debit: 800, credit: 0 });
    expect(sumSide(lines, "debit")).toBe(sumSide(lines, "credit"));
  });
  it("a grid that already balances posts no equity line", () => {
    const grid = validateOpeningGrid([{ accountCode: "1020", debit: 100, credit: 0 }, { accountCode: "3010", debit: 0, credit: 100 }], accounts);
    if (!grid.ok) throw new Error("grid");
    const lines = buildOpeningBalanceLines(grid.rows, "OBE");
    expect(lines.some((l) => l.accountId === "OBE")).toBe(false);
  });
});

describe("reconcileSubledgers", () => {
  it("ties when open invoices equal AR and open bills equal AP", () => {
    expect(reconcileSubledgers({ arBalance: 1000, apBalance: 400, openInvoicesTotal: 1000, openBillsTotal: 400 })).toEqual({ ok: true });
  });
  it("names both figures when receivables do not tie", () => {
    const r = reconcileSubledgers({ arBalance: 1000, apBalance: 0, openInvoicesTotal: 900, openBillsTotal: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].code).toBe("AR_DOES_NOT_TIE");
      expect(r.errors[0].message).toContain("1000.00");
      expect(r.errors[0].message).toContain("900.00");
    }
  });
  it("names both figures when payables do not tie, and reports both failures together", () => {
    const r = reconcileSubledgers({ arBalance: 100, apBalance: 500, openInvoicesTotal: 50, openBillsTotal: 450 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toEqual(["AR_DOES_NOT_TIE", "AP_DOES_NOT_TIE"]);
  });
  it("without documents entered a non-zero AR / AP is fine only when no documents are entered at all", () => {
    expect(reconcileSubledgers({ arBalance: 1000, apBalance: 400, openInvoicesTotal: 0, openBillsTotal: 0, documentsEntered: false })).toEqual({ ok: true });
    expect(reconcileSubledgers({ arBalance: 1000, apBalance: 400, openInvoicesTotal: 0, openBillsTotal: 0, documentsEntered: true }).ok).toBe(false);
  });
  it("compares to the fils, not with float tolerance", () => {
    expect(reconcileSubledgers({ arBalance: 0.3, apBalance: 0, openInvoicesTotal: 0.1 + 0.2, openBillsTotal: 0 }).ok).toBe(true);
    expect(reconcileSubledgers({ arBalance: 100, apBalance: 0, openInvoicesTotal: 100.01, openBillsTotal: 0 }).ok).toBe(false);
  });
});

describe("parseOpeningCsv", () => {
  it("reads account code, debit, credit with a header row (any order of columns)", () => {
    const r = parseOpeningCsv("credit,account code,debit\n0,1020,5000\n400,2010,0\n");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { accountCode: "1020", debit: 5000, credit: 0 },
      { accountCode: "2010", debit: 0, credit: 400 },
    ]);
  });
  it("accepts thousands separators inside quotes, blanks as zero and CRLF", () => {
    const r = parseOpeningCsv('Account Code,Debit,Credit\r\n1020,"12,500.50",\r\n2010,,"1,000"\r\n');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { accountCode: "1020", debit: 12500.5, credit: 0 },
      { accountCode: "2010", debit: 0, credit: 1000 },
    ]);
  });
  it("reports line numbers for bad rows and a missing header", () => {
    const r = parseOpeningCsv("account code,debit,credit\n1020,abc,0\n,5,0\n");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
    const noHeader = parseOpeningCsv("foo,bar\n1,2\n");
    expect(noHeader.errors[0].message).toMatch(/account code/i);
  });
  it("an empty file is an error", () => {
    expect(parseOpeningCsv("").errors.length).toBe(1);
  });
});
