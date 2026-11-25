import { PageHeader } from "@/components/ui/page-header";
import { FileDrop } from "@/components/ui/file-drop";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { differenceInDays } from "date-fns";
import { formatDate, parseCalendarDate } from "@/lib/format-date";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
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
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { withCsrfHeader } from "@/lib/csrf";

/** W4-D (R16-09): headers for a raw fetch (Bearer, or the CSRF token for cookie sessions). */
async function vaultHeaders(method: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  return headers.Authorization ? headers : withCsrfHeader(method, headers);
}

/** Open or download a vault file: stored files stream from the authenticated API. */
async function openVaultFile(doc: { fileUrl: string; fileName: string }, download: boolean) {
  if (/^https:\/\//i.test(doc.fileUrl)) {
    window.open(doc.fileUrl, "_blank", "noopener,noreferrer");
    return;
  }
  // Stored files are served by the authenticated download route (fileUrl is set by the server).
  if (!/^\/api\/documents\/[0-9a-f-]{36}\/download$/i.test(doc.fileUrl)) return;
  const res = await fetch(apiUrl(doc.fileUrl), {
    headers: await vaultHeaders("GET"),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  if (download) {
    const link = document.createElement("a");
    link.href = url;
    link.download = doc.fileName;
    link.click();
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
import {
  FileText,
  Download,
  Trash2,
  Search,
  CheckCircle2,
  FolderOpen,
  Calendar,
  Loader2,
  Plus,
  Eye,
  Filter,
} from "lucide-react";

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
  { value: "invoice", labelEn: "Invoice", labelAr: "فاتورة" },
  { value: "bill", labelEn: "Bill/Expense", labelAr: "فاتورة مصروفات" },
  { value: "receipt", labelEn: "Receipt", labelAr: "إيصال" },
  { value: "quote", labelEn: "Quote/Quotation", labelAr: "عرض سعر" },
  { value: "purchase_order", labelEn: "Purchase order", labelAr: "أمر شراء" },
  { value: "trade_license", labelEn: "Trade licence", labelAr: "الرخصة التجارية" },
  { value: "contract", labelEn: "Contract", labelAr: "عقد" },
  { value: "tax_certificate", labelEn: "Tax certificate", labelAr: "شهادة ضريبية" },
  { value: "audit_report", labelEn: "Audit report", labelAr: "تقرير التدقيق" },
  { value: "bank_statement", labelEn: "Bank statement", labelAr: "كشف حساب بنكي" },
  { value: "insurance", labelEn: "Insurance", labelAr: "تأمين" },
  { value: "visa", labelEn: "Visa/Emirates ID", labelAr: "تأشيرة/هوية إماراتية" },
  { value: "vat_return", labelEn: "VAT return", labelAr: "إقرار ضريبة القيمة المضافة" },
  { value: "other", labelEn: "Other", labelAr: "أخرى" },
];

export default function DocumentVault() {
  const { t } = useTranslation();
  const { t: _t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
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
    data: documents,
    isLoading,
    isError,
    refetch,
  } = useQuery<Document[]>({
    queryKey: ["/api/companies", companyId, "documents"],
    enabled: !!companyId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      nameAr: string;
      category: string;
      description: string;
      expiryDate: string;
      reminderDays: number;
      file: File;
    }) => {
      // Real multipart upload: the server checks the bytes and stores the file.
      const form = new FormData();
      form.append("name", data.name);
      if (data.nameAr) form.append("nameAr", data.nameAr);
      form.append("category", data.category);
      if (data.description) form.append("description", data.description);
      if (data.expiryDate) form.append("expiryDate", data.expiryDate);
      form.append("reminderDays", String(data.reminderDays));
      form.append("file", data.file, data.file.name);
      const res = await fetch(apiUrl(`/api/companies/${companyId}/documents`), {
        method: "POST",
        headers: await vaultHeaders("POST"),
        body: form,
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "documents"] });
      toast({
        title: locale === "ar" ? "تم الرفع بنجاح" : "Upload successful",
        description: locale === "ar" ? "تم حفظ المستند" : "Document has been saved",
      });
      setUploadDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: locale === "ar" ? "فشل الرفع" : "Upload failed",
        description: error?.message,
      });
    },
  });

  const ar = locale === "ar";
  const openFile = (doc: { fileUrl: string; fileName: string }, download: boolean) => {
    openVaultFile(doc, download).catch(() => {
      toast({
        variant: "destructive",
        title: t["documentVault.openFailedTitle"],
        description: t["documentVault.openFailedBody"],
      });
    });
  };

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => apiRequest("DELETE", `/api/documents/${documentId}`),
    onError: () => {
      toast({
        variant: "destructive",
        title: t["documentVault.deleteFailedTitle"],
        description: t["documentVault.deleteFailedBody"],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "documents"] });
      toast({
        title: locale === "ar" ? "تم الحذف" : "Deleted",
        description: locale === "ar" ? "تم حذف المستند" : "Document has been deleted",
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
        title: locale === "ar" ? "معلومات ناقصة" : "Missing information",
        description: locale === "ar" ? "يرجى إدخال اسم المستند" : "Please enter document name",
      });
      return;
    }

    if (!selectedFile) {
      toast({
        variant: "destructive",
        title: locale === "ar" ? "معلومات ناقصة" : "Missing information",
        description: locale === "ar" ? "يرجى اختيار ملف" : "Please choose a file",
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
    } finally {
      setIsUploading(false);
    }
  };

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const days = differenceInDays(parseCalendarDate(expiryDate), new Date());
    if (days < 0) return { status: "expired", color: "destructive", days: Math.abs(days) };
    if (days <= 30) return { status: "expiring_soon", color: "warning", days };
    return { status: "valid", color: "default", days };
  };

  const activeDocuments = documents?.filter((doc) => !doc.isArchived) ?? [];
  const query = searchQuery.trim().toLowerCase();
  const hasFilters = query.length > 0 || categoryFilter !== "all";
  const filteredDocuments = activeDocuments.filter((doc) => {
    if (categoryFilter !== "all" && doc.category !== categoryFilter) return false;
    if (!query) return true;
    return [doc.name, doc.nameAr, doc.fileName, doc.description].some((v) =>
      v?.toLowerCase().includes(query)
    );
  });
  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
  };

  const expiringDocs =
    documents?.filter((doc) => {
      if (!doc.expiryDate || doc.isArchived) return false;
      const days = differenceInDays(parseCalendarDate(doc.expiryDate), new Date());
      return days >= 0 && days <= 30;
    }) || [];

  const expiredDocs =
    documents?.filter((doc) => {
      if (!doc.expiryDate || doc.isArchived) return false;
      return differenceInDays(parseCalendarDate(doc.expiryDate), new Date()) < 0;
    }) || [];

  if (isLoadingCompany || isLoading) {
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

  if (isError) {
    return (
      <SettingsLayout>
        <div className="space-y-6">
          <PageHeader
            eyebrow={t["documentVault.operations"]}
            title={ar ? "خزنة المستندات" : t["shell.moreDocumentVault"]}
          />
          <Alert
            tone="danger"
            title={t["documentVault.loadFailedTitle"]}
            data-testid="vault-load-error"
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                {t["documentVault.retry"]}
              </Button>
            }
          >
            {t["documentVault.loadFailedBody"]}
          </Alert>
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t["documentVault.operations"]}
          title={locale === "ar" ? "خزنة المستندات" : t["shell.moreDocumentVault"]}
          description={
            locale === "ar"
              ? "قم بتخزين وإدارة مستنداتك المهمة مع تنبيهات انتهاء الصلاحية"
              : t["documentVault.storeAndManageYourImportant"]
          }
          actions={
            <Button onClick={() => setUploadDialogOpen(true)} data-testid="button-upload-document">
              <Plus className="h-4 w-4" aria-hidden />
              {locale === "ar" ? "رفع مستند" : t["pages.uploadDocument"]}
            </Button>
          }
        />

        {/* Fable B9: no tile row. Expiry is the only signal worth a line, and only when a
            document is expiring or has expired. */}
        {(expiringDocs.length > 0 || expiredDocs.length > 0) && (
          <Alert
            tone={expiredDocs.length > 0 ? "danger" : "warning"}
            title={formatMessage(t["documentVault.expiryAlert"], {
              expiring: expiringDocs.length,
              expired: expiredDocs.length,
            })}
            data-testid="vault-expiry-alert"
          />
        )}

        {activeDocuments.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={locale === "ar" ? "لا توجد مستندات" : t["documentVault.noDocumentsYet"]}
            description={t["documentVault.emptyBody"]}
            action={{
              label: locale === "ar" ? "رفع أول مستند" : t["documentVault.uploadYourFirstDocument"],
              icon: Plus,
              onClick: () => setUploadDialogOpen(true),
              testId: "button-upload-first-document",
            }}
          />
        ) : (
          <Card>
            <div role="status" aria-atomic="true" className="sr-only">
              {hasFilters && filteredDocuments.length === 0 ? t["documentVault.noMatchTitle"] : ""}
            </div>
            <CardHeader>
              <div className="flex flex-col md:flex-row gap-4 justify-between">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    aria-label={t["documentVault.search"]}
                    placeholder={t["documentVault.search"]}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    type="search"
                    dir="auto"
                    className="ps-10"
                    data-testid="input-search-documents"
                  />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger
                    className="w-full md:w-[200px]"
                    data-testid="select-category-filter"
                    aria-label={t["adminDocuments.filterByCategory"]}
                  >
                    <Filter className="me-2 h-4 w-4" aria-hidden />
                    <SelectValue
                      placeholder={
                        locale === "ar" ? "تصفية حسب الفئة" : t["adminDocuments.filterByCategory"]
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {locale === "ar" ? "جميع الفئات" : t["pages.allCategories"]}
                    </SelectItem>
                    {DOCUMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {locale === "ar" ? cat.labelAr : cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filteredDocuments.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title={t["documentVault.noMatchTitle"]}
                  description={t["documentVault.noMatchBody"]}
                  action={{
                    label: t["documentVault.clearFilters"],
                    onClick: clearFilters,
                    variant: "outline",
                    testId: "button-clear-document-filters",
                  }}
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {locale === "ar" ? "اسم المستند" : t["pages.documentName"]}
                        </TableHead>
                        <TableHead>{t["pages.category"]}</TableHead>
                        <TableHead>
                          {locale === "ar" ? "تاريخ الانتهاء" : t["pageLabels.expiryDate"]}
                        </TableHead>
                        <TableHead>{t["pages.status"]}</TableHead>
                        <TableHead>
                          {locale === "ar" ? "تاريخ الرفع" : t["documentVault.uploadDate"]}
                        </TableHead>
                        <TableHead className="text-end">{t["pages.actions"]}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDocuments.map((doc) => {
                        const expiryStatus = getExpiryStatus(doc.expiryDate);
                        const category = DOCUMENT_CATEGORIES.find((c) => c.value === doc.category);

                        return (
                          <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <FileText
                                  className="h-4 w-4 shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                                <div className="min-w-0">
                                  <bdi className="block break-words font-medium" translate="no">
                                    {locale === "ar" && doc.nameAr ? doc.nameAr : doc.name}
                                  </bdi>
                                  <bdi
                                    className="block break-all text-xs text-muted-foreground"
                                    translate="no"
                                  >
                                    {doc.fileName}
                                  </bdi>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {category
                                  ? ar
                                    ? category.labelAr
                                    : category.labelEn
                                  : doc.category}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {doc.expiryDate ? (
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {formatDate(doc.expiryDate, locale)}
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
                                  {expiryStatus.status === "expired" && (
                                    <>
                                      {locale === "ar"
                                        ? `منتهي منذ ${expiryStatus.days} يوم`
                                        : `Expired ${expiryStatus.days}d ago`}
                                    </>
                                  )}
                                  {expiryStatus.status === "expiring_soon" && (
                                    <>
                                      {locale === "ar"
                                        ? `ينتهي خلال ${expiryStatus.days} يوم`
                                        : `Expires in ${expiryStatus.days}d`}
                                    </>
                                  )}
                                  {expiryStatus.status === "valid" && (
                                    <>
                                      <CheckCircle2 className="me-1 h-3 w-3" aria-hidden />
                                      {locale === "ar" ? "صالح" : "Valid"}
                                    </>
                                  )}
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  {locale === "ar" ? "بدون انتهاء" : t["documentVault.noExpiry"]}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {formatDate(doc.createdAt, locale)}
                            </TableCell>
                            <TableCell className="text-end">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={t["adminDocuments.view"]}
                                  onClick={() => openFile(doc, false)}
                                  data-testid={`button-view-${doc.id}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={t["adminDocuments.download"]}
                                  onClick={() => openFile(doc, true)}
                                  data-testid={`button-download-${doc.id}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={t["adminDocuments.delete"]}
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        locale === "ar"
                                          ? "هل أنت متأكد من حذف هذا المستند؟"
                                          : "Are you sure you want to delete this document?"
                                      )
                                    ) {
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
        )}

        <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {locale === "ar" ? "رفع مستند جديد" : t["documentVault.uploadNewDocument"]}
              </DialogTitle>
              <DialogDescription>
                {locale === "ar"
                  ? "ارفع مستنداً مهماً مثل الرخصة التجارية أو العقود"
                  : t["documentVault.uploadAnImportantDocumentLike"]}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>
                    {locale === "ar" ? "اسم المستند (إنجليزي)" : "Document name (English)"}
                  </Label>
                  <Input
                    dir="ltr"
                    value={newDocument.name}
                    onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                    placeholder={t["documentVault.tradeLicense2025"]}
                    data-testid="input-document-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{locale === "ar" ? "اسم المستند (عربي)" : "Document name (Arabic)"}</Label>
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
                <Label>{locale === "ar" ? "الفئة" : "Category"}</Label>
                <Select
                  value={newDocument.category}
                  onValueChange={(val) => setNewDocument({ ...newDocument, category: val })}
                >
                  <SelectTrigger
                    data-testid="select-document-category"
                    aria-label={t["documentVault.documentCategory"]}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {locale === "ar" ? cat.labelAr : cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{locale === "ar" ? "الوصف (اختياري)" : "Description (optional)"}</Label>
                <Textarea
                  value={newDocument.description}
                  onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
                  placeholder={
                    locale === "ar"
                      ? "أضف ملاحظات حول هذا المستند..."
                      : "Add notes about this document..."
                  }
                  data-testid="input-document-description"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>
                    {locale === "ar" ? "تاريخ الانتهاء (اختياري)" : "Expiry date (optional)"}
                  </Label>
                  <DatePicker
                    value={newDocument.expiryDate}
                    onChange={(v) => setNewDocument({ ...newDocument, expiryDate: v })}
                    data-testid="input-expiry-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{locale === "ar" ? "تذكير قبل (أيام)" : "Remind before (days)"}</Label>
                  <Input
                    type="number"
                    value={newDocument.reminderDays}
                    onChange={(e) =>
                      setNewDocument({
                        ...newDocument,
                        reminderDays: parseInt(e.target.value) || 30,
                      })
                    }
                    min="1"
                    max="365"
                    data-testid="input-reminder-days"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{locale === "ar" ? "الملف" : "File"}</Label>
                <FileDrop
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  inputTestId="input-document-file"
                  value={
                    selectedFile
                      ? `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
                      : undefined
                  }
                  onFiles={([f]) => setSelectedFile(f ?? null)}
                  onClear={() => setSelectedFile(null)}
                />
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
                {locale === "ar" ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                onClick={handleUpload}
                disabled={isUploading}
                data-testid="button-confirm-upload"
              >
                {isUploading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {locale === "ar" ? "رفع" : "Upload"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </SettingsLayout>
  );
}
