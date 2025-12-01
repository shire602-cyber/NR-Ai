import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, subMonths, startOfMonth, endOfMonth, subQuarters, startOfQuarter, endOfQuarter, subYears, startOfYear, endOfYear, differenceInDays } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from 'recharts';
import { 
  Download, 
  TrendingUp, 
  TrendingDown,
  Calendar,
  Clock,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  DollarSign,
  Users,
  FileText,
  RefreshCw,
  ArrowRightLeft
} from 'lucide-react';
import jsPDF from 'jspdf';

interface CashFlowData {
  period: string;
  operatingInflow: number;
  operatingOutflow: number;
  investingInflow: number;
  investingOutflow: number;
  financingInflow: number;
  financingOutflow: number;
  netCashFlow: number;
  endingBalance: number;
}

interface AgingItem {
  id: string;
  name: string;
  type: 'receivable' | 'payable';
  current: number;
  days30: number;
  days60: number;
  days90: number;
  over90: number;
  total: number;
}

interface PeriodComparison {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function AdvancedReports() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [selectedPeriod, setSelectedPeriod] = useState('quarter');
  const [comparisonPeriod, setComparisonPeriod] = useState('previous');
  const [activeTab, setActiveTab] = useState('cashflow');

  const periodDates = useMemo(() => {
    const now = new Date();
    switch (selectedPeriod) {
      case 'month':
        return {
          current: { start: startOfMonth(now), end: endOfMonth(now) },
          previous: { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) },
        };
      case 'quarter':
        return {
          current: { start: startOfQuarter(now), end: endOfQuarter(now) },
          previous: { start: startOfQuarter(subQuarters(now, 1)), end: endOfQuarter(subQuarters(now, 1)) },
        };
      case 'year':
        return {
          current: { start: startOfYear(now), end: endOfYear(now) },
          previous: { start: startOfYear(subYears(now, 1)), end: endOfYear(subYears(now, 1)) },
        };
      default:
        return {
          current: { start: startOfQuarter(now), end: endOfQuarter(now) },
          previous: { start: startOfQuarter(subQuarters(now, 1)), end: endOfQuarter(subQuarters(now, 1)) },
        };
    }
  }, [selectedPeriod]);

  const { data: cashFlowData, isLoading: isLoadingCashFlow } = useQuery<CashFlowData[]>({
    queryKey: ['/api/reports', companyId, 'cash-flow', selectedPeriod],
    enabled: !!companyId,
  });

  const { data: agingData, isLoading: isLoadingAging } = useQuery<AgingItem[]>({
    queryKey: ['/api/reports', companyId, 'aging'],
    enabled: !!companyId,
  });

  const { data: comparisonData, isLoading: isLoadingComparison } = useQuery<PeriodComparison[]>({
    queryKey: ['/api/reports', companyId, 'comparison', selectedPeriod],
    enabled: !!companyId,
  });

  const agingSummary = useMemo(() => {
    if (!agingData) return { receivables: { current: 0, overdue: 0 }, payables: { current: 0, overdue: 0 } };
    
    const receivables = agingData.filter(a => a.type === 'receivable');
    const payables = agingData.filter(a => a.type === 'payable');
    
    return {
      receivables: {
        current: receivables.reduce((sum, a) => sum + a.current, 0),
        overdue: receivables.reduce((sum, a) => sum + a.days30 + a.days60 + a.days90 + a.over90, 0),
        total: receivables.reduce((sum, a) => sum + a.total, 0),
      },
      payables: {
        current: payables.reduce((sum, a) => sum + a.current, 0),
        overdue: payables.reduce((sum, a) => sum + a.days30 + a.days60 + a.days90 + a.over90, 0),
        total: payables.reduce((sum, a) => sum + a.total, 0),
      },
    };
  }, [agingData]);

  const cashFlowSummary = useMemo(() => {
    if (!cashFlowData || cashFlowData.length === 0) {
      return { operating: 0, investing: 0, financing: 0, net: 0 };
    }
    
    const latest = cashFlowData[cashFlowData.length - 1];
    return {
      operating: (latest.operatingInflow || 0) - (latest.operatingOutflow || 0),
      investing: (latest.investingInflow || 0) - (latest.investingOutflow || 0),
      financing: (latest.financingInflow || 0) - (latest.financingOutflow || 0),
      net: latest.netCashFlow || 0,
      balance: latest.endingBalance || 0,
    };
  }, [cashFlowData]);

  const agingChartData = useMemo(() => {
    return [
      { name: locale === 'ar' ? 'حالي' : 'Current', receivables: agingSummary.receivables.current, payables: agingSummary.payables.current },
      { name: '1-30', receivables: agingData?.filter(a => a.type === 'receivable').reduce((s, a) => s + a.days30, 0) || 0, payables: agingData?.filter(a => a.type === 'payable').reduce((s, a) => s + a.days30, 0) || 0 },
      { name: '31-60', receivables: agingData?.filter(a => a.type === 'receivable').reduce((s, a) => s + a.days60, 0) || 0, payables: agingData?.filter(a => a.type === 'payable').reduce((s, a) => s + a.days60, 0) || 0 },
      { name: '61-90', receivables: agingData?.filter(a => a.type === 'receivable').reduce((s, a) => s + a.days90, 0) || 0, payables: agingData?.filter(a => a.type === 'payable').reduce((s, a) => s + a.days90, 0) || 0 },
      { name: '>90', receivables: agingData?.filter(a => a.type === 'receivable').reduce((s, a) => s + a.over90, 0) || 0, payables: agingData?.filter(a => a.type === 'payable').reduce((s, a) => s + a.over90, 0) || 0 },
    ];
  }, [agingData, agingSummary, locale]);

  const handleExportPDF = (reportType: string) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(20);
    doc.text(`${reportType} Report`, pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Period: ${format(periodDates.current.start, 'MMM yyyy')} - ${format(periodDates.current.end, 'MMM yyyy')}`, 14, 35);
    doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, 42);
    
    doc.save(`${reportType.toLowerCase().replace(' ', '-')}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    
    toast({
      title: 'Report Exported',
      description: `${reportType} report has been downloaded.`,
    });
  };

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {locale === 'ar' ? 'التقارير المتقدمة' : 'Advanced Financial Reports'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'ar' 
              ? 'تحليلات مالية متقدمة ومقارنات الفترات'
              : 'Advanced analytics, cash flow analysis, and period comparisons'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-32" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">{locale === 'ar' ? 'شهري' : 'Monthly'}</SelectItem>
              <SelectItem value="quarter">{locale === 'ar' ? 'ربع سنوي' : 'Quarterly'}</SelectItem>
              <SelectItem value="year">{locale === 'ar' ? 'سنوي' : 'Yearly'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="cashflow" data-testid="tab-cashflow">
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            {locale === 'ar' ? 'التدفق النقدي' : 'Cash Flow'}
          </TabsTrigger>
          <TabsTrigger value="aging" data-testid="tab-aging">
            <Clock className="w-4 h-4 mr-2" />
            {locale === 'ar' ? 'تقادم الأرصدة' : 'Aging Report'}
          </TabsTrigger>
          <TabsTrigger value="comparison" data-testid="tab-comparison">
            <TrendingUp className="w-4 h-4 mr-2" />
            {locale === 'ar' ? 'المقارنات' : 'Period Comparison'}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cashflow" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {locale === 'ar' ? 'الأنشطة التشغيلية' : 'Operating Activities'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${cashFlowSummary.operating >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(cashFlowSummary.operating)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {locale === 'ar' ? 'الأنشطة الاستثمارية' : 'Investing Activities'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${cashFlowSummary.investing >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(cashFlowSummary.investing)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {locale === 'ar' ? 'الأنشطة التمويلية' : 'Financing Activities'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${cashFlowSummary.financing >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(cashFlowSummary.financing)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {locale === 'ar' ? 'صافي التدفق النقدي' : 'Net Cash Flow'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${cashFlowSummary.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(cashFlowSummary.net)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{locale === 'ar' ? 'تحليل التدفق النقدي' : 'Cash Flow Analysis'}</CardTitle>
                <CardDescription>
                  {locale === 'ar' ? 'التدفقات النقدية الداخلة والخارجة' : 'Inflows and outflows over time'}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExportPDF('Cash Flow')}>
                <Download className="w-4 h-4 mr-2" />
                {locale === 'ar' ? 'تصدير' : 'Export'}
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingCashFlow ? (
                <Skeleton className="h-80" />
              ) : cashFlowData && cashFlowData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={cashFlowData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" />
                    <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="operatingInflow" 
                      stackId="1"
                      stroke="#22c55e" 
                      fill="#22c55e" 
                      fillOpacity={0.6}
                      name={locale === 'ar' ? 'التدفق التشغيلي' : 'Operating Inflow'} 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="operatingOutflow" 
                      stackId="2"
                      stroke="#ef4444" 
                      fill="#ef4444" 
                      fillOpacity={0.6}
                      name={locale === 'ar' ? 'التدفق الخارج' : 'Operating Outflow'} 
                    />
                    <Line 
                      type="monotone" 
                      dataKey="endingBalance" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      name={locale === 'ar' ? 'الرصيد الختامي' : 'Ending Balance'} 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-80 text-muted-foreground">
                  {locale === 'ar' ? 'لا توجد بيانات متاحة' : 'No data available for this period'}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {locale === 'ar' ? 'الذمم المدينة' : 'Accounts Receivable'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === 'ar' ? 'حالي' : 'Current'}</span>
                    <span className="font-mono text-green-600">{formatCurrency(agingSummary.receivables.current)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === 'ar' ? 'متأخر' : 'Overdue'}</span>
                    <span className="font-mono text-red-600">{formatCurrency(agingSummary.receivables.overdue)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-medium">
                    <span>{locale === 'ar' ? 'الإجمالي' : 'Total'}</span>
                    <span className="font-mono">{formatCurrency(agingSummary.receivables.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {locale === 'ar' ? 'الذمم الدائنة' : 'Accounts Payable'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === 'ar' ? 'حالي' : 'Current'}</span>
                    <span className="font-mono text-green-600">{formatCurrency(agingSummary.payables.current)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === 'ar' ? 'متأخر' : 'Overdue'}</span>
                    <span className="font-mono text-red-600">{formatCurrency(agingSummary.payables.overdue)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-medium">
                    <span>{locale === 'ar' ? 'الإجمالي' : 'Total'}</span>
                    <span className="font-mono">{formatCurrency(agingSummary.payables.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{locale === 'ar' ? 'تقادم الأرصدة' : 'Aging Analysis'}</CardTitle>
                <CardDescription>
                  {locale === 'ar' ? 'توزيع الأرصدة حسب العمر' : 'Distribution of balances by age'}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExportPDF('Aging')}>
                <Download className="w-4 h-4 mr-2" />
                {locale === 'ar' ? 'تصدير' : 'Export'}
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingAging ? (
                <Skeleton className="h-80" />
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={agingChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Bar 
                      dataKey="receivables" 
                      fill="#3b82f6" 
                      name={locale === 'ar' ? 'الذمم المدينة' : 'Receivables'} 
                    />
                    <Bar 
                      dataKey="payables" 
                      fill="#f97316" 
                      name={locale === 'ar' ? 'الذمم الدائنة' : 'Payables'} 
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {agingData && agingData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{locale === 'ar' ? 'تفاصيل التقادم' : 'Aging Details'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{locale === 'ar' ? 'الاسم' : 'Name'}</TableHead>
                        <TableHead>{locale === 'ar' ? 'النوع' : 'Type'}</TableHead>
                        <TableHead className="text-right">{locale === 'ar' ? 'حالي' : 'Current'}</TableHead>
                        <TableHead className="text-right">1-30</TableHead>
                        <TableHead className="text-right">31-60</TableHead>
                        <TableHead className="text-right">61-90</TableHead>
                        <TableHead className="text-right">&gt;90</TableHead>
                        <TableHead className="text-right">{locale === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agingData.map(item => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>
                            <Badge variant={item.type === 'receivable' ? 'default' : 'secondary'}>
                              {item.type === 'receivable' 
                                ? (locale === 'ar' ? 'مدين' : 'AR')
                                : (locale === 'ar' ? 'دائن' : 'AP')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(item.current)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(item.days30)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(item.days60)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(item.days90)}</TableCell>
                          <TableCell className="text-right font-mono text-red-600">{formatCurrency(item.over90)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatCurrency(item.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="comparison" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{locale === 'ar' ? 'مقارنة الفترات' : 'Period Comparison'}</CardTitle>
                <CardDescription>
                  {format(periodDates.current.start, 'MMM yyyy')} vs {format(periodDates.previous.start, 'MMM yyyy')}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleExportPDF('Comparison')}>
                <Download className="w-4 h-4 mr-2" />
                {locale === 'ar' ? 'تصدير' : 'Export'}
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingComparison ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : comparisonData && comparisonData.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{locale === 'ar' ? 'المقياس' : 'Metric'}</TableHead>
                        <TableHead className="text-right">{locale === 'ar' ? 'الفترة الحالية' : 'Current Period'}</TableHead>
                        <TableHead className="text-right">{locale === 'ar' ? 'الفترة السابقة' : 'Previous Period'}</TableHead>
                        <TableHead className="text-right">{locale === 'ar' ? 'التغيير' : 'Change'}</TableHead>
                        <TableHead className="text-right">%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparisonData.map(item => (
                        <TableRow key={item.metric}>
                          <TableCell className="font-medium">{item.metric}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(item.current)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatCurrency(item.previous)}</TableCell>
                          <TableCell className={`text-right font-mono ${item.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <div className="flex items-center justify-end gap-1">
                              {item.change >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                              {formatCurrency(Math.abs(item.change))}
                            </div>
                          </TableCell>
                          <TableCell className={`text-right font-mono ${item.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  {locale === 'ar' ? 'لا توجد بيانات للمقارنة' : 'No comparison data available'}
                </div>
              )}
            </CardContent>
          </Card>

          {comparisonData && comparisonData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{locale === 'ar' ? 'رسم بياني للمقارنة' : 'Comparison Chart'}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={comparisonData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`} />
                    <YAxis type="category" dataKey="metric" width={120} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Bar 
                      dataKey="current" 
                      fill="#3b82f6" 
                      name={locale === 'ar' ? 'الفترة الحالية' : 'Current Period'} 
                    />
                    <Bar 
                      dataKey="previous" 
                      fill="#94a3b8" 
                      name={locale === 'ar' ? 'الفترة السابقة' : 'Previous Period'} 
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
