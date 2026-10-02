import { PageHeader } from "@/components/ui/page-header";
import FiledReturnsCard from "@/components/compliance/FiledReturnsCard";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";
import {
  checkFileBeforeUpload,
  downloadAuthenticatedFile,
  fileProblemMessage,
  readFileAsBase64,
} from "@/lib/file-upload";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import {
  FileText,
  Download,
  Search,
  Calendar,
  Loader2,
  Plus,
  Filter,
  Receipt,
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { messages as pageMessages } from "./TaxReturnArchive.i18n";

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
  { value: "vat", labelEn: "VAT Return", labelAr: "إقرار ضريبة القيمة المضافة" },
  { value: "corporate_tax", labelEn: "Corporate Tax", labelAr: "ضريبة الشركات" },
  { value: "excise_tax", labelEn: "Excise Tax", labelAr: "الضريبة الانتقائية" },
];

export default function TaxReturnArchive() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
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

  const { data: taxReturns, isLoading } = useQuery<TaxReturn[]>({
    queryKey: ["/api/companies", companyId, "tax-returns-archive"],
    enabled: !!companyId,
  });

  const addMutation = useMutation({
    mutationFn: async (
      data: typeof newReturn & { fileName?: string; mimeType?: string; fileData?: string }
    ) => {
      // The optional PDF travels as base64; the server validates and stores it privately.
      return apiRequest("POST", `/api/companies/${companyId}/tax-returns-archive`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "tax-returns-archive"],
      });
      toast({
        title: tr("addedSuccessfully"),
        description: tr("taxReturnHasBeenSaved"),
      });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToAdd"),
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
        title: tr("missingInformation"),
        description: tr("pleaseFillInAllRequiredFields"),
      });
      return;
    }

    if (selectedFile) {
      const problem = checkFileBeforeUpload(selectedFile);
      if (problem) {
        toast({
          variant: "destructive",
          title: tr("invalidFile"),
          description: fileProblemMessage(problem, locale),
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const fileFields = selectedFile
        ? {
            fileName: selectedFile.name,
            mimeType: selectedFile.type || "application/pdf",
            fileData: await readFileAsBase64(selectedFile),
          }
        : {};
      await addMutation.mutateAsync({ ...newReturn, ...fileFields });
    } catch (error: any) {
      // Server rejections are toasted by the mutation's onError; this covers read errors.
      if (!addMutation.isError) {
        toast({
          variant: "destructive",
          title: tr("failedToAdd"),
          description: error?.message,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = async (ret: TaxReturn) => {
    try {
      await downloadAuthenticatedFile(
        `/api/tax-returns-archive/${ret.id}/download`,
        ret.fileName || "tax-return.pdf"
      );
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("downloadFailed"),
        description: error?.message,
      });
    }
  };

  const years = [
    ...new Set(taxReturns?.map((r) => new Date(r.periodEnd).getFullYear()) || []),
  ].sort((a, b) => b - a);

  const filteredReturns =
    taxReturns?.filter((ret) => {
      if (typeFilter !== "all" && ret.returnType !== typeFilter) return false;
      if (yearFilter !== "all" && new Date(ret.periodEnd).getFullYear().toString() !== yearFilter)
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

  const stats = {
    totalReturns: taxReturns?.length || 0,
    vatReturns: taxReturns?.filter((r) => r.returnType === "vat").length || 0,
    corporateTax: taxReturns?.filter((r) => r.returnType === "corporate_tax").length || 0,
    totalTaxPaid: taxReturns?.reduce((sum, r) => sum + (r.taxAmount || 0), 0) || 0,
  };

  if (isLoadingCompany || isLoading) {
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
        eyebrow={tr("compliance")}
        title={tr("taxReturnArchive")}
        description={tr("viewAllTaxReturnsFiledWith")}
        actions={
          <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-return">
            <Plus className="w-4 h-4 me-2" />
            {tr("addReturn")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("totalReturns")}</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalReturns}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("vatReturns")}</CardTitle>
            <Receipt className="w-4 h-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-info">{stats.vatReturns}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("corporateTax")}</CardTitle>
            <Building2 className="w-4 h-4 text-chart-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-chart-5">{stats.corporateTax}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("totalTaxPaid")}</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {formatCurrency(stats.totalTaxPaid)}
            </div>
          </CardContent>
        </Card>
      </div>

      {companyId && <FiledReturnsCard companyId={companyId} />}

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder={tr("searchByPeriodOrReference")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10"
                data-testid="input-search-returns"
              />
            </div>
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
                  <SelectValue placeholder={tr("returnType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allTypes")}</SelectItem>
                  {RETURN_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {locale === "ar" ? type.labelAr : type.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-year-filter">
                  <SelectValue placeholder={tr("year")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allYears")}</SelectItem>
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
          {filteredReturns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{tr("noTaxReturnsFound")}</p>
              <Button variant="ghost" onClick={() => setAddDialogOpen(true)}>
                {tr("addYourFirstReturn")}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("period")}</TableHead>
                    <TableHead>{tr("type")}</TableHead>
                    <TableHead>{tr("filingDate")}</TableHead>
                    <TableHead>{tr("referenceNo")}</TableHead>
                    <TableHead className="text-end">{tr("amount")}</TableHead>
                    <TableHead>{tr("payment")}</TableHead>
                    <TableHead className="text-end">{tr("actions")}</TableHead>
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
                            {format(parseISO(ret.periodStart), "dd MMM")} -{" "}
                            {format(parseISO(ret.periodEnd), "dd MMM yyyy")}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={ret.returnType === "vat" ? "default" : "secondary"}>
                            {locale === "ar" ? returnType?.labelAr : returnType?.labelEn}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(parseISO(ret.filingDate), "dd MMM yyyy")}
                          </div>
                        </TableCell>
                        <TableCell>{ret.ftaReferenceNumber || "-"}</TableCell>
                        <TableCell className="text-end font-mono font-medium">
                          {formatCurrency(ret.taxAmount)}
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
                                {tr("paid")}
                              </>
                            )}
                            {ret.paymentStatus === "partial" && (
                              <>
                                <Clock className="w-3 h-3 me-1" />
                                {tr("partial")}
                              </>
                            )}
                            {ret.paymentStatus === "unpaid" && (
                              <>
                                <AlertCircle className="w-3 h-3 me-1" />
                                {tr("unpaid")}
                              </>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-2">
                            {ret.fileUrl && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDownload(ret)}
                                aria-label={tr("download")}
                                data-testid={`button-download-${ret.id}`}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
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

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("addTaxReturn")}</DialogTitle>
            <DialogDescription>{tr("recordATaxReturnFiledWith")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tr("returnType")} *</Label>
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
                <Label>{tr("periodLabel")} *</Label>
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
                <Label>{tr("periodStart")} *</Label>
                <Input
                  type="date"
                  value={newReturn.periodStart}
                  onChange={(e) => setNewReturn({ ...newReturn, periodStart: e.target.value })}
                  data-testid="input-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("periodEnd")} *</Label>
                <Input
                  type="date"
                  value={newReturn.periodEnd}
                  onChange={(e) => setNewReturn({ ...newReturn, periodEnd: e.target.value })}
                  data-testid="input-period-end"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tr("filingDate")} *</Label>
                <Input
                  type="date"
                  value={newReturn.filingDate}
                  onChange={(e) => setNewReturn({ ...newReturn, filingDate: e.target.value })}
                  data-testid="input-filing-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("ftaReferenceNo")}</Label>
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
                <Label>{tr("taxAmount")}</Label>
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
                <Label>{tr("paymentStatus")}</Label>
                <Select
                  value={newReturn.paymentStatus}
                  onValueChange={(val) => setNewReturn({ ...newReturn, paymentStatus: val })}
                >
                  <SelectTrigger data-testid="select-payment-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">{tr("paid")}</SelectItem>
                    <SelectItem value="partial">{tr("partial")}</SelectItem>
                    <SelectItem value="unpaid">{tr("unpaid")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{tr("notes")}</Label>
              <Textarea
                value={newReturn.notes}
                onChange={(e) => setNewReturn({ ...newReturn, notes: e.target.value })}
                placeholder={tr("anyAdditionalNotes")}
                data-testid="input-notes"
              />
            </div>

            <div className="space-y-2">
              <Label>{tr("returnFilePdf")}</Label>
              <Input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                data-testid="input-return-file"
              />
              {isSubmitting && selectedFile && (
                <p className="text-sm text-muted-foreground" role="status">
                  {tr("uploadingFile")}
                </p>
              )}
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
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
              {tr("cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="button-confirm-add">
              {isSubmitting && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {tr("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
