import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ForecastInsight, ForecastItemType, ForecastResponse, ForecastScenarioFields, SavedScenario } from "@/lib/banking-api-types";
import { ForecastChart } from "@/components/cashflow/ForecastChart";
import { ScenarioPanel } from "@/components/cashflow/ScenarioPanel";
import { DEFAULT_SCENARIO, lowestBalance, scenarioIssues, scenarioQuery, weekLabel } from "@/components/cashflow/chart-data";
import { messages as pageMessages } from "./CashFlowForecast.i18n";

interface MonthlyCashHistory {
  month: string;
  year: number;
  monthNum: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
}

const monthName = (year: number, month: number, locale: string) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));

const HORIZONS = [30, 60, 90, 180] as const;
const ITEM_PAGE = 50;
type Tr = ReturnType<typeof pageMessages.useT>;

const TYPE_KEY: Record<ForecastItemType, Parameters<Tr>[0]> = {
  invoice: "typeInvoice",
  bill: "typeBill",
  recurring: "typeRecurring",
  payroll: "typePayroll",
  adjustment: "typeAdjustment",
};

type Tone = "risk" | "positive" | "info";

/** One observation from the server's code and params, in the active language. */
function insightText(tr: Tr, insight: ForecastInsight, money: (n: number) => string, locale: string): { text: string; tone: Tone } {
  const p = insight.params;
  const day = (v: unknown) => weekLabel(String(v), locale);
  switch (insight.code) {
    case "NEGATIVE_BALANCE":
      return { tone: "risk", text: tr("insightNegative", { week: Number(p.week), weekStart: day(p.weekStart), amount: money(Number(p.amount)) }) };
    case "LOW_BALANCE":
      return { tone: "risk", text: tr("insightLow", { week: Number(p.week), weekStart: day(p.weekStart), threshold: money(Number(p.threshold)) }) };
    case "OVERDUE_RECEIVABLES":
      return { tone: "risk", text: tr("insightOverdue", { count: Number(p.count), amount: money(Number(p.amount)) }) };
    case "RECEIVABLES_EXPECTED":
      return { tone: "info", text: tr("insightReceivables", { amount: money(Number(p.amount)) }) };
    case "PAYABLES_DUE":
      return { tone: "info", text: tr("insightPayables", { amount: money(Number(p.amount)) }) };
    case "POSITIVE_OUTLOOK":
      return { tone: "positive", text: tr("insightPositiveOutlook", { improvement: money(Number(p.improvement)) }) };
    default:
      return { tone: "info", text: tr("insightNoActivity") };
  }
}

