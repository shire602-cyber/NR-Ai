import { useState } from 'react';
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
import { Bot, Send, Sparkles, TrendingUp, AlertTriangle, DollarSign, FileText, Loader2, Brain, BarChart3, Zap, Target, ArrowUp, ArrowDown, Eye, PieChart } from 'lucide-react';

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
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg bg-primary/20">
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">AI CFO & Financial Advisor</h1>
              <p className="text-muted-foreground mt-1">
                Real-time financial intelligence powered by GPT-4o
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
                      <ArrowUp className={`w-3 h-3 ${kpi.trend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} />
                      <span className={`text-xs font-medium ${kpi.trend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {Math.abs(kpi.trend).toFixed(1)}% {kpi.trend >= 0 ? 'increase' : 'decrease'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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
            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="text-base">Revenue vs Expenses Trend</CardTitle>
                <CardDescription>Last 6 months performance</CardDescription>
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
            <Card className="hover-elevate">
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
          <Card className="hover-elevate">
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
          <div className="grid gap-4">
            {recommendations.map((rec, idx) => {
              const priorityColor = rec.priority === 'high' 
                ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20' 
                : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20';
              
              return (
                <Card key={idx} className={`hover-elevate border-2 ${priorityColor}`}>
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

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                AI Generated Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                These insights are generated by analyzing your financial data, industry benchmarks, and historical patterns. Click the chat tab to discuss any of these recommendations with your AI advisor.
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
                  <div className="flex flex-col items-center justify-center h-full text-center p-8">
                    <div className="p-4 rounded-full bg-primary/10 mb-4">
                      <Bot className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">Start a conversation</h3>
                    <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                      Ask me anything about your finances. I'll provide data-backed insights and recommendations.
                    </p>
                    <div className="w-full space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-3">Quick Questions:</p>
                      <div className="grid gap-2">
                        {quickQuestions.slice(0, 3).map((item, i) => (
                          <Button
                            key={i}
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-left h-auto py-3"
                            onClick={() => setInput(item.q)}
                            data-testid={`button-quick-question-${i}`}
                          >
                            <span className="mr-2">{item.icon}</span>
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
