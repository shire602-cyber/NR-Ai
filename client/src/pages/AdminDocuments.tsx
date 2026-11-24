import { T } from "@/components/layout/T";
import { DatePicker } from "@/components/ui/date-picker";
import { useTranslation, translateNow, formatMessage } from "@/lib/i18n";
import { formatDate, parseCalendarDate } from "@/lib/format-date";
import { PageHeader } from "@/components/ui/page-header";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { differenceInDays } from "date-fns";
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
import { downloadStoredFile } from "@/lib/stored-file";
import { openStoredFile, readFileAsDataUrl } from "@/lib/purchase-files";
import {
  Upload,
  FileText,
  Download,
  Trash2,
  Search,
  AlertTriangle,
  Clock,
  FolderOpen,
  Loader2,
  Plus,
  Eye,
  Filter,
  Building2,
  FileUp,
} from "lucide-react";

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
  { value: "invoice", labelKey: "invoices.publicInvoice" },
  { value: "bill", labelKey: "adminDocuments.cat.bill" },
  { value: "receipt", labelKey: "pages.receipt" },
  { value: "quote", labelKey: "adminDocuments.cat.quote" },
  { value: "purchase_order", labelKey: "adminDocuments.purchaseOrder" },
  { value: "trade_license", labelKey: "adminDocuments.tradeLicense" },
  { value: "contract", labelKey: "adminDocuments.cat.contract" },
  { value: "tax_certificate", labelKey: "adminDocuments.taxCertificate" },
  { value: "audit_report", labelKey: "adminDocuments.auditReport" },
  { value: "bank_statement", labelKey: "adminDocuments.bankStatement" },
  { value: "insurance", labelKey: "forms.budget.cat.Insurance" },
  { value: "visa", labelKey: "adminDocuments.cat.visa" },
  { value: "vat_return", labelKey: "adminDocuments.cat.vat_return" },
  { value: "other", labelKey: "forms.claim.cat.Other" },
];

/** Categories the document vault accepts on upload (DOC_CATEGORIES); older rows may carry others. */
const UPLOAD_CATEGORIES = DOCUMENT_CATEGORIES.filter((c) =>
  [
    "trade_license",
    "contract",
    "tax_certificate",
    "audit_report",
    "bank_statement",
    "insurance",
    "visa",
    "other",
  ].includes(c.value)
);

