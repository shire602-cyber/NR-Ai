import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
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
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/lib/i18n";
import {
  ACCEPTED_UPLOAD_TYPES,
  checkFileBeforeUpload,
  downloadAuthenticatedFile,
  fileProblemMessage,
  readFileAsBase64,
} from "@/lib/file-upload";
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
  CheckCircle2,
  FolderOpen,
  Calendar,
  Loader2,
  Plus,
  Filter,
  ArrowLeft,
} from "lucide-react";
import { messages as pageMessages } from "./ClientDocuments.i18n";

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
  /** Visible to the client in the client portal (documents.shared_with_portal). */
  sharedWithPortal?: boolean;
  uploadedBy: string | null;
  createdAt: string;
}

interface Company {
  id: string;
  name: string;
}

const getDocumentCategories = () => [
  { value: "invoice", label: pageMessages.t("invoice") },
  { value: "bill", label: pageMessages.t("billExpense") },
  { value: "receipt", label: pageMessages.t("receipt") },
  { value: "quote", label: pageMessages.t("quoteQuotation") },
  { value: "purchase_order", label: pageMessages.t("purchaseOrder") },
  { value: "trade_license", label: pageMessages.t("tradeLicense") },
  { value: "contract", label: pageMessages.t("contract") },
  { value: "tax_certificate", label: pageMessages.t("taxCertificate") },
  { value: "audit_report", label: pageMessages.t("auditReport") },
  { value: "bank_statement", label: pageMessages.t("bankStatement") },
  { value: "insurance", label: pageMessages.t("insurance") },
  { value: "visa", label: "Visa/Emirates ID" },
  { value: "vat_return", label: pageMessages.t("vatReturn") },
  { value: "other", label: pageMessages.t("other") },
];

