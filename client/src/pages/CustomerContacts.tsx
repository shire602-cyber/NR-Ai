import { useState, useCallback } from "react";
import { messages as iconLabels } from "@/components/ui/button.i18n";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload,
  FileSpreadsheet,
  Download,
  Plus,
  Search,
  Loader2,
  Mail,
  Phone,
  Building2,
  MapPin,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Link2,
  Copy,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Wallet,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { VirtualTable, type VirtualTableColumn } from "@/components/VirtualTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { CustomerStatementDialog } from "@/components/CustomerStatementDialog";
import { CustomerCreditDialog } from "@/components/sales/CustomerCreditDialog";
import { VendorStatementDialog } from "@/components/VendorStatementDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { messages as pageMessages } from "./CustomerContacts.i18n";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { CustomFieldsEditor } from "@/components/sales/CustomFieldsEditor";
import { useCustomFieldDraft } from "@/components/sales/useCustomFieldDraft";
import { salesErrorMessage, salesKeys, type PriceListSummary } from "@/lib/sales-api";

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

function ContactForm({
  contact,
  onSubmit,
  onCancel,
}: {
  contact?: CustomerContact | null;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const tr = pageMessages.useT();
  const salesTr = salesMessages.useT();
  const { companyId: formCompanyId } = useDefaultCompany();
  const customFieldDraft = useCustomFieldDraft(formCompanyId, "contact", contact?.id);
  const { data: priceLists = [] } = useQuery<PriceListSummary[]>({
    queryKey: salesKeys.priceLists(formCompanyId),
    enabled: !!formCompanyId,
  });
  const [priceListId, setPriceListId] = useState<string>((contact as { priceListId?: string | null } | null | undefined)?.priceListId ?? "");

  const [formData, setFormData] = useState({
    name: contact?.name || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    trnNumber: contact?.trnNumber || "",
    address: contact?.address || "",
    city: contact?.city || "",
    country: contact?.country || "UAE",
    contactType: ((contact as { contactType?: string } | null | undefined)?.contactType as string) || "customer",
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{tr("name")}</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={tr("companyOrContactName")}
            data-testid="input-contact-name"
          />
        </div>
        <div className="space-y-2">
          <Label>{tr("email")}</Label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="email@example.com"
            data-testid="input-contact-email"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{tr("phone")}</Label>
          <Input
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="+971-50-XXX-XXXX"
            data-testid="input-contact-phone"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{tr("trnNumber")}</Label>
          <Input
            value={formData.trnNumber}
            onChange={(e) => setFormData({ ...formData, trnNumber: e.target.value })}
            placeholder={tr("n100xxxxxxxxx003")}
            data-testid="input-contact-trn"
          />
        </div>
        <div className="space-y-2">
          <Label>{tr("contactType")}</Label>
          <Select value={formData.contactType} onValueChange={(v) => setFormData({ ...formData, contactType: v })}>
            <SelectTrigger data-testid="select-contact-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customer">{tr("typeCustomer")}</SelectItem>
              <SelectItem value="vendor">{tr("typeVendor")}</SelectItem>
              <SelectItem value="both">{tr("typeBoth")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>{tr("address")}</Label>
        <Input
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          placeholder={tr("streetAddress")}
          data-testid="input-contact-address"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{tr("city")}</Label>
          <Input
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            placeholder="Dubai"
            data-testid="input-contact-city"
          />
        </div>
        <div className="space-y-2">
          <Label>{tr("country")}</Label>
          <Input
            value={formData.country}
            onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            placeholder="UAE"
            data-testid="input-contact-country"
          />
        </div>
      </div>
      {priceLists.length > 0 && (
        <div className="space-y-2">
          <Label>{salesTr("contactPriceList")}</Label>
          <Select value={priceListId || "__none__"} onValueChange={(v) => setPriceListId(v === "__none__" ? "" : v)}>
            <SelectTrigger data-testid="select-contact-price-list">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{salesTr("contactNoPriceList")}</SelectItem>
              {priceLists
                .filter((l) => l.isActive || l.id === priceListId)
                .map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} ({l.currency})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{salesTr("contactPriceListHelp")}</p>
        </div>
      )}
      <CustomFieldsEditor draft={customFieldDraft} />
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-contact">
          {tr("cancel")}
        </Button>
        <Button
          onClick={() =>
            onSubmit({
              ...formData,
              priceListId: priceListId || null,
              __saveCustomFields: customFieldDraft.dirty ? customFieldDraft.save : undefined,
            })
          }
          disabled={!formData.name || (formData.contactType !== "vendor" && !formData.email)}
          data-testid="button-save-contact"
        >
          {contact ? tr("update") : tr("create")} {tr("contact")}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function CustomerContacts() {
  const tr = pageMessages.useT();
  const salesTr = salesMessages.useT();

  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("list");
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [importResults, setImportResults] = useState<ImportResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editContact, setEditContact] = useState<CustomerContact | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  // a new key per opening gives the form fresh state, so nothing typed for the previous contact is still there
  const [addFormKey, setAddFormKey] = useState(0);
  const [statementContact, setStatementContact] = useState<CustomerContact | null>(null);
  const [creditContact, setCreditContact] = useState<CustomerContact | null>(null);
  const [vendorStatementContact, setVendorStatementContact] = useState<CustomerContact | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "customer" | "vendor">("all");
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
        title: tr("importCompleted"),
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: tr("importFailed"), description: error?.message });
    },
  });

  // The contact is saved by now; a custom field the server refuses is reported, not lost silently.
  const saveContactCustomFields = async (save: ((id: string) => Promise<void>) | undefined, id: string | undefined) => {
    if (!save || !id) return;
    try {
      await save(id);
    } catch (error: any) {
      toast({ variant: "destructive", title: salesMessages.t("customFieldsNotSaved"), description: salesErrorMessage(error, (k) => salesMessages.t(k), salesMessages.t("pleaseTryAgain")) });
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const { __saveCustomFields, ...body } = data;
      const saved = await apiRequest("POST", `/api/companies/${companyId}/customer-contacts`, body);
      await saveContactCustomFields(__saveCustomFields, saved?.id);
      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts"],
      });
      setShowAddDialog(false);
      toast({ title: tr("contactCreatedSuccessfully") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateContact"),
        description: error?.message,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { __saveCustomFields, ...body } = data;
      const saved = await apiRequest("PUT", `/api/companies/${companyId}/customer-contacts/${id}`, body);
      await saveContactCustomFields(__saveCustomFields, id);
      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "customer-contacts"],
      });
      setEditContact(null);
      toast({ title: tr("contactUpdatedSuccessfully") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateContact"),
        description: error?.code === "CONTACT_TYPE_IN_USE" ? tr("typeInUse") : error?.message,
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
      toast({ title: tr("contactDeletedSuccessfully") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeleteContact"),
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
        title: tr("allContactsCleared"),
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToClearContacts"),
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
        title: tr("failedToGeneratePortalLink"),
        description: error?.message,
      });
    },
  });

  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      if (!selectedFile.name.match(/\.(xlsx|csv)$/i)) {
        toast({
          variant: "destructive",
          title: tr("invalidFileType"),
          description: tr("pleaseUploadAnExcelFileXlsx"),
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
            title: tr("foundContactsIn", {
              mappedDataCount: mappedData.length,
              name: selectedFile.name,
            }),
          });
        } catch (err: any) {
          toast({
            variant: "destructive",
            title: tr("failedToParseFile"),
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
      toast({ variant: "destructive", title: tr("selectACompanyFirst") });
      return;
    }

    void downloadContactTemplate(companyId)
      .then(() => toast({ title: tr("templateDownloaded") }))
      .catch((err: any) =>
        toast({
          variant: "destructive",
          title: tr("failedToCreateTemplate"),
          description: err?.message,
        })
      );
  };

  const typeOf = (contact: CustomerContact): "customer" | "vendor" | "both" =>
    ((contact as { contactType?: string }).contactType as "customer" | "vendor" | "both") || "customer";
  const filteredContacts = contacts.filter(
    (contact) =>
      (typeFilter === "all" || typeOf(contact) === "both" || typeOf(contact) === typeFilter) &&
      (contact.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.phone?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("sales")}
        title={tr("customerContacts")}
        description={tr("manageYourCustomersAndBusinessContacts")}
        testId="text-contacts-title"
        actions={
          <>
            {/* The destructive "Clear all" lives in a menu, away from the everyday buttons. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label={salesTr("moreActions")} data-testid="button-contacts-more">
                  <MoreHorizontal className="w-4 h-4 me-2" />
                  {salesTr("moreActions")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={downloadTemplate} data-testid="button-download-template">
                  <Download className="w-4 h-4 me-2" />
                  {tr("downloadTemplate")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={contacts.length === 0}
                  onClick={() => {
                    setClearAllConfirmation("");
                    setShowClearAllDialog(true);
                  }}
                  data-testid="button-clear-all-contacts"
                >
                  <Trash2 className="w-4 h-4 me-2" />
                  {tr("clearAll")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog
              open={showAddDialog}
              onOpenChange={(open) => {
                if (open) setAddFormKey((k) => k + 1);
                setShowAddDialog(open);
              }}
            >
              <DialogTrigger asChild>
                <Button data-testid="button-add-contact">
                  <Plus className="w-4 h-4 me-2" />
                  {tr("addContact")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>{tr("addNewContact")}</DialogTitle>
                  <DialogDescription>{tr("addANewCustomerOrBusiness")}</DialogDescription>
                </DialogHeader>
                <ContactForm
                  key={addFormKey}
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
            <Building2 className="w-4 h-4 me-2" />
            {tr("contacts", { contactsCount: contacts.length })}
          </TabsTrigger>
          <TabsTrigger value="import" data-testid="tab-contacts-import">
            <Upload className="w-4 h-4 me-2" />
            {tr("importFromExcel")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={tr("searchContacts")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10"
                data-testid="input-search-contacts"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | "customer" | "vendor")}>
              <SelectTrigger className="w-[200px]" aria-label={tr("filterByType")} data-testid="select-contact-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("typeAll")}</SelectItem>
                <SelectItem value="customer">{tr("typeCustomer")}</SelectItem>
                <SelectItem value="vendor">{tr("typeVendor")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4">
                  <TableSkeleton rows={6} columns={6} />
                </div>
              ) : filteredContacts.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title={searchTerm ? tr("noMatchingContacts") : tr("noContactsYet")}
                  description={
                    searchTerm ? tr("tryADifferentSearchTermOr") : tr("addYourFirstContactOrImport")
                  }
                  action={
                    searchTerm
                      ? undefined
                      : {
                          label: tr("addContact2"),
                          onClick: () => setShowAddDialog(true),
                          testId: "button-add-first-contact",
                        }
                  }
                  secondaryAction={
                    searchTerm
                      ? { label: tr("clearSearch"), onClick: () => setSearchTerm("") }
                      : { label: tr("importFromExcel"), onClick: () => setActiveTab("import") }
                  }
                />
              ) : (
                <>
                <div className="grid gap-3 md:hidden" data-testid="mobile-contact-cards">
                  {filteredContacts.map((contact) => (
                    <div key={contact.id} className="space-y-2 rounded-lg border p-3" data-testid={`card-contact-${contact.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{contact.name}</p>
                          {contact.email && <p className="truncate text-sm text-muted-foreground" dir="ltr">{contact.email}</p>}
                          {contact.phone && <p className="text-sm text-muted-foreground" dir="ltr">{contact.phone}</p>}
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {typeOf(contact) === "vendor" ? tr("typeVendor") : typeOf(contact) === "both" ? tr("typeBoth") : tr("typeCustomer")}
                        </Badge>
                      </div>
                      {(contact.trnNumber || contact.city || contact.country) && (
                        <dl className="space-y-0.5 text-xs">
                          {contact.trnNumber && (
                            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("trnNumber")}</dt><dd dir="ltr" className="font-mono">{contact.trnNumber}</dd></div>
                          )}
                          {(contact.city || contact.country) && (
                            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("location")}</dt><dd>{[contact.city, contact.country].filter(Boolean).join(", ")}</dd></div>
                          )}
                        </dl>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {typeOf(contact) !== "vendor" && (
                          <Button size="sm" variant="outline" onClick={() => setStatementContact(contact)} data-testid={`mobile-button-statement-${contact.id}`}>
                            <FileText className="w-4 h-4 me-1" />
                            {tr("statement")}
                          </Button>
                        )}
                        {typeOf(contact) !== "vendor" && (
                          <Button size="sm" variant="outline" onClick={() => setCreditContact(contact)} data-testid={`mobile-button-credit-${contact.id}`}>
                            <Wallet className="w-4 h-4 me-1" />
                            {salesTr("customerCreditAction")}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEditContact(contact)} data-testid={`mobile-button-edit-contact-${contact.id}`}>
                          <Edit className="w-4 h-4 me-1" />
                          {iconLabels.t("edit")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setContactToDelete(contact)} aria-label={iconLabels.t("delete")} data-testid={`mobile-button-delete-contact-${contact.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden md:block">
                <VirtualTable<CustomerContact>
                  rows={filteredContacts}
                  height={500}
                  estimateRowHeight={56}
                  getRowId={(contact) => contact.id}
                  rowTestId={(contact) => `row-contact-${contact.id}`}
                  columns={[
                    {
                      key: "name",
                      header: tr("name2"),
                      cell: (contact) => (
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{contact.name}</span>
                        </div>
                      ),
                    },
                    {
                      key: "type",
                      header: tr("typeColumn"),
                      cell: (contact) => (
                        <Badge variant={typeOf(contact) === "customer" ? "outline" : "secondary"} data-testid={`badge-contact-type-${contact.id}`}>
                          {typeOf(contact) === "vendor" ? tr("typeVendor") : typeOf(contact) === "both" ? tr("typeBoth") : tr("typeCustomer")}
                        </Badge>
                      ),
                    },
                    {
                      key: "email",
                      header: tr("email2"),
                      cell: (contact) => (
                        <div className="flex items-center gap-2 truncate">
                          <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{contact.email}</span>
                        </div>
                      ),
                    },
                    {
                      key: "phone",
                      header: tr("phone"),
                      cell: (contact) =>
                        contact.phone ? (
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            {contact.phone}
                          </div>
                        ) : null,
                    },
                    {
                      key: "trn",
                      header: tr("trn"),
                      cell: (contact) =>
                        contact.trnNumber ? (
                          <Badge variant="outline">{contact.trnNumber}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        ),
                    },
                    {
                      key: "location",
                      header: tr("location"),
                      cell: (contact) =>
                        contact.city || contact.country ? (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            {[contact.city, contact.country].filter(Boolean).join(", ")}
                          </div>
                        ) : null,
                    },
                    {
                      key: "actions",
                      header: tr("actions"),
                      width: "210px",
                      cell: (contact) => (
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={tr("generatePortalLink")}
                            onClick={() =>
                              portalLinkMutation.mutate({
                                contactId: contact.id,
                                contactName: contact.name,
                              })
                            }
                            disabled={portalLinkMutation.isPending}
                            data-testid={`button-portal-link-${contact.id}`}
                          >
                            <Link2 className="w-4 h-4" />
                          </Button>
                          {typeOf(contact) !== "vendor" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title={tr("statement")}
                              onClick={() => setStatementContact(contact)}
                              data-testid={`button-statement-${contact.id}`}
                            >
                              <FileText className="w-4 h-4" />
                            </Button>
                          )}
                          {typeOf(contact) !== "vendor" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title={salesTr("customerCreditAction")}
                              aria-label={salesTr("customerCreditAction")}
                              onClick={() => setCreditContact(contact)}
                              data-testid={`button-credit-${contact.id}`}
                            >
                              <Wallet className="w-4 h-4" />
                            </Button>
                          )}
                          {typeOf(contact) !== "customer" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title={tr("vendorStatement")}
                              onClick={() => setVendorStatementContact(contact)}
                              data-testid={`button-vendor-statement-${contact.id}`}
                            >
                              <FileText className="w-4 h-4 text-info" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditContact(contact)}
                            aria-label={iconLabels.t("edit")}
                            data-testid={`button-edit-contact-${contact.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setContactToDelete(contact)}
                            aria-label={iconLabels.t("delete")}
                            data-testid={`button-delete-contact-${contact.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
                </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          {!importResults ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5" />
                    {tr("uploadExcelFile")}
                  </CardTitle>
                  <CardDescription>{tr("uploadAnExcelFileXlsxOr")}</CardDescription>
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
                          {tr("chooseDifferentFile")}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <Upload className="w-10 h-10 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{tr("dropYourExcelFileHere")}</p>
                          <p className="text-sm text-muted-foreground">{tr("orClickToBrowse")}</p>
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
                      {tr("previewContacts", { previewDataCount: previewData.length })}
                    </CardTitle>
                    <CardDescription>{tr("reviewTheDataBeforeImportingContacts")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("name2")}</TableHead>
                            <TableHead>{tr("email2")}</TableHead>
                            <TableHead>{tr("phone")}</TableHead>
                            <TableHead>{tr("trn")}</TableHead>
                            <TableHead>{tr("city")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.slice(0, 20).map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell className={!row.name ? "text-destructive" : ""}>
                                {row.name || tr("missing")}
                              </TableCell>
                              <TableCell className={!row.email ? "text-destructive" : ""}>
                                {row.email || tr("missing")}
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
                          {tr("andMoreContacts", { value: previewData.length - 20 })}
                        </p>
                      )}
                    </ScrollArea>

                    <div className="flex justify-end gap-2 mt-4">
                      <Button
                        variant="outline"
                        onClick={resetImport}
                        data-testid="button-cancel-import"
                      >
                        {tr("cancel")}
                      </Button>
                      <Button
                        onClick={handleImport}
                        disabled={importMutation.isPending}
                        data-testid="button-confirm-import"
                      >
                        {importMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 me-2 animate-spin" />
                            {tr("importing")}
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 me-2" />
                            {tr("importContacts", { previewDataCount: previewData.length })}
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
                  {tr("importComplete")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-success/10 rounded-lg">
                    <p className="text-2xl font-bold text-success">{importResults.created}</p>
                    <p className="text-sm text-muted-foreground">{tr("created")}</p>
                  </div>
                  <div className="text-center p-4 bg-info/10 rounded-lg">
                    <p className="text-2xl font-bold text-info">{importResults.updated}</p>
                    <p className="text-sm text-muted-foreground">{tr("updated")}</p>
                  </div>
                  <div className="text-center p-4 bg-warning/10 rounded-lg">
                    <p className="text-2xl font-bold text-warning">{importResults.skipped}</p>
                    <p className="text-sm text-muted-foreground">{tr("skipped")}</p>
                  </div>
                </div>

                {importResults.errors.length > 0 && (
                  <div className="border border-destructive/50 rounded-lg p-4">
                    <p className="font-medium text-destructive flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4" />
                      {tr("errors", { errorsCount: importResults.errors.length })}
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
                    {tr("viewContacts")}
                  </Button>
                  <Button onClick={resetImport} data-testid="button-import-more">
                    {tr("importMore")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editContact} onOpenChange={(open) => !open && setEditContact(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{tr("editContact")}</DialogTitle>
            <DialogDescription>{tr("updateCustomerContactInformation")}</DialogDescription>
          </DialogHeader>
          {editContact && (
            <ContactForm
              key={editContact.id}
              contact={editContact}
              onSubmit={(data) => updateMutation.mutate({ id: editContact.id, data })}
              onCancel={() => setEditContact(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {companyId && (
        <CustomerCreditDialog companyId={companyId} contact={creditContact} onClose={() => setCreditContact(null)} />
      )}

      {companyId && (
        <CustomerStatementDialog
          companyId={companyId}
          contact={statementContact}
          onClose={() => setStatementContact(null)}
        />
      )}

      {companyId && (
        <VendorStatementDialog
          companyId={companyId}
          contact={vendorStatementContact}
          onClose={() => setVendorStatementContact(null)}
        />
      )}

      {/* Portal Link Dialog */}
      <Dialog
        open={portalLinkDialog.open}
        onOpenChange={(open) =>
          !open && setPortalLinkDialog({ open: false, url: "", contactName: "" })
        }
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              {tr("clientPortalLink")}
            </DialogTitle>
            <DialogDescription>
              {tr("shareThisLinkWithToGive", { contactName: portalLinkDialog.contactName })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={portalLinkDialog.url}
                className="font-mono text-sm"
                data-testid="input-portal-link"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(portalLinkDialog.url);
                  toast({ title: tr("linkCopiedToClipboard") });
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
                <ExternalLink className="w-4 h-4 me-2" />
                {tr("openPortal")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{tr("thisLinkIsValidFor1")}</p>
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
              {tr("deleteAllContacts")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  {tr("thisWillPermanentlyDelete")}
                  <strong>
                    {tr.plural("contactsCount", clearPreview?.contactCount ?? contacts.length)}
                  </strong>{" "}
                  {tr("forThisCompanyThisActionCannot")}
                </p>
                {clearPreview && clearPreview.linkedInvoiceCount > 0 && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                    <p className="font-medium text-destructive">
                      {tr.plural("invoicesLinkedToTheseContacts", clearPreview.linkedInvoiceCount)}
                    </p>
                    <p className="text-muted-foreground mt-1">{tr("invoicesWillBeKeptButTheir")}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="clear-all-confirm">
                    {tr("type")} <strong>{tr("deleteAll")}</strong> {tr("toConfirm")}
                  </Label>
                  <Input
                    id="clear-all-confirm"
                    value={clearAllConfirmation}
                    onChange={(e) => setClearAllConfirmation(e.target.value)}
                    placeholder={tr("deleteAll")}
                    autoComplete="off"
                    data-testid="input-clear-all-confirm"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-all">
              {tr("cancel")}
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
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  {tr("deleting")}
                </>
              ) : (
                tr("deleteAllContacts2")
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
            <AlertDialogTitle>{tr("deleteContact")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("areYouSureYouWantTo")} <strong>{contactToDelete?.name}</strong>
              {tr("thisActionCannotBeUndone")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (contactToDelete) {
                  deleteMutation.mutate(contactToDelete.id);
                  setContactToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
