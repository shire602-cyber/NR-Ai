import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ApprovalDocumentType, ApprovalQueueRow } from "@/lib/purchasing-hr";

export interface ApprovalProgress {
  completedSteps: number;
  requiredSteps: number;
  nextRole: string | null;
}

/**
 * Where each document in `pending_approval` stands (steps done of steps required), keyed by document id.
 * Reads the approval queue once; turned off (no request) while no listed document is waiting, and quiet when the
 * company's plan has no approvals.
 */
export function useApprovalProgress(companyId: string | undefined, documentType: ApprovalDocumentType, enabled: boolean) {
  const { data } = useQuery<ApprovalQueueRow[]>({
    queryKey: ["/api/companies", companyId, "approvals", "progress", documentType],
    enabled: Boolean(companyId) && enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/approvals?status=pending&documentType=${documentType}`),
  });
  const map = new Map<string, ApprovalProgress>();
  for (const row of data ?? []) {
    if (row.requestId) map.set(row.documentId, { completedSteps: row.completedSteps, requiredSteps: row.requiredSteps, nextRole: row.nextRole });
  }
  return map;
}
