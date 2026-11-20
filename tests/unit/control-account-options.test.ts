/**
 * C1 (RH1 / RL1): account pickers for user-chosen fields leave out the control accounts, the
 * same set the server refuses (code chain plus the input / output VAT flag).
 */
import { describe, expect, it } from "vitest";
import {
  controlAccountIds,
  withoutControlAccounts,
} from "../../client/src/lib/control-account-options";

const accounts = [
  { id: "bank", code: "1020" },
  { id: "ar", code: "1040" },
  { id: "ar-sub", code: "1041", parentId: "ar" },
  { id: "vat-in", code: "1050", isVatAccount: true, vatType: "input" },
  { id: "vat-custom", code: "2099", isVatAccount: true, vatType: "output" },
  { id: "zero-rated", code: "4060", isVatAccount: true, vatType: null },
  { id: "stock", code: "1070" },
  { id: "ap", code: "2010" },
  { id: "gratuity", code: "2036" },
  { id: "rent", code: "5010" },
  { id: "equipment", code: "1210" },
];

describe("[C1] control accounts are not offered in user-chosen account pickers", () => {
  it("[RH1] marks receivables, payables, inventory, VAT, payroll and their sub-accounts", () => {
    expect([...controlAccountIds(accounts)].sort()).toEqual(
      ["ap", "ar", "ar-sub", "gratuity", "stock", "vat-custom", "vat-in"].sort()
    );
  });

  it("[RL1] keeps expense, asset, bank and VAT-flagged sales accounts", () => {
    expect(withoutControlAccounts(accounts).map((a) => a.id)).toEqual([
      "bank",
      "zero-rated",
      "rent",
      "equipment",
    ]);
  });
});
