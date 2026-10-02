import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canManageSchedules } from "@/lib/reportSchedulesApi";

export interface TeamMember {
  userId: string;
  role: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
}

/** Company members (recipients) and whether the signed-in person may change report schedules. */
export function useReportScheduleAccess(companyId: string | undefined) {
  const { data: me } = useCurrentUser();
  const team = useQuery<TeamMember[]>({
    queryKey: ["/api/companies", companyId, "team"],
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
  });
  const members = Array.isArray(team.data) ? team.data : [];
  const myRole = members.find((m) => m.userId === me?.id)?.role ?? null;
  return {
    members,
    isLoadingMembers: team.isLoading,
    canManage: canManageSchedules(me, myRole),
    userId: (me?.id as string | undefined) ?? null,
  };
}
