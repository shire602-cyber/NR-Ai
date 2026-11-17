import { T } from "@/components/layout/T";
import {
  ErrorSummary,
  Field,
  FormActions,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { useFormGate } from "@/hooks/use-form-gate";
import { formatMessage, useTranslation } from "@/lib/i18n";
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
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import type { CustomerContact } from "@shared/schema";

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

const CONTACT_EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

function ContactForm({
  contact,
  onSubmit,
  onCancel,
}: {
  contact?: CustomerContact | null;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: contact?.name || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    trnNumber: contact?.trnNumber || "",
    address: contact?.address || "",
    city: contact?.city || "",
    country: contact?.country || t["pageLabels.countryUaeName"],
    // R03-10: invoices to this contact default their place of supply and due date from here.
    emirate: contact?.emirate || "",
    paymentTerms: contact?.paymentTerms ?? 30,
  });
  const idp = contact ? `contact-${contact.id}` : "contact-new";
  const gate = useFormGate([
    { id: `${idp}-name`, label: t["forms.contact.name"], invalid: !formData.name },
    { id: `${idp}-email`, label: t["forms.contact.email"], invalid: !formData.email },
  ]);

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!gate.attempt()) return;
        onSubmit({ ...formData, emirate: formData.emirate || null });
      }}
    >
      <ErrorSummary items={gate.summary} />
      <FormSection title={t["forms.section.contact"]}>
        <FormGrid>
          <Field
            id={`${idp}-name`}
            label={t["forms.contact.name"]}
            required
            error={gate.errorFor(`${idp}-name`)}
            className={formSpanFull}
          >
            <Input
              dir="auto"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t["forms.contact.namePlaceholder"]}
              data-testid="input-contact-name"
            />
          </Field>
          <Field
            id={`${idp}-email`}
            label={t["forms.contact.email"]}
            required
            error={gate.errorFor(`${idp}-email`)}
          >
            <Input
              type="email"
              autoComplete="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="email@example.com"
              data-testid="input-contact-email"
            />
          </Field>
          <Field id={`${idp}-phone`} label={<T k="pages.phone" />}>
            <Input
              type="tel"
              autoComplete="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+971 50 000 0000"
              data-testid="input-contact-phone"
            />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={t["forms.section.tax"]} description={t["forms.section.taxDesc"]}>
        <FormGrid>
          <Field
            id={`${idp}-trn`}
            label={<T k="pageLabels.tRNNumber" />}
            help={t["forms.contact.trnHelp"]}
          >
            <Input
              ltr
              inputMode="numeric"
              value={formData.trnNumber}
              onChange={(e) => setFormData({ ...formData, trnNumber: e.target.value })}
              placeholder="100XXXXXXXXX003"
              data-testid="input-contact-trn"
            />
          </Field>
          <Field
            id={`${idp}-emirate`}
            label={t["invoices.placeOfSupply"]}
            help={t["forms.contact.emirateHelp"]}
          >
            <select
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
              value={formData.emirate}
              onChange={(e) => setFormData({ ...formData, emirate: e.target.value })}
              data-testid="select-contact-emirate"
            >
              <option value="">{t["invoices.placeOfSupplyDefault"]}</option>
              {CONTACT_EMIRATES.map((e) => (
                <option key={e} value={e}>
                  {t[`invoices.emirate.${e}`]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={`${idp}-terms`}
            label={t["invoices.contactPaymentTermsDays"]}
            help={t["forms.contact.termsHelp"]}
          >
            <Input
              type="number"
              min={0}
              max={365}
              value={formData.paymentTerms}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  paymentTerms: Math.max(0, Number(e.target.value) || 0),
                })
              }
              data-testid="input-contact-payment-terms"
            />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={t["forms.section.address"]}>
        <FormGrid>
          <Field
            id={`${idp}-address`}
            label={<T k="pageLabels.address" />}
            className={formSpanFull}
          >
            <Input
              dir="auto"
              autoComplete="street-address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder={t["forms.contact.streetPlaceholder"]}
              data-testid="input-contact-address"
            />
          </Field>
          <Field id={`${idp}-city`} label={t["forms.contact.city"]}>
            <Input
              dir="auto"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              placeholder={t["forms.contact.cityPlaceholder"]}
              data-testid="input-contact-city"
            />
          </Field>
          <Field id={`${idp}-country`} label={<T k="pageLabels.country" />}>
            <Input
              dir="auto"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              placeholder={t["pageLabels.countryUaeName"]}
              data-testid="input-contact-country"
            />
          </Field>
        </FormGrid>
      </FormSection>

      <FormActions sticky>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          data-testid="button-cancel-contact"
        >
          <T k="pages.cancel" />
        </Button>
        <Button type="submit" className="sm:min-w-32" data-testid="button-save-contact">
          {contact ? t["forms.contact.update"] : t["forms.contact.create"]}
        </Button>
      </FormActions>
    </form>
  );
}

