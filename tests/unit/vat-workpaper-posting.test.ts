import { describe, it, expect } from "vitest";
import {
  buildVatRowJournalLines,
  isPostableVatCategory,
  type SalesAccountIds,
} from "../../server/services/vat-workpaper-posting";

const ACCT: SalesAccountIds = {
  accountsReceivableId: "ar",
  salesRevenueId: "rev",
  zeroRatedRevenueId: "zero",
  vatOutputId: "vatout",
  generalExpenseId: "exp",
  vatInputId: "vatin",
  accountsPayableId: "ap",
};

const sum = (lines: { debit: number; credit: number }[], k: "debit" | "credit") =>
  Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;

describe("isPostableVatCategory", () => {
  it("accepts sales categories, rejects the rest", () => {
    expect(isPostableVatCategory("standard_sale")).toBe(true);
    expect(isPostableVatCategory("zero_rated_sale")).toBe(true);
    expect(isPostableVatCategory("exempt_sale")).toBe(true);
    expect(isPostableVatCategory("standard_expense")).toBe(true);
    expect(isPostableVatCategory("reverse_charge_input")).toBe(false);
    expect(isPostableVatCategory("import")).toBe(false);
    expect(isPostableVatCategory("manual_adjustment")).toBe(false);
  });
});

describe("buildVatRowJournalLines — standard sale (the reported case: 100 + 5)", () => {
  it("posts Dr AR 105 / Cr Revenue 100 / Cr Output VAT 5, balanced", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_sale", taxableAmount: 100, vatAmount: 5 },
      ACCT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(3);
    const ar = r.lines.find((l) => l.accountId === "ar")!;
    const rev = r.lines.find((l) => l.accountId === "rev")!;
    const vat = r.lines.find((l) => l.accountId === "vatout")!;
    expect(ar.debit).toBe(105);
    expect(rev.credit).toBe(100);
    expect(vat.credit).toBe(5);
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });

  it("omits the VAT leg when vat is 0 and stays balanced", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_sale", taxableAmount: 100, vatAmount: 0 },
      ACCT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(2);
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });

  it("fails closed when output VAT account is missing but VAT was charged", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_sale", taxableAmount: 100, vatAmount: 5 },
      { ...ACCT, vatOutputId: null }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("VAT_ACCOUNT_MISSING");
  });
});

describe("buildVatRowJournalLines — zero-rated & exempt", () => {
  it("zero-rated posts to the zero-rated revenue account, no VAT", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "zero_rated_sale", taxableAmount: 200, vatAmount: 0 },
      ACCT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(2);
    expect(r.lines.find((l) => l.accountId === "zero")!.credit).toBe(200);
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });

  it("zero-rated falls back to sales revenue when no zero-rated account", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "zero_rated_sale", taxableAmount: 200, vatAmount: 0 },
      { ...ACCT, zeroRatedRevenueId: null }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.find((l) => l.accountId === "rev")!.credit).toBe(200);
  });

  it("exempt posts net to revenue with no VAT leg", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "exempt_sale", taxableAmount: 300, vatAmount: 0 },
      ACCT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(2);
    expect(sum(r.lines, "debit")).toBe(300);
  });
});

describe("buildVatRowJournalLines — standard expense (VAT bill by supplier: 100 + 5)", () => {
  it("posts Dr Expense 100 / Dr Input VAT 5 / Cr Accounts Payable 105, balanced", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_expense", taxableAmount: 100, vatAmount: 5 },
      ACCT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(3);
    expect(r.lines.find((l) => l.accountId === "exp")!.debit).toBe(100);
    expect(r.lines.find((l) => l.accountId === "vatin")!.debit).toBe(5);
    expect(r.lines.find((l) => l.accountId === "ap")!.credit).toBe(105);
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });

  it("omits the input-VAT leg when vat is 0 and stays balanced", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_expense", taxableAmount: 100, vatAmount: 0 },
      ACCT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(2);
    expect(r.lines.find((l) => l.accountId === "ap")!.credit).toBe(100);
    expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
  });

  it("fails closed when the payable account is missing", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_expense", taxableAmount: 100, vatAmount: 5 },
      { ...ACCT, accountsPayableId: null }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("AP_ACCOUNT_MISSING");
  });

  it("fails closed when input VAT account is missing but VAT was charged", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_expense", taxableAmount: 100, vatAmount: 5 },
      { ...ACCT, vatInputId: null }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("VAT_INPUT_ACCOUNT_MISSING");
  });
});

describe("buildVatRowJournalLines — guards", () => {
  it("rejects still-unsupported categories as not auto-postable", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "reverse_charge_input", taxableAmount: 100, vatAmount: 5 },
      ACCT
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_AUTO_POSTABLE");
  });

  it("rejects a non-positive amount", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_sale", taxableAmount: 0, vatAmount: 0 },
      ACCT
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("INVALID_AMOUNT");
  });

  it("fails closed when AR account is missing", () => {
    const r = buildVatRowJournalLines(
      { rowCategory: "standard_sale", taxableAmount: 100, vatAmount: 5 },
      { ...ACCT, accountsReceivableId: null }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("AR_ACCOUNT_MISSING");
  });
});
