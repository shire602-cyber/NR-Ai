import { T } from "@/components/layout/T";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateRange } from "@/lib/format-date";
import {
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
} from "lucide-react";

interface WeeklyProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  expectedInflows: number;
  expectedOutflows: number;
  projectedBalance: number;
}

interface ForecastItem {
  kind: string;
  date: string;
  amount: number;
  description: string;
  note?: string;
}

type Scenario = "base" | "conservative" | "optimistic";

interface ForecastData {
  currentBalance: number;
  projections: WeeklyProjection[];
  insights: string[];
  items: ForecastItem[];
  assumptions: string[];
  insufficientData: boolean;
  scenario: Scenario;
  summary: { receivablesOverdue: number; minProjectedBalance: number; projectedShortfall: number };
}

interface Adjustment {
  date: string;
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
}

interface ScheduledItem {
  id: string;
  kind: "loan_repayment" | "one_off_inflow" | "one_off_outflow";
  description: string;
  amount: number;
  dueDate: string;
  repeatMonths: number;
  occurrences: number;
}

const KIND_LABELS: Record<string, { en: string; ar: string }> = {
  receivable: { en: "Invoice receipt", ar: "تحصيل فاتورة" },
  payable: { en: "Bill payment", ar: "سداد فاتورة" },
  recurring_invoice: { en: "Recurring invoice", ar: "فاتورة متكررة" },
  payroll: { en: "Payroll", ar: "الرواتب" },
  vat: { en: "VAT payment", ar: "سداد ضريبة القيمة المضافة" },
  corporate_tax: { en: "Corporate tax", ar: "ضريبة الشركات" },
  loan_repayment: { en: "Loan repayment", ar: "سداد قرض" },
  one_off_inflow: { en: "One-off inflow", ar: "إيراد لمرة واحدة" },
  one_off_outflow: { en: "One-off outflow", ar: "مصروف لمرة واحدة" },
  what_if: { en: "What-if", ar: "افتراض" },
};

const tr = (locale: string, en: string, ar: string) => (locale === "ar" ? ar : en);

interface MonthlyCashHistory {
  month: string;
  year: number;
  monthNum: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
}

