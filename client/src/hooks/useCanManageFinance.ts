import { useMyCompanyRole } from "@/hooks/useMyCompanyRole";

/**
 * Owner and accountant (rank accountant or above) and firm staff may run finance jobs and refund payments. The server
 * enforces the same rule: this only hides buttons that would answer 403.
 */
export function useCanManageFinance(companyId: string | undefined | null): boolean {
  return useMyCompanyRole(companyId ?? undefined).canWriteHr;
}
