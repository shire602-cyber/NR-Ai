/**
 * Company-group consolidation queries shared by the Reports close tab panel
 * (GroupConsolidation.tsx) and the consolidated-* comparison metrics (useReportsPage.tsx).
 * Server: GET /api/company-groups and
 * GET /api/company-groups/:groupId/consolidated-statements (W5-C management consolidation).
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface CompanyGroupSummary {
  id: string;
  name: string;
}

export interface ServerConsolidatedPayload {
  basis?: "management_consolidation";
  group?: { id: string; name: string; reportingCurrency?: string };
  entities?: unknown[];
  eliminations?: unknown[];
  translation?: { reportingCurrency?: string } & Record<string, unknown>;
  consolidated?: {
    profitAndLoss?: {
      reportingCurrency?: string;
      totalIncome?: number;
      revenue?: number;
      totalExpenses?: number;
      netProfit?: number;
    };
    balanceSheet?: { totalAssets?: number; totalEquity?: number; isBalanced?: boolean };
  };
  warnings?: string[];
  generatedAt?: string;
}

function asGroups(body: unknown): CompanyGroupSummary[] {
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as { groups?: unknown[] } | null)?.groups)
      ? (body as { groups: unknown[] }).groups
      : [];
  return list
    .map((g) => g as Partial<CompanyGroupSummary>)
    .filter((g): g is CompanyGroupSummary => typeof g.id === "string")
    .map((g) => ({ id: g.id, name: g.name ?? g.id }));
}

function rangeQuery(from?: string, to?: string): string {
  const range = new URLSearchParams();
  if (from) range.set("from", from);
  if (to) range.set("to", to);
  return range.toString();
}

const groupQueryOptions = { retry: false, staleTime: 5 * 60_000 } as const;

/** The caller's first company group (GET /api/company-groups), or null when none exists. */
export function useFirstCompanyGroup(enabled = true) {
  const groups = useQuery({
    queryKey: ["/api/company-groups"],
    queryFn: async () => asGroups(await apiRequest("GET", "/api/company-groups")),
    enabled,
    ...groupQueryOptions,
  });
  return { group: groups.data?.[0] ?? null, isLoading: groups.isLoading && enabled };
}

/** Server management consolidation (eliminations + FX translation) for one group and range. */
export function useServerConsolidatedStatements(
  groupId: string | null | undefined,
  from?: string,
  to?: string,
  enabled = true
) {
  return useQuery<ServerConsolidatedPayload>({
    queryKey: ["/api/company-groups", groupId, "consolidated-statements", from, to],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/company-groups/${groupId}/consolidated-statements?${rangeQuery(from, to)}`
      ),
    enabled: Boolean(groupId) && enabled,
    ...groupQueryOptions,
  });
}

export function serverConsolidationCurrency(payload: ServerConsolidatedPayload | undefined) {
  return (
    payload?.consolidated?.profitAndLoss?.reportingCurrency ??
    payload?.group?.reportingCurrency ??
    payload?.translation?.reportingCurrency ??
    "AED"
  );
}
