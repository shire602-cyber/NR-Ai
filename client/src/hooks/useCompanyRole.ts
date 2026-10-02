import { useMyCompanyRole } from "@/hooks/useMyCompanyRole";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";

/** The signed-in user's role in the active company ("owner", "accountant", "employee", ...), or null while unknown. */
export function useCompanyRole(): { role: string | null; isOwner: boolean; isLoading: boolean; companyId: string | undefined } {
  const { companyId } = useDefaultCompany();
  const { role, isOwner, isLoading } = useMyCompanyRole(companyId);
  return { role, isOwner, isLoading, companyId };
}
