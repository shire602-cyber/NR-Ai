import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format,
  parseISO,
  startOfQuarter,
  endOfQuarter,
  addDays,
  differenceInCalendarDays,
} from "date-fns";
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
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { exportToExcel } from "@/lib/export";
import { evidenceSectionHref } from "@/lib/evidenceLinks";
import { prepareVat201ForExport, vat201ExportFilename } from "@/lib/vat201-export";
import VAT201Form from "@/components/VAT201Form";
import VatWorkpaperPanel from "@/components/vat/VatWorkpaperPanel";
import { PageHeader } from "@/components/ui/page-header";
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
} from "lucide-react";
import jsPDF from "jspdf";

interface VATReturn {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  taxYearEnd: string | null;
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
}

interface Company {
  id: string;
  name: string;
  nameAr: string | null;
  trnVatNumber: string | null;
  vatFilingFrequency: string | null;
  emirate: string | null;
  address: string | null;
  phone: string | null;
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
        title: "VAT Return Generated",
        description: "Review the calculated amounts before submitting.",
      });
      setCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description: error?.message || "Failed to generate VAT return",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PATCH", `/api/vat-returns/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: "VAT Return Updated",
        description: "Your changes have been saved.",
      });
      setEditDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error?.message || "Failed to update VAT return",
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiRequest("POST", `/api/vat-returns/${id}/submit`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      toast({
        title: "Finalised for review — not yet filed",
        description:
          "Muhasib does not file with the FTA. Submit this return through EmaraTax, then record the FTA reference number against it.",
      });
      setEditDialogOpen(false);
      setSelectedReturn(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Submission Failed",
        description: error?.message || "Failed to submit VAT return",
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
          format(parseISO(r.periodStart), "yyyy-MM") === format(currentQuarter.start, "yyyy-MM") &&
          format(parseISO(r.periodEnd), "yyyy-MM") === format(currentQuarter.end, "yyyy-MM")
        );
      } catch {
        return false;
      }
    });
    const active =
      match ??
      [...returns].sort(
        (a, b) => parseISO(b.periodEnd).getTime() - parseISO(a.periodEnd).getTime()
      )[0];

    const periodStart = active ? parseISO(active.periodStart) : currentQuarter.start;
    const periodEnd = active ? parseISO(active.periodEnd) : currentQuarter.end;
    const dueDate = active?.dueDate ? parseISO(active.dueDate) : addDays(periodEnd, 28);
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" />
            Draft
          </Badge>
        );
      case "pending_review":
        return (
          <Badge variant="secondary" className="bg-warning-subtle text-warning-subtle-foreground">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Review
          </Badge>
        );
      case "submitted":
        return (
          <Badge variant="default" className="bg-info-subtle text-info-subtle-foreground">
            <Send className="w-3 h-3 mr-1" />
            Submitted
          </Badge>
        );
      case "filed":
        return (
          <Badge variant="default" className="bg-success-subtle text-success-subtle-foreground">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Filed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleCreateReturn = () => {
    if (!canGenerateVatReturn) {
      toast({
        variant: "destructive",
        title: "Add TRN first",
        description: "VAT returns require the company TRN before creating an official draft.",
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
        title: "Add TRN first",
        description: "VAT returns require the company TRN before creating an official draft.",
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
    updateMutation.mutate({
      id: selectedReturn.id,
      data: { ...vatFormData, notes },
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
      `VAT Period: ${format(parseISO(vatReturn.periodStart), "dd/MM/yyyy")} - ${format(parseISO(vatReturn.periodEnd), "dd/MM/yyyy")}`,
      pageWidth / 2,
      y
    );
    y += 5;
    doc.text(`Legal Name: ${company?.name || "N/A"}`, margin, y);
    doc.text(`Due Date: ${format(parseISO(vatReturn.dueDate), "dd/MM/yyyy")}`, pageWidth / 2, y);
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

    doc.save(`VAT201-${format(parseISO(vatReturn.periodStart), "yyyy-MM")}.pdf`);

    toast({
      title: "PDF Exported",
      description: "VAT 201 return has been downloaded.",
    });
  };

  const handleExportExcel = async (vatReturn: VATReturn) => {
    try {
      await exportToExcel(
        prepareVat201ForExport(vatReturn, company),
        vat201ExportFilename(vatReturn, company)
      );
      toast({
        title: "Excel Exported",
        description: "VAT 201 workbook has been downloaded for review and filing support.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error?.message || "Could not export VAT 201 workbook.",
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
                <FileText className="w-4 h-4 mr-2" />
                {locale === "ar" ? "حزمة دعم الاسترداد" : "Refund support"}
              </Link>
            </Button>
            {canGenerateVatReturn ? (
              <Button onClick={handleCreateReturn} data-testid="button-create-return">
                <Calculator className="w-4 h-4 mr-2" />
                {locale === "ar" ? "إنشاء مسودة رسمية" : "New VAT draft"}
              </Button>
            ) : (
              <Button asChild data-testid="button-add-trn-header">
                <Link href="/company-profile">
                  <AlertTriangle className="w-4 h-4 mr-2" />
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
                {format(currentFiling.periodStart, "d MMM")} –{" "}
                {format(currentFiling.periodEnd, "d MMM yyyy")}
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
                    <Eye className="mr-2 h-4 w-4" />
                    {locale === "ar" ? "عرض الإقرار" : "Review return"}
                  </Button>
                  {(currentFiling.status === "draft" ||
                    currentFiling.status === "pending_review") && (
                    <Button
                      variant="outline"
                      onClick={() => handleEditReturn(currentFiling.return)}
                      data-testid="button-hero-edit-return"
                    >
                      <Edit3 className="mr-2 h-4 w-4" />
                      {locale === "ar" ? "تعديل" : "Edit"}
                    </Button>
                  )}
                </>
              ) : canGenerateVatReturn ? (
                <Button onClick={handleCreateReturn} data-testid="button-hero-generate">
                  <Calculator className="mr-2 h-4 w-4" />
                  {locale === "ar" ? "احتساب الإقرار" : "Generate return"}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/company-profile">
                    <AlertTriangle className="mr-2 h-4 w-4" />
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
          <div className="flex flex-col justify-center gap-1 border-t border-card-border bg-muted/30 p-6 lg:border-l lg:border-t-0 lg:p-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {locale === "ar" ? "آخر موعد للتقديم" : "Filing deadline"}
            </p>
            <p className="mt-1 font-display text-xl leading-tight tracking-tight text-foreground">
              {format(currentFiling.dueDate, "d MMMM yyyy")}
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

      <Tabs defaultValue="returns" className="space-y-6">
        <TabsList>
          <TabsTrigger value="returns" data-testid="tab-vat-returns">
            <ListChecks className="mr-2 h-4 w-4" />
            {locale === "ar" ? "الإقرارات" : "Returns"}
          </TabsTrigger>
          <TabsTrigger value="workpaper" data-testid="tab-vat-workpaper">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
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
                                {format(parseISO(vatReturn.periodStart), "MMM yyyy")} -{" "}
                                {format(parseISO(vatReturn.periodEnd), "MMM yyyy")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Due {format(parseISO(vatReturn.dueDate), "dd MMM yyyy")}
                              </p>
                            </div>
                            {getStatusBadge(vatReturn.status)}
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "المخرجات" : "Output"}
                              </p>
                              <p className="font-mono">
                                {formatCurrency(
                                  vatReturn.box12TotalDueTax || vatReturn.box8TotalVat || 0
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "المدخلات" : "Input"}
                              </p>
                              <p className="font-mono">
                                {formatCurrency(
                                  vatReturn.box13RecoverableTax || vatReturn.box11TotalVat || 0
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {locale === "ar" ? "الصافي" : "Net"}
                              </p>
                              <p
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
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                            {(vatReturn.status === "draft" ||
                              vatReturn.status === "pending_review") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditReturn(vatReturn)}
                                data-testid={`mobile-button-edit-vat-${vatReturn.id}`}
                              >
                                <Edit3 className="w-4 h-4 mr-1" />
                                Edit
                              </Button>
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
                          <TableHead className="text-right">
                            {locale === "ar" ? "ضريبة المخرجات" : "Output Tax"}
                          </TableHead>
                          <TableHead className="text-right">
                            {locale === "ar" ? "ضريبة المدخلات" : "Input Tax"}
                          </TableHead>
                          <TableHead className="text-right">
                            {locale === "ar" ? "صافي الضريبة" : "Net Tax"}
                          </TableHead>
                          <TableHead>{locale === "ar" ? "الحالة" : "Status"}</TableHead>
                          <TableHead className="text-right">
                            {locale === "ar" ? "الإجراءات" : "Actions"}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vatReturns.map((vatReturn) => (
                          <TableRow key={vatReturn.id} data-testid={`row-return-${vatReturn.id}`}>
                            <TableCell className="font-medium">
                              {format(parseISO(vatReturn.periodStart), "MMM yyyy")} -{" "}
                              {format(parseISO(vatReturn.periodEnd), "MMM yyyy")}
                            </TableCell>
                            <TableCell>
                              {format(parseISO(vatReturn.dueDate), "dd MMM yyyy")}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(
                                vatReturn.box12TotalDueTax || vatReturn.box8TotalVat || 0
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(
                                vatReturn.box13RecoverableTax || vatReturn.box11TotalVat || 0
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono font-medium ${(vatReturn.box14PayableTax || 0) >= 0 ? "text-destructive" : "text-success"}`}
                            >
                              {(vatReturn.box14PayableTax || 0) >= 0 ? "" : "("}
                              {formatCurrency(Math.abs(vatReturn.box14PayableTax || 0))}
                              {(vatReturn.box14PayableTax || 0) >= 0 ? "" : ")"}
                            </TableCell>
                            <TableCell>{getStatusBadge(vatReturn.status)}</TableCell>
                            <TableCell className="text-right">
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
                                    <Edit3 className="w-4 h-4 mr-1" />
                                    {locale === "ar" ? "تحرير" : "Edit"}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleExportPDF(vatReturn)}
                                  title="Download PDF"
                                  data-testid={`button-export-pdf-${vatReturn.id}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleExportExcel(vatReturn)}
                                  title="Download Excel workbook"
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
                Add the company TRN before creating an official VAT draft.
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
              {generateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
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
                  {format(parseISO(selectedReturn.periodStart), "MMM yyyy")} -{" "}
                  {format(parseISO(selectedReturn.periodEnd), "MMM yyyy")}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn && company && (
            <VAT201Form
              data={vatFormData}
              onChange={() => {}}
              companyInfo={{
                nameEn: company.name,
                nameAr: company.nameAr || undefined,
                trnNumber: company.trnVatNumber || undefined,
                address: company.address || undefined,
                phone: company.phone || undefined,
              }}
              periodInfo={{
                periodStart: format(parseISO(selectedReturn.periodStart), "dd/MM/yyyy"),
                periodEnd: format(parseISO(selectedReturn.periodEnd), "dd/MM/yyyy"),
                dueDate: format(parseISO(selectedReturn.dueDate), "dd/MM/yyyy"),
                taxYearEnd: selectedReturn.taxYearEnd
                  ? format(parseISO(selectedReturn.taxYearEnd), "dd/MM/yyyy")
                  : undefined,
                vatStagger: selectedReturn.vatStagger || "Quarterly",
              }}
              readOnly={true}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              {locale === "ar" ? "إغلاق" : "Close"}
            </Button>
            <Button onClick={() => selectedReturn && handleExportPDF(selectedReturn)}>
              <Download className="w-4 h-4 mr-2" />
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
                  {format(parseISO(selectedReturn.periodStart), "MMM yyyy")} -{" "}
                  {format(parseISO(selectedReturn.periodEnd), "MMM yyyy")}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn && company && (
            <>
              <VAT201Form
                data={vatFormData}
                onChange={setVatFormData}
                companyInfo={{
                  nameEn: company.name,
                  nameAr: company.nameAr || undefined,
                  trnNumber: company.trnVatNumber || undefined,
                  address: company.address || undefined,
                  phone: company.phone || undefined,
                }}
                periodInfo={{
                  periodStart: format(parseISO(selectedReturn.periodStart), "dd/MM/yyyy"),
                  periodEnd: format(parseISO(selectedReturn.periodEnd), "dd/MM/yyyy"),
                  dueDate: format(parseISO(selectedReturn.dueDate), "dd/MM/yyyy"),
                  taxYearEnd: selectedReturn.taxYearEnd
                    ? format(parseISO(selectedReturn.taxYearEnd), "dd/MM/yyyy")
                    : undefined,
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
            </>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSaveReturn}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === "ar" ? "حفظ المسودة" : "Save Draft"}
            </Button>
            <Button onClick={handleSubmitReturn} disabled={submitMutation.isPending}>
              {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Send className="w-4 h-4 mr-2" />
              {locale === "ar" ? "تقديم للمراجعة" : "Submit for Filing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
