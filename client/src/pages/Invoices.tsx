import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { PaymentDateField, toDateOnly } from "@/components/PaymentDateField";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { EmptyState } from "@/components/ui/empty-state";
import { canEditInvoice } from "@/lib/invoice-editability";
import { PageHeader } from "@/components/ui/page-header";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { exportToExcel, exportToGoogleSheets, prepareInvoicesForExport } from "@/lib/export";
import { evidenceSourceHref } from "@/lib/evidenceLinks";
import {
  Plus,
  FileText,
  FileCode,
  CalendarIcon,
  Trash2,
  Download,
  Edit,
  Palette,
  Save,
  Info,
  XCircle,
  AlertCircle,
  FileSpreadsheet,
  Send,
  DollarSign,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import type { Invoice, Company, InvoicePayment } from "@shared/schema";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api";
import { downloadPdf } from "@/lib/download-pdf";
import { messages as pageMessages } from "./Invoices.i18n";

const invoiceLineSchema = z.object({
  description: z.string().min(1, pageMessages.marker("descriptionIsRequired")),
  quantity: z.coerce.number().min(0.01, pageMessages.marker("quantityMustBePositive")),
  unitPrice: z.coerce.number().min(0.01, pageMessages.marker("priceMustBeGreaterThan0")),
  vatRate: z.coerce.number().default(0.05),
  // Optional income account for this line (null/empty = the default account).
  revenueAccountId: z.string().nullable().optional(),
  // Optional product sold on this line (drives stock and cost of goods sold when tracked).
  productId: z.string().nullable().optional(),
  // Round-tripped from the server so editing never loses an exempt / out-of-scope tag.
  vatSupplyType: z.string().nullable().optional(),
});

// Sentinel for the "Default" option: Radix Select items cannot have an empty value.
const DEFAULT_REVENUE_ACCOUNT = "__default__";
// Sentinel for "no product" (a manual line).
const MANUAL_LINE = "__manual__";

const invoiceSchema = z.object({
  companyId: z.string().uuid(),
  number: z.string().min(1, pageMessages.marker("invoiceNumberIsRequired")),
  customerName: z.string().min(1, pageMessages.marker("customerNameIsRequired")),
  customerTrn: z.string().optional(),
  date: z.date(),
  currency: z.string().default("AED"),
  lines: z.array(invoiceLineSchema).min(1, pageMessages.marker("atLeastOneLineItemIs")),
});

const invoiceBrandingSchema = z.object({
  invoiceShowLogo: z.boolean().default(true),
  invoiceShowAddress: z.boolean().default(true),
  invoiceShowPhone: z.boolean().default(true),
  invoiceShowEmail: z.boolean().default(true),
  invoiceShowWebsite: z.boolean().default(false),
  invoiceCustomTitle: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
  invoiceFooterNote: z
    .string()
    .transform((val) => val || undefined)
    .optional(),
});

type InvoiceFormData = z.infer<typeof invoiceSchema>;
type InvoiceBrandingFormData = z.infer<typeof invoiceBrandingSchema>;

export default function Invoices() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [activeTab, setActiveTab] = useState("invoices");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [invoiceForPayment, setInvoiceForPayment] = useState<Invoice | null>(null);
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<string>("");
  const [paymentDateForPaid, setPaymentDateForPaid] = useState<Date>(() => new Date());
  const [similarWarningOpen, setSimilarWarningOpen] = useState(false);
  const [similarInvoices, setSimilarInvoices] = useState<any[]>([]);
  const [pendingInvoiceData, setPendingInvoiceData] = useState<any>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);

  // Virtual scrolling for large invoice lists.
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Recurring invoice dialog state
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [invoiceForRecurring, setInvoiceForRecurring] = useState<Invoice | null>(null);
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringInterval, setRecurringInterval] = useState("monthly");
  const [recurringNextDate, setRecurringNextDate] = useState<Date | undefined>(undefined);
  const [recurringEndDate, setRecurringEndDate] = useState<Date | undefined>(undefined);

  // Payment tracking dialog state
  const [addPaymentDialogOpen, setAddPaymentDialogOpen] = useState(false);
  const [viewPaymentsDialogOpen, setViewPaymentsDialogOpen] = useState(false);
  const [invoiceForPaymentDetail, setInvoiceForPaymentDetail] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentAccountForAdd, setPaymentAccountForAdd] = useState("");
  const [paymentDateForAdd, setPaymentDateForAdd] = useState<Date>(() => new Date());
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    enabled: !!selectedCompanyId,
  });

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts"],
    enabled: !!selectedCompanyId,
  });

  // Products for the line editor's picker (same cache key as the Inventory page).
  const { data: pickerProducts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "products"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      number: `INV-${Date.now()}`,
      customerName: "",
      customerTrn: "",
      date: new Date(),
      currency: "AED",
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    },
  });

  // Update form's companyId when selectedCompanyId changes
  useEffect(() => {
    if (selectedCompanyId) {
      form.setValue("companyId", selectedCompanyId);
    }
  }, [selectedCompanyId, form]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const createMutation = useMutation({
    mutationFn: (data: InvoiceFormData) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/invoices`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: tr("invoiceCreated"),
        description: tr("yourInvoiceHasBeenCreatedWith"),
      });
      setDialogOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        number: `INV-${Date.now()}`,
        customerName: "",
        customerTrn: "",
        date: new Date(),
        currency: "AED",
        lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateInvoice"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: InvoiceFormData }) =>
      apiRequest("PUT", `/api/invoices/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: tr("invoiceUpdatedSuccessfully"),
        description: tr("yourInvoiceHasBeenUpdated"),
      });
      setDialogOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        number: `INV-${Date.now()}`,
        customerName: "",
        customerTrn: "",
        date: new Date(),
        currency: "AED",
        lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateInvoice"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      paymentAccountId,
      paymentDate,
    }: {
      id: string;
      status: string;
      paymentAccountId?: string;
      paymentDate?: string;
    }) =>
      apiRequest("PATCH", `/api/invoices/${id}/status`, { status, paymentAccountId, paymentDate }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      const previous = queryClient.getQueryData<Invoice[]>([
        "/api/companies",
        selectedCompanyId,
        "invoices",
      ]);
      queryClient.setQueryData<Invoice[]>(
        ["/api/companies", selectedCompanyId, "invoices"],
        (old) => old?.map((inv) => (inv.id === id ? { ...inv, status: status as any } : inv)) ?? []
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: tr("statusUpdated"),
        description: tr("invoiceStatusHasBeenUpdatedSuccessfully"),
      });
      setPaymentDialogOpen(false);
      setInvoiceForPayment(null);
      setSelectedPaymentAccount("");
    },
    onError: (error: any, _vars, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["/api/companies", selectedCompanyId, "invoices"],
          context.previous
        );
      }
      toast({
        variant: "destructive",
        title: tr("failedToUpdateStatus"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoices/${id}`),
    onMutate: async (id: string) => {
      const queryKey = ["/api/companies", selectedCompanyId, "invoices"] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Invoice[]>(queryKey);
      queryClient.setQueryData<Invoice[]>(
        queryKey,
        (old) => old?.filter((inv) => inv.id !== id) ?? []
      );
      return { previous, queryKey };
    },
    onSuccess: () => {
      toast({
        title: t.invoiceDeleted,
        description: t.invoiceDeletedDesc,
      });
    },
    onError: (error: any, _id, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({
        variant: "destructive",
        title: t.deleteFailed,
        description: error?.message || t.tryAgain,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
    },
  });

  const checkSimilarMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/invoices/check-similar`, data),
  });

  const setRecurringMutation = useMutation({
    mutationFn: ({ invoiceId, data }: { invoiceId: string; data: any }) =>
      apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/invoices/${invoiceId}/set-recurring`,
        data
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({ title: tr("recurringSettingsSaved") });
      setRecurringDialogOpen(false);
      setInvoiceForRecurring(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToSaveRecurringSettings"),
        description: error?.message,
      });
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: ({ invoiceId, data }: { invoiceId: string; data: any }) =>
      apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/invoices/${invoiceId}/payments`,
        data
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: tr("paymentRecorded"),
        description: tr("statusUpdatedTo", { status: result.status }),
      });
      setAddPaymentDialogOpen(false);
      setInvoiceForPaymentDetail(null);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentNotes("");
      setPaymentAccountForAdd("");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToRecordPayment"),
        description: error?.message,
      });
    },
  });

  const createCreditNoteMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/invoices/${invoiceId}/credit-note`,
        {}
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: tr("creditNoteCreated"),
        description: tr("aCreditNoteHasBeenCreated"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateCreditNote"),
        description: error?.message,
      });
    },
  });

  const handleStatusChange = (invoice: Invoice, newStatus: string) => {
    if (newStatus === "paid" && invoice.status !== "paid") {
      // Show payment account selection dialog
      setInvoiceForPayment(invoice);
      setPaymentDateForPaid(new Date());
      setPaymentDialogOpen(true);
    } else {
      // For other status changes, proceed directly
      updateStatusMutation.mutate({ id: invoice.id, status: newStatus });
    }
  };

  const handleConfirmPayment = () => {
    if (!selectedPaymentAccount || !invoiceForPayment) {
      toast({
        variant: "destructive",
        title: tr("error"),
        description: tr("pleaseSelectAPaymentAccount"),
      });
      return;
    }
    updateStatusMutation.mutate({
      id: invoiceForPayment.id,
      status: "paid",
      paymentAccountId: selectedPaymentAccount,
      paymentDate: toDateOnly(paymentDateForPaid),
    });
  };

  // Income accounts a line can be posted to (defaults to the standard sales account when unset)
  const revenueAccounts = accounts.filter((acc) => acc.type === "income" && acc.isActive !== false);

  // Get cash and bank accounts for payment selection
  const paymentAccounts = accounts.filter((acc) => {
    const name = (acc.nameEn || "").toLowerCase();
    const nameAr = (acc.nameAr || "").toLowerCase();
    return (
      acc.type === "asset" &&
      (name.includes("bank") ||
        name.includes("cash") ||
        name.includes("cheque") ||
        nameAr.includes("بنك") ||
        nameAr.includes("نقد") ||
        nameAr.includes("شيك"))
    );
  });

  const handleEditInvoice = async (invoice: Invoice) => {
    try {
      const fullInvoice = await apiRequest("GET", `/api/invoices/${invoice.id}`);
      setEditingInvoice(fullInvoice);
      form.reset({
        companyId: fullInvoice.companyId,
        number: fullInvoice.number,
        customerName: fullInvoice.customerName,
        customerTrn: fullInvoice.customerTrn || "",
        date: new Date(fullInvoice.date),
        currency: fullInvoice.currency,
        lines: fullInvoice.lines || [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("error"),
        description: error?.message || tr("failedToLoadInvoiceDetails"),
      });
    }
  };

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId,
      number: `INV-${Date.now()}`,
      customerName: "",
      customerTrn: "",
      date: new Date(),
      currency: "AED",
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditingInvoice(null);
  };

  const onSubmit = async (data: InvoiceFormData) => {
    try {
      const invoiceData = {
        ...data,
        companyId: selectedCompanyId!,
        lines: data.lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          vatRate: Number(line.vatRate),
          revenueAccountId: line.revenueAccountId || null,
          productId: line.productId || null,
          // The RATE decides the supply type, so a stored type is only
          // meaningful (and only sent) for 0% lines; sending a stale
          // exempt / out-of-scope tag on a taxed line is what used to hide its
          // VAT from the return.
          ...(line.vatSupplyType && Number(line.vatRate) === 0
            ? { vatSupplyType: line.vatSupplyType }
            : {}),
        })),
      };

      // Proceed with save directly - similar check removed for better UX
      await performInvoiceSave(invoiceData, editingInvoice);
    } catch (error) {
      // Error is handled by mutation callbacks
    }
  };

  const performInvoiceSave = async (invoiceData: any, editing: any) => {
    if (editing) {
      await editMutation.mutateAsync({ id: editing.id, data: invoiceData });
    } else {
      await createMutation.mutateAsync(invoiceData);
    }

    setDialogOpen(false);
    resetForm();
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-success-subtle text-success ";
      case "partial":
        return "bg-success-subtle text-success ";
      case "sent":
        return "bg-info-subtle text-info ";
      case "credited":
      case "void":
        return "bg-muted text-foreground ";
      default:
        return "bg-warning-subtle text-warning ";
    }
  };

  // Calculate totals for preview
  const watchLines = form.watch("lines");
  const subtotal = watchLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const vatAmount = watchLines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice * line.vatRate,
    0
  );
  const total = subtotal + vatAmount;

  // Invoice Branding Form
  const brandingForm = useForm<InvoiceBrandingFormData>({
    resolver: zodResolver(invoiceBrandingSchema),
    defaultValues: {
      invoiceShowLogo: true,
      invoiceShowAddress: true,
      invoiceShowPhone: true,
      invoiceShowEmail: true,
      invoiceShowWebsite: false,
      invoiceCustomTitle: "",
      invoiceFooterNote: "",
    },
  });

  // Load company branding settings into form
  useEffect(() => {
    if (company) {
      brandingForm.reset({
        invoiceShowLogo: company.invoiceShowLogo ?? true,
        invoiceShowAddress: company.invoiceShowAddress ?? true,
        invoiceShowPhone: company.invoiceShowPhone ?? true,
        invoiceShowEmail: company.invoiceShowEmail ?? true,
        invoiceShowWebsite: company.invoiceShowWebsite ?? false,
        invoiceCustomTitle: company.invoiceCustomTitle || "",
        invoiceFooterNote: company.invoiceFooterNote || "",
      });
    }
  }, [company, brandingForm]);

  const updateBrandingMutation = useMutation({
    mutationFn: (data: InvoiceBrandingFormData) => {
      return apiRequest("PATCH", `/api/companies/${selectedCompanyId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: tr("invoiceBrandingUpdated"),
        description: tr("yourInvoiceCustomizationSettingsHaveBeen"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateBranding"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const onBrandingSubmit = (data: InvoiceBrandingFormData) => {
    updateBrandingMutation.mutate(data);
  };

  const isVATRegistered = company?.trnVatNumber && company?.trnVatNumber.length > 0;

  const filteredInvoices = useMemo(() => {
    if (!invoices || invoices.length === 0) return [];
    if (!dateRange.from && !dateRange.to) return invoices;

    const fromDate = dateRange.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange.to ? endOfDay(dateRange.to) : null;

    return invoices.filter((invoice) => {
      if (!invoice.date) return false;

      const invoiceDate =
        typeof invoice.date === "string" ? parseISO(invoice.date) : new Date(invoice.date);

      if (fromDate && toDate) {
        return isWithinInterval(invoiceDate, { start: fromDate, end: toDate });
      }
      if (fromDate) {
        return invoiceDate >= fromDate;
      }
      if (toDate) {
        return invoiceDate <= toDate;
      }
      return true;
    });
  }, [invoices, dateRange.from, dateRange.to]);

  const handleExportExcel = () => {
    if (!filteredInvoices.length) {
      toast({ variant: "destructive", title: tr("noData"), description: tr("noInvoicesToExport") });
      return;
    }

    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    exportToExcel([prepareInvoicesForExport(filteredInvoices, locale)], `invoices${dateRangeStr}`);
    toast({
      title: tr("exportSuccessful"),
      description: tr("invoicesExportedToExcel", {
        filteredInvoicesCount: filteredInvoices.length,
      }),
    });
  };

  const handleExportGoogleSheets = async () => {
    if (!selectedCompanyId || !filteredInvoices.length) {
      toast({ variant: "destructive", title: tr("noData"), description: tr("noInvoicesToExport") });
      return;
    }

    setIsExporting(true);
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? ` (${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")})`
        : "";

    const result = await exportToGoogleSheets(
      [prepareInvoicesForExport(filteredInvoices, locale)],
      `Invoices${dateRangeStr}`,
      selectedCompanyId
    );

    setIsExporting(false);

    if (result.success) {
      toast({
        title: tr("exportSuccessful"),
        description: tr("invoicesExportedToGoogleSheets", {
          filteredInvoicesCount: filteredInvoices.length,
        }),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: result.error || tr("failedToExportToGoogleSheets"),
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("sales")}
        title={t.invoices}
        description={(t as any).manageInvoices ?? tr("manageInvoicesAndCustomizeTheirAppearance")}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="invoices" data-testid="tab-invoices">
            <FileText className="w-4 h-4 me-2" />
            {t.invoices}
          </TabsTrigger>
          <TabsTrigger value="branding" data-testid="tab-branding">
            <Palette className="w-4 h-4 me-2" />
            {(t as any).invoiceBranding ?? tr("invoiceBranding")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-6 mt-0">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-medium">
                    {(t as any).filterByDate ?? tr("filterByDate")}
                  </span>
                  <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={isExporting}
                        data-testid="button-export-invoices"
                      >
                        <Download className="w-4 h-4 me-2" />
                        {isExporting ? tr("exporting") : t.export}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={handleExportExcel}
                        data-testid="menu-export-invoices-excel"
                      >
                        <FileSpreadsheet className="w-4 h-4 me-2" />
                        {tr("exportToExcel")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleExportGoogleSheets}
                        data-testid="menu-export-invoices-sheets"
                      >
                        <SiGooglesheets className="w-4 h-4 me-2" />
                        {tr("exportToGoogleSheets")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end flex-wrap gap-4">
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                setDialogOpen(open);
                if (!open) {
                  setEditingInvoice(null);
                  form.reset({
                    companyId: selectedCompanyId,
                    number: `INV-${Date.now()}`,
                    customerName: "",
                    customerTrn: "",
                    date: new Date(),
                    currency: "AED",
                    lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
                  });
                }
              }}
            >
              <DialogTrigger asChild>
                <Button data-testid="button-create-invoice">
                  <Plus className="w-4 h-4 me-2" />
                  {t.newInvoice}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingInvoice ? tr("editInvoice") : t.newInvoice}</DialogTitle>
                  <DialogDescription>
                    {editingInvoice
                      ? tr("updateInvoiceDetails")
                      : tr("createANewInvoiceWithAutomatic")}
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="number"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.invoiceNumber}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                className="font-mono"
                                data-testid="input-invoice-number"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.date}</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "w-full justify-start text-start font-normal",
                                      !field.value && "text-muted-foreground"
                                    )}
                                    data-testid="button-date-picker"
                                  >
                                    <CalendarIcon className="me-2 h-4 w-4" />
                                    {field.value ? (
                                      format(field.value, "PPP")
                                    ) : (
                                      <span>{tr("pickADate")}</span>
                                    )}
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="customerName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.customerName}</FormLabel>
                            <FormControl>
                              <Input {...field} data-testid="input-customer-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="customerTrn"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.customerTRN}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={tr("optional")}
                                className="font-mono"
                                data-testid="input-customer-trn"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">{tr("lineItems")}</h3>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            append({ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 })
                          }
                          data-testid="button-add-line"
                        >
                          <Plus className="w-4 h-4 me-2" />
                          {t.addLine}
                        </Button>
                      </div>

                      {fields.map((field, index) => (
                        <div
                          key={field.id}
                          className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md"
                        >
                          <div className="col-span-4">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.description`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      placeholder={t.description}
                                      data-testid={`input-line-description-${index}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-1.5">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.quantity`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder={tr("qty")}
                                      className="font-mono"
                                      aria-label={tr("lineQuantity", { value: index + 1 })}
                                      value={field.value ?? ""}
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value ? parseFloat(e.target.value) : ""
                                        )
                                      }
                                      data-testid={`input-line-quantity-${index}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-1.5">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.unitPrice`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder={tr("price")}
                                      className="font-mono"
                                      aria-label={tr("lineUnitPrice", { value: index + 1 })}
                                      value={field.value ?? ""}
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value ? parseFloat(e.target.value) : ""
                                        )
                                      }
                                      data-testid={`input-line-price-${index}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-1.5">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.vatRate`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Select
                                      value={String(field.value * 100)}
                                      onValueChange={(val) => {
                                        field.onChange(parseFloat(val) / 100);
                                        // A new rate invalidates the stored supply type.
                                        form.setValue(`lines.${index}.vatSupplyType`, null);
                                      }}
                                    >
                                      <SelectTrigger
                                        className="font-mono"
                                        data-testid={`select-line-vat-${index}`}
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="0">0%</SelectItem>
                                        <SelectItem value="5">5%</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-2">
                            <div className="h-10 flex items-center justify-end font-mono text-sm">
                              {formatCurrency(
                                (watchLines[index]?.quantity || 0) *
                                  (watchLines[index]?.unitPrice || 0) *
                                  (1 + (watchLines[index]?.vatRate || 0)),
                                "AED",
                                locale
                              )}
                            </div>
                          </div>
                          <div className="col-span-1 flex items-center justify-center">
                            {fields.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => remove(index)}
                                data-testid={`button-remove-line-${index}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                          {pickerProducts.length > 0 && (
                            <div className="col-span-12">
                              <FormField
                                control={form.control}
                                name={`lines.${index}.productId`}
                                render={({ field }) => (
                                  <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormLabel className="text-xs text-muted-foreground whitespace-nowrap">
                                      {tr("lineProduct")}
                                    </FormLabel>
                                    <Select
                                      value={field.value || MANUAL_LINE}
                                      onValueChange={(val) => {
                                        if (val === MANUAL_LINE) {
                                          field.onChange(null);
                                          return;
                                        }
                                        const picked = pickerProducts.find((p) => p.id === val);
                                        field.onChange(val);
                                        if (!picked) return;
                                        // Fill the line from the product; the user can still edit it.
                                        form.setValue(
                                          `lines.${index}.description`,
                                          locale === "ar" && picked.nameAr ? picked.nameAr : picked.name
                                        );
                                        form.setValue(
                                          `lines.${index}.unitPrice`,
                                          Number(picked.unitPrice) || 0
                                        );
                                        form.setValue(
                                          `lines.${index}.vatRate`,
                                          Number(picked.vatRate) === 0 ? 0 : 0.05
                                        );
                                        form.setValue(`lines.${index}.vatSupplyType`, null);
                                      }}
                                    >
                                      <FormControl>
                                        <SelectTrigger
                                          className="h-8 text-xs"
                                          data-testid={`select-line-product-${index}`}
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value={MANUAL_LINE}>
                                          {tr("lineProductManual")}
                                        </SelectItem>
                                        {pickerProducts
                                          .filter((p) => p.isActive !== false)
                                          .map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                              {p.sku ? `${p.sku} — ` : ""}
                                              {locale === "ar" && p.nameAr ? p.nameAr : p.name}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  </FormItem>
                                )}
                              />
                            </div>
                          )}
                          <div className="col-span-12">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.revenueAccountId`}
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormLabel className="text-xs text-muted-foreground whitespace-nowrap">
                                    {t.revenueAccount}
                                  </FormLabel>
                                  <Select
                                    value={field.value || DEFAULT_REVENUE_ACCOUNT}
                                    onValueChange={(val) =>
                                      field.onChange(val === DEFAULT_REVENUE_ACCOUNT ? null : val)
                                    }
                                  >
                                    <FormControl>
                                      <SelectTrigger
                                        className="h-8 text-xs"
                                        data-testid={`select-line-revenue-account-${index}`}
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value={DEFAULT_REVENUE_ACCOUNT}>
                                        {t.revenueAccountDefault}
                                      </SelectItem>
                                      {revenueAccounts.map((acc) => (
                                        <SelectItem key={acc.id} value={acc.id}>
                                          {acc.code} —{" "}
                                          {locale === "ar" && acc.nameAr ? acc.nameAr : acc.nameEn}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t pt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t.subtotal}</span>
                        <span dir="ltr" className="font-mono font-medium">
                          {formatCurrency(subtotal, "AED", locale)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {t.vat} (
                          {watchLines.some((line) => line.vatRate !== 0)
                            ? tr("avg", {
                                round: Math.round(
                                  (watchLines.reduce((sum, line) => sum + line.vatRate, 0) /
                                    Math.max(1, watchLines.filter((l) => l.vatRate > 0).length)) *
                                    100
                                ),
                              })
                            : "0%"}
                          )
                        </span>
                        <span dir="ltr" className="font-mono font-medium">
                          {formatCurrency(vatAmount, "AED", locale)}
                        </span>
                      </div>
                      <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                        <span>{t.total}</span>
                        <span dir="ltr" className="font-mono">
                          {formatCurrency(total, "AED", locale)}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDialogOpen(false)}
                        className="flex-1"
                      >
                        {t.cancel}
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          createMutation.isPending ||
                          editMutation.isPending ||
                          checkSimilarMutation.isPending
                        }
                        className="flex-1"
                        data-testid="button-submit-invoice"
                      >
                        {createMutation.isPending ||
                        editMutation.isPending ||
                        checkSimilarMutation.isPending
                          ? t.loading
                          : t.save}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : (
            <>
              <div className="grid gap-3 md:hidden" data-testid="mobile-invoice-list">
                {(filteredInvoices || []).map((invoice) => (
                  <Card key={invoice.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p dir="ltr" className="font-mono text-sm font-semibold truncate">
                            {invoice.number}
                          </p>
                          <p className="text-sm font-medium truncate">{invoice.customerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(invoice.date, locale)}
                          </p>
                        </div>
                        <p dir="ltr" className="font-mono text-sm font-semibold shrink-0">
                          {formatCurrency(invoice.total, invoice.currency, locale)}
                        </p>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                        <Select
                          value={invoice.status}
                          onValueChange={(newStatus) => handleStatusChange(invoice, newStatus)}
                          disabled={updateStatusMutation.isPending}
                        >
                          <SelectTrigger
                            className={cn("h-9 border-0", getStatusBadgeColor(invoice.status))}
                            data-testid={`mobile-select-status-${invoice.id}`}
                          >
                            <SelectValue>{t[invoice.status as keyof typeof t]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">{t.draft}</SelectItem>
                            <SelectItem value="sent">{t.sent}</SelectItem>
                            <SelectItem value="paid">{t.paid}</SelectItem>
                            <SelectItem value="partial">{tr("partial")}</SelectItem>
                            {/* Derived from credit notes: shown, never selectable. */}
                            <SelectItem value="credited" disabled>
                              {t.credited}
                            </SelectItem>
                            <SelectItem value="void">{t.void}</SelectItem>
                          </SelectContent>
                        </Select>
                        {canEditInvoice(invoice.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditInvoice(invoice)}
                            data-testid={`mobile-button-edit-invoice-${invoice.id}`}
                          >
                            <Edit className="w-4 h-4 me-1" />
                            {tr("edit")}
                          </Button>
                        )}
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          data-testid={`mobile-button-proof-invoice-${invoice.id}`}
                        >
                          <Link href={evidenceSourceHref("invoice", invoice.id)}>
                            <FileText className="w-4 h-4 me-1" />
                            {tr("proof")}
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card className="hidden md:block">
                <div
                  ref={tableScrollRef}
                  className={cn(
                    "overflow-auto",
                    filteredInvoices && filteredInvoices.length > 100 && "max-h-[720px]"
                  )}
                  style={
                    filteredInvoices && filteredInvoices.length > 100
                      ? { contain: "strict" }
                      : undefined
                  }
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead className="font-semibold">{t.invoiceNumber}</TableHead>
                        <TableHead className="font-semibold">{t.customerName}</TableHead>
                        <TableHead className="font-semibold">{t.date}</TableHead>
                        <TableHead className="font-semibold text-end">{t.total}</TableHead>
                        <TableHead className="font-semibold text-center">{t.status}</TableHead>
                        <TableHead className="font-semibold text-center">{t.actions}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <VirtualizedInvoiceRows
                      invoices={filteredInvoices || []}
                      scrollRef={tableScrollRef}
                      renderRow={(invoice) => (
                        <TableRow key={invoice.id} data-testid={`invoice-row-${invoice.id}`}>
                          <TableCell className="font-mono font-medium">{invoice.number}</TableCell>
                          <TableCell>{invoice.customerName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(invoice.date, locale)}
                          </TableCell>
                          <TableCell className="text-end font-mono font-medium">
                            {formatCurrency(invoice.total, invoice.currency, locale)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Select
                              value={invoice.status}
                              onValueChange={(newStatus) => handleStatusChange(invoice, newStatus)}
                              disabled={updateStatusMutation.isPending}
                            >
                              <SelectTrigger
                                className={cn("w-32 border-0", getStatusBadgeColor(invoice.status))}
                                data-testid={`select-status-${invoice.id}`}
                              >
                                <SelectValue>{t[invoice.status as keyof typeof t]}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  value="draft"
                                  data-testid={`status-option-draft-${invoice.id}`}
                                >
                                  {t.draft}
                                </SelectItem>
                                <SelectItem
                                  value="sent"
                                  data-testid={`status-option-sent-${invoice.id}`}
                                >
                                  {t.sent}
                                </SelectItem>
                                <SelectItem
                                  value="paid"
                                  data-testid={`status-option-paid-${invoice.id}`}
                                >
                                  {t.paid}
                                </SelectItem>
                                <SelectItem
                                  value="partial"
                                  data-testid={`status-option-partial-${invoice.id}`}
                                >
                                  {tr("partial")}
                                </SelectItem>
                                {/* Derived from credit notes: shown, never selectable. */}
                                <SelectItem
                                  value="credited"
                                  disabled
                                  data-testid={`status-option-credited-${invoice.id}`}
                                >
                                  {t.credited}
                                </SelectItem>
                                <SelectItem
                                  value="void"
                                  data-testid={`status-option-void-${invoice.id}`}
                                >
                                  {t.void}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {(invoice as any).einvoiceStatus && (
                              <Badge
                                variant="outline"
                                className="ms-1 text-[10px] px-1 py-0 bg-info-subtle text-info border-info/30"
                              >
                                E
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                asChild
                                variant="ghost"
                                size="sm"
                                data-testid={`button-proof-invoice-${invoice.id}`}
                              >
                                <Link href={evidenceSourceHref("invoice", invoice.id)}>
                                  <FileText className="w-4 h-4 me-2" />
                                  {tr("proof")}
                                </Link>
                              </Button>
                              {canEditInvoice(invoice.status) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditInvoice(invoice)}
                                  data-testid={`button-edit-invoice-${invoice.id}`}
                                >
                                  <Edit className="w-4 h-4 me-2" />
                                  {tr("edit")}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  // The server renders the PDF (Arabic-capable fonts, FTA layout);
                                  // the old browser-side generator could not draw Arabic text.
                                  window.open(apiUrl(`/api/invoices/${invoice.id}/pdf`), "_blank")
                                }
                                data-testid={`button-download-pdf-${invoice.id}`}
                              >
                                <Download className="w-4 h-4 me-2" />
                                PDF
                              </Button>
                              {invoice.invoiceType !== "credit_note" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    downloadPdf(
                                      `/api/invoices/${invoice.id}/pdf?variant=delivery`,
                                      `delivery-note-${invoice.number}.pdf`
                                    ).catch((err: Error) =>
                                      toast({
                                        title: tr("deliveryNoteFailed"),
                                        description: err.message,
                                        variant: "destructive",
                                      })
                                    )
                                  }
                                  data-testid={`button-delivery-note-${invoice.id}`}
                                >
                                  <FileText className="w-4 h-4 me-2" />
                                  {tr("deliveryNote")}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    const result = await apiRequest(
                                      "POST",
                                      `/api/invoices/${invoice.id}/generate-einvoice`
                                    );
                                    toast({
                                      title: tr("eInvoiceGenerated"),
                                      description: `UUID: ${result.uuid}`,
                                    });
                                    queryClient.invalidateQueries({
                                      queryKey: ["/api/companies", selectedCompanyId, "invoices"],
                                    });
                                  } catch (error: any) {
                                    toast({
                                      title: tr("error"),
                                      description: error?.message,
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                title={tr("generateEInvoice")}
                                data-testid={`button-einvoice-${invoice.id}`}
                              >
                                <FileCode className="w-4 h-4 text-info" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={tr("addPayment")}
                                onClick={() => {
                                  setInvoiceForPaymentDetail(invoice);
                                  setPaymentAmount("");
                                  setPaymentAccountForAdd("");
                                  setPaymentMethod("bank");
                                  setPaymentReference("");
                                  setPaymentNotes("");
                                  setPaymentDateForAdd(new Date());
                                  setAddPaymentDialogOpen(true);
                                }}
                                data-testid={`button-add-payment-${invoice.id}`}
                              >
                                <DollarSign className="w-4 h-4 text-success" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={tr("viewPayments")}
                                onClick={async () => {
                                  setInvoiceForPaymentDetail(invoice);
                                  try {
                                    const payments = await apiRequest(
                                      "GET",
                                      `/api/companies/${selectedCompanyId}/invoices/${invoice.id}/payments`
                                    );
                                    setInvoicePayments(payments);
                                    setViewPaymentsDialogOpen(true);
                                  } catch (e: any) {
                                    toast({
                                      variant: "destructive",
                                      title: tr("error"),
                                      description: e?.message,
                                    });
                                  }
                                }}
                                data-testid={`button-view-payments-${invoice.id}`}
                              >
                                <FileText className="w-4 h-4 text-info" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={tr("setRecurring")}
                                onClick={() => {
                                  setInvoiceForRecurring(invoice);
                                  setRecurringEnabled((invoice as any).isRecurring || false);
                                  setRecurringInterval(
                                    (invoice as any).recurringInterval || "monthly"
                                  );
                                  const next = (invoice as any).nextRecurringDate;
                                  setRecurringNextDate(next ? new Date(next) : undefined);
                                  const end = (invoice as any).recurringEndDate;
                                  setRecurringEndDate(end ? new Date(end) : undefined);
                                  setRecurringDialogOpen(true);
                                }}
                                data-testid={`button-set-recurring-${invoice.id}`}
                              >
                                <RefreshCw
                                  className={`w-4 h-4 ${(invoice as any).isRecurring ? "text-chart-5" : "text-muted-foreground"}`}
                                />
                              </Button>
                              {(invoice as any).invoiceType !== "credit_note" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={tr("createCreditNote")}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        tr("createACreditNoteForInvoice", {
                                          number: invoice.number,
                                        })
                                      )
                                    ) {
                                      createCreditNoteMutation.mutate(invoice.id);
                                    }
                                  }}
                                  disabled={createCreditNoteMutation.isPending}
                                  data-testid={`button-credit-note-${invoice.id}`}
                                >
                                  <RotateCcw className="w-4 h-4 text-warning" />
                                </Button>
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={deleteMutation.isPending}
                                    data-testid={`button-delete-invoice-${invoice.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      {tr("deleteInvoice", { number: invoice.number })}
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {tr("thisWillPermanentlyDeleteThisInvoice")}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteMutation.mutate(invoice.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      {tr("delete")}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      emptyState={
                        <TableBody>
                          <TableRow>
                            <TableCell colSpan={6} className="p-0">
                              <EmptyState
                                icon={FileText}
                                title={
                                  dateRange.from || dateRange.to
                                    ? tr("noInvoicesInThisDateRange")
                                    : ((t as any).noInvoicesYet ?? tr("noInvoicesYet"))
                                }
                                description={
                                  dateRange.from || dateRange.to
                                    ? tr("tryWideningTheDateFilterOr")
                                    : ((t as any).createFirstInvoice ??
                                      tr("createYourFirstInvoiceVatSequential"))
                                }
                                action={
                                  !dateRange.from && !dateRange.to
                                    ? {
                                        label: (t as any).newInvoiceCta ?? tr("newInvoice"),
                                        icon: Plus,
                                        onClick: () => setDialogOpen(true),
                                        testId: "button-create-first-invoice",
                                      }
                                    : undefined
                                }
                                secondaryAction={
                                  dateRange.from || dateRange.to
                                    ? {
                                        label: tr("clearFilter"),
                                        onClick: () =>
                                          setDateRange({ from: undefined, to: undefined }),
                                      }
                                    : undefined
                                }
                                testId="empty-state-invoices"
                              />
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      }
                    />
                  </Table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="branding" className="space-y-6 mt-0">
          {isLoading ? (
            <Skeleton className="h-96" />
          ) : !company ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">{tr("companyNotFound")}</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-3xl">
              {isVATRegistered && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    {tr("yourCompanyIsVatRegisteredAll", { trnVatNumber: company.trnVatNumber })}
                  </AlertDescription>
                </Alert>
              )}

              <Form {...brandingForm}>
                <form onSubmit={brandingForm.handleSubmit(onBrandingSubmit)} className="space-y-8">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        {tr("companyDetailsDisplay")}
                      </CardTitle>
                      <CardDescription>
                        {tr("chooseWhichCompanyInformationToDisplay")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowLogo"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">{tr("showCompanyLogo")}</FormLabel>
                              <FormDescription>
                                {tr("displayYourCompanyLogoAtThe")}
                                {!company.logoUrl && (
                                  <span className="block text-xs text-warning mt-1">
                                    {tr("noteSetYourLogoInCompany")}
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.logoUrl}
                                data-testid="switch-show-logo"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowAddress"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                {tr("showBusinessAddress")}
                              </FormLabel>
                              <FormDescription>
                                {tr("displayYourBusinessAddressOnInvoices")}
                                {!company.businessAddress && (
                                  <span className="block text-xs text-warning mt-1">
                                    {tr("noteSetYourAddressInCompany")}
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.businessAddress}
                                data-testid="switch-show-address"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowPhone"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">{tr("showPhoneNumber")}</FormLabel>
                              <FormDescription>
                                {tr("displayYourBusinessPhoneNumberOn")}
                                {!company.contactPhone && (
                                  <span className="block text-xs text-warning mt-1">
                                    {tr("noteSetYourPhoneInCompany")}
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.contactPhone}
                                data-testid="switch-show-phone"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowEmail"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">{tr("showEmailAddress")}</FormLabel>
                              <FormDescription>
                                {tr("displayYourBusinessEmailOnInvoices")}
                                {!company.contactEmail && (
                                  <span className="block text-xs text-warning mt-1">
                                    {tr("noteSetYourEmailInCompany")}
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.contactEmail}
                                data-testid="switch-show-email"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowWebsite"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">{tr("showWebsite")}</FormLabel>
                              <FormDescription>
                                {tr("displayYourWebsiteUrlOnInvoices")}
                                {!company.websiteUrl && (
                                  <span className="block text-xs text-warning mt-1">
                                    {tr("noteSetYourWebsiteInCompany")}
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.websiteUrl}
                                data-testid="switch-show-website"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{tr("invoiceCustomization")}</CardTitle>
                      <CardDescription>{tr("customizeTheAppearanceAndTextOf")}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <FormField
                        control={brandingForm.control}
                        name="invoiceCustomTitle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tr("invoiceTitle")}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={
                                  isVATRegistered ? tr("taxInvoiceDefault") : tr("invoiceDefault")
                                }
                                {...field}
                                data-testid="input-invoice-title"
                              />
                            </FormControl>
                            <FormDescription>
                              {isVATRegistered
                                ? tr("forVatRegisteredCompaniesInvoicesDefault")
                                : tr("customTitleForYourInvoicesLeave")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceFooterNote"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tr("footerNote")}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={tr("thankYouForYourBusiness")}
                                className="resize-none"
                                rows={3}
                                {...field}
                                data-testid="textarea-footer-note"
                              />
                            </FormControl>
                            <FormDescription>{tr("addACustomMessageAtThe")}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={updateBrandingMutation.isPending}
                      data-testid="button-save-branding"
                    >
                      <Save className="w-4 h-4 me-2" />
                      {updateBrandingMutation.isPending ? tr("saving") : tr("saveSettings")}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Similar Invoices Warning Dialog */}
      <Dialog open={similarWarningOpen} onOpenChange={setSimilarWarningOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-warning" />
              {tr("similarInvoicesFound")}
            </DialogTitle>
            <DialogDescription>{tr("weFoundSimilarInvoicesThatMight")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {similarInvoices.map((invoice, idx) => (
                <div key={idx} className="p-3 border rounded-md bg-muted/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{invoice.number}</p>
                      <p className="text-sm">{invoice.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(invoice.date, locale)}
                      </p>
                      <Badge variant="outline" className="mt-1">
                        {invoice.status}
                      </Badge>
                    </div>
                    <p dir="ltr" className="font-mono font-semibold">
                      {formatCurrency(invoice.total || 0, "AED", locale)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setSimilarWarningOpen(false);
                  setPendingInvoiceData(null);
                  setSimilarInvoices([]);
                }}
                className="flex-1"
              >
                {tr("cancel")}
              </Button>
              <Button
                onClick={async () => {
                  setSimilarWarningOpen(false);
                  if (pendingInvoiceData) {
                    await performInvoiceSave(pendingInvoiceData, editingInvoice);
                  }
                  setPendingInvoiceData(null);
                  setSimilarInvoices([]);
                }}
                className="flex-1"
              >
                {tr("createAnyway")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set Recurring Dialog */}
      <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-chart-5" />
              {tr("recurringInvoiceSettings")}
            </DialogTitle>
            <DialogDescription>
              {tr("configureAutomaticRecurringCopiesForInvoice", {
                number: invoiceForRecurring?.number,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">{tr("enableRecurring")}</p>
                <p className="text-sm text-muted-foreground">
                  {tr("automaticallyCreateNewInvoiceCopiesOn")}
                </p>
              </div>
              <Switch checked={recurringEnabled} onCheckedChange={setRecurringEnabled} />
            </div>

            {recurringEnabled && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{tr("frequency")}</label>
                  <Select value={recurringInterval} onValueChange={setRecurringInterval}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">{tr("weekly")}</SelectItem>
                      <SelectItem value="monthly">{tr("monthly")}</SelectItem>
                      <SelectItem value="quarterly">{tr("quarterly")}</SelectItem>
                      <SelectItem value="yearly">{tr("yearly")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{tr("nextRunDate")}</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-start font-normal"
                      >
                        <CalendarIcon className="me-2 h-4 w-4" />
                        {recurringNextDate ? format(recurringNextDate, "PPP") : tr("pickADate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={recurringNextDate}
                        onSelect={setRecurringNextDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{tr("endDateOptional")}</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-start font-normal"
                      >
                        <CalendarIcon className="me-2 h-4 w-4" />
                        {recurringEndDate ? format(recurringEndDate, "PPP") : tr("noEndDate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={recurringEndDate}
                        onSelect={setRecurringEndDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {recurringEndDate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRecurringEndDate(undefined)}
                      className="text-xs text-muted-foreground"
                    >
                      {tr("clearEndDate")}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setRecurringDialogOpen(false)}
              className="flex-1"
            >
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!invoiceForRecurring) return;
                setRecurringMutation.mutate({
                  invoiceId: invoiceForRecurring.id,
                  data: {
                    isRecurring: recurringEnabled,
                    recurringInterval: recurringEnabled ? recurringInterval : null,
                    nextRecurringDate:
                      recurringEnabled && recurringNextDate
                        ? recurringNextDate.toISOString()
                        : null,
                    recurringEndDate: recurringEndDate ? recurringEndDate.toISOString() : null,
                  },
                });
              }}
              disabled={setRecurringMutation.isPending || (recurringEnabled && !recurringNextDate)}
              className="flex-1"
            >
              {setRecurringMutation.isPending ? tr("saving") : tr("save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Payment Dialog */}
      <Dialog open={addPaymentDialogOpen} onOpenChange={setAddPaymentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-success" />
              {tr("recordPayment")}
            </DialogTitle>
            <DialogDescription>
              {tr("recordAPaymentReceivedForInvoice", { number: invoiceForPaymentDetail?.number })}
              {invoiceForPaymentDetail
                ? formatCurrency(
                    invoiceForPaymentDetail.total,
                    invoiceForPaymentDetail.currency,
                    locale
                  )
                : ""}
              )
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{tr("amount")}</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                className="font-mono"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{tr("paymentMethod")}</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">{tr("bankTransfer")}</SelectItem>
                  <SelectItem value="cash">{tr("cash")}</SelectItem>
                  <SelectItem value="cheque">{tr("cheque")}</SelectItem>
                  <SelectItem value="online">{tr("onlinePayment")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{tr("depositAccount")}</label>
              {paymentAccounts.length > 0 ? (
                <Select value={paymentAccountForAdd} onValueChange={setPaymentAccountForAdd}>
                  <SelectTrigger>
                    <SelectValue placeholder={tr("selectAccount")} />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.code} — {acc.nameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{tr("noCashBankAccountsFoundCreate")}</AlertDescription>
                </Alert>
              )}
            </div>

            <PaymentDateField
              value={paymentDateForAdd}
              onChange={setPaymentDateForAdd}
              minDate={invoiceForPaymentDetail ? new Date(invoiceForPaymentDetail.date) : null}
              testId="button-add-payment-date"
            />

            <div className="space-y-2">
              <label className="text-sm font-medium">{tr("referenceOptional")}</label>
              <Input
                placeholder={tr("eGBankRefChequeNo")}
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{tr("notesOptional")}</label>
              <Input
                placeholder={tr("additionalNotes")}
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setAddPaymentDialogOpen(false)}
              className="flex-1"
            >
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!invoiceForPaymentDetail || !paymentAmount || !paymentAccountForAdd) return;
                addPaymentMutation.mutate({
                  invoiceId: invoiceForPaymentDetail.id,
                  data: {
                    amount: parseFloat(paymentAmount),
                    method: paymentMethod,
                    paymentAccountId: paymentAccountForAdd,
                    reference: paymentReference || undefined,
                    notes: paymentNotes || undefined,
                    date: toDateOnly(paymentDateForAdd),
                  },
                });
              }}
              disabled={addPaymentMutation.isPending || !paymentAmount || !paymentAccountForAdd}
              className="flex-1"
            >
              {addPaymentMutation.isPending ? tr("recording") : tr("recordPayment")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Payments Dialog */}
      <Dialog open={viewPaymentsDialogOpen} onOpenChange={setViewPaymentsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {tr("paymentHistoryInvoice", { number: invoiceForPaymentDetail?.number })}
            </DialogTitle>
            <DialogDescription>{tr("allPaymentsRecordedForThisInvoice")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {invoicePayments.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">
                {tr("noPaymentsRecordedYet")}
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("date")}</TableHead>
                      <TableHead>{tr("method")}</TableHead>
                      <TableHead>{tr("reference")}</TableHead>
                      <TableHead className="text-end">{tr("amount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoicePayments.map((p: InvoicePayment) => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDate(p.date, locale)}</TableCell>
                        <TableCell className="capitalize">{p.method}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.reference || "—"}
                        </TableCell>
                        <TableCell className="text-end font-mono font-medium">
                          {formatCurrency(
                            p.amount,
                            invoiceForPaymentDetail?.currency || "AED",
                            locale
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between pt-2 border-t font-semibold">
                  <span>{tr("totalPaid")}</span>
                  <span dir="ltr" className="font-mono">
                    {formatCurrency(
                      invoicePayments.reduce((s: number, p: InvoicePayment) => s + p.amount, 0),
                      invoiceForPaymentDetail?.currency || "AED",
                      locale
                    )}
                  </span>
                </div>
              </>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => setViewPaymentsDialogOpen(false)}
            className="w-full mt-2"
          >
            {tr("close")}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Payment Account Selection Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("selectPaymentAccount")}</DialogTitle>
            <DialogDescription>
              {tr("chooseWhereThePaymentForInvoice", { number: invoiceForPayment?.number })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {paymentAccounts.length > 0 ? (
              <div className="space-y-2">
                {paymentAccounts.map((account) => (
                  <Card
                    key={account.id}
                    className={cn(
                      "cursor-pointer transition-all hover-elevate",
                      selectedPaymentAccount === account.id && "ring-2 ring-primary"
                    )}
                    onClick={() => setSelectedPaymentAccount(account.id)}
                    data-testid={`select-payment-account-${account.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">
                            {locale === "ar" && account.nameAr ? account.nameAr : account.nameEn}
                          </div>
                          <div dir="ltr" className="text-sm text-muted-foreground font-mono">
                            {account.code}
                          </div>
                        </div>
                        {selectedPaymentAccount === account.id && (
                          <div className="text-primary">✓</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{tr("youNeedToCreateAtLeast")}</AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPaymentDialogOpen(false);
                    window.location.href = "/chart-of-accounts";
                  }}
                  className="w-full"
                  data-testid="button-create-payment-account"
                >
                  <Plus className="w-4 h-4 me-2" />
                  {tr("createBankCashAccount")}
                </Button>
              </div>
            )}
            <PaymentDateField
              value={paymentDateForPaid}
              onChange={setPaymentDateForPaid}
              minDate={invoiceForPayment ? new Date(invoiceForPayment.date) : null}
              testId="button-mark-paid-date"
            />
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setPaymentDialogOpen(false);
                setSelectedPaymentAccount("");
              }}
              className="flex-1"
              data-testid="button-cancel-payment"
            >
              {tr("cancel")}
            </Button>
            <Button
              onClick={handleConfirmPayment}
              disabled={!selectedPaymentAccount || updateStatusMutation.isPending}
              className="flex-1"
              data-testid="button-confirm-payment"
            >
              {updateStatusMutation.isPending ? tr("processing") : tr("markAsPaid")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const VIRTUALIZE_THRESHOLD = 100;
const ROW_ESTIMATE = 64;

interface VirtualizedInvoiceRowsProps {
  invoices: Invoice[];
  scrollRef: React.RefObject<HTMLDivElement>;
  renderRow: (invoice: Invoice) => React.ReactElement;
  emptyState: React.ReactNode;
}

function VirtualizedInvoiceRows({
  invoices,
  scrollRef,
  renderRow,
  emptyState,
}: VirtualizedInvoiceRowsProps) {
  const virtualizer = useVirtualizer({
    count: invoices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 10,
  });

  if (invoices.length === 0) {
    return <>{emptyState}</>;
  }

  // Below the threshold, the cost of measuring exceeds the benefit — render normally.
  if (invoices.length < VIRTUALIZE_THRESHOLD) {
    return <TableBody>{invoices.map((invoice) => renderRow(invoice))}</TableBody>;
  }

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <TableBody>
      {paddingTop > 0 && (
        <tr aria-hidden="true">
          <td colSpan={6} style={{ height: paddingTop, padding: 0, border: 0 }} />
        </tr>
      )}
      {virtualItems.map((virtualRow) => renderRow(invoices[virtualRow.index]))}
      {paddingBottom > 0 && (
        <tr aria-hidden="true">
          <td colSpan={6} style={{ height: paddingBottom, padding: 0, border: 0 }} />
        </tr>
      )}
    </TableBody>
  );
}