export default function ClientDocuments() {
  const tr = pageMessages.useT();

  const { id: clientId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { locale } = useTranslation();
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

  const { data: clientData } = useQuery<{ company: Company }>({
    queryKey: [`/api/admin/clients/${clientId}`],
    enabled: !!clientId,
  });
  const company = clientData?.company;

  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: [`/api/companies/${clientId}/documents`],
    enabled: !!clientId,
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
      mimeType: string;
      fileData: string;
    }) => {
      // Same path as the Document Vault: the file travels as base64 and the server validates (type, magic bytes,
      // 10 MB) and stores it privately under a company-scoped key. A client-supplied fileUrl is never sent.
      return apiRequest("POST", `/api/companies/${clientId}/documents`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${clientId}/documents`] });
      toast({
        title: tr("uploadSuccessful"),
        description: tr("documentHasBeenSaved"),
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
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${clientId}/documents`] });
      toast({
        title: tr("deleted"),
        description: tr("documentHasBeenDeleted"),
      });
    },
  });

  const shareMutation = useMutation({
    mutationFn: ({ id, shared }: { id: string; shared: boolean }) =>
      apiRequest("PATCH", `/api/documents/${id}/portal-sharing`, { sharedWithPortal: shared }),
    onSuccess: (_doc, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${clientId}/documents`] });
      toast({
        title: vars.shared ? tr("sharedWithPortal") : tr("noLongerShared"),
        description: vars.shared ? tr("clientCanNowSeeIt") : tr("clientCanNoLongerSeeIt"),
      });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: tr("couldNotChangeSharing"), description: error?.message });
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
        title: tr("missingInformation"),
        description: tr("pleaseEnterDocumentName"),
      });
      return;
    }

    if (!selectedFile) {
      toast({
        variant: "destructive",
        title: tr("missingInformation"),
        description: tr("pleaseChooseAFileToUpload"),
      });
      return;
    }
    const problem = checkFileBeforeUpload(selectedFile);
    if (problem) {
      toast({
        variant: "destructive",
        title: tr("invalidFile"),
        description: fileProblemMessage(problem, locale),
      });
      return;
    }

    setIsUploading(true);
    try {
      const fileData = await readFileAsBase64(selectedFile);
      await uploadMutation.mutateAsync({
        name: newDocument.name,
        nameAr: newDocument.nameAr,
        category: newDocument.category,
        description: newDocument.description,
        expiryDate: newDocument.expiryDate,
        reminderDays: newDocument.reminderDays,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
        fileData,
      });
    } catch (error: any) {
      // Server rejections are toasted by the mutation; this covers read errors.
      if (!uploadMutation.isError) {
        toast({ variant: "destructive", title: tr("uploadFailed"), description: error?.message });
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      await downloadAuthenticatedFile(`/api/documents/${doc.id}/download`, doc.fileName);
    } catch (error: any) {
      toast({ variant: "destructive", title: tr("downloadFailed"), description: error?.message });
    }
  };

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const days = differenceInDays(parseISO(expiryDate), new Date());
    if (days < 0) return { status: "expired", color: "destructive", days: Math.abs(days) };
    if (days <= 30) return { status: "expiring_soon", color: "warning", days };
    return { status: "valid", color: "default", days };
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

  const expiringDocs =
    documents?.filter((doc) => {
      if (!doc.expiryDate || doc.isArchived) return false;
      const days = differenceInDays(parseISO(doc.expiryDate), new Date());
      return days >= 0 && days <= 30;
    }) || [];

  const expiredDocs =
    documents?.filter((doc) => {
      if (!doc.expiryDate || doc.isArchived) return false;
      return differenceInDays(parseISO(doc.expiryDate), new Date()) < 0;
    }) || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/clients">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              {tr("documents")} {company?.name || tr("client")}
            </h1>
            <p className="text-muted-foreground">{tr("manageDocumentsForThisClient")}</p>
          </div>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)} data-testid="button-upload-document">
          <Plus className="w-4 h-4 me-2" />
          {tr("uploadDocument")}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("totalDocuments")}</CardTitle>
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documents?.length || 0}</div>
          </CardContent>
        </Card>

        <Card className={expiringDocs.length > 0 ? "border-warning" : ""}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("expiringSoon")}</CardTitle>
            <Clock className="w-4 h-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{expiringDocs.length}</div>
            <p className="text-xs text-muted-foreground">{tr("within30Days")}</p>
          </CardContent>
        </Card>

        <Card className={expiredDocs.length > 0 ? "border-destructive" : ""}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("expired")}</CardTitle>
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{expiredDocs.length}</div>
            <p className="text-xs text-muted-foreground">{tr("needRenewal")}</p>
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
                data-testid="input-search-documents"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
                <Filter className="w-4 h-4 me-2" />
                <SelectValue placeholder={tr("filterByCategory")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("allCategories")}</SelectItem>
                {getDocumentCategories().map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredDocuments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{tr("noDocumentsFound")}</p>
              <Button variant="ghost" onClick={() => setUploadDialogOpen(true)}>
                {tr("uploadFirstDocument")}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("documentName")}</TableHead>
                    <TableHead>{tr("category")}</TableHead>
                    <TableHead>{tr("expiryDate")}</TableHead>
                    <TableHead>{tr("status")}</TableHead>
                    <TableHead>{tr("uploadDate")}</TableHead>
                    <TableHead>{tr("shareWithPortal")}</TableHead>
                    <TableHead className="text-end">{tr("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocuments.map((doc) => {
                    const expiryStatus = getExpiryStatus(doc.expiryDate);
                    const category = getDocumentCategories().find((c) => c.value === doc.category);

                    return (
                      <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{doc.name}</div>
                              <div className="text-xs text-muted-foreground">{doc.fileName}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{category?.label}</Badge>
                        </TableCell>
                        <TableCell>
                          {doc.expiryDate ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {format(parseISO(doc.expiryDate), "dd MMM yyyy")}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {expiryStatus ? (
                            <Badge
                              variant={
                                expiryStatus.status === "expired"
                                  ? "destructive"
                                  : expiryStatus.status === "expiring_soon"
                                    ? "secondary"
                                    : "default"
                              }
                            >
                              {expiryStatus.status === "expired" &&
                                tr("expiredDAgo", { days: expiryStatus.days })}
                              {expiryStatus.status === "expiring_soon" &&
                                tr("expiresInD", { days: expiryStatus.days })}
                              {expiryStatus.status === "valid" && (
                                <>
                                  <CheckCircle2 className="w-3 h-3 me-1" />
                                  {tr("valid")}
                                </>
                              )}
                            </Badge>
                          ) : (
                            <Badge variant="outline">{tr("noExpiry")}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{format(parseISO(doc.createdAt), "dd MMM yyyy")}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={doc.sharedWithPortal === true}
                              disabled={shareMutation.isPending}
                              onCheckedChange={(shared) => shareMutation.mutate({ id: doc.id, shared })}
                              aria-label={tr("shareWithPortal")}
                              data-testid={`switch-share-portal-${doc.id}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              {doc.sharedWithPortal === true ? tr("shared") : tr("private")}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDownload(doc)}
                              aria-label={tr("download")}
                              data-testid={`button-download-${doc.id}`}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(tr("areYouSureYouWantTo"))) {
                                  deleteMutation.mutate(doc.id);
                                }
                              }}
                              data-testid={`button-delete-${doc.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
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

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("uploadNewDocument")}</DialogTitle>
            <DialogDescription>{tr("uploadAnImportantDocumentLikeTrade")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tr("documentNameEnglish")}</Label>
                <Input
                  value={newDocument.name}
                  onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                  placeholder={tr("tradeLicense2025")}
                  data-testid="input-document-name"
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("documentNameArabic")}</Label>
                <Input
                  value={newDocument.nameAr}
                  onChange={(e) => setNewDocument({ ...newDocument, nameAr: e.target.value })}
                  placeholder="الرخصة التجارية 2025"
                  dir="rtl"
                  data-testid="input-document-name-ar"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{tr("category")}</Label>
              <Select
                value={newDocument.category}
                onValueChange={(val) => setNewDocument({ ...newDocument, category: val })}
              >
                <SelectTrigger data-testid="select-document-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getDocumentCategories().map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{tr("descriptionOptional")}</Label>
              <Textarea
                value={newDocument.description}
                onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
                placeholder={tr("addNotesAboutThisDocument")}
                data-testid="input-document-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tr("expiryDateOptional")}</Label>
                <Input
                  type="date"
                  value={newDocument.expiryDate}
                  onChange={(e) => setNewDocument({ ...newDocument, expiryDate: e.target.value })}
                  data-testid="input-expiry-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("remindBeforeDays")}</Label>
                <Input
                  type="number"
                  value={newDocument.reminderDays}
                  onChange={(e) =>
                    setNewDocument({ ...newDocument, reminderDays: parseInt(e.target.value) || 30 })
                  }
                  min="1"
                  max="365"
                  data-testid="input-reminder-days"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{tr("file")}</Label>
              <Input
                type="file"
                accept={ACCEPTED_UPLOAD_TYPES}
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                data-testid="input-document-file"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  {tr("selectedKb", {
                    name: selectedFile.name,
                    value: (selectedFile.size / 1024).toFixed(1),
                  })}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUploadDialogOpen(false);
                resetForm();
              }}
            >
              {tr("cancel")}
            </Button>
            <Button
              onClick={handleUpload}
              disabled={isUploading}
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
                  {tr("upload")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
