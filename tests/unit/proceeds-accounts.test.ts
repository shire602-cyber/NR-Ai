import { describe, expect, it } from "vitest";
import { proceedsAccountOptions } from "../../client/src/components/assets/proceeds-accounts";

const acct = (id: string, code: string, nameEn: string, type = "asset", extra: Record<string, unknown> = {}) => ({ id, code, nameEn, type, ...extra });

describe("proceedsAccountOptions", () => {
  it("lists active bank and cash asset accounts, bank GL accounts included, in code order", () => {
    const list = [
      acct("1", "1020", "Bank - Current"),
      acct("2", "1010", "Cash on Hand"),
      acct("3", "1040", "Accounts Receivable"),
      acct("4", "1100", "Savings Pot"),
      acct("5", "5000", "Cash Discounts", "expense"),
      acct("6", "1025", "Payment Gateway Clearing"),
      acct("7", "1030", "Old Bank", "asset", { isActive: false }),
      acct("8", "1031", "Archived Cash", "asset", { isArchived: true }),
    ];
    const out = proceedsAccountOptions(list, [{ glAccountId: "4" }]).map((a) => a.code);
    expect(out).toEqual(["1010", "1020", "1025", "1100"]);
  });
  it("is empty when there are no accounts", () => {
    expect(proceedsAccountOptions([], [])).toEqual([]);
  });
});
