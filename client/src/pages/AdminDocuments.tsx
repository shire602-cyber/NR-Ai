import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, differenceInDays, parseISO } from "date-fns";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Upload,
  FileText,
  Download,
  Trash2,
  Search,
  AlertTriangle,
  Clock,
  FolderOpen,
  Calendar,
  Loader2,
  Plus,
  Eye,
  Filter,
  Building2,
  FileUp,
} from "lucide-react";
import { messages as pageMessages } from "./AdminDocuments.i18n";

interface Company {
  id: string;
  name: string;
  trnNumber: string | null;
}

interface Document {
  id: string;
  companyId: string;
  name: string;
  nameAr: string | null;
  category: string;
  description: string | null;
  fileUrl: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  expiryDate: string | null;
  reminderDays: number;
  reminderSent: boolean;
  tags: string | null;
  isArchived: boolean;
  uploadedBy: string | null;
  createdAt: string;
}

const DOCUMENT_CATEGORIES = [
  { value: "invoice", labelEn: "Invoice" },
  { value: "bill", labelEn: "Bill/Expense" },
  { value: "receipt", labelEn: "Receipt" },
  { value: "quote", labelEn: "Quote/Quotation" },
  { value: "purchase_order", labelEn: "Purchase Order" },
  { value: "trade_license", labelEn: "Trade License" },
  { value: "contract", labelEn: "Contract" },
  { value: "tax_certificate", labelEn: "Tax Certificate" },
  { value: "audit_report", labelEn: "Audit Report" },
  { value: "bank_statement", labelEn: "Bank Statement" },
  { value: "insurance", labelEn: "Insurance" },
  { value: "visa", labelEn: "Visa/Emirates ID" },
  { value: "vat_return", labelEn: "VAT Return" },
  { value: "other", labelEn: "Other" },
];

