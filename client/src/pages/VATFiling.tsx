import { T } from "@/components/layout/T";
import { DatePicker } from "@/components/ui/date-picker";
import { lazy, Suspense, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfQuarter, endOfQuarter, addDays, differenceInCalendarDays } from "date-fns";
import { dateFnsOptions } from "@/lib/date-locale";
import { Link, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Money } from "@/components/ui/money";
import { exportToExcel } from "@/lib/export";
import { evidenceSectionHref } from "@/lib/evidenceLinks";
import { prepareVat201ForExport, vat201ExportFilename } from "@/lib/vat201-export";
import VAT201Form from "@/components/VAT201Form";

import { formatDate as formatDisplayDate, parseCalendarDate } from "@/lib/format-date";
import { companyAddressLine, vatStaggerLabel } from "@/lib/company-address";
import VatReturnControls from "@/components/vat/VatReturnControls";
import VatFilingActions from "@/components/vat/VatFilingActions";
import { vatChecklist, vatFilingStage } from "@/lib/vat-filing-stage";
import { AskNajmaButton } from "@/components/firm/AskNajmaButton";
import VatWorkpaperPanel from "@/components/vat/VatWorkpaperPanel";
import { VatPeriodPreview } from "@/components/vat/VatPeriodPreview";
import { vatPeriodEnded } from "@/lib/vat-period";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  FileText,
  Download,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calculator,
  Send,
  Loader2,
  Eye,
  Edit3,
  ListChecks,
  FileSpreadsheet,
  CalendarClock,
} from "lucide-react";
import jsPDF from "jspdf";

const VatPeriodsPanel = lazy(() =>
  import("@/pages/VATAutopilot").then((m) => ({ default: m.VatPeriodsPanel }))
);
const VAT_TABS = ["returns", "periods", "workpaper"] as const;
type VatTab = (typeof VAT_TABS)[number];

interface VATReturn {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  taxYearEnd: string | null;
  vatStagger: string | null;
  status: string;
  /** W4-E: VAT-to-GL reconciliation captured when the return was generated. */
  reconciliationSnapshot?: {
    hasUnexplainedDifference?: boolean;
    aed?: { unexplainedOutput?: number; unexplainedInput?: number };
  } | null;
  amendsReturnId?: string | null;
  box1aAbuDhabiAmount: number;
  box1aAbuDhabiVat: number;
  box1aAbuDhabiAdj: number;
  box1bDubaiAmount: number;
  box1bDubaiVat: number;
  box1bDubaiAdj: number;
  box1cSharjahAmount: number;
  box1cSharjahVat: number;
  box1cSharjahAdj: number;
  box1dAjmanAmount: number;
  box1dAjmanVat: number;
  box1dAjmanAdj: number;
  box1eUmmAlQuwainAmount: number;
  box1eUmmAlQuwainVat: number;
  box1eUmmAlQuwainAdj: number;
  box1fRasAlKhaimahAmount: number;
  box1fRasAlKhaimahVat: number;
  box1fRasAlKhaimahAdj: number;
  box1gFujairahAmount: number;
  box1gFujairahVat: number;
  box1gFujairahAdj: number;
  box2TouristRefundAmount: number;
  box2TouristRefundVat: number;
  box3ReverseChargeAmount: number;
  box3ReverseChargeVat: number;
  box4ZeroRatedAmount: number;
  box5ExemptAmount: number;
  box6ImportsAmount: number;
  box6ImportsVat: number;
  box7ImportsAdjAmount: number;
  box7ImportsAdjVat: number;
  box8TotalAmount: number;
  box8TotalVat: number;
  box8TotalAdj: number;
  box9ExpensesAmount: number;
  box9ExpensesVat: number;
  box9ExpensesAdj: number;
  box10ReverseChargeAmount: number;
  box10ReverseChargeVat: number;
  box11TotalAmount: number;
  box11TotalVat: number;
  box11TotalAdj: number;
  box12TotalDueTax: number;
  box13RecoverableTax: number;
  box14PayableTax: number;
  adjustmentAmount: number | null;
  adjustmentReason: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  ftaReferenceNumber: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  paymentDate: string | null;
  notes: string | null;
  declarantName: string | null;
  declarantPosition: string | null;
  declarationDate: string | null;
  createdAt: string;
}

interface Company {
  id: string;
  name: string;
  nameAr: string | null;
  trnVatNumber: string | null;
  vatFilingFrequency: string | null;
  emirate: string | null;
  address?: string | null;
  phone?: string | null;
  // X5 (J1 L2): the fields the profile actually saves.
  legalName?: string | null;
  businessAddress?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressCountry?: string | null;
  contactPhone?: string | null;
  vatPeriodStartMonth?: number | null;
}

const DEFAULT_VAT_DATA = {
  box1aAbuDhabiAmount: 0,
  box1aAbuDhabiVat: 0,
  box1aAbuDhabiAdj: 0,
  box1bDubaiAmount: 0,
  box1bDubaiVat: 0,
  box1bDubaiAdj: 0,
  box1cSharjahAmount: 0,
  box1cSharjahVat: 0,
  box1cSharjahAdj: 0,
  box1dAjmanAmount: 0,
  box1dAjmanVat: 0,
  box1dAjmanAdj: 0,
  box1eUmmAlQuwainAmount: 0,
  box1eUmmAlQuwainVat: 0,
  box1eUmmAlQuwainAdj: 0,
  box1fRasAlKhaimahAmount: 0,
  box1fRasAlKhaimahVat: 0,
  box1fRasAlKhaimahAdj: 0,
  box1gFujairahAmount: 0,
  box1gFujairahVat: 0,
  box1gFujairahAdj: 0,
  box2TouristRefundAmount: 0,
  box2TouristRefundVat: 0,
  box3ReverseChargeAmount: 0,
  box3ReverseChargeVat: 0,
  box4ZeroRatedAmount: 0,
  box5ExemptAmount: 0,
  box6ImportsAmount: 0,
  box6ImportsVat: 0,
  box7ImportsAdjAmount: 0,
  box7ImportsAdjVat: 0,
  box9ExpensesAmount: 0,
  box9ExpensesVat: 0,
  box9ExpensesAdj: 0,
  box10ReverseChargeAmount: 0,
  box10ReverseChargeVat: 0,
};

type VatWorksheetData = typeof DEFAULT_VAT_DATA;

