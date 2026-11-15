/**
 * Group consolidation on the Reports page (W5-A, R20-09 brief §6).
 *
 * The management roll-up below is a client-side sum of each accessible company's own
 * statements; it is never labelled as a consolidation. When a company group exists, this
 * panel shows the server's consolidated statements (eliminations and FX translation applied)
 * from GET /api/company-groups/:groupId/consolidated-statements. With no group, or when the
 * endpoint is unavailable, it says so and links to /company-groups.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";

interface CompanyGroupSummary {
  id: string;
  name: string;
}

interface ConsolidatedPayload {
  entities?: unknown[];
  eliminations?: unknown[];
  translation?: Record<string, unknown>;
  consolidated?: {
    profitAndLoss?: { totalIncome?: number; revenue?: number; netProfit?: number };
    balanceSheet?: { totalAssets?: number; totalEquity?: number; isBalanced?: boolean };
  };
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

export function GroupConsolidationPanel({ from, to }: { from?: string; to?: string }) {
  const { locale } = useTranslation();
  const groups = useQuery({
    queryKey: ["/api/company-groups"],
    queryFn: async () => asGroups(await apiRequest("GET", "/api/company-groups")),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const group = groups.data?.[0] ?? null;
  const range = new URLSearchParams();
  if (from) range.set("from", from);
  if (to) range.set("to", to);
  const consolidated = useQuery<ConsolidatedPayload>({
    queryKey: ["/api/company-groups", group?.id, "consolidated-statements", from, to],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/company-groups/${group!.id}/consolidated-statements?${range.toString()}`
      ),
    enabled: Boolean(group),
    retry: false,
  });

  if (groups.isLoading || (group && consolidated.isLoading)) {
    return <Skeleton className="h-20" />;
  }

  if (!group || consolidated.isError || !consolidated.data?.consolidated) {
    return (
      <div
        className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-subtle/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        data-testid="combined-view-unconsolidated"
      >
        <div>
          <div className="font-medium">
            <T k="reportCenter.combinedViewUnconsolidated" />
          </div>
          <div className="text-muted-foreground">
            <T k="reportCenter.combinedViewExplanation" />
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/company-groups">
            <T k="reportCenter.setUpCompanyGroup" />
          </Link>
        </Button>
      </div>
    );
  }

  const c = consolidated.data;
  const pl = c.consolidated?.profitAndLoss ?? {};
  const bs = c.consolidated?.balanceSheet ?? {};
  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="group-consolidated-statements">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          <T k="reportCenter.consolidatedGroup" />: {group.name}
        </span>
        <Badge variant="info">
          {(c.eliminations ?? []).length} <T k="reportCenter.eliminationsApplied" />
        </Badge>
        <Badge variant="neutral">
          {(c.entities ?? []).length} <T k="reportCenter.entities" />
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">
            <T k="reportCenter.revenue" />
          </div>
          <div className="font-mono text-lg font-semibold">
            {formatCurrency(pl.revenue ?? pl.totalIncome ?? 0, "AED", locale)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            <T k="reportCenter.netProfit" />
          </div>
          <div className="font-mono text-lg font-semibold">
            {formatCurrency(pl.netProfit ?? 0, "AED", locale)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            <T k="reportCenter.assets" />
          </div>
          <div className="font-mono text-lg font-semibold">
            {formatCurrency(bs.totalAssets ?? 0, "AED", locale)}
          </div>
        </div>
      </div>
    </div>
  );
}
