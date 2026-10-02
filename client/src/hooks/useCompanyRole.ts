import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";

interface TeamRow {
  userId: string;
  role: string;
}

/** The signed-in user's role in the active company ("owner", "accountant", ...), or null while unknown. */
export function useCompanyRole(): { role: string | null; isOwner: boolean; isLoading: boolean; companyId: string | undefined } {
  const { companyId } = useDefaultCompany();
  const { data: user } = useCurrentUser();
  const { data: team, isLoading } = useQuery<TeamRow[]>({
    queryKey: ["/api/companies", companyId, "team"],
    enabled: !!companyId,
  });
  const role = team && user ? (team.find((m) => m.userId === user.id)?.role ?? null) : null;
  return { role, isOwner: role === "owner", isLoading, companyId };
}
