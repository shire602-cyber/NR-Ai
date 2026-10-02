import { useState, useMemo, useEffect } from "react";
import { companyAddressLine } from "@/lib/company-address";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format,
  parseISO,
  startOfQuarter,
  endOfQuarter,
  addDays,
  differenceInCalendarDays,
} from "date-fns";
import { parseCalendarDay } from "@/lib/date-safe";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_FORMAT, formatDate as formatLocaleDate } from "@/lib/format";
import { statusLabel } from "@/lib/enum-labels";
import { VatEmirateBreakdown } from "@/components/vat/VatEmirateBreakdown";
import { messages as pageMessages } from "./VATFiling.i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { exportToExcel } from "@/lib/export";
import { evidenceSectionHref } from "@/lib/evidenceLinks";
import { prepareVat201ForExport, vat201ExportFilename } from "@/lib/vat201-export";
import VAT201Form from "@/components/VAT201Form";
import type { VatReturnJournalLine } from "@/components/vat/VatJournalLineRows";
import { storedVat201Totals } from "@/lib/vat201-totals";
import VatWorkpaperPanel from "@/components/vat/VatWorkpaperPanel";
import DraftPreviewBanner from "@/components/vat/DraftPreviewBanner";
import { PageHeader } from "@/components/ui/page-header";
import FilingEvidencePanel from "@/components/compliance/FilingEvidencePanel";
import FtaAuditFileCard from "@/components/compliance/FtaAuditFileCard";
import RecordFilingDialog from "@/components/compliance/RecordFilingDialog";
import AmendButton from "@/components/compliance/AmendButton";
import { useComplianceText } from "@/lib/i18n-compliance";
import {
  Lock,
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
} from "lucide-react";
import jsPDF from "jspdf";

/** GET /api/companies/:id/vat-returns/current-period */
interface CurrentVatPeriod {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  state: "ended_unfiled" | "open";
  returnId: string | null;
  returnStatus: string | null;
  earlierUnfiled: Array<{ periodStart: string; periodEnd: string; dueDate: string }>;
}

interface VATReturn {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  taxYearEnd: string | null;
  /** true when computed for a period that has not ended; never persisted or submittable */
  isDraftPreview?: boolean;
  previewAsOf?: string | null;
  /** Manual VAT journals and taxable journal sales behind the boxes (server-owned). */
  vatAdjustments?: VatReturnJournalLine[] | null;
  vatStagger: string | null;
  status: string;
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
  /** Filing with evidence (Phase 4): amendments link to the original; `filing` is set once filed. */
  isAmendment?: boolean;
  amendsReturnId?: string | null;
  amendedBy?: string[];
  filing?: {
    id: string;
    referenceNumber: string;
    filedAt: string;
    evidenceCount: number;
    settlement: { status: string; remaining: number };
  } | null;
}

