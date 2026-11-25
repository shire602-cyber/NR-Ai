/**
 * X5 (J1 D1): the cash/bank accounts a payment may be recorded against, and the default.
 *
 * Mirrors server/services/payment-accounts.service.ts: only active cash/bank asset accounts that
 * have no sub-accounts (header accounts never receive postings), and the default is the primary
 * bank account's GL (the earliest active managed bank account, preferring the payment currency),
 * so a payment always lands where the bank statement line can be matched.
 */

export interface PaymentAccountLike {
  id: string;
  code?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
  type?: string | null;
  subType?: string | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
  parentId?: string | null;
}

export interface BankAccountLike {
  id: string;
  glAccountId?: string | null;
  isActive?: boolean | null;
  currency?: string | null;
  createdAt?: string | Date | null;
}

/** Postable cash/bank accounts, ordered by code. */
export function postablePaymentAccounts<A extends PaymentAccountLike>(accounts: A[]): A[] {
  const parents = new Set(
    accounts.filter((a) => a.parentId && a.isArchived !== true).map((a) => a.parentId)
  );
  return accounts
    .filter(
      (a) =>
        a.type === "asset" &&
        (a.subType === "cash" || a.subType === "bank") &&
        a.isActive !== false &&
        a.isArchived !== true &&
        !parents.has(a.id)
    )
    .sort((x, y) => String(x.code ?? "").localeCompare(String(y.code ?? "")));
}

const time = (d: string | Date | null | undefined) => (d ? new Date(d).getTime() || 0 : 0);

/**
 * The default payment account id: cash method → 1010 when postable; else the primary bank
 * account's GL; else the first postable bank account; else the first postable account.
 */
export function defaultPaymentAccountId(
  accounts: PaymentAccountLike[],
  bankAccounts: BankAccountLike[],
  opts: { currency?: string | null; method?: string | null } = {}
): string {
  const postable = postablePaymentAccounts(accounts);
  const ids = new Set(postable.map((a) => a.id));
  if (opts.method === "cash") {
    const cash = postable.find((a) => a.code === "1010");
    if (cash) return cash.id;
  }
  const banks = bankAccounts
    .filter((b) => b.isActive !== false && b.glAccountId && ids.has(b.glAccountId))
    .sort((x, y) => {
      const cx = opts.currency && x.currency === opts.currency ? 0 : 1;
      const cy = opts.currency && y.currency === opts.currency ? 0 : 1;
      return cx - cy || time(x.createdAt) - time(y.createdAt) || x.id.localeCompare(y.id);
    });
  if (banks[0]?.glAccountId) return banks[0].glAccountId;
  const bank =
    postable.find((a) => a.code === "1020") ?? postable.find((a) => a.subType === "bank");
  return (bank ?? postable[0])?.id ?? "";
}
