// Chart of accounts search: accountants look accounts up by code, English name or Arabic name
// ("1040" must find Accounts Receivable). Pure so the rule is unit-tested (STEP1 F11, item 12).
export interface SearchableAccount {
  code: string;
  nameEn: string;
  nameAr?: string | null;
}

export function matchesAccountQuery(account: SearchableAccount, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    account.code.toLowerCase().includes(q) ||
    account.nameEn.toLowerCase().includes(q) ||
    (account.nameAr ?? "").toLowerCase().includes(q)
  );
}
