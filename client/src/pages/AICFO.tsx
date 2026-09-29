import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Bot,
  Send,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  FileText,
  Loader2,
  Brain,
  BarChart3,
  Zap,
  Target,
  ArrowUp,
  ArrowDown,
  Eye,
  PieChart,
} from "lucide-react";
import { messages as pageMessages } from "./AICFO.i18n";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface DashboardStats {
  revenue: number;
  expenses: number;
  outstanding: number;
  totalInvoices: number;
  totalEntries: number;
}

interface ProfitLossReport {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

interface MonthlyTrend {
  month: string;
  revenue: number;
  expenses: number;
}

interface ExpenseBreakdownEntry {
  name: string;
  value: number;
}

interface KPI {
  label: string;
  value: number;
  format: "percent" | "currency";
  icon: any;
  color: string;
}

export default function AICFO() {
  const tr = pageMessages.useT();

  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  // Get financial context for AI
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/companies", companyId, "dashboard/stats"],
    enabled: !!companyId,
  });

  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossReport>({
    queryKey: ["/api/companies", companyId, "reports", "pl"],
    enabled: !!companyId,
  });

  const { data: monthlyTrends, isLoading: trendsLoading } = useQuery<MonthlyTrend[]>({
    queryKey: ["/api/companies", companyId, "dashboard/monthly-trends"],
    enabled: !!companyId,
  });

  const { data: expenseBreakdown, isLoading: breakdownLoading } = useQuery<ExpenseBreakdownEntry[]>(
    {
      queryKey: ["/api/companies", companyId, "dashboard/expense-breakdown"],
      enabled: !!companyId,
    }
  );

  const askAICFOMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest("POST", "/api/ai/cfo-advice", {
        companyId,
        question,
        context: {
          stats,
          profitLoss,
        },
      });
      return response;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.advice,
          timestamp: new Date(),
        },
      ]);
      setInput("");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("aiCfoError"),
        description: error?.message || tr("failedToGetAdvice"),
      });
    },
  });

  // Insights are produced on demand by asking the AI CFO. Without that explicit
  // ask we have no model output to display, so the Insights tab shows an
  // EmptyState instead of fabricated recommendations.
  const insightsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/cfo-advice", {
        companyId,
        question: tr("giveMe3ConcretePrioritizedRecommendations"),
        context: { stats, profitLoss },
      });
      return response.advice as string;
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("aiCfoError"),
        description: error?.message || tr("failedToGenerateInsights"),
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: input,
        timestamp: new Date(),
      },
    ]);

    askAICFOMutation.mutate(input);
  };

  const quickQuestions = [
    { q: tr("whatAreMyBiggestExpenses"), icon: "📊" },
    { q: tr("howSMyCashFlowLooking"), icon: "💰" },
    { q: tr("whatSMyProfitMargin"), icon: "📈" },
    { q: tr("anyFinancialRisksIShouldKnow"), icon: "⚠️" },
    { q: tr("howCanIReduceExpenses"), icon: "✂️" },
    { q: tr("revenueForecastForNextQuarter"), icon: "🔮" },
  ];

  const profitMarginPct =
    profitLoss && profitLoss.totalRevenue > 0
      ? (profitLoss.netProfit / profitLoss.totalRevenue) * 100
      : null;
  const expenseRatioPct =
    profitLoss && profitLoss.totalRevenue > 0
      ? (profitLoss.totalExpenses / profitLoss.totalRevenue) * 100
      : null;

  const kpis: KPI[] = [
    {
      label: tr("profitMargin"),
      value: profitMarginPct ?? 0,
      format: "percent",
      icon: TrendingUp,
      color: "text-success ",
    },
    {
      label: tr("expenseRatio"),
      value: expenseRatioPct ?? 0,
      format: "percent",
      icon: BarChart3,
      color: "text-info ",
    },
    {
      label: tr("totalRevenue"),
      value: profitLoss?.totalRevenue ?? 0,
      format: "currency",
      icon: ArrowUp,
      color: "text-chart-5 ",
    },
    {
      label: tr("netProfit"),
      value: profitLoss?.netProfit ?? 0,
      format: "currency",
      icon: DollarSign,
      color: "text-warning ",
    },
  ];

  const totalExpenseBreakdown = (expenseBreakdown ?? []).reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-lg border border-primary/20 p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg bg-primary/20">
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{tr("aiCfoFinancialAdvisor")}</h1>
              <p className="text-muted-foreground mt-1">
                {tr("askQuestionsAboutYourFinancialData")}
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 end-0 w-64 h-64 bg-primary/5 rounded-full -me-32 -mt-32 blur-3xl" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-fit">
          <TabsTrigger value="overview" className="gap-2">
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">{tr("overview")}</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">{tr("analytics")}</span>
          </TabsTrigger>
          <TabsTrigger value="insights" className="gap-2">
            <Zap className="w-4 h-4" />
            <span className="hidden sm:inline">{tr("insights")}</span>
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-2">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">{tr("chat")}</span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((kpi, idx) => {
              const Icon = kpi.icon;
              const isLoading = plLoading;
              return (
                <Card key={idx} className="hover-elevate cursor-pointer transition-all">
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{kpi.label}</CardTitle>
                    <Icon className={`w-4 h-4 ${kpi.color}`} />
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <Skeleton className="h-9 w-32" />
                    ) : (
                      <div className={`text-3xl font-bold ${kpi.color}`}>
                        {kpi.format === "percent"
                          ? `${Math.round(kpi.value)}%`
                          : formatCurrency(kpi.value, "AED")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Main Financial Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">{tr("totalRevenue")}</CardTitle>
                <TrendingUp className="w-4 h-4 text-success " />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-10 w-40" />
                ) : stats ? (
                  <>
                    <div dir="ltr" className="text-3xl font-bold font-mono text-success ">
                      {formatCurrency(stats.revenue || 0, "AED")}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {stats.totalInvoices || 0} {tr("invoicesLast30Days")}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr("noData")}</p>
                )}
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">{tr("totalExpenses")}</CardTitle>
                <ArrowDown className="w-4 h-4 text-info " />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-10 w-40" />
                ) : stats ? (
                  <>
                    <div dir="ltr" className="text-3xl font-bold font-mono text-info ">
                      {formatCurrency(stats.expenses || 0, "AED")}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {stats.totalEntries || 0} {tr("entriesLast30Days")}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr("noData")}</p>
                )}
              </CardContent>
            </Card>

            <Card
              className={`hover-elevate ${(profitLoss?.netProfit || 0) >= 0 ? "border-success/30 " : "border-destructive/30 "}`}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">{tr("netProfit")}</CardTitle>
                <Target
                  className={`w-4 h-4 ${(profitLoss?.netProfit || 0) >= 0 ? "text-success " : "text-destructive "}`}
                />
              </CardHeader>
              <CardContent>
                {plLoading ? (
                  <Skeleton className="h-10 w-40" />
                ) : profitLoss ? (
                  <>
                    <div
                      dir="ltr"
                      className={`text-3xl font-bold font-mono ${(profitLoss.netProfit || 0) >= 0 ? "text-success " : "text-destructive "}`}
                    >
                      {formatCurrency(profitLoss.netProfit || 0, "AED")}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {profitLoss.totalRevenue
                        ? tr("margin", {
                            value: ((profitLoss.netProfit / profitLoss.totalRevenue) * 100).toFixed(
                              1
                            ),
                          })
                        : tr("noRevenueYet")}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr("noData")}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Outstanding */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning " />
                {tr("outstandingInvoices")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {statsLoading ? (
                  <Skeleton className="h-10 w-40" />
                ) : stats ? (
                  <>
                    <div dir="ltr" className="text-3xl font-bold font-mono text-warning ">
                      {formatCurrency(stats.outstanding || 0, "AED")}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {tr("youHaveOutstandingAmountsThatNeed")}
                    </p>
                    <Button variant="outline" size="sm" className="w-fit">
                      {tr("viewOutstandingInvoices")}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{tr("noData")}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <Card className="hover-elevate">
            <CardHeader>
              <CardTitle className="text-base">{tr("revenueVsExpensesTrend")}</CardTitle>
              <CardDescription>{tr("last6MonthsPerformance")}</CardDescription>
            </CardHeader>
            <CardContent>
              {trendsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : monthlyTrends && monthlyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={monthlyTrends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(Number(value), "AED")} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      name="Revenue"
                    />
                    <Line
                      type="monotone"
                      dataKey="expenses"
                      stroke="hsl(var(--destructive))"
                      strokeWidth={2}
                      name="Expenses"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title={tr("noTrendDataYet")}
                  description={tr("postInvoicesAndJournalEntriesTo")}
                  compact
                />
              )}
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card className="hover-elevate">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="w-4 h-4" />
                {tr("expenseBreakdown")}
              </CardTitle>
              <CardDescription>{tr("topExpenseCategoriesFromPostedJournal")}</CardDescription>
            </CardHeader>
            <CardContent>
              {breakdownLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : expenseBreakdown && expenseBreakdown.length > 0 ? (
                <div className="space-y-4">
                  {expenseBreakdown.map((item, idx) => {
                    const pct =
                      totalExpenseBreakdown > 0 ? (item.value / totalExpenseBreakdown) * 100 : 0;
                    return (
                      <div key={idx} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{item.name}</span>
                          <span dir="ltr" className="text-sm font-mono font-bold">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                          <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(item.value, "AED")}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={PieChart}
                  title={tr("noExpenseDataYet")}
                  description={tr("postExpenseJournalEntriesToSee")}
                  compact
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-6">
          {insightsMutation.data ? (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="w-4 h-4 text-primary" />
                  {tr("aiGeneratedRecommendations")}
                </CardTitle>
                <CardDescription>{tr("basedOnYourLiveFinancialData")}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {insightsMutation.data}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => insightsMutation.mutate()}
                  disabled={insightsMutation.isPending}
                >
                  {insightsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  ) : null}
                  {tr("regenerate")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={Brain}
              title={tr("noInsightsGeneratedYet")}
              description={tr("generatePrioritizedAiWrittenRecommendationsBased")}
              action={{
                label: insightsMutation.isPending ? tr("generating") : tr("generateInsights"),
                onClick: () => insightsMutation.mutate(),
              }}
            />
          )}
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="space-y-6">
          <Card className="flex flex-col h-[600px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                {tr("chatWithYourAiCfo")}
              </CardTitle>
              <CardDescription>{tr("askQuestionsAboutYourFinancesAnd")}</CardDescription>
            </CardHeader>

            {/* Messages Area */}
            <CardContent className="flex-1 flex flex-col overflow-hidden pb-4">
              <ScrollArea className="flex-1 pe-4 mb-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-8">
                    <div className="p-4 rounded-full bg-primary/10 mb-4">
                      <Bot className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">{tr("startAConversation")}</h3>
                    <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                      {tr("askMeAnythingAboutYourFinances")}
                    </p>
                    <div className="w-full space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-3">
                        {tr("quickQuestions")}
                      </p>
                      <div className="grid gap-2">
                        {quickQuestions.slice(0, 3).map((item, i) => (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-start h-auto py-3"
                            onClick={() => setInput(item.q)}
                            data-testid={`button-quick-question-${i}`}
                          >
                            <span className="me-2">{item.icon}</span>
                            <span className="text-xs">{item.q}</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        {msg.role === "assistant" && (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={`max-w-[75%] rounded-lg p-3 ${
                            msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          <p className="text-xs opacity-70 mt-2">
                            {msg.timestamp.toLocaleTimeString()}
                          </p>
                        </div>
                        {msg.role === "user" && (
                          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-primary-foreground text-xs font-semibold">
                            U
                          </div>
                        )}
                      </div>
                    ))}
                    {askAICFOMutation.isPending && (
                      <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        </div>
                        <div className="bg-muted rounded-lg p-3">
                          <p className="text-sm text-muted-foreground">{tr("aiIsThinking")}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <Separator className="mb-4" />

              {/* Quick Questions */}
              {messages.length > 0 && (
                <div className="mb-3 pb-3 border-b">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    {tr("suggestedQuestions")}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {quickQuestions.slice(0, 3).map((item, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="cursor-pointer hover-elevate text-xs"
                        onClick={() => setInput(item.q)}
                      >
                        {item.icon} {item.q}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Input Form */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={tr("askAboutExpensesRevenueCashFlow")}
                  rows={2}
                  data-testid="input-cfo-question"
                  disabled={askAICFOMutation.isPending}
                  className="resize-none"
                />
                <Button
                  type="submit"
                  disabled={!input.trim() || askAICFOMutation.isPending}
                  data-testid="button-send-question"
                  className="w-full"
                >
                  {askAICFOMutation.isPending ? (
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 me-2" />
                  )}
                  {tr("sendMessage")}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
