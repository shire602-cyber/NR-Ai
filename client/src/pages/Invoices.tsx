import { T } from "@/components/layout/T";
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
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
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency, formatDate } from "@/lib/format";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { einvoiceIssuesFromError, type EInvoiceIssueItem } from "@/lib/einvoice-issues";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { EmptyState } from "@/components/ui/empty-state";
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
  X,
} from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import type { Invoice, Company, InvoicePayment } from "@shared/schema";
import { cn } from "@/lib/utils";
import { downloadInvoicePDF } from "@/lib/pdf-invoice";
import {
  computeInvoiceFormLine,
  computeInvoiceFormTotals,
  lineVatRate,
} from "@/lib/invoice-totals";
import { STANDARD_VAT_RATES, vatJurisdictionForCountry } from "@shared/vat-classification";
import { companyLogoSrc, fetchCompanyLogoDataUrl } from "@/lib/company-logo";
import { invoiceStatusQuery, parseInvoiceStatusFilter } from "@/lib/invoice-filters";

// R07-01: each line carries an explicit UAE supply type; the VAT rate follows
// from it (5% standard, 0% for zero-rated / exempt / out of scope).
const SUPPLY_TYPE_OPTIONS = ["standard_rated", "zero_rated", "exempt", "out_of_scope"] as const;
type SupplyTypeOption = (typeof SUPPLY_TYPE_OPTIONS)[number];
const EMIRATE_OPTIONS = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

const invoiceLineSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().min(0.01, "Quantity must be positive"),
  unitPrice: z.coerce.number().min(0.01, "Price must be greater than 0"),
  vatRate: z.coerce.number().default(0.05),
  vatSupplyType: z.enum(SUPPLY_TYPE_OPTIONS).default("standard_rated"),
  // R03-07: line discount in percent (0 = none). Sent as discountType/discountValue.
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  // S8 (R07-15): profit-margin scheme (second-hand goods, standard-rated lines only).
  marginScheme: z.boolean().default(false),
  marginPurchaseCost: z.coerce.number().min(0).default(0),
});

const EMPTY_LINE = {
  description: "",
  quantity: 1,
  unitPrice: 0,
  vatRate: 0.05,
  vatSupplyType: "standard_rated" as SupplyTypeOption,
  discountPercent: 0,
  marginScheme: false,
  marginPurchaseCost: 0,
};

// S1 (W5-E): form totals come from the pure, tested client/src/lib/invoice-totals.ts, which
// follows the server engine (fils, half-up, VAT rounded once per document).

