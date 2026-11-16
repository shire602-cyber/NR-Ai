import { T } from "@/components/layout/T";
import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTableCard } from "@/components/ui/data-table";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiUrl } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { orderByHierarchy, parentCandidates } from "@/lib/account-hierarchy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account } from "@shared/schema";
import {
  ChevronDown,
  Search,
  Plus,
  Wallet,
  CreditCard,
  PiggyBank,
  TrendingUp,
  Receipt,
  BookOpen,
  Download,
  Upload,
  GitBranch,
} from "lucide-react";

interface AccountWithBalance {
  account: Account;
  balance: number;
  debitTotal: number;
  creditTotal: number;
}

const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];

/** Select value for "no parent" (Radix Select items cannot use an empty string). */
const NO_PARENT = "__none__";

const ACCOUNT_TYPE_CONFIG: Record<
  string,
  {
    label: string;
    labelAr: string;
    icon: typeof Wallet;
    colorClass: string;
    bgClass: string;
  }
> = {
  asset: {
    label: "Assets",
    labelAr: "الأصول",
    icon: Wallet,
    colorClass: "text-success ",
    bgClass: "bg-success-subtle ",
  },
  liability: {
    label: "Liabilities",
    labelAr: "الخصوم",
    icon: CreditCard,
    colorClass: "text-destructive ",
    bgClass: "bg-danger-subtle ",
  },
  equity: {
    label: "Equity",
    labelAr: "حقوق الملكية",
    icon: PiggyBank,
    colorClass: "text-accent",
    bgClass: "bg-brand-50",
  },
  income: {
    label: "Revenue",
    labelAr: "الإيرادات",
    icon: TrendingUp,
    colorClass: "text-info ",
    bgClass: "bg-info-subtle ",
  },
  expense: {
    label: "Expenses",
    labelAr: "المصروفات",
    icon: Receipt,
    colorClass: "text-warning ",
    bgClass: "bg-warning-subtle ",
  },
};

