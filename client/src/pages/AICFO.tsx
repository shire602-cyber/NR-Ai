import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import { apiRequest } from '@/lib/queryClient';
import { Bot, Send, Sparkles, TrendingUp, AlertTriangle, DollarSign, FileText, Loader2, Brain, BarChart3, Zap, Target, ArrowUp, ArrowDown, Eye, PieChart, Shield, Activity, MessageSquare, Receipt, CheckCircle2, XCircle, Info } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
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

interface KPI {
  label: string;
  value: number;
  trend: number;
  icon: any;
  color: string;
}

export default function AICFO() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // Get financial context for AI
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/companies', companyId, 'dashboard/stats'],
    enabled: !!companyId,
  });

  const { data: profitLoss } = useQuery<ProfitLossReport>({
    queryKey: ['/api/companies', companyId, 'reports', 'pl'],
    enabled: !!companyId,
  });

  const askAICFOMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest('POST', '/api/ai/cfo-advice', {
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
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.advice,
        timestamp: new Date(),
      }]);
      setInput('');
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'AI CFO Error',
        description: error.message || 'Failed to get advice',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setMessages(prev => [...prev, {
      role: 'user',
      content: input,
      timestamp: new Date(),
    }]);

    askAICFOMutation.mutate(input);
  };

  const quickQuestions = [
    { q: "What are my biggest expenses?", icon: "📊" },
    { q: "How's my cash flow looking?", icon: "💰" },
    { q: "What's my profit margin?", icon: "📈" },
    { q: "Any financial risks I should know?", icon: "⚠️" },
    { q: "How can I reduce expenses?", icon: "✂️" },
    { q: "Revenue forecast for next quarter?", icon: "🔮" },
  ];

  // Determine whether we have real data loaded
  const hasRealData = !!(stats && (stats.revenue > 0 || stats.expenses > 0 || stats.totalInvoices > 0 || stats.totalEntries > 0));

  // Cash Flow Summary computed from stats
  const cashFlow = useMemo(() => {
    const cashIn = stats?.revenue || 0;
    const cashOut = stats?.expenses || 0;
    const net = cashIn - cashOut;
    return { cashIn, cashOut, net };
  }, [stats]);

  // Financial Health Score (0-100) computed from real data
  const healthScore = useMemo(() => {
    if (!stats && !profitLoss) return { score: 0, grade: 'N/A' as string, breakdown: [] as { label: string; points: number; max: number }[] };

    const revenue = profitLoss?.totalRevenue || stats?.revenue || 0;
    const expenses = profitLoss?.totalExpenses || stats?.expenses || 0;
    const outstanding = stats?.outstanding || 0;

    // Profit margin score (25 points) - higher margin = better
    const profitMargin = revenue > 0 ? ((revenue - expenses) / revenue) * 100 : 0;
    let profitScore = 0;
    if (profitMargin >= 20) profitScore = 25;
    else if (profitMargin >= 10) profitScore = 20;
    else if (profitMargin >= 5) profitScore = 15;
    else if (profitMargin > 0) profitScore = 10;
    else profitScore = 0;

    // Outstanding ratio score (25 points) - lower outstanding = better
    const outstandingRatio = revenue > 0 ? (outstanding / revenue) * 100 : 0;
    let outstandingScore = 0;
    if (outstandingRatio <= 10) outstandingScore = 25;
    else if (outstandingRatio <= 20) outstandingScore = 20;
    else if (outstandingRatio <= 30) outstandingScore = 15;
    else if (outstandingRatio <= 50) outstandingScore = 10;
    else outstandingScore = 5;

    // Expense ratio score (25 points) - lower expense ratio = better
    const expenseRatio = revenue > 0 ? (expenses / revenue) * 100 : 0;
    let expenseScore = 0;
    if (expenseRatio <= 60) expenseScore = 25;
    else if (expenseRatio <= 70) expenseScore = 20;
    else if (expenseRatio <= 80) expenseScore = 15;
    else if (expenseRatio <= 90) expenseScore = 10;
    else expenseScore = 5;

    // Data completeness score (25 points) - more records = better
    const totalRecords = (stats?.totalInvoices || 0) + (stats?.totalEntries || 0);
    let dataScore = 0;
    if (totalRecords >= 50) dataScore = 25;
    else if (totalRecords >= 20) dataScore = 20;
    else if (totalRecords >= 10) dataScore = 15;
    else if (totalRecords >= 5) dataScore = 10;
    else if (totalRecords > 0) dataScore = 5;
    else dataScore = 0;

    const total = profitScore + outstandingScore + expenseScore + dataScore;
    let grade = 'F';
    if (total >= 90) grade = 'A';
    else if (total >= 75) grade = 'B';
    else if (total >= 60) grade = 'C';
    else if (total >= 40) grade = 'D';

    return {
      score: total,
      grade,
      breakdown: [
        { label: 'Profit Margin', points: profitScore, max: 25 },
        { label: 'Outstanding Ratio', points: outstandingScore, max: 25 },
        { label: 'Expense Ratio', points: expenseScore, max: 25 },
        { label: 'Data Completeness', points: dataScore, max: 25 },
      ],
    };
  }, [stats, profitLoss]);

  // Smart Alerts computed from real data
  const smartAlerts = useMemo(() => {
    const alerts: { type: 'warning' | 'action' | 'info'; title: string; description: string; icon: any }[] = [];
    const revenue = stats?.revenue || 0;
    const expenses = stats?.expenses || 0;
    const outstanding = stats?.outstanding || 0;

    // High expense ratio
    if (revenue > 0 && (expenses / revenue) > 0.8) {
      alerts.push({
        type: 'warning',
        title: 'High Expense Ratio',
        description: `Your expenses are ${((expenses / revenue) * 100).toFixed(0)}% of revenue. This leaves very thin margins. Review your largest expense categories for savings.`,
        icon: AlertTriangle,
      });
    }

    // Outstanding invoices too high
    if (revenue > 0 && (outstanding / revenue) > 0.3) {
      alerts.push({
        type: 'action',
        title: 'Collect Outstanding Invoices',
        description: `${formatCurrency(outstanding, 'AED')} outstanding (${((outstanding / revenue) * 100).toFixed(0)}% of revenue). Send payment reminders to improve cash flow.`,
        icon: DollarSign,
      });
    }

    // Negative net cash flow
    if (revenue > 0 && expenses > revenue) {
      alerts.push({
        type: 'warning',
        title: 'Negative Cash Flow',
        description: `Expenses exceed revenue by ${formatCurrency(expenses - revenue, 'AED')}. Urgent action needed to restore profitability.`,
        icon: XCircle,
      });
    }

    // Low data completeness
    const totalRecords = (stats?.totalInvoices || 0) + (stats?.totalEntries || 0);
    if (totalRecords < 5 && totalRecords > 0) {
      alerts.push({
        type: 'info',
        title: 'Add More Financial Data',
        description: 'You have very few records. Scan receipts and create invoices to get more accurate financial insights.',
        icon: Receipt,
      });
    }

    // Good profit margin
    if (revenue > 0 && ((revenue - expenses) / revenue) > 0.2) {
      alerts.push({
        type: 'info',
        title: 'Healthy Profit Margin',
        description: `Your profit margin is ${(((revenue - expenses) / revenue) * 100).toFixed(1)}%. This is above the 20% healthy threshold. Keep it up!`,
        icon: CheckCircle2,
      });
    }

    // No invoices at all
    if ((stats?.totalInvoices || 0) === 0 && stats) {
      alerts.push({
        type: 'info',
        title: 'Get Started with Invoicing',
        description: 'Create your first invoice to start tracking revenue and unlock more AI insights.',
        icon: FileText,
      });
    }

    return alerts;
  }, [stats]);

  // TODO: Replace with actual monthly data from API
  const chartData = [
    { month: 'Jan', revenue: 45000, expenses: 38000 },
    { month: 'Feb', revenue: 52000, expenses: 41000 },
    { month: 'Mar', revenue: 58000, expenses: 39000 },
    { month: 'Apr', revenue: 62000, expenses: 42000 },
    { month: 'May', revenue: 68000, expenses: 45000 },
    { month: 'Jun', revenue: 72000, expenses: 48000 },
  ];

  const profitMarginData = [
    { category: 'Q1', profit: 18 },
    { category: 'Q2', profit: 22 },
    { category: 'Q3', profit: 25 },
    { category: 'Q4', profit: 28 },
  ];

  // Note: Sample data for demonstration — replace with actual expense data from API
  const expenseBreakdown = [
    { name: 'Salaries', value: 35000, percentage: 31 },
    { name: 'Operations', value: 28000, percentage: 25 },
    { name: 'Marketing', value: 18000, percentage: 16 },
    { name: 'Infrastructure', value: 15000, percentage: 13 },
    { name: 'Other', value: 16645, percentage: 15 },
  ];

  const recommendations = [
    {
      title: "Optimize Expense Allocation",
      description: "Your salaries represent 31% of revenue. Industry benchmark is 28%. Consider reviewing compensation structure.",
      priority: "high",
      impact: "Could save AED 12,500/month",
    },
    {
      title: "Improve Payment Collection",
      description: "Outstanding invoices total AED 45,000. Implementing automated reminders could accelerate cash flow by 15%.",
      priority: "high",
      impact: "AED 6,750 faster collection",
    },
    {
      title: "Seasonal Revenue Patterns",
      description: "Historical data shows 18% revenue increase in Q4. Prepare inventory and staffing accordingly.",
      priority: "medium",
      impact: "Better Q4 planning",
    },
    {
      title: "VAT Optimization Opportunity",
      description: "Review Q2 transactions. Potential VAT recovery found on equipment purchases.",
      priority: "medium",
      impact: "Possible AED 3,200 recovery",
    },
  ];

  const kpis: KPI[] = [
    {
      label: 'Profit Margin',
      value: profitLoss ? ((profitLoss.netProfit / (profitLoss.totalRevenue || 1)) * 100) : 0,
      trend: 2.5,
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
    },
    {
      label: 'Expense Ratio',
      value: profitLoss ? ((profitLoss.totalExpenses / (profitLoss.totalRevenue || 1)) * 100) : 0,
      trend: -1.2,
      icon: BarChart3,
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Revenue Growth',
      value: 12.5,
      trend: 3.8,
      icon: ArrowUp,
      color: 'text-purple-600 dark:text-purple-400',
    },
    {
      label: 'Cash Health',
      value: 85,
      trend: 5,
      icon: DollarSign,
      color: 'text-amber-600 dark:text-amber-400',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-4 md:p-6 lg:p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg bg-primary/20">
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">AI CFO & Financial Advisor</h1>
              <p className="text-muted-foreground mt-1">
                Real-time financial intelligence powered by Muhasib AI
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -mr-32 -mt-32 blur-3xl" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-fit">
          <TabsTrigger value="overview" className="gap-2">
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="insights" className="gap-2">
            <Zap className="w-4 h-4" />
            <span className="hidden sm:inline">Insights</span>
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-2">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">Chat</span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((kpi, idx) => {
              const Icon = kpi.icon;
              return (
                <Card key={idx} className="hover-elevate cursor-pointer transition-all">
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{kpi.label}</CardTitle>
                    <Icon className={`w-4 h-4 ${kpi.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className={`text-3xl font-bold ${kpi.color}`}>
                      {Math.round(kpi.value)}%
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                      {kpi.trend >= 0 ? (
                        <ArrowUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                      ) : (
                        <ArrowDown className="w-3 h-3 text-red-600 dark:text-red-400" />
                      )}
                      <span className={`text-xs font-medium ${kpi.trend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {Math.abs(kpi.trend).toFixed(1)}% {kpi.trend >= 0 ? 'increase' : 'decrease'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Cash Flow Summary + Financial Health Score */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cash Flow Summary Card */}
            <Card className="hover-elevate">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Cash Flow Summary
                </CardTitle>
                <CardDescription>This month's cash movement</CardDescription>
              </CardHeader>
              <CardContent>
                {stats ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm text-muted-foreground">Cash In (Paid Invoices)</span>
                      </div>
                      <span className="font-mono font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(cashFlow.cashIn, 'AED')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-sm text-muted-foreground">Cash Out (Expenses)</span>
                      </div>
                      <span className="font-mono font-bold text-red-600 dark:text-red-400">
                        {formatCurrency(cashFlow.cashOut, 'AED')}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Net Cash Flow</span>
                      <span className={`font-mono text-xl font-bold ${cashFlow.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {cashFlow.net >= 0 ? '+' : ''}{formatCurrency(cashFlow.net, 'AED')}
                      </span>
                    </div>
                    {cashFlow.cashIn > 0 && (
                      <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${cashFlow.net >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(100, (cashFlow.cashIn / (cashFlow.cashIn + cashFlow.cashOut || 1)) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Financial Health Score */}
            <Card className="hover-elevate">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Financial Health Score
                </CardTitle>
                <CardDescription>Overall business health assessment</CardDescription>
              </CardHeader>
              <CardContent>
                {(stats || profitLoss) ? (
                  <div className="flex items-start gap-6">
                    {/* Score Circle */}
                    <div className="relative flex-shrink-0">
                      <svg width="100" height="100" viewBox="0 0 100 100" className="transform -rotate-90">
                        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
                        <circle
                          cx="50" cy="50" r="42" fill="none"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${(healthScore.score / 100) * 264} 264`}
                          className={
                            healthScore.score >= 75 ? 'text-green-500' :
                            healthScore.score >= 50 ? 'text-amber-500' :
                            'text-red-500'
                          }
                          stroke="currentColor"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-2xl font-bold ${
                          healthScore.score >= 75 ? 'text-green-600 dark:text-green-400' :
                          healthScore.score >= 50 ? 'text-amber-600 dark:text-amber-400' :
                          'text-red-600 dark:text-red-400'
                        }`}>
                          {healthScore.score}
                        </span>
                        <span className={`text-xs font-bold ${
                          healthScore.score >= 75 ? 'text-green-600 dark:text-green-400' :
                          healthScore.score >= 50 ? 'text-amber-600 dark:text-amber-400' :
                          'text-red-600 dark:text-red-400'
                        }`}>
                          Grade {healthScore.grade}
                        </span>
                      </div>
                    </div>
                    {/* Breakdown */}
                    <div className="flex-1 space-y-2">
                      {healthScore.breakdown.map((item, idx) => (
                        <div key={idx} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{item.label}</span>
                            <span className="font-mono font-medium">{item.points}/{item.max}</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                item.points >= 20 ? 'bg-green-500' :
                                item.points >= 15 ? 'bg-amber-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${(item.points / item.max) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-24 rounded-full" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Main Financial Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                {stats ? (
                  <>
                    <div className="text-3xl font-bold font-mono text-green-600 dark:text-green-400">
                      {formatCurrency(stats.revenue || 0, 'AED')}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {stats.totalInvoices || 0} invoices • Last 30 days
                    </p>
                  </>
                ) : (
                  <Skeleton className="h-10 w-40" />
                )}
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <ArrowDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </CardHeader>
              <CardContent>
                {stats ? (
                  <>
                    <div className="text-3xl font-bold font-mono text-blue-600 dark:text-blue-400">
                      {formatCurrency(stats.expenses || 0, 'AED')}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {stats.totalEntries || 0} entries • Last 30 days
                    </p>
                  </>
                ) : (
                  <Skeleton className="h-10 w-40" />
                )}
              </CardContent>
            </Card>

            <Card className={`hover-elevate ${(profitLoss?.netProfit || 0) >= 0 ? 'border-green-200 dark:border-green-900' : 'border-red-200 dark:border-red-900'}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                <Target className={`w-4 h-4 ${(profitLoss?.netProfit || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} />
              </CardHeader>
              <CardContent>
                {profitLoss ? (
                  <>
                    <div className={`text-3xl font-bold font-mono ${(profitLoss.netProfit || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatCurrency(profitLoss.netProfit || 0, 'AED')}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {profitLoss.totalRevenue ? `${((profitLoss.netProfit / profitLoss.totalRevenue) * 100).toFixed(1)}% margin` : 'Calculating...'}
                    </p>
                  </>
                ) : (
                  <Skeleton className="h-10 w-40" />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Outstanding */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Outstanding Invoices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats ? (
                  <>
                    <div className="text-3xl font-bold font-mono text-amber-600 dark:text-amber-400">
                      {formatCurrency(stats.outstanding || 0, 'AED')}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      You have outstanding amounts that need follow-up. Send reminders to improve cash flow.
                    </p>
                    <Button variant="outline" size="sm" className="w-fit">
                      View Outstanding Invoices
                    </Button>
                  </>
                ) : (
                  <Skeleton className="h-10 w-40" />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue vs Expenses Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue vs Expenses Trend</CardTitle>
                <CardDescription>Last 6 months performance{!hasRealData ? ' (Sample Data)' : ''}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(Number(value), 'AED')} />
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
              </CardContent>
            </Card>

            {/* Profit Margin Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Profit Margin Trend</CardTitle>
                <CardDescription>Quarterly performance</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={profitMarginData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip />
                    <Bar 
                      dataKey="profit" 
                      fill="hsl(var(--primary))" 
                      name="Profit Margin %"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Expense Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="w-4 h-4" />
                Expense Breakdown
              </CardTitle>
              <CardDescription>Distribution of expenses by category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {expenseBreakdown.map((item, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="text-sm font-mono font-bold">{item.percentage}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div 
                        className="bg-primary h-full" 
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{formatCurrency(item.value, 'AED')}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-6">
          {/* Smart Alerts - dynamic from real data */}
          {smartAlerts.length > 0 ? (
            <div className="grid gap-4">
              {smartAlerts.map((alert, idx) => {
                const AlertIcon = alert.icon;
                const alertStyles = alert.type === 'warning'
                  ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20'
                  : alert.type === 'action'
                  ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20'
                  : 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20';
                const badgeVariant = alert.type === 'warning' ? 'destructive' as const : 'secondary' as const;
                const badgeLabel = alert.type === 'warning' ? 'Warning' : alert.type === 'action' ? 'Action Needed' : 'Insight';

                return (
                  <Card key={idx} className={`hover-elevate border-2 ${alertStyles}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg mt-0.5 ${
                            alert.type === 'warning' ? 'bg-red-100 dark:bg-red-900/30' :
                            alert.type === 'action' ? 'bg-amber-100 dark:bg-amber-900/30' :
                            'bg-blue-100 dark:bg-blue-900/30'
                          }`}>
                            <AlertIcon className={`w-4 h-4 ${
                              alert.type === 'warning' ? 'text-red-600 dark:text-red-400' :
                              alert.type === 'action' ? 'text-amber-600 dark:text-amber-400' :
                              'text-blue-600 dark:text-blue-400'
                            }`} />
                          </div>
                          <div className="space-y-1">
                            <CardTitle className="text-base">{alert.title}</CardTitle>
                            <CardDescription className="text-sm">{alert.description}</CardDescription>
                          </div>
                        </div>
                        <Badge variant={badgeVariant}>
                          {badgeLabel}
                        </Badge>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-3 rounded-full bg-muted mb-4">
                  <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="font-semibold mb-1">All Clear</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  No alerts at this time. Your financial metrics look healthy. Keep recording transactions for better insights.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Static recommendations shown only when there is no real data */}
          {!hasRealData && (
            <div className="grid gap-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Sample Recommendations — add financial data to see real insights</p>
              {recommendations.map((rec, idx) => {
                const priorityColor = rec.priority === 'high'
                  ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20'
                  : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20';

                return (
                  <Card key={idx} className={`hover-elevate border-2 opacity-60 ${priorityColor}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <CardTitle className="text-base">{rec.title}</CardTitle>
                          <CardDescription>{rec.description}</CardDescription>
                        </div>
                        <Badge variant={rec.priority === 'high' ? 'destructive' : 'secondary'}>
                          {rec.priority === 'high' ? 'High Priority' : 'Medium Priority'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="text-sm text-muted-foreground">Potential Impact:</span>
                        <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                          {rec.impact}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                AI-Powered Smart Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                These alerts are generated in real-time by analyzing your invoices, expenses, and cash flow patterns. They update automatically as your data changes. Use the Chat tab to discuss any alert with your AI advisor.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="space-y-6">
          <Card className="flex flex-col h-[600px]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                Chat with Your AI CFO
              </CardTitle>
              <CardDescription>
                Ask questions about your finances and get personalized advice
              </CardDescription>
            </CardHeader>

            {/* Messages Area */}
            <CardContent className="flex-1 flex flex-col overflow-hidden pb-4">
              <ScrollArea className="flex-1 pr-4 mb-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-6">
                    <div className="p-4 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 mb-4">
                      <MessageSquare className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-1">Ask me anything about your finances</h3>
                    <p className="text-sm text-muted-foreground mb-6 max-w-md">
                      Your AI CFO has access to your invoices, expenses, and financial reports. Try one of these questions to get started.
                    </p>
                    <div className="w-full max-w-md space-y-2">
                      {[
                        { q: "What's my profit margin this quarter?", icon: TrendingUp },
                        { q: "How much VAT do I owe?", icon: Receipt },
                        { q: "Which customers owe me money?", icon: DollarSign },
                        { q: "Suggest ways to reduce expenses", icon: ArrowDown },
                        { q: "What's my cash flow forecast?", icon: Activity },
                        { q: "Am I ready for VAT filing?", icon: FileText },
                      ].map((item, i) => {
                        const Icon = item.icon;
                        return (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-left h-auto py-3 gap-3 hover:bg-primary/5 hover:border-primary/30 transition-colors"
                            onClick={() => setInput(item.q)}
                            data-testid={`button-quick-question-${i}`}
                          >
                            <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                            <span className="text-sm">{item.q}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={`max-w-[75%] rounded-lg p-3 ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                          <p className="text-xs opacity-70 mt-2">
                            {msg.timestamp.toLocaleTimeString()}
                          </p>
                        </div>
                        {msg.role === 'user' && (
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
                          <p className="text-sm text-muted-foreground">AI is thinking...</p>
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
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Suggested questions:</p>
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
                  placeholder="Ask about expenses, revenue, cash flow, tax optimization..."
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
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Send Message
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
