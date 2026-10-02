// The accounts a fixed-asset disposal may put its proceeds in: active bank or cash accounts of the company.
// The same test the server applies (PROCEEDS_ACCOUNT_INVALID otherwise), so the picker never offers a refused account.

import type { BankAccount, LedgerAccount } from "@/lib/banking-api-types";

const BANK_OR_CASH_CODES = new Set(["1010", "1020", "1025"]);

export function proceedsAccountOptions(accounts: LedgerAccount[], bankAccounts: Pick<BankAccount, "glAccountId">[]): LedgerAccount[] {
  const managed = new Set(bankAccounts.map((b) => b.glAccountId).filter((v): v is string => !!v));
  return accounts
    .filter((a) => {
      if (a.isActive === false || a.isArchived === true || a.type !== "asset") return false;
      return managed.has(a.id) || BANK_OR_CASH_CODES.has(a.code) || /\b(bank|cash)\b/i.test(a.nameEn);
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
