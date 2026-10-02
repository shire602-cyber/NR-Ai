import { useQuery } from "@tanstack/react-query";
import { isCashOrBankAccount, type LedgerAccountLite } from "@/lib/purchasing-hr";

/** The company's cash and bank accounts, for choosing where a loan, repayment or settlement is paid from. */
export function useCashBankAccounts(companyId: string | undefined) {
  const query = useQuery<LedgerAccountLite[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
  return { ...query, accounts: (query.data ?? []).filter(isCashOrBankAccount) };
}
