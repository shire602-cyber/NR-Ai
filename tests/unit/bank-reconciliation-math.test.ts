import { describe, expect, it } from "vitest";
import { computeStatementMath, reconciliationStatementCsv } from "../../server/services/bank-reconciliation-math";

const ledger = (amount: number, id = "e" + amount) => ({ entryId: id, entryNumber: "JE-" + id, date: "2026-09-10", memo: null, source: "payment", sourceId: null, amount });
const bank = (amount: number, id = "t" + amount) => ({ transactionId: id, date: "2026-09-12", description: "x", reference: null, amount });
const base = { bankAccountId: "b1", asOf: "2026-09-30", currency: "AED", statementBalanceSource: "param" as const };

describe("bank reconciliation math", () => {
  it("a clean reconciliation has difference 0", () => {
    const s = computeStatementMath({ ...base, statementBalance: 5000, ledgerBalance: 5000, bankItems: [], ledgerItems: [] });
    expect(s.difference).toBe(0);
    expect(s.adjustedStatementBalance).toBe(5000);
  });

  it("deposits in transit and outstanding payments adjust the statement side", () => {
    // statement 4,800; ledger has a 700 deposit not yet banked and a 200 cheque not yet presented: ledger = 4,800 + 700 - 200
    const s = computeStatementMath({ ...base, statementBalance: 4800, ledgerBalance: 5300, bankItems: [], ledgerItems: [ledger(700), ledger(-200)] });
    expect(s.depositsInTransit).toBe(700);
    expect(s.outstandingPayments).toBe(200);
    expect(s.adjustedStatementBalance).toBe(5300);
    expect(s.difference).toBe(0);
  });

  it("statement lines the books lack adjust the ledger side", () => {
    // statement has a 50 fee and a 120 receipt the ledger has not seen: ledger = statement + 50 - 120
    const s = computeStatementMath({ ...base, statementBalance: 1070, ledgerBalance: 1000, bankItems: [bank(120), bank(-50)], ledgerItems: [] });
    expect(s.unreconciledCredits).toBe(120);
    expect(s.unreconciledDebits).toBe(50);
    expect(s.adjustedLedgerBalance).toBe(1070);
    expect(s.difference).toBe(0);
  });

  it("all four kinds together still balance", () => {
    const s = computeStatementMath({ ...base, statementBalance: 9000 - 50 + 120, ledgerBalance: 9000 + 700 - 200, bankItems: [bank(120), bank(-50)], ledgerItems: [ledger(700), ledger(-200)] });
    expect(s.difference).toBe(0);
  });

  it("an unexplained amount shows as a difference; no statement balance gives null", () => {
    expect(computeStatementMath({ ...base, statementBalance: 1000, ledgerBalance: 900, bankItems: [], ledgerItems: [] }).difference).toBe(100);
    const none = computeStatementMath({ ...base, statementBalance: null, statementBalanceSource: null, ledgerBalance: 900, bankItems: [], ledgerItems: [] });
    expect(none.difference).toBeNull();
  });

  it("CSV carries a BOM, the totals and neutralises formulas", () => {
    const s = computeStatementMath({ ...base, statementBalance: 100, ledgerBalance: 100, bankItems: [{ ...bank(5), description: '=HYPERLINK("x")' }], ledgerItems: [] });
    const csv = reconciliationStatementCsv(s);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Adjusted ledger balance");
    expect(csv).toContain("'=HYPERLINK");
  });
});
