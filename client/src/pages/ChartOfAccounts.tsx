import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import type { Account } from '@shared/schema';
import { 
  ChevronDown, 
  ChevronRight, 
  Search, 
  Plus,
  Wallet,
  CreditCard,
  PiggyBank,
  TrendingUp,
  Receipt,
  BookOpen,
  ArrowRight
} from 'lucide-react';

interface AccountWithBalance {
  account: Account;
  balance: number;
  debitTotal: number;
  creditTotal: number;
}

const ACCOUNT_TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

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
    bgClass: 'bg-emerald-50 dark:bg-emerald-900/20'
  },
  liability: { 
    label: 'Liabilities', 
    labelAr: 'الخصوم',
    icon: CreditCard,
    colorClass: 'text-rose-600 dark:text-rose-400',
    bgClass: 'bg-rose-50 dark:bg-rose-900/20'
  },
  equity: { 
    label: 'Equity', 
    labelAr: 'حقوق الملكية',
    icon: PiggyBank,
    colorClass: 'text-violet-600 dark:text-violet-400',
    bgClass: 'bg-violet-50 dark:bg-violet-900/20'
  },
  income: { 
    label: 'Revenue', 
    labelAr: 'الإيرادات',
    icon: TrendingUp,
    colorClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20'
  },
  expense: { 
    label: 'Expenses', 
    labelAr: 'المصروفات',
    icon: Receipt,
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-900/20'
  }
};

