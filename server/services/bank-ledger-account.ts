// Every bank account has a ledger account (Teardown 7 workaround): however a bank account was created (the Bank
// accounts screen, onboarding, an import, a feed), Record Payment, bill payments and bank postings need its ledger
// account. A credit card is a LIABILITY account of bank type (2xxx): purchases are credits, payments to the card debits,
// and its statement imports and reconciles like any other.

import { storage } from "../storage";
import { AppError } from "../errors";
import type { Account, BankAccount } from "../../shared/schema";

export type BankAccountKind = "bank" | "credit_card";

/** Next free code: assets from 1021 (1020 stays the header), credit cards (liabilities) from 2100. */
export async function createBankLedgerAccount(companyId: string, name: string, kind: BankAccountKind = "bank"): Promise<string> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const taken = new Set(accounts.map((a) => a.code));
  let code = kind === "credit_card" ? 2100 : 1021;
  while (taken.has(String(code))) code++;
  const created = await storage.createAccount({
    companyId,
    code: String(code),
    nameEn: name.slice(0, 120),
    type: kind === "credit_card" ? "liability" : "asset",
    subType: kind === "credit_card" ? "current_liability" : undefined,
    isActive: true,
    isSystemAccount: false,
  } as any);
  return created.id;
}

/** The ledger account a bank account may be linked to: an active asset account, or (credit card) a plain liability account. */
export function assertLinkableLedgerAccount(account: Account | undefined): asserts account is Account {
  const liability = account?.type === "liability" && account.isVatAccount !== true && account.isSystemAccount !== true;
  if (!account || account.isActive === false || (account.type !== "asset" && !liability)) {
    throw new AppError({
      message: "The linked ledger account must be an active asset account of this company (or, for a credit card, a liability account).",
      statusCode: 422,
      code: "ACCOUNT_INVALID",
    });
  }
}

/** Repairs a bank account that has no ledger account: creates one named after it and links it. Returns the account as it is now. */
export async function ensureBankAccountLedger(companyId: string, bank: BankAccount, kind: BankAccountKind = "bank"): Promise<BankAccount> {
  if (bank.glAccountId) return bank;
  const glAccountId = await createBankLedgerAccount(companyId, bank.nameEn, kind);
  return (await storage.updateBankAccount(bank.id, { glAccountId } as any)) ?? { ...bank, glAccountId };
}

/** Bank accounts as the screens read them: `accountKind` is "credit_card" when the ledger account is a liability. */
export async function withAccountKind<T extends BankAccount>(companyId: string, banks: T[]): Promise<Array<T & { accountKind: BankAccountKind }>> {
  if (banks.length === 0) return [];
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  return banks.map((b) => ({ ...b, accountKind: (b.glAccountId && type.get(b.glAccountId) === "liability" ? "credit_card" : "bank") as BankAccountKind }));
}
