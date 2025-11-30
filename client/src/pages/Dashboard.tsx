import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency, formatDate } from '@/lib/format';
import { 
  TrendingUp, TrendingDown, DollarSign, AlertCircle, FileText, 
  Plus, Receipt, BookOpen, Sparkles, ArrowRight, Clock, CheckCircle2,
  Zap, BarChart3
} from 'lucide-react';
import { 
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, 
  XAxis, YAxis, Tooltip, Legend, AreaChart, Area, BarChart, Bar
} from 'recharts';
import { Link } from 'wouter';

export default function Dashboard() {
  const { t, locale } = useTranslation();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<any>({
    queryKey: ['/api/companies', selectedCompanyId, 'dashboard/stats'],
    enabled: !!selectedCompanyId,
    retry: 1,
  });

  const { data: recentInvoices, isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'invoices'],
    enabled: !!selectedCompanyId,
  });

  const { data: journalEntries } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'journal'],
    enabled: !!selectedCompanyId,
  });

  const { data: expenseData, isLoading: expenseLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'dashboard/expense-breakdown'],
    enabled: !!selectedCompanyId,
  });

  const { data: monthlyTrends, isLoading: trendsLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'dashboard/monthly-trends'],
    enabled: !!selectedCompanyId,
  });

  const COLORS = [
    'hsl(211, 85%, 42%)', // Primary blue
    'hsl(142, 76%, 36%)', // Green
    'hsl(45, 93%, 47%)',  // Yellow
    'hsl(0, 84%, 60%)',   // Red
    'hsl(262, 83%, 58%)', // Purple
  ];


  const QuickActionCard = ({ icon: Icon, title, description, href, color }: any) => (
    <Link href={href}>
      <div className="h-full p-6 rounded-lg border bg-gradient-to-br hover-elevate active-elevate-2 transition-all duration-300 cursor-pointer group overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/5 dark:from-white/0 dark:to-white/5" />
        <div className={`w-12 h-12 rounded-lg ${color} bg-opacity-15 dark:bg-opacity-25 flex items-center justify-center mb-4 group-hover:scale-125 group-hover:shadow-lg transition-all duration-300 relative z-10`}>
          <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
        </div>
        <h3 className="font-semibold mb-2 text-sm relative z-10">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4 relative z-10">{description}</p>
        <div className="flex items-center text-sm font-medium text-primary group-hover:gap-2 transition-all relative z-10">
          <span>Get started</span>
          <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-2 transition-transform" />
        </div>
      </div>
    </Link>
  );

  const StatCard = ({ icon: Icon, title, value, change, trend, color, isLoading }: any) => (
    <Card className={`overflow-hidden relative group hover-elevate active-elevate-2 transition-all duration-300 ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '600ms' }}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/5 dark:from-white/0 dark:via-white/0 dark:to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2 relative z-10">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`w-10 h-10 rounded-lg ${color} bg-opacity-15 dark:bg-opacity-25 flex items-center justify-center group-hover:scale-110 transition-transform`}>
          <Icon className={`w-5 h-5 ${color.replace('bg-', 'text-')}`} />
        </div>
      </CardHeader>
      <CardContent className="relative z-10">
        {isLoading ? (
          <Skeleton className="h-9 w-32" />
        ) : (
          <>
            <div className="text-3xl font-bold font-mono group-hover:text-primary/80 transition-colors" data-testid={`text-${title.toLowerCase().replace(' ', '-')}`}>
              {value}
            </div>
            {change && (
              <div className="flex items-center gap-2 mt-3 p-2 rounded bg-white/0 dark:bg-white/0 group-hover:bg-white/5 dark:group-hover:bg-white/5 transition-colors">
                {trend === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                )}
                <span className={`text-sm font-bold ${trend === 'up' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {change}
                </span>
                <span className="text-xs text-muted-foreground">vs last month</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className={`${mounted ? 'animate-in fade-in slide-in-from-top-4' : ''}`} style={{ animationDuration: '500ms' }}>
        <div className="relative overflow-hidden rounded-2xl p-8 mb-8 bg-gradient-to-br from-primary/10 via-transparent to-accent/5 dark:from-primary/5 dark:via-transparent dark:to-accent/10 border border-primary/10 dark:border-primary/5">
          <div className="absolute inset-0 bg-grid-white/5 dark:bg-grid-white/5" style={{ backgroundSize: '40px 40px' }} />
          <div className="relative z-10">
            <div className="flex items-start justify-between flex-wrap gap-6">
              <div className="max-w-2xl">
                <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-primary via-primary/80 to-accent bg-clip-text text-transparent">
                  {t.dashboard}
                </h1>
                <p className="text-base md:text-lg text-muted-foreground">
                  Welcome back! Here's your financial overview for <span className="font-semibold text-foreground">{new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>.
                </p>
              </div>
              <div className="flex gap-3 flex-wrap justify-end">
                <Link href="/invoices">
                  <Button size="default" variant="outline" data-testid="button-quick-invoice" className="gap-2">
                    <FileText className="w-4 h-4" />
                    New Invoice
                  </Button>
                </Link>
                <Link href="/receipts">
                  <Button size="default" data-testid="button-quick-receipt" className="gap-2">
                    <Receipt className="w-4 h-4" />
                    Scan Receipt
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Insights Panel */}
      {!statsLoading && stats && (stats.revenue > 0 || stats.expenses > 0 || stats.outstanding > 0) && (
        <div className={`${mounted ? 'animate-in fade-in slide-in-from-top-5' : ''}`} style={{ animationDelay: '100ms', animationDuration: '500ms' }}>
          <Card className="relative overflow-hidden bg-gradient-to-br from-primary/15 to-accent/5 dark:from-primary/10 dark:to-accent/5 border-primary/20 hover-elevate transition-all group">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <CardContent className="flex items-start gap-4 p-6 relative z-10">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 dark:from-primary/20 dark:to-primary/5 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                <Sparkles className="w-6 h-6 text-primary animate-pulse" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  AI Financial Insights
                  <Badge className="bg-primary/20 text-primary dark:bg-primary/10 text-xs font-semibold">Real-time</Badge>
                </h3>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  {stats.revenue > 0 && stats.expenses > 0 && (
                    <>
                      Your profit margin is <span className="font-semibold text-foreground">{(((stats.revenue - stats.expenses) / stats.revenue) * 100).toFixed(0)}%</span>. 
                      {stats.outstanding > 0 && (
                        <> You have <span className="font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(stats.outstanding, 'AED', locale)}</span> in outstanding invoices that need attention.</>
                      )}
                    </>
                  )}
                  {stats.revenue === 0 && stats.expenses === 0 && stats.outstanding > 0 && (
                    <>You have <span className="font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(stats.outstanding, 'AED', locale)}</span> in outstanding invoices.</>
                  )}
                  {stats.revenue === 0 && stats.expenses === 0 && stats.outstanding === 0 && (
                    <>Start tracking your finances by creating invoices and journal entries to get insights.</>
                  )}
                </p>
                <Link href="/ai-cfo">
                  <Button size="sm" variant="ghost" className="gap-2 px-0 text-primary hover:text-primary/80">
                    <span className="font-semibold">Talk to AI CFO</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={TrendingUp}
          title="Revenue"
          value={formatCurrency(stats?.revenue || 0, 'AED', locale)}
          color="bg-green-600"
          isLoading={statsLoading}
        />
        <StatCard
          icon={TrendingDown}
          title="Expenses"
          value={formatCurrency(stats?.expenses || 0, 'AED', locale)}
          color="bg-red-600"
          isLoading={statsLoading}
        />
        <StatCard
          icon={DollarSign}
          title="Profit"
          value={formatCurrency((stats?.revenue || 0) - (stats?.expenses || 0), 'AED', locale)}
          color="bg-blue-600"
          isLoading={statsLoading}
        />
        <StatCard
          icon={AlertCircle}
          title="Outstanding"
          value={formatCurrency(stats?.outstanding || 0, 'AED', locale)}
          color="bg-amber-600"
          isLoading={statsLoading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue & Expenses Trend */}
        <Card className={`overflow-hidden hover-elevate transition-all ${mounted ? 'animate-in fade-in slide-in-from-left-4' : ''}`} style={{ animationDelay: '200ms', animationDuration: '600ms' }}>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/20 dark:to-emerald-900/20 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                Revenue vs Expenses
              </CardTitle>
              <Badge variant="outline" className="text-xs font-semibold bg-white/50 dark:bg-white/5">Last 6 months</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {trendsLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (monthlyTrends && monthlyTrends.length > 0) ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={monthlyTrends}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value/1000}k`} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                  formatter={(value: any) => formatCurrency(value, 'AED', locale)}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(142, 76%, 36%)" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" name="Revenue" />
                <Area type="monotone" dataKey="expenses" stroke="hsl(0, 84%, 60%)" strokeWidth={2} fillOpacity={1} fill="url(#colorExpenses)" name="Expenses" />
              </AreaChart>
            </ResponsiveContainer>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No revenue data yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expense Breakdown */}
        <Card className={`overflow-hidden hover-elevate transition-all ${mounted ? 'animate-in fade-in slide-in-from-right-4' : ''}`} style={{ animationDelay: '200ms', animationDuration: '600ms' }}>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/20 dark:to-amber-900/20 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              </div>
              {t.expenseBreakdown}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expenseLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (expenseData && expenseData.length > 0) ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={expenseData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={90}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {expenseData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                    formatter={(value: any) => formatCurrency(value, 'AED', locale)}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm mb-4">No expense data yet</p>
                <Link href="/journal">
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Create journal entry
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions Grid */}
      <div className={`${mounted ? 'animate-in fade-in slide-in-from-bottom-3' : ''}`} style={{ animationDelay: '250ms', animationDuration: '600ms' }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Quick Actions</h2>
          <div className="h-1 flex-1 ml-4 bg-gradient-to-r from-primary/30 to-transparent rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickActionCard
            icon={Plus}
            title="Create Invoice"
            description="Generate professional UAE-compliant invoices"
            href="/invoices"
            color="bg-blue-600"
          />
          <QuickActionCard
            icon={Receipt}
            title="Scan Receipt"
            description="AI-powered OCR expense tracking"
            href="/receipts"
            color="bg-green-600"
          />
          <QuickActionCard
            icon={BookOpen}
            title="Journal Entry"
            description="Record double-entry transactions"
            href="/journal"
            color="bg-purple-600"
          />
          <QuickActionCard
            icon={BarChart3}
            title="View Reports"
            description="Financial reports and analysis"
            href="/reports"
            color="bg-orange-600"
          />
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <Card className={`overflow-hidden hover-elevate transition-all ${mounted ? 'animate-in fade-in slide-in-from-left-4' : ''}`} style={{ animationDelay: '300ms', animationDuration: '600ms' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              {t.recentInvoices}
            </CardTitle>
            <Link href="/invoices">
              <Button variant="ghost" size="sm" className="gap-1 text-primary">
                <span>View all</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-6">
            {invoicesLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : recentInvoices && recentInvoices.length > 0 ? (
              <div className="space-y-3">
                {recentInvoices.slice(0, 5).map((invoice: any) => (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-white/50 dark:bg-white/5 hover-elevate transition-all group"
                    data-testid={`invoice-${invoice.id}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{invoice.customerName}</div>
                        <div className="text-xs text-muted-foreground font-mono">INV-{invoice.number}</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <div className="font-mono font-bold group-hover:text-primary transition-colors">
                        {formatCurrency(invoice.total, invoice.currency, locale)}
                      </div>
                      <Badge 
                        variant="outline" 
                        className={`text-xs mt-1 font-semibold ${
                          invoice.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800' :
                          invoice.status === 'sent' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                          invoice.status === 'void' ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400 border-gray-200 dark:border-gray-800' :
                          'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        {t[invoice.status as keyof typeof t]}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm mb-4">{t.noData}</p>
                <Link href="/invoices">
                  <Button variant="outline" size="sm" className="gap-1">
                    <Plus className="w-4 h-4" />
                    Create your first invoice
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card className={`overflow-hidden hover-elevate transition-all ${mounted ? 'animate-in fade-in slide-in-from-right-4' : ''}`} style={{ animationDelay: '350ms', animationDuration: '600ms' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              Recent Activity
            </CardTitle>
            <Link href="/journal">
              <Button variant="ghost" size="sm" className="gap-1 text-primary">
                <span>View all</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-6">
            {journalEntries && journalEntries.length > 0 ? (
              <div className="space-y-3">
                {journalEntries.slice(0, 5).map((entry: any) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 p-4 rounded-lg border bg-white/50 dark:bg-white/5 hover-elevate transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                      <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{entry.memo || 'Journal Entry'}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(entry.date, locale)}
                      </div>
                    </div>
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 text-xs font-semibold">Posted</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm mb-4">No transactions yet</p>
                <Link href="/journal">
                  <Button variant="outline" size="sm" className="gap-1">
                    <Plus className="w-4 h-4" />
                    Create journal entry
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
