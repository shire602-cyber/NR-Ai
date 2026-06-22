import { describe, it, expect } from "vitest";
import {
  mapExpenseCategoryToCode,
  buildExpenseClaimJournalLines,
} from "../../server/services/expense-claim-posting";

describe("mapExpenseCategoryToCode (S-H6)", () => {
  it("maps common categories to expense accounts", () => {
    expect(mapExpenseCategoryToCode("Travel")).toBe("5090");
    expect(mapExpenseCategoryToCode("client meal")).toBe("5090");
    expect(mapExpenseCategoryToCode("Software subscription")).toBe("5080");
    expect(mapExpenseCategoryToCode("Telephone")).toBe("5040");
    expect(mapExpenseCategoryToCode("Professional fees")).toBe("5070");
    expect(mapExpenseCategoryToCode("office stationery")).toBe("5050");
  });
  it("falls back to office supplies for unknown/blank", () => {
    expect(mapExpenseCategoryToCode("")).toBe("5050");
    expect(mapExpenseCategoryToCode(null)).toBe("5050");
    expect(mapExpenseCategoryToCode("misc widget")).toBe("5050");
  });
});

describe("buildExpenseClaimJournalLines (S-H6)", () => {
  // account id == "acct-<code>" for the resolver in these tests
  const resolve = (code: string) => `acct-${code}`;

  it("builds a balanced entry: Dr expense + Dr input VAT, Cr reimbursements payable", () => {
    const r = buildExpenseClaimJournalLines({
      items: [
        { category: "Travel", amount: 200, vatAmount: 10 },
        { category: "Office supplies", amount: 100, vatAmount: 5 },
      ],
      resolveByCode: resolve,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dr = r.lines.reduce((s, l) => s + l.debit, 0);
      const cr = r.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.round(dr * 100) / 100).toBe(315); // 300 net + 15 VAT
      expect(Math.round(cr * 100) / 100).toBe(315); // owed to employee
      // credit lands on the reimbursements payable account
      const credit = r.lines.find((l) => l.credit > 0);
      expect(credit?.accountId).toBe("acct-2045");
      // VAT leg present
      expect(r.lines.some((l) => l.accountId === "acct-1050" && l.debit === 15)).toBe(true);
    }
  });

  it("omits the VAT leg when there is no recoverable VAT", () => {
    const r = buildExpenseClaimJournalLines({
      items: [{ category: "Travel", amount: 50, vatAmount: 0 }],
      resolveByCode: resolve,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines.some((l) => l.accountId === "acct-1050")).toBe(false);
      expect(r.lines.find((l) => l.credit > 0)?.credit).toBe(50);
    }
  });

  it("fails hard when the reimbursements-payable account is missing", () => {
    const r = buildExpenseClaimJournalLines({
      items: [{ category: "Travel", amount: 50, vatAmount: 0 }],
      resolveByCode: (code) => (code === "2045" ? null : `acct-${code}`),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REIMBURSEMENT_ACCOUNT_MISSING");
  });

  it("rejects an empty claim", () => {
    const r = buildExpenseClaimJournalLines({ items: [], resolveByCode: resolve });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_ITEMS");
  });
});