export default function ChartOfAccounts() {
  const { t, locale } = useTranslation();
  const [, navigate] = useLocation();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(ACCOUNT_TYPE_ORDER));

  const { data: accountsWithBalances, isLoading } = useQuery<AccountWithBalance[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'accounts-with-balances'],
    enabled: !!selectedCompanyId,
  });

  const groupedAccounts = useMemo(() => {
    if (!accountsWithBalances) return {};
    
    const filtered = accountsWithBalances.filter(item => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        item.account.nameEn.toLowerCase().includes(query) ||
        item.account.nameAr?.toLowerCase().includes(query)
      );
    });

    const grouped: Record<string, AccountWithBalance[]> = {};
    ACCOUNT_TYPE_ORDER.forEach(type => {
      const accounts = filtered.filter(item => item.account.type === type);
      if (accounts.length > 0) {
        grouped[type] = accounts;
      }
    });
    
    return grouped;
  }, [accountsWithBalances, searchQuery]);

  const typeTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    Object.entries(groupedAccounts).forEach(([type, accounts]) => {
      totals[type] = accounts.reduce((sum, item) => sum + item.balance, 0);
    });
    return totals;
  }, [groupedAccounts]);

  const toggleType = (type: string) => {
    const newExpanded = new Set(expandedTypes);
    if (newExpanded.has(type)) {
      newExpanded.delete(type);
    } else {
      newExpanded.add(type);
    }
    setExpandedTypes(newExpanded);
  };

  const handleAccountClick = (accountId: string) => {
    navigate(`/accounts/${accountId}/ledger`);
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Company Selected</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Please select a company from the sidebar to view the Chart of Accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight" data-testid="text-page-title">
            {locale === 'ar' ? 'دليل الحسابات' : 'Chart of Accounts'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {locale === 'ar' 
              ? 'إدارة وعرض جميع الحسابات المالية لشركتك'
              : 'Manage and view all financial accounts for your company'
            }
          </p>
        </div>
        <Button 
          size="default"
          data-testid="button-add-account"
          onClick={() => navigate('/journal')}
        >
          <Plus className="h-4 w-4 mr-2" />
          {locale === 'ar' ? 'إضافة حساب' : 'Add Account'}
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={locale === 'ar' ? 'البحث في الحسابات...' : 'Search accounts...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
          data-testid="input-search-accounts"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardHeader className="py-4">
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="py-2">
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : Object.keys(groupedAccounts).length === 0 ? (
        <Card className="p-8 text-center">
          <div className="flex flex-col items-center">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {searchQuery 
                ? (locale === 'ar' ? 'لا توجد نتائج' : 'No results found')
                : (locale === 'ar' ? 'لا توجد حسابات' : 'No accounts yet')
              }
            </h3>
            <p className="text-muted-foreground">
              {searchQuery
                ? (locale === 'ar' 
                    ? 'حاول البحث بكلمات مختلفة'
                    : 'Try searching with different keywords')
                : (locale === 'ar'
                    ? 'أضف حسابات لبدء تتبع ماليتك'
                    : 'Add accounts to start tracking your finances')
              }
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const accounts = groupedAccounts[type];
              if (!accounts || accounts.length === 0) return null;

              const config = ACCOUNT_TYPE_CONFIG[type];
              const Icon = config.icon;
              const isExpanded = expandedTypes.has(type);

              return (
                <motion.div
                  key={type}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="overflow-hidden">
                    <Collapsible open={isExpanded} onOpenChange={() => toggleType(type)}>
                      <CollapsibleTrigger asChild>
                        <CardHeader 
                          className={`py-4 cursor-pointer hover-elevate ${config.bgClass}`}
                          data-testid={`button-toggle-${type}`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${config.bgClass}`}>
                                <Icon className={`h-5 w-5 ${config.colorClass}`} />
                              </div>
                              <div>
                                <CardTitle className="text-lg font-semibold">
                                  {locale === 'ar' ? config.labelAr : config.label}
                                </CardTitle>
                                <CardDescription>
                                  {accounts.length} {locale === 'ar' ? 'حسابات' : 'accounts'}
                                </CardDescription>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm text-muted-foreground">
                                  {locale === 'ar' ? 'الإجمالي' : 'Total'}
                                </p>
                                <p className={`text-lg font-mono font-semibold ${
                                  typeTotals[type] >= 0 ? 'text-foreground' : 'text-destructive'
                                }`}>
                                  {formatCurrency(Math.abs(typeTotals[type]))}
                                </p>
                              </div>
                              {isExpanded ? (
                                <ChevronDown className="h-5 w-5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="p-0">
                          <div className="divide-y">
                            {accounts.map((item, index) => (
                              <motion.div
                                key={item.account.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: index * 0.05 }}
                                className="flex items-center justify-between p-4 hover-elevate cursor-pointer group"
                                onClick={() => handleAccountClick(item.account.id)}
                                data-testid={`row-account-${item.account.id}`}
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <div className="min-w-0">
                                    <p className="font-medium truncate">
                                      {locale === 'ar' && item.account.nameAr 
                                        ? item.account.nameAr 
                                        : item.account.nameEn}
                                    </p>
                                    {locale !== 'ar' && item.account.nameAr && (
                                      <p className="text-sm text-muted-foreground truncate" dir="rtl">
                                        {item.account.nameAr}
                                      </p>
                                    )}
                                  </div>
                                  {!item.account.isActive && (
                                    <Badge variant="secondary" className="shrink-0">
                                      {locale === 'ar' ? 'غير نشط' : 'Inactive'}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-4">
                                  <div className="text-right">
                                    <p className={`font-mono font-medium ${
                                      item.balance >= 0 ? 'text-foreground' : 'text-destructive'
                                    }`}>
                                      {formatCurrency(Math.abs(item.balance))}
                                    </p>
                                    <div className="flex gap-2 text-xs text-muted-foreground">
                                      <span>Dr: {formatCurrency(item.debitTotal)}</span>
                                      <span>Cr: {formatCurrency(item.creditTotal)}</span>
                                    </div>
                                  </div>
                                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader className="py-4">
          <CardTitle className="text-lg">
            {locale === 'ar' ? 'ملخص الأرصدة' : 'Balance Summary'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const config = ACCOUNT_TYPE_CONFIG[type];
              const Icon = config.icon;
              const total = typeTotals[type] || 0;

              return (
                <div 
                  key={type} 
                  className={`p-4 rounded-lg ${config.bgClass}`}
                  data-testid={`summary-${type}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`h-4 w-4 ${config.colorClass}`} />
                    <span className="text-sm font-medium">
                      {locale === 'ar' ? config.labelAr : config.label}
                    </span>
                  </div>
                  <p className={`font-mono font-semibold text-lg ${
                    total >= 0 ? 'text-foreground' : 'text-destructive'
                  }`}>
                    {formatCurrency(Math.abs(total))}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
