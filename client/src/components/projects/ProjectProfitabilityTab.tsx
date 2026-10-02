import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { clampPct, type Project, type ProjectProfitability } from "@/lib/purchasing-hr";
import { messages } from "@/pages/ProjectDetail.i18n";

function Stat({ label, value, testId, tone }: { label: string; value: string; testId: string; tone?: "bad" }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`} data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export function ProjectProfitabilityTab({ project }: { project: Project }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const valid = !from || !to || from <= to;

  const { data, isLoading, isError } = useQuery<ProjectProfitability>({
    queryKey: ["/api/projects", project.id, "profitability", from, to],
    enabled: valid,
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/profitability?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`),
  });

  const money = (n: number) => formatCurrency(n, "AED", locale);
  const hasBudget = data && (data.budget.amount !== null || data.budget.hours !== null);

  return (
    <div className="space-y-4" data-testid="tab-profitability">
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor="profit-from">{tr("from")}</Label>
          <Input id="profit-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="profit-to">{tr("to")}</Label>
          <Input id="profit-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
      ) : isError || !data ? (
        <p className="text-sm text-destructive" role="alert">{tr("profitFailed")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={tr("revenue")} value={money(data.revenue)} testId="text-profit-revenue" />
            <Stat label={tr("costs")} value={money(data.costs)} testId="text-profit-costs" />
            <Stat label={tr("margin")} value={money(data.margin)} testId="text-profit-margin" tone={data.margin < 0 ? "bad" : undefined} />
            <Stat label={tr("marginPct")} value={data.marginPct === null ? "-" : `${data.marginPct.toFixed(1)}%`} testId="text-profit-margin-pct" tone={data.margin < 0 ? "bad" : undefined} />
          </div>
          <p className="text-xs text-muted-foreground">{tr("ledgerNote")}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label={tr("hoursTotal")} value={data.hours.total.toFixed(2)} testId="text-hours-total" />
            <Stat label={tr("hoursBillable")} value={data.hours.billable.toFixed(2)} testId="text-hours-billable" />
            <Stat label={tr("hoursBilled")} value={data.hours.billed.toFixed(2)} testId="text-hours-billed" />
            <Stat label={tr("hoursUnbilled")} value={data.hours.unbilled.toFixed(2)} testId="text-hours-unbilled" />
          </div>
          <section className="space-y-3 rounded-md border p-3">
            <h3 className="font-medium">{tr("budget")}</h3>
            {!hasBudget && <p className="text-sm text-muted-foreground">{tr("noBudget")}</p>}
            {data.budget.amount !== null && data.budget.usedPct !== null && (
              <div className="space-y-1" data-testid="budget-amount">
                <p className="text-sm">
                  {money(data.costs)} / {money(data.budget.amount)} - {tr("budgetAmountUsed", { pct: data.budget.usedPct.toFixed(1) })}
                </p>
                <Progress value={clampPct(data.budget.usedPct)} aria-label={tr("budget")} />
              </div>
            )}
            {data.budget.hours !== null && data.budget.hoursUsedPct !== null && (
              <div className="space-y-1" data-testid="budget-hours">
                <p className="text-sm">
                  {data.hours.total.toFixed(2)} / {data.budget.hours.toFixed(2)} - {tr("budgetHoursUsed", { pct: data.budget.hoursUsedPct.toFixed(1) })}
                </p>
                <Progress value={clampPct(data.budget.hoursUsedPct)} aria-label={tr("budget")} />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
