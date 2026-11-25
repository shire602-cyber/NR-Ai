import { T } from "@/components/layout/T";
import { matchesAccountQuery } from "@/lib/account-search";
import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { apiUrl } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  orderByHierarchy,
  parentCandidates,
  parentIds,
  parentLocked,
  rollUpTotals,
} from "@/lib/account-hierarchy";
import { AccountDrawer } from "@/components/accounts/AccountDrawer";
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
  Pencil,
} from "lucide-react";
import { accountDisplayName } from "@/lib/account-name";

interface AccountWithBalance {
  account: Account;
  balance: number;
  debitTotal: number;
  creditTotal: number;
}

const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];

/** WQ3 (9.1): the level toggle shows accounts down to this depth (1 = top level only). */
const LEVELS = [1, 2, 3, 4] as const;
type Level = (typeof LEVELS)[number] | "all";

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
  const { gate } = useCompanyPermission();
  const [, navigate] = useLocation();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(ACCOUNT_TYPE_ORDER));
  const { toast } = useToast();
  const [parentFor, setParentFor] = useState<Account | null>(null);
  const [parentChoice, setParentChoice] = useState<string>(NO_PARENT);
  // WQ3 (9.3): the account drawer (create when `drawerAccount` is null).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerAccount, setDrawerAccount] = useState<Account | null>(null);
  const [drawerKey, setDrawerKey] = useState(0);
  const [level, setLevel] = useState<Level>("all");

  const {
    data: accountsWithBalances,
    isLoading,
    isError,
    refetch,
  } = useQuery<AccountWithBalance[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts-with-balances"],
    enabled: !!selectedCompanyId,
  });

  const groupedAccounts = useMemo(() => {
    if (!accountsWithBalances) return {};

    // Sweep: accountants search by account code too ("6100" found nothing before).
    const filtered = accountsWithBalances.filter((item) =>
      matchesAccountQuery(item.account, searchQuery)
    );

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

  // Parent rows carry their sub-accounts' figures, so a collapsed level still adds up.
  const rolled = useMemo(
    () => rollUpTotals(accountsWithBalances ?? [], (item) => item.account),
    [accountsWithBalances]
  );
  const headers = useMemo(
    () => parentIds((accountsWithBalances ?? []).map((i) => i.account)),
    [accountsWithBalances]
  );

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
        eyebrow={t["shell.nav.accounting"]}
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
              {...gate("ledger.post")}
            >
              <Upload aria-hidden />
              <T k="journal.coaImportCsv" />
            </Button>
            <Button
              data-testid="button-add-account"
              onClick={() => {
                setDrawerAccount(null);
                setDrawerKey((k) => k + 1);
                setDrawerOpen(true);
              }}
              {...gate("ledger.post")}
            >
              <Plus aria-hidden />
              {t.addAccount}
            </Button>
          </>
        }
      />

      {/* Spec 3.10: the per-type balance strip is gone (the balance sheet says the same). */}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div
          role="group"
          aria-label={t["journal.coaLevels"]}
          aria-describedby="coa-levels-help"
          className="inline-flex w-fit items-center gap-1 rounded-lg bg-surface-sunken p-1"
          data-testid="coa-level-toggle"
        >
          {[...LEVELS, "all" as const].map((l) => (
            <Button
              key={l}
              type="button"
              size="sm"
              variant={level === l ? "default" : "ghost"}
              aria-pressed={level === l}
              className="h-7 px-2.5"
              onClick={() => setLevel(l)}
              data-testid={`button-level-${l}`}
            >
              {l === "all"
                ? t["journal.coaLevelAll"]
                : formatMessage(t["journal.coaLevelN"], { n: l })}
            </Button>
          ))}
          <span id="coa-levels-help" className="sr-only">
            {t["journal.coaLevelsHelp"]}
          </span>
        </div>
      </div>

      <DataTableCard
        status={
          isLoading
            ? "loading"
            : isError && !accountsWithBalances
              ? "error"
              : Object.keys(groupedAccounts).length === 0
                ? "empty"
                : "ready"
        }
        error={{
          title: t["common.loadFailedTitle"],
          description: t["common.loadFailedBody"],
          onRetry: () => void refetch(),
          testId: "coa-load-error",
        }}
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
                        {formatMessage(t["accounts.groupCount"], { count: accounts.length })}
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
                  accounts
                    .filter((item) => level === "all" || item.depth < level)
                    .map((item) => {
                      const figures = rolled.get(item.account.id) ?? item;
                      const isHeader = headers.has(item.account.id);
                      return (
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
                              {accountDisplayName(item.account, locale)}
                            </span>
                            {!item.account.isActive && (
                              <Badge variant="neutral" className="ms-2">
                                {t.inactive}
                              </Badge>
                            )}
                            {isHeader && (
                              <span className="ms-2 text-caption text-muted-foreground">
                                {t["journal.coaIncludesSub"]}
                              </span>
                            )}
                          </TableCell>
                          <MoneyCell
                            amount={figures.debitTotal}
                            showCurrency={false}
                            className="text-muted-foreground"
                          />
                          <MoneyCell
                            amount={figures.creditTotal}
                            showCurrency={false}
                            className="text-muted-foreground"
                          />
                          <MoneyCell
                            amount={Math.abs(figures.balance)}
                            className={cn(
                              isHeader ? "font-semibold" : "font-medium",
                              figures.balance < 0 && "text-negative"
                            )}
                            data-cell="amount"
                          />
                          <TableCell data-cell="actions" className="w-px">
                            <RowActions>
                              <RowActionButton
                                label={t["journal.coaEditAccount"]}
                                icon={Pencil}
                                data-testid={`button-edit-account-${item.account.id}`}
                                {...gate("ledger.post")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDrawerAccount(item.account);
                                  setDrawerKey((k) => k + 1);
                                  setDrawerOpen(true);
                                }}
                              />
                              <RowActionButton
                                label={
                                  parentLocked(item.account, allAccounts)
                                    ? t["journal.coaParentLocked"]
                                    : t["journal.coaSetParent"]
                                }
                                icon={GitBranch}
                                disabled={parentLocked(item.account, allAccounts)}
                                data-testid={`button-set-parent-${item.account.id}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openParentDialog(item.account);
                                }}
                              />
                            </RowActions>
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            );
          })}
        </Table>
      </DataTableCard>

      <AccountDrawer
        key={drawerKey}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        companyId={selectedCompanyId}
        accounts={allAccounts}
        account={drawerAccount}
      />

      <Dialog open={!!parentFor} onOpenChange={(open) => !open && setParentFor(null)}>
        <DialogContent data-testid="dialog-set-parent">
          <DialogHeader>
            <DialogTitle>
              <T k="journal.coaSetParent" />
            </DialogTitle>
            <DialogDescription>
              {parentFor ? `${parentFor.code} · ${accountDisplayName(parentFor, locale)}` : null}
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
                  {a.code} · {accountDisplayName(a, locale)}
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
