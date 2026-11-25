import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { FileDrop } from "@/components/ui/file-drop";
import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { classifyLoadError } from "@/lib/loadError";
import { dateFnsOptions } from "@/lib/date-locale";
import { Money } from "@/components/ui/money";
import {
  FileText,
  Download,
  Search,
  Calendar,
  Loader2,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { parseCalendarDate } from "@/lib/format-date";

interface TaxReturn {
  id: string;
  companyId: string;
  returnType: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  filingDate: string;
  ftaReferenceNumber: string | null;
  taxAmount: number;
  paymentStatus: string;
  fileUrl: string | null;
  fileName: string | null;
  notes: string | null;
  filedBy: string | null;
  createdAt: string;
}

const RETURN_TYPES = [
  { value: "vat", labelEn: "VAT return", labelAr: "إقرار ضريبة القيمة المضافة" },
  { value: "corporate_tax", labelEn: "Corporate tax", labelAr: "ضريبة الشركات" },
  { value: "excise_tax", labelEn: "Excise tax", labelAr: "الضريبة الانتقائية" },
];

export default function TaxReturnArchive() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany, error: companyError } = useDefaultCompany();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newReturn, setNewReturn] = useState({
    returnType: "vat",
    periodLabel: "",
    periodStart: "",
    periodEnd: "",
    filingDate: "",
    ftaReferenceNumber: "",
    taxAmount: 0,
    paymentStatus: "paid",
    notes: "",
  });

  const {
    data: taxReturns,
    isPending,
    isLoadingError,
    isRefetchError,
    fetchStatus,
    error,
    refetch,
  } = useQuery<TaxReturn[]>({
    queryKey: ["/api/companies", companyId, "tax-returns-archive"],
    queryFn: getQueryFn<TaxReturn[]>({ on401: "throw" }),
    enabled: !!companyId,
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof newReturn & { fileName?: string }) => {
      return apiRequest("POST", `/api/companies/${companyId}/tax-returns-archive`, {
        ...data,
        fileUrl: data.fileName ? `/uploads/${data.fileName}` : null,
      });
    },
    onSuccess: async () => {
      const queryKey = ["/api/companies", companyId, "tax-returns-archive"];
      // A GET started before the save must not land afterwards (or be reused by the invalidation).
      await queryClient.cancelQueries({ queryKey, exact: true });
      // Not awaited: offline, the refetch pauses and would hold the dialog open.
      void queryClient.invalidateQueries({ queryKey, exact: true });
      toast({
        title: locale === "ar" ? "تمت الإضافة بنجاح" : "Added successfully",
        description: locale === "ar" ? "تم حفظ الإقرار الضريبي" : "Tax return has been saved",
      });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: locale === "ar" ? "فشل الإضافة" : "Failed to Add",
        description: error?.message,
      });
    },
  });

  const resetForm = () => {
    setNewReturn({
      returnType: "vat",
      periodLabel: "",
      periodStart: "",
      periodEnd: "",
      filingDate: "",
      ftaReferenceNumber: "",
      taxAmount: 0,
      paymentStatus: "paid",
      notes: "",
    });
    setSelectedFile(null);
  };

  const handleSubmit = async () => {
    if (
      !newReturn.periodLabel ||
      !newReturn.periodStart ||
      !newReturn.periodEnd ||
      !newReturn.filingDate
    ) {
      toast({
        variant: "destructive",
        title: locale === "ar" ? "معلومات ناقصة" : "Missing information",
        description:
          locale === "ar" ? "يرجى ملء جميع الحقول المطلوبة" : "Please fill in all required fields",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await addMutation.mutateAsync({
        ...newReturn,
        fileName: selectedFile?.name,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const years = [
    ...new Set(taxReturns?.map((r) => parseCalendarDate(r.periodEnd).getFullYear()) || []),
  ].sort((a, b) => b - a);

  const filteredReturns =
    taxReturns?.filter((ret) => {
      if (typeFilter !== "all" && ret.returnType !== typeFilter) return false;
      if (
        yearFilter !== "all" &&
        parseCalendarDate(ret.periodEnd).getFullYear().toString() !== yearFilter
      )
        return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          ret.periodLabel.toLowerCase().includes(query) ||
          ret.ftaReferenceNumber?.toLowerCase().includes(query)
        );
      }
      return true;
    }) || [];

  // Offline and server failures are transient: cached data stays usable. Access denied (and a
  // missing company) replaces the cached data.
  const errorKind = error ? classifyLoadError(error) : null;
  const isBlocked = errorKind === "forbidden" || errorKind === "notFound";
  const refreshFailed = isRefetchError && !isBlocked;
  const blockingError = !companyId ? companyError : isLoadingError || isBlocked ? error : null;
  const isWaiting = !!companyId && isPending && fetchStatus === "paused";
  // A cached empty list whose refresh failed is not known to be empty any more.
  const showCard = !!taxReturns && !blockingError && !(refreshFailed && taxReturns.length === 0);

  const hasNoMatches = showCard && filteredReturns.length === 0 && taxReturns.length > 0;

  const stats = {
    totalReturns: taxReturns?.length || 0,
    vatReturns: taxReturns?.filter((r) => r.returnType === "vat").length || 0,
    corporateTax: taxReturns?.filter((r) => r.returnType === "corporate_tax").length || 0,
    // "Total tax paid" counts only returns recorded as paid, not unpaid or partial ones.
    totalTaxPaid:
      taxReturns
        ?.filter((r) => r.paymentStatus === "paid")
        .reduce((sum, r) => sum + (r.taxAmount || 0), 0) || 0,
  };

  if (isLoadingCompany || (isPending && fetchStatus !== "paused" && !blockingError)) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["compliance.taxArchiveEyebrow"]}
        title={t["compliance.filedReturnsTitle"]}
        description={t["compliance.taxArchiveViewAllTaxReturnsFiledWith"]}
        primaryAction={
          <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-return">
            <Plus className="w-4 h-4 me-2" />
            {t["compliance.taxArchiveAddReturn"]}
          </Button>
        }
      />

      {/* Spec 3.12 / 2.6: no KPI row of zeros on an empty archive. */}
      {showCard && stats.totalReturns > 0 ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label={t["compliance.taxArchiveTotalReturns"]} value={stats.totalReturns} />
          <StatCard label={t["compliance.taxArchiveVatReturns"]} value={stats.vatReturns} />
          <StatCard label={t["compliance.taxArchiveCorporateTax"]} value={stats.corporateTax} />
          <StatCard
            label={t["compliance.taxArchiveTotalTaxPaid"]}
            value={<Money amount={stats.totalTaxPaid} />}
          />
        </div>
      ) : null}

      <div role="status" aria-atomic="true" className="sr-only">
        {hasNoMatches ? t["compliance.taxArchiveNoMatchTitle"] : ""}
      </div>

      {isWaiting ? (
        <div role="status" data-testid="tax-archive-waiting">
          <EmptyState
            icon={Clock}
            title={t["compliance.taxArchiveWaitingTitle"]}
            description={t["compliance.taxArchiveWaitingBody"]}
          />
        </div>
      ) : null}

      {refreshFailed ? (
        <div
          role="alert"
          data-testid="tax-archive-refresh-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-danger-subtle px-4 py-3 text-start text-small text-danger-subtle-foreground"
        >
          <p>{t["compliance.taxArchiveRefreshFailed"]}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={fetchStatus !== "idle"}
            data-testid="button-retry-refresh"
          >
            {t["firm.retry"]}
          </Button>
        </div>
      ) : null}

      {blockingError ? (
        <LoadErrorState
          error={blockingError}
          onRetry={() =>
            companyId
              ? refetch()
              : queryClient.refetchQueries({ queryKey: ["/api/companies"], exact: true })
          }
          testId="tax-archive-load-error"
        />
      ) : null}

      {showCard ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row gap-4 justify-between">
              <div className="relative flex-1">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder={t["compliance.taxArchiveSearchPlaceholder"]}
                  aria-label={t["compliance.taxArchiveSearchLabel"]}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-10"
                  data-testid="input-search-returns"
                />
              </div>
              <div className="flex gap-2">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
                    <SelectValue placeholder={t["compliance.taxArchiveReturnType"]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t["compliance.taxArchiveAllTypes"]}</SelectItem>
                    {RETURN_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {locale === "ar" ? type.labelAr : type.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={yearFilter} onValueChange={setYearFilter}>
                  <SelectTrigger className="w-[140px]" data-testid="select-year-filter">
                    <SelectValue placeholder={locale === "ar" ? "السنة" : "Year"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t["compliance.taxArchiveAllYears"]}</SelectItem>
                    {years.map((year) => (
                      <SelectItem key={year} value={year.toString()}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {hasNoMatches ? (
              <EmptyState
                icon={Search}
                title={t["compliance.taxArchiveNoMatchTitle"]}
                description={t["compliance.taxArchiveNoMatchBody"]}
                action={{
                  label: t["compliance.taxArchiveClearFilters"],
                  onClick: () => {
                    setSearchQuery("");
                    setTypeFilter("all");
                    setYearFilter("all");
                  },
                }}
              />
            ) : filteredReturns.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={t["compliance.taxArchiveNoTaxReturnsFound"]}
                description={t["compliance.filedReturnsEmptyHint"]}
                action={{
                  label: t["compliance.taxArchiveAddYourFirstReturn"],
                  onClick: () => setAddDialogOpen(true),
                }}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{locale === "ar" ? "الفترة" : "Period"}</TableHead>
                      <TableHead>{locale === "ar" ? "النوع" : "Type"}</TableHead>
                      <TableHead>{t["compliance.taxArchiveFilingDate"]}</TableHead>
                      <TableHead>{locale === "ar" ? "رقم المرجع" : "Reference No."}</TableHead>
                      <TableHead data-numeric>{locale === "ar" ? "المبلغ" : "Amount"}</TableHead>
                      <TableHead>{locale === "ar" ? "حالة الدفع" : "Payment"}</TableHead>
                      <TableHead data-numeric>{locale === "ar" ? "إجراءات" : "Actions"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReturns.map((ret) => {
                      const returnType = RETURN_TYPES.find((t) => t.value === ret.returnType);

                      return (
                        <TableRow key={ret.id} data-testid={`row-return-${ret.id}`}>
                          <TableCell>
                            <div className="font-medium">{ret.periodLabel}</div>
                            <div className="text-xs text-muted-foreground">
                              {format(
                                parseCalendarDate(ret.periodStart),
                                "dd MMM",
                                dateFnsOptions(locale)
                              )}{" "}
                              -{" "}
                              {format(
                                parseCalendarDate(ret.periodEnd),
                                "dd MMM yyyy",
                                dateFnsOptions(locale)
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={ret.returnType === "vat" ? "default" : "secondary"}>
                              {returnType
                                ? locale === "ar"
                                  ? returnType.labelAr
                                  : returnType.labelEn
                                : ret.returnType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {format(
                                parseCalendarDate(ret.filingDate),
                                "dd MMM yyyy",
                                dateFnsOptions(locale)
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{ret.ftaReferenceNumber || "-"}</TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money amount={ret.taxAmount} />
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                ret.paymentStatus === "paid"
                                  ? "default"
                                  : ret.paymentStatus === "partial"
                                    ? "secondary"
                                    : "destructive"
                              }
                            >
                              {ret.paymentStatus === "paid" && (
                                <>
                                  <CheckCircle2 className="w-3 h-3 me-1" />
                                  {locale === "ar" ? "مدفوع" : "Paid"}
                                </>
                              )}
                              {ret.paymentStatus === "partial" && (
                                <>
                                  <Clock className="w-3 h-3 me-1" />
                                  {locale === "ar" ? "جزئي" : "Partial"}
                                </>
                              )}
                              {ret.paymentStatus === "unpaid" && (
                                <>
                                  <AlertCircle className="w-3 h-3 me-1" />
                                  {locale === "ar" ? "غير مدفوع" : "Unpaid"}
                                </>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell data-numeric>
                            <div className="flex justify-end gap-2">
                              {ret.fileUrl && (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => window.open(ret.fileUrl!, "_blank")}
                                    aria-label={t["compliance.taxArchiveViewFile"]}
                                    data-testid={`button-view-${ret.id}`}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => {
                                      const link = document.createElement("a");
                                      link.href = ret.fileUrl!;
                                      link.download = ret.fileName || "tax-return.pdf";
                                      link.click();
                                    }}
                                    aria-label={t["compliance.taxArchiveDownloadFile"]}
                                    data-testid={`button-download-${ret.id}`}
                                  >
                                    <Download className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t["compliance.taxArchiveAddTaxReturn"]}</DialogTitle>
            <DialogDescription>
              {t["compliance.taxArchiveRecordATaxReturnFiledWith"]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["compliance.taxArchiveReturnType"]} *</Label>
                <Select
                  value={newReturn.returnType}
                  onValueChange={(val) => setNewReturn({ ...newReturn, returnType: val })}
                >
                  <SelectTrigger data-testid="select-return-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {locale === "ar" ? type.labelAr : type.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t["compliance.taxArchivePeriodLabel"]} *</Label>
                <Input
                  value={newReturn.periodLabel}
                  onChange={(e) => setNewReturn({ ...newReturn, periodLabel: e.target.value })}
                  placeholder="Q1 2025"
                  data-testid="input-period-label"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["compliance.taxArchivePeriodStart"]} *</Label>
                <DatePicker
                  value={newReturn.periodStart}
                  onChange={(value) => setNewReturn({ ...newReturn, periodStart: value })}
                  data-testid="input-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label>{t["compliance.taxArchivePeriodEnd"]} *</Label>
                <DatePicker
                  value={newReturn.periodEnd}
                  onChange={(value) => setNewReturn({ ...newReturn, periodEnd: value })}
                  data-testid="input-period-end"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["compliance.taxArchiveFilingDate"]} *</Label>
                <DatePicker
                  value={newReturn.filingDate}
                  onChange={(value) => setNewReturn({ ...newReturn, filingDate: value })}
                  data-testid="input-filing-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === "ar" ? "رقم مرجع الهيئة" : "FTA reference no."}</Label>
                <Input
                  value={newReturn.ftaReferenceNumber}
                  onChange={(e) =>
                    setNewReturn({ ...newReturn, ftaReferenceNumber: e.target.value })
                  }
                  placeholder="FTA-VAT-2025-001"
                  data-testid="input-fta-reference"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["compliance.taxArchiveTaxAmount"]}</Label>
                <Input
                  type="number"
                  value={newReturn.taxAmount}
                  onChange={(e) =>
                    setNewReturn({ ...newReturn, taxAmount: parseFloat(e.target.value) || 0 })
                  }
                  min="0"
                  step="0.01"
                  data-testid="input-tax-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>{t["compliance.taxArchivePaymentStatus"]}</Label>
                <Select
                  value={newReturn.paymentStatus}
                  onValueChange={(val) => setNewReturn({ ...newReturn, paymentStatus: val })}
                >
                  <SelectTrigger data-testid="select-payment-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">{locale === "ar" ? "مدفوع" : "Paid"}</SelectItem>
                    <SelectItem value="partial">{locale === "ar" ? "جزئي" : "Partial"}</SelectItem>
                    <SelectItem value="unpaid">
                      {locale === "ar" ? "غير مدفوع" : "Unpaid"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{locale === "ar" ? "ملاحظات" : "Notes"}</Label>
              <Textarea
                value={newReturn.notes}
                onChange={(e) => setNewReturn({ ...newReturn, notes: e.target.value })}
                placeholder={locale === "ar" ? "أي ملاحظات إضافية..." : "Any additional notes..."}
                data-testid="input-notes"
              />
            </div>

            <div className="space-y-2">
              <Label>{locale === "ar" ? "ملف الإقرار (PDF)" : "Return file (PDF)"}</Label>
              <FileDrop
                id="tax-return-file"
                accept=".pdf"
                onFiles={([file]) => setSelectedFile(file ?? null)}
                value={
                  selectedFile
                    ? `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
                    : undefined
                }
                onClear={() => setSelectedFile(null)}
                inputTestId="input-return-file"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false);
                resetForm();
              }}
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="button-confirm-add">
              {isSubmitting && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {locale === "ar" ? "إضافة" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
