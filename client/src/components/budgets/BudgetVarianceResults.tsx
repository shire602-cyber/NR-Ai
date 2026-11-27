import { TrendingDown, TrendingUp } from "lucide-react";
import { T } from "@/components/layout/T";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { budgetCategoryLabel } from "@/lib/budget-categories";
import { summariseBudget, type PlanMonth } from "@/lib/budget-summary";
import { useTranslation } from "@/lib/i18n";

interface VarianceMonth {
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

interface VarianceLine {
  id: string;
  category: string;
  description: string | null;
  accountId: string | null;
  accountType: string | null;
  months: Record<string, VarianceMonth>;
  totals: {
    budget: number;
    actual: number;
    variance: number;
    variancePercent: number;
  };
}

export interface VarianceData {
  budget: {
    id: string;
    name: string;
    fiscalYear: number;
    startDate: string;
    endDate: string;
    status: string;
  };
  /** Year-months the plan covers; `months` of each line holds only these columns. */
  periods?: string[];
  varianceLines: VarianceLine[];
}

const getVarianceColor = (variance: number) => {
  if (variance > 0) return "text-success";
  if (variance < 0) return "text-destructive";
  return "";
};

export default function BudgetVarianceResults({
  varianceLines,
  varianceMonths,
  planMonthLabel,
}: {
  varianceLines: VarianceLine[];
  varianceMonths: PlanMonth[];
  planMonthLabel: (month: PlanMonth) => string;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky start-0 bg-background z-10 min-w-[160px]">
                <T k="pages.category" />
              </TableHead>
              {varianceMonths.map((pm) => (
                <TableHead key={pm.key} className="text-center min-w-[200px]">
                  <div>{planMonthLabel(pm)}</div>
                  <div className="flex text-xs text-muted-foreground mt-1">
                    <span className="flex-1 text-end pe-1">
                      <T k="pages.budget" />
                    </span>
                    <span className="flex-1 text-end pe-1">
                      <T k="pages.actual" />
                    </span>
                    <span className="flex-1 text-end">{t["budgets.varianceAmount"]}</span>
                  </div>
                </TableHead>
              ))}
              <TableHead className="text-center min-w-[200px]">
                <div>
                  <T k="pages.annual" />
                </div>
                <div className="flex text-xs text-muted-foreground mt-1">
                  <span className="flex-1 text-end pe-1">
                    <T k="pages.budget" />
                  </span>
                  <span className="flex-1 text-end pe-1">
                    <T k="pages.actual" />
                  </span>
                  <span className="flex-1 text-end">{t["budgets.variancePercent"]}</span>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {varianceLines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="sticky start-0 bg-background z-10 font-medium">
                  <div>
                    {budgetCategoryLabel(t, line.category)}
                    {line.description && (
                      <div className="text-xs text-muted-foreground">{line.description}</div>
                    )}
                  </div>
                </TableCell>
                {varianceMonths.map(({ key, column }) => {
                  // E2 (J3-r2): the report holds only the plan's months.
                  const m = line.months[column] ?? {
                    budget: 0,
                    actual: 0,
                    variance: 0,
                    variancePercent: 0,
                  };
                  return (
                    <TableCell data-numeric key={key}>
                      <div className="flex text-xs tabular-nums">
                        <span className="flex-1 text-end pe-1">{m.budget.toFixed(0)}</span>
                        <span className="flex-1 text-end pe-1">{m.actual.toFixed(0)}</span>
                        <span
                          className={`flex-1 text-end font-semibold ${getVarianceColor(m.variance)}`}
                        >
                          {m.variance >= 0 ? "+" : ""}
                          {m.variance.toFixed(0)}
                        </span>
                      </div>
                    </TableCell>
                  );
                })}
                <TableCell data-numeric>
                  <div className="flex text-xs tabular-nums">
                    <span className="flex-1 text-end pe-1">{line.totals.budget.toFixed(0)}</span>
                    <span className="flex-1 text-end pe-1">{line.totals.actual.toFixed(0)}</span>
                    <span
                      className={`flex-1 text-end font-bold ${getVarianceColor(line.totals.variance)}`}
                    >
                      {line.totals.variancePercent >= 0 ? "+" : ""}
                      {line.totals.variancePercent.toFixed(1)}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* Income, expense and net are totalled separately. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        {(() => {
          const summary = summariseBudget(varianceLines);
          const groups = [
            { key: "income", title: t["budgets.summaryIncome"], g: summary.income },
            { key: "expense", title: t["budgets.summaryExpense"], g: summary.expense },
            { key: "net", title: t["budgets.summaryNet"], g: summary.net },
          ];
          return groups.map(({ key, title, g }) => (
            <Card key={key} data-testid={`budget-summary-${key}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    <T k="pages.budget" />
                  </span>
                  <Money amount={g.budget} currency={"AED"} />
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    <T k="pages.actual" />
                  </span>
                  <Money amount={g.actual} currency={"AED"} />
                </div>
                <div
                  className={`flex items-center justify-between gap-2 font-semibold ${getVarianceColor(g.variance)}`}
                >
                  <span className="flex items-center gap-1">
                    {g.variance >= 0 ? (
                      <TrendingUp className="w-4 h-4" aria-hidden />
                    ) : (
                      <TrendingDown className="w-4 h-4" aria-hidden />
                    )}
                    {g.variance >= 0 ? t["budgets.favourable"] : t["budgets.unfavourable"]}
                  </span>
                  <Money amount={Math.abs(g.variance)} currency={"AED"} />
                </div>
              </CardContent>
            </Card>
          ));
        })()}
      </div>
    </>
  );
}