export default function CashFlowForecast() {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [days, setDays] = useState<number>(90);
  const [draft, setDraft] = useState<ForecastScenarioFields>(DEFAULT_SCENARIO);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [itemLimit, setItemLimit] = useState(ITEM_PAGE);

  const { data: scenarios } = useQuery<SavedScenario[]>({ queryKey: ["/api/companies", companyId, "cashflow", "scenarios"], enabled: !!companyId });
  // start from the company's default scenario, once
  useEffect(() => {
    if (initialised || !scenarios) return;
    const d = scenarios.find((s) => s.isDefault);
    if (d) {
      setSelectedId(d.id);
      setDraft({ receiptDelayDays: d.receiptDelayDays, paymentDelayDays: d.paymentDelayDays, collectionRatePct: Number(d.collectionRatePct), includeRecurring: d.includeRecurring, includePayroll: d.includePayroll, payrollPayDay: d.payrollPayDay, adjustments: d.adjustments ?? [] });
    }
    setInitialised(true);
  }, [scenarios, initialised]);

  const valid = scenarioIssues(draft).length === 0;
  const query = scenarioQuery(days, draft);
  const { data: forecast, isLoading, isFetching, isError, refetch } = useQuery<ForecastResponse>({
    queryKey: [`/api/companies/${companyId}/cashflow/forecast?${query}`],
    enabled: !!companyId && initialised && valid,
    placeholderData: (prev) => prev,
  });
  const { data: history, isLoading: isLoadingHistory } = useQuery<MonthlyCashHistory[]>({ queryKey: [`/api/companies/${companyId}/cashflow/history?months=6`], enabled: !!companyId });

  const currency = forecast?.currency ?? "AED";
  const money = (n: number) => formatCurrency(n, currency, locale);
  const low = useMemo(() => (forecast ? lowestBalance(forecast.weeks) : null), [forecast]);
  const totals = useMemo(() => {
    const weeks = forecast?.weeks ?? [];
    return { inflows: weeks.reduce((s, w) => s + w.inflows, 0), outflows: weeks.reduce((s, w) => s + w.outflows, 0), closing: weeks.length ? weeks[weeks.length - 1].closingBalance : (forecast?.openingBalance ?? 0) };
  }, [forecast]);

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }
  if (!companyId) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">{tr("noCompany")}</CardContent>
      </Card>
    );
  }

  const items = forecast?.items ?? [];
  const insights = (forecast?.insights ?? []).map((i) => insightText(tr, i, money, locale));
  const toneIcon = (t: Tone) => (t === "risk" ? <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> : t === "positive" ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--chart-5))] shrink-0 mt-0.5" /> : <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />);
  const toneBadge = (t: Tone) => (t === "risk" ? <Badge variant="destructive">{tr("insightRisk")}</Badge> : t === "positive" ? <Badge className="bg-[hsl(var(--chart-5)/0.15)] text-[hsl(var(--chart-5))]">{tr("insightPositive")}</Badge> : <Badge variant="secondary">{tr("insightInfo")}</Badge>);

  return (
    <div className="space-y-6" data-testid="cashflow-page">
      <PageHeader
        eyebrow={forecast?.scenarioMeta ? tr("scenarioName", { name: forecast.scenarioMeta.name }) : undefined}
        title={tr("title")}
        description={tr("description")}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="horizon" className="text-sm">
            {tr("horizon")}
          </Label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger id="horizon" className="w-32" data-testid="select-horizon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d === 30 ? tr("days30") : d === 60 ? tr("days60") : d === 90 ? tr("days90") : tr("days180")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching || !valid}>
          <RefreshCw className={`h-4 w-4 me-2 ${isFetching ? "animate-spin" : ""}`} />
          {tr("refresh")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] items-start">
        <div className="space-y-6 min-w-0">
          {isLoading && !forecast ? (
            <Skeleton className="h-80 w-full" />
          ) : isError && !forecast ? (
            <Card>
              <CardContent className="pt-6 text-sm text-destructive">{tr("loadFailed")}</CardContent>
            </Card>
          ) : forecast ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Card>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <p className="text-xs text-muted-foreground">{tr("cardOpening")}</p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p dir="ltr" className="text-lg font-bold text-start whitespace-nowrap" data-testid="forecast-opening">
                      {money(forecast.openingBalance)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <p className="text-xs text-muted-foreground">{tr("cardInflows")}</p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p dir="ltr" className="text-lg font-bold text-start whitespace-nowrap text-[hsl(var(--chart-5))]" data-testid="forecast-inflows">
                      {money(totals.inflows)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <p className="text-xs text-muted-foreground">{tr("cardOutflows")}</p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p dir="ltr" className="text-lg font-bold text-start whitespace-nowrap text-[hsl(var(--chart-4))]" data-testid="forecast-outflows">
                      {money(totals.outflows)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <p className="text-xs text-muted-foreground">{tr("cardClosing")}</p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p dir="ltr" className={`text-lg font-bold text-start whitespace-nowrap ${totals.closing < 0 ? "text-destructive" : ""}`} data-testid="forecast-closing">
                      {money(totals.closing)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <p className="text-xs text-muted-foreground">{tr("cardLowest")}</p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p dir="ltr" className={`text-lg font-bold text-start whitespace-nowrap ${low && low.balance < 0 ? "text-destructive" : ""}`} data-testid="forecast-lowest">
                      {low ? money(low.balance) : "-"}
                    </p>
                    {low && <p className="text-[11px] text-muted-foreground">{tr("cardLowestWeek", { date: weekLabel(low.weekStart, locale) })}</p>}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{tr("chartTitle")}</CardTitle>
                  <CardDescription>{tr("chartDescription")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ForecastChart weeks={forecast.weeks} currency={currency} />
                </CardContent>
              </Card>

              {insights.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{tr("insightsTitle")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2" data-testid="forecast-insights">
                      {insights.map((i, n) => (
                        <li key={n} className="flex items-start gap-2 text-sm">
                          {toneIcon(i.tone)}
                          <span className="flex-1">{i.text}</span>
                          {toneBadge(i.tone)}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{tr("itemsTitle")}</CardTitle>
                  <CardDescription>{tr("itemsDescription")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tr("itemsEmpty")}</p>
                  ) : (
                    <>
                      <div className="rounded-md border overflow-x-auto">
                        <Table data-testid="forecast-items">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-28">{tr("colDate")}</TableHead>
                              <TableHead className="w-28">{tr("colType")}</TableHead>
                              <TableHead>{tr("colLabel")}</TableHead>
                              <TableHead className="w-28">{tr("colOriginal")}</TableHead>
                              <TableHead className="text-end w-36">{tr("colAmount")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.slice(0, itemLimit).map((it, idx) => (
                              <TableRow key={`${it.type}-${it.sourceId ?? idx}-${it.date}-${idx}`} data-testid={`forecast-item-${it.type}`}>
                                <TableCell className="font-mono text-xs">{formatDate(it.date, locale)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">{tr(TYPE_KEY[it.type])}</Badge>
                                </TableCell>
                                <TableCell className="text-sm" dir="auto">
                                  {it.label}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">{it.originalDate !== it.date ? formatDate(it.originalDate, locale) : ""}</TableCell>
                                <TableCell dir="ltr" className={`text-end font-mono text-sm ${it.amount >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                                  {money(it.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {items.length > itemLimit && (
                        <div className="flex justify-center pt-3">
                          <Button variant="outline" size="sm" onClick={() => setItemLimit((n) => n + ITEM_PAGE)}>
                            {tr("itemsMore", { count: items.length - itemLimit })}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tr("historyTitle")}</CardTitle>
              <CardDescription>{tr("historyDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <Skeleton className="h-24 w-full" />
              ) : !history || history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tr("historyEmpty")}</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("month")}</TableHead>
                        <TableHead className="text-end">{tr("totalInflows")}</TableHead>
                        <TableHead className="text-end">{tr("totalOutflows")}</TableHead>
                        <TableHead className="text-end">{tr("netCashFlow")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h) => (
                        <TableRow key={`${h.year}-${h.monthNum}`}>
                          <TableCell>
                            {monthName(h.year, h.monthNum, locale)}
                          </TableCell>
                          <TableCell dir="ltr" className="text-end font-mono text-[hsl(var(--chart-5))]">
                            {formatCurrency(h.totalInflows, "AED", locale)}
                          </TableCell>
                          <TableCell dir="ltr" className="text-end font-mono text-destructive">
                            {formatCurrency(h.totalOutflows, "AED", locale)}
                          </TableCell>
                          <TableCell dir="ltr" className={`text-end font-mono font-medium ${h.netCashFlow >= 0 ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`}>
                            {formatCurrency(h.netCashFlow, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <ScenarioPanel companyId={companyId} scenarios={scenarios ?? []} selectedId={selectedId} value={draft} onChange={setDraft} onSelect={setSelectedId} />
      </div>
    </div>
  );
}
