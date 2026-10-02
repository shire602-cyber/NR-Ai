// The accounts a payment may leave from (a bill payment, a refund): the company's bank and cash accounts.
// "1020 Bank Accounts" is the header over the company's own bank accounts, so it is offered only when the company has
// none of its own; the default is the main (first) managed bank account.

import type { BankAccount, LedgerAccount } from "@/lib/banking-api-types";

const BANK_OR_CASH_CODES = new Set(["1010", "1020", "1025"]);
const HEADER_CODE = "1020";
const CHILD_BANK = /^102[1-9]$/;

export interface PaymentAccountChoices {
  options: LedgerAccount[];
  /** The account to preselect: the main bank account's ledger account, else the first bank, else cash; "" when none. */
  defaultId: string;
  /** True when the company has bank accounts of its own, so the server will not take the header. */
  requiresChoice: boolean;
}

export function paymentAccountChoices(accounts: LedgerAccount[], bankAccounts: Pick<BankAccount, "glAccountId" | "isActive">[]): PaymentAccountChoices {
  const activeManaged = bankAccounts.filter((b) => b.isActive !== false && b.glAccountId);
  const managed = new Set(activeManaged.map((b) => b.glAccountId as string));
  const usable = accounts.filter((a) => a.isActive !== false && a.isArchived !== true && a.type === "asset");
  const hasChildBank = usable.some((a) => CHILD_BANK.test(a.code));
  const requiresChoice = managed.size > 0 || hasChildBank;
  const options = usable
    .filter((a) => managed.has(a.id) || BANK_OR_CASH_CODES.has(a.code) || CHILD_BANK.test(a.code) || /\b(bank|cash)\b/i.test(a.nameEn))
    .filter((a) => !(a.code === HEADER_CODE && !managed.has(a.id) && requiresChoice))
    .sort((x, y) => x.code.localeCompare(y.code));
  const optionIds = new Set(options.map((o) => o.id));
  const mainManaged = activeManaged.map((b) => b.glAccountId as string).find((id) => optionIds.has(id));
  const firstBank = options.find((o) => o.code !== "1010" && o.code !== "1025");
  const cash = options.find((o) => o.code === "1010");
  return { options, defaultId: mainManaged ?? firstBank?.id ?? cash?.id ?? options[0]?.id ?? "", requiresChoice };
}
