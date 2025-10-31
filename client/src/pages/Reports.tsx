import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Download, BarChart3, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

export default function Reports() {
  const { t, locale } = useTranslation();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  const { data: companies } = useQuery<any[]>({
    queryKey: ['/api/companies'],
  });

  const { data: profitLoss, isLoading: plLoading } = useQuery({
    queryKey: ['/api/companies', selectedCompanyId, 'reports', 'pl'],
    enabled: !!selectedCompanyId,
  });

  const { data: balanceSheet, isLoading: bsLoading } = useQuery({
    queryKey: ['/api/companies', selectedCompanyId, 'reports', 'balance-sheet'],
    enabled: !!selectedCompanyId,
  });

  const { data: vatSummary, isLoading: vatLoading } = useQuery({
    queryKey: ['/api/companies', selectedCompanyId, 'reports', 'vat-summary'],
    enabled: !!selectedCompanyId,
  });

  if (!companies || companies.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-3xl font-semibold">{t.reports}</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">No company selected</h3>
            <p className="text-sm text-muted-foreground">
              Please create a company first to view financial reports
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!selectedCompanyId && companies.length > 0) {
    setSelectedCompanyId(companies[0].id);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-semibold mb-2">{t.reports}</h1>
          <p className="text-muted-foreground">Financial reports and VAT summaries</p>
        </div>
        <Button variant="outline" data-testid="button-export">
          <Download className="w-4 h-4 mr-2" />
          {t.export}
        </Button>
      </div>

      <Tabs defaultValue="pl" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="pl" data-testid="tab-profit-loss">{t.profitLoss}</TabsTrigger>
          <TabsTrigger value="bs" data-testid="tab-balance-sheet">{t.balanceSheet}</TabsTrigger>
          <TabsTrigger value="vat" data-testid="tab-vat-summary">{t.vatSummary}</TabsTrigger>
        </TabsList>

        <TabsContent value="pl" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <div className="w-8 h-8 rounded-md bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
              </CardHeader>
              <CardContent>
                {plLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold font-mono" data-testid="text-total-revenue">
                    {formatCurrency(profitLoss?.totalRevenue || 0, 'AED', locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <div className="w-8 h-8 rounded-md bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                </div>
              </CardHeader>
              <CardContent>
                {plLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold font-mono" data-testid="text-total-expenses">
                    {formatCurrency(profitLoss?.totalExpenses || 0, 'AED', locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
              </CardHeader>
              <CardContent>
                {plLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold font-mono" data-testid="text-net-profit">
                    {formatCurrency(profitLoss?.netProfit || 0, 'AED', locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t.profitLoss} Statement</CardTitle>
              <CardDescription>Income and expenses for the current period</CardDescription>
            </CardHeader>
            <CardContent>
              {plLoading ? (
                <Skeleton className="h-64" />
              ) : (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold mb-3 text-green-600 dark:text-green-400">Revenue</h3>
                    <Table>
                      <TableBody>
                        {profitLoss?.revenue?.map((item: any) => (
                          <TableRow key={item.accountCode}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{item.accountCode}</TableCell>
                            <TableCell>{item.accountName}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount, 'AED', locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">Total Revenue</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(profitLoss?.totalRevenue || 0, 'AED', locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3 text-red-600 dark:text-red-400">Expenses</h3>
                    <Table>
                      <TableBody>
                        {profitLoss?.expenses?.map((item: any) => (
                          <TableRow key={item.accountCode}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{item.accountCode}</TableCell>
                            <TableCell>{item.accountName}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount, 'AED', locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">Total Expenses</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(profitLoss?.totalExpenses || 0, 'AED', locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div className="border-t-4 pt-4">
                    <div className="flex justify-between items-center text-lg font-semibold">
                      <span>Net Profit</span>
                      <span className={`font-mono ${profitLoss?.netProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatCurrency(profitLoss?.netProfit || 0, 'AED', locale)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bs">
          <Card>
            <CardHeader>
              <CardTitle>{t.balanceSheet}</CardTitle>
              <CardDescription>Assets, liabilities, and equity as of today</CardDescription>
            </CardHeader>
            <CardContent>
              {bsLoading ? (
                <Skeleton className="h-96" />
              ) : (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold mb-3 text-blue-600 dark:text-blue-400">Assets</h3>
                    <Table>
                      <TableBody>
                        {balanceSheet?.assets?.map((item: any) => (
                          <TableRow key={item.accountCode}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{item.accountCode}</TableCell>
                            <TableCell>{item.accountName}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount, 'AED', locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">Total Assets</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(balanceSheet?.totalAssets || 0, 'AED', locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3 text-red-600 dark:text-red-400">Liabilities</h3>
                    <Table>
                      <TableBody>
                        {balanceSheet?.liabilities?.map((item: any) => (
                          <TableRow key={item.accountCode}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{item.accountCode}</TableCell>
                            <TableCell>{item.accountName}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount, 'AED', locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">Total Liabilities</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(balanceSheet?.totalLiabilities || 0, 'AED', locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3 text-purple-600 dark:text-purple-400">Equity</h3>
                    <Table>
                      <TableBody>
                        {balanceSheet?.equity?.map((item: any) => (
                          <TableRow key={item.accountCode}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{item.accountCode}</TableCell>
                            <TableCell>{item.accountName}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount, 'AED', locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">Total Equity</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(balanceSheet?.totalEquity || 0, 'AED', locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vat">
          <Card>
            <CardHeader>
              <CardTitle>{t.vatSummary}</CardTitle>
              <CardDescription>UAE VAT (5%) summary for the current period</CardDescription>
            </CardHeader>
            <CardContent>
              {vatLoading ? (
                <Skeleton className="h-64" />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="font-semibold text-green-600 dark:text-green-400">Sales (Output VAT)</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-mono">{formatCurrency(vatSummary?.salesSubtotal || 0, 'AED', locale)}</span>
                        </div>
                        <div className="flex justify-between font-medium">
                          <span>VAT Collected (5%)</span>
                          <span className="font-mono">{formatCurrency(vatSummary?.salesVAT || 0, 'AED', locale)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-semibold text-blue-600 dark:text-blue-400">Purchases (Input VAT)</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-mono">{formatCurrency(vatSummary?.purchasesSubtotal || 0, 'AED', locale)}</span>
                        </div>
                        <div className="flex justify-between font-medium">
                          <span>VAT Paid (5%)</span>
                          <span className="font-mono">{formatCurrency(vatSummary?.purchasesVAT || 0, 'AED', locale)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t-4 pt-6">
                    <div className="flex justify-between items-center text-lg font-semibold">
                      <span>Net VAT Payable to FTA</span>
                      <span className={`font-mono ${vatSummary?.netVATPayable >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {formatCurrency(Math.abs(vatSummary?.netVATPayable || 0), 'AED', locale)}
                        {vatSummary?.netVATPayable < 0 && ' (Refund)'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {vatSummary?.netVATPayable >= 0 
                        ? 'Amount to be paid to the Federal Tax Authority' 
                        : 'Amount to be refunded by the Federal Tax Authority'}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