const invoiceSchema = z.object({
  companyId: z.string().uuid(),
  // R18-06: the server allocates the gap-free FTA number on save, so new
  // invoices carry no client-side number.
  number: z.string(),
  customerName: z.string().min(1, "Customer name is required"),
  customerTrn: z.string().optional(),
  contactId: z.string().optional(),
  placeOfSupplyEmirate: z.string().optional(),
  date: z.date(),
  currency: z.string().default("AED"),
  lines: z.array(invoiceLineSchema).min(1, "At least one line item is required"),
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
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  // Standard VAT rate of the issuing company's jurisdiction (UAE 5%, KSA 15%).
  const standardRate = STANDARD_VAT_RATES[vatJurisdictionForCountry(company?.addressCountry)];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  // R18-07: a freshly saved invoice is a draft; offer to issue it right away.
  const [draftNudge, setDraftNudge] = useState<{ id: string; number: string } | null>(null);
  const [activeTab, setActiveTab] = useState("invoices");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [invoiceForPayment, setInvoiceForPayment] = useState<Invoice | null>(null);
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<string>("");
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
  const [einvoiceIssues, setEinvoiceIssues] = useState<{
    number: string;
    issues: EInvoiceIssueItem[];
  } | null>(null);
  const [viewPaymentsDialogOpen, setViewPaymentsDialogOpen] = useState(false);
  const [invoiceForPaymentDetail, setInvoiceForPaymentDetail] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentAccountForAdd, setPaymentAccountForAdd] = useState("");
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);

  // R13-21: dashboard drill-through links open /invoices?status=open|overdue|<status>; the
  // filter is applied server-side so the paginated list stays correct.
  const [statusFilter, setStatusFilter] = useState<string | null>(() =>
    typeof window === "undefined" ? null : parseInvoiceStatusFilter(window.location.search)
  );
  const clearStatusFilter = () => {
    setStatusFilter(null);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("status");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  };

  // R20-05: cursor-paginated list (50 per page) with infinite scroll; exports
  // fetch the full list explicitly with all=true.
  const invoicePages = useInfiniteQuery<{ items: Invoice[]; nextCursor: string | null }>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices", "paged", statusFilter ?? "all"],
    queryFn: ({ pageParam }) =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/invoices?limit=50${invoiceStatusQuery(statusFilter)}${pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ""}`
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!selectedCompanyId,
  });
  const invoices = useMemo<Invoice[]>(
    () => invoicePages.data?.pages.flatMap((p) => p.items) ?? [],
    [invoicePages.data]
  );
  const isLoading = invoicePages.isLoading;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting &&
        invoicePages.hasNextPage &&
        !invoicePages.isFetchingNextPage
      ) {
        invoicePages.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [invoicePages]);
  const fetchAllInvoices = async (): Promise<Invoice[]> =>
    apiRequest("GET", `/api/companies/${selectedCompanyId}/invoices?all=true`);

  const { data: contacts = [] } = useQuery<
    Array<{ id: string; name: string; trnNumber?: string | null; emirate?: string | null }>
  >({
    queryKey: ["/api/companies", selectedCompanyId, "customer-contacts"],
    enabled: !!selectedCompanyId,
  });

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      number: "",
      customerName: "",
      customerTrn: "",
      date: new Date(),
      currency: "AED",
      lines: [{ ...EMPTY_LINE }],
    },
  });

  // R18-12: the dashboard's guided first-invoice entry point links to
  // /invoices?new=1, which opens the New Invoice dialog straight away. The
  // param is stripped when the dialog closes: rewriting the URL while the dialog
  // is open would change the router location key and remount the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      setDialogOpen(true);
    }
  }, []);

  const stripNewInvoiceParam = () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") return;
    params.delete("new");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash
    );
  };

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
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: "Invoice created",
        description: "Your invoice has been created with VAT calculation.",
      });
      if (created?.id && (created.status ?? "draft") === "draft") {
        setDraftNudge({ id: created.id, number: created.number ?? "" });
      }
      setDialogOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        number: "",
        customerName: "",
        customerTrn: "",
        date: new Date(),
        currency: "AED",
        lines: [{ ...EMPTY_LINE }],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create invoice",
        description: error?.message || "Please try again.",
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
        title: "Invoice updated successfully",
        description: "Your invoice has been updated.",
      });
      setDialogOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        number: "",
        customerName: "",
        customerTrn: "",
        date: new Date(),
        currency: "AED",
        lines: [{ ...EMPTY_LINE }],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update invoice",
        description: error?.message || "Please try again.",
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/invoices/${id}/status`, { status }),
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
        title: "Status updated",
        description: "Invoice status has been updated successfully.",
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
        title: "Failed to update status",
        description: error?.message || "Please try again.",
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
      toast({ title: "Recurring settings saved" });
      setRecurringDialogOpen(false);
      setInvoiceForRecurring(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to save recurring settings",
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
      toast({ title: "Payment recorded", description: `Status updated to ${result.status}` });
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
        title: "Failed to record payment",
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
        title: "Credit note created",
        description: "A credit note has been created and the journal entry reversed.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create credit note",
        description: error?.message,
      });
    },
  });

  const handleStatusChange = (invoice: Invoice, newStatus: string) => {
    if (newStatus === "paid" && invoice.status !== "paid") {
      // Show payment account selection dialog
      setInvoiceForPayment(invoice);
      setPaymentDialogOpen(true);
    } else {
      // For other status changes, proceed directly
      updateStatusMutation.mutate({ id: invoice.id, status: newStatus });
    }
  };

  // R03-13: "mark as paid" records a payment of the amount due against the
  // chosen cash/bank account (the status endpoint no longer accepts "paid").
  const handleConfirmPayment = async () => {
    if (!selectedPaymentAccount || !invoiceForPayment) {
      toast({
        variant: "destructive",
        title: t["invoices.error"],
        description: t["invoices.selectPaymentAccount"],
      });
      return;
    }
    const detail = await apiRequest("GET", `/api/invoices/${invoiceForPayment.id}`);
    const due = Number(detail?.settlement?.amountDue ?? invoiceForPayment.total);
    addPaymentMutation.mutate(
      {
        invoiceId: invoiceForPayment.id,
        data: {
          amount: due.toFixed(2),
          date: format(new Date(), "yyyy-MM-dd"),
          method: "bank",
          paymentAccountId: selectedPaymentAccount,
        },
      },
      {
        onSuccess: () => {
          setPaymentDialogOpen(false);
          setInvoiceForPayment(null);
          setSelectedPaymentAccount("");
        },
      }
    );
  };

  // R03-05: only cash and bank accounts (sub-type cash | bank) can receive payments.
  const paymentAccounts = accounts.filter(
    (acc) => acc.type === "asset" && (acc.subType === "cash" || acc.subType === "bank")
  );

  const handleEditInvoice = async (invoice: Invoice) => {
    try {
      const fullInvoice = await apiRequest("GET", `/api/invoices/${invoice.id}`);
      setEditingInvoice(fullInvoice);
      form.reset({
        companyId: fullInvoice.companyId,
        number: fullInvoice.number,
        customerName: fullInvoice.customerName,
        customerTrn: fullInvoice.customerTrn || "",
        contactId: fullInvoice.contactId || undefined,
        placeOfSupplyEmirate: fullInvoice.placeOfSupplyEmirate || undefined,
        date: new Date(fullInvoice.date),
        currency: fullInvoice.currency,
        lines: fullInvoice.lines?.length
          ? fullInvoice.lines.map(
              (l: {
                description: string;
                quantity: number;
                unitPrice: number;
                vatRate: number;
                vatSupplyType?: string | null;
                discountType?: string | null;
                discountValue?: number | null;
                marginScheme?: boolean | null;
                marginPurchaseCost?: number | string | null;
              }) => ({
                description: l.description,
                quantity: Number(l.quantity),
                unitPrice: Number(l.unitPrice),
                vatRate: Number(l.vatRate),
                vatSupplyType: (SUPPLY_TYPE_OPTIONS as readonly string[]).includes(
                  String(l.vatSupplyType)
                )
                  ? (l.vatSupplyType as SupplyTypeOption)
                  : Number(l.vatRate) > 0
                    ? "standard_rated"
                    : "zero_rated",
                discountPercent: l.discountType === "percent" ? Number(l.discountValue) || 0 : 0,
                marginScheme: !!l.marginScheme,
                marginPurchaseCost: Number(l.marginPurchaseCost) || 0,
              })
            )
          : [{ ...EMPTY_LINE }],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to load invoice details.",
      });
    }
  };

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId,
      number: "",
      customerName: "",
      customerTrn: "",
      date: new Date(),
      currency: "AED",
      lines: [{ ...EMPTY_LINE }],
    });
    setEditingInvoice(null);
  };

  const onSubmit = async (data: InvoiceFormData) => {
    try {
      // Strict contract (R03-02): no number, status, totals or companyId.
      const invoiceData = {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        ...(data.contactId ? { contactId: data.contactId } : {}),
        ...(data.placeOfSupplyEmirate ? { placeOfSupplyEmirate: data.placeOfSupplyEmirate } : {}),
        date: format(data.date, "yyyy-MM-dd"),
        currency: data.currency,
        lines: data.lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Math.round(Number(line.unitPrice) * 100) / 100,
          vatRate: lineVatRate(line.vatSupplyType, standardRate),
          vatSupplyType: line.vatSupplyType,
          ...(Number(line.discountPercent) > 0
            ? { discountType: "percent", discountValue: Number(line.discountPercent) }
            : {}),
          ...(line.marginScheme && line.vatSupplyType === "standard_rated"
            ? {
                marginScheme: true,
                marginPurchaseCost: Math.round(Number(line.marginPurchaseCost) * 100) / 100,
              }
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
      case "void":
        return "bg-muted text-foreground ";
      default:
        return "bg-warning-subtle text-warning ";
    }
  };

  // Calculate totals for preview
  const watchLines = form.watch("lines");
  const formTotals = computeInvoiceFormTotals(watchLines, standardRate);
  const { subtotal, vatAmount, total } = formTotals;

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
        title: "Invoice branding updated",
        description: "Your invoice customization settings have been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update branding",
        description: error?.message || "Please try again.",
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
      toast({ variant: "destructive", title: "No data", description: "No invoices to export" });
      return;
    }

    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    exportToExcel([prepareInvoicesForExport(filteredInvoices, locale)], `invoices${dateRangeStr}`);
    if (invoicePages.hasNextPage) {
      void fetchAllInvoices().then((all) =>
        exportToExcel([prepareInvoicesForExport(all, locale)], `invoices-all${dateRangeStr}`)
      );
    }
    toast({
      title: "Export successful",
      description: `${filteredInvoices.length} invoices exported to Excel`,
    });
  };

  const handleExportGoogleSheets = async () => {
    if (!selectedCompanyId || !filteredInvoices.length) {
      toast({ variant: "destructive", title: "No data", description: "No invoices to export" });
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
        title: "Export successful",
        description: `${filteredInvoices.length} invoices exported to Google Sheets`,
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: result.error || "Failed to export to Google Sheets",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Dialog open={!!einvoiceIssues} onOpenChange={(open) => !open && setEinvoiceIssues(null)}>
        <DialogContent data-testid="dialog-einvoice-issues">
          <DialogHeader>
            <DialogTitle>
              {formatMessage(t["invoices.einvoiceIssuesTitle"], {
                number: einvoiceIssues?.number ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              <T k="invoices.einvoiceIssuesBody" />
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {(einvoiceIssues?.issues ?? []).map((issue, i) => (
              <li key={`${issue.field}-${i}`} className="rounded-md border p-2">
                {issue.field && (
                  <span className="block font-mono text-xs text-muted-foreground">
                    {issue.field}
                  </span>
                )}
                {issue.message}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Sales"
        title={t.invoices}
        description={(t as any).manageInvoices ?? "Manage invoices and customize their appearance"}
      />

      <AlertDialog
        open={draftNudge !== null}
        onOpenChange={(open) => {
          if (!open) setDraftNudge(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-invoice-draft-nudge">
          <AlertDialogHeader>
            <AlertDialogTitle>{t["invoices.nudgeTitle"]}</AlertDialogTitle>
            <AlertDialogDescription>
              {formatMessage(t["invoices.nudgeBody"], { number: draftNudge?.number ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-keep-draft">
              {t["invoices.nudgeKeepDraft"]}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-issue-now"
              disabled={updateStatusMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!draftNudge) return;
                const target = draftNudge;
                updateStatusMutation.mutate(
                  { id: target.id, status: "sent" },
                  {
                    onSuccess: () => {
                      setDraftNudge(null);
                      toast({
                        title: t["invoices.nudgeIssued"],
                        description: formatMessage(t["invoices.nudgeIssuedBody"], {
                          number: target.number,
                        }),
                      });
                    },
                    onError: () => {
                      toast({
                        variant: "destructive",
                        title: t["invoices.nudgeIssueFailed"],
                      });
                    },
                  }
                );
              }}
            >
              {t["invoices.nudgeIssueNow"]}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="invoices" data-testid="tab-invoices">
            <FileText className="w-4 h-4 mr-2" />
            {t.invoices}
          </TabsTrigger>
          <TabsTrigger value="branding" data-testid="tab-branding">
            <Palette className="w-4 h-4 mr-2" />
            {(t as any).invoiceBranding ?? "Invoice Branding"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-6 mt-0">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-medium">
                    {(t as any).filterByDate ?? "Filter by date:"}
                  </span>
                  <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
                  {statusFilter && (
                    <Badge variant="secondary" className="gap-2" data-testid="badge-status-filter">
                      {formatMessage(t["invoices.statusFilter"], {
                        status: t[`invoices.statusFilter.${statusFilter}`] ?? statusFilter,
                      })}
                      <button
                        type="button"
                        onClick={clearStatusFilter}
                        aria-label={t["invoices.clearStatusFilter"]}
                        data-testid="button-clear-status-filter"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={isExporting}
                        data-testid="button-export-invoices"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        {isExporting ? "Exporting..." : t.export}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={handleExportExcel}
                        data-testid="menu-export-invoices-excel"
                      >
                        <FileSpreadsheet className="w-4 h-4 mr-2" />
                        <T k="reportCenter.exportToExcel" />
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleExportGoogleSheets}
                        data-testid="menu-export-invoices-sheets"
                      >
                        <SiGooglesheets className="w-4 h-4 mr-2" />
                        <T k="reportCenter.exportToGoogleSheets" />
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
                  stripNewInvoiceParam();
                  setEditingInvoice(null);
                  form.reset({
                    companyId: selectedCompanyId,
                    number: "",
                    customerName: "",
                    customerTrn: "",
                    date: new Date(),
                    currency: "AED",
                    lines: [{ ...EMPTY_LINE }],
                  });
                }
              }}
            >
              <DialogTrigger asChild>
                <Button data-testid="button-create-invoice">
                  <Plus className="w-4 h-4 mr-2" />
                  {t.newInvoice}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingInvoice ? "Edit Invoice" : t.newInvoice}</DialogTitle>
                  <DialogDescription>
                    {editingInvoice
                      ? "Update invoice details"
                      : "Create a new invoice with automatic VAT calculation"}
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
                                readOnly={!editingInvoice}
                                placeholder={
                                  editingInvoice ? undefined : t["invoices.numberAssignedOnSave"]
                                }
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
                                      "w-full justify-start text-left font-normal",
                                      !field.value && "text-muted-foreground"
                                    )}
                                    data-testid="button-date-picker"
                                  >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {field.value ? (
                                      format(field.value, "PPP")
                                    ) : (
                                      <span>
                                        <T k="pages.pickADate" />
                                      </span>
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
                                placeholder="Optional"
                                className="font-mono"
                                data-testid="input-customer-trn"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="contactId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t["invoices.contact"]}</FormLabel>
                            <Select
                              value={field.value || "none"}
                              onValueChange={(val) => {
                                const id = val === "none" ? undefined : val;
                                field.onChange(id);
                                const c = contacts.find((x) => x.id === id);
                                if (c) {
                                  form.setValue("customerName", c.name);
                                  form.setValue("customerTrn", c.trnNumber || "");
                                  if (c.emirate) form.setValue("placeOfSupplyEmirate", c.emirate);
                                }
                              }}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-invoice-contact">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">{t["invoices.noContact"]}</SelectItem>
                                {contacts.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormDescription>{t["invoices.contactHint"]}</FormDescription>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="placeOfSupplyEmirate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t["invoices.placeOfSupply"]}</FormLabel>
                            <Select value={field.value || ""} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger data-testid="select-place-of-supply">
                                  <SelectValue placeholder={t["invoices.placeOfSupplyDefault"]} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EMIRATE_OPTIONS.map((e) => (
                                  <SelectItem key={e} value={e}>
                                    {t[`invoices.emirate.${e}`]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">
                          <T k="pages.lineItems" />
                        </h3>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => append({ ...EMPTY_LINE })}
                          data-testid="button-add-line"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          {t.addLine}
                        </Button>
                      </div>

                      {fields.map((field, index) => (
                        <div
                          key={field.id}
                          className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md"
                        >
                          <div className="col-span-3">
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
                                      placeholder="Qty"
                                      className="font-mono"
                                      aria-label={`Line ${index + 1} quantity`}
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
                                      placeholder="Price"
                                      className="font-mono"
                                      aria-label={`Line ${index + 1} unit price`}
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
                              name={`lines.${index}.vatSupplyType`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Select
                                      value={field.value}
                                      onValueChange={(val) => {
                                        field.onChange(val);
                                        form.setValue(
                                          `lines.${index}.vatRate`,
                                          lineVatRate(val as SupplyTypeOption, standardRate)
                                        );
                                        if (val !== "standard_rated") {
                                          form.setValue(`lines.${index}.marginScheme`, false);
                                        }
                                      }}
                                    >
                                      <SelectTrigger
                                        aria-label={t["invoices.supplyType"]}
                                        data-testid={`select-line-vat-${index}`}
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {SUPPLY_TYPE_OPTIONS.map((st) => (
                                          <SelectItem key={st} value={st}>
                                            {t[`invoices.supply.${st}`]}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-1">
                            <FormField
                              control={form.control}
                              name={`lines.${index}.discountPercent`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      max={100}
                                      placeholder={t["invoices.discountPercent"]}
                                      aria-label={t["invoices.discountPercent"]}
                                      className="font-mono"
                                      value={field.value ?? ""}
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value ? parseFloat(e.target.value) : 0
                                        )
                                      }
                                      data-testid={`input-line-discount-${index}`}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                          <div className="col-span-2">
                            <div className="h-10 flex items-center justify-end font-mono text-sm">
                              {formatCurrency(
                                computeInvoiceFormLine(
                                  watchLines[index] ?? EMPTY_LINE,
                                  standardRate
                                ).lineTotal,
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
                          {(watchLines[index]?.vatSupplyType ?? "standard_rated") ===
                            "standard_rated" && (
                            <div className="col-span-12 flex flex-wrap items-center gap-3">
                              <FormField
                                control={form.control}
                                name={`lines.${index}.marginScheme`}
                                render={({ field }) => (
                                  <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                      <Switch
                                        checked={!!field.value}
                                        onCheckedChange={field.onChange}
                                        aria-label={t["invoices.marginScheme"]}
                                        data-testid={`switch-line-margin-${index}`}
                                      />
                                    </FormControl>
                                    <span className="text-sm">{t["invoices.marginScheme"]}</span>
                                  </FormItem>
                                )}
                              />
                              {watchLines[index]?.marginScheme && (
                                <>
                                  <FormField
                                    control={form.control}
                                    name={`lines.${index}.marginPurchaseCost`}
                                    render={({ field }) => (
                                      <FormItem className="w-40">
                                        <FormControl>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min={0}
                                            placeholder={t["invoices.marginPurchaseCost"]}
                                            aria-label={t["invoices.marginPurchaseCost"]}
                                            className="font-mono"
                                            value={field.value ?? ""}
                                            onChange={(e) =>
                                              field.onChange(
                                                e.target.value ? parseFloat(e.target.value) : 0
                                              )
                                            }
                                            data-testid={`input-line-margin-cost-${index}`}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    )}
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    {t["invoices.marginSchemeHint"]}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="border-t pt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t.subtotal}</span>
                        <span className="font-mono font-medium">
                          {formatCurrency(subtotal, "AED", locale)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {t.vat} (
                          {formTotals.ratesCharged.length
                            ? formTotals.ratesCharged
                                .map((r) => `${Math.round(r * 100)}%`)
                                .join(" / ")
                            : "0%"}
                          )
                        </span>
                        <span className="font-mono font-medium">
                          {formatCurrency(vatAmount, "AED", locale)}
                        </span>
                      </div>
                      <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                        <span>{t.total}</span>
                        <span className="font-mono">{formatCurrency(total, "AED", locale)}</span>
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
                          <p className="font-mono text-sm font-semibold truncate">
                            {invoice.number}
                          </p>
                          <p className="text-sm font-medium truncate">{invoice.customerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(invoice.date, locale)}
                          </p>
                        </div>
                        <p className="font-mono text-sm font-semibold shrink-0">
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
                            <SelectItem value="partial">
                              <T k="pages.partial" />
                            </SelectItem>
                            <SelectItem value="void">{t.void}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditInvoice(invoice)}
                          data-testid={`mobile-button-edit-invoice-${invoice.id}`}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          data-testid={`mobile-button-proof-invoice-${invoice.id}`}
                        >
                          <Link href={evidenceSourceHref("invoice", invoice.id)}>
                            <FileText className="w-4 h-4 mr-1" />
                            <T k="reportCenter.proof" />
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
                        <TableHead className="font-semibold text-right">{t.total}</TableHead>
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
                          <TableCell className="text-right font-mono font-medium">
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
                                  <T k="pages.partial" />
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
                                className="ml-1 text-[10px] px-1 py-0 bg-info-subtle text-info border-info/30"
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
                                  <FileText className="w-4 h-4 mr-2" />
                                  <T k="reportCenter.proof" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditInvoice(invoice)}
                                data-testid={`button-edit-invoice-${invoice.id}`}
                              >
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    // Fetch full invoice details with lines using apiRequest
                                    const invoiceDetails = await apiRequest(
                                      "GET",
                                      `/api/invoices/${invoice.id}`
                                    );

                                    // Check if company is VAT registered
                                    const isVATRegistered = !!(
                                      company?.trnVatNumber && company.trnVatNumber.length > 0
                                    );

                                    await downloadInvoicePDF({
                                      invoiceNumber: invoiceDetails.number,
                                      date: invoiceDetails.date.toString(),
                                      customerName: invoiceDetails.customerName,
                                      customerTRN: invoiceDetails.customerTrn || undefined,
                                      companyName: company?.name || "Your Company",
                                      companyTRN: company?.trnVatNumber || undefined,
                                      companyAddress: company?.businessAddress || undefined,
                                      companyPhone: company?.contactPhone || undefined,
                                      companyEmail: company?.contactEmail || undefined,
                                      companyWebsite: company?.websiteUrl || undefined,
                                      companyLogo:
                                        (await fetchCompanyLogoDataUrl(company)) ?? undefined,
                                      lines: invoiceDetails.lines || [],
                                      subtotal: invoiceDetails.subtotal,
                                      vatAmount: invoiceDetails.vatAmount,
                                      total: invoiceDetails.total,
                                      currency: invoiceDetails.currency,
                                      locale,
                                      companyType: company?.companyType,
                                      // Invoice customization settings
                                      showLogo:
                                        company?.invoiceShowLogo !== undefined
                                          ? company.invoiceShowLogo
                                          : true,
                                      showAddress:
                                        company?.invoiceShowAddress !== undefined
                                          ? company.invoiceShowAddress
                                          : true,
                                      showPhone:
                                        company?.invoiceShowPhone !== undefined
                                          ? company.invoiceShowPhone
                                          : true,
                                      showEmail:
                                        company?.invoiceShowEmail !== undefined
                                          ? company.invoiceShowEmail
                                          : true,
                                      showWebsite:
                                        company?.invoiceShowWebsite === true ? true : undefined,
                                      customTitle: company?.invoiceCustomTitle || undefined,
                                      footerNote: company?.invoiceFooterNote || undefined,
                                      isVATRegistered,
                                    });

                                    toast({
                                      title: "PDF Downloaded",
                                      description: "Invoice PDF has been downloaded successfully",
                                    });
                                  } catch (error: any) {
                                    toast({
                                      title: "Error",
                                      description: error?.message || "Failed to generate PDF",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                data-testid={`button-download-pdf-${invoice.id}`}
                              >
                                <Download className="w-4 h-4 mr-2" />
                                PDF
                              </Button>
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
                                      title: "E-Invoice generated",
                                      description: `UUID: ${result.uuid}`,
                                    });
                                    queryClient.invalidateQueries({
                                      queryKey: ["/api/companies", selectedCompanyId, "invoices"],
                                    });
                                  } catch (error: any) {
                                    // W4-C: a 422 carries the full fix-it / validation list.
                                    const issues =
                                      error instanceof ApiError && error.status === 422
                                        ? einvoiceIssuesFromError(error.body)
                                        : [];
                                    if (issues.length > 0) {
                                      setEinvoiceIssues({ number: invoice.number, issues });
                                      return;
                                    }
                                    toast({
                                      title: "Error",
                                      description: error?.message,
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                title="Generate E-Invoice"
                                data-testid={`button-einvoice-${invoice.id}`}
                              >
                                <FileCode className="w-4 h-4 text-info" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Add Payment"
                                onClick={() => {
                                  setInvoiceForPaymentDetail(invoice);
                                  setPaymentAmount("");
                                  setPaymentAccountForAdd("");
                                  setPaymentMethod("bank");
                                  setPaymentReference("");
                                  setPaymentNotes("");
                                  setAddPaymentDialogOpen(true);
                                }}
                                data-testid={`button-add-payment-${invoice.id}`}
                              >
                                <DollarSign className="w-4 h-4 text-success" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="View Payments"
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
                                      title: "Error",
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
                                title="Set Recurring"
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
                                  title="Create Credit Note"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Create a credit note for Invoice ${invoice.number}? This will reverse the journal entry.`
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
                                      Delete Invoice {invoice.number}?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete this invoice. This action cannot
                                      be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      <T k="pages.cancel" />
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteMutation.mutate(invoice.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      <T k="hr.delete" />
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
                                    ? "No invoices in this date range"
                                    : ((t as any).noInvoicesYet ?? "No invoices yet")
                                }
                                description={
                                  dateRange.from || dateRange.to
                                    ? "Try widening the date filter or clearing it to see all invoices."
                                    : ((t as any).createFirstInvoice ??
                                      "Create your first invoice — VAT, sequential numbering, and PDFs are handled automatically.")
                                }
                                action={
                                  !dateRange.from && !dateRange.to
                                    ? {
                                        label: (t as any).newInvoiceCta ?? "New invoice",
                                        icon: Plus,
                                        onClick: () => setDialogOpen(true),
                                        testId: "button-create-first-invoice",
                                      }
                                    : undefined
                                }
                                secondaryAction={
                                  dateRange.from || dateRange.to
                                    ? {
                                        label: "Clear filter",
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
              <div
                ref={loadMoreRef}
                className="flex justify-center py-3"
                data-testid="invoices-load-more"
              >
                {invoicePages.hasNextPage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={invoicePages.isFetchingNextPage}
                    onClick={() => invoicePages.fetchNextPage()}
                  >
                    {invoicePages.isFetchingNextPage
                      ? t["invoices.loading"]
                      : t["invoices.loadMore"]}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="branding" className="space-y-6 mt-0">
          {isLoading ? (
            <Skeleton className="h-96" />
          ) : !company ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                <T k="pageLabels.companyNotFound" />
              </p>
            </div>
          ) : (
            <div className="space-y-6 max-w-3xl">
              {isVATRegistered && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Your company is VAT registered. All invoices will automatically display your TRN
                    ({company.trnVatNumber}) and be labeled as "Tax Invoice" to comply with UAE FTA
                    requirements.
                  </AlertDescription>
                </Alert>
              )}

              <Form {...brandingForm}>
                <form onSubmit={brandingForm.handleSubmit(onBrandingSubmit)} className="space-y-8">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        <T k="pageLabels.companyDetailsDisplay" />
                      </CardTitle>
                      <CardDescription>
                        <T k="pageLabels.chooseWhichCompanyInformationToDisplayOnInvoices" />
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowLogo"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">
                                <T k="pages.showCompanyLogo" />
                              </FormLabel>
                              <FormDescription>
                                Display your company logo at the top of invoices
                                {!companyLogoSrc(company) && (
                                  <span className="block text-xs text-warning mt-1">
                                    Note: Set your logo in Company Profile first
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!companyLogoSrc(company)}
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
                                <T k="pageLabels.showBusinessAddress" />
                              </FormLabel>
                              <FormDescription>
                                Display your business address on invoices
                                {!company.businessAddress && (
                                  <span className="block text-xs text-warning mt-1">
                                    Note: Set your address in Company Profile first
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
                              <FormLabel className="text-base">
                                <T k="pageLabels.showPhoneNumber" />
                              </FormLabel>
                              <FormDescription>
                                Display your business phone number on invoices
                                {!company.contactPhone && (
                                  <span className="block text-xs text-warning mt-1">
                                    Note: Set your phone in Company Profile first
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
                              <FormLabel className="text-base">
                                <T k="pageLabels.showEmailAddress" />
                              </FormLabel>
                              <FormDescription>
                                Display your business email on invoices
                                {!company.contactEmail && (
                                  <span className="block text-xs text-warning mt-1">
                                    Note: Set your email in Company Profile first
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
                              <FormLabel className="text-base">
                                <T k="pageLabels.showWebsite" />
                              </FormLabel>
                              <FormDescription>
                                Display your website URL on invoices
                                {!company.websiteUrl && (
                                  <span className="block text-xs text-warning mt-1">
                                    Note: Set your website in Company Profile first
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
                      <CardTitle>
                        <T k="pageLabels.invoiceCustomization" />
                      </CardTitle>
                      <CardDescription>
                        <T k="pageLabels.customizeTheAppearanceAndTextOfYourInvoices" />
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <FormField
                        control={brandingForm.control}
                        name="invoiceCustomTitle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <T k="pageLabels.invoiceTitle" />
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder={
                                  isVATRegistered ? "Tax Invoice (default)" : "Invoice (default)"
                                }
                                {...field}
                                data-testid="input-invoice-title"
                              />
                            </FormControl>
                            <FormDescription>
                              {isVATRegistered
                                ? 'For VAT-registered companies, invoices default to "Tax Invoice". You can customize this, but it must comply with FTA regulations.'
                                : 'Custom title for your invoices. Leave blank to use "Invoice".'}
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
                            <FormLabel>
                              <T k="pageLabels.footerNote" />
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Thank you for your business"
                                className="resize-none"
                                rows={3}
                                {...field}
                                data-testid="textarea-footer-note"
                              />
                            </FormControl>
                            <FormDescription>
                              Add a custom message at the bottom of your invoices (e.g., payment
                              terms, thank you message)
                            </FormDescription>
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
                      <Save className="w-4 h-4 mr-2" />
                      {updateBrandingMutation.isPending ? "Saving..." : "Save Settings"}
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
              <T k="pageLabels.similarInvoicesFound" />
            </DialogTitle>
            <DialogDescription>
              We found similar invoices that might be duplicates. Review them before proceeding.
            </DialogDescription>
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
                    <p className="font-mono font-semibold">
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
                <T k="pages.cancel" />
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
                <T k="pageLabels.createAnyway" />
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
              <T k="pageLabels.recurringInvoiceSettings" />
            </DialogTitle>
            <DialogDescription>
              Configure automatic recurring copies for Invoice {invoiceForRecurring?.number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">
                  <T k="pageLabels.enableRecurring" />
                </p>
                <p className="text-sm text-muted-foreground">
                  <T k="pageLabels.automaticallyCreateNewInvoiceCopiesOnSchedule" />
                </p>
              </div>
              <Switch checked={recurringEnabled} onCheckedChange={setRecurringEnabled} />
            </div>

            {recurringEnabled && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    <T k="pageLabels.frequency" />
                  </label>
                  <Select value={recurringInterval} onValueChange={setRecurringInterval}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">
                        <T k="pageLabels.weekly" />
                      </SelectItem>
                      <SelectItem value="monthly">
                        <T k="firm.cycleMonthly" />
                      </SelectItem>
                      <SelectItem value="quarterly">
                        <T k="firm.cycleQuarterly" />
                      </SelectItem>
                      <SelectItem value="yearly">
                        <T k="pageLabels.yearly" />
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    <T k="pageLabels.nextRunDate" />
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {recurringNextDate ? format(recurringNextDate, "PPP") : "Pick a date"}
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
                  <label className="text-sm font-medium">End Date (optional)</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {recurringEndDate ? format(recurringEndDate, "PPP") : "No end date"}
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
                      <T k="pageLabels.clearEndDate" />
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
              <T k="pages.cancel" />
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
              {setRecurringMutation.isPending ? "Saving..." : "Save"}
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
              <T k="pages.recordPayment" />
            </DialogTitle>
            <DialogDescription>
              Record a payment received for Invoice {invoiceForPaymentDetail?.number} (Total:{" "}
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
              <label className="text-sm font-medium">
                <T k="banking.common.amount" />
              </label>
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
              <label className="text-sm font-medium">
                <T k="pages.paymentMethod" />
              </label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">
                    <T k="pages.bankTransfer" />
                  </SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">
                    <T k="pages.cheque" />
                  </SelectItem>
                  <SelectItem value="online">
                    <T k="pageLabels.onlinePayment" />
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                <T k="pageLabels.depositAccount" />
              </label>
              {paymentAccounts.length > 0 ? (
                <Select value={paymentAccountForAdd} onValueChange={setPaymentAccountForAdd}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account..." />
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
                  <AlertDescription>
                    No cash/bank accounts found. Create one in Chart of Accounts.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Reference (optional)</label>
              <Input
                placeholder="e.g. Bank ref, cheque no."
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Input
                placeholder="Additional notes"
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
              <T k="pages.cancel" />
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
                    date: new Date().toISOString(),
                  },
                });
              }}
              disabled={addPaymentMutation.isPending || !paymentAmount || !paymentAccountForAdd}
              className="flex-1"
            >
              {addPaymentMutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Payments Dialog */}
      <Dialog open={viewPaymentsDialogOpen} onOpenChange={setViewPaymentsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment History — Invoice {invoiceForPaymentDetail?.number}</DialogTitle>
            <DialogDescription>
              <T k="pageLabels.allPaymentsRecordedForThisInvoice" />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {invoicePayments.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">
                <T k="pageLabels.noPaymentsRecordedYet" />
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>
                        <T k="consolidation.method" />
                      </TableHead>
                      <TableHead>
                        <T k="banking.common.reference" />
                      </TableHead>
                      <TableHead className="text-right">
                        <T k="banking.common.amount" />
                      </TableHead>
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
                        <TableCell className="text-right font-mono font-medium">
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
                  <span>
                    <T k="pages.totalPaid" />
                  </span>
                  <span className="font-mono">
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
            <T k="banking.common.close" />
          </Button>
        </DialogContent>
      </Dialog>

      {/* Payment Account Selection Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.selectPaymentAccount" />
            </DialogTitle>
            <DialogDescription>
              Choose where the payment for invoice {invoiceForPayment?.number} was deposited
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
                          <div className="text-sm text-muted-foreground font-mono">
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
                  <AlertDescription>
                    You need to create at least one bank or cash account before marking invoices as
                    paid.
                  </AlertDescription>
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
                  <Plus className="w-4 h-4 mr-2" />
                  Create Bank/Cash Account
                </Button>
              </div>
            )}
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
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={handleConfirmPayment}
              disabled={!selectedPaymentAccount || addPaymentMutation.isPending}
              className="flex-1"
              data-testid="button-confirm-payment"
            >
              {addPaymentMutation.isPending
                ? t["invoices.processing"]
                : t["invoices.recordFullPayment"]}
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
