import { useQuery } from "@tanstack/react-query";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canWriteHrRole, isOwnerRole } from "@/lib/purchasing-hr";

interface TeamMember {
  userId: string;
  role: string;
}

/**
 * The signed-in person's role in a company (from the team list, same cache entry as the report schedules),
 * and what that role may do on the D2 screens. The server still decides; this only hides buttons that would 403.
 */
export function useMyCompanyRole(companyId: string | undefined) {
  const { data: me } = useCurrentUser();
  // /api/companies carries the caller's own role (myRole); an employee may not read the team list at all.
  const { company } = useDefaultCompany();
  const ownRole = (company as { myRole?: string | null } | undefined)?.myRole ?? null;
  const team = useQuery<TeamMember[]>({
    queryKey: ["/api/companies", companyId, "team"],
    enabled: Boolean(companyId) && !ownRole,
    staleTime: 5 * 60_000,
  });
  const members = Array.isArray(team.data) ? team.data : [];
  const role = ownRole ?? members.find((m) => m.userId === me?.id)?.role ?? null;
  // Firm staff and platform admins act as accountants (server: rank 1) even without a membership row.
  const staff = me as { isAdmin?: boolean; firmRole?: string | null } | null | undefined;
  const isStaff = Boolean(staff?.isAdmin || staff?.firmRole);
  return {
    role,
    userId: (me?.id as string | undefined) ?? null,
    isOwner: isOwnerRole(role),
    canWriteHr: canWriteHrRole(role) || isStaff,
    isLoading: team.isLoading,
  };
}