export default function AdminDocuments() {
  const { t, locale } = useTranslation();
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
    category: "other",
    description: "",
    expiryDate: "",
    reminderDays: 30,
  });

  const {
    data: companies,
    isLoading: isLoadingCompanies,
    isError: companiesFailed,
    error: companiesError,
    refetch: refetchCompanies,
  } = useQuery<Company[]>({
    queryKey: ["/api/admin/documents/companies"],
  });

  const {
    data: documents,
    isLoading: isLoadingDocs,
    isError: docsFailed,
    error: docsError,
    refetch: refetchDocs,
  } = useQuery<Document[]>({
    queryKey: ["/api/companies", selectedCompanyId, "documents"],
    enabled: !!selectedCompanyId,
  });

  const uploadMutation = useMutation({
    // The bytes go to the document vault (JSON base64 contract); the server sniffs the type and
    // stores the file, so View / Download work afterwards.
    mutationFn: async (data: {
      name: string;
      nameAr: string;
      category: string;
      description: string;
      expiryDate: string;
      reminderDays: number;
      file: File;
    }) => {
      return apiRequest("POST", `/api/companies/${selectedCompanyId}/documents`, {
        name: data.name,
        nameAr: data.nameAr || null,
        category: data.category,
        description: data.description || null,
        expiryDate: data.expiryDate || null,
        reminderDays: data.reminderDays,
        fileName: data.file.name,
        mimeType: data.file.type || undefined,
        fileData: await readFileAsDataUrl(data.file),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "documents"],
      });
      toast({
        title: translateNow("toasts.uploadSuccessful"),
        description: translateNow("toasts.documentHasBeenSavedForTheClient"),
      });
      setUploadDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.uploadFailed"),
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
        title: translateNow("toasts.deleted"),
        description: translateNow("toasts.documentHasBeenDeleted"),
      });
    },
    onError: (error: unknown) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.deleteFailed"),
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });

  const resetForm = () => {
    setNewDocument({
      name: "",
      nameAr: "",
      category: "other",
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
        title: translateNow("toasts.missingInformation"),
        description: translateNow("toasts.pleaseEnterDocumentName"),
      });
      return;
    }

    if (!selectedFile) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.missingInformation"),
        description: translateNow("adminDocuments.chooseFile"),
      });
      return;
    }

    if (!selectedCompanyId) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.selectClient"),
        description: translateNow("toasts.pleaseSelectAClientFirst"),
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
        file: selectedFile,
      });
    } catch {
      // A refused upload is reported by the mutation's onError toast; the dialog stays open.
    } finally {
      setIsUploading(false);
    }
  };

  // View / Download read the stored file from the vault. Rows saved before uploads were stored
  // (metadata only) have no bytes: say so instead of failing silently.
  const openStored = async (doc: Document, mode: "view" | "download") => {
    try {
      const url = `/api/documents/${doc.id}/download`;
      if (mode === "view") await openStoredFile(url);
      else await downloadStoredFile(url, doc.fileName);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t["adminDocuments.fileUnavailable"],
        description: (error as Error)?.message,
      });
    }
  };

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const days = differenceInDays(parseCalendarDate(expiryDate), new Date());
    if (days < 0) return { status: "expired", color: "destructive" as const, days: Math.abs(days) };
    if (days <= 30) return { status: "expiring_soon", color: "secondary" as const, days };
    return { status: "valid", color: "default" as const, days };
  };

  const getCategoryLabel = (category: string) => {
    const cat = DOCUMENT_CATEGORIES.find((c) => c.value === category);
    return cat ? t[cat.labelKey] : category;
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
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title={t["adminDocuments.clientDocumentManagement"]}
        testId="text-admin-documents-title"
        description={t["adminDocuments.uploadAndManageInvoicesBills"]}
        actions={
          <Button
            onClick={() => setUploadDialogOpen(true)}
            disabled={!selectedCompanyId}
            data-testid="button-upload-client-document"
          >
            <Plus className="w-4 h-4 me-2" />
            <T k="pages.uploadDocument" />
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            <T k="pages.selectClient" />
          </CardTitle>
          <CardDescription>
            <T k="pages.chooseAClientToViewOrUploadDocumentsForThem" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger
              className="w-full md:w-[400px]"
              aria-label={t["pages.selectClient"]}
              data-testid="select-client-company"
            >
              <SelectValue placeholder={t["adminDocuments.selectAClientCompany"]} />
            </SelectTrigger>
            <SelectContent>
              {companies?.map((company) => (
                <SelectItem key={company.id} value={company.id}>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    <span>{company.name}</span>
                    {company.trnNumber && (
                      <span className="text-muted-foreground text-xs">
                        ({t["forms.preview.trnShort"]}: <bdi>{company.trnNumber}</bdi>)
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {companiesFailed && (
            <LoadErrorState
              error={companiesError}
              onRetry={() => void refetchCompanies()}
              testId="admin-documents-companies-error"
            />
          )}
          {!isLoadingCompanies && !companiesFailed && (companies?.length ?? 0) === 0 && (
            <p
              className="mt-3 text-sm text-muted-foreground"
              data-testid="text-no-writable-clients"
            >
              <T k="adminDocuments.noWritableClients" />
            </p>
          )}
        </CardContent>
      </Card>

      {selectedCompanyId && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pages.totalDocuments" />
                </CardTitle>
                <FolderOpen className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{documents?.length || 0}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pages.invoices" />
                </CardTitle>
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
                <CardTitle className="text-sm font-medium">
                  {t["adminConsole.billsExpenses"]}
                </CardTitle>
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
                <CardTitle className="text-sm font-medium">
                  <T k="pages.expiringSoon" />
                </CardTitle>
                <Clock className="w-4 h-4 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">
                  {documents?.filter((doc) => {
                    if (!doc.expiryDate || doc.isArchived) return false;
                    const days = differenceInDays(parseCalendarDate(doc.expiryDate), new Date());
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
                    placeholder={t["adminDocuments.searchDocuments"]}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="ps-10"
                    data-testid="input-search-client-documents"
                  />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger
                    className="w-[200px]"
                    aria-label={t["pages.category"]}
                    data-testid="select-category-filter"
                  >
                    <Filter className="w-4 h-4 me-2" />
                    <SelectValue placeholder={t["adminDocuments.filterByCategory"]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <T k="pages.allCategories" />
                    </SelectItem>
                    {DOCUMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {t[cat.labelKey]}
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
              ) : docsFailed ? (
                <LoadErrorState
                  error={docsError}
                  onRetry={() => void refetchDocs()}
                  testId="admin-documents-list-error"
                />
              ) : filteredDocuments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>
                    {formatMessage(t["adminDocuments.noneFor"], {
                      name: selectedCompany?.name ?? "",
                    })}
                  </p>
                  <Button variant="ghost" onClick={() => setUploadDialogOpen(true)}>
                    <T k="pages.uploadADocument" />
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="pages.documentName" />
                        </TableHead>
                        <TableHead>
                          <T k="pages.category" />
                        </TableHead>
                        <TableHead>{t["adminConsole.colFile"]}</TableHead>
                        <TableHead>
                          <T k="pages.expiry" />
                        </TableHead>
                        <TableHead>
                          <T k="pages.uploaded" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="pages.actions" />
                        </TableHead>
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
                                      ? formatMessage(t["adminConsole.expiredDaysAgo"], {
                                          n: expiryStatus.days,
                                        })
                                      : expiryStatus.status === "expiring_soon"
                                        ? formatMessage(t["adminConsole.daysLeft"], {
                                            n: expiryStatus.days,
                                          })
                                        : formatDate(doc.expiryDate, locale)}
                                  </Badge>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-muted-foreground">
                                {formatDate(doc.createdAt, locale)}
                              </div>
                            </TableCell>
                            <TableCell data-numeric>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={t["adminDocuments.view"]}
                                  title={t["adminDocuments.view"]}
                                  onClick={() => void openStored(doc, "view")}
                                  data-testid={`button-view-${doc.id}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={t["adminDocuments.download"]}
                                  title={t["adminDocuments.download"]}
                                  onClick={() => void openStored(doc, "download")}
                                  data-testid={`button-download-${doc.id}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={t["adminDocuments.delete"]}
                                  title={t["adminDocuments.delete"]}
                                  onClick={() => deleteMutation.mutate(doc.id)}
                                  data-testid={`button-delete-${doc.id}`}
                                >
                                  <Trash2 className="w-4 h-4 text-muted-foreground" />
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
              {formatMessage(t["adminDocuments.uploadFor"], { name: selectedCompany?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              <T k="pages.addAnInvoiceBillOrOtherDocumentForThisClient" />
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t["adminConsole.docName"]}</Label>
                <Input
                  id="name"
                  placeholder={t["adminConsole.docNamePlaceholder"]}
                  value={newDocument.name}
                  onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                  data-testid="input-document-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">{t["adminConsole.docCategory"]}</Label>
                <Select
                  value={newDocument.category}
                  onValueChange={(value) => setNewDocument({ ...newDocument, category: value })}
                >
                  <SelectTrigger
                    aria-label={t["adminConsole.docCategory"]}
                    id="category"
                    data-testid="select-document-category"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UPLOAD_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {t[cat.labelKey]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">
                <T k="pages.description" />
              </Label>
              <Textarea
                id="description"
                placeholder={t["adminDocuments.briefDescriptionOfThisDocument"]}
                value={newDocument.description}
                onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
                rows={2}
                data-testid="input-document-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expiryDate">{t["adminConsole.expiryIfAny"]}</Label>
                <DatePicker
                  id="expiryDate"
                  value={newDocument.expiryDate}
                  onChange={(v) => setNewDocument({ ...newDocument, expiryDate: v })}
                  data-testid="input-expiry-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminderDays">{t["adminConsole.remindBefore"]}</Label>
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
              <Label>
                <T k="pages.uploadFile" />
              </Label>
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
                      <p>
                        <T k="pages.clickToUploadOrDragAndDrop" />
                      </p>
                      <p className="text-xs">{t["adminConsole.uploadFormats"]}</p>
                    </div>
                  )}
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={handleUpload}
              disabled={isUploading || !newDocument.name || !selectedFile}
              data-testid="button-submit-upload"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  <T k="pages.uploading" />
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 me-2" />
                  <T k="pages.uploadDocument" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
