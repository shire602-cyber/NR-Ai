import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@/lib/purchasing-hr";

/** The company's active projects, for the "Project" picker on cost lines. Empty when the plan has no projects. */
export function useActiveProjects(companyId: string | undefined) {
  return useQuery<Project[]>({
    queryKey: ["/api/companies", companyId, "projects", "active-for-timer"],
    enabled: Boolean(companyId),
    retry: false,
    staleTime: 60_000,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/projects?status=active`),
  });
}
