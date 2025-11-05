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

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ['/api/companies', selectedCompanyId, 'dashboard/stats'],
    enabled: !!selectedCompanyId,
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
      <div className="h-full p-6 rounded-lg border bg-card hover-elevate active-elevate-2 transition-all duration-200 cursor-pointer group">
        <div className={`w-12 h-12 rounded-lg ${color} bg-opacity-10 dark:bg-opacity-20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
          <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
        </div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="mt-4 flex items-center text-sm font-medium text-primary">
          <span>Get started</span>
          <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );

  const StatCard = ({ icon: Icon, title, value, change, trend, color, isLoading }: any) => (
    <Card className={`overflow-hidden ${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDuration: '600ms' }}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`w-10 h-10 rounded-lg ${color} bg-opacity-10 dark:bg-opacity-20 flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${color.replace('bg-', 'text-')}`} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-9 w-32" />
        ) : (
          <>
            <div className="text-3xl font-bold font-mono" data-testid={`text-${title.toLowerCase().replace(' ', '-')}`}>
              {value}
            </div>
            {change && (
              <div className="flex items-center gap-1 mt-2">
                {trend === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                )}
                <span className={`text-sm font-medium ${trend === 'up' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {change}
                </span>
                <span className="text-sm text-muted-foreground">vs last month</span>
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
        <div className="flex items-start justify-between flex-wrap gap-4 mb-2">
          <div>
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              {t.dashboard}
            </h1>
            <p className="text-lg text-muted-foreground">
              Welcome back! Here's your financial overview for {new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' })}.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/invoices">
              <Button size="sm" variant="outline" data-testid="button-quick-invoice">
                <FileText className="w-4 h-4 mr-2" />
                New Invoice
              </Button>
            </Link>
            <Link href="/receipts">
              <Button size="sm" data-testid="button-quick-receipt">
                <Receipt className="w-4 h-4 mr-2" />
                Scan Receipt
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* AI Insights Panel */}
      {!statsLoading && stats && (stats.revenue > 0 || stats.expenses > 0 || stats.outstanding > 0) && (
        <div className={`${mounted ? 'animate-in fade-in slide-in-from-top-5' : ''}`} style={{ animationDelay: '100ms', animationDuration: '500ms' }}>
          <Card className="bg-gradient-to-br from-primary/5 to-primary/10 dark:from-primary/10 dark:to-primary/5 border-primary/20">
            <CardContent className="flex items-start gap-4 p-6">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1 flex items-center gap-2">
                  AI Insights
                  <Badge variant="secondary" className="text-xs">Beta</Badge>
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {stats.revenue > 0 && stats.expenses > 0 && (
                    <>
                      Your profit margin is {(((stats.revenue - stats.expenses) / stats.revenue) * 100).toFixed(0)}%. 
                      {stats.outstanding > 0 && (
                        <> You have outstanding invoices totaling {formatCurrency(stats.outstanding, 'AED', locale)} that need attention.</>
                      )}
                    </>
                  )}
                  {stats.revenue === 0 && stats.expenses === 0 && stats.outstanding > 0 && (
                    <>You have outstanding invoices totaling {formatCurrency(stats.outstanding, 'AED', locale)}.</>
                  )}
                  {stats.revenue === 0 && stats.expenses === 0 && stats.outstanding === 0 && (
                    <>Start tracking your finances by creating invoices and journal entries.</>
                  )}
                </p>
                <Link href="/ai-tools">
                  <Button size="sm" variant="ghost" className="gap-1 px-0">
                    <span>Explore AI tools</span>
                    <ArrowRight className="w-4 h-4" />
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
        <Card className={`${mounted ? 'animate-in fade-in slide-in-from-left-4' : ''}`} style={{ animationDelay: '200ms', animationDuration: '600ms' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Revenue vs Expenses
              </CardTitle>
              <Badge variant="outline" className="text-xs">Last 6 months</Badge>
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
        <Card className={`${mounted ? 'animate-in fade-in slide-in-from-right-4' : ''}`} style={{ animationDelay: '200ms', animationDuration: '600ms' }}>
          <CardHeader>
            <CardTitle>{t.expenseBreakdown}</CardTitle>
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
      <div>
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
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
            icon={Zap}
            title="AI Categorize"
            description="Automatically categorize expenses"
            href="/ai-tools"
            color="bg-amber-600"
          />
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <Card className={`${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '300ms', animationDuration: '600ms' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {t.recentInvoices}
            </CardTitle>
            <Link href="/invoices">
              <Button variant="ghost" size="sm" className="gap-1">
                <span>View all</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
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
                    className="flex items-center justify-between p-3 rounded-lg border hover-elevate transition-all"
                    data-testid={`invoice-${invoice.id}`}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{invoice.customerName}</div>
                        <div className="text-sm text-muted-foreground font-mono">#{invoice.number}</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <div className="font-mono font-semibold">
                        {formatCurrency(invoice.total, invoice.currency, locale)}
                      </div>
                      <Badge 
                        variant="outline" 
                        className={`text-xs mt-1 ${
                          invoice.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-green-200' :
                          invoice.status === 'sent' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200' :
                          invoice.status === 'void' ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400 border-gray-200' :
                          'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200'
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
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Create your first invoice
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card className={`${mounted ? 'animate-in fade-in slide-in-from-bottom-4' : ''}`} style={{ animationDelay: '350ms', animationDuration: '600ms' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Activity
            </CardTitle>
            <Link href="/journal">
              <Button variant="ghost" size="sm" className="gap-1">
                <span>View all</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {journalEntries && journalEntries.length > 0 ? (
              <div className="space-y-3">
                {journalEntries.slice(0, 5).map((entry: any) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 p-3 rounded-lg border hover-elevate transition-all"
                  >
                    <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{entry.memo || 'Journal Entry'}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(entry.date, locale)}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs">Posted</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm mb-4">No transactions yet</p>
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
    </div>
  );
}