export default function CashFlowForecast() {
  const { t: _t, locale } = useTranslation();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [forecastDays, setForecastDays] = useState("90");
  const [scenario, setScenario] = useState<Scenario>("base");
  const [delayDays, setDelayDays] = useState("0");
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [draftAdjustment, setDraftAdjustment] = useState({
    date: "",
    amount: "",
    direction: "outflow" as "inflow" | "outflow",
    description: "",
  });
  const [draftItem, setDraftItem] = useState({
    kind: "loan_repayment" as ScheduledItem["kind"],
    description: "",
    amount: "",
    dueDate: "",
    repeatMonths: "1",
    occurrences: "12",
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const delay = Math.max(0, Math.min(180, parseInt(delayDays, 10) || 0));

  const {
    data: forecast,
    isLoading: isLoadingForecast,
    refetch: refetchForecast,
    isFetching: isFetchingForecast,
  } = useQuery<ForecastData>({
    queryKey: ["cashflow-forecast", companyId, forecastDays, scenario, delay, adjustments],
    queryFn: () => {
      const base = `/api/companies/${companyId}/cashflow/forecast`;
      if (adjustments.length > 0) {
        return apiRequest("POST", `${base}/what-if`, {
          days: Number(forecastDays),
          scenario,
          delayReceiptsDays: delay,
          adjustments,
        });
      }
      return apiRequest(
        "GET",
        `${base}?days=${forecastDays}&scenario=${scenario}&delayReceiptsDays=${delay}`
      );
    },
    enabled: !!companyId,
  });

  const { data: scheduledItems } = useQuery<ScheduledItem[]>({
    queryKey: [`/api/companies/${companyId}/cashflow/items`],
    enabled: !!companyId,
  });

  const invalidateForecast = () => {
    queryClient.invalidateQueries({ queryKey: ["cashflow-forecast", companyId] });
    queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cashflow/items`] });
  };

  const addItem = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/cashflow/items`, {
        kind: draftItem.kind,
        description: draftItem.description,
        amount: draftItem.amount,
        dueDate: draftItem.dueDate,
        repeatMonths: draftItem.kind === "loan_repayment" ? Number(draftItem.repeatMonths) || 0 : 0,
        occurrences: draftItem.kind === "loan_repayment" ? Number(draftItem.occurrences) || 1 : 1,
      }),
    onSuccess: () => {
      setDraftItem({ ...draftItem, description: "", amount: "" });
      invalidateForecast();
    },
    onError: (err: Error) =>
      toast({
        title: tr(locale, "Could not add item", "تعذر إضافة البند"),
        description: err.message,
        variant: "destructive",
      }),
  });

  const removeItem = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/cashflow/items/${id}`),
    onSuccess: invalidateForecast,
  });

  const { data: history, isLoading: isLoadingHistory } = useQuery<MonthlyCashHistory[]>({
    queryKey: [`/api/companies/${companyId}/cashflow/history?months=6`],
    enabled: !!companyId,
  });

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              <T k="pageLabels.pleaseCreateACompanyFirstToUseCashFlowForecasting" />
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getInsightIcon = (insight: string) => {
    const lower = insight.toLowerCase();
    if (
      lower.includes("warning") ||
      lower.includes("negative") ||
      lower.includes("drop below") ||
      lower.includes("insufficient")
    ) {
      return <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />;
    }
    if (lower.includes("positive") || lower.includes("improve")) {
      return <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />;
    }
    return <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />;
  };

  const getInsightBadge = (insight: string) => {
    const lower = insight.toLowerCase();
    if (lower.includes("warning") || lower.includes("negative")) {
      return <Badge variant="danger">{tr(locale, "Risk", "مخاطرة")}</Badge>;
    }
    if (lower.includes("positive") || lower.includes("improve")) {
      return (
        <Badge variant="success">
          <T k="pageLabels.positive" />
        </Badge>
      );
    }
    return <Badge variant="neutral">{tr(locale, "Info", "معلومة")}</Badge>;
  };

  // Calculate summary stats from projections
  const totalProjectedInflows =
    forecast?.projections.reduce((s, p) => s + p.expectedInflows, 0) || 0;
  const totalProjectedOutflows =
    forecast?.projections.reduce((s, p) => s + p.expectedOutflows, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Reports"
        title={<T k="pages.cashFlowForecast" />}
        description={tr(
          locale,
          "Built from open invoices, vendor bills, payroll, tax dates and scheduled items. Nothing is extrapolated from past averages.",
          "مبنية على الفواتير المفتوحة وفواتير الموردين والرواتب ومواعيد الضرائب والبنود المجدولة. لا يتم استنتاج أي شيء من المتوسطات السابقة."
        )}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select value={forecastDays} onValueChange={setForecastDays}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">{tr(locale, "30 days", "30 يومًا")}</SelectItem>
            <SelectItem value="60">{tr(locale, "60 days", "60 يومًا")}</SelectItem>
            <SelectItem value="90">{tr(locale, "90 days", "90 يومًا")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scenario} onValueChange={(v) => setScenario(v as Scenario)}>
          <SelectTrigger className="h-9 w-[160px]" data-testid="select-forecast-scenario">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="base">{tr(locale, "Base case", "الحالة الأساسية")}</SelectItem>
            <SelectItem value="conservative">{tr(locale, "Conservative", "متحفظ")}</SelectItem>
            <SelectItem value="optimistic">{tr(locale, "Optimistic", "متفائل")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="delay-receipts">
            {tr(locale, "Delay receipts (days)", "تأخير التحصيل (أيام)")}
          </label>
          <Input
            id="delay-receipts"
            type="number"
            min={0}
            max={180}
            value={delayDays}
            onChange={(e) => setDelayDays(e.target.value)}
            className="h-9 w-20"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchForecast()}
          disabled={isFetchingForecast}
        >
          <RefreshCw className={`h-4 w-4 me-2 ${isFetchingForecast ? "animate-spin" : ""}`} />
          <T k="pages.refresh" />
        </Button>
      </div>

      {/* Current Balance + Summary Cards */}
      {isLoadingForecast ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : forecast ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                <T k="pageLabels.currentBalance" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`text-h1 font-semibold ${forecast.currentBalance >= 0 ? "text-foreground" : "text-negative"}`}
              >
                <Money amount={forecast.currentBalance} currency={"AED"} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4" aria-hidden />
                {tr(locale, "Projected inflows", "التدفقات الداخلة المتوقعة")} ({forecastDays}
                {tr(locale, "d", " يوم")})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-h1 font-semibold">
                <Money amount={totalProjectedInflows} currency={"AED"} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4" aria-hidden />
                {tr(locale, "Projected outflows", "التدفقات الخارجة المتوقعة")} ({forecastDays}
                {tr(locale, "d", " يوم")})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-h1 font-semibold">
                <Money amount={totalProjectedOutflows} currency={"AED"} />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* AI Insights */}
      {forecast && forecast.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              {tr(locale, "Forecast notes", "ملاحظات التوقعات")}
            </CardTitle>
            <CardDescription>
              {tr(
                locale,
                "Rule-based observations from your open documents and scheduled items",
                "ملاحظات قائمة على القواعد من مستنداتك المفتوحة والبنود المجدولة"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {forecast.insights.map((insight, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border"
                >
                  {getInsightIcon(insight)}
                  <span className="text-sm flex-1">{insight}</span>
                  {getInsightBadge(insight)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Projection Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <T k="pageLabels.weeklyProjections" />
          </CardTitle>
          <CardDescription>
            {tr(
              locale,
              `Projected cash inflows and outflows for the next ${forecastDays} days`,
              `التدفقات النقدية الداخلة والخارجة المتوقعة خلال ${forecastDays} يومًا القادمة`
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingForecast ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : forecast && forecast.projections.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr(locale, "Week", "الأسبوع")}</TableHead>
                    <TableHead>
                      <T k="pages.period" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pageLabels.expectedIn" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pageLabels.expectedOut" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pageLabels.projectedBalance2" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forecast.projections.map((proj) => (
                    <TableRow key={proj.week}>
                      <TableCell className="font-medium" data-nowrap>
                        {tr(locale, "Week", "الأسبوع")} {proj.week}
                      </TableCell>
                      <TableCell className="text-small text-muted-foreground" data-nowrap>
                        {formatDateRange(proj.weekStart, proj.weekEnd, locale)}
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={proj.expectedInflows} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={proj.expectedOutflows} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <span
                          className={`font-semibold ${
                            proj.projectedBalance >= 0 ? "text-foreground" : "text-negative"
                          }`}
                        >
                          <Money amount={proj.projectedBalance} currency={"AED"} />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No projection data available. Add journal entries and invoices to generate forecasts.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Assumptions and the dated items behind every projected figure */}
      {forecast && (
        <Card data-testid="forecast-items">
          <CardHeader>
            <CardTitle className="text-lg">
              {tr(locale, "What is in this forecast", "ما الذي يتضمنه هذا التوقع")}
            </CardTitle>
            <CardDescription>
              <ul className="list-disc ps-5 space-y-1">
                {forecast.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {forecast.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {tr(
                  locale,
                  "No dated items yet. Add invoices, vendor bills or scheduled items below.",
                  "لا توجد بنود مؤرخة بعد. أضف فواتير أو فواتير موردين أو بنوداً مجدولة أدناه."
                )}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr(locale, "Date", "التاريخ")}</TableHead>
                      <TableHead>{tr(locale, "Type", "النوع")}</TableHead>
                      <TableHead>{tr(locale, "Description", "الوصف")}</TableHead>
                      <TableHead data-numeric>{tr(locale, "Amount", "المبلغ")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {forecast.items.map((it, i) => (
                      <TableRow key={`${it.kind}-${it.date}-${i}`}>
                        <TableCell className="whitespace-nowrap">{it.date}</TableCell>
                        <TableCell>
                          {tr(
                            locale,
                            KIND_LABELS[it.kind]?.en ?? it.kind,
                            KIND_LABELS[it.kind]?.ar ?? it.kind
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {it.description}
                          {it.note && (
                            <span className="block text-xs text-muted-foreground">{it.note}</span>
                          )}
                        </TableCell>
                        <TableCell
                          data-numeric
                          className={`font-medium ${it.amount >= 0 ? "text-foreground" : "text-negative"}`}
                        >
                          <Money amount={it.amount} currency={"AED"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Scheduled items: loan repayments and one-offs */}
      <Card data-testid="forecast-scheduled-items">
        <CardHeader>
          <CardTitle className="text-lg">
            {tr(locale, "Scheduled items", "البنود المجدولة")}
          </CardTitle>
          <CardDescription>
            {tr(
              locale,
              "Loan repayments and known one-off payments or receipts that are not yet invoices or bills.",
              "أقساط القروض والمدفوعات أو المقبوضات المعروفة التي لم تُسجّل بعد كفواتير."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
            <Select
              value={draftItem.kind}
              onValueChange={(v) =>
                setDraftItem({ ...draftItem, kind: v as ScheduledItem["kind"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="loan_repayment">
                  {tr(locale, "Loan repayment", "سداد قرض")}
                </SelectItem>
                <SelectItem value="one_off_outflow">
                  {tr(locale, "One-off payment", "دفعة لمرة واحدة")}
                </SelectItem>
                <SelectItem value="one_off_inflow">
                  {tr(locale, "One-off receipt", "مقبوض لمرة واحدة")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={tr(locale, "Description", "الوصف")}
              value={draftItem.description}
              onChange={(e) => setDraftItem({ ...draftItem, description: e.target.value })}
              className="md:col-span-2"
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder={tr(locale, "Amount (AED)", "المبلغ (درهم)")}
              value={draftItem.amount}
              onChange={(e) => setDraftItem({ ...draftItem, amount: e.target.value })}
            />
            <Input
              type="date"
              value={draftItem.dueDate}
              onChange={(e) => setDraftItem({ ...draftItem, dueDate: e.target.value })}
            />
            <Button
              onClick={() => addItem.mutate()}
              disabled={
                addItem.isPending ||
                !draftItem.description ||
                !draftItem.amount ||
                !draftItem.dueDate
              }
              data-testid="button-add-forecast-item"
            >
              {tr(locale, "Add", "إضافة")}
            </Button>
          </div>
          {draftItem.kind === "loan_repayment" && (
            <div className="flex items-center gap-2 text-sm">
              <span>{tr(locale, "Repeat every", "تكرار كل")}</span>
              <Input
                type="number"
                min={1}
                max={12}
                value={draftItem.repeatMonths}
                onChange={(e) => setDraftItem({ ...draftItem, repeatMonths: e.target.value })}
                className="h-8 w-16"
              />
              <span>{tr(locale, "month(s),", "شهر،")}</span>
              <Input
                type="number"
                min={1}
                max={120}
                value={draftItem.occurrences}
                onChange={(e) => setDraftItem({ ...draftItem, occurrences: e.target.value })}
                className="h-8 w-16"
              />
              <span>{tr(locale, "times", "مرة")}</span>
            </div>
          )}
          {(scheduledItems ?? []).map((it) => (
            <div
              key={it.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span>
                {tr(locale, KIND_LABELS[it.kind].en, KIND_LABELS[it.kind].ar)} · {it.description} ·{" "}
                {it.dueDate}
                {it.repeatMonths > 0 ? ` ×${it.occurrences}` : ""}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">
                  <Money amount={it.amount} currency={"AED"} />
                </span>
                <Button size="sm" variant="ghost" onClick={() => removeItem.mutate(it.id)}>
                  {tr(locale, "Remove", "حذف")}
                </Button>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* What-if adjustments (not saved) */}
      <Card data-testid="forecast-what-if">
        <CardHeader>
          <CardTitle className="text-lg">{tr(locale, "What-if", "ماذا لو")}</CardTitle>
          <CardDescription>
            {tr(
              locale,
              "Try a one-off receipt or payment. It changes this view only and is not saved.",
              "جرّب مقبوضاً أو دفعة لمرة واحدة. يغيّر هذا العرض فقط ولا يُحفظ."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
            <Input
              type="date"
              value={draftAdjustment.date}
              onChange={(e) => setDraftAdjustment({ ...draftAdjustment, date: e.target.value })}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder={tr(locale, "Amount (AED)", "المبلغ (درهم)")}
              value={draftAdjustment.amount}
              onChange={(e) => setDraftAdjustment({ ...draftAdjustment, amount: e.target.value })}
            />
            <Select
              value={draftAdjustment.direction}
              onValueChange={(v) =>
                setDraftAdjustment({ ...draftAdjustment, direction: v as "inflow" | "outflow" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outflow">{tr(locale, "Payment", "دفعة")}</SelectItem>
                <SelectItem value="inflow">{tr(locale, "Receipt", "مقبوض")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={tr(locale, "Description", "الوصف")}
              value={draftAdjustment.description}
              onChange={(e) =>
                setDraftAdjustment({ ...draftAdjustment, description: e.target.value })
              }
            />
            <Button
              variant="outline"
              disabled={
                !draftAdjustment.date ||
                !(Number(draftAdjustment.amount) > 0) ||
                !draftAdjustment.description
              }
              onClick={() => {
                setAdjustments([
                  ...adjustments,
                  { ...draftAdjustment, amount: Number(draftAdjustment.amount) },
                ]);
                setDraftAdjustment({ ...draftAdjustment, amount: "", description: "" });
              }}
            >
              {tr(locale, "Apply", "تطبيق")}
            </Button>
          </div>
          {adjustments.map((a, i) => (
            <div
              key={`${a.date}-${i}`}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
            >
              <span>
                {a.date} · {a.description} · {a.direction === "inflow" ? "+" : "-"}
                <Money amount={a.amount} currency={"AED"} />
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdjustments(adjustments.filter((_, j) => j !== i))}
              >
                {tr(locale, "Remove", "حذف")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Cash Flow History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Cash Flow History (Last 6 Months)
          </CardTitle>
          <CardDescription>
            Monthly income and expense totals from posted journal entries (accrual basis, not bank
            movement)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history && history.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="hr.month" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pageLabels.totalInflows" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pageLabels.totalOutflows" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pageLabels.netCashFlow" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={`${h.year}-${h.monthNum}`}>
                      <TableCell className="font-medium">
                        {h.month} {h.year}
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={h.totalInflows} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={h.totalOutflows} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <span
                          className={`font-semibold ${
                            h.netCashFlow >= 0 ? "text-foreground" : "text-negative"
                          }`}
                        >
                          <Money amount={h.netCashFlow} currency={"AED"} />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No historical data available yet. Post journal entries to build cash flow history.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