export default function AdminDocuments() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [newDocument, setNewDocument] = useState({
    name: "",
    nameAr: "",
    category: "invoice",
    description: "",
    expiryDate: "",
    reminderDays: 30,
  });

  const { data: companies, isLoading: isLoadingCompanies } = useQuery<Company[]>({
    queryKey: ["/api/admin/companies"],
  });

  const { data: documents, isLoading: isLoadingDocs } = useQuery<Document[]>({
    queryKey: ["/api/companies", selectedCompanyId, "documents"],
    enabled: !!selectedCompanyId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      nameAr: string;
      category: string;
      description: string;
      expiryDate: string;
      reminderDays: number;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }) => {
      return apiRequest("POST", `/api/companies/${selectedCompanyId}/documents`, {
        ...data,
        fileUrl: `/uploads/${data.fileName}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "documents"],
      });
      toast({
        title: tr("uploadSuccessful"),
        description: tr("documentHasBeenSavedForThe"),
      });
      setUploadDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("uploadFailed"),
        description: error?.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => apiRequest("DELETE", `/api/documents/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "documents"],
      });
      toast({
        title: tr("deleted"),
        description: tr("documentHasBeenDeleted"),
      });
    },
  });

  const resetForm = () => {
    setNewDocument({
      name: "",
      nameAr: "",
      category: "invoice",
      description: "",
      expiryDate: "",
      reminderDays: 30,
    });
    setSelectedFile(null);
  };

  const handleUpload = async () => {
    if (!newDocument.name) {
      toast({
        variant: "destructive",
        title: tr("missingInformation"),
        description: tr("pleaseEnterDocumentName"),
      });
      return;
    }

    if (!selectedCompanyId) {
      toast({
        variant: "destructive",
        title: tr("selectClient"),
        description: tr("pleaseSelectAClientFirst"),
      });
      return;
    }

    setIsUploading(true);
    try {
      await uploadMutation.mutateAsync({
        name: newDocument.name,
        nameAr: newDocument.nameAr,
        category: newDocument.category,
        description: newDocument.description,
        expiryDate: newDocument.expiryDate,
        reminderDays: newDocument.reminderDays,
        fileName: selectedFile?.name || "document.pdf",
        fileSize: selectedFile?.size || 0,
        mimeType: selectedFile?.type || "application/pdf",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const days = differenceInDays(parseISO(expiryDate), new Date());
    if (days < 0) return { status: "expired", color: "destructive" as const, days: Math.abs(days) };
    if (days <= 30) return { status: "expiring_soon", color: "secondary" as const, days };
    return { status: "valid", color: "default" as const, days };
  };

  const getCategoryLabel = (category: string) => {
    const cat = DOCUMENT_CATEGORIES.find((c) => c.value === category);
    return cat?.labelEn || category;
  };

  const filteredDocuments =
    documents?.filter((doc) => {
      if (doc.isArchived) return false;
      if (categoryFilter !== "all" && doc.category !== categoryFilter) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          doc.name.toLowerCase().includes(query) ||
          doc.fileName.toLowerCase().includes(query) ||
          doc.description?.toLowerCase().includes(query)
        );
      }
      return true;
    }) || [];

  const selectedCompany = companies?.find((c) => c.id === selectedCompanyId);

  if (isLoadingCompanies) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow={tr("admin")}
        title={tr("clientDocumentManagement")}
        testId="text-admin-documents-title"
        description={tr("uploadAndManageInvoicesBillsAnd")}
        actions={
          <Button
            onClick={() => setUploadDialogOpen(true)}
            disabled={!selectedCompanyId}
            data-testid="button-upload-client-document"
          >
            <Plus className="w-4 h-4 me-2" />
            {tr("uploadDocument")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {tr("selectClient")}
          </CardTitle>
          <CardDescription>{tr("chooseAClientToViewOr")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger className="w-full md:w-[400px]" data-testid="select-client-company">
              <SelectValue placeholder={tr("selectAClientCompany")} />
            </SelectTrigger>
            <SelectContent>
              {companies?.map((company) => (
                <SelectItem key={company.id} value={company.id}>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    <span>{company.name}</span>
                    {company.trnNumber && (
                      <span className="text-muted-foreground text-xs">
                        {tr("trn", { trnNumber: company.trnNumber })}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedCompanyId && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("totalDocuments")}</CardTitle>
                <FolderOpen className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{documents?.length || 0}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("invoices")}</CardTitle>
                <FileText className="w-4 h-4 text-info" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-info">
                  {documents?.filter((d) => d.category === "invoice").length || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("billsExpenses")}</CardTitle>
                <FileUp className="w-4 h-4 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  {documents?.filter((d) => d.category === "bill").length || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("expiringSoon")}</CardTitle>
                <Clock className="w-4 h-4 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  {documents?.filter((doc) => {
                    if (!doc.expiryDate || doc.isArchived) return false;
                    const days = differenceInDays(parseISO(doc.expiryDate), new Date());
                    return days >= 0 && days <= 30;
                  }).length || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row gap-4 justify-between">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder={tr("searchDocuments")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="ps-10"
                    data-testid="input-search-client-documents"
                  />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
                    <Filter className="w-4 h-4 me-2" />
                    <SelectValue placeholder={tr("filterByCategory")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr("allCategories")}</SelectItem>
                    {DOCUMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingDocs ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{tr("noDocumentsFoundFor", { name: selectedCompany?.name })}</p>
                  <Button variant="ghost" onClick={() => setUploadDialogOpen(true)}>
                    {tr("uploadADocument")}
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("documentName")}</TableHead>
                        <TableHead>{tr("category")}</TableHead>
                        <TableHead>{tr("file")}</TableHead>
                        <TableHead>{tr("expiry")}</TableHead>
                        <TableHead>{tr("uploaded")}</TableHead>
                        <TableHead className="text-end">{tr("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDocuments.map((doc) => {
                        const expiryStatus = getExpiryStatus(doc.expiryDate);
                        return (
                          <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                                <div>
                                  <div className="font-medium">{doc.name}</div>
                                  {doc.description && (
                                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                      {doc.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{getCategoryLabel(doc.category)}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div className="truncate max-w-[150px]">{doc.fileName}</div>
                                {doc.fileSize && (
                                  <div className="text-xs text-muted-foreground">
                                    {(doc.fileSize / 1024).toFixed(1)} KB
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {expiryStatus ? (
                                <div className="flex items-center gap-2">
                                  {expiryStatus.status === "expired" && (
                                    <AlertTriangle className="w-4 h-4 text-destructive" />
                                  )}
                                  {expiryStatus.status === "expiring_soon" && (
                                    <Clock className="w-4 h-4 text-warning" />
                                  )}
                                  <Badge variant={expiryStatus.color}>
                                    {expiryStatus.status === "expired"
                                      ? tr("expiredDAgo", { days: expiryStatus.days })
                                      : expiryStatus.status === "expiring_soon"
                                        ? tr("dLeft", { days: expiryStatus.days })
                                        : format(parseISO(doc.expiryDate!), "MMM d, yyyy")}
                                  </Badge>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-muted-foreground">
                                {format(parseISO(doc.createdAt), "MMM d, yyyy")}
                              </div>
                            </TableCell>
                            <TableCell className="text-end">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-view-${doc.id}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-download-${doc.id}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => deleteMutation.mutate(doc.id)}
                                  data-testid={`button-delete-${doc.id}`}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
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
        </>
      )}

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              {tr("uploadDocumentFor", { name: selectedCompany?.name })}
            </DialogTitle>
            <DialogDescription>{tr("addAnInvoiceBillOrOther")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">{tr("documentName2")}</Label>
                <Input
                  id="name"
                  placeholder={tr("eGInvoice001")}
                  value={newDocument.name}
                  onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                  data-testid="input-document-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">{tr("category2")}</Label>
                <Select
                  value={newDocument.category}
                  onValueChange={(value) => setNewDocument({ ...newDocument, category: value })}
                >
                  <SelectTrigger data-testid="select-document-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{tr("description")}</Label>
              <Textarea
                id="description"
                placeholder={tr("briefDescriptionOfThisDocument")}
                value={newDocument.description}
                onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
                rows={2}
                data-testid="input-document-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expiryDate">{tr("expiryDateIfApplicable")}</Label>
                <Input
                  id="expiryDate"
                  type="date"
                  value={newDocument.expiryDate}
                  onChange={(e) => setNewDocument({ ...newDocument, expiryDate: e.target.value })}
                  data-testid="input-expiry-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminderDays">{tr("remindBeforeDays")}</Label>
                <Input
                  id="reminderDays"
                  type="number"
                  min="1"
                  max="365"
                  value={newDocument.reminderDays}
                  onChange={(e) =>
                    setNewDocument({ ...newDocument, reminderDays: parseInt(e.target.value) || 30 })
                  }
                  data-testid="input-reminder-days"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{tr("uploadFile")}</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  data-testid="input-file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2 text-primary">
                      <FileText className="w-8 h-8" />
                      <div>
                        <p className="font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      <Upload className="w-8 h-8 mx-auto mb-2" />
                      <p>{tr("clickToUploadOrDragAnd")}</p>
                      <p className="text-xs">{tr("pdfDocXlsJpgPngMax")}</p>
                    </div>
                  )}
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={handleUpload}
              disabled={isUploading || !newDocument.name}
              data-testid="button-submit-upload"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  {tr("uploading")}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 me-2" />
                  {tr("uploadDocument")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
