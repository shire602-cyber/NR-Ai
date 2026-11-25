/**
 * Group consolidation on the Reports page (W5-A, R20-09 brief §6).
 *
 * When a company group exists, this panel shows the server's management consolidation
 * (eliminations, NCI and FX translation applied) from
 * GET /api/company-groups/:groupId/consolidated-statements, and the consolidated-* comparison
 * metrics read the same endpoint (useReportsPage). Only with no group, or when the endpoint
 * fails, does the page fall back to the client-side per-entity roll-up, labelled
 * "combined view (unconsolidated)", with a link to /company-groups.
 */
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/ui/money";
import {
  serverConsolidationCurrency,
  useFirstCompanyGroup,
  useServerConsolidatedStatements,
} from "./groupConsolidationQueries";

export function GroupConsolidationPanel({ from, to }: { from?: string; to?: string }) {
  const groups = useFirstCompanyGroup();
  const group = groups.group;
  const consolidated = useServerConsolidatedStatements(group?.id, from, to);

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
  const currency = serverConsolidationCurrency(c);
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
          <div className="tabular-nums text-lg font-semibold">
            <Money amount={pl.revenue ?? pl.totalIncome ?? 0} currency={currency} />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            <T k="reportCenter.netProfit" />
          </div>
          <div className="tabular-nums text-lg font-semibold">
            <Money amount={pl.netProfit ?? 0} currency={currency} />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            <T k="reportCenter.assets" />
          </div>
          <div className="tabular-nums text-lg font-semibold">
            <Money amount={bs.totalAssets ?? 0} currency={currency} />
          </div>
        </div>
      </div>
    </div>
  );
}