export default function CustomerContacts() {
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const { companyId, isLoading: _isLoadingCompany } = useDefaultCompany();

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
  }>({ open: false, url: "", contactName: "" });
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
        title: "Import completed!",
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Import failed", description: error?.message });
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
        title: "Failed to create contact",
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
        title: "Failed to update contact",
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
        title: "Failed to delete contact",
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
        title: "All contacts cleared",
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to clear contacts",
        description: error?.message,
      });
    },
  });

  const portalLinkMutation = useMutation({
    mutationFn: async ({ contactId, contactName }: { contactId: string; contactName: string }) => {
      const result = await apiRequest("POST", "/api/portal/generate-access", { contactId });
      return { ...result, contactName };
    },
    onSuccess: (result: any) => {
      const fullUrl = `${window.location.origin}${result.portalUrl}`;
      setPortalLinkDialog({ open: true, url: fullUrl, contactName: result.contactName });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to generate portal link",
        description: error?.message,
      });
    },
  });

  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      if (!selectedFile.name.match(/\.(xlsx|csv)$/i)) {
        toast({
          variant: "destructive",
          title: "Invalid file type",
          description: "Please upload an Excel file (.xlsx) or CSV file",
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
          toast({ title: `Found ${mappedData.length} contacts in ${selectedFile.name}` });
        } catch (err: any) {
          toast({
            variant: "destructive",
            title: "Failed to parse file",
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
          title: "Failed to create template",
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
                  disabled={contacts.length === 0}
                  data-testid="button-clear-all-contacts"
                >
                  <Trash2 aria-hidden />
                  <T k="pageLabels.clearAll" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-contact">
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
          <TabsTrigger value="import" data-testid="tab-contacts-import">
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
                  },
              secondaryAction: searchTerm
                ? { label: t["pages.contactsClearSearch"], onClick: () => setSearchTerm("") }
                : {
                    label: t["pageLabels.importFromExcel"],
                    onClick: () => setActiveTab("import"),
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
                      <span dir="auto" className="block truncate font-medium text-foreground">
                        {locale === "ar" && contact.nameAr ? contact.nameAr : contact.name}
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
                    width: "112px",
                    cell: (contact) => (
                      <RowActions
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
                          label={t.edit}
                          icon={Edit}
                          onClick={() => setEditContact(contact)}
                          data-testid={`button-edit-contact-${contact.id}`}
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

      {/* Portal Link Dialog */}
      <Dialog
        open={portalLinkDialog.open}
        onOpenChange={(open) =>
          !open && setPortalLinkDialog({ open: false, url: "", contactName: "" })
        }
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              <T k="pageLabels.clientPortalLink" />
            </DialogTitle>
            <DialogDescription>
              Share this link with {portalLinkDialog.contactName} to give them access to view their
              invoices and download PDFs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
            <p className="text-xs text-muted-foreground">
              {t["customerContacts.thisLinkIsValidFor"]}
            </p>
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
