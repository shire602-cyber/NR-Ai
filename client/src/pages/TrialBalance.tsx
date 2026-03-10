import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/format';
import { DateRangeFilter, type DateRange } from '@/components/DateRangeFilter';
import { exportToExcel, type ExportData } from '@/lib/export';
import type { Account } from '@shared/schema';
import {
  Scale,
  Download,
  FileText,
  FileSpreadsheet,
  BookOpen,
  CheckCircle2,
  XCircle,
  Wallet,
  CreditCard,
  PiggyBank,
  TrendingUp,
  Receipt,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountWithBalance {
  account: Account;
  balance: number;
  debitTotal: number;
  creditTotal: number;
}

interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  type: string;
  debitBalance: number;
  creditBalance: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

const DEBIT_NORMAL_TYPES = new Set(['asset', 'expense']);

const ACCOUNT_TYPE_CONFIG: Record<string, {
  label: string;
  labelAr: string;
  icon: typeof Wallet;
  colorClass: string;
  bgClass: string;
}> = {
  asset: {
    label: 'Assets',
    labelAr: 'الأصول',
    icon: Wallet,
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  liability: {
    label: 'Liabilities',
    labelAr: 'الخصوم',
    icon: CreditCard,
    colorClass: 'text-rose-600 dark:text-rose-400',
    bgClass: 'bg-rose-50 dark:bg-rose-900/20',
  },
  equity: {
    label: 'Equity',
    labelAr: 'حقوق الملكية',
    icon: PiggyBank,
    colorClass: 'text-violet-600 dark:text-violet-400',
    bgClass: 'bg-violet-50 dark:bg-violet-900/20',
  },
  income: {
    label: 'Revenue',
    labelAr: 'الإيرادات',
    icon: TrendingUp,
    colorClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
  },
  expense: {
    label: 'Expenses',
    labelAr: 'المصروفات',
    icon: Receipt,
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-900/20',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeTrialBalanceRow(item: AccountWithBalance): TrialBalanceRow {
  const { account, balance } = item;
  const isDebitNormal = DEBIT_NORMAL_TYPES.has(account.type);

  let debitBalance = 0;
  let creditBalance = 0;

  if (isDebitNormal) {
    // Assets & Expenses: positive balance = debit, negative = credit
    if (balance >= 0) {
      debitBalance = balance;
    } else {
      creditBalance = Math.abs(balance);
    }
  } else {
    // Liabilities, Equity, Revenue: positive balance = credit, negative = debit
    if (balance >= 0) {
      creditBalance = balance;
    } else {
      debitBalance = Math.abs(balance);
    }
  }

  return {
    accountCode: account.code,
    accountName: account.nameEn,
    type: account.type,
    debitBalance,
    creditBalance,
  };
}

function prepareTrialBalanceForCSV(
  groupedRows: Record<string, TrialBalanceRow[]>,
  groupSubtotals: Record<string, { debit: number; credit: number }>,
  totalDebits: number,
  totalCredits: number,
  locale: string,
): ExportData {
  const rows: Record<string, any>[] = [];

  ACCOUNT_TYPE_ORDER.forEach((type) => {
    const group = groupedRows[type];
    if (!group || group.length === 0) return;

    const config = ACCOUNT_TYPE_CONFIG[type];
    const groupLabel = locale === 'ar' ? config.labelAr : config.label;

    rows.push({ code: '', account: groupLabel.toUpperCase(), type: '', debit: '', credit: '' });

    group.forEach((row) => {
      rows.push({
        code: row.accountCode,
        account: row.accountName,
        type: row.type,
        debit: row.debitBalance > 0 ? row.debitBalance.toFixed(2) : '',
        credit: row.creditBalance > 0 ? row.creditBalance.toFixed(2) : '',
      });
    });

    const sub = groupSubtotals[type];
    rows.push({
      code: '',
      account: `Total ${groupLabel}`,
      type: '',
      debit: sub.debit > 0 ? sub.debit.toFixed(2) : '',
      credit: sub.credit > 0 ? sub.credit.toFixed(2) : '',
    });

    rows.push({ code: '', account: '', type: '', debit: '', credit: '' });
  });

  rows.push({
    code: '',
    account: 'TOTAL',
    type: '',
    debit: totalDebits.toFixed(2),
    credit: totalCredits.toFixed(2),
  });

  return {
    sheetName: 'Trial Balance',
    columns: [
      { header: 'Account Code', key: 'code', width: 15 },
      { header: 'Account Name', key: 'account', width: 35 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Debit (AED)', key: 'debit', width: 18 },
      { header: 'Credit (AED)', key: 'credit', width: 18 },
    ],
    rows,
  };
}

function generateTrialBalancePDF(
  groupedRows: Record<string, TrialBalanceRow[]>,
  groupSubtotals: Record<string, { debit: number; credit: number }>,
  totalDebits: number,
  totalCredits: number,
  isBalanced: boolean,
  dateRangeLabel: string,
  locale: string,
) {
  const lines: string[] = [];
  const pad = (str: string, len: number) => str.padEnd(len);
  const padStart = (str: string, len: number) => str.padStart(len);

  lines.push('='.repeat(100));
  lines.push(pad('', 30) + 'TRIAL BALANCE REPORT');
  lines.push(pad('', 30) + 'Muhasib.ai');
  lines.push(pad('', 25) + dateRangeLabel);
  lines.push('='.repeat(100));
  lines.push('');
  lines.push(
    pad('Code', 12) +
    pad('Account Name', 40) +
    pad('Type', 12) +
    padStart('Debit (AED)', 18) +
    padStart('Credit (AED)', 18)
  );
  lines.push('-'.repeat(100));

  ACCOUNT_TYPE_ORDER.forEach((type) => {
    const group = groupedRows[type];
    if (!group || group.length === 0) return;

    const config = ACCOUNT_TYPE_CONFIG[type];
    const groupLabel = locale === 'ar' ? config.labelAr : config.label;

    lines.push('');
    lines.push(groupLabel.toUpperCase());
    lines.push('-'.repeat(100));

    group.forEach((row) => {
      lines.push(
        pad(row.accountCode, 12) +
        pad(row.accountName.substring(0, 38), 40) +
        pad(row.type, 12) +
        padStart(row.debitBalance > 0 ? row.debitBalance.toFixed(2) : '-', 18) +
        padStart(row.creditBalance > 0 ? row.creditBalance.toFixed(2) : '-', 18)
      );
    });

    const sub = groupSubtotals[type];
    lines.push('-'.repeat(100));
    lines.push(
      pad('', 12) +
      pad(`Total ${groupLabel}`, 40) +
      pad('', 12) +
      padStart(sub.debit > 0 ? sub.debit.toFixed(2) : '-', 18) +
      padStart(sub.credit > 0 ? sub.credit.toFixed(2) : '-', 18)
    );
  });

  lines.push('');
  lines.push('='.repeat(100));
  lines.push(
    pad('', 12) +
    pad('TOTAL', 40) +
    pad('', 12) +
    padStart(totalDebits.toFixed(2), 18) +
    padStart(totalCredits.toFixed(2), 18)
  );
  lines.push('='.repeat(100));
  lines.push('');
  lines.push(`Status: ${isBalanced ? 'BALANCED' : 'UNBALANCED'}`);
  lines.push(`Difference: AED ${Math.abs(totalDebits - totalCredits).toFixed(2)}`);
  lines.push('');
  lines.push('-'.repeat(100));
  lines.push('Generated by Muhasib.ai - FTA-Compliant Report');
  lines.push(`Report Date: ${new Date().toLocaleDateString('en-GB')}`);

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trial_balance_${format(new Date(), 'yyyy-MM-dd')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrialBalance() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  const dateParams = dateRange.from && dateRange.to
    ? `?startDate=${format(dateRange.from, 'yyyy-MM-dd')}&endDate=${format(dateRange.to, 'yyyy-MM-dd')}`
    : '';

  const { data: accountsWithBalances, isLoading } = useQuery<AccountWithBalance[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'accounts-with-balances' + dateParams],
    enabled: !!selectedCompanyId,
  });

  // Compute trial balance rows grouped by account type
  const { groupedRows, groupSubtotals, totalDebits, totalCredits, isBalanced, totalAccounts } =
    useMemo(() => {
      if (!accountsWithBalances) {
        return {
          groupedRows: {} as Record<string, TrialBalanceRow[]>,
          groupSubtotals: {} as Record<string, { debit: number; credit: number }>,
          totalDebits: 0,
          totalCredits: 0,
          isBalanced: true,
          totalAccounts: 0,
        };
      }

      const grouped: Record<string, TrialBalanceRow[]> = {};
      const subtotals: Record<string, { debit: number; credit: number }> = {};
      let debits = 0;
      let credits = 0;
      let count = 0;

      ACCOUNT_TYPE_ORDER.forEach((type) => {
        const items = accountsWithBalances.filter((item) => item.account.type === type);
        const rows = items
          .map(computeTrialBalanceRow)
          .filter((row) => row.debitBalance > 0 || row.creditBalance > 0);

        if (rows.length > 0) {
          // Sort by account code
          rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
          grouped[type] = rows;
          count += rows.length;

          const groupDebit = rows.reduce((sum, r) => sum + r.debitBalance, 0);
          const groupCredit = rows.reduce((sum, r) => sum + r.creditBalance, 0);
          subtotals[type] = { debit: groupDebit, credit: groupCredit };
          debits += groupDebit;
          credits += groupCredit;
        }
      });

      return {
        groupedRows: grouped,
        groupSubtotals: subtotals,
        totalDebits: debits,
        totalCredits: credits,
        isBalanced: Math.abs(debits - credits) < 0.01,
        totalAccounts: count,
      };
    }, [accountsWithBalances]);

  const dateRangeLabel = useMemo(() => {
    if (dateRange.from && dateRange.to) {
      return `${format(dateRange.from, 'MMM dd, yyyy')} - ${format(dateRange.to, 'MMM dd, yyyy')}`;
    }
    return locale === 'ar' ? 'جميع الفترات' : 'All Periods';
  }, [dateRange, locale]);

  const handleExportCSV = useCallback(() => {
    const data = prepareTrialBalanceForCSV(
      groupedRows,
      groupSubtotals,
      totalDebits,
      totalCredits,
      locale,
    );

    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, 'yyyy-MM-dd')}_to_${format(dateRange.to, 'yyyy-MM-dd')}`
        : '';

    exportToExcel([data], `trial_balance${dateRangeStr}`);
    toast({
      title: locale === 'ar' ? 'تم التصدير بنجاح' : 'Export Successful',
      description: locale === 'ar' ? 'تم تصدير ميزان المراجعة' : 'Trial Balance exported to Excel',
    });
  }, [groupedRows, groupSubtotals, totalDebits, totalCredits, dateRange, locale, toast]);

  const handleExportPDF = useCallback(() => {
    generateTrialBalancePDF(
      groupedRows,
      groupSubtotals,
      totalDebits,
      totalCredits,
      isBalanced,
      dateRangeLabel,
      locale,
    );
    toast({
      title: locale === 'ar' ? 'تم التصدير بنجاح' : 'Export Successful',
      description:
        locale === 'ar' ? 'تم تصدير ميزان المراجعة كـ PDF' : 'Trial Balance exported as PDF',
    });
  }, [groupedRows, groupSubtotals, totalDebits, totalCredits, isBalanced, dateRangeLabel, locale, toast]);

  // ── No company selected ──
  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          {locale === 'ar' ? 'لم يتم اختيار شركة' : 'No Company Selected'}
        </h2>
        <p className="text-muted-foreground text-center max-w-md">
          {locale === 'ar'
            ? 'يرجى اختيار شركة لعرض ميزان المراجعة.'
            : 'Please select a company to view the Trial Balance.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Gradient Header ── */}
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-indigo-600/10 via-violet-500/5 to-transparent border border-indigo-500/20 p-4 md:p-6 lg:p-8">
        <div className="relative z-10">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <Scale className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
                <h1 className="text-3xl font-semibold">
                  {locale === 'ar' ? 'ميزان المراجعة' : 'Trial Balance'}
                </h1>
              </div>
              <p className="text-muted-foreground">
                {locale === 'ar'
                  ? 'عرض جميع الحسابات بأرصدتها المدينة والدائنة للتحقق من التوازن'
                  : 'All accounts with debit and credit balances to verify accounting equation'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleExportPDF} data-testid="button-export-pdf">
                <FileText className="w-4 h-4 mr-2" />
                {locale === 'ar' ? 'تصدير PDF' : 'Export PDF'}
              </Button>
              <Button variant="outline" onClick={handleExportCSV} data-testid="button-export-csv">
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {locale === 'ar' ? 'تصدير CSV' : 'Export CSV'}
              </Button>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full -mr-32 -mt-32 blur-3xl" />
      </div>

      {/* ── Date Range Filter ── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium">
              {locale === 'ar' ? 'تصفية حسب الفترة:' : 'Filter by date:'}
            </span>
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
          </div>
        </CardContent>
      </Card>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'إجمالي المدين' : 'Total Debits'}
            </CardTitle>
            <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
              <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold font-mono" data-testid="text-total-debits">
                {formatCurrency(totalDebits, 'AED', locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'إجمالي الدائن' : 'Total Credits'}
            </CardTitle>
            <div className="w-8 h-8 rounded-md bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold font-mono" data-testid="text-total-credits">
                {formatCurrency(totalCredits, 'AED', locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'الحالة' : 'Status'}
            </CardTitle>
            <div
              className={`w-8 h-8 rounded-md flex items-center justify-center ${
                isBalanced
                  ? 'bg-green-100 dark:bg-green-900/20'
                  : 'bg-red-100 dark:bg-red-900/20'
              }`}
            >
              {isBalanced ? (
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="flex items-center gap-3">
                <Badge
                  variant={isBalanced ? 'default' : 'destructive'}
                  className="text-sm px-3 py-1"
                  data-testid="badge-balance-status"
                >
                  {isBalanced
                    ? locale === 'ar'
                      ? t.balanced
                      : 'BALANCED'
                    : locale === 'ar'
                      ? t.notBalanced
                      : 'UNBALANCED'}
                </Badge>
                {!isBalanced && (
                  <span className="text-sm text-muted-foreground font-mono">
                    {locale === 'ar' ? 'الفرق:' : 'Diff:'}{' '}
                    {formatCurrency(Math.abs(totalDebits - totalCredits), 'AED', locale)}
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Trial Balance Table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            {locale === 'ar' ? 'ميزان المراجعة' : 'Trial Balance'}
          </CardTitle>
          <CardDescription>
            {dateRangeLabel} &mdash; {totalAccounts}{' '}
            {locale === 'ar' ? 'حساب' : totalAccounts === 1 ? 'account' : 'accounts'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : totalAccounts === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {locale === 'ar' ? 'لا توجد بيانات' : t.noData}
              </h3>
              <p className="text-muted-foreground text-center max-w-md">
                {locale === 'ar'
                  ? 'لا توجد حسابات بأرصدة لعرضها. أضف قيود يومية للبدء.'
                  : 'No accounts with balances to display. Add journal entries to get started.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[120px] font-semibold">
                      {t.accountCode}
                    </TableHead>
                    <TableHead className="font-semibold">{t.accountName}</TableHead>
                    <TableHead className="w-[120px] font-semibold">{t.type}</TableHead>
                    <TableHead className="text-right w-[160px] font-semibold">
                      {t.debit}
                    </TableHead>
                    <TableHead className="text-right w-[160px] font-semibold">
                      {t.credit}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ACCOUNT_TYPE_ORDER.map((type) => {
                    const rows = groupedRows[type];
                    if (!rows || rows.length === 0) return null;

                    const config = ACCOUNT_TYPE_CONFIG[type];
                    const Icon = config.icon;
                    const sub = groupSubtotals[type];

                    return (
                      <GroupSection key={type}>
                        {/* Group Header */}
                        <TableRow className={`${config.bgClass} border-b-0`}>
                          <TableCell
                            colSpan={5}
                            className="font-semibold py-3"
                          >
                            <div className="flex items-center gap-2">
                              <Icon className={`h-4 w-4 ${config.colorClass}`} />
                              <span className={config.colorClass}>
                                {locale === 'ar' ? config.labelAr : config.label}
                              </span>
                              <Badge variant="secondary" className="ml-2 text-xs">
                                {rows.length}
                              </Badge>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Account Rows */}
                        {rows.map((row) => (
                          <TableRow
                            key={row.accountCode}
                            className="hover:bg-muted/30 transition-colors"
                          >
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {row.accountCode}
                            </TableCell>
                            <TableCell>{row.accountName}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs capitalize">
                                {locale === 'ar'
                                  ? (t as any)[row.type] || row.type
                                  : row.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {row.debitBalance > 0
                                ? formatCurrency(row.debitBalance, 'AED', locale)
                                : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {row.creditBalance > 0
                                ? formatCurrency(row.creditBalance, 'AED', locale)
                                : '-'}
                            </TableCell>
                          </TableRow>
                        ))}

                        {/* Group Subtotal */}
                        <TableRow className="border-t-2 bg-muted/20">
                          <TableCell colSpan={3} className="font-semibold text-sm">
                            {locale === 'ar' ? `إجمالي ${config.labelAr}` : `Total ${config.label}`}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-sm">
                            {sub.debit > 0 ? formatCurrency(sub.debit, 'AED', locale) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-sm">
                            {sub.credit > 0 ? formatCurrency(sub.credit, 'AED', locale) : '-'}
                          </TableCell>
                        </TableRow>
                      </GroupSection>
                    );
                  })}

                  {/* Grand Total */}
                  <TableRow className="border-t-4 bg-muted/40 font-bold">
                    <TableCell colSpan={3} className="text-base font-bold py-4">
                      <div className="flex items-center gap-2">
                        {locale === 'ar' ? 'المجموع الكلي' : 'Grand Total'}
                        <Badge
                          variant={isBalanced ? 'default' : 'destructive'}
                          className="ml-2"
                        >
                          {isBalanced
                            ? locale === 'ar'
                              ? t.balanced
                              : 'BALANCED'
                            : locale === 'ar'
                              ? t.notBalanced
                              : 'UNBALANCED'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right font-mono font-bold text-base py-4"
                      data-testid="text-grand-total-debit"
                    >
                      {formatCurrency(totalDebits, 'AED', locale)}
                    </TableCell>
                    <TableCell
                      className="text-right font-mono font-bold text-base py-4"
                      data-testid="text-grand-total-credit"
                    >
                      {formatCurrency(totalCredits, 'AED', locale)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Footer */}
          <p className="text-xs text-muted-foreground mt-6 pt-4 border-t text-center">
            Generated by Muhasib.ai &bull; FTA-Compliant Report
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Fragment wrapper to group related table rows without extra DOM
function GroupSection({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