/** "Aug 2026, Sep 2026, Oct 2026": the calendar months a period covers (filing locks each). */
function monthsCovered(periodStart: string, periodEnd: string, locale = "en"): string {
  const start = parseCalendarDay(periodStart);
  const end = parseCalendarDay(periodEnd);
  const out: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
  while (cursor <= end && out.length < 24) {
    out.push(
      formatLocaleDate(cursor, locale, { month: "short", year: "numeric", timeZone: undefined })
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out.join(", ");
}

interface Company {
  id: string;
  name: string;
  nameAr?: string | null;
  legalName?: string | null;
  /** Arabic legal name from the company profile (shown in the return header when the profile has one). */
  legalNameAr?: string | null;
  trnVatNumber: string | null;
  vatFilingFrequency: string | null;
  emirate: string | null;
  businessAddress?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressCountry?: string | null;
  contactPhone?: string | null;
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
  const { locale } = useTranslation();
  const tr = pageMessages.useT();
  // Dates read in the reader's language (month names, digits): the calendar day is local, so no time zone shift.
  const localDay = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    formatLocaleDate(d, locale, { ...opts, timeZone: undefined });
  const dayShort = (d: Date) => localDay(d, { day: "numeric", month: "short" });
  const dayFull = (d: Date) => localDay(d, { day: "numeric", month: "short", year: "numeric" });
  const dayLong = (d: Date) => localDay(d, { day: "numeric", month: "long", year: "numeric" });
  const monthYear = (d: Date) => localDay(d, { month: "short", year: "numeric" });
  const { c: cc } = useComplianceText();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [filingReturn, setFilingReturn] = useState<VATReturn | null>(null);
  const [openAfterRefresh, setOpenAfterRefresh] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<VATReturn | null>(null);
  const [newPeriodStart, setNewPeriodStart] = useState("");
  const [newPeriodEnd, setNewPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");
  // Written reason for changing a figure by hand (the server requires 10+ characters with any figure edit).
  const [editReason, setEditReason] = useState("");
  const [vatFormData, setVatFormData] = useState<VatWorksheetData>(DEFAULT_VAT_DATA);

  const { data: company } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    enabled: !!companyId,
  });

  const { data: vatReturns, isLoading: isLoadingReturns } = useQuery<VATReturn[]>({
    queryKey: ["/api/companies", companyId, "vat-returns"],
    enabled: !!companyId,
  });

  // After creating an amendment, open it as soon as the refreshed list contains it.
  useEffect(() => {
    if (!openAfterRefresh) return;
    const found = vatReturns?.find((r) => r.id === openAfterRefresh);
    if (found) {
      setOpenAfterRefresh(null);
      handleViewReturn(found);
    }
    // handleViewReturn is a plain function re-created each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAfterRefresh, vatReturns]);

  const returnsListKey = ["/api/companies", companyId, "vat-returns"];

  const generateMutation = useMutation({
    mutationFn: ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/vat-returns/generate`, {
        periodStart,
        periodEnd,
      }),
    onSuccess: (data: VATReturn) => {
      setCreateDialogOpen(false);
      if (data?.isDraftPreview) {
        // Open period: nothing was saved. Show it read-only with the banner.
        toast({
          title: tr("draftPreviewTitle"),
          description: tr("draftPreviewBody"),
        });
        handleViewReturn(data);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: tr("generatedTitle"),
        description: tr("generatedBody"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("generationFailed"),
        description: error?.message || tr("generationFailedBody"),
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PATCH", `/api/vat-returns/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: tr("updatedTitle"),
        description: tr("updatedBody"),
      });
      setEditDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("updateFailed"),
        description: error?.message || tr("updateFailedBody"),
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiRequest("POST", `/api/vat-returns/${id}/submit`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: tr("finalisedTitle"),
        description: tr("finalisedBody"),
      });
      setEditDialogOpen(false);
      setSelectedReturn(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("submissionFailed"),
        description: error?.message || tr("submissionFailedBody"),
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
      filed: vatReturns.filter((r) => r.status === "filed").length,
      // Amendments repeat the whole period's figures; count each period once.
      totalPayable: vatReturns
        .filter((r) => !r.isAmendment)
        .reduce((sum, r) => sum + (r.box14PayableTax || 0), 0),
    };
  }, [vatReturns]);

  // The period the page works on comes from the server: the last ended period not yet filed (Q3, due 28 Oct, while it is
  // early October), else the one that contains today, never a period before the company's VAT start. The calendar
  // quarter is only the fallback while that answer loads or if it fails.
  const { data: serverPeriod } = useQuery<CurrentVatPeriod>({
    queryKey: ["/api/companies", companyId, "vat-returns", "current-period"],
    enabled: !!companyId,
  });
  const currentQuarter = useMemo(() => {
    if (serverPeriod) {
      return {
        start: parseCalendarDay(serverPeriod.periodStart),
        end: parseCalendarDay(serverPeriod.periodEnd),
      };
    }
    const now = new Date();
    return {
      start: startOfQuarter(now),
      end: endOfQuarter(now),
    };
  }, [serverPeriod]);
  const canGenerateVatReturn = Boolean(company?.trnVatNumber);
  const hasVatReturns = (vatReturns?.length ?? 0) > 0;

  // The filing users care about right now: the return for the current quarter
  // if one exists, otherwise the most recently created one. Drives the hero.
  const currentFiling = useMemo(() => {
    const returns = (vatReturns ?? []).filter((r) => !r.isAmendment);
    const match = returns.find((r) => {
      try {
        return (
          format(parseCalendarDay(r.periodStart), "yyyy-MM") ===
            format(currentQuarter.start, "yyyy-MM") &&
          format(parseCalendarDay(r.periodEnd), "yyyy-MM") === format(currentQuarter.end, "yyyy-MM")
        );
      } catch {
        return false;
      }
    });
    // With the server's answer there is no guessing: no return for that period means "not prepared yet", never an
    // older return shown as if it were the current one.
    const active = serverPeriod
      ? match
      : (match ??
        [...returns].sort(
          (a, b) =>
            parseCalendarDay(b.periodEnd).getTime() - parseCalendarDay(a.periodEnd).getTime()
        )[0]);

    const periodStart = active ? parseCalendarDay(active.periodStart) : currentQuarter.start;
    const periodEnd = active ? parseCalendarDay(active.periodEnd) : currentQuarter.end;
    const dueDate = active?.dueDate
      ? parseCalendarDay(active.dueDate)
      : serverPeriod
        ? parseCalendarDay(serverPeriod.dueDate)
        : addDays(periodEnd, 28);
    const daysUntilDue = differenceInCalendarDays(dueDate, new Date());
    const net = active?.box14PayableTax ?? 0;

    return {
      hasReturn: Boolean(active),
      matchesCurrentQuarter: Boolean(match),
      return: active as VATReturn,
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
  }, [vatReturns, currentQuarter, serverPeriod]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 me-1" />
            {statusLabel("draft", locale)}
          </Badge>
        );
      case "pending_review":
        return (
          <Badge variant="secondary" className="bg-warning-subtle text-warning-subtle-foreground">
            <AlertTriangle className="w-3 h-3 me-1" />
            {statusLabel("pending_review", locale)}
          </Badge>
        );
      case "submitted":
        return (
          <Badge variant="default" className="bg-info-subtle text-info-subtle-foreground">
            <Send className="w-3 h-3 me-1" />
            {statusLabel("submitted", locale)}
          </Badge>
        );
      case "filed":
        return (
          <Badge variant="default" className="bg-success-subtle text-success-subtle-foreground">
            <CheckCircle2 className="w-3 h-3 me-1" />
            {statusLabel("filed", locale)}
          </Badge>
        );
      default:
        return <Badge variant="outline">{statusLabel(status, locale)}</Badge>;
    }
  };

  const handleCreateReturn = () => {
    if (!canGenerateVatReturn) {
      toast({
        variant: "destructive",
        title: tr("addTrnFirst"),
        description: tr("addTrnFirstBody"),
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
        title: tr("addTrnFirst"),
        description: tr("addTrnFirstBody"),
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
    setEditReason("");
    setEditDialogOpen(true);
  };

  const handleSaveReturn = () => {
    if (!selectedReturn) return;
    updateMutation.mutate({
      id: selectedReturn.id,
      data: {
        ...vatFormData,
        notes,
        ...(editReason.trim() ? { adjustmentReason: editReason.trim() } : {}),
      },
    });
  };

  const handleSubmitReturn = () => {
    if (!selectedReturn || selectedReturn.isDraftPreview) return;
    submitMutation.mutate({ id: selectedReturn.id });
  };

  const handleExportPDF = (vatReturn: VATReturn) => {
    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 15;

    const formatNum = (num: number) =>
      num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // A worksheet from the ledger, deliberately not styled as the FTA return (no FTA name or colours).
    doc.setFillColor(55, 65, 81);
    doc.rect(0, 0, pageWidth, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text(
      vatReturn.isDraftPreview
        ? "DRAFT PREVIEW - VAT 201 WORKSHEET (PERIOD NOT ENDED)"
        : "VAT 201 WORKSHEET",
      pageWidth / 2,
      12,
      { align: "center" }
    );
    doc.setFontSize(10);
    doc.text(
      "Prepared from your ledger. Not an FTA document: file the return through EmaraTax.",
      pageWidth / 2,
      20,
      {
        align: "center",
      }
    );

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
      `VAT Period: ${format(parseCalendarDay(vatReturn.periodStart), "dd/MM/yyyy")} - ${format(parseCalendarDay(vatReturn.periodEnd), "dd/MM/yyyy")}`,
      pageWidth / 2,
      y
    );
    y += 5;
    doc.text(`Legal Name: ${company?.legalName || company?.name || "N/A"}`, margin, y);
    doc.text(
      `Due Date: ${format(parseCalendarDay(vatReturn.dueDate), "dd/MM/yyyy")}`,
      pageWidth / 2,
      y
    );
    y += 5;
    doc.text(`Address: ${companyAddressLine(company) || "N/A"}`, margin, y);
    y += 8;

    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y, pageWidth - 2 * margin, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.text("VAT ON SALES AND ALL OTHER OUTPUTS", margin + 2, y + 5);
    y += 12;

    doc.setFont("helvetica", "normal");
    // i18n-ignore: the PDF worksheet is English only (jsPDF has no Arabic shaping)
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
    doc.text(
      formatNum(vatReturn.box8TotalAdj || 0),
      margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 5,
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
    doc.text(
      formatNum(vatReturn.box11TotalAdj || 0),
      margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 5,
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
      `Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")} | VAT 201 worksheet - support only`,
      pageWidth / 2,
      285,
      { align: "center" }
    );

    doc.save(`VAT201-${format(parseCalendarDay(vatReturn.periodStart), "yyyy-MM")}.pdf`);

    toast({
      title: tr("pdfExported"),
      description: tr("pdfExportedBody"),
    });
  };

  const handleExportExcel = async (vatReturn: VATReturn) => {
    try {
      await exportToExcel(
        prepareVat201ForExport(vatReturn, company),
        vat201ExportFilename(vatReturn, company)
      );
      toast({
        title: tr("excelExported"),
        description: tr("excelExportedBody"),
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: error?.message || tr("exportFailedBody"),
      });
    }
  };

  if (isLoadingCompany) {
    return (
      <div className="space-y-6 p-6">
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
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow={locale === "ar" ? "الامتثال الضريبي" : "Compliance"}
        title={locale === "ar" ? "إقرار ضريبة القيمة المضافة 201" : "UAE VAT 201 Return"}
        description={
          locale === "ar"
            ? "إعداد أرقام VAT 201 ومراجعتها وتصديرها لاستخدامها في قناة التقديم الرسمية"
            : "Prepare VAT 201 totals, review the worksheet evidence, and export filing support for the official channel."
        }
        backHref="/reports"
        backLabel={locale === "ar" ? "العودة إلى التقارير" : "Back to reports"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" data-testid="button-vat-refund-support">
              <Link href={evidenceSectionHref("refund-pack-export")}>
                <FileText className="w-4 h-4 me-2" />
                {locale === "ar" ? "حزمة دعم الاسترداد" : "Refund support"}
              </Link>
            </Button>
            {canGenerateVatReturn ? (
              <Button onClick={handleCreateReturn} data-testid="button-create-return">
                <Calculator className="w-4 h-4 me-2" />
                {locale === "ar" ? "إنشاء مسودة رسمية" : "New VAT draft"}
              </Button>
            ) : (
              <Button asChild data-testid="button-add-trn-header">
                <Link href="/company-profile">
                  <AlertTriangle className="w-4 h-4 me-2" />
                  {locale === "ar" ? "إضافة رقم التسجيل" : "Add TRN"}
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
                  {locale === "ar"
                    ? "رقم التسجيل الضريبي غير مكتمل"
                    : "Tax Registration Number Missing"}
                </p>
                <p className="text-sm text-warning ">
                  {locale === "ar"
                    ? "يرجى إضافة رقم التسجيل الضريبي في إعدادات الشركة للتمكن من تقديم الإقرارات."
                    : "Please add your TRN in Company Profile before creating official VAT drafts."}
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link href="/company-profile" data-testid="link-add-trn-warning">
                    {locale === "ar" ? "فتح إعدادات الشركة" : "Open Company Profile"}
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
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
              <span aria-hidden className="inline-block h-px w-5 bg-accent/60" />
              {locale === "ar" ? "فترة التقديم الحالية" : "Current filing period"}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-2xl leading-none tracking-tight text-foreground">
                <bdi dir="ltr">
                  {dayShort(currentFiling.periodStart)} – {dayFull(currentFiling.periodEnd)}
                </bdi>
              </h2>
              {currentFiling.hasReturn && getStatusBadge(currentFiling.status)}
            </div>

            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {currentFiling.isRefund
                  ? locale === "ar"
                    ? "استرداد ضريبي مستحق"
                    : "VAT refund due"
                  : locale === "ar"
                    ? "صافي ضريبة القيمة المضافة المستحقة"
                    : "Net VAT payable"}
              </p>
              <p
                className={`mt-1 font-display text-[2.5rem] leading-none tracking-tight tabular-nums ${
                  !currentFiling.hasReturn
                    ? "text-muted-foreground"
                    : currentFiling.isRefund
                      ? "text-success"
                      : "text-foreground"
                }`}
                data-testid="text-vat-net-hero"
              >
                {currentFiling.hasReturn
                  ? formatCurrency(Math.abs(currentFiling.net))
                  : locale === "ar"
                    ? "لم تُحتسب بعد"
                    : "Not yet calculated"}
              </p>
              {currentFiling.hasReturn && (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
                  <span>
                    {locale === "ar" ? "المخرجات" : "Output VAT"}:{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(currentFiling.output)}
                    </span>
                  </span>
                  <span>
                    {locale === "ar" ? "المدخلات" : "Input VAT"}:{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(currentFiling.input)}
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
                    {locale === "ar" ? "عرض الإقرار" : "Review return"}
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
                </>
              ) : canGenerateVatReturn ? (
                <Button onClick={handleCreateReturn} data-testid="button-hero-generate">
                  <Calculator className="me-2 h-4 w-4" />
                  {locale === "ar" ? "احتساب الإقرار" : "Generate return"}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/company-profile">
                    <AlertTriangle className="me-2 h-4 w-4" />
                    {locale === "ar" ? "إضافة رقم التسجيل" : "Add TRN"}
                  </Link>
                </Button>
              )}
              <Button asChild variant="ghost" size="sm" data-testid="button-vat-proof-trail">
                <Link href={evidenceSectionHref("proof-drilldown")}>
                  {locale === "ar" ? "عرض الأدلة" : "View proof"}
                </Link>
              </Button>
            </div>
          </div>

          {/* Right: due-date countdown */}
          <div className="flex flex-col justify-center gap-1 border-t border-card-border bg-muted/30 p-6 lg:border-s lg:border-t-0 lg:p-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {locale === "ar" ? "آخر موعد للتقديم" : "Filing deadline"}
            </p>
            <p className="mt-1 font-display text-xl leading-tight tracking-tight text-foreground">
              <bdi dir="ltr">{dayLong(currentFiling.dueDate)}</bdi>
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
                    ? locale === "ar"
                      ? "مستحق اليوم"
                      : "Due today"
                    : locale === "ar"
                      ? `باقٍ ${d} يوم`
                      : `Due in ${d} day${d === 1 ? "" : "s"}`;
              return (
                <div className="mt-3">
                  <StatusBadge tone={tone as any}>{label}</StatusBadge>
                </div>
              );
            })()}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {locale === "ar"
                ? "يجب تقديم الإقرار وسداد الضريبة خلال 28 يومًا من نهاية الفترة الضريبية."
                : "Returns and payment are due within 28 days of the tax period end (FTA)."}
            </p>
          </div>
        </div>
      </Card>

      {serverPeriod && serverPeriod.earlierUnfiled.length > 0 ? (
        <Card className="border-warning/40 bg-warning-subtle" data-testid="vat-earlier-unfiled">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {tr("earlierUnfiledTitle")}
            </p>
            <p className="text-muted-foreground">{tr("earlierUnfiledBody")}</p>
            <ul className="list-disc ps-5">
              {serverPeriod.earlierUnfiled.map((p) => (
                <li key={p.periodEnd} dir="auto">
                  {dayFull(parseCalendarDay(p.periodStart))} –{" "}
                  {dayFull(parseCalendarDay(p.periodEnd))}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {currentFiling.hasReturn && currentFiling.return ? (
        <Card>
          <CardContent className="p-4">
            <VatEmirateBreakdown
              boxes={currentFiling.return as unknown as Record<string, unknown>}
              testId="filing-emirate-breakdown"
            />
          </CardContent>
        </Card>
      ) : null}

      <Tabs
        defaultValue={
          new URLSearchParams(window.location.search).get("tab") === "faf" ? "faf" : "returns"
        }
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="returns" data-testid="tab-vat-returns">
            <ListChecks className="me-2 h-4 w-4" />
            {locale === "ar" ? "الإقرارات" : "Returns"}
          </TabsTrigger>
          <TabsTrigger value="faf" data-testid="tab-vat-faf">
            <Download className="me-2 h-4 w-4" />
            {cc.fafTab}
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
                    tone: "text-foreground",
                  },
                  {
                    label: locale === "ar" ? "قيد المراجعة" : "Pending review",
                    value: String(stats.pending),
                    tone: stats.pending > 0 ? "text-warning" : "text-foreground",
                  },
                  {
                    label: locale === "ar" ? "مقدَّمة" : "Filed",
                    value: String(stats.filed),
                    tone: "text-success",
                  },
                  {
                    label:
                      stats.totalPayable >= 0
                        ? locale === "ar"
                          ? "إجمالي المستحق"
                          : "Total payable"
                        : locale === "ar"
                          ? "إجمالي الاسترداد"
                          : "Total refundable",
                    value: formatCurrency(Math.abs(stats.totalPayable)),
                    tone: stats.totalPayable >= 0 ? "text-destructive" : "text-success",
                  },
                ] as const
              ).map((s) => (
                <Card key={s.label} className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {s.label}
                  </p>
                  <p
                    className={`mt-2 font-display text-2xl leading-none tracking-tight tabular-nums ${s.tone}`}
                  >
                    {s.value}
                  </p>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{locale === "ar" ? "سجل الإقرارات" : "VAT Returns History"}</CardTitle>
              <CardDescription>
                {locale === "ar"
                  ? "جميع إقرارات ضريبة القيمة المضافة المسجلة"
                  : "All your VAT return submissions and drafts"}
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
                        ? tr("emptyWithTrn")
                        : tr("emptyNoTrn")}
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
                                <bdi dir="ltr">
                                  {monthYear(parseCalendarDay(vatReturn.periodStart))} -{" "}
                                  {monthYear(parseCalendarDay(vatReturn.periodEnd))}
                                </bdi>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {tr("due")}{" "}
                                <bdi dir="ltr">{dayFull(parseCalendarDay(vatReturn.dueDate))}</bdi>
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {getStatusBadge(vatReturn.status)}
                              {vatReturn.isAmendment && (
                                <Badge variant="outline">{cc.amendmentBadge}</Badge>
                              )}
                              {vatReturn.status === "filed" && (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <Lock className="h-3 w-3" />
                                  {cc.periodLocked}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "المخرجات" : "Output"}
                              </p>
                              <p dir="ltr" className="font-mono">
                                {formatCurrency(
                                  vatReturn.box12TotalDueTax || vatReturn.box8TotalVat || 0
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "المدخلات" : "Input"}
                              </p>
                              <p dir="ltr" className="font-mono">
                                {formatCurrency(
                                  vatReturn.box13RecoverableTax || vatReturn.box11TotalVat || 0
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "الصافي" : "Net"}
                              </p>
                              <p dir="ltr"
                                className={`font-mono font-semibold ${(vatReturn.box14PayableTax || 0) >= 0 ? "text-destructive" : "text-success"}`}
                              >
                                {formatCurrency(Math.abs(vatReturn.box14PayableTax || 0))}
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
                              {tr("view")}
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
                                {tr("edit")}
                              </Button>
                            )}
                            {!vatReturn.isDraftPreview &&
                              (vatReturn.status === "submitted" ||
                                (vatReturn.isAmendment && vatReturn.status === "draft")) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setFilingReturn(vatReturn)}
                                  data-testid={`mobile-button-record-filing-${vatReturn.id}`}
                                >
                                  {cc.recordFiling}
                                </Button>
                              )}
                            {vatReturn.status === "filed" && (
                              <AmendButton
                                kind="vat"
                                returnId={vatReturn.id}
                                invalidateKeys={[returnsListKey]}
                                onCreated={setOpenAfterRefresh}
                              />
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
                          <TableHead>{locale === "ar" ? "تاريخ الاستحقاق" : "Due Date"}</TableHead>
                          <TableHead className="text-end">
                            {locale === "ar" ? "ضريبة المخرجات" : "Output Tax"}
                          </TableHead>
                          <TableHead className="text-end">
                            {locale === "ar" ? "ضريبة المدخلات" : "Input Tax"}
                          </TableHead>
                          <TableHead className="text-end">
                            {locale === "ar" ? "صافي الضريبة" : "Net Tax"}
                          </TableHead>
                          <TableHead>{locale === "ar" ? "الحالة" : "Status"}</TableHead>
                          <TableHead className="text-end">
                            {locale === "ar" ? "الإجراءات" : "Actions"}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vatReturns.map((vatReturn) => (
                          <TableRow key={vatReturn.id} data-testid={`row-return-${vatReturn.id}`}>
                            <TableCell className="font-medium">
                              <bdi dir="ltr">
                                {monthYear(parseCalendarDay(vatReturn.periodStart))} -{" "}
                                {monthYear(parseCalendarDay(vatReturn.periodEnd))}
                              </bdi>
                            </TableCell>
                            <TableCell>
                              <bdi dir="ltr">{dayFull(parseCalendarDay(vatReturn.dueDate))}</bdi>
                            </TableCell>
                            <TableCell className="text-end font-mono">
                              {formatCurrency(
                                vatReturn.box12TotalDueTax || vatReturn.box8TotalVat || 0
                              )}
                            </TableCell>
                            <TableCell className="text-end font-mono">
                              {formatCurrency(
                                vatReturn.box13RecoverableTax || vatReturn.box11TotalVat || 0
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-end font-mono font-medium ${(vatReturn.box14PayableTax || 0) >= 0 ? "text-destructive" : "text-success"}`}
                            >
                              {(vatReturn.box14PayableTax || 0) >= 0 ? "" : "("}
                              {formatCurrency(Math.abs(vatReturn.box14PayableTax || 0))}
                              {(vatReturn.box14PayableTax || 0) >= 0 ? "" : ")"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1">
                                {getStatusBadge(vatReturn.status)}
                                {vatReturn.isAmendment && (
                                  <Badge variant="outline">{cc.amendmentBadge}</Badge>
                                )}
                                {vatReturn.status === "filed" && (
                                  <span
                                    title={cc.periodLocked}
                                    aria-label={cc.periodLocked}
                                    data-testid={`icon-locked-${vatReturn.id}`}
                                  >
                                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-end">
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
                                {!vatReturn.isDraftPreview &&
                                  (vatReturn.status === "submitted" ||
                                    (vatReturn.isAmendment && vatReturn.status === "draft")) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setFilingReturn(vatReturn)}
                                      data-testid={`button-record-filing-${vatReturn.id}`}
                                    >
                                      {cc.recordFiling}
                                    </Button>
                                  )}
                                {vatReturn.status === "filed" && (
                                  <AmendButton
                                    kind="vat"
                                    returnId={vatReturn.id}
                                    invalidateKeys={[returnsListKey]}
                                    onCreated={setOpenAfterRefresh}
                                  />
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleExportPDF(vatReturn)}
                                  title={tr("downloadPdf")}
                                  data-testid={`button-export-pdf-${vatReturn.id}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleExportExcel(vatReturn)}
                                  title={tr("downloadExcel")}
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

        <TabsContent value="faf" className="mt-0">
          {companyId && <FtaAuditFileCard companyId={companyId} />}
        </TabsContent>

        {/* ── Workpaper — the accountant's Excel-like workbook, first-class ── */}
        <TabsContent value="workpaper" className="mt-0">
          <div className="mb-4">
            <p className="font-semibold tracking-tight text-foreground">
              {locale === "ar" ? "ورقة عمل الأدلة الضريبية" : "VAT evidence workpaper"}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
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
            <DialogTitle>
              {locale === "ar" ? "إنشاء مسودة ضريبية رسمية" : "Create official VAT draft"}
            </DialogTitle>
            <DialogDescription>
              {locale === "ar"
                ? "حدد الفترة الضريبية لإنشاء المسودة من السجلات"
                : "Select the tax period to create a draft from recorded books."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === "ar" ? "من تاريخ" : "Period Start"}</Label>
                <Input
                  type="date"
                  value={newPeriodStart}
                  onChange={(e) => setNewPeriodStart(e.target.value)}
                  data-testid="input-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === "ar" ? "إلى تاريخ" : "Period End"}</Label>
                <Input
                  type="date"
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
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
                {tr("addTrnHint")}
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
                !canGenerateVatReturn
              }
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {locale === "ar" ? "إنشاء المسودة" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {locale === "ar" ? "عرض الإقرار الضريبي" : "View VAT 201 Return"}
            </DialogTitle>
            <DialogDescription>
              {selectedReturn && (
                <span>
                  <bdi dir="ltr">
                    {monthYear(parseCalendarDay(selectedReturn.periodStart))} -{" "}
                    {monthYear(parseCalendarDay(selectedReturn.periodEnd))}
                  </bdi>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn?.isDraftPreview && (
            <DraftPreviewBanner previewAsOf={selectedReturn.previewAsOf} />
          )}
          {selectedReturn && company && (
            <VAT201Form
              data={vatFormData}
              onChange={() => {}}
              journalLines={selectedReturn.vatAdjustments}
              storedTotals={storedVat201Totals(selectedReturn as any)}
              companyInfo={{
                nameEn: company.legalName || company.name,
                nameAr: company.legalNameAr || company.nameAr || undefined,
                trnNumber: company.trnVatNumber || undefined,
                address: companyAddressLine(company) || undefined,
                phone: company.contactPhone || undefined,
              }}
              periodInfo={{
                periodStart: format(parseCalendarDay(selectedReturn.periodStart), "dd/MM/yyyy"),
                periodEnd: format(parseCalendarDay(selectedReturn.periodEnd), "dd/MM/yyyy"),
                dueDate: format(parseCalendarDay(selectedReturn.dueDate), "dd/MM/yyyy"),
                taxYearEnd: selectedReturn.taxYearEnd
                  ? format(parseISO(selectedReturn.taxYearEnd), "dd/MM/yyyy")
                  : undefined,
                // i18n-ignore: stored filing-frequency value, not copy
                vatStagger: selectedReturn.vatStagger || "Quarterly",
              }}
              readOnly={true}
            />
          )}
          {selectedReturn && !selectedReturn.isDraftPreview && selectedReturn.id && companyId && (
            <FilingEvidencePanel
              kind="vat"
              returnId={selectedReturn.id}
              companyId={companyId}
              returnStatus={selectedReturn.status}
              periodEnd={selectedReturn.periodEnd}
              listKeys={[returnsListKey]}
              onOpenReturn={setOpenAfterRefresh}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              {locale === "ar" ? "إغلاق" : "Close"}
            </Button>
            <Button onClick={() => selectedReturn && handleExportPDF(selectedReturn)}>
              <Download className="w-4 h-4 me-2" />
              {locale === "ar" ? "تحميل PDF" : "Download PDF"}
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

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {locale === "ar" ? "تحرير الإقرار الضريبي" : "Edit VAT 201 Return"}
            </DialogTitle>
            <DialogDescription>
              {selectedReturn && (
                <span>
                  <bdi dir="ltr">
                    {monthYear(parseCalendarDay(selectedReturn.periodStart))} -{" "}
                    {monthYear(parseCalendarDay(selectedReturn.periodEnd))}
                  </bdi>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn?.isDraftPreview && (
            <DraftPreviewBanner previewAsOf={selectedReturn.previewAsOf} />
          )}
          {selectedReturn && company && (
            <>
              <VAT201Form
                data={vatFormData}
                onChange={setVatFormData}
                journalLines={selectedReturn.vatAdjustments}
                storedTotals={storedVat201Totals(selectedReturn as any)}
                companyInfo={{
                  nameEn: company.legalName || company.name,
                  nameAr: company.legalNameAr || company.nameAr || undefined,
                  trnNumber: company.trnVatNumber || undefined,
                  address: companyAddressLine(company) || undefined,
                  phone: company.contactPhone || undefined,
                }}
                periodInfo={{
                  periodStart: format(parseCalendarDay(selectedReturn.periodStart), "dd/MM/yyyy"),
                  periodEnd: format(parseCalendarDay(selectedReturn.periodEnd), "dd/MM/yyyy"),
                  dueDate: format(parseCalendarDay(selectedReturn.dueDate), "dd/MM/yyyy"),
                  taxYearEnd: selectedReturn.taxYearEnd
                    ? format(parseISO(selectedReturn.taxYearEnd), "dd/MM/yyyy")
                    : undefined,
                  // i18n-ignore: stored filing-frequency value, not copy
                  vatStagger: selectedReturn.vatStagger || "Quarterly",
                }}
                readOnly={false}
              />
              <div className="space-y-2">
                <Label>{locale === "ar" ? "ملاحظات" : "Notes"}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={locale === "ar" ? "أضف ملاحظات..." : "Add notes..."}
                  className="min-h-20"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {locale === "ar"
                    ? "سبب تعديل الأرقام يدوياً"
                    : "Reason for changing figures by hand"}
                </Label>
                <Textarea
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder={
                    locale === "ar"
                      ? "مطلوب عند تغيير أي رقم (10 أحرف على الأقل). لا يمكن تقليل الضريبة عن دفاتر الحسابات."
                      : "Required when you change any figure (at least 10 characters). The return can never declare less tax than the books support."
                  }
                  className="min-h-16"
                  data-testid="input-edit-reason"
                />
              </div>
            </>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSaveReturn}
              disabled={updateMutation.isPending || !!selectedReturn?.isDraftPreview}
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {locale === "ar" ? "حفظ المسودة" : "Save Draft"}
            </Button>
            <Button
              onClick={handleSubmitReturn}
              disabled={submitMutation.isPending || !!selectedReturn?.isDraftPreview}
              title={
                selectedReturn?.isDraftPreview
                  ? locale === "ar"
                    ? "الفترة لم تنتهِ بعد"
                    : "Period not ended"
                  : undefined
              }
            >
              {submitMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              <Send className="w-4 h-4 me-2" />
              {locale === "ar" ? "تقديم للمراجعة" : "Submit for Filing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filingReturn && (
        <RecordFilingDialog
          open
          onOpenChange={(open) => !open && setFilingReturn(null)}
          kind="vat"
          returnId={filingReturn.id}
          periodEnd={filingReturn.periodEnd.slice(0, 10)}
          lockedMonthsText={monthsCovered(filingReturn.periodStart, filingReturn.periodEnd, locale)}
          invalidateKeys={[returnsListKey]}
        />
      )}
    </div>
  );
}
