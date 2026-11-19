import { T } from "@/components/layout/T";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { PORTAL_LINK_TTL_DAYS } from "@shared/validators/portal";
import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload,
  FileSpreadsheet,
  Download,
  Plus,
  Search,
  Loader2,
  Building2,
  Edit,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Link2,
  Copy,
  ExternalLink,
  MoreHorizontal,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTableCard } from "@/components/ui/data-table";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VirtualTable } from "@/components/VirtualTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import type { CustomerContact } from "@shared/schema";
import { ContactForm } from "@/components/contacts/ContactForm";
import { PortalAccessSheet, type PortalSheetContact } from "@/components/portal/PortalAccessSheet";
import { portalSummaryKey } from "@/lib/portal-invite";
import { PortalStatusChip, type PortalSummaryEntry } from "@/components/portal/PortalStatusChip";
import { BulkPortalInviteDialog } from "@/components/portal/BulkPortalInviteDialog";

interface ImportResult {
  message: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface ImportPreview {
  rows: Array<Record<string, any>>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",", 2)[1] : value);
    };
    reader.readAsDataURL(file);
  });
}

async function downloadContactTemplate(companyId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/companies/${companyId}/customer-contacts/import-template`), {
    method: "GET",
    credentials: "include",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const json = await res.json();
      message = json.message || json.error || message;
    } catch {
      /* keep status */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "contact_import_template.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** One row of GET /api/portal/contacts/:id/access (metadata only; the token is never returned). */
interface PortalLinkRow {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export default function CustomerContacts() {
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const { company, companyId, isLoading: _isLoadingCompany } = useDefaultCompany();

  // R3 (CTO 17): command-palette customer results link to /contacts?q=<name>.
  const [searchTerm, setSearchTerm] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("q") ?? "")
  );
  const [activeTab, setActiveTab] = useState("list");
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [importResults, setImportResults] = useState<ImportResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editContact, setEditContact] = useState<CustomerContact | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [portalLinkDialog, setPortalLinkDialog] = useState<{
    open: boolean;
    url: string;
    contactName: string;
    contactId: string;
    /** ISO expiry from POST /portal/generate-access; empty when only managing existing links. */
    expiresAt: string;
    /** Whole days until `expiresAt`, computed when the link was issued. */
    ttlDays: number;
  }>({ open: false, url: "", contactName: "", contactId: "", expiresAt: "", ttlDays: 0 });
  const closedPortalDialog = {
    open: false,
    url: "",
    contactName: "",
    contactId: "",
    expiresAt: "",
    ttlDays: 0,
  };
  const { can: canDo, gate } = useCompanyPermission();
  const canManagePortal = canDo("documents.write");
  const portalAccessKey = [`/api/portal/contacts/${portalLinkDialog.contactId}/access`] as const;
  // The state (active / expired / revoked) is derived in `select`, not during render.
  const { data: portalAccess } = useQuery<
    { links: PortalLinkRow[] },
    Error,
    { links: Array<PortalLinkRow & { state: "active" | "expired" | "revoked" }> }
  >({
    queryKey: portalAccessKey,
    enabled: portalLinkDialog.open && !!portalLinkDialog.contactId,
    select: (data) => ({
      links: data.links.map((l) => ({
        ...l,
        state: l.revokedAt
          ? "revoked"
          : new Date(l.expiresAt).getTime() > Date.now()
            ? "active"
            : "expired",
      })),
    }),
  });
  const activePortalLinks = (portalAccess?.links ?? []).filter((l) => l.state === "active");
  // STEP5: the invitation sheet and the bulk invite dialog (the customer portal with a login).
  const [inviteContact, setInviteContact] = useState<PortalSheetContact | null>(null);
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false);
  const { data: portalSummary = {} } = useQuery<Record<string, PortalSummaryEntry>>({
    queryKey: portalSummaryKey(companyId ?? ""),
    enabled: !!companyId,
    staleTime: 30_000,
  });
  const openInvite = (c: CustomerContact) =>
    setInviteContact({
      id: c.id,
      name: c.name,
      email: c.email ?? null,
      contactPerson: c.contactPerson ?? null,
      preferredLanguage: c.preferredLanguage ?? null,
    });
  const [contactToDelete, setContactToDelete] = useState<CustomerContact | null>(null);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [clearAllConfirmation, setClearAllConfirmation] = useState("");

  const { data: contacts = [], isLoading } = useQuery<CustomerContact[]>({
    queryKey: ["/api/companies", companyId, "customer-contacts"],
    enabled: !!companyId,
  });

  const importMutation = useMutation({
    mutationFn: async (data: any[]) => {
      return apiRequest("POST", `/api/companies/${companyId}/customer-contacts/import`, {
        contacts: data,
      });
    },
    onSuccess: (result: ImportResult) => {
      setImportResults(result);
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts"],
      });
      toast({
        title: translateNow("toasts.importCompleted"),
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.importFailed2"),
        description: error?.message,
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/companies/${companyId}/customer-contacts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts"],
      });
      setShowAddDialog(false);
      toast({ title: t["customerContacts.contactCreatedSuccessfully"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToCreateContact"),
        description: error?.message,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PUT", `/api/companies/${companyId}/customer-contacts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts"],
      });
      setEditContact(null);
      toast({ title: t["customerContacts.contactUpdatedSuccessfully"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToUpdateContact"),
        description: error?.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/companies/${companyId}/customer-contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts"],
      });
      toast({ title: t["customerContacts.contactDeletedSuccessfully"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToDeleteContact"),
        description: error?.message,
      });
    },
  });

  const { data: clearPreview } = useQuery<{ contactCount: number; linkedInvoiceCount: number }>({
    queryKey: ["/api/companies", companyId, "customer-contacts/clear-preview"],
    enabled: !!companyId && showClearAllDialog,
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/companies/${companyId}/customer-contacts/clear-all`, {
        confirm: "DELETE ALL",
      });
    },
    onSuccess: (result: { deletedCount: number; message: string }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts/clear-preview"],
      });
      setShowClearAllDialog(false);
      setClearAllConfirmation("");
      toast({
        title: translateNow("toasts.allContactsCleared"),
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToClearContacts"),
        description: error?.message,
      });
    },
  });

  const portalLinkMutation = useMutation({
    mutationFn: async ({ contactId, contactName }: { contactId: string; contactName: string }) => {
      const result = await apiRequest("POST", "/api/portal/generate-access", { contactId });
      return { ...result, contactName, contactId };
    },
    onSuccess: (result: any) => {
      const fullUrl = `${window.location.origin}${result.portalUrl}`;
      setPortalLinkDialog({
        open: true,
        url: fullUrl,
        contactName: result.contactName,
        contactId: result.contactId,
        expiresAt: result.expiresAt ?? "",
        ttlDays: result.expiresAt
          ? Math.max(
              1,
              Math.round((new Date(result.expiresAt).getTime() - Date.now()) / 86_400_000)
            )
          : PORTAL_LINK_TTL_DAYS,
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/portal/contacts/${result.contactId}/access`],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToGeneratePortalLink"),
        description: error?.message,
      });
    },
  });

  const revokePortalMutation = useMutation({
    mutationFn: (contactId: string) =>
      apiRequest("POST", "/api/portal/revoke-access", { contactId }),
    onSuccess: (_result, contactId) => {
      queryClient.invalidateQueries({ queryKey: [`/api/portal/contacts/${contactId}/access`] });
      toast({ title: t["customerContacts.accessRevoked"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: t["customerContacts.accessRevokeFailed"],
        description: error?.message,
      });
    },
  });

  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      if (!selectedFile.name.match(/\.(xlsx|csv)$/i)) {
        toast({
          variant: "destructive",
          title: translateNow("toasts.invalidFileType"),
          description: translateNow("toasts.pleaseUploadAnExcelFileXlsxOr"),
        });
        return;
      }

      setFile(selectedFile);
      setPreviewData(null);
      setImportResults(null);

      void (async () => {
        try {
          if (!companyId) throw new Error("Select a company before importing contacts");
          const preview = (await apiRequest(
            "POST",
            `/api/companies/${companyId}/customer-contacts/import-preview`,
            {
              fileName: selectedFile.name,
              contentBase64: await fileToBase64(selectedFile),
            }
          )) as ImportPreview;
          const mappedData = preview.rows;

          setPreviewData(mappedData);
          toast({
            title: formatMessage(translateNow("toasts.foundContactsIn"), {
              count: mappedData.length,
              name: selectedFile.name,
            }),
          });
        } catch (err: any) {
          toast({
            variant: "destructive",
            title: translateNow("toasts.failedToParseFile"),
            description: err?.message,
          });
        }
      })();
    },
    [companyId, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleImport = () => {
    if (previewData) {
      importMutation.mutate(previewData);
    }
  };

  const resetImport = () => {
    setFile(null);
    setPreviewData(null);
    setImportResults(null);
  };

  const downloadTemplate = () => {
    if (!companyId) {
      toast({ variant: "destructive", title: t["customerContacts.selectACompanyFirst"] });
      return;
    }

    void downloadContactTemplate(companyId)
      .then(() => toast({ title: t["customerContacts.templateDownloaded"] }))
      .catch((err: any) =>
        toast({
          variant: "destructive",
          title: translateNow("toasts.failedToCreateTemplate"),
          description: err?.message,
        })
      );
  };

  const filteredContacts = contacts.filter(
    (contact) =>
      contact.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.phone?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["pages.contactsEyebrow"]}
        title={t["pages.contactsTitle"]}
        description={t["pages.contactsDescription"]}
        testId="text-contacts-title"
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t["components.rowMoreActions"]}
                  title={t["components.rowMoreActions"]}
                  data-testid="button-contacts-more"
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem
                  onSelect={() => setBulkInviteOpen(true)}
                  data-testid="button-bulk-portal-invite"
                  disabled={!canDo("documents.write")}
                >
                  <Users aria-hidden />
                  {t["portal.bulk.title"]}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={downloadTemplate}
                  data-testid="button-download-template"
                >
                  <Download aria-hidden />
                  <T k="pageLabels.downloadTemplate" />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    setClearAllConfirmation("");
                    setShowClearAllDialog(true);
                  }}
                  disabled={contacts.length === 0 || !canDo("settings.company")}
                  data-testid="button-clear-all-contacts"
                >
                  <Trash2 aria-hidden />
                  <T k="pageLabels.clearAll" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-contact" {...gate("documents.write")}>
                  <Plus className="w-4 h-4" />
                  <T k="pageLabels.addContact" />
                </Button>
              </DialogTrigger>
              <DialogContent size="md">
                <DialogHeader>
                  <DialogTitle>
                    <T k="pageLabels.addNewContact" />
                  </DialogTitle>
                  <DialogDescription>
                    <T k="pageLabels.addANewCustomerOrBusinessContact" />
                  </DialogDescription>
                </DialogHeader>
                <ContactForm
                  onSubmit={(data) => createMutation.mutate(data)}
                  onCancel={() => setShowAddDialog(false)}
                />
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="list" data-testid="tab-contacts-list">
            <Building2 className="w-4 h-4" />
            {formatMessage(t["pages.contactsTabCount"], { count: contacts.length })}
          </TabsTrigger>
          <TabsTrigger
            value="import"
            data-testid="tab-contacts-import"
            {...gate("documents.write")}
          >
            <Upload className="w-4 h-4" />
            <T k="pageLabels.importFromExcel" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t["pages.contactsSearchPlaceholder"]}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
                data-testid="input-search-contacts"
              />
            </div>
          </div>

          <DataTableCard
            status={isLoading ? "loading" : filteredContacts.length === 0 ? "empty" : "ready"}
            columnLabels={[
              t["pages.contactsColName"],
              t["pages.contactsColEmail"],
              t["pages.contactsColPhone"],
            ]}
            empty={{
              icon: Building2,
              title: searchTerm ? t["pages.contactsNoMatchTitle"] : t["pages.contactsEmptyTitle"],
              description: searchTerm
                ? t["pages.contactsNoMatchBody"]
                : t["pages.contactsEmptyBody"],
              action: searchTerm
                ? undefined
                : {
                    label: t["pages.contactsAddContact"],
                    onClick: () => setShowAddDialog(true),
                    testId: "button-add-first-contact",
                    permission: "documents.write",
                  },
              secondaryAction: searchTerm
                ? { label: t["pages.contactsClearSearch"], onClick: () => setSearchTerm("") }
                : {
                    label: t["pageLabels.importFromExcel"],
                    onClick: () => setActiveTab("import"),
                    permission: "documents.write",
                  },
            }}
          >
            {/* Phones: one two-line row per contact (name + TRN, email · city), actions in ⋯. */}
            <div className="divide-hairline md:hidden" data-testid="mobile-contact-list">
              {filteredContacts.map((contact) => (
                <div key={contact.id} className="flex items-start gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p dir="auto" className="truncate text-sm font-medium text-foreground">
                        {locale === "ar" && contact.nameAr ? contact.nameAr : contact.name}
                      </p>
                      {contact.trnNumber ? (
                        <span
                          dir="ltr"
                          className="shrink-0 text-caption text-muted-foreground [unicode-bidi:isolate]"
                        >
                          {contact.trnNumber}
                        </span>
                      ) : null}
                    </div>
                    {portalSummary[contact.id] ? (
                      <div className="mt-1">
                        <PortalStatusChip
                          entry={portalSummary[contact.id]}
                          contactId={contact.id}
                        />
                      </div>
                    ) : null}
                    <p className="mt-1 truncate text-caption text-muted-foreground">
                      <span dir="ltr" className="[unicode-bidi:isolate]">
                        {contact.email || contact.phone}
                      </span>
                      {contact.city ? ` · ${contact.city}` : ""}
                    </p>
                  </div>
                  <RowActions
                    className="-me-2 -mt-1"
                    menu={
                      <>
                        <DropdownMenuItem onSelect={() => setEditContact(contact)}>
                          <Edit aria-hidden />
                          {t.edit}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            portalLinkMutation.mutate({
                              contactId: contact.id,
                              contactName: contact.name,
                            })
                          }
                        >
                          <Link2 aria-hidden />
                          {t["screens.portalLink"]}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => openInvite(contact)}
                          data-testid={`button-portal-access-${contact.id}`}
                        >
                          <UserPlus aria-hidden />
                          {t["portal.invite.action"]}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setContactToDelete(contact)}
                        >
                          <Trash2 aria-hidden />
                          {t.delete}
                        </DropdownMenuItem>
                      </>
                    }
                  />
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <VirtualTable<CustomerContact>
                rows={filteredContacts}
                height={560}
                estimateRowHeight={44}
                getRowId={(contact) => contact.id}
                rowTestId={(contact) => `row-contact-${contact.id}`}
                columns={[
                  {
                    key: "name",
                    header: t["pages.contactsColName"],
                    width: "minmax(0, 1.4fr)",
                    cell: (contact) => (
                      <span className="flex min-w-0 items-center gap-2">
                        <span dir="auto" className="truncate font-medium text-foreground">
                          {locale === "ar" && contact.nameAr ? contact.nameAr : contact.name}
                        </span>
                        <PortalStatusChip
                          entry={portalSummary[contact.id]}
                          contactId={contact.id}
                        />
                        {/* WQ5: one record, customer and/or supplier. */}
                        {contact.isSupplier && (
                          <Badge
                            variant="outline"
                            className="shrink-0"
                            data-testid="contact-role-badge"
                          >
                            {contact.isCustomer
                              ? t["forms.contact.roleBoth"]
                              : t["forms.contact.roleSupplier"]}
                          </Badge>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: "email",
                    header: t["pages.contactsColEmail"],
                    width: "minmax(0, 1.4fr)",
                    cell: (contact) => (
                      <span
                        dir="ltr"
                        className="block truncate text-muted-foreground [unicode-bidi:isolate]"
                      >
                        {contact.email}
                      </span>
                    ),
                  },
                  {
                    key: "portal",
                    header: t["portal.chip.column"],
                    width: "minmax(0, 0.9fr)",
                    cell: (contact) =>
                      portalSummary[contact.id] ? (
                        <PortalStatusChip
                          entry={portalSummary[contact.id]}
                          contactId={contact.id}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                  {
                    key: "phone",
                    header: t["pages.contactsColPhone"],
                    cell: (contact) =>
                      contact.phone ? (
                        <span
                          dir="ltr"
                          className="whitespace-nowrap text-muted-foreground [unicode-bidi:isolate]"
                        >
                          {contact.phone}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                  {
                    key: "trn",
                    header: t["screens.trn"],
                    cell: (contact) =>
                      contact.trnNumber ? (
                        <span
                          dir="ltr"
                          className="whitespace-nowrap tabular-nums [unicode-bidi:isolate]"
                        >
                          {contact.trnNumber}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                  {
                    key: "location",
                    header: t["pages.contactsColLocation"],
                    cell: (contact) =>
                      contact.city || contact.country ? (
                        <span className="block truncate text-muted-foreground">
                          {[contact.city, contact.country].filter(Boolean).join(", ")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      ),
                  },
                  {
                    key: "actions",
                    header: <span className="sr-only">{t["pages.contactsColActions"]}</span>,
                    width: "80px",
                    cell: (contact) => (
                      <RowActions
                        maxInline={1}
                        menu={
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setContactToDelete(contact)}
                            data-testid={`button-delete-contact-${contact.id}`}
                          >
                            <Trash2 aria-hidden />
                            {t.delete}
                          </DropdownMenuItem>
                        }
                      >
                        <RowActionButton
                          label={t.edit}
                          icon={Edit}
                          onClick={() => setEditContact(contact)}
                          data-testid={`button-edit-contact-${contact.id}`}
                        />
                        <RowActionButton
                          label={t["screens.portalLink"]}
                          icon={Link2}
                          onClick={() =>
                            portalLinkMutation.mutate({
                              contactId: contact.id,
                              contactName: contact.name,
                            })
                          }
                          disabled={portalLinkMutation.isPending}
                          data-testid={`button-portal-link-${contact.id}`}
                        />
                        <RowActionButton
                          label={t["portal.invite.action"]}
                          icon={UserPlus}
                          onClick={() => openInvite(contact)}
                          data-testid={`button-portal-access-${contact.id}`}
                        />
                      </RowActions>
                    ),
                  },
                ]}
              />
            </div>
          </DataTableCard>
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          {!importResults ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5" />
                    <T k="pageLabels.uploadExcelFile" />
                  </CardTitle>
                  <CardDescription>{t["screens.contactsImportHelp"]}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                      isDragOver
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50"
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    data-testid="dropzone-file-upload"
                  >
                    {file ? (
                      <div className="flex flex-col items-center gap-3">
                        <FileSpreadsheet className="w-10 h-10 text-success" />
                        <p className="font-medium">{file.name}</p>
                        <Button variant="outline" size="sm" onClick={resetImport}>
                          <T k="pageLabels.chooseDifferentFile" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <Upload className="w-10 h-10 text-muted-foreground" />
                        <div>
                          <p className="font-medium">
                            <T k="pageLabels.dropYourExcelFileHere" />
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t["screens.orClickToBrowse"]}
                          </p>
                        </div>
                        <input
                          type="file"
                          accept=".xlsx,.csv"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          onChange={(e) =>
                            e.target.files?.[0] && handleFileSelect(e.target.files[0])
                          }
                          data-testid="input-file-upload"
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {previewData && previewData.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {formatMessage(t["screens.contactsPreviewTitle"], {
                        count: previewData.length,
                      })}
                    </CardTitle>
                    <CardDescription>{t["screens.contactsPreviewHelp"]}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t["pages.contactsColName"]}</TableHead>
                            <TableHead>
                              <T k="hr.field.email" />
                            </TableHead>
                            <TableHead>
                              <T k="pages.phone" />
                            </TableHead>
                            <TableHead>{t["screens.trn"]}</TableHead>
                            <TableHead>{t["screens.city"]}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.slice(0, 20).map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell className={!row.name ? "text-destructive" : ""}>
                                {row.name || t["screens.missing"]}
                              </TableCell>
                              <TableCell className={!row.email ? "text-destructive" : ""}>
                                {row.email || t["screens.missing"]}
                              </TableCell>
                              <TableCell>{row.phone || "-"}</TableCell>
                              <TableCell>{row.trnNumber || "-"}</TableCell>
                              <TableCell>{row.city || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {previewData.length > 20 && (
                        <p className="text-center text-sm text-muted-foreground py-2">
                          {formatMessage(t["screens.andMoreContacts"], {
                            count: previewData.length - 20,
                          })}
                        </p>
                      )}
                    </ScrollArea>

                    <div className="flex justify-end gap-2 mt-4">
                      <Button
                        variant="outline"
                        onClick={resetImport}
                        data-testid="button-cancel-import"
                      >
                        <T k="pages.cancel" />
                      </Button>
                      <Button
                        onClick={handleImport}
                        disabled={importMutation.isPending}
                        data-testid="button-confirm-import"
                      >
                        {importMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <T k="pageLabels.importing" />
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            {formatMessage(t["screens.importContactsCount"], {
                              count: previewData.length,
                            })}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <T k="pageLabels.importComplete" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="mobile-keep-cols grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-success/10 rounded-lg">
                    <p className="text-2xl font-bold text-success">{importResults.created}</p>
                    <p className="text-sm text-muted-foreground">
                      <T k="pages.created" />
                    </p>
                  </div>
                  <div className="text-center p-4 bg-info/10 rounded-lg">
                    <p className="text-2xl font-bold text-info">{importResults.updated}</p>
                    <p className="text-sm text-muted-foreground">
                      <T k="pageLabels.updated" />
                    </p>
                  </div>
                  <div className="text-center p-4 bg-warning/10 rounded-lg">
                    <p className="text-2xl font-bold text-warning">{importResults.skipped}</p>
                    <p className="text-sm text-muted-foreground">
                      <T k="pageLabels.skipped" />
                    </p>
                  </div>
                </div>

                {importResults.errors.length > 0 && (
                  <div className="border border-destructive/50 rounded-lg p-4">
                    <p className="font-medium text-destructive flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4" />
                      {formatMessage(t["screens.errorsCount"], {
                        count: importResults.errors.length,
                      })}
                    </p>
                    <ScrollArea className="h-[100px]">
                      <ul className="text-sm space-y-1">
                        {importResults.errors.map((err, idx) => (
                          <li key={idx} className="text-muted-foreground">
                            {err}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      resetImport();
                      setActiveTab("list");
                    }}
                    data-testid="button-view-contacts"
                  >
                    <T k="pageLabels.viewContacts" />
                  </Button>
                  <Button onClick={resetImport} data-testid="button-import-more">
                    <T k="pageLabels.importMore" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editContact} onOpenChange={(open) => !open && setEditContact(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.editContact" />
            </DialogTitle>
            <DialogDescription>
              <T k="pageLabels.updateCustomerContactInformation" />
            </DialogDescription>
          </DialogHeader>
          {editContact && (
            <ContactForm
              contact={editContact}
              onSubmit={(data) => updateMutation.mutate({ id: editContact.id, data })}
              onCancel={() => setEditContact(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <PortalAccessSheet
        open={!!inviteContact}
        onOpenChange={(o) => !o && setInviteContact(null)}
        companyId={companyId ?? ""}
        supplierName={company?.name ?? ""}
        contact={inviteContact}
        onManageLinks={() => {
          if (!inviteContact) return;
          setPortalLinkDialog({
            ...closedPortalDialog,
            open: true,
            contactId: inviteContact.id,
            contactName: inviteContact.name,
          });
          setInviteContact(null);
        }}
      />
      <BulkPortalInviteDialog
        open={bulkInviteOpen}
        onOpenChange={setBulkInviteOpen}
        companyId={companyId ?? ""}
        contacts={contacts
          .filter((c) => c.isCustomer !== false)
          .map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email ?? null,
            contactPerson: c.contactPerson ?? null,
            preferredLanguage: c.preferredLanguage ?? null,
          }))}
        summary={portalSummary}
      />

      {/* Portal Link Dialog */}
      <Dialog
        open={portalLinkDialog.open}
        onOpenChange={(open) => !open && setPortalLinkDialog(closedPortalDialog)}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              <T k="pageLabels.clientPortalLink" />
            </DialogTitle>
            <DialogDescription>
              {portalLinkDialog.url
                ? formatMessage(t["portal.access.shareLinkDialog"], {
                    name: portalLinkDialog.contactName,
                  })
                : formatMessage(t["customerContacts.portalAccessFor"], {
                    name: portalLinkDialog.contactName,
                  })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {portalLinkDialog.url && (
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={portalLinkDialog.url}
                  className="text-sm"
                  data-testid="input-portal-link"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(portalLinkDialog.url);
                    toast({ title: t["customerContacts.linkCopiedToClipboard"] });
                  }}
                  data-testid="button-copy-portal-link"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            )}
            {portalLinkDialog.url && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.open(portalLinkDialog.url, "_blank")}
                  data-testid="button-open-portal"
                >
                  <ExternalLink className="w-4 h-4" />
                  <T k="pageLabels.openPortal" />
                </Button>
              </div>
            )}
            {portalLinkDialog.url && (
              <p className="text-xs text-muted-foreground" data-testid="text-portal-link-validity">
                {formatMessage(t["customerContacts.linkValidUntil"], {
                  days: portalLinkDialog.ttlDays || PORTAL_LINK_TTL_DAYS,
                  date: portalLinkDialog.expiresAt
                    ? formatDate(portalLinkDialog.expiresAt, locale)
                    : "",
                })}
              </p>
            )}
            <section aria-labelledby="portal-access-heading" className="space-y-2 border-t pt-4">
              <h4 id="portal-access-heading" className="text-sm font-medium">
                {t["customerContacts.portalAccess"]}
              </h4>
              {(portalAccess?.links ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="text-portal-links-empty">
                  {t["customerContacts.portalLinksEmpty"]}
                </p>
              ) : (
                <ul className="space-y-2" data-testid="list-portal-links">
                  {(portalAccess?.links ?? []).map((link) => {
                    const state = link.state;
                    return (
                      <li
                        key={link.id}
                        className="flex items-center justify-between gap-3 text-xs"
                        data-testid={`row-portal-link-${link.id}`}
                      >
                        <span className="min-w-0">
                          <Badge variant={state === "active" ? "default" : "secondary"}>
                            {state === "active"
                              ? t["customerContacts.portalLinkActive"]
                              : state === "expired"
                                ? t["customerContacts.portalLinkExpired"]
                                : t["customerContacts.portalLinkRevoked"]}
                          </Badge>
                          <span className="ms-2 text-muted-foreground">
                            {formatMessage(t["customerContacts.portalLinkExpires"], {
                              date: formatDate(link.expiresAt, locale),
                            })}
                            {" · "}
                            {link.lastUsedAt
                              ? formatMessage(t["customerContacts.portalLinkLastUsed"], {
                                  date: formatDate(link.lastUsedAt, locale),
                                })
                              : t["customerContacts.portalLinkNeverUsed"]}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {activePortalLinks.length > 0 && (
                // E3 (J4-r3): the app's confirm dialog, not the browser's native confirm().
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={revokePortalMutation.isPending}
                      data-testid="button-revoke-portal-access"
                      {...(canManagePortal ? {} : gate("documents.write"))}
                    >
                      {t["customerContacts.revokeAccess"]}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t["customerContacts.revokeAccess"]}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t["customerContacts.revokeAccessConfirm"]}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t["common.cancel"]}</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => revokePortalMutation.mutate(portalLinkDialog.contactId)}
                        data-testid="button-confirm-revoke-portal-access"
                      >
                        {t["customerContacts.revokeAccess"]}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showClearAllDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowClearAllDialog(false);
            setClearAllConfirmation("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <T k="pageLabels.deleteALLContacts" />
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  This will permanently delete{" "}
                  <strong>
                    {clearPreview?.contactCount ?? contacts.length} contact
                    {(clearPreview?.contactCount ?? contacts.length) === 1 ? "" : "s"}
                  </strong>{" "}
                  for this company. This action cannot be undone.
                </p>
                {clearPreview && clearPreview.linkedInvoiceCount > 0 && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                    <p className="font-medium text-destructive">
                      {clearPreview.linkedInvoiceCount} invoice
                      {clearPreview.linkedInvoiceCount === 1 ? " is" : "s are"} linked to these
                      contacts.
                    </p>
                    <p className="text-muted-foreground mt-1">
                      {t["customerContacts.invoicesWillBeKeptBut"]}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="clear-all-confirm">
                    <T k="consolidation.kind" />
                    <strong>
                      <T k="pageLabels.dELETEALL" />
                    </strong>{" "}
                    to confirm:
                  </Label>
                  <Input
                    id="clear-all-confirm"
                    value={clearAllConfirmation}
                    onChange={(e) => setClearAllConfirmation(e.target.value)}
                    placeholder="DELETE ALL"
                    autoComplete="off"
                    data-testid="input-clear-all-confirm"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-all">
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearAllMutation.mutate();
              }}
              disabled={clearAllConfirmation !== "DELETE ALL" || clearAllMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-clear-all"
            >
              {clearAllMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <T k="pageLabels.deleting" />
                </>
              ) : (
                "Delete all contacts"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!contactToDelete}
        onOpenChange={(open) => {
          if (!open) setContactToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="pageLabels.deleteContact" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T k="pageLabels.areYouSureYouWantToDelete" />
              <strong>{contactToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (contactToDelete) {
                  deleteMutation.mutate(contactToDelete.id);
                  setContactToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="hr.delete" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
