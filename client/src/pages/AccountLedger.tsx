import { T } from "@/components/layout/T";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTableCard } from "@/components/ui/data-table";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate } from "@/lib/format";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import type { Account } from "@shared/schema";
import jsPDF from "jspdf";
import {
  ArrowLeft,
  Search,
  FileText,
  FileSpreadsheet,
  RotateCcw,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  MoreHorizontal,
} from "lucide-react";

interface LedgerEntry {
  id: string;
  date: Date;
  entryNumber: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  journalEntryId: string;
  journalLineId: string;
  memo: string | null;
  source: string;
  status: string;
}

interface LedgerResponse {
  entries: LedgerEntry[];
  allEntries: LedgerEntry[];
  account: Account;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  totalCount: number;
}

export default function AccountLedger() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [_match, params] = useRoute("/accounts/:id/ledger");
  const accountId = params?.id;
  const { companyId: selectedCompanyId } = useDefaultCompany();

  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 25;

  const {
    data: ledger,
    isLoading,
    refetch,
  } = useQuery<LedgerResponse>({
    queryKey: ["/api/accounts", accountId, "ledger", { dateRange, searchQuery, currentPage }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange.from) params.set("dateStart", format(dateRange.from, "yyyy-MM-dd"));
      if (dateRange.to) params.set("dateEnd", format(dateRange.to, "yyyy-MM-dd"));
      if (searchQuery) params.set("search", searchQuery);
      params.set("limit", String(entriesPerPage));
      params.set("offset", String((currentPage - 1) * entriesPerPage));

      const url = `/api/accounts/${accountId}/ledger?${params.toString()}`;
      const response = await fetch(apiUrl(url), {
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch ledger");
      return response.json();
    },
    enabled: !!accountId,
  });

  const reversalMutation = useMutation({
    mutationFn: async ({ entryId, reason }: { entryId: string; reason: string }) => {
      return await apiRequest("POST", `/api/journal/${entryId}/reverse`, { reason });
    },
    onSuccess: () => {
      toast({
        title: locale === "ar" ? "تم عكس القيد بنجاح" : "Entry reversed successfully",
        description:
          locale === "ar" ? "تم إنشاء قيد عكسي جديد" : "A new reversing entry has been created",
      });
      setReversalDialogOpen(false);
      setSelectedEntry(null);
      setReversalReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", accountId, "ledger"] });
    },
    onError: (error: any) => {
      toast({
        title: locale === "ar" ? "فشل عكس القيد" : "Reversal failed",
        description: error?.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const totalPages = Math.ceil((ledger?.totalCount || 0) / entriesPerPage);

  const paginatedEntries = ledger?.entries || [];

  // R02-20: server-side Excel export of this account's ledger (numeric cells,
  // opening/closing balances) through the reporting kernel's general ledger.
  const handleExportExcel = async () => {
    if (!accountId || !selectedCompanyId) return;
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ accountIds: accountId, format: "xlsx" });
      if (dateRange.from) params.set("from", format(dateRange.from, "yyyy-MM-dd"));
      if (dateRange.to) params.set("to", format(dateRange.to, "yyyy-MM-dd"));
      const response = await fetch(
        apiUrl(
          `/api/companies/${selectedCompanyId}/reports/general-ledger/export?${params.toString()}`
        ),
        { headers: { ...getAuthHeaders() }, credentials: "include" }
      );
      if (!response.ok) throw new Error(`${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledger-${ledger?.account.code ?? accountId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: t["statements.exportFailed"],
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportCSV = () => {
    if (!ledger) return;

    const exportEntries = ledger.allEntries || ledger.entries;
    const headers = ["Date", "Entry #", "Description", "Debit", "Credit", "Balance"];
    const rows = exportEntries.map((entry) => [
      format(new Date(entry.date), "yyyy-MM-dd"),
      entry.entryNumber,
      entry.description || entry.memo || "",
      entry.debit.toFixed(2),
      entry.credit.toFixed(2),
      entry.runningBalance.toFixed(2),
    ]);

    const csvContent = [
      [`Account Ledger: ${ledger.account.nameEn}`],
      [`Opening Balance: ${ledger.openingBalance.toFixed(2)}`],
      [],
      headers,
      ...rows,
      [],
      [`Total Debit: ${ledger.totalDebit.toFixed(2)}`],
      [`Total Credit: ${ledger.totalCredit.toFixed(2)}`],
      [`Closing Balance: ${ledger.closingBalance.toFixed(2)}`],
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ledger_${ledger.account.nameEn.replace(/\s+/g, "_")}_${format(new Date(), "yyyyMMdd")}.csv`;
    link.click();

    toast({
      title: locale === "ar" ? "تم التصدير" : "Export complete",
      description: locale === "ar" ? "تم تحميل ملف CSV" : "CSV file downloaded",
    });
  };

  const handleExportPDF = () => {
    if (!ledger) return;
    setIsExporting(true);

    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      doc.setFontSize(18);
      doc.text(`Account Ledger: ${ledger.account.nameEn}`, 14, 22);

      doc.setFontSize(10);
      doc.text(`Generated: ${format(new Date(), "MMM dd, yyyy HH:mm")}`, 14, 30);
      doc.text(`Opening Balance: AED ${ledger.openingBalance.toFixed(2)}`, 14, 36);

      const dateRangeStr =
        dateRange.from && dateRange.to
          ? `Period: ${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
          : "Period: All time";
      doc.text(dateRangeStr, 14, 42);

      let yPos = 52;
      const colWidths = [25, 25, 65, 25, 25, 25];
      const headers = ["Date", "Entry #", "Description", "Debit", "Credit", "Balance"];

      doc.setFillColor(240, 240, 240);
      doc.rect(14, yPos - 4, pageWidth - 28, 8, "F");
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");

      let xPos = 14;
      headers.forEach((header, i) => {
        doc.text(header, xPos, yPos);
        xPos += colWidths[i];
      });

      yPos += 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);

      const exportEntries = ledger.allEntries || ledger.entries;
      exportEntries.forEach((entry) => {
        if (yPos > 280) {
          doc.addPage();
          yPos = 20;
        }

        xPos = 14;
        const rowData = [
          format(new Date(entry.date), "MMM dd"),
          entry.entryNumber.slice(-8),
          (entry.description || entry.memo || "").slice(0, 40),
          entry.debit > 0 ? entry.debit.toFixed(2) : "-",
          entry.credit > 0 ? entry.credit.toFixed(2) : "-",
          entry.runningBalance.toFixed(2),
        ];

        rowData.forEach((cell, i) => {
          doc.text(cell, xPos, yPos);
          xPos += colWidths[i];
        });

        yPos += 6;
      });

      yPos += 8;
      doc.setFont("helvetica", "bold");
      doc.text(`Total Debit: AED ${ledger.totalDebit.toFixed(2)}`, 14, yPos);
      doc.text(`Total Credit: AED ${ledger.totalCredit.toFixed(2)}`, 90, yPos);
      doc.text(`Closing Balance: AED ${ledger.closingBalance.toFixed(2)}`, 14, yPos + 6);

      doc.save(
        `ledger_${ledger.account.nameEn.replace(/\s+/g, "_")}_${format(new Date(), "yyyyMMdd")}.pdf`
      );

      toast({
        title: locale === "ar" ? "تم التصدير" : "Export complete",
        description: locale === "ar" ? "تم تحميل ملف PDF" : "PDF file downloaded",
      });
    } catch (_error) {
      toast({
        title: locale === "ar" ? "فشل التصدير" : "Export failed",
        description: "Could not generate PDF",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleReverseEntry = (entry: LedgerEntry) => {
    setSelectedEntry(entry);
    setReversalDialogOpen(true);
  };

  const confirmReversal = () => {
    if (!selectedEntry) return;
    reversalMutation.mutate({
      entryId: selectedEntry.journalEntryId,
      reason: reversalReason,
    });
  };

  if (!accountId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          <T k="pageLabels.accountNotFound" />
        </h2>
        <Button onClick={() => navigate("/chart-of-accounts")} variant="outline">
          <ArrowLeft className="h-4 w-4" />
          <T k="pageLabels.backToChartOfAccounts" />
        </Button>
      </div>
    );
  }

  const accountName = ledger
    ? locale === "ar" && ledger.account.nameAr
      ? ledger.account.nameAr
      : ledger.account.nameEn
    : locale === "ar"
      ? "دفتر الأستاذ"
      : "Account Ledger";
  const typeLabel = ledger?.account.type
    ? ((
        {
          asset: t["screens.typeAsset"],
          liability: t["screens.typeLiability"],
          equity: t["screens.typeEquity"],
          income: t["screens.typeIncome"],
          expense: t["screens.typeExpense"],
        } as Record<string, string>
      )[ledger.account.type] ?? ledger.account.type)
    : "";

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/chart-of-accounts"
        backLabel={t.chartOfAccounts}
        eyebrow="Accounting"
        title={
          isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <span dir="auto" data-testid="text-account-name">
              {accountName}
            </span>
          )
        }
        testId="text-account-ledger-title"
        description={
          isLoading ? undefined : (
            <>
              {ledger?.account.code ? (
                <span className="tabular-nums">{ledger.account.code}</span>
              ) : null}
              {ledger?.account.code ? " · " : null}
              {typeLabel}
              {" · "}
              {locale === "ar" ? "دفتر الأستاذ" : "General Ledger"}
            </>
          )
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void handleExportExcel()}
              disabled={!ledger || isExporting || !selectedCompanyId}
              data-testid="button-export-xlsx"
            >
              <FileSpreadsheet aria-hidden />
              <T k="statements.exportExcel" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t["components.rowMoreActions"]}
                  title={t["components.rowMoreActions"]}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={handleExportCSV}
                  disabled={!ledger || isExporting}
                  data-testid="button-export-csv"
                >
                  <FileSpreadsheet aria-hidden />
                  {t["screens.exportCsv"]}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={handleExportPDF}
                  disabled={!ledger || isExporting}
                  data-testid="button-export-pdf"
                >
                  <FileText aria-hidden />
                  {t["screens.exportPdf"]}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => refetch()} data-testid="button-refresh">
                  <RefreshCw aria-hidden />
                  {t["screens.refresh"]}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="mobile-keep-cols grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label={locale === "ar" ? "الرصيد الافتتاحي" : "Opening Balance"}
          loading={isLoading}
          value={<Money amount={ledger?.openingBalance ?? 0} />}
          testId="text-opening-balance"
        />
        <StatCard
          label={locale === "ar" ? "إجمالي المدين" : "Total Debit"}
          loading={isLoading}
          value={<Money amount={ledger?.totalDebit ?? 0} />}
          testId="text-total-debit"
        />
        <StatCard
          label={locale === "ar" ? "إجمالي الدائن" : "Total Credit"}
          loading={isLoading}
          value={<Money amount={ledger?.totalCredit ?? 0} />}
          testId="text-total-credit"
        />
        <StatCard
          label={locale === "ar" ? "الرصيد الختامي" : "Closing Balance"}
          loading={isLoading}
          value={
            <Money
              amount={Math.abs(ledger?.closingBalance ?? 0)}
              className={(ledger?.closingBalance ?? 0) < 0 ? "text-negative" : undefined}
            />
          }
          testId="text-closing-balance"
        />
      </div>

      {/* Filters: one row, not in a card */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder={locale === "ar" ? "بحث..." : "Search entries..."}
            aria-label={locale === "ar" ? "بحث..." : "Search entries..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 ps-9"
            data-testid="input-search-ledger"
          />
        </div>
        <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
      </div>

      <DataTableCard
        status={isLoading ? "loading" : !ledger?.entries?.length ? "empty" : "ready"}
        columnLabels={[t.date, t.description, t["screens.balance"]]}
        empty={{
          icon: BookOpen,
          title: locale === "ar" ? "لا توجد قيود" : "No entries found",
          description:
            locale === "ar"
              ? "لا توجد حركات لهذا الحساب بناءً على الفلاتر المحددة"
              : "No transactions found for this account with the selected filters",
        }}
        footer={
          totalPages > 1 && ledger ? (
            <>
              <span>
                {formatMessage(t["screens.showingRange"], {
                  from: (currentPage - 1) * entriesPerPage + 1,
                  to: Math.min(currentPage * entriesPerPage, ledger.totalCount),
                  total: ledger.totalCount,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  aria-label={t["screens.previousPage"]}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="rtl:-scale-x-100" aria-hidden />
                </Button>
                <span className="tabular-nums text-foreground">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  aria-label={t["screens.nextPage"]}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="rtl:-scale-x-100" aria-hidden />
                </Button>
              </div>
            </>
          ) : undefined
        }
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead>{locale === "ar" ? "التاريخ" : "Date"}</TableHead>
              <TableHead>{locale === "ar" ? "رقم القيد" : "Entry #"}</TableHead>
              <TableHead className="w-full">{locale === "ar" ? "الوصف" : "Description"}</TableHead>
              <TableHead data-numeric="">{locale === "ar" ? "مدين" : "Debit"}</TableHead>
              <TableHead data-numeric="">{locale === "ar" ? "دائن" : "Credit"}</TableHead>
              <TableHead data-numeric="">{locale === "ar" ? "الرصيد" : "Balance"}</TableHead>
              <TableHead>
                <span className="sr-only">{t.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedEntries.map((entry) => (
              <TableRow key={entry.id} className="group" data-testid={`row-entry-${entry.id}`}>
                <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                  {formatDate(entry.date, locale)}
                </TableCell>
                <TableCell data-nowrap="" data-cell="meta">
                  <Link
                    href={`/journal/${entry.journalEntryId}`}
                    dir="ltr"
                    className="tabular-nums text-accent [unicode-bidi:isolate] hover:underline"
                  >
                    {entry.entryNumber.slice(-12)}
                  </Link>
                </TableCell>
                <TableCell data-truncate="" data-cell="title">
                  <span dir="auto">{entry.description || entry.memo || "—"}</span>
                </TableCell>
                <TableCell data-numeric="">
                  {entry.debit > 0 ? (
                    <Money amount={entry.debit} showCurrency={false} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell data-numeric="">
                  {entry.credit > 0 ? (
                    <Money amount={entry.credit} showCurrency={false} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <MoneyCell
                  amount={Math.abs(entry.runningBalance)}
                  showCurrency={false}
                  className={cn("font-medium", entry.runningBalance < 0 && "text-negative")}
                  data-cell="amount"
                />
                <TableCell data-cell="actions" className="w-px">
                  <RowActions collapseOnMobile>
                    <RowActionButton
                      label={locale === "ar" ? "عكس القيد" : "Reverse entry"}
                      icon={RotateCcw}
                      className="md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      onClick={() => handleReverseEntry(entry)}
                      data-testid={`button-reverse-${entry.id}`}
                    />
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableCard>

      <Dialog open={reversalDialogOpen} onOpenChange={setReversalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === "ar" ? "عكس القيد المحاسبي" : "Reverse Journal Entry"}
            </DialogTitle>
            <DialogDescription>
              {locale === "ar"
                ? "سيتم إنشاء قيد عكسي جديد لإلغاء تأثير هذا القيد. هذا الإجراء لا يمكن التراجع عنه."
                : "This will create a new reversing entry to cancel the effect of this entry. This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>

          {selectedEntry && (
            <div className="py-4 space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {locale === "ar" ? "رقم القيد" : "Entry Number"}
                  </span>
                  <span>{selectedEntry.entryNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {locale === "ar" ? "التاريخ" : "Date"}
                  </span>
                  <span>{formatDate(selectedEntry.date, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {locale === "ar" ? "المبلغ" : "Amount"}
                  </span>
                  <span>{formatCurrency(selectedEntry.debit || selectedEntry.credit)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reversal-reason">
                  {locale === "ar" ? "سبب العكس (اختياري)" : "Reversal reason (optional)"}
                </Label>
                <Textarea
                  id="reversal-reason"
                  placeholder={
                    locale === "ar" ? "أدخل سبب العكس..." : "Enter reason for reversal..."
                  }
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  rows={3}
                  data-testid="input-reversal-reason"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReversalDialogOpen(false)}
              data-testid="button-cancel-reversal"
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReversal}
              disabled={reversalMutation.isPending}
              data-testid="button-confirm-reversal"
            >
              {reversalMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  {locale === "ar" ? "جاري العكس..." : "Reversing..."}
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4" />
                  {locale === "ar" ? "تأكيد العكس" : "Confirm Reversal"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
