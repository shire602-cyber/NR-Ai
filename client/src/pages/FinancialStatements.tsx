import { PageHeader } from '@/components/ui/page-header';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Scale,
  Banknote,
  CheckCircle2,
  XCircle,
  Search,
} from 'lucide-react';

// Types matching server response shapes

interface AccountBreakdown {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

interface ProfitLossData {
  startDate: string;
  endDate: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  breakdown: {
    revenue: AccountBreakdown[];
    expenses: AccountBreakdown[];
  };
}

interface BalanceSheetData {
  asOfDate: string;
  assets: { total: number; breakdown: AccountBreakdown[] };
  liabilities: { total: number; breakdown: AccountBreakdown[] };
  equity: { total: number; breakdown: AccountBreakdown[] };
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

interface CashFlowData {
  startDate: string;
  endDate: string;
  operating: { total: number; breakdown: AccountBreakdown[] };
  investing: { total: number; breakdown: AccountBreakdown[] };
  financing: { total: number; breakdown: AccountBreakdown[] };
  netCashChange: number;
}

function getDefaultDateRange() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return {
    startDate: startOfYear.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  };
}

function BreakdownTable({ items, locale }: { items: AccountBreakdown[]; locale: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">No entries found.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Account</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(item => (
          <TableRow key={item.accountId}>
            <TableCell className="font-mono text-sm">{item.accountCode}</TableCell>
            <TableCell>{item.accountName}</TableCell>
            <TableCell className="text-right font-mono">
              {formatCurrency(item.amount, 'AED', locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ================================
// Profit & Loss Tab
// ================================

function ProfitLossTab({ companyId, locale }: { companyId: string; locale: string }) {
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [queryDates, setQueryDates] = useState(defaults);

  const { data, isLoading, error } = useQuery<ProfitLossData>({
    queryKey: [`/api/companies/${companyId}/financial-statements/profit-loss?startDate=${queryDates.startDate}&endDate=${queryDates.endDate}`],
    enabled: !!companyId,
  });

  const handleGenerate = () => {
    setQueryDates({ startDate, endDate });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <Button onClick={handleGenerate}>
              <Search className="h-4 w-4 mr-2" />
              Generate
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load profit & loss statement.</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Revenue</CardDescription>
                <CardTitle className="text-2xl text-green-600 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {formatCurrency(data.revenue, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Expenses</CardDescription>
                <CardTitle className="text-2xl text-red-600 flex items-center gap-2">
                  <TrendingDown className="h-5 w-5" />
                  {formatCurrency(data.expenses, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Net Income</CardDescription>
                <CardTitle className={`text-2xl flex items-center gap-2 ${data.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <BarChart3 className="h-5 w-5" />
                  {formatCurrency(data.netIncome, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Revenue Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Revenue</CardTitle>
              <CardDescription>
                {formatDate(data.startDate, locale)} - {formatDate(data.endDate, locale)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.breakdown.revenue} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Total Revenue</span>
                <span className="font-mono">{formatCurrency(data.revenue, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.breakdown.expenses} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Total Expenses</span>
                <span className="font-mono">{formatCurrency(data.expenses, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ================================
// Balance Sheet Tab
// ================================

function BalanceSheetTab({ companyId, locale }: { companyId: string; locale: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);
  const [queryDate, setQueryDate] = useState(today);

  const { data, isLoading, error } = useQuery<BalanceSheetData>({
    queryKey: [`/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${queryDate}`],
    enabled: !!companyId,
  });

  const handleGenerate = () => {
    setQueryDate(asOfDate);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <Label>As of Date</Label>
              <Input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
            </div>
            <Button onClick={handleGenerate}>
              <Search className="h-4 w-4 mr-2" />
              Generate
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load balance sheet.</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Balance Check */}
          <div className="flex items-center gap-2">
            {data.isBalanced ? (
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Balanced
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Not Balanced
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              As of {formatDate(data.asOfDate, locale)}
            </span>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Assets</CardDescription>
                <CardTitle className="text-2xl">
                  {formatCurrency(data.assets.total, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Liabilities</CardDescription>
                <CardTitle className="text-2xl">
                  {formatCurrency(data.liabilities.total, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Equity</CardDescription>
                <CardTitle className="text-2xl">
                  {formatCurrency(data.equity.total, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Assets */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.assets.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Total Assets</span>
                <span className="font-mono">{formatCurrency(data.assets.total, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Liabilities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Liabilities</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.liabilities.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Total Liabilities</span>
                <span className="font-mono">{formatCurrency(data.liabilities.total, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Equity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Equity</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.equity.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Total Equity</span>
                <span className="font-mono">{formatCurrency(data.equity.total, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Accounting Equation */}
          <Card className="border-2">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between text-lg">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Assets</p>
                  <p className="font-bold">{formatCurrency(data.assets.total, 'AED', locale)}</p>
                </div>
                <Scale className="h-6 w-6 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Liabilities + Equity</p>
                  <p className="font-bold">{formatCurrency(data.totalLiabilitiesAndEquity, 'AED', locale)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ================================
// Cash Flow Tab
// ================================

function CashFlowTab({ companyId, locale }: { companyId: string; locale: string }) {
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [queryDates, setQueryDates] = useState(defaults);

  const { data, isLoading, error } = useQuery<CashFlowData>({
    queryKey: [`/api/companies/${companyId}/financial-statements/cash-flow?startDate=${queryDates.startDate}&endDate=${queryDates.endDate}`],
    enabled: !!companyId,
  });

  const handleGenerate = () => {
    setQueryDates({ startDate, endDate });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <Button onClick={handleGenerate}>
              <Search className="h-4 w-4 mr-2" />
              Generate
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load cash flow statement.</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Operating</CardDescription>
                <CardTitle className={`text-xl ${data.operating.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(data.operating.total, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Investing</CardDescription>
                <CardTitle className={`text-xl ${data.investing.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(data.investing.total, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Financing</CardDescription>
                <CardTitle className={`text-xl ${data.financing.total >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(data.financing.total, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardDescription>Net Cash Change</CardDescription>
                <CardTitle className={`text-xl flex items-center gap-2 ${data.netCashChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <Banknote className="h-5 w-5" />
                  {formatCurrency(data.netCashChange, 'AED', locale)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Operating Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Operating Activities</CardTitle>
              <CardDescription>Cash from day-to-day business operations</CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.operating.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Net Operating Cash Flow</span>
                <span className="font-mono">{formatCurrency(data.operating.total, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Investing Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Investing Activities</CardTitle>
              <CardDescription>Cash from buying/selling long-term assets</CardDescription>
            </CardHeader>
            <CardContent>
              {data.investing.breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No investing activities in this period.</p>
              ) : (
                <BreakdownTable items={data.investing.breakdown} locale={locale} />
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Net Investing Cash Flow</span>
                <span className="font-mono">{formatCurrency(data.investing.total, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Financing Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Financing Activities</CardTitle>
              <CardDescription>Cash from debt, equity, and dividends</CardDescription>
            </CardHeader>
            <CardContent>
              {data.financing.breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No financing activities in this period.</p>
              ) : (
                <BreakdownTable items={data.financing.breakdown} locale={locale} />
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>Net Financing Cash Flow</span>
                <span className="font-mono">{formatCurrency(data.financing.total, 'AED', locale)}</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ================================
// Main Page Component
// ================================

export default function FinancialStatements() {
  const { locale } = useTranslation();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">No company found. Please create a company first.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Accounting"
        title="Financial Statements"
        description="Generate profit & loss, balance sheet, and cash flow statements"
      />

      <Tabs defaultValue="profit-loss" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="profit-loss" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Profit & Loss
          </TabsTrigger>
          <TabsTrigger value="balance-sheet" className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Balance Sheet
          </TabsTrigger>
          <TabsTrigger value="cash-flow" className="flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            Cash Flow
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profit-loss">
          <ProfitLossTab companyId={companyId} locale={locale} />
        </TabsContent>

        <TabsContent value="balance-sheet">
          <BalanceSheetTab companyId={companyId} locale={locale} />
        </TabsContent>

        <TabsContent value="cash-flow">
          <CashFlowTab companyId={companyId} locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
