import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { messages as pageMessages } from "./PortalStatements.i18n";

function formatAed(n: number) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(n);
}

function StatRow({
  label,
  amount,
  indent = false,
}: {
  label: string;
  amount: number;
  indent?: boolean;
}) {
  return (
    <div className={["flex justify-between items-center py-1.5", indent ? "ps-4" : ""].join(" ")}>
      <span className={["text-sm", indent ? "text-muted-foreground" : "text-foreground"].join(" ")}>
        {label}
      </span>
      <span
        className={[
          "text-sm tabular-nums",
          indent ? "text-muted-foreground" : "font-medium text-foreground",
        ].join(" ")}
      >
        {formatAed(amount)}
      </span>
    </div>
  );
}

function SectionTotal({
  label,
  amount,
  positive,
}: {
  label: string;
  amount: number;
  positive?: boolean;
}) {
  const color =
    positive === undefined ? "text-foreground" : amount >= 0 ? "text-success" : "text-destructive";
  return (
    <div className="flex justify-between items-center py-2 border-t border-border mt-1">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className={["text-sm font-bold tabular-nums", color].join(" ")}>
        {formatAed(amount)}
      </span>
    </div>
  );
}

export default function PortalStatements() {
  const tr = pageMessages.useT();

  const { data, isLoading } = useQuery({
    queryKey: ["portal-statements"],
    queryFn: () => apiRequest("GET", "/api/client-portal/statements"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pnl = data?.profitAndLoss ?? { revenue: 0, expenses: 0, netProfit: 0, items: [] };
  const bs = data?.balanceSheet ?? { assets: 0, liabilities: 0, equity: 0, items: [] };

  const revenueItems = pnl.items?.filter((i: any) => i.type === "income") ?? [];
  const expenseItems = pnl.items?.filter((i: any) => i.type === "expense") ?? [];
  const assetItems = bs.items?.filter((i: any) => i.type === "asset") ?? [];
  const liabilityItems = bs.items?.filter((i: any) => i.type === "liability") ?? [];
  const equityItems = bs.items?.filter((i: any) => i.type === "equity") ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{tr("financialStatements")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{tr("readOnlyViewOfYourCompany")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profit & Loss */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {pnl.netProfit >= 0 ? (
                <TrendingUp className="w-4 h-4 text-success" />
              ) : (
                <TrendingDown className="w-4 h-4 text-destructive" />
              )}
              {tr("profitLoss")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
                {tr("revenue")}
              </p>
              {revenueItems.length === 0 ? (
                <p className="text-xs text-muted-foreground/70 py-1">{tr("noRevenueRecorded")}</p>
              ) : (
                revenueItems.map((i: any) => (
                  <StatRow key={i.name} label={i.name} amount={i.balance} indent />
                ))
              )}
              <SectionTotal label={tr("totalRevenue")} amount={pnl.revenue} />

              <div className="pt-3">
                <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
                  {tr("expenses")}
                </p>
                {expenseItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70 py-1">
                    {tr("noExpensesRecorded")}
                  </p>
                ) : (
                  expenseItems.map((i: any) => (
                    <StatRow key={i.name} label={i.name} amount={i.balance} indent />
                  ))
                )}
                <SectionTotal label={tr("totalExpenses")} amount={pnl.expenses} />
              </div>

              <div className="pt-1">
                <SectionTotal label={tr("netProfitLoss")} amount={pnl.netProfit} positive />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balance Sheet */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Minus className="w-4 h-4 text-info" />
              {tr("balanceSheet")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
                {tr("assets")}
              </p>
              {assetItems.length === 0 ? (
                <p className="text-xs text-muted-foreground/70 py-1">{tr("noAssetsRecorded")}</p>
              ) : (
                assetItems.map((i: any) => (
                  <StatRow key={i.name} label={i.name} amount={i.balance} indent />
                ))
              )}
              <SectionTotal label={tr("totalAssets")} amount={bs.assets} />

              <div className="pt-3">
                <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
                  {tr("liabilities")}
                </p>
                {liabilityItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70 py-1">
                    {tr("noLiabilitiesRecorded")}
                  </p>
                ) : (
                  liabilityItems.map((i: any) => (
                    <StatRow key={i.name} label={i.name} amount={i.balance} indent />
                  ))
                )}
                <SectionTotal label={tr("totalLiabilities")} amount={bs.liabilities} />
              </div>

              <div className="pt-3">
                <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1">
                  {tr("equity")}
                </p>
                {equityItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70 py-1">{tr("noEquityRecorded")}</p>
                ) : (
                  equityItems.map((i: any) => (
                    <StatRow key={i.name} label={i.name} amount={i.balance} indent />
                  ))
                )}
                <SectionTotal label={tr("totalEquity")} amount={bs.equity} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