export default function VATFiling() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const tabParam = new URLSearchParams(search).get("tab");
  const vatTab: VatTab = (VAT_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as VatTab)
    : "returns";
  const setVatTab = (tab: string) =>
    navigate(tab === "returns" ? "/vat-filing" : `/vat-filing?tab=${tab}`, { replace: true });
  const { t, locale } = useTranslation();
  const dfOpts = dateFnsOptions(locale);
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<VATReturn | null>(null);
  const [newPeriodStart, setNewPeriodStart] = useState("");
  const [newPeriodEnd, setNewPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [vatFormData, setVatFormData] = useState<VatWorksheetData>(DEFAULT_VAT_DATA);

  const { data: company } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    enabled: !!companyId,
  });

  const { data: vatReturns, isLoading: isLoadingReturns } = useQuery<VATReturn[]>({
    queryKey: ["/api/companies", companyId, "vat-returns"],
    enabled: !!companyId,
  });

  const generateMutation = useMutation({
    mutationFn: ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/vat-returns/generate`, {
        periodStart,
        periodEnd,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: translateNow("toasts.vatReturnGenerated2"),
        description: translateNow("toasts.reviewTheCalculatedAmountsBeforeSubmitting"),
      });
      setCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.generationFailed"),
        description: error?.message || translateNow("toasts.failedToGenerateVatReturn"),
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PATCH", `/api/vat-returns/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: translateNow("toasts.vatReturnUpdated"),
        description: translateNow("toasts.yourChangesHaveBeenSaved"),
      });
      setEditDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.updateFailed"),
        description: error?.message || translateNow("toasts.failedToUpdateVatReturn"),
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiRequest("POST", `/api/vat-returns/${id}/submit`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: translateNow("toasts.finalisedForReviewNotYetFiled"),
        description: translateNow("toasts.muhasibDoesNotFileWithTheFta"),
      });
      setEditDialogOpen(false);
      setSelectedReturn(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.submissionFailed"),
        description: error?.message || translateNow("toasts.failedToSubmitVatReturn"),
      });
    },
  });

  const stats = useMemo(() => {
    if (!vatReturns) return { total: 0, pending: 0, submitted: 0, filed: 0, totalPayable: 0 };

    return {
      total: vatReturns.length,
      pending: vatReturns.filter((r) => r.status === "draft" || r.status === "pending_review")
        .length,
      submitted: vatReturns.filter((r) => r.status === "submitted").length,
      // E2: "Filed" counts every return filed on EmaraTax (submitted or filed, paid or not).
      filed: vatReturns.filter((r) => r.status === "filed" || r.status === "submitted").length,
      totalPayable: vatReturns.reduce((sum, r) => sum + (r.box14PayableTax || 0), 0),
    };
  }, [vatReturns]);

  const currentQuarter = useMemo(() => {
    const now = new Date();
    return {
      start: startOfQuarter(now),
      end: endOfQuarter(now),
    };
  }, []);
  const canGenerateVatReturn = Boolean(company?.trnVatNumber);
  const hasVatReturns = (vatReturns?.length ?? 0) > 0;

  // The filing users care about right now: the return for the current quarter
  // if one exists, otherwise the most recently created one. Drives the hero.
  const currentFiling = useMemo(() => {
    const returns = vatReturns ?? [];
    const match = returns.find((r) => {
      try {
        return (
          format(parseCalendarDate(r.periodStart), "yyyy-MM") ===
            format(currentQuarter.start, "yyyy-MM") &&
          format(parseCalendarDate(r.periodEnd), "yyyy-MM") ===
            format(currentQuarter.end, "yyyy-MM")
        );
      } catch {
        return false;
      }
    });
    const active =
      match ??
      [...returns].sort(
        (a, b) =>
          parseCalendarDate(b.periodEnd).getTime() - parseCalendarDate(a.periodEnd).getTime()
      )[0];

    const periodStart = active ? parseCalendarDate(active.periodStart) : currentQuarter.start;
    const periodEnd = active ? parseCalendarDate(active.periodEnd) : currentQuarter.end;
    const dueDate = active?.dueDate ? parseCalendarDate(active.dueDate) : addDays(periodEnd, 28);
    const daysUntilDue = differenceInCalendarDays(dueDate, new Date());
    const net = active?.box14PayableTax ?? 0;

    return {
      hasReturn: Boolean(active),
      matchesCurrentQuarter: Boolean(match),
      return: active,
      periodStart,
      periodEnd,
      dueDate,
      daysUntilDue,
      net,
      isRefund: net < 0,
      output: active?.box12TotalDueTax ?? active?.box8TotalVat ?? 0,
      input: active?.box13RecoverableTax ?? active?.box11TotalVat ?? 0,
      status: active?.status ?? "none",
    };
  }, [vatReturns, currentQuarter]);

  // E2 (J3-r2): the badge follows the filing stage (ready, filed, paid / refund received).
  const getStatusBadge = (
    ret: string | { status: string; paymentStatus?: string | null; box14PayableTax?: number }
  ) => {
    const status = typeof ret === "string" ? ret : vatFilingStage(ret);
    switch (status) {
      case "ready":
        return (
          <Badge variant="secondary" className="bg-info-subtle text-info-subtle-foreground">
            <CheckCircle2 className="w-3 h-3 me-1" />
            {t["compliance.vatFlow.statusReady"]}
          </Badge>
        );
      case "paid":
      case "refunded":
        return (
          <Badge variant="default" className="bg-success-subtle text-success-subtle-foreground">
            <CheckCircle2 className="w-3 h-3 me-1" />
            {status === "paid"
              ? t["compliance.vatFlow.statusPaid"]
              : t["compliance.vatFlow.statusRefunded"]}
          </Badge>
        );
      case "amended":
        return <Badge variant="outline">{t["compliance.vatFlow.statusAmended"]}</Badge>;
      case "draft":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 me-1" />
            <T k="banking.statement.draft" />
          </Badge>
        );
      case "pending_review":
        return (
          <Badge variant="secondary" className="bg-warning-subtle text-warning-subtle-foreground">
            <AlertTriangle className="w-3 h-3 me-1" />
            <T k="pages.review" />
          </Badge>
        );
      case "submitted":
        return (
          <Badge variant="default" className="bg-info-subtle text-info-subtle-foreground">
            <Send className="w-3 h-3 me-1" />
            <T k="pages.submitted" />
          </Badge>
        );
      case "filed":
        return (
          <Badge variant="default" className="bg-success-subtle text-success-subtle-foreground">
            <CheckCircle2 className="w-3 h-3 me-1" />
            <T k="pages.filed" />
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // X5 (J1 D7): a period that has not ended is previewed, not generated.
  const newPeriodEnded =
    !!newPeriodEnd && vatPeriodEnded(newPeriodEnd, format(new Date(), "yyyy-MM-dd"));

  const handleCreateReturn = () => {
    if (!canGenerateVatReturn) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.addTrnFirst"),
        description: translateNow("toasts.vatReturnsRequireTheCompanyTrnBefore"),
      });
      return;
    }

    setNewPeriodStart(format(currentQuarter.start, "yyyy-MM-dd"));
    setNewPeriodEnd(format(currentQuarter.end, "yyyy-MM-dd"));
    setCreateDialogOpen(true);
  };

  const handleGenerateReturn = () => {
    if (!canGenerateVatReturn) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.addTrnFirst"),
        description: translateNow("toasts.vatReturnsRequireTheCompanyTrnBefore"),
      });
      return;
    }

    generateMutation.mutate({
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
    });
  };

  const handleViewReturn = (vatReturn: VATReturn) => {
    setSelectedReturn(vatReturn);
    setVatFormData({
      box1aAbuDhabiAmount: vatReturn.box1aAbuDhabiAmount || 0,
      box1aAbuDhabiVat: vatReturn.box1aAbuDhabiVat || 0,
      box1aAbuDhabiAdj: vatReturn.box1aAbuDhabiAdj || 0,
      box1bDubaiAmount: vatReturn.box1bDubaiAmount || 0,
      box1bDubaiVat: vatReturn.box1bDubaiVat || 0,
      box1bDubaiAdj: vatReturn.box1bDubaiAdj || 0,
      box1cSharjahAmount: vatReturn.box1cSharjahAmount || 0,
      box1cSharjahVat: vatReturn.box1cSharjahVat || 0,
      box1cSharjahAdj: vatReturn.box1cSharjahAdj || 0,
      box1dAjmanAmount: vatReturn.box1dAjmanAmount || 0,
      box1dAjmanVat: vatReturn.box1dAjmanVat || 0,
      box1dAjmanAdj: vatReturn.box1dAjmanAdj || 0,
      box1eUmmAlQuwainAmount: vatReturn.box1eUmmAlQuwainAmount || 0,
      box1eUmmAlQuwainVat: vatReturn.box1eUmmAlQuwainVat || 0,
      box1eUmmAlQuwainAdj: vatReturn.box1eUmmAlQuwainAdj || 0,
      box1fRasAlKhaimahAmount: vatReturn.box1fRasAlKhaimahAmount || 0,
      box1fRasAlKhaimahVat: vatReturn.box1fRasAlKhaimahVat || 0,
      box1fRasAlKhaimahAdj: vatReturn.box1fRasAlKhaimahAdj || 0,
      box1gFujairahAmount: vatReturn.box1gFujairahAmount || 0,
      box1gFujairahVat: vatReturn.box1gFujairahVat || 0,
      box1gFujairahAdj: vatReturn.box1gFujairahAdj || 0,
      box2TouristRefundAmount: vatReturn.box2TouristRefundAmount || 0,
      box2TouristRefundVat: vatReturn.box2TouristRefundVat || 0,
      box3ReverseChargeAmount: vatReturn.box3ReverseChargeAmount || 0,
      box3ReverseChargeVat: vatReturn.box3ReverseChargeVat || 0,
      box4ZeroRatedAmount: vatReturn.box4ZeroRatedAmount || 0,
      box5ExemptAmount: vatReturn.box5ExemptAmount || 0,
      box6ImportsAmount: vatReturn.box6ImportsAmount || 0,
      box6ImportsVat: vatReturn.box6ImportsVat || 0,
      box7ImportsAdjAmount: vatReturn.box7ImportsAdjAmount || 0,
      box7ImportsAdjVat: vatReturn.box7ImportsAdjVat || 0,
      box9ExpensesAmount: vatReturn.box9ExpensesAmount || 0,
      box9ExpensesVat: vatReturn.box9ExpensesVat || 0,
      box9ExpensesAdj: vatReturn.box9ExpensesAdj || 0,
      box10ReverseChargeAmount: vatReturn.box10ReverseChargeAmount || 0,
      box10ReverseChargeVat: vatReturn.box10ReverseChargeVat || 0,
    });
    setNotes(vatReturn.notes || "");
    setViewDialogOpen(true);
  };

  const handleEditReturn = (vatReturn: VATReturn) => {
    setSelectedReturn(vatReturn);
    setVatFormData({
      box1aAbuDhabiAmount: vatReturn.box1aAbuDhabiAmount || 0,
      box1aAbuDhabiVat: vatReturn.box1aAbuDhabiVat || 0,
      box1aAbuDhabiAdj: vatReturn.box1aAbuDhabiAdj || 0,
      box1bDubaiAmount: vatReturn.box1bDubaiAmount || 0,
      box1bDubaiVat: vatReturn.box1bDubaiVat || 0,
      box1bDubaiAdj: vatReturn.box1bDubaiAdj || 0,
      box1cSharjahAmount: vatReturn.box1cSharjahAmount || 0,
      box1cSharjahVat: vatReturn.box1cSharjahVat || 0,
      box1cSharjahAdj: vatReturn.box1cSharjahAdj || 0,
      box1dAjmanAmount: vatReturn.box1dAjmanAmount || 0,
      box1dAjmanVat: vatReturn.box1dAjmanVat || 0,
      box1dAjmanAdj: vatReturn.box1dAjmanAdj || 0,
      box1eUmmAlQuwainAmount: vatReturn.box1eUmmAlQuwainAmount || 0,
      box1eUmmAlQuwainVat: vatReturn.box1eUmmAlQuwainVat || 0,
      box1eUmmAlQuwainAdj: vatReturn.box1eUmmAlQuwainAdj || 0,
      box1fRasAlKhaimahAmount: vatReturn.box1fRasAlKhaimahAmount || 0,
      box1fRasAlKhaimahVat: vatReturn.box1fRasAlKhaimahVat || 0,
      box1fRasAlKhaimahAdj: vatReturn.box1fRasAlKhaimahAdj || 0,
      box1gFujairahAmount: vatReturn.box1gFujairahAmount || 0,
      box1gFujairahVat: vatReturn.box1gFujairahVat || 0,
      box1gFujairahAdj: vatReturn.box1gFujairahAdj || 0,
      box2TouristRefundAmount: vatReturn.box2TouristRefundAmount || 0,
      box2TouristRefundVat: vatReturn.box2TouristRefundVat || 0,
      box3ReverseChargeAmount: vatReturn.box3ReverseChargeAmount || 0,
      box3ReverseChargeVat: vatReturn.box3ReverseChargeVat || 0,
      box4ZeroRatedAmount: vatReturn.box4ZeroRatedAmount || 0,
      box5ExemptAmount: vatReturn.box5ExemptAmount || 0,
      box6ImportsAmount: vatReturn.box6ImportsAmount || 0,
      box6ImportsVat: vatReturn.box6ImportsVat || 0,
      box7ImportsAdjAmount: vatReturn.box7ImportsAdjAmount || 0,
      box7ImportsAdjVat: vatReturn.box7ImportsAdjVat || 0,
      box9ExpensesAmount: vatReturn.box9ExpensesAmount || 0,
      box9ExpensesVat: vatReturn.box9ExpensesVat || 0,
      box9ExpensesAdj: vatReturn.box9ExpensesAdj || 0,
      box10ReverseChargeAmount: vatReturn.box10ReverseChargeAmount || 0,
      box10ReverseChargeVat: vatReturn.box10ReverseChargeVat || 0,
    });
    setNotes(vatReturn.notes || "");
    setEditDialogOpen(true);
  };

  const handleSaveReturn = () => {
    if (!selectedReturn) return;
    // W4-E: boxes come from the VAT engine; only descriptive fields are editable. Corrections
    // go through return adjustments (tourist refunds, corrections) so they are audited.
    updateMutation.mutate({
      id: selectedReturn.id,
      data: { notes },
    });
  };

  const handleSubmitReturn = () => {
    if (!selectedReturn) return;
    submitMutation.mutate({ id: selectedReturn.id });
  };

  const handleExportPDF = (vatReturn: VATReturn) => {
    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 15;

    const formatNum = (num: number) =>
      num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    doc.setFillColor(0, 100, 0);
    doc.rect(0, 0, pageWidth, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text("VAT RETURN - VAT 201", pageWidth / 2, 12, { align: "center" });
    doc.setFontSize(10);
    doc.text("Federal Tax Authority | الهيئة الاتحادية للضرائب", pageWidth / 2, 20, {
      align: "center",
    });

    doc.setTextColor(0, 0, 0);
    y = 35;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("TAXPAYER INFORMATION", margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`TRN: ${company?.trnVatNumber || "N/A"}`, margin, y);
    doc.text(
      `VAT Period: ${format(parseCalendarDate(vatReturn.periodStart), "dd/MM/yyyy")} - ${format(parseCalendarDate(vatReturn.periodEnd), "dd/MM/yyyy")}`,
      pageWidth / 2,
      y
    );
    y += 5;
    doc.text(`Legal Name: ${company?.name || "N/A"}`, margin, y);
    doc.text(
      `Due Date: ${format(parseCalendarDate(vatReturn.dueDate), "dd/MM/yyyy")}`,
      pageWidth / 2,
      y
    );
    y += 5;
    doc.text(`Address: ${company?.address || "N/A"}`, margin, y);
    y += 8;

    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y, pageWidth - 2 * margin, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.text("VAT ON SALES AND ALL OTHER OUTPUTS", margin + 2, y + 5);
    y += 12;

    doc.setFont("helvetica", "normal");
    const salesHeaders = ["Description", "Amount (AED)", "VAT (AED)", "Adjustment"];
    const colWidths = [80, 35, 35, 30];
    let x = margin;
    salesHeaders.forEach((h, i) => {
      doc.text(h, x, y);
      x += colWidths[i];
    });
    y += 4;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    const emirates = [
      {
        name: "1a. Abu Dhabi",
        a: vatReturn.box1aAbuDhabiAmount,
        v: vatReturn.box1aAbuDhabiVat,
        adj: vatReturn.box1aAbuDhabiAdj,
      },
      {
        name: "1b. Dubai",
        a: vatReturn.box1bDubaiAmount,
        v: vatReturn.box1bDubaiVat,
        adj: vatReturn.box1bDubaiAdj,
      },
      {
        name: "1c. Sharjah",
        a: vatReturn.box1cSharjahAmount,
        v: vatReturn.box1cSharjahVat,
        adj: vatReturn.box1cSharjahAdj,
      },
      {
        name: "1d. Ajman",
        a: vatReturn.box1dAjmanAmount,
        v: vatReturn.box1dAjmanVat,
        adj: vatReturn.box1dAjmanAdj,
      },
      {
        name: "1e. Umm Al Quwain",
        a: vatReturn.box1eUmmAlQuwainAmount,
        v: vatReturn.box1eUmmAlQuwainVat,
        adj: vatReturn.box1eUmmAlQuwainAdj,
      },
      {
        name: "1f. Ras Al Khaimah",
        a: vatReturn.box1fRasAlKhaimahAmount,
        v: vatReturn.box1fRasAlKhaimahVat,
        adj: vatReturn.box1fRasAlKhaimahAdj,
      },
      {
        name: "1g. Fujairah",
        a: vatReturn.box1gFujairahAmount,
        v: vatReturn.box1gFujairahVat,
        adj: vatReturn.box1gFujairahAdj,
      },
    ];

    emirates.forEach((e) => {
      x = margin;
      doc.text(e.name, x, y);
      doc.text(formatNum(e.a || 0), x + colWidths[0] + colWidths[1] - 5, y, { align: "right" });
      doc.text(formatNum(e.v || 0), x + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, {
        align: "right",
      });
      doc.text(
        formatNum(e.adj || 0),
        x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 5,
        y,
        { align: "right" }
      );
      y += 5;
    });

    const otherSales = [
      {
        name: "2. Tourist Refunds",
        a: vatReturn.box2TouristRefundAmount,
        v: vatReturn.box2TouristRefundVat,
      },
      {
        name: "3. Reverse Charge",
        a: vatReturn.box3ReverseChargeAmount,
        v: vatReturn.box3ReverseChargeVat,
      },
      { name: "4. Zero Rated", a: vatReturn.box4ZeroRatedAmount, v: 0 },
      { name: "5. Exempt", a: vatReturn.box5ExemptAmount, v: 0 },
      { name: "6. Imports", a: vatReturn.box6ImportsAmount, v: vatReturn.box6ImportsVat },
      {
        name: "7. Import Adjustments",
        a: vatReturn.box7ImportsAdjAmount,
        v: vatReturn.box7ImportsAdjVat,
      },
    ];

    otherSales.forEach((e) => {
      x = margin;
      doc.text(e.name, x, y);
      doc.text(formatNum(e.a || 0), x + colWidths[0] + colWidths[1] - 5, y, { align: "right" });
      if (e.v !== null)
        doc.text(formatNum(e.v || 0), x + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, {
          align: "right",
        });
      y += 5;
    });

    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y - 4, pageWidth - 2 * margin, 6, "F");
    doc.text("8. TOTAL OUTPUT", margin + 2, y);
    doc.text(
      formatNum(vatReturn.box8TotalAmount || 0),
      margin + colWidths[0] + colWidths[1] - 5,
      y,
      { align: "right" }
    );
    doc.text(
      formatNum(vatReturn.box8TotalVat || 0),
      margin + colWidths[0] + colWidths[1] + colWidths[2] - 5,
      y,
      { align: "right" }
    );
    y += 10;

    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y, pageWidth - 2 * margin, 7, "F");
    doc.text("VAT ON EXPENSES AND ALL OTHER INPUTS", margin + 2, y + 5);
    y += 12;

    doc.setFont("helvetica", "normal");
    x = margin;
    salesHeaders.forEach((h, i) => {
      doc.text(h, x, y);
      x += colWidths[i];
    });
    y += 4;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    const expenses = [
      {
        name: "9. Standard Rated Expenses",
        a: vatReturn.box9ExpensesAmount,
        v: vatReturn.box9ExpensesVat,
        adj: vatReturn.box9ExpensesAdj,
      },
      {
        name: "10. Reverse Charge (Input)",
        a: vatReturn.box10ReverseChargeAmount,
        v: vatReturn.box10ReverseChargeVat,
        adj: 0,
      },
    ];

    expenses.forEach((e) => {
      x = margin;
      doc.text(e.name, x, y);
      doc.text(formatNum(e.a || 0), x + colWidths[0] + colWidths[1] - 5, y, { align: "right" });
      doc.text(formatNum(e.v || 0), x + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, {
        align: "right",
      });
      doc.text(
        formatNum(e.adj || 0),
        x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 5,
        y,
        { align: "right" }
      );
      y += 5;
    });

    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y - 4, pageWidth - 2 * margin, 6, "F");
    doc.text("11. TOTAL INPUT", margin + 2, y);
    doc.text(
      formatNum(vatReturn.box11TotalAmount || 0),
      margin + colWidths[0] + colWidths[1] - 5,
      y,
      { align: "right" }
    );
    doc.text(
      formatNum(vatReturn.box11TotalVat || 0),
      margin + colWidths[0] + colWidths[1] + colWidths[2] - 5,
      y,
      { align: "right" }
    );
    y += 12;

    doc.setFillColor(0, 100, 0);
    doc.rect(margin, y, pageWidth - 2 * margin, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    y += 6;
    doc.text("NET VAT DUE", margin + 2, y);
    y += 6;
    doc.text(`12. Total Due Tax: AED ${formatNum(vatReturn.box12TotalDueTax || 0)}`, margin + 5, y);
    y += 5;
    doc.text(
      `13. Recoverable Tax: AED ${formatNum(vatReturn.box13RecoverableTax || 0)}`,
      margin + 5,
      y
    );
    y += 5;
    doc.setFontSize(12);
    const netTax = vatReturn.box14PayableTax || 0;
    doc.text(
      `14. ${netTax >= 0 ? "Payable" : "Refundable"}: AED ${formatNum(Math.abs(netTax))}`,
      margin + 5,
      y
    );

    doc.setTextColor(100, 100, 100);
    doc.setFontSize(7);
    doc.text(
      `Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")} | www.tax.gov.ae`,
      pageWidth / 2,
      285,
      { align: "center" }
    );

    doc.save(`VAT201-${format(parseCalendarDate(vatReturn.periodStart), "yyyy-MM")}.pdf`);

    toast({
      title: translateNow("toasts.pdfExported"),
      description: translateNow("toasts.vat201ReturnHasBeenDownloaded"),
    });
  };

  const handleExportExcel = async (vatReturn: VATReturn) => {
    try {
      await exportToExcel(
        prepareVat201ForExport(vatReturn, company),
        vat201ExportFilename(vatReturn, company)
      );
      toast({
        title: translateNow("toasts.excelExported"),
        description: translateNow("toasts.vat201WorkbookHasBeenDownloadedFor"),
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.exportFailed"),
        description: error?.message || translateNow("toasts.couldNotExportVat201Workbook"),
      });
    }
  };

  if (isLoadingCompany) {
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

  // Spec 3.12 (WP-D): editing a return is a full-page VAT 201 workbook, not a dialog, so the
  // boxes have room on mobile. Same form, same handlers; Cancel returns to the list.
  if (editDialogOpen && selectedReturn && company) {
    return (
      <div className="space-y-6 pb-24" data-testid="vat201-workbook-page">
        <PageHeader
          eyebrow={t["pages.eyebrowCompliance"]}
          title={t["compliance.vatWorkbookTitle"]}
          description={`${format(parseCalendarDate(selectedReturn.periodStart), "MMM yyyy", dfOpts)} – ${format(
            parseCalendarDate(selectedReturn.periodEnd),
            "MMM yyyy",
            dfOpts
          )}`}
          backHref="/vat-filing"
          backLabel={t["compliance.vatBackToReturns"]}
        />
        <VAT201Form
          data={vatFormData}
          onChange={setVatFormData}
          companyInfo={{
            nameEn: company.legalName || company.name,
            nameAr: company.nameAr || undefined,
            trnNumber: company.trnVatNumber || undefined,
            address: companyAddressLine(company) || company.address || undefined,
            phone: company.contactPhone || company.phone || undefined,
          }}
          periodInfo={{
            periodStart: formatDisplayDate(selectedReturn.periodStart, locale),
            periodEnd: formatDisplayDate(selectedReturn.periodEnd, locale),
            dueDate: formatDisplayDate(selectedReturn.dueDate, locale),
            taxYearEnd: selectedReturn.taxYearEnd
              ? formatDisplayDate(selectedReturn.taxYearEnd, locale)
              : undefined,
            vatStagger: vatStaggerLabel(
              selectedReturn.vatStagger || company.vatFilingFrequency || "Quarterly",
              company.vatPeriodStartMonth,
              (m) => format(new Date(2000, m - 1, 1), "MMM", dfOpts)
            ),
          }}
          readOnly={true}
          summaryOffsetClassName="bottom-[4.5rem]"
        />
        <section className="max-w-[760px] space-y-2">
          <Label htmlFor="vat-return-notes">{locale === "ar" ? "ملاحظات" : "Notes"}</Label>
          <Textarea
            id="vat-return-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={locale === "ar" ? "أضف ملاحظات..." : "Add notes..."}
            className="min-h-20"
          />
        </section>
        {/* B4: one row on a phone (no wrap, no send icon) so the bar stays 64 px tall. */}
        <div
          className="sticky bottom-0 z-20 -mx-4 flex flex-nowrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 max-sm:[&>button]:min-w-0 max-sm:[&>button]:px-3 sm:-mx-8 sm:px-8"
          data-testid="vat201-workbook-actions"
        >
          <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
            {locale === "ar" ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            variant="secondary"
            onClick={handleSaveReturn}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t["compliance.vatFilingSaveDraft"]}
          </Button>
          <Button onClick={handleSubmitReturn} disabled={submitMutation.isPending}>
            {submitMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            <Send className="hidden w-4 h-4 me-2 sm:inline" />
            {t["compliance.vatFilingSubmitForFiling"]}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={locale === "ar" ? "الامتثال الضريبي" : "Compliance"}
        title={locale === "ar" ? "إقرار ضريبة القيمة المضافة 201" : "UAE VAT 201 return"}
        description={
          locale === "ar"
            ? "إعداد أرقام VAT 201 ومراجعتها وتصديرها لاستخدامها في قناة التقديم الرسمية"
            : "Prepare VAT 201 totals, review the worksheet evidence, and export filing support for the official channel."
        }
        backHref="/reports"
        backLabel={t["compliance.vatFilingBackToReports"]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" data-testid="button-vat-refund-support">
              <Link href={evidenceSectionHref("refund-pack-export")}>
                <FileText className="w-4 h-4 me-2" />
                {t["compliance.vatFilingRefundSupport"]}
              </Link>
            </Button>
            {canGenerateVatReturn ? (
              <Button onClick={handleCreateReturn} data-testid="button-create-return">
                <Calculator className="w-4 h-4 me-2" />
                {t["compliance.vatFilingNewVatDraft"]}
              </Button>
            ) : (
              <Button asChild data-testid="button-add-trn-header">
                <Link href="/company-profile">
                  <AlertTriangle className="w-4 h-4 me-2" />
                  {t["compliance.vatFilingAddTrn"]}
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {!company?.trnVatNumber && (
        <Card className="border-warning/30 bg-warning-subtle ">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-warning-subtle-foreground ">
                  {t["compliance.vatFilingTaxRegistrationNumberMissing"]}
                </p>
                <p className="text-sm text-warning ">
                  {locale === "ar"
                    ? "يرجى إضافة رقم التسجيل الضريبي في إعدادات الشركة للتمكن من تقديم الإقرارات."
                    : "Please add your TRN in Company Profile before creating official VAT drafts."}
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link href="/company-profile" data-testid="link-add-trn-warning">
                    {t["compliance.vatFilingOpenCompanyProfile"]}
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Current filing hero — lead with the answer, not the spreadsheet ── */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr]">
          {/* Left: period + net VAT position */}
          <div className="p-6 lg:p-7">
            <div className="flex items-center gap-2 text-caption font-semibold text-accent">
              <span aria-hidden className="inline-block h-px w-5 bg-accent/60" />
              {t["compliance.vatFilingCurrentFilingPeriod"]}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-2xl leading-none tracking-tight text-foreground">
                {format(currentFiling.periodStart, "d MMM", dfOpts)} –{" "}
                {format(currentFiling.periodEnd, "d MMM yyyy", dfOpts)}
              </h2>
              {currentFiling.hasReturn &&
                currentFiling.return &&
                getStatusBadge(currentFiling.return)}
            </div>

            <div className="mt-5">
              <p className="text-caption font-semibold text-muted-foreground">
                {currentFiling.isRefund
                  ? locale === "ar"
                    ? "استرداد ضريبي مستحق"
                    : "VAT refund due"
                  : t["compliance.vatFilingNetVatPayable"]}
              </p>
              <p
                className={`mt-1 text-display font-semibold leading-none tracking-tight tabular-nums ${
                  !currentFiling.hasReturn
                    ? "text-muted-foreground"
                    : currentFiling.isRefund
                      ? "text-success"
                      : "text-foreground"
                }`}
                data-testid="text-vat-net-hero"
              >
                {currentFiling.hasReturn ? (
                  <Money amount={Math.abs(currentFiling.net)} />
                ) : (
                  t["compliance.vatFilingNotYetCalculated"]
                )}
              </p>
              {!currentFiling.hasReturn &&
                !vatPeriodEnded(
                  format(currentFiling.periodEnd, "yyyy-MM-dd"),
                  format(new Date(), "yyyy-MM-dd")
                ) && (
                  <div className="mt-3">
                    <VatPeriodPreview
                      companyId={companyId}
                      periodStart={format(currentFiling.periodStart, "yyyy-MM-dd")}
                      periodEnd={format(currentFiling.periodEnd, "yyyy-MM-dd")}
                    />
                  </div>
                )}
              {currentFiling.hasReturn && (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-small text-muted-foreground tabular-nums">
                  <span>
                    {t["compliance.vatFilingOutputVat"]}:{" "}
                    <span className="font-medium text-foreground">
                      <Money amount={currentFiling.output} />
                    </span>
                  </span>
                  <span>
                    {t["compliance.vatFilingInputVat"]}:{" "}
                    <span className="font-medium text-foreground">
                      <Money amount={currentFiling.input} />
                    </span>
                  </span>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {currentFiling.hasReturn ? (
                <>
                  <Button
                    onClick={() => handleViewReturn(currentFiling.return)}
                    data-testid="button-hero-view-return"
                  >
                    <Eye className="me-2 h-4 w-4" />
                    {t["compliance.vatFilingReviewReturn"]}
                  </Button>
                  {(currentFiling.status === "draft" ||
                    currentFiling.status === "pending_review") && (
                    <Button
                      variant="outline"
                      onClick={() => handleEditReturn(currentFiling.return)}
                      data-testid="button-hero-edit-return"
                    >
                      <Edit3 className="me-2 h-4 w-4" />
                      {locale === "ar" ? "تعديل" : "Edit"}
                    </Button>
                  )}
                  {companyId && currentFiling.return && (
                    <VatFilingActions companyId={companyId} vatReturn={currentFiling.return} />
                  )}
                </>
              ) : canGenerateVatReturn ? (
                <Button onClick={handleCreateReturn} data-testid="button-hero-generate">
                  <Calculator className="me-2 h-4 w-4" />
                  {t["compliance.vatFilingGenerateReturn"]}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/company-profile">
                    <AlertTriangle className="me-2 h-4 w-4" />
                    {t["compliance.vatFilingAddTrn"]}
                  </Link>
                </Button>
              )}
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="min-h-11 md:min-h-8"
                data-testid="button-vat-proof-trail"
              >
                <Link href={evidenceSectionHref("proof-drilldown")}>
                  {t["compliance.vatFilingViewProof"]}
                </Link>
              </Button>
            </div>
          </div>

          {/* Right: due-date countdown */}
          <div className="flex flex-col justify-center gap-1 border-t border-card-border bg-muted/30 p-6 lg:border-s lg:border-t-0 lg:p-7">
            <p className="text-caption font-semibold text-muted-foreground">
              {t["compliance.vatFilingFilingDeadline"]}
            </p>
            <p className="mt-1 font-display text-xl leading-tight tracking-tight text-foreground">
              {format(currentFiling.dueDate, "d MMMM yyyy", dfOpts)}
            </p>
            {(() => {
              const d = currentFiling.daysUntilDue;
              const filed =
                currentFiling.status === "filed" || currentFiling.status === "submitted";
              const tone = filed ? "success" : d < 0 ? "danger" : d <= 7 ? "warning" : "neutral";
              const label = filed
                ? locale === "ar"
                  ? "تم التقديم"
                  : "Filed"
                : d < 0
                  ? locale === "ar"
                    ? `متأخر بـ ${Math.abs(d)} يوم`
                    : `Overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}`
                  : d === 0
                    ? t["compliance.vatFilingDueToday"]
                    : locale === "ar"
                      ? `باقٍ ${d} يوم`
                      : `Due in ${d} day${d === 1 ? "" : "s"}`;
              return (
                <div className="mt-3">
                  <StatusBadge tone={tone as any}>{label}</StatusBadge>
                </div>
              );
            })()}
            {/* Filing checklist: true states only. Muhasib prepares the return; the user files it on EmaraTax. */}
            {(() => {
              // E2 (J3-r2): one reading of the stage; "ready" counts as reviewed, and the
              // payment / refund recorded through the settlement is the last step.
              const check = vatChecklist(currentFiling.hasReturn ? currentFiling.return : null);
              const steps = [
                { done: check.calculated, label: t["compliance.vatFlow.calculated"] },
                { done: check.ready, label: t["compliance.vatFlow.reviewed"] },
                { done: check.filed, label: t["compliance.vatFlow.filedStep"] },
                {
                  done: check.settled,
                  label: check.nothingToSettle
                    ? t["compliance.vatFlow.stepNothing"]
                    : currentFiling.isRefund
                      ? t["compliance.vatFlow.stepRefund"]
                      : t["compliance.vatFlow.stepPaid"],
                },
              ];
              return (
                <ol className="mt-4 space-y-2" data-testid="vat-filing-checklist">
                  {steps.map((step) => (
                    <li key={step.label} className="flex items-center gap-2 text-small">
                      {step.done ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                      ) : (
                        <span
                          className="h-4 w-4 shrink-0 rounded-full border border-border-strong"
                          aria-hidden
                        />
                      )}
                      <span className={step.done ? "text-foreground" : "text-muted-foreground"}>
                        {step.label}
                      </span>
                      <span className="sr-only">
                        {step.done
                          ? locale === "ar"
                            ? "(مكتمل)"
                            : "(done)"
                          : locale === "ar"
                            ? "(لم يكتمل)"
                            : "(not done)"}
                      </span>
                    </li>
                  ))}
                </ol>
              );
            })()}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {locale === "ar"
                ? "يجب تقديم الإقرار وسداد الضريبة خلال 28 يومًا من نهاية الفترة الضريبية. لا يُرسل النظام أي بيانات إلى الهيئة الاتحادية للضرائب."
                : "Returns and payment are due within 28 days of the tax period end (FTA). Muhasib does not transmit anything to the FTA."}
            </p>
          </div>
        </div>
      </Card>

      <Tabs value={vatTab} onValueChange={setVatTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="returns" data-testid="tab-vat-returns">
            <ListChecks className="me-2 h-4 w-4" />
            {locale === "ar" ? "الإقرارات" : "Returns"}
          </TabsTrigger>
          <TabsTrigger value="periods" data-testid="tab-vat-periods">
            <CalendarClock className="me-2 h-4 w-4" />
            {locale === "ar" ? "الفترات" : "Periods"}
          </TabsTrigger>
          <TabsTrigger value="workpaper" data-testid="tab-vat-workpaper">
            <FileSpreadsheet className="me-2 h-4 w-4" />
            {locale === "ar" ? "ورقة العمل" : "Workpaper"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="mt-0 space-y-6">
          {hasVatReturns && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {(
                [
                  {
                    label: locale === "ar" ? "إجمالي الإقرارات" : "Total returns",
                    value: String(stats.total),
                  },
                  {
                    label: locale === "ar" ? "قيد المراجعة" : "Pending review",
                    value: String(stats.pending),
                  },
                  {
                    label: locale === "ar" ? "مقدَّمة" : "Filed",
                    value: String(stats.filed),
                  },
                  {
                    label:
                      stats.totalPayable >= 0
                        ? t["compliance.vatFilingTotalPayable"]
                        : locale === "ar"
                          ? "إجمالي الاسترداد"
                          : "Total refundable",
                    value: <Money amount={Math.abs(stats.totalPayable)} />,
                  },
                ] as const
              ).map((s) => (
                <StatCard key={s.label} label={s.label} value={s.value} />
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{locale === "ar" ? "سجل الإقرارات" : "VAT returns history"}</CardTitle>
              <CardDescription>
                {t["compliance.vatFilingAllYourVatReturnSubmissionsAnd"]}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingReturns ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : !vatReturns || vatReturns.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {locale === "ar"
                      ? "لا توجد إقرارات ضريبية بعد."
                      : canGenerateVatReturn
                        ? "No VAT returns yet. Create your first official VAT draft when you are ready."
                        : "No VAT returns yet. Add the company TRN before creating official VAT drafts."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:hidden" data-testid="mobile-vat-return-list">
                    {vatReturns.map((vatReturn) => (
                      <Card key={vatReturn.id}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">
                                {format(
                                  parseCalendarDate(vatReturn.periodStart),
                                  "MMM yyyy",
                                  dfOpts
                                )}{" "}
                                -{" "}
                                {format(parseCalendarDate(vatReturn.periodEnd), "MMM yyyy", dfOpts)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatMessage(t["pages.vatDueOn"], {
                                  date: format(
                                    parseCalendarDate(vatReturn.dueDate),
                                    "dd MMM yyyy",
                                    dfOpts
                                  ),
                                })}
                              </p>
                            </div>
                            {getStatusBadge(vatReturn)}
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "المخرجات" : "Output"}
                              </p>
                              <p className="tabular-nums">
                                <Money
                                  amount={vatReturn.box12TotalDueTax || vatReturn.box8TotalVat || 0}
                                />
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "المدخلات" : "Input"}
                              </p>
                              <p className="tabular-nums">
                                <Money
                                  amount={
                                    vatReturn.box13RecoverableTax || vatReturn.box11TotalVat || 0
                                  }
                                />
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "الصافي" : "Net"}
                              </p>
                              <p
                                className={`tabular-nums font-semibold ${(vatReturn.box14PayableTax || 0) === 0 ? "text-foreground" : (vatReturn.box14PayableTax || 0) > 0 ? "text-destructive" : "text-success"}`}
                              >
                                <Money amount={Math.abs(vatReturn.box14PayableTax || 0)} />
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewReturn(vatReturn)}
                              data-testid={`mobile-button-view-vat-${vatReturn.id}`}
                            >
                              <Eye className="w-4 h-4 me-1" />
                              {t["compliance.vatView"]}
                            </Button>
                            {(vatReturn.status === "draft" ||
                              vatReturn.status === "pending_review") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditReturn(vatReturn)}
                                data-testid={`mobile-button-edit-vat-${vatReturn.id}`}
                              >
                                <Edit3 className="w-4 h-4 me-1" />
                                {t["compliance.vatEdit"]}
                              </Button>
                            )}
                            {companyId && (
                              <div className="col-span-2 flex flex-wrap items-center gap-2">
                                <VatFilingActions
                                  companyId={companyId}
                                  vatReturn={vatReturn}
                                  size="sm"
                                />
                              </div>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleExportPDF(vatReturn)}
                            >
                              PDF
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleExportExcel(vatReturn)}
                            >
                              XLSX
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <div className="hidden rounded-md border overflow-x-auto md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{locale === "ar" ? "الفترة" : "Period"}</TableHead>
                          <TableHead>{t["compliance.vatFilingDueDate"]}</TableHead>
                          <TableHead data-numeric>{t["compliance.vatFilingOutputTax"]}</TableHead>
                          <TableHead data-numeric>{t["compliance.vatFilingInputTax"]}</TableHead>
                          <TableHead data-numeric>{t["compliance.vatFilingNetTax"]}</TableHead>
                          <TableHead>{locale === "ar" ? "الحالة" : "Status"}</TableHead>
                          <TableHead data-numeric>
                            {locale === "ar" ? "الإجراءات" : "Actions"}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vatReturns.map((vatReturn) => (
                          <TableRow key={vatReturn.id} data-testid={`row-return-${vatReturn.id}`}>
                            <TableCell className="font-medium">
                              {format(parseCalendarDate(vatReturn.periodStart), "MMM yyyy", dfOpts)}{" "}
                              - {format(parseCalendarDate(vatReturn.periodEnd), "MMM yyyy", dfOpts)}
                            </TableCell>
                            <TableCell>
                              {format(parseCalendarDate(vatReturn.dueDate), "dd MMM yyyy", dfOpts)}
                            </TableCell>
                            <TableCell data-numeric>
                              <Money
                                amount={vatReturn.box12TotalDueTax || vatReturn.box8TotalVat || 0}
                              />
                            </TableCell>
                            <TableCell data-numeric>
                              <Money
                                amount={
                                  vatReturn.box13RecoverableTax || vatReturn.box11TotalVat || 0
                                }
                              />
                            </TableCell>
                            <TableCell
                              data-numeric
                              className={` font-medium ${(vatReturn.box14PayableTax || 0) === 0 ? "text-foreground" : (vatReturn.box14PayableTax || 0) > 0 ? "text-destructive" : "text-success"}`}
                            >
                              {(vatReturn.box14PayableTax || 0) >= 0 ? "" : "("}
                              <Money amount={Math.abs(vatReturn.box14PayableTax || 0)} />
                              {(vatReturn.box14PayableTax || 0) >= 0 ? "" : ")"}
                            </TableCell>
                            <TableCell>{getStatusBadge(vatReturn)}</TableCell>
                            <TableCell data-numeric>
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleViewReturn(vatReturn)}
                                  data-testid={`button-view-${vatReturn.id}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                {(vatReturn.status === "draft" ||
                                  vatReturn.status === "pending_review") && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleEditReturn(vatReturn)}
                                    data-testid={`button-edit-${vatReturn.id}`}
                                  >
                                    <Edit3 className="w-4 h-4 me-1" />
                                    {locale === "ar" ? "تحرير" : "Edit"}
                                  </Button>
                                )}
                                {companyId && (
                                  <VatFilingActions
                                    companyId={companyId}
                                    vatReturn={vatReturn}
                                    size="sm"
                                  />
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleExportPDF(vatReturn)}
                                  title={t["compliance.vatFilingDownloadPdf"]}
                                  data-testid={`button-export-pdf-${vatReturn.id}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleExportExcel(vatReturn)}
                                  title={t["compliance.vatFilingDownloadExcel"]}
                                  data-testid={`button-export-vat201-excel-${vatReturn.id}`}
                                >
                                  XLSX
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Workpaper — the accountant's Excel-like workbook, first-class ── */}
        <TabsContent value="periods" className="mt-0">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <VatPeriodsPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="workpaper" className="mt-0">
          <div className="mb-4">
            <p className="font-semibold tracking-tight text-foreground">
              {locale === "ar" ? "ورقة عمل الأدلة الضريبية" : "VAT evidence workpaper"}
            </p>
            <p className="mt-0.5 text-small text-muted-foreground">
              {locale === "ar"
                ? "أدخل أو الصق أو اسحب البنود من الدفاتر لبناء إجماليات VAT 201 مع الأدلة."
                : "Enter, paste, or pull lines from your books to build the VAT 201 totals with evidence."}
            </p>
          </div>
          <VatWorkpaperPanel
            companyId={companyId}
            canGenerateVatReturn={canGenerateVatReturn}
            defaultPeriodStart={currentQuarter.start}
            defaultPeriodEnd={currentQuarter.end}
            defaultEmirate={company?.emirate}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t["compliance.vatFilingCreateOfficialVatDraft"]}</DialogTitle>
            <DialogDescription>
              {locale === "ar"
                ? "حدد الفترة الضريبية لإنشاء المسودة من السجلات"
                : "Select the tax period to create a draft from recorded books."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["compliance.vatFilingPeriodStart"]}</Label>
                <DatePicker
                  value={newPeriodStart}
                  onChange={(value) => setNewPeriodStart(value)}
                  data-testid="input-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label>{t["compliance.vatFilingPeriodEnd"]}</Label>
                <DatePicker
                  value={newPeriodEnd}
                  onChange={(value) => setNewPeriodEnd(value)}
                  data-testid="input-period-end"
                />
              </div>
            </div>
            <div className="bg-muted/50 p-3 rounded-md text-sm">
              <p className="font-medium mb-1">{locale === "ar" ? "ملاحظة:" : "Note:"}</p>
              <p className="text-muted-foreground">
                {locale === "ar"
                  ? "سيتم حساب المبالغ تلقائياً من الفواتير والمصروفات المسجلة."
                  : "Amounts will be calculated automatically from your recorded invoices and expenses."}
              </p>
            </div>
            {!canGenerateVatReturn && (
              <div className="rounded-md border border-warning/30 bg-warning-subtle p-3 text-sm text-warning-subtle-foreground">
                <T k="pageLabels.addTheCompanyTrnBeforeCreating" />
              </div>
            )}
            {newPeriodStart && newPeriodEnd && !newPeriodEnded && (
              <div className="space-y-2">
                <VatPeriodPreview
                  companyId={companyId}
                  periodStart={newPeriodStart}
                  periodEnd={newPeriodEnd}
                  compact
                />
                <p
                  className="text-small text-muted-foreground"
                  data-testid="text-vat-generate-after"
                >
                  {formatMessage(t["compliance.vatPreview.generateAfter"], {
                    date: formatDisplayDate(newPeriodEnd, locale),
                  })}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={handleGenerateReturn}
              disabled={
                generateMutation.isPending ||
                !newPeriodStart ||
                !newPeriodEnd ||
                !newPeriodEnded ||
                !canGenerateVatReturn
              }
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t["compliance.vatFilingCreateDraft"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {locale === "ar" ? "عرض الإقرار الضريبي" : "View VAT 201 return"}
            </DialogTitle>
            <DialogDescription>
              {selectedReturn && (
                <span>
                  {format(parseCalendarDate(selectedReturn.periodStart), "MMM yyyy", dfOpts)} -{" "}
                  {format(parseCalendarDate(selectedReturn.periodEnd), "MMM yyyy", dfOpts)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn && company && (
            <VAT201Form
              data={vatFormData}
              onChange={() => {}}
              companyInfo={{
                nameEn: company.legalName || company.name,
                nameAr: company.nameAr || undefined,
                trnNumber: company.trnVatNumber || undefined,
                address: companyAddressLine(company) || company.address || undefined,
                phone: company.contactPhone || company.phone || undefined,
              }}
              periodInfo={{
                periodStart: formatDisplayDate(selectedReturn.periodStart, locale),
                periodEnd: formatDisplayDate(selectedReturn.periodEnd, locale),
                dueDate: formatDisplayDate(selectedReturn.dueDate, locale),
                taxYearEnd: selectedReturn.taxYearEnd
                  ? formatDisplayDate(selectedReturn.taxYearEnd, locale)
                  : undefined,
                vatStagger: vatStaggerLabel(
                  selectedReturn.vatStagger || company.vatFilingFrequency || "Quarterly",
                  company.vatPeriodStartMonth,
                  (m) => format(new Date(2000, m - 1, 1), "MMM", dfOpts)
                ),
              }}
              readOnly={true}
            />
          )}
          {selectedReturn && companyId && (
            <VatReturnControls
              companyId={companyId}
              vatReturn={selectedReturn}
              onChanged={() => setViewDialogOpen(false)}
            />
          )}
          <DialogFooter>
            {selectedReturn && (
              <AskNajmaButton
                companyId={companyId}
                topic="vat201"
                period={`${selectedReturn.periodStart.slice(0, 10)} to ${selectedReturn.periodEnd.slice(0, 10)}`}
                reference={selectedReturn.id.slice(0, 8)}
                figures={[
                  {
                    label: t["compliance.vatFilingOutputVat"],
                    value: `AED ${Number(selectedReturn.box12TotalDueTax || 0).toFixed(2)}`,
                  },
                  {
                    label: t["compliance.vatFilingInputVat"],
                    value: `AED ${Number(selectedReturn.box13RecoverableTax || 0).toFixed(2)}`,
                  },
                  {
                    label: t["launchProof.figureNetPayable"],
                    value: `AED ${Number(selectedReturn.box14PayableTax || 0).toFixed(2)}`,
                  },
                ]}
                testId="button-ask-najma-vat-return"
              />
            )}
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              {locale === "ar" ? "إغلاق" : "Close"}
            </Button>
            <Button onClick={() => selectedReturn && handleExportPDF(selectedReturn)}>
              <Download className="w-4 h-4 me-2" />
              {t["compliance.vatFilingDownloadPdf"]}
            </Button>
            <Button
              variant="secondary"
              onClick={() => selectedReturn && void handleExportExcel(selectedReturn)}
            >
              XLSX
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