export default function ChartOfAccounts() {
  const { t, locale } = useTranslation();
  const [, navigate] = useLocation();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(ACCOUNT_TYPE_ORDER));
  const { toast } = useToast();
  const [parentFor, setParentFor] = useState<Account | null>(null);
  const [parentChoice, setParentChoice] = useState<string>(NO_PARENT);

  const { data: accountsWithBalances, isLoading } = useQuery<AccountWithBalance[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts-with-balances"],
    enabled: !!selectedCompanyId,
  });

  const groupedAccounts = useMemo(() => {
    if (!accountsWithBalances) return {};

    const filtered = accountsWithBalances.filter((item) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        item.account.nameEn.toLowerCase().includes(query) ||
        item.account.nameAr?.toLowerCase().includes(query)
      );
    });

    const grouped: Record<string, Array<AccountWithBalance & { depth: number }>> = {};
    ACCOUNT_TYPE_ORDER.forEach((type) => {
      const accounts = orderByHierarchy(
        filtered.filter((item) => item.account.type === type),
        (item) => item.account
      );
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

  const allAccounts = useMemo(
    () => (accountsWithBalances ?? []).map((item) => item.account),
    [accountsWithBalances]
  );
  const candidates = useMemo(
    () => (parentFor ? parentCandidates(allAccounts, parentFor.id) : []),
    [allAccounts, parentFor]
  );

  const openParentDialog = (account: Account) => {
    setParentFor(account);
    setParentChoice(account.parentId ?? NO_PARENT);
  };

  const saveParent = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/accounts/${parentFor!.id}`, {
        parentId: parentChoice === NO_PARENT ? null : parentChoice,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "accounts-with-balances"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "accounts"],
      });
      toast({ title: t["journal.coaParentSaved"] });
      setParentFor(null);
    },
    onError: (e: unknown) =>
      toast({
        title: t["journal.coaParentFailed"],
        description: (e as Error)?.message,
        variant: "destructive",
      }),
  });

  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          <T k="pageLabels.setUpYourCompany" />
        </h2>
        <p className="text-muted-foreground text-center max-w-md mb-4">
          {t["chartOfAccounts.youNeedACompanyBefore"]}
        </p>
        <Button onClick={() => navigate("/onboarding")} data-testid="button-create-company">
          <T k="pages.createYourCompany" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Accounting"
        title={t.chartOfAccounts}
        description={t.chartOfAccountsDescription}
        actions={
          <>
            <Button variant="outline" asChild data-testid="button-export-coa-csv">
              <a
                href={apiUrl(
                  `/api/companies/${selectedCompanyId}/imports/chart-of-accounts/export`
                )}
              >
                <Download aria-hidden />
                <T k="journal.coaExportCsv" />
              </a>
            </Button>
            <Button
              variant="outline"
              data-testid="button-import-coa-csv"
              onClick={() => navigate("/import?kind=chart_of_accounts")}
            >
              <Upload aria-hidden />
              <T k="journal.coaImportCsv" />
            </Button>
            <Button data-testid="button-add-account" onClick={() => navigate("/journal")}>
              <Plus aria-hidden />
              {t.addAccount}
            </Button>
          </>
        }
      />

      {/* Balance summary: one strip, hairline-divided (no tinted per-type cards). */}
      <Card className="overflow-hidden">
        <div className="mobile-keep-cols grid grid-cols-2 divide-border md:grid-cols-5 md:divide-x md:rtl:divide-x-reverse">
          {ACCOUNT_TYPE_ORDER.map((type) => {
            const config = ACCOUNT_TYPE_CONFIG[type];
            const total = typeTotals[type] || 0;
            return (
              <div key={type} className="px-4 py-3 md:px-5" data-testid={`summary-${type}`}>
                <p className="text-caption text-muted-foreground">
                  {locale === "ar" ? config.labelAr : config.label}
                </p>
                <Money
                  amount={Math.abs(total)}
                  className={cn("mt-1 flex text-h4 font-semibold", total < 0 && "text-negative")}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <div className="relative w-full sm:max-w-sm">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          placeholder={t.searchAccounts}
          aria-label={t.searchAccounts}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 ps-9"
          data-testid="input-search-accounts"
        />
      </div>

      <DataTableCard
        status={
          isLoading ? "loading" : Object.keys(groupedAccounts).length === 0 ? "empty" : "ready"
        }
        columnLabels={[t["screens.code"], t["screens.account"], t["screens.balance"]]}
        empty={{
          icon: BookOpen,
          title: searchQuery ? t.noResultsFound : t.noAccountsYet,
          description: searchQuery ? t.tryDifferentKeywords : t.addAccountsToStart,
        }}
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead>{t["screens.code"]}</TableHead>
              <TableHead className="w-full">{t["screens.account"]}</TableHead>
              <TableHead data-numeric="">{t["screens.debit"]}</TableHead>
              <TableHead data-numeric="">{t["screens.credit"]}</TableHead>
              <TableHead data-numeric="">{t["screens.balance"]}</TableHead>
              <TableHead>
                <span className="sr-only">{t.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {ACCOUNT_TYPE_ORDER.map((type) => {
            const accounts = groupedAccounts[type];
            if (!accounts || accounts.length === 0) return null;
            const config = ACCOUNT_TYPE_CONFIG[type];
            const Icon = config.icon;
            const isExpanded = expandedTypes.has(type);
            return (
              <TableBody key={type}>
                <TableRow className="bg-surface-sunken/70 hover:bg-surface-sunken">
                  <TableCell colSpan={6} className="p-0">
                    <button
                      type="button"
                      onClick={() => toggleType(type)}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      data-testid={`button-toggle-${type}`}
                    >
                      {/* Expand chevrons never mirror (CTO 12). */}
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast",
                          !isExpanded && "-rotate-90"
                        )}
                        aria-hidden
                      />
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-semibold text-foreground">
                        {locale === "ar" ? config.labelAr : config.label}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {accounts.length} {t.accountsCount}
                      </span>
                      <Money
                        amount={Math.abs(typeTotals[type])}
                        className={cn(
                          "ms-auto text-sm font-semibold",
                          typeTotals[type] < 0 && "text-negative"
                        )}
                      />
                    </button>
                  </TableCell>
                </TableRow>
                {isExpanded &&
                  accounts.map((item) => (
                    <TableRow
                      key={item.account.id}
                      className="group cursor-pointer"
                      onClick={() => handleAccountClick(item.account.id)}
                      data-testid={`row-account-${item.account.id}`}
                    >
                      <TableCell
                        data-nowrap=""
                        data-cell="meta"
                        className="tabular-nums text-muted-foreground"
                      >
                        {item.account.code}
                      </TableCell>
                      <TableCell
                        data-truncate=""
                        data-cell="title"
                        style={
                          item.depth > 0
                            ? { paddingInlineStart: `${1 + item.depth * 1.25}rem` }
                            : undefined
                        }
                      >
                        <span dir="auto" className="font-medium">
                          {locale === "ar" && item.account.nameAr
                            ? item.account.nameAr
                            : item.account.nameEn}
                        </span>
                        {!item.account.isActive && (
                          <Badge variant="neutral" className="ms-2">
                            {t.inactive}
                          </Badge>
                        )}
                      </TableCell>
                      <MoneyCell
                        amount={item.debitTotal}
                        showCurrency={false}
                        className="text-muted-foreground"
                      />
                      <MoneyCell
                        amount={item.creditTotal}
                        showCurrency={false}
                        className="text-muted-foreground"
                      />
                      <MoneyCell
                        amount={Math.abs(item.balance)}
                        className={cn("font-medium", item.balance < 0 && "text-negative")}
                        data-cell="amount"
                      />
                      <TableCell data-cell="actions" className="w-px">
                        <RowActions>
                          <RowActionButton
                            label={t["journal.coaSetParent"]}
                            icon={GitBranch}
                            data-testid={`button-set-parent-${item.account.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openParentDialog(item.account);
                            }}
                          />
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            );
          })}
        </Table>
      </DataTableCard>

      <Dialog open={!!parentFor} onOpenChange={(open) => !open && setParentFor(null)}>
        <DialogContent data-testid="dialog-set-parent">
          <DialogHeader>
            <DialogTitle>
              <T k="journal.coaSetParent" />
            </DialogTitle>
            <DialogDescription>
              {parentFor ? `${parentFor.code} · ${parentFor.nameEn}` : null}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <T k="journal.coaParentHelp" />
          </p>
          <Select value={parentChoice} onValueChange={setParentChoice}>
            <SelectTrigger data-testid="select-parent-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PARENT}>
                <T k="journal.coaNoParent" />
              </SelectItem>
              {candidates.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.code} · {locale === "ar" && a.nameAr ? a.nameAr : a.nameEn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParentFor(null)}>
              <T k="pages.cancel" />
            </Button>
            <Button
              data-testid="button-save-parent"
              disabled={saveParent.isPending}
              onClick={() => saveParent.mutate()}
            >
              <T k="journal.coaSaveParent" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
