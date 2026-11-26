import { invoiceRowActions } from "@/lib/invoice-row-actions";
import { T } from "@/components/layout/T";
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { useForm, useFieldArray, type UseFormReturn } from "react-hook-form";
import type { TermsFormShape } from "@/components/invoices/InvoiceTermsFields";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format, startOfDay } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { FormErrorSummary, FormGrid, FormSection } from "@/components/ui/form-layout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { EditorShell } from "@/components/ui/editor-shell";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge, badgeVariants, StatusBadge as InvoiceStatusBadge } from "@/components/ui/badge";
import { statusBadgeVariant, statusDotClass } from "@/components/ui/status-meta";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { Money, MoneyCell } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useOpenInvoiceParam } from "@/hooks/use-open-invoice-param";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { invoiceStatusTargets } from "@/lib/invoice-status";
import { invoiceDisplayStatus } from "@shared/invoice-balance";
import { statusLabelKey } from "@/components/ui/status-meta";
import { formatCurrency, formatDate } from "@/lib/format";
import { isolateLtrText } from "@/lib/format-bidi";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import {
  einvoiceFieldHint,
  einvoiceIssueTextKey,
  einvoiceIssuesFromError,
  einvoiceRuleTextKey,
  type EInvoiceIssueItem,
} from "@/lib/einvoice-issues";
import { EInvoiceListCell } from "@/components/einvoice/EInvoiceListCell";
import { useEInvoiceListEvidence } from "@/components/einvoice/use-einvoice";
import { InvoiceCurrencyFields } from "@/components/invoices/InvoiceCurrencyFields";
import { LineItemPicker } from "@/components/invoices/LineItemPicker";
import { LineIncomeAccountPicker } from "@/components/invoices/LineIncomeAccountPicker";
import { LineCostCentrePicker } from "@/components/invoices/LineCostCentrePicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCostCentres } from "@/hooks/useCostCentres";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { shouldOpenTaxReady } from "@/components/einvoice/use-tax-ready-prompt";
import { taxReadyKey, type TaxReadyState } from "@/components/einvoice/tax-identity";
import { uploadInvoiceAttachment } from "@/lib/invoice-documents";
import { blockingCount, einvoiceChecks, invoiceFormChecks } from "@/lib/invoice-checks";
import { dueDateFromTerms, termsFromDays } from "@shared/sales-documents";
import { rateToSend } from "@/lib/document-currency";
import {
  defaultPaymentAccountId,
  postablePaymentAccounts,
  type BankAccountLike,
} from "@/lib/payment-accounts";
import { EInvoiceHeaderStrip } from "@/components/einvoice/EInvoiceHeaderStrip";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { hasReadData, queryReadState } from "@/lib/queryReadState";
import {
  downloadServerFile,
  exportToExcel,
  exportToGoogleSheets,
  prepareInvoicesForExport,
} from "@/lib/export";
import { ShareInvoiceDialog } from "@/components/invoices/ShareInvoiceDialog";
import { evidenceSourceHref } from "@/lib/evidenceLinks";
import {
  Plus,
  Wallet,
  FileText,
  FileCode,
  CalendarIcon,
  Trash2,
  Download,
  Edit,
  XCircle,
  AlertTriangle,
  AlertCircle,
  FileSpreadsheet,
  DollarSign,
  RefreshCw,
  RotateCcw,
  Share2,
  Lock,
  X,
} from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import type { Invoice, InvoicePayment } from "@shared/schema";
import type { InvoiceListItem } from "@shared/invoice-balance";
import { computeInvoiceTiles } from "@/lib/invoice-tiles";
import { cn } from "@/lib/utils";
import {
  computeInvoiceFormLine,
  computeInvoiceFormTotals,
  lineVatRate,
} from "@/lib/invoice-totals";
import { UAE_STANDARD_VAT_RATE } from "@shared/vat-classification";
import {
  blankInvoiceLine,
  defaultLineIncomeAccountId,
  isUntouchedBlankLine,
  isVatRegisteredCompany,
} from "@/lib/invoice-defaults";
import {
  collectInvoiceExportRows,
  filterInvoiceDates,
  invoiceStatusQuery,
  parseInvoiceStatusFilter,
  type InvoiceStatusFilter,
} from "@/lib/invoice-filters";
import { accountDisplayName } from "@/lib/account-name";
import { parseCalendarDate } from "@/lib/format-date";

// D5b: the bilingual preview is its own chunk (only loaded when the invoice dialog opens).
// Mounted only while open: the dialogs and their queries stay out of the list's first render.
const CustomerDepositsDialog = lazy(() =>
  import("./invoices/CustomerDepositsDialog").then((m) => ({ default: m.CustomerDepositsDialog }))
);
const WriteOffInvoiceDialog = lazy(() =>
  import("@/components/invoices/WriteOffInvoiceDialog").then((m) => ({
    default: m.WriteOffInvoiceDialog,
  }))
);
// WQ1: the editor-only parts load with the editor, not with the list.
const InvoiceTermsFields = lazy(() =>
  import("@/components/invoices/InvoiceTermsFields").then((m) => ({
    default: m.InvoiceTermsFields,
  }))
);
const InvoiceAttachments = lazy(() =>
  import("@/components/invoices/InvoiceAttachments").then((m) => ({
    default: m.InvoiceAttachments,
  }))
);
const InvoiceActivityLog = lazy(() =>
  import("@/components/invoices/InvoiceActivityLog").then((m) => ({
    default: m.InvoiceActivityLog,
  }))
);
const InvoiceChecksPanel = lazy(() =>
  import("@/components/invoices/InvoiceChecksPanel").then((m) => ({
    default: m.InvoiceChecksPanel,
  }))
);
const LeaveWithoutSavingDialog = lazy(() =>
  import("@/components/invoices/LeaveWithoutSavingDialog").then((m) => ({
    default: m.LeaveWithoutSavingDialog,
  }))
);
// WQ5's first-invoice e-invoice details prompt (asks only for missing seller fields, once).
const TaxReadyModal = lazy(() =>
  import("@/components/einvoice/TaxReadyModal").then((m) => ({ default: m.TaxReadyModal }))
);
const InvoicePreview = lazy(() =>
  import("@/components/invoices/InvoicePreview").then((m) => ({ default: m.InvoicePreview }))
);

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
  description: z.string().min(1, "forms.errors.descriptionRequired"),
  quantity: z.coerce.number().min(0.01, "forms.errors.quantityPositive"),
  unitPrice: z.coerce.number().min(0.01, "forms.errors.priceGreaterThanZero"),
  vatRate: z.coerce.number().default(0.05),
  vatSupplyType: z.enum(SUPPLY_TYPE_OPTIONS).default("standard_rated"),
  // R03-07: line discount in percent (0 = none). Sent as discountType/discountValue.
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  // S8 (R07-15): profit-margin scheme (second-hand goods, standard-rated lines only).
  marginScheme: z.boolean().default(false),
  marginPurchaseCost: z.coerce.number().min(0).default(0),
  // X5 (J1 L1): linked product / service (drives the income account on posting).
  productId: z.string().optional(),
  // E3 (J1-r3): the income account the line posts to ("" = by item type).
  revenueAccountId: z.string().optional(),
  // WQ1 (7.2i): the line's cost centre (the revenue line carries it).
  costCenterId: z.string().optional(),
});

// S1 (W5-E): form totals come from the pure, tested client/src/lib/invoice-totals.ts, which
// follows the server engine (fils, half-up, VAT rounded once per document).

const invoiceSchema = z.object({
  companyId: z.string().guid(),
  // R18-06: the server allocates the gap-free FTA number on save, so new
  // invoices carry no client-side number.
  number: z.string(),
  customerName: z.string().min(1, "forms.errors.customerNameRequired"),
  customerTrn: z.string().optional(),
  contactId: z.string().optional(),
  placeOfSupplyEmirate: z.string().optional(),
  date: z.date(),
  currency: z.string().default("AED"),
  /** X5 (J1 D2): rate to the base currency for a foreign invoice; blank = company rate. */
  exchangeRate: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d+(\.\d{1,6})?$/.test(v.trim()) && Number(v) > 0), {
      message: "forms.errors.exchangeRateInvalid",
    }),
  // WQ1 (7.2b, 7.2g, 7.21): terms and the due date they give, notes, the PDF language.
  paymentTerms: z.string().optional(),
  dueDate: z.date().optional().nullable(),
  notes: z.string().max(4000).optional(),
  documentLanguage: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, "forms.errors.lineItemRequired"),
});

type InvoiceFormData = z.infer<typeof invoiceSchema>;

/** The invoice-wide fields a blank invoice starts with. */
const BLANK_HEADER = {
  number: "",
  customerName: "",
  customerTrn: "",
  paymentTerms: "net30",
  dueDate: null,
  notes: "",
  documentLanguage: "company",
};

/** An e-invoice validator answer (GET /api/invoices/:id/einvoice/validate). */
interface EInvoiceValidation {
  valid: boolean;
  issues: EInvoiceIssueItem[];
}

const isoDay = (d: Date) => format(d, "yyyy-MM-dd");

/** Whole days past the due date for an open (sent / part-paid) invoice; 0 when not overdue. */
function invoiceOverdueDays(invoice: InvoiceListItem): number {
  if (invoice.status !== "sent" && invoice.status !== "partial") return 0;
  if (!invoice.dueDate) return 0;
  const open = invoice.openBalance ?? Number(invoice.total);
  if (!(open > 0)) return 0;
  const dueDay = new Date(invoice.dueDate as unknown as string).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((Date.parse(today) - Date.parse(dueDay)) / 86400000);
  return days > 0 ? days : 0;
}

function OverdueBadge({ invoice }: { invoice: InvoiceListItem }) {
  const { t } = useTranslation();
  const days = invoiceOverdueDays(invoice);
  if (days <= 0) return null;
  return (
    <StatusBadge tone="danger" data-testid={`badge-overdue-${invoice.id}`}>
      {days === 1 ? t["invoices.overdueDay"] : formatMessage(t["invoices.overdueDays"], { days })}
    </StatusBadge>
  );
}

/** C2 (NL3): a settled invoice whose balance was written off as a bad debt, not paid. */
function WrittenOffBadge({ invoice }: { invoice: InvoiceListItem }) {
  const { t } = useTranslation();
  if (!((invoice.amountWrittenOff ?? 0) > 0)) return null;
  const full = invoice.status === "paid";
  return (
    <StatusBadge tone="warning" data-testid={`badge-written-off-${invoice.id}`}>
      {full ? t["invoices.writtenOff"] : t["invoices.partlyWrittenOff"]}
    </StatusBadge>
  );
}

/** Display text of an invoice row's status (credited / applied read from the credit settlement). */
function invoiceStatusText(t: Record<string, string>, invoice: InvoiceListItem): string {
  const shown = invoiceDisplayStatus(invoice);
  if (shown === "credited" || shown === "applied") {
    const key = statusLabelKey(shown);
    return (key && t[key]) || shown;
  }
  return t[shown] ?? shown;
}

function BalanceLine({ invoice }: { invoice: InvoiceListItem }) {
  const { t } = useTranslation();
  const open = invoice.openBalance;
  if (open === undefined || !(open > 0) || open >= Number(invoice.total)) return null;
  return (
    <div className="text-caption font-normal text-muted-foreground">
      {t["invoices.colBalance"]} <Money amount={open} currency={invoice.currency} />
    </div>
  );
}

/** Only issued documents have a public link (the share endpoint refuses drafts and cancelled). */
/** Issued and not settled: the row's one inline action is "Record payment". */
const OPEN_FOR_PAYMENT = new Set(["sent", "partial", "overdue", "viewed"]);

function isShareable(invoice: { status?: string | null }) {
  return invoice.status !== "draft" && invoice.status !== "cancelled";
}

/**
 * Invoices list and the full-page invoice editor (spec 3.7). The editor has its own routes,
 * `/invoices/new` and `/invoices/:id/edit`. Rendered outside the app's router (unit tests) the
 * page is not on an /invoices path, so the editor simply opens in place.
 */
export default function Invoices() {
  const [location, navigate] = useLocation();
  const routed = location.startsWith("/invoices");
  const [isNewRoute] = useRoute("/invoices/new");
  const [isEditRoute, editParams] = useRoute<{ id: string }>("/invoices/:id/edit");
  /** "new", or the id of the invoice being edited, when on an editor route. */
  const editor = isNewRoute ? "new" : isEditRoute ? editParams?.id : undefined;
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const {
    company,
    companyId: selectedCompanyId,
    companyListState,
    error: companyError,
    retryCompanyList,
  } = useDefaultCompany();
  const { can: canDo, gate } = useCompanyPermission();
  // Issuing or voiding writes the ledger (PATCH /status needs ledger.post, like POST /post).
  const canChangeStatus = canDo("ledger.post");
  const baseCurrency: string =
    (company as { baseCurrency?: string } | undefined)?.baseCurrency || "AED";
  // Standard VAT rate: UAE 5%.
  const standardRate = UAE_STANDARD_VAT_RATE;
  // X6a: a company without a TRN is not VAT registered; its new lines start at 0% out of scope.
  const vatRegistered = isVatRegisteredCompany(company);
  // E3 (J1-r3): a services company's new lines start on Service Revenue, not Product Sales.
  const { data: lineAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts"],
    enabled: !!selectedCompanyId,
  });
  const { data: lineProducts = [] } = useQuery<
    Array<{ productType?: string | null; isActive?: boolean | null }>
  >({
    queryKey: ["/api/companies", selectedCompanyId, "products"],
    enabled: !!selectedCompanyId,
    retry: false,
  });
  const defaultIncomeAccountId = useMemo(
    () => defaultLineIncomeAccountId(lineAccounts, lineProducts),
    [lineAccounts, lineProducts]
  );
  const blankLine = useCallback(
    () => ({ ...blankInvoiceLine(vatRegistered), revenueAccountId: defaultIncomeAccountId }),
    [vatRegistered, defaultIncomeAccountId]
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [depositsOpen, setDepositsOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  // R18-07: a freshly saved invoice is a draft; offer to issue it right away.
  const [draftNudge, setDraftNudge] = useState<{ id: string; number: string } | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [invoiceForPayment, setInvoiceForPayment] = useState<Invoice | null>(null);
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<string>("");
  const [similarWarningOpen, setSimilarWarningOpen] = useState(false);
  const [similarInvoices, setSimilarInvoices] = useState<any[]>([]);
  const [pendingInvoiceData, setPendingInvoiceData] = useState<any>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [invoiceToShare, setInvoiceToShare] = useState<{ id: string; number: string } | null>(null);
  const [invoiceToWriteOff, setInvoiceToWriteOff] = useState<{ id: string; number: string } | null>(
    null
  );

  // Virtual scrolling for large invoice lists.
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // WQ1: a due date picked by hand stays until the terms change; files chosen before the first
  // save upload right after it; the side panel shows the preview or the Checks.
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [sidePanel, setSidePanel] = useState<"preview" | "checks">("preview");
  // WQ1 (13.5): "Source: API" and the other origins (server-side filter).
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Payment tracking dialog state
  const [addPaymentDialogOpen, setAddPaymentDialogOpen] = useState(false);
  const [einvoiceIssues, setEinvoiceIssues] = useState<{
    number: string;
    invoiceId: string;
    contactId: string | null;
    issues: EInvoiceIssueItem[];
  } | null>(null);
  const [viewPaymentsDialogOpen, setViewPaymentsDialogOpen] = useState(false);
  const [invoiceForPaymentDetail, setInvoiceForPaymentDetail] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentAccountForAdd, setPaymentAccountForAdd] = useState("");
  // X5 (J1 D2): payment date and payment-date FX rate (blank = company rate for the date).
  const [paymentDate, setPaymentDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [paymentRate, setPaymentRate] = useState("");
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);
  const [invoicePendingDelete, setInvoicePendingDelete] = useState<Invoice | null>(null);

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
  // walk the same status and source filters through every page.
  const invoicePageFilters = `${invoiceStatusQuery(statusFilter)}${sourceFilter !== "all" ? `&source=${encodeURIComponent(sourceFilter)}` : ""}`;
  const fetchInvoicePage = (
    cursor?: string | null
  ): Promise<{ items: Invoice[]; nextCursor: string | null }> =>
    apiRequest(
      "GET",
      `/api/companies/${selectedCompanyId}/invoices?limit=50${invoicePageFilters}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
    );
  const invoicePages = useInfiniteQuery<{ items: Invoice[]; nextCursor: string | null }>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "invoices",
      "paged",
      statusFilter ?? "all",
      sourceFilter,
    ],
    queryFn: ({ pageParam }) => fetchInvoicePage(typeof pageParam === "string" ? pageParam : null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!selectedCompanyId,
  });
  // "pending" also covers a paused or not-yet-enabled first read, which is not an empty list.
  const invoiceReadState = queryReadState(invoicePages);
  const invoices = useMemo<Invoice[]>(
    () =>
      hasReadData(invoiceReadState) ? (invoicePages.data?.pages.flatMap((p) => p.items) ?? []) : [],
    [invoiceReadState, invoicePages.data]
  );
  // A failed next page keeps the loaded rows; Retry asks for that page again.
  const retryInvoicePages = () =>
    void (invoicePages.isFetchNextPageError
      ? invoicePages.fetchNextPage()
      : invoicePages.refetch());
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting &&
        invoicePages.hasNextPage &&
        !invoicePages.isFetchingNextPage &&
        // After a failure the reader retries; scrolling must not loop on it.
        !invoicePages.isError
      ) {
        invoicePages.fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [invoicePages]);

  const { data: contacts = [] } = useQuery<
    Array<{
      id: string;
      name: string;
      trnNumber?: string | null;
      emirate?: string | null;
      address?: string | null;
      city?: string | null;
      paymentTerms?: number | null;
      email?: string | null;
    }>
  >({
    queryKey: ["/api/companies", selectedCompanyId, "customer-contacts"],
    enabled: !!selectedCompanyId,
  });

  // R1: tell the user up front when the e-invoice buyer-address rule (ibr-144-ae) will bite.
  const { data: einvoiceSettings } = useQuery<{ scope?: { scope?: string | null } }>({
    queryKey: ["/api/companies", selectedCompanyId, "einvoicing", "settings"],
    enabled: !!selectedCompanyId,
    retry: false,
  });
  const einvoiceEnabled = ["b2b", "b2g", "b2b_b2g"].includes(einvoiceSettings?.scope?.scope ?? "");

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts"],
    enabled: !!selectedCompanyId,
  });
  // X5 (J1 D1): payments default to the primary bank account's GL, never a header account.
  const { data: bankAccounts = [] } = useQuery<BankAccountLike[]>({
    queryKey: ["/api/companies", selectedCompanyId, "bank-accounts"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      ...BLANK_HEADER,
      date: new Date(),
      currency: baseCurrency,
      lines: [blankLine()],
    },
  });
  const { data: costCentres = [] } = useCostCentres(selectedCompanyId);

  // WQ1 (7.2b): the due date follows the date and the payment terms until it is picked by hand.
  const watchDate = form.watch("date");
  const watchTerms = form.watch("paymentTerms");
  useEffect(() => {
    if (dueDateTouched || !watchDate) return;
    const due = dueDateFromTerms(isoDay(watchDate), watchTerms || "net30");
    const next = due ? parseCalendarDate(due) : null;
    const current = form.getValues("dueDate");
    if ((current ? isoDay(current) : null) !== (next ? isoDay(next) : null)) {
      form.setValue("dueDate", next, { shouldDirty: false });
    }
  }, [dueDateTouched, watchDate, watchTerms, form]);

  // X6a: the company (and so its TRN) can load after the form is created. A new invoice whose
  // only line is still untouched follows the company's VAT registration once it is known.
  useEffect(() => {
    if (editingInvoice) return;
    const current = form.getValues("lines");
    if (current.length === 1 && isUntouchedBlankLine(current[0])) {
      form.setValue("lines", [blankLine()]);
    }
  }, [blankLine, editingInvoice, form]);

  // R18-12: the dashboard's guided first-invoice entry point links to
  // /invoices?new=1, which opens the New Invoice dialog straight away. The
  // param is stripped when the dialog closes: rewriting the URL while the dialog
  // is open would change the router location key and remount the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      if (routed && !editor) navigate("/invoices/new", { replace: true });
      else setEditorOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The editor routes: open a blank invoice or load the one being edited.
  useEffect(() => {
    if (editor === "new") setEditorOpen(true);
    else if (editor) void handleEditInvoice({ id: editor } as Invoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // R18-07 after a routed save: the list reopens with the draft nudge for the new invoice.
  useEffect(() => {
    if (typeof window === "undefined" || editor) return;
    const params = new URLSearchParams(window.location.search);
    const issueId = params.get("issue");
    if (issueId) setDraftNudge({ id: issueId, number: params.get("number") ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R3 (CTO 17) + STEP1 F3: command-palette and notification links open /invoices?open=<id> in
  // the invoice view, on every navigation (the bell navigates while this page is mounted).
  useOpenInvoiceParam((openId) => openInvoiceEditor({ id: openId } as Invoice), "/invoices");

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

  /** Drops the one-shot `issue` / `number` params once the draft nudge has been answered. */
  const stripIssueParams = () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("issue")) return;
    params.delete("issue");
    params.delete("number");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash
    );
  };

  const openNewInvoice = () => {
    if (routed) navigate("/invoices/new");
    else setEditorOpen(true);
  };

  function openInvoiceEditor(invoice: Invoice) {
    if (routed && editor !== invoice.id) navigate(`/invoices/${invoice.id}/edit`);
    else void handleEditInvoice(invoice);
  }

  /** Leaves the editor without saving. */
  const closeEditor = () => {
    if (routed && editor) {
      navigate("/invoices");
      return;
    }
    setEditorOpen(false);
    stripNewInvoiceParam();
    setEditingInvoice(null);
    setDueDateTouched(false);
    setPendingAttachments([]);
    form.reset({
      companyId: selectedCompanyId,
      ...BLANK_HEADER,
      date: new Date(),
      currency: baseCurrency,
      exchangeRate: "",
      lines: [blankLine()],
    });
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
        title: t["invoices.toastCreated"],
        description: t["invoices.toastCreatedBody"],
      });
      if (created?.id && (created.status ?? "draft") === "draft") {
        setDraftNudge({ id: created.id, number: created.number ?? "" });
      }
      setEditorOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        ...BLANK_HEADER,
        date: new Date(),
        currency: baseCurrency,
        lines: [blankLine()],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: t["invoices.toastCreateFailed"],
        description: error?.message || t["invoices.toastTryAgain"],
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
        title: t["invoices.toastUpdated"],
        description: t["invoices.toastUpdatedBody"],
      });
      setEditorOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        ...BLANK_HEADER,
        date: new Date(),
        currency: baseCurrency,
        lines: [blankLine()],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: t["invoices.toastUpdateFailed"],
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
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
        title: t["invoices.toastStatusUpdated"],
        description: t["invoices.toastStatusUpdatedBody"],
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
      if (error?.body?.code === "SUPPLIER_TRN_REQUIRED") {
        // X6a: the company has no TRN, so it may not charge VAT: say so and link to the fix.
        toast({
          variant: "destructive",
          title: t["invoices.noTrnVatTitle"],
          description: t["invoices.noTrnVatBody"],
          action: (
            <ToastAction altText={t["invoices.supplierTrnRequiredLink"]} asChild>
              <Link href="/company-profile" data-testid="link-company-settings-trn">
                {t["invoices.supplierTrnRequiredLink"]}
              </Link>
            </ToastAction>
          ),
        });
        return;
      }
      toast({
        variant: "destructive",
        title: t["invoices.toastStatusFailed"],
        description: error?.message || t["invoices.toastTryAgain"],
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
    onSuccess: (result: { outcome?: string } | null) => {
      toast(
        result?.outcome === "cancelled"
          ? {
              title: t["invoices.draftCancelledTitle"],
              description: t["invoices.draftCancelledBody"],
            }
          : { title: t.invoiceDeleted, description: t.invoiceDeletedDesc }
      );
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
        title: t["invoices.toastPaymentRecorded"],
        description: formatMessage(t["invoices.toastPaymentRecordedBody"], {
          status: t[`invoices.statusFilter.${result.status}`] ?? String(result.status ?? ""),
        }),
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
        title: t["invoices.toastPaymentFailed"],
        description: error?.message,
      });
    },
  });

  const handleStatusChange = (invoice: Invoice, newStatus: string) => {
    // paid / partial are never set here: they come from recording a payment (row menu).
    updateStatusMutation.mutate({ id: invoice.id, status: newStatus });
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

  // R03-05: only cash and bank accounts (sub-type cash | bank) can receive payments;
  // X5: header accounts (with sub-accounts) never receive postings.
  const paymentAccounts = postablePaymentAccounts(accounts);

  // Row actions (D2b, CTO issue 3): handlers shared by the visible buttons and the ... menu.
  const downloadInvoicePdf = async (invoice: Invoice) => {
    try {
      // The server renders the PDF (Arabic shaping, bilingual layout, company branding).
      await downloadServerFile(`/api/invoices/${invoice.id}/pdf`, `invoice-${invoice.number}.pdf`);
      toast({
        title: t["invoices.toastPdfDownloaded"],
        description: t["invoices.toastPdfDownloadedBody"],
      });
    } catch (error: any) {
      toast({
        title: t["invoices.toastPdfFailed"],
        description: error?.message,
        variant: "destructive",
      });
    }
  };
  const generateEinvoice = async (invoice: Invoice) => {
    try {
      const result = await apiRequest("POST", `/api/invoices/${invoice.id}/generate-einvoice`);
      toast({
        title: t["invoices.toastEinvoiceGenerated"],
        description: formatMessage(translateNow("toasts.uuid"), { uuid: result.uuid }),
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "einvoicing"],
      });
    } catch (error: any) {
      // W4-C: a 422 carries the full fix-it / validation list.
      const issues =
        error instanceof ApiError && error.status === 422
          ? einvoiceIssuesFromError(error.body)
          : [];
      if (issues.length > 0) {
        setEinvoiceIssues({
          number: invoice.number,
          invoiceId: invoice.id,
          contactId: invoice.contactId ?? null,
          issues,
        });
        return;
      }
      toast({
        title: t["invoices.error"],
        description: error?.message,
        variant: "destructive",
      });
    }
  };
  const openAddPayment = (invoice: Invoice) => {
    setInvoiceForPaymentDetail(invoice);
    setPaymentAmount("");
    setPaymentAccountForAdd(
      defaultPaymentAccountId(accounts, bankAccounts, { currency: invoice.currency })
    );
    setPaymentDate(format(new Date(), "yyyy-MM-dd"));
    setPaymentRate("");
    setPaymentMethod("bank");
    setPaymentReference("");
    setPaymentNotes("");
    setAddPaymentDialogOpen(true);
  };
  const openViewPayments = async (invoice: Invoice) => {
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
        title: t["invoices.error"],
        description: e?.message,
      });
    }
  };
  // WQ1 (7.13): "Make recurring" opens the recurring-invoice editor seeded from this invoice
  // (the old set-recurring endpoint answered 410 and is gone).
  const openRecurring = (invoice: Invoice) =>
    navigate(`/recurring-invoices/new?fromInvoice=${encodeURIComponent(invoice.id)}`);
  // WQ1 (7.15): a credit note opens the credit-note editor with the invoice's lines prefilled,
  // so part of an invoice can be credited (lines, quantities, VAT per line).
  const requestCreditNote = (invoice: Invoice) =>
    navigate(`/credit-notes/new?invoiceId=${encodeURIComponent(invoice.id)}`);

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
        date: parseCalendarDate(fullInvoice.date),
        paymentTerms: fullInvoice.paymentTerms || "net30",
        dueDate: fullInvoice.dueDate ? parseCalendarDate(fullInvoice.dueDate) : null,
        notes: fullInvoice.notes || "",
        documentLanguage: fullInvoice.documentLanguage || "company",
        currency: fullInvoice.currency || baseCurrency,
        exchangeRate:
          fullInvoice.currency && fullInvoice.currency !== baseCurrency
            ? String(fullInvoice.exchangeRate ?? "")
            : "",
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
                productId?: string | null;
                revenueAccountId?: string | null;
                costCenterId?: string | null;
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
                productId: l.productId || undefined,
                revenueAccountId: l.revenueAccountId || undefined,
                costCenterId: l.costCenterId || undefined,
              })
            )
          : [blankLine()],
      });
      // A stored due date that is not what the terms give was picked by hand: keep it.
      const stored = fullInvoice.dueDate ? String(fullInvoice.dueDate).slice(0, 10) : null;
      const fromTerms = dueDateFromTerms(
        String(fullInvoice.date).slice(0, 10),
        fullInvoice.paymentTerms || "net30"
      );
      setDueDateTouched(!!stored && stored !== fromTerms);
      setPendingAttachments([]);
      setEditorOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: t["invoices.error"],
        description: error?.message || t["invoices.toastLoadFailed"],
      });
    }
  };

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId,
      ...BLANK_HEADER,
      date: new Date(),
      currency: baseCurrency,
      exchangeRate: "",
      lines: [blankLine()],
    });
    setEditingInvoice(null);
    setDueDateTouched(false);
    setPendingAttachments([]);
  };

  const onSubmit = async (data: InvoiceFormData, finalise = false) => {
    try {
      // An issued invoice is immutable: only the fields that do not change the supply or the
      // tax are sent (the server refuses anything else with 409).
      if (editingInvoice && editingInvoice.status !== "draft") {
        await performInvoiceSave(
          {
            paymentTerms: data.paymentTerms || "net30",
            dueDate: data.dueDate ? format(data.dueDate, "yyyy-MM-dd") : null,
            notes: data.notes?.trim() ? data.notes.trim() : null,
            documentLanguage:
              data.documentLanguage === "en" || data.documentLanguage === "ar"
                ? data.documentLanguage
                : null,
          },
          editingInvoice
        );
        return;
      }
      // Strict contract (R03-02): no number, status, totals or companyId.
      const invoiceData = {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        ...(data.contactId ? { contactId: data.contactId } : {}),
        ...(data.placeOfSupplyEmirate ? { placeOfSupplyEmirate: data.placeOfSupplyEmirate } : {}),
        date: format(data.date, "yyyy-MM-dd"),
        paymentTerms: data.paymentTerms || "net30",
        dueDate: data.dueDate ? format(data.dueDate, "yyyy-MM-dd") : null,
        notes: data.notes?.trim() ? data.notes.trim() : null,
        documentLanguage:
          data.documentLanguage === "en" || data.documentLanguage === "ar"
            ? data.documentLanguage
            : null,
        currency: data.currency || baseCurrency,
        // Only a typed foreign rate is sent; otherwise the server resolves it for the date.
        ...(rateToSend(data.currency, baseCurrency, data.exchangeRate)
          ? { exchangeRate: rateToSend(data.currency, baseCurrency, data.exchangeRate) }
          : {}),
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
          ...(line.productId ? { productId: line.productId } : {}),
          ...(line.revenueAccountId && line.vatSupplyType === "standard_rated"
            ? { revenueAccountId: line.revenueAccountId }
            : {}),
          ...(line.costCenterId ? { costCenterId: line.costCenterId } : {}),
        })),
      };

      // Proceed with save directly - similar check removed for better UX
      await performInvoiceSave(invoiceData, editingInvoice, finalise);
    } catch {
      // Error is handled by mutation callbacks
    }
  };

  const performInvoiceSave = async (invoiceData: any, editing: any, finalise = false) => {
    if (editing) {
      await editMutation.mutateAsync({ id: editing.id, data: invoiceData });
      // E1 validate-on-save: the e-invoice status re-runs its checks on the saved data.
      queryClient.invalidateQueries({ queryKey: ["einvoice-status", editing.id] });
      queryClient.invalidateQueries({ queryKey: ["einvoice-validate", editing.id] });
      if (finalise && editing.status === "draft") {
        await updateStatusMutation.mutateAsync({ id: editing.id, status: "sent" });
      }
    } else {
      const created = await createMutation.mutateAsync(invoiceData);
      // WQ1 (7.2g): files chosen before the first save go up now.
      if (created?.id && pendingAttachments.length) {
        const files = pendingAttachments;
        setPendingAttachments([]);
        for (const file of files) {
          try {
            await uploadInvoiceAttachment(created.id, file);
          } catch (error: any) {
            toast({
              variant: "destructive",
              title: t["invoices.attachments.uploadFailed"],
              description: error?.message,
            });
          }
        }
      }
      if (finalise && created?.id) {
        // WQ1 (7.22): Finalise = save and issue in one step (the Checks passed).
        await updateStatusMutation.mutateAsync({ id: created.id, status: "sent" });
        setDraftNudge(null);
        if (routed && editor) {
          navigate("/invoices");
          return;
        }
        setEditorOpen(false);
        resetForm();
        return;
      }
      if (routed && editor) {
        // A new invoice is a draft: the list opens with the "Issue now / Keep as draft" nudge.
        const draft = created?.id && (created.status ?? "draft") === "draft";
        navigate(
          draft
            ? `/invoices?issue=${encodeURIComponent(created.id)}&number=${encodeURIComponent(created.number ?? "")}`
            : "/invoices"
        );
        return;
      }
    }

    if (routed && editor) {
      navigate("/invoices");
      return;
    }
    setEditorOpen(false);
    resetForm();
  };

  // Calculate totals for preview
  const watchLines = form.watch("lines");
  const watchCurrency = form.watch("currency") || baseCurrency;
  const formTotals = computeInvoiceFormTotals(watchLines, standardRate);
  const { subtotal, vatAmount, total } = formTotals;

  // WQ1 (7.3b, 7.22): the live Checks. The generic rules run on every change; for a saved
  // invoice with e-invoicing active the e-invoice validator runs too, debounced.
  const watchCustomerName = form.watch("customerName");
  const watchCustomerTrn = form.watch("customerTrn");
  const watchPlace = form.watch("placeOfSupplyEmirate");
  const watchDue = form.watch("dueDate");
  const formChecks = invoiceFormChecks({
    customerName: watchCustomerName,
    customerTrn: watchCustomerTrn,
    placeOfSupplyEmirate: watchPlace,
    fallbackEmirate: (company as { emirate?: string | null } | undefined)?.emirate ?? null,
    date: watchDate,
    dueDate: watchDue ?? null,
    lines: watchLines,
    vatRegistered,
    einvoiceActive: einvoiceEnabled,
  });
  const validateId = editorOpen && einvoiceEnabled ? editingInvoice?.id : undefined;
  const einvoiceValidation = useQuery<EInvoiceValidation>({
    queryKey: ["einvoice-validate", validateId],
    queryFn: () => apiRequest("GET", `/api/invoices/${validateId}/einvoice/validate`),
    enabled: !!validateId,
    retry: false,
  });
  const checksSignature = JSON.stringify([
    watchCustomerName,
    watchCustomerTrn,
    watchPlace,
    watchLines.length,
  ]);
  const refetchValidation = einvoiceValidation.refetch;
  useEffect(() => {
    if (!validateId) return;
    const timer = setTimeout(() => void refetchValidation(), 800);
    return () => clearTimeout(timer);
  }, [checksSignature, validateId, refetchValidation]);
  const checks = [
    ...formChecks,
    ...einvoiceChecks(einvoiceValidation.data?.issues ?? [], einvoiceEnabled),
  ];
  const blockingChecks = blockingCount(checks);
  const focusField = (field: string) => {
    setSidePanel("checks");
    try {
      form.setFocus(field as Parameters<typeof form.setFocus>[0]);
    } catch {
      // A field without a focusable ref (a select) is still named in the list.
    }
    if (typeof document !== "undefined") {
      const el = document.querySelector(`[name="${field}"]`);
      (el as HTMLElement | null)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  };

  // WQ1 (7.24): "Leave without saving?" while the editor holds unsaved changes.
  const saving =
    createMutation.isPending || editMutation.isPending || updateStatusMutation.isPending;
  const editorDirty = form.formState.isDirty || pendingAttachments.length > 0;
  const leaveGuard = useUnsavedChangesGuard(editorOpen && editorDirty && !saving);
  const isIssued = !!editingInvoice && editingInvoice.status !== "draft";
  // WQ5 (mounted by WQ1): "Save and issue" on a new invoice first asks, once per company, for
  // the seller's missing e-invoice identity fields; Save or Later continues the issue.
  const [taxPrompt, setTaxPrompt] = useState<TaxReadyState | null>(null);
  const finalise = () => void form.handleSubmit((data) => onSubmit(data, true))();
  const onFinaliseClick = async () => {
    if (!editingInvoice && selectedCompanyId) {
      try {
        const state = await queryClient.fetchQuery<TaxReadyState>({
          queryKey: taxReadyKey(selectedCompanyId),
          queryFn: () =>
            apiRequest("GET", `/api/companies/${selectedCompanyId}/einvoicing/tax-ready`),
          staleTime: 60_000,
        });
        if (shouldOpenTaxReady(state)) {
          setTaxPrompt(state);
          return;
        }
      } catch {
        // The prompt is a convenience: issuing never waits on it.
      }
    }
    finalise();
  };

  const filteredInvoices = useMemo(
    () => filterInvoiceDates(invoices, dateRange),
    [invoices, dateRange]
  );

  const evidenceBatches = useMemo(() => {
    const displayed = new Set(filteredInvoices.map(({ id }) => id));
    return (
      invoicePages.data?.pages.map(({ items }) =>
        items.map(({ id }) => id).filter((id) => displayed.has(id))
      ) ?? []
    );
  }, [filteredInvoices, invoicePages.data]);
  const einvoiceEvidence = useEInvoiceListEvidence(selectedCompanyId, evidenceBatches);

  const handleExportExcel = async () => {
    if (!selectedCompanyId) return;

    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    setIsExporting(true);
    try {
      const matching = await collectInvoiceExportRows(fetchInvoicePage, dateRange);
      if (!matching.length) {
        toast({
          variant: "destructive",
          title: t["invoices.toastNoData"],
          description: t["invoices.noInvoicesToExport"],
        });
        return;
      }
      await exportToExcel([prepareInvoicesForExport(matching, locale)], `invoices${dateRangeStr}`);
      toast({
        title: t["invoices.toastExportOk"],
        description: formatMessage(t["invoices.toastExportExcelBody"], {
          count: matching.length,
        }),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: t["invoices.toastExportFailed"],
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportGoogleSheets = async () => {
    if (!selectedCompanyId || !filteredInvoices.length) {
      toast({
        variant: "destructive",
        title: t["invoices.toastNoData"],
        description: t["invoices.noInvoicesToExport"],
      });
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
        title: t["invoices.toastExportOk"],
        description: formatMessage(t["invoices.toastExportSheetsBody"], {
          count: filteredInvoices.length,
        }),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: t["invoices.toastExportFailed"],
        description: result.error || translateNow("toasts.failedToExportToGoogleSheets"),
      });
    }
  };

  const invoicePreviewNode = (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <InvoicePreview
        sellerName={company?.legalName || company?.name}
        sellerTrn={company?.trnVatNumber}
        sellerAddress={company?.businessAddress}
        number={editingInvoice ? form.watch("number") : null}
        status={editingInvoice?.status ?? "draft"}
        date={form.watch("date")}
        customerName={form.watch("customerName")}
        customerTrn={form.watch("customerTrn")}
        placeOfSupply={
          form.watch("placeOfSupplyEmirate")
            ? t[`invoices.emirate.${form.watch("placeOfSupplyEmirate")}`]
            : null
        }
        currency={watchCurrency}
        lines={watchLines.map((line, i) => ({
          description: line.description,
          quantity: Number(line.quantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          vatRate: formTotals.lines[i]?.vatRate ?? 0,
          lineTotal: formTotals.lines[i]?.lineTotal ?? 0,
        }))}
        subtotal={subtotal}
        vatAmount={vatAmount}
        total={total}
        ratesLabel={
          formTotals.ratesCharged.length
            ? formTotals.ratesCharged.map((r) => `${Math.round(r * 100)}%`).join(" / ")
            : "0%"
        }
      />
    </Suspense>
  );

  // An issued invoice opens as a read-only document: the actions of the list row, here.
  const issuedActions =
    isIssued && editingInvoice ? (
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="issued-invoice-actions"
        role="group"
        aria-label={t.actions}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void downloadInvoicePdf(editingInvoice)}
          data-testid="button-issued-download-pdf"
        >
          <Download aria-hidden />
          {t["invoices.actionDownloadPdf"]}
        </Button>
        {isShareable(editingInvoice) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInvoiceToShare(editingInvoice)}
            data-testid="button-issued-share"
            {...gate("documents.write")}
          >
            <Share2 aria-hidden />
            {t["invoices.actionShare"]}
          </Button>
        )}
        {invoiceRowActions(editingInvoice).canRecordPayment && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openAddPayment(editingInvoice)}
            data-testid="button-issued-add-payment"
            {...gate("ledger.post")}
          >
            <DollarSign aria-hidden />
            {t["invoices.actionAddPayment"]}
          </Button>
        )}
        {invoiceRowActions(editingInvoice).canCreateCreditNote && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => requestCreditNote(editingInvoice)}
            data-testid="button-issued-credit-note"
            {...gate("ledger.post")}
          >
            <RotateCcw aria-hidden />
            {t["invoices.actionCreateCreditNote"]}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openRecurring(editingInvoice)}
          data-testid="button-issued-make-recurring"
          {...gate("documents.write")}
        >
          <RefreshCw aria-hidden />
          {t["invoices.makeRecurring"]}
        </Button>
      </div>
    ) : null;

  // Spec 3.7: the invoice is written on a full page — form, sticky live bilingual preview and a
  // sticky footer with the total — not in a modal. Posting, totals and VAT are unchanged.
  const invoiceEditor = (
    <EditorShell
      testId="dialog-invoice-form"
      backHref="/invoices"
      backLabel={t["invoices.editor.back"]}
      eyebrow={t["pages.sales"]}
      title={
        editingInvoice
          ? isIssued
            ? formatMessage(t["forms.invoice.viewTitle"], {
                number:
                  locale === "ar" ? isolateLtrText(editingInvoice.number) : editingInvoice.number,
              })
            : t["forms.invoice.editTitle"]
          : t.newInvoice
      }
      description={
        editingInvoice
          ? isIssued
            ? t["forms.invoice.issuedDesc"]
            : t["forms.invoice.editDesc"]
          : t["forms.invoice.newDesc"]
      }
      status={editingInvoice ? <InvoiceStatusBadge status={editingInvoice.status} /> : undefined}
      previewLabel={t["invoices.editor.preview"]}
      preview={
        isIssued ? undefined : (
          <Tabs
            value={sidePanel}
            onValueChange={(v) => setSidePanel(v as "preview" | "checks")}
            className="space-y-3"
          >
            <TabsList className="w-full">
              <TabsTrigger value="preview" className="flex-1" data-testid="tab-invoice-preview">
                {t["invoices.editor.preview"]}
              </TabsTrigger>
              <TabsTrigger value="checks" className="flex-1" data-testid="tab-invoice-checks">
                {formatMessage(t["invoices.checks.tab"], { count: checks.length })}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="checks" className="mt-0">
              <Suspense fallback={null}>
                <InvoiceChecksPanel
                  checks={checks}
                  onFocusField={focusField}
                  checking={einvoiceValidation.isFetching}
                />
              </Suspense>
            </TabsContent>
            <TabsContent value="preview" className="mt-0">
              {invoicePreviewNode}
            </TabsContent>
          </Tabs>
        )
      }
      footerSummary={
        <span className="flex flex-wrap items-baseline gap-x-2" data-testid="editor-total">
          <span>{t["invoices.editor.total"]}</span>
          <Money
            amount={total}
            currency={watchCurrency}
            className="text-h3 font-semibold text-foreground"
          />
        </span>
      }
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => leaveGuard.guard(closeEditor)}
            data-testid="button-cancel-invoice"
          >
            {t.cancel}
          </Button>
          {!isIssued && (
            <Button
              type="button"
              variant="outline"
              disabled={saving || blockingChecks > 0 || !canChangeStatus}
              title={
                blockingChecks > 0
                  ? formatMessage(t["invoices.finalise.blocked"], { count: blockingChecks })
                  : undefined
              }
              onClick={() => void onFinaliseClick()}
              data-testid="button-finalise-invoice"
            >
              {t["invoices.finalise.action"]}
            </Button>
          )}
          <Button
            type="submit"
            form="invoice-editor-form"
            disabled={
              createMutation.isPending ||
              editMutation.isPending ||
              checkSimilarMutation.isPending ||
              (isIssued && !form.formState.isDirty)
            }
            className="sm:min-w-32"
            data-testid="button-submit-invoice"
          >
            {createMutation.isPending || editMutation.isPending || checkSimilarMutation.isPending
              ? t["forms.saving"]
              : editingInvoice
                ? t["invoices.editor.saveChanges"]
                : t["invoices.editor.saveDraft"]}
          </Button>
        </>
      }
    >
      {/* E1: e-invoice status of an issued invoice (re-checked after each save). */}
      {editingInvoice && editingInvoice.status !== "draft" && (
        <EInvoiceHeaderStrip invoiceId={editingInvoice.id} invoiceNumber={editingInvoice.number} />
      )}
      <Form {...form}>
        <form
          id="invoice-editor-form"
          onSubmit={form.handleSubmit((data) => onSubmit(data))}
          noValidate
          className="min-w-0"
        >
          <div className="min-w-0 space-y-6">
            <FormErrorSummary />
            {isIssued && editingInvoice && (
              <>
                {issuedActions}
                <div
                  className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken p-3 text-small text-muted-foreground"
                  role="status"
                  data-testid="issued-invoice-locked"
                >
                  <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="min-w-0 flex-1">{t["invoices.issued.locked"]}</p>
                </div>
                <section
                  aria-label={t["forms.preview.ariaLabel"]}
                  data-testid="issued-invoice-document"
                >
                  {invoicePreviewNode}
                </section>
              </>
            )}
            {!isIssued && (
              <>
                <FormSection
                  title={t["forms.section.document"]}
                  description={t["forms.section.documentDesc"]}
                >
                  <FormGrid>
                    <FormField
                      control={form.control}
                      name="number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.invoiceNumber}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              ltr
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
                          <FormLabel required>{t.date}</FormLabel>
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
                                  <CalendarIcon className="h-4 w-4" />
                                  {field.value ? (
                                    formatDate(field.value, locale)
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
                    <InvoiceCurrencyFields
                      form={form}
                      companyId={selectedCompanyId}
                      baseCurrency={baseCurrency}
                      readOnly={!!editingInvoice && editingInvoice.status !== "draft"}
                    />
                  </FormGrid>
                </FormSection>

                <FormSection
                  title={t["forms.section.customer"]}
                  description={t["forms.section.customerDesc"]}
                >
                  <FormGrid>
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
                                // WQ1 (7.2b): the contact's payment terms give the due date.
                                const terms = termsFromDays(c.paymentTerms);
                                if (terms && !isIssued) {
                                  form.setValue("paymentTerms", terms, { shouldDirty: true });
                                  setDueDateTouched(false);
                                }
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
                    <FormField
                      control={form.control}
                      name="customerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t.customerName}</FormLabel>
                          <FormControl>
                            <Input {...field} dir="auto" data-testid="input-customer-name" />
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
                              ltr
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder={t["forms.optional"]}
                              data-testid="input-customer-trn"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </FormGrid>
                  {einvoiceEnabled &&
                    (() => {
                      const buyer = contacts.find((x) => x.id === form.watch("contactId"));
                      const vatRegistered = /^\d{15}$/.test(
                        (form.watch("customerTrn") ?? "").trim()
                      );
                      const incomplete = !buyer || !buyer.address || !buyer.city || !buyer.emirate;
                      if (!vatRegistered || !incomplete) return null;
                      return (
                        <div
                          className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle p-3 text-small text-warning-subtle-foreground"
                          role="status"
                          data-testid="einvoice-buyer-address-hint"
                        >
                          <AlertTriangle
                            aria-hidden
                            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                          />
                          <p className="min-w-0 flex-1">
                            {t["invoices.einvoiceBuyerHint"]}{" "}
                            <Link
                              href="/contacts"
                              className="font-medium underline underline-offset-4"
                            >
                              {t["invoices.einvoiceBuyerHintLink"]}
                            </Link>
                          </p>
                        </div>
                      );
                    })()}
                </FormSection>
              </>
            )}

            <FormSection
              title={t["invoices.section.terms"]}
              description={t["invoices.section.termsDesc"]}
            >
              <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
                <InvoiceTermsFields
                  // The lazy component loses its generic; the invoice form has the terms fields.
                  form={form as unknown as UseFormReturn<TermsFormShape>}
                  issued={isIssued}
                  onDueDateTouched={() => setDueDateTouched(true)}
                />
              </Suspense>
            </FormSection>

            {!isIssued && (
              <FormSection
                title={<T k="pages.lineItems" />}
                description={t["forms.section.linesDesc"]}
                actions={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append(blankLine())}
                    data-testid="button-add-line"
                  >
                    <Plus className="h-4 w-4" />
                    {t.addLine}
                  </Button>
                }
              >
                <ol className="divide-y divide-border rounded-lg bg-surface-sunken/60 px-3">
                  {fields.map((field, index) => (
                    <li key={field.id} className="space-y-3 py-3">
                      {/* Phones: the description takes the full row; picker and remove wrap under it. */}
                      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                        <span
                          aria-hidden
                          className="mt-2 w-5 shrink-0 text-caption tabular-nums text-muted-foreground"
                        >
                          {index + 1}
                        </span>
                        <FormField
                          control={form.control}
                          name={`lines.${index}.description`}
                          render={({ field }) => (
                            <FormItem className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0">
                              <FormControl>
                                <Input
                                  {...field}
                                  dir="auto"
                                  placeholder={t.description}
                                  aria-label={formatMessage(t["forms.lineDescription"], {
                                    n: index + 1,
                                  })}
                                  data-testid={`input-line-description-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <LineItemPicker
                          companyId={selectedCompanyId}
                          index={index}
                          value={watchLines[index]?.productId}
                          onPick={(p) => {
                            const opts = { shouldDirty: true, shouldValidate: true };
                            if (!p) {
                              form.setValue(`lines.${index}.productId`, undefined, opts);
                              return;
                            }
                            form.setValue(`lines.${index}.productId`, p.id, opts);
                            // E3: a picked item decides the income account (service items post to Service Revenue).
                            form.setValue(`lines.${index}.revenueAccountId`, undefined, opts);
                            form.setValue(
                              `lines.${index}.description`,
                              (locale === "ar" && p.nameAr) || p.name,
                              opts
                            );
                            if (Number(p.unitPrice) > 0) {
                              form.setValue(`lines.${index}.unitPrice`, Number(p.unitPrice), opts);
                            }
                            if (p.vatRate !== undefined && p.vatRate !== null) {
                              form.setValue(
                                `lines.${index}.vatSupplyType`,
                                Number(p.vatRate) > 0 ? "standard_rated" : "zero_rated",
                                opts
                              );
                            }
                          }}
                        />
                        <LineIncomeAccountPicker
                          accounts={accounts}
                          index={index}
                          value={watchLines[index]?.revenueAccountId}
                          disabled={watchLines[index]?.vatSupplyType !== "standard_rated"}
                          onChange={(id) =>
                            form.setValue(`lines.${index}.revenueAccountId`, id, {
                              shouldDirty: true,
                            })
                          }
                        />
                        <LineCostCentrePicker
                          options={costCentres}
                          index={index}
                          value={watchLines[index]?.costCenterId}
                          onChange={(id) =>
                            form.setValue(`lines.${index}.costCenterId`, id, { shouldDirty: true })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-danger"
                          disabled={fields.length <= 1}
                          aria-label={formatMessage(t["forms.removeLine"], {
                            n: index + 1,
                          })}
                          onClick={() => remove(index)}
                          data-testid={
                            fields.length > 1 ? `button-remove-line-${index}` : undefined
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mobile-keep-cols grid grid-cols-2 gap-x-3 gap-y-3 ps-7 sm:grid-cols-[5rem_7rem_minmax(0,1fr)_5rem_minmax(6.5rem,auto)]">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.quantity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-caption text-muted-foreground">
                                {t["forms.col.qty"]}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
                                  value={field.value ?? ""}
                                  onChange={(e) =>
                                    field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                                  }
                                  data-testid={`input-line-quantity-${index}`}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`lines.${index}.unitPrice`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-caption text-muted-foreground">
                                {t["forms.col.unitPrice"]}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
                                  value={field.value ?? ""}
                                  onChange={(e) =>
                                    field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                                  }
                                  data-testid={`input-line-price-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`lines.${index}.vatSupplyType`}
                          render={({ field }) => (
                            <FormItem className="col-span-2 sm:col-span-1">
                              <FormLabel className="text-caption text-muted-foreground">
                                {t["invoices.supplyType"]}
                              </FormLabel>
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
                                <FormControl>
                                  <SelectTrigger data-testid={`select-line-vat-${index}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {SUPPLY_TYPE_OPTIONS.map((st) => (
                                    <SelectItem key={st} value={st}>
                                      {t[`invoices.supply.${st}`]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`lines.${index}.discountPercent`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-caption text-muted-foreground">
                                {t["forms.col.discount"]}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  max={100}
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
                                  value={field.value ?? ""}
                                  onChange={(e) =>
                                    field.onChange(e.target.value ? parseFloat(e.target.value) : 0)
                                  }
                                  data-testid={`input-line-discount-${index}`}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <div className="flex flex-col items-end justify-end gap-1.5">
                          <span className="text-caption text-muted-foreground">
                            {t["forms.col.amount"]}
                          </span>
                          <span className="flex h-9 items-center text-sm font-medium">
                            <Money
                              amount={
                                computeInvoiceFormLine(
                                  watchLines[index] ?? blankLine(),
                                  standardRate
                                ).lineTotal
                              }
                              currency={watchCurrency}
                            />
                          </span>
                        </div>
                      </div>
                      {(watchLines[index]?.vatSupplyType ?? "standard_rated") ===
                        "standard_rated" && (
                        <div className="flex flex-wrap items-center gap-3 ps-7">
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
                                <span className="text-small text-muted-foreground">
                                  {t["invoices.marginScheme"]}
                                </span>
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
                              <span className="text-caption text-muted-foreground">
                                {t["invoices.marginSchemeHint"]}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </FormSection>
            )}

            <FormSection
              title={t["invoices.attachments.title"]}
              description={t["invoices.attachments.desc"]}
            >
              <Suspense fallback={<Skeleton className="h-16 w-full rounded-lg" />}>
                <InvoiceAttachments
                  invoiceId={editingInvoice?.id}
                  pending={pendingAttachments}
                  onPendingChange={setPendingAttachments}
                  disabled={!canDo("documents.write")}
                />
              </Suspense>
            </FormSection>

            {isIssued && editingInvoice && (
              <FormSection
                title={t["invoices.activity.title"]}
                description={t["invoices.activity.desc"]}
              >
                <Suspense fallback={null}>
                  <InvoiceActivityLog invoiceId={editingInvoice.id} />
                </Suspense>
              </FormSection>
            )}
          </div>
        </form>
      </Form>
      {taxPrompt && selectedCompanyId && (
        <Suspense fallback={null}>
          <TaxReadyModal
            open
            companyId={selectedCompanyId}
            state={taxPrompt}
            onDone={() => {
              setTaxPrompt(null);
              finalise();
            }}
          />
        </Suspense>
      )}
      {leaveGuard.pending && (
        <Suspense fallback={null}>
          <LeaveWithoutSavingDialog
            open={leaveGuard.pending}
            onStay={leaveGuard.cancel}
            onLeave={leaveGuard.confirm}
          />
        </Suspense>
      )}
    </EditorShell>
  );

  return (
    <div className="space-y-6">
      <Dialog open={!!einvoiceIssues} onOpenChange={(open) => !open && setEinvoiceIssues(null)}>
        <DialogContent data-testid="dialog-einvoice-issues">
          <DialogHeader>
            <DialogTitle>
              {formatMessage(t["invoices.einvoiceIssuesTitle"], {
                // Isolated so "INV-2026-00001" keeps its order inside Arabic text.
                number: `\u2068${einvoiceIssues?.number ?? ""}\u2069`,
              })}
            </DialogTitle>
            <DialogDescription>
              <T k="invoices.einvoiceIssuesBody" />
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {(einvoiceIssues?.issues ?? []).map((issue, i) => {
              // X5 (J1 L3): a readable field name and where to fix it, never a raw data path.
              const hint = einvoiceFieldHint(issue.field, einvoiceIssues ?? undefined);
              const label = hint.labelKey ? t[hint.labelKey] : null;
              const fixKey = einvoiceIssueTextKey(issue.code) ?? einvoiceRuleTextKey(issue.ruleId);
              const detail =
                (fixKey && t[fixKey]) ||
                (locale === "ar" ? t["einvoicing.validationFinding"] : issue.message);
              return (
                <li key={`${issue.field}-${i}`} className="rounded-md border p-2">
                  {label && (
                    <span className="block text-xs font-medium text-muted-foreground">{label}</span>
                  )}
                  {issue.ruleId && (
                    <p className="text-xs text-muted-foreground">
                      {t["einvoicing.validationRule"]}{" "}
                      <bdi dir="ltr" translate="no">
                        {issue.ruleId}
                      </bdi>
                    </p>
                  )}
                  <span data-testid={issue.code ? `einvoice-issue-${issue.code}` : undefined}>
                    {detail}
                  </span>
                  {hint.whereKey && (
                    <span className="mt-1 block text-xs">
                      {hint.href ? (
                        <Link
                          href={hint.href}
                          onClick={() => setEinvoiceIssues(null)}
                          className="inline-flex min-h-11 items-center text-accent hover:underline sm:min-h-0"
                          data-testid={`link-einvoice-fix-${i}`}
                        >
                          {t[hint.whereKey]}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t[hint.whereKey]}</span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
      {!editorOpen && (
        <PageHeader
          eyebrow={t["pages.sales"]}
          title={t.invoices}
          description={(t as any).manageInvoices ?? t["invoices.manageInvoicesAndCustomizeTheir"]}
          actions={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={isExporting}
                    aria-label={t.export}
                    className="px-2.5 sm:px-3"
                    data-testid="button-export-invoices"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">
                      {isExporting ? t["invoices.exporting"] : t.export}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleExportExcel}
                    data-testid="menu-export-invoices-excel"
                  >
                    <FileSpreadsheet aria-hidden />
                    <T k="reportCenter.exportToExcel" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleExportGoogleSheets}
                    data-testid="menu-export-invoices-sheets"
                  >
                    <SiGooglesheets aria-hidden />
                    <T k="reportCenter.exportToGoogleSheets" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="px-2.5 sm:px-3"
                    aria-label={t["invoices.money.menu"]}
                    data-testid="button-invoice-money-menu"
                  >
                    <Wallet className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">{t["invoices.money.menu"]}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => navigate("/sales/receive-payment")}
                    data-testid="link-receive-payment"
                    {...gate("ledger.post")}
                  >
                    <DollarSign aria-hidden />
                    {t["invoices.money.receivePayment"]}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => navigate("/sales/cash-sale")}
                    data-testid="link-cash-sale"
                    {...gate("ledger.post")}
                  >
                    <FileText aria-hidden />
                    {t["invoices.money.cashSale"]}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setDepositsOpen(true)}
                    data-testid="button-customer-deposits"
                    {...gate("ledger.post")}
                  >
                    <Wallet aria-hidden />
                    {t["invoices.deposits.open"]}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={openNewInvoice}
                data-testid="button-create-invoice"
                {...gate("documents.write")}
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t.newInvoice}
              </Button>
            </>
          }
        />
      )}

      {selectedCompanyId && depositsOpen && (
        <Suspense fallback={null}>
          <CustomerDepositsDialog
            companyId={selectedCompanyId}
            open={depositsOpen}
            onOpenChange={setDepositsOpen}
          />
        </Suspense>
      )}

      <AlertDialog
        open={invoicePendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setInvoicePendingDelete(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-invoice">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {formatMessage(t["invoices.deleteTitle"], {
                number: invoicePendingDelete?.number ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T k="invoices.deleteBody" />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (invoicePendingDelete) deleteMutation.mutate(invoicePendingDelete.id);
                setInvoicePendingDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="hr.delete" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={draftNudge !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraftNudge(null);
            stripIssueParams();
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-invoice-draft-nudge">
          <AlertDialogHeader>
            <AlertDialogTitle>{t["invoices.nudgeTitle"]}</AlertDialogTitle>
            <AlertDialogDescription>
              {formatMessage(t["invoices.nudgeBody"], {
                number:
                  locale === "ar"
                    ? isolateLtrText(draftNudge?.number ?? "")
                    : (draftNudge?.number ?? ""),
              })}
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
                      stripIssueParams();
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

      {editorOpen ? (
        invoiceEditor
      ) : (
        <div className="space-y-4">
          <InvoiceStatusTiles
            companyId={selectedCompanyId}
            active={statusFilter}
            onSelect={(status) => (status ? setStatusFilter(status) : clearStatusFilter())}
          />
          <div
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
            data-testid="invoices-filter-toolbar"
          >
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <span className="sr-only">{(t as any).filterByDate ?? "Filter by date:"}</span>
              <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger
                  className="w-full sm:w-44"
                  aria-label={t["invoices.source.label"]}
                  data-testid="select-invoice-source"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t["invoices.source.all"]}</SelectItem>
                  <SelectItem value="app">{t["invoices.source.app"]}</SelectItem>
                  <SelectItem value="api">{t["invoices.source.api"]}</SelectItem>
                  <SelectItem value="recurring">{t["invoices.source.recurring"]}</SelectItem>
                  <SelectItem value="cash_sale">{t["invoices.source.cash_sale"]}</SelectItem>
                </SelectContent>
              </Select>
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
          </div>

          {!selectedCompanyId && companyListState === "empty" ? (
            <p className="text-sm text-muted-foreground" data-testid="invoices-no-company">
              <T k="pages.noCompanySelected" />
            </p>
          ) : !selectedCompanyId && companyListState === "error" ? (
            <LoadErrorState
              error={companyError}
              onRetry={retryCompanyList}
              testId="invoices-company-error"
            />
          ) : invoiceReadState === "pending" ? (
            <div data-testid="invoices-loading">
              <TableSkeleton rows={8} columns={6} />
            </div>
          ) : invoiceReadState === "error" ? (
            <LoadErrorState
              error={invoicePages.error}
              onRetry={() => void invoicePages.refetch()}
              title={t["firm.invoicesLoadErrorTitle"]}
              description={t["firm.invoicesLoadErrorBody"]}
              testId="invoices-load-error"
            />
          ) : (
            <>
              {invoiceReadState === "stale" && (
                <StaleDataNotice onRetry={retryInvoicePages} testId="invoices-stale" />
              )}
              {/* Mobile row-cards (CTO 3/8): line 1 name + amount, line 2 number · date + status. */}
              <Card
                className="divide-hairline overflow-hidden md:hidden"
                data-testid="mobile-invoice-list"
              >
                {(filteredInvoices || []).map((invoice) => (
                  <div key={invoice.id} className="flex items-start gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p dir="auto" className="truncate text-sm font-medium text-foreground">
                          {invoice.customerName}
                        </p>
                        <Money
                          amount={Number(invoice.total)}
                          currency={invoice.currency}
                          className="shrink-0 text-sm font-semibold text-foreground"
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-caption text-muted-foreground">
                          <span dir="ltr" className="[unicode-bidi:isolate]">
                            {invoice.number}
                          </span>
                          {" · "}
                          {formatDate(invoice.date, locale)}
                        </p>
                        <Select
                          value={invoice.status}
                          onValueChange={(newStatus) => handleStatusChange(invoice, newStatus)}
                          disabled={
                            updateStatusMutation.isPending ||
                            !canChangeStatus ||
                            invoiceStatusTargets(invoice).length === 0
                          }
                        >
                          <SelectTrigger
                            className={cn(
                              badgeVariants({
                                variant: statusBadgeVariant(invoiceDisplayStatus(invoice)),
                              }),
                              "h-6 min-h-6 w-auto shrink-0 gap-1.5 py-0 ps-2 pe-1.5 shadow-none [&>svg]:size-3 [&>svg]:opacity-60"
                            )}
                            aria-label={formatMessage(t["components.statusChange"], {
                              status: invoiceStatusText(t, invoice),
                            })}
                            data-testid={`mobile-select-status-${invoice.id}`}
                          >
                            <span
                              aria-hidden
                              className={statusDotClass(
                                statusBadgeVariant(invoiceDisplayStatus(invoice))
                              )}
                            />
                            <SelectValue>{invoiceStatusText(t, invoice)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {invoiceStatusTargets(invoice).map((target) => (
                              <SelectItem key={target} value={target}>
                                {t[target]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {/* E1: compact e-invoice badge on the mobile row-card. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 [&>button]:ms-0">
                        <OverdueBadge invoice={invoice} />
                        <WrittenOffBadge invoice={invoice} />
                        <EInvoiceListCell
                          invoice={invoice}
                          evidence={einvoiceEvidence[invoice.id]}
                          onEdit={() => openInvoiceEditor(invoice)}
                        />
                      </div>
                    </div>
                    <RowActions
                      className="-me-2 -mt-1"
                      menu={
                        <>
                          <DropdownMenuItem
                            onSelect={() => openInvoiceEditor(invoice)}
                            data-testid={`mobile-button-edit-invoice-${invoice.id}`}
                          >
                            <Edit aria-hidden />
                            {t.edit}
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={evidenceSourceHref("invoice", invoice.id)}
                              data-testid={`mobile-button-proof-invoice-${invoice.id}`}
                            >
                              <FileText aria-hidden />
                              <T k="reportCenter.proof" />
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void downloadInvoicePdf(invoice)}>
                            <Download aria-hidden />
                            {t["invoices.actionDownloadPdf"]}
                          </DropdownMenuItem>
                          {isShareable(invoice) && (
                            <DropdownMenuItem
                              onSelect={() => setInvoiceToShare(invoice)}
                              data-testid={`mobile-button-share-invoice-${invoice.id}`}
                              {...gate("documents.write")}
                            >
                              <Share2 aria-hidden />
                              {t["invoices.actionShare"]}
                            </DropdownMenuItem>
                          )}
                          {invoiceRowActions(invoice).canRecordPayment && (
                            <DropdownMenuItem
                              onSelect={() => openAddPayment(invoice)}
                              {...gate("ledger.post")}
                            >
                              <DollarSign aria-hidden />
                              <T k="invoices.actionAddPayment" />
                            </DropdownMenuItem>
                          )}
                          {/* The phone card offers the same e-invoice action as the table row. */}
                          {invoiceRowActions(invoice).canGenerateEinvoice && (
                            <DropdownMenuItem
                              onSelect={() => void generateEinvoice(invoice)}
                              data-testid={`mobile-button-einvoice-${invoice.id}`}
                              {...gate("documents.write")}
                            >
                              <FileCode aria-hidden />
                              <T k="invoices.actionGenerateEinvoice" />
                            </DropdownMenuItem>
                          )}
                        </>
                      }
                      menuTestId={`mobile-button-invoice-actions-${invoice.id}`}
                    />
                  </div>
                ))}
              </Card>
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
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.invoiceNumber}</TableHead>
                        <TableHead className="w-full">{t.customerName}</TableHead>
                        <TableHead>{t.date}</TableHead>
                        <TableHead>{t["invoices.colDue"]}</TableHead>
                        <TableHead data-numeric="">{t.total}</TableHead>
                        <TableHead>{t.status}</TableHead>
                        <TableHead data-numeric="">
                          <span className="sr-only">{t.actions}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <VirtualizedInvoiceRows
                      invoices={filteredInvoices || []}
                      scrollRef={tableScrollRef}
                      renderRow={(invoice) => (
                        <TableRow key={invoice.id} data-testid={`invoice-row-${invoice.id}`}>
                          <TableCell data-nowrap="" className="font-medium">
                            <span dir="ltr" className="[unicode-bidi:isolate]">
                              {invoice.number}
                            </span>
                          </TableCell>
                          <TableCell data-truncate="" title={invoice.customerName}>
                            <span dir="auto">{invoice.customerName}</span>
                          </TableCell>
                          <TableCell data-nowrap="" className="text-muted-foreground">
                            {formatDate(invoice.date, locale)}
                          </TableCell>
                          <TableCell data-nowrap="" className="text-muted-foreground">
                            {invoice.dueDate ? formatDate(invoice.dueDate, locale) : "—"}
                          </TableCell>
                          <TableCell data-numeric="" className="font-medium">
                            <Money amount={Number(invoice.total)} currency={invoice.currency} />
                            <BalanceLine invoice={invoice} />
                          </TableCell>
                          <TableCell data-nowrap="">
                            <Select
                              value={invoice.status}
                              onValueChange={(newStatus) => handleStatusChange(invoice, newStatus)}
                              disabled={
                                updateStatusMutation.isPending ||
                                !canChangeStatus ||
                                invoiceStatusTargets(invoice).length === 0
                              }
                            >
                              {/* Editable status: the StatusBadge is the dropdown trigger (CTO 3). */}
                              <SelectTrigger
                                className={cn(
                                  badgeVariants({
                                    variant: statusBadgeVariant(invoiceDisplayStatus(invoice)),
                                  }),
                                  "h-6 min-h-6 w-auto gap-1.5 py-0 ps-2 pe-1.5 shadow-none [&>svg]:size-3 [&>svg]:opacity-60"
                                )}
                                aria-label={formatMessage(t["components.statusChange"], {
                                  status: invoiceStatusText(t, invoice),
                                })}
                                data-testid={`select-status-${invoice.id}`}
                              >
                                <span
                                  aria-hidden
                                  className={statusDotClass(
                                    statusBadgeVariant(invoiceDisplayStatus(invoice))
                                  )}
                                />
                                <SelectValue>{invoiceStatusText(t, invoice)}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {invoiceStatusTargets(invoice).map((target) => (
                                  <SelectItem
                                    key={target}
                                    value={target}
                                    data-testid={`status-option-${target}-${invoice.id}`}
                                  >
                                    {t[target]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <OverdueBadge invoice={invoice} />
                            <WrittenOffBadge invoice={invoice} />
                            {/* E1: two-track e-invoice status; opens the status sheet. */}
                            <EInvoiceListCell
                              invoice={invoice}
                              evidence={einvoiceEvidence[invoice.id]}
                              onEdit={() => openInvoiceEditor(invoice)}
                            />
                          </TableCell>
                          <TableCell data-nowrap="" className="w-px">
                            <RowActions
                              maxInline={1}
                              menuTestId={`button-invoice-actions-${invoice.id}`}
                              menu={
                                <>
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={evidenceSourceHref("invoice", invoice.id)}
                                      data-testid={`button-proof-invoice-${invoice.id}`}
                                    >
                                      <FileText aria-hidden />
                                      <T k="reportCenter.proof" />
                                    </Link>
                                  </DropdownMenuItem>
                                  {isShareable(invoice) && (
                                    <DropdownMenuItem
                                      onSelect={() => setInvoiceToShare(invoice)}
                                      data-testid={`button-share-invoice-${invoice.id}`}
                                      {...gate("documents.write")}
                                    >
                                      <Share2 aria-hidden />
                                      {t["invoices.actionShare"]}
                                    </DropdownMenuItem>
                                  )}
                                  {/* X6b: a draft is not issued yet, so it has no payments, credit
                                      notes or e-invoice. */}
                                  {invoiceRowActions(invoice).canRecordPayment &&
                                    !OPEN_FOR_PAYMENT.has(String(invoice.status)) && (
                                      <DropdownMenuItem
                                        onSelect={() => openAddPayment(invoice)}
                                        data-testid={`button-add-payment-${invoice.id}`}
                                        {...gate("ledger.post")}
                                      >
                                        <DollarSign aria-hidden />
                                        <T k="invoices.actionAddPayment" />
                                      </DropdownMenuItem>
                                    )}
                                  <DropdownMenuItem
                                    onSelect={() => void openViewPayments(invoice)}
                                    data-testid={`button-view-payments-${invoice.id}`}
                                  >
                                    <FileText aria-hidden />
                                    <T k="invoices.actionViewPayments" />
                                  </DropdownMenuItem>
                                  {invoiceRowActions(invoice).canGenerateEinvoice && (
                                    <DropdownMenuItem
                                      onSelect={() => void generateEinvoice(invoice)}
                                      data-testid={`button-einvoice-${invoice.id}`}
                                      {...gate("documents.write")}
                                    >
                                      <FileCode aria-hidden />
                                      <T k="invoices.actionGenerateEinvoice" />
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onSelect={() => openRecurring(invoice)}
                                    data-testid={`button-set-recurring-${invoice.id}`}
                                    {...gate("documents.write")}
                                  >
                                    <RefreshCw aria-hidden />
                                    {t["invoices.makeRecurring"]}
                                  </DropdownMenuItem>
                                  {invoiceRowActions(invoice as any).canCreateCreditNote && (
                                    <DropdownMenuItem
                                      onSelect={() => requestCreditNote(invoice)}
                                      data-testid={`button-credit-note-${invoice.id}`}
                                      {...gate("ledger.post")}
                                    >
                                      <RotateCcw aria-hidden />
                                      <T k="invoices.actionCreateCreditNote" />
                                    </DropdownMenuItem>
                                  )}
                                  {(invoice as any).invoiceType !== "credit_note" &&
                                    ["sent", "posted", "partial"].includes(invoice.status) && (
                                      <DropdownMenuItem
                                        onSelect={() => setInvoiceToWriteOff(invoice)}
                                        data-testid={`button-write-off-${invoice.id}`}
                                        {...gate("ledger.post")}
                                      >
                                        <XCircle aria-hidden />
                                        <T k="invoices.actionWriteOff" />
                                      </DropdownMenuItem>
                                    )}
                                  {/* X5 (J1 L4): only a never-issued draft can be removed;
                                      issued invoices are voided or credited. */}
                                  {invoice.status === "draft" && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onSelect={() => setInvoicePendingDelete(invoice)}
                                        disabled={deleteMutation.isPending}
                                        className="text-destructive focus:text-destructive"
                                        data-testid={`button-delete-invoice-${invoice.id}`}
                                        {...gate("documents.write")}
                                      >
                                        <Trash2 aria-hidden />
                                        <T k="invoices.actionDelete" />
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </>
                              }
                            >
                              {/* Spec 2.4: one status-appropriate inline action, the rest in ⋯. */}
                              {invoiceRowActions(invoice).canRecordPayment &&
                                OPEN_FOR_PAYMENT.has(String(invoice.status)) && (
                                  <RowActionButton
                                    icon={DollarSign}
                                    label={t["invoices.actionAddPayment"]}
                                    onClick={() => openAddPayment(invoice)}
                                    data-testid={`button-add-payment-${invoice.id}`}
                                    {...gate("ledger.post")}
                                  />
                                )}
                              {invoice.status === "paid" ? (
                                <>
                                  <RowActionButton
                                    icon={Download}
                                    label={t["invoices.actionDownloadPdf"]}
                                    onClick={() => void downloadInvoicePdf(invoice)}
                                    data-testid={`button-download-pdf-${invoice.id}`}
                                  />
                                  <RowActionButton
                                    icon={Edit}
                                    label={t.edit}
                                    onClick={() => openInvoiceEditor(invoice)}
                                    data-testid={`button-edit-invoice-${invoice.id}`}
                                  />
                                </>
                              ) : (
                                <>
                                  <RowActionButton
                                    icon={Edit}
                                    label={t.edit}
                                    onClick={() => openInvoiceEditor(invoice)}
                                    data-testid={`button-edit-invoice-${invoice.id}`}
                                  />
                                  <RowActionButton
                                    icon={Download}
                                    label={t["invoices.actionDownloadPdf"]}
                                    onClick={() => void downloadInvoicePdf(invoice)}
                                    data-testid={`button-download-pdf-${invoice.id}`}
                                  />
                                </>
                              )}
                            </RowActions>
                          </TableCell>
                        </TableRow>
                      )}
                      emptyState={
                        <TableBody>
                          <TableRow>
                            <TableCell colSpan={7} className="p-0">
                              <EmptyState
                                icon={FileText}
                                title={
                                  dateRange.from || dateRange.to
                                    ? t["invoices.noInvoicesInThisDate"]
                                    : ((t as any).noInvoicesYet ?? "No invoices yet")
                                }
                                description={
                                  dateRange.from || dateRange.to
                                    ? t["invoices.emptyWidenDateFilter"]
                                    : ((t as any).createFirstInvoice ??
                                      "Create your first invoice — VAT, sequential numbering, and PDFs are handled automatically.")
                                }
                                action={
                                  !dateRange.from && !dateRange.to
                                    ? {
                                        label: (t as any).newInvoiceCta ?? "New invoice",
                                        icon: Plus,
                                        onClick: openNewInvoice,
                                        testId: "button-create-first-invoice",
                                      }
                                    : undefined
                                }
                                secondaryAction={
                                  dateRange.from || dateRange.to
                                    ? {
                                        label: t["invoices.emptyClearFilter"],
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
        </div>
      )}

      {/* Similar Invoices Warning Dialog */}
      <Dialog open={similarWarningOpen} onOpenChange={setSimilarWarningOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-warning" />
              <T k="pageLabels.similarInvoicesFound" />
            </DialogTitle>
            <DialogDescription>{t["invoices.weFoundSimilarInvoicesThat"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {similarInvoices.map((invoice, idx) => (
                <div key={idx} className="rounded-md border bg-muted/50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">
                        <bdi dir="ltr" translate="no">
                          {invoice.number}
                        </bdi>
                      </p>
                      <p className="break-words text-sm">
                        <bdi translate="no">{invoice.customerName}</bdi>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(invoice.date, locale)}
                      </p>
                      <InvoiceStatusBadge className="mt-1" status={invoice.status} />
                    </div>
                    <Money
                      amount={Number(invoice.total || 0)}
                      currency={invoice.currency || "AED"}
                      className="font-semibold"
                    />
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

      {invoiceToWriteOff && (
        <Suspense fallback={null}>
          <WriteOffInvoiceDialog
            invoice={invoiceToWriteOff}
            companyId={selectedCompanyId}
            onClose={() => setInvoiceToWriteOff(null)}
          />
        </Suspense>
      )}
      <ShareInvoiceDialog
        invoice={invoiceToShare}
        companyId={selectedCompanyId}
        onClose={() => setInvoiceToShare(null)}
      />

      {/* Add Payment Dialog */}
      <Dialog open={addPaymentDialogOpen} onOpenChange={setAddPaymentDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-success" />
              <T k="pages.recordPayment" />
            </DialogTitle>
            <DialogDescription>
              {formatMessage(t["invoices.recordPaymentDesc"], {
                number: invoiceForPaymentDetail?.number ?? "",
                total: invoiceForPaymentDetail
                  ? formatCurrency(
                      invoiceForPaymentDetail.total,
                      invoiceForPaymentDetail.currency,
                      locale
                    )
                  : "",
              })}
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
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="invoice-payment-date">
                {t["invoices.payment.date"]}
              </label>
              <DatePicker
                id="invoice-payment-date"
                data-testid="input-invoice-payment-date"
                value={paymentDate}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={setPaymentDate}
              />
            </div>

            {invoiceForPaymentDetail &&
              (invoiceForPaymentDetail.currency || baseCurrency) !== baseCurrency && (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="invoice-payment-rate">
                    {formatMessage(t["invoices.payment.rateLabel"], {
                      from: invoiceForPaymentDetail.currency,
                      to: baseCurrency,
                    })}
                  </label>
                  <Input
                    id="invoice-payment-rate"
                    ltr
                    inputMode="decimal"
                    data-testid="input-invoice-payment-rate"
                    value={paymentRate}
                    onChange={(e) => setPaymentRate(e.target.value)}
                  />
                  <p className="text-caption text-muted-foreground">
                    {t["invoices.payment.rateHint"]}
                  </p>
                </div>
              )}

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
                  <SelectItem value="cash">{t["invoices.methodCash"]}</SelectItem>
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
                    <SelectValue placeholder={t["bankReconciliation.selectAccount"]} />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.code} — {accountDisplayName(acc, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{t["invoices.noCashBankAccounts"]}</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t["invoices.referenceOptional"]}</label>
              <Input
                placeholder={t["invoices.referencePlaceholder"]}
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t["invoices.notesOptional"]}</label>
              <Input
                placeholder={t["invoices.additionalNotes"]}
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
                const rate = rateToSend(
                  invoiceForPaymentDetail.currency,
                  baseCurrency,
                  paymentRate
                );
                if (rate === undefined) {
                  toast({
                    variant: "destructive",
                    title: t["invoices.error"],
                    description: t["invoices.currency.rateInvalid"],
                  });
                  return;
                }
                addPaymentMutation.mutate({
                  invoiceId: invoiceForPaymentDetail.id,
                  data: {
                    amount: parseFloat(paymentAmount),
                    method: paymentMethod,
                    paymentAccountId: paymentAccountForAdd,
                    reference: paymentReference || undefined,
                    notes: paymentNotes || undefined,
                    date: paymentDate || format(new Date(), "yyyy-MM-dd"),
                    ...(rate ? { exchangeRate: rate } : {}),
                  },
                });
              }}
              disabled={
                addPaymentMutation.isPending ||
                !paymentAmount ||
                !paymentAccountForAdd ||
                !paymentDate
              }
              className="flex-1"
            >
              {addPaymentMutation.isPending ? t["invoices.recording"] : t["pages.recordPayment"]}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Payments Dialog */}
      <Dialog open={viewPaymentsDialogOpen} onOpenChange={setViewPaymentsDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {formatMessage(t["invoices.paymentHistoryTitle"], {
                number: invoiceForPaymentDetail?.number ?? "",
              })}
            </DialogTitle>
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
                      <TableHead>{t["invoices.colDate"]}</TableHead>
                      <TableHead>
                        <T k="consolidation.method" />
                      </TableHead>
                      <TableHead>
                        <T k="banking.common.reference" />
                      </TableHead>
                      <TableHead data-numeric="">
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
                        <MoneyCell
                          amount={Number(p.amount)}
                          currency={invoiceForPaymentDetail?.currency || "AED"}
                          className="font-medium"
                        />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between pt-2 border-t font-semibold">
                  <span>
                    <T k="pages.totalPaid" />
                  </span>
                  <span>
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
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.selectPaymentAccount" />
            </DialogTitle>
            <DialogDescription>
              {formatMessage(t["invoices.chooseDepositFor"], {
                number: invoiceForPayment?.number ?? "",
              })}
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
                          <div className="font-medium">{accountDisplayName(account, locale)}</div>
                          <div className="text-sm text-muted-foreground">{account.code}</div>
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
                  <AlertDescription>{t["invoices.youNeedToCreateAt"]}</AlertDescription>
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
                  <Plus className="w-4 h-4" />
                  {t["invoices.createPaymentAccount"]}
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
          <td colSpan={7} style={{ height: paddingTop, padding: 0, border: 0 }} />
        </tr>
      )}
      {virtualItems.map((virtualRow) => renderRow(invoices[virtualRow.index]))}
      {paddingBottom > 0 && (
        <tr aria-hidden="true">
          <td colSpan={7} style={{ height: paddingBottom, padding: 0, border: 0 }} />
        </tr>
      )}
    </TableBody>
  );
}

/**
 * Invoice status tiles (D3a, benchmark "invoice list is scannable"): count and value per
 * status bucket from the full invoice list (`?all=true`, same query key as the Dashboard),
 * in AED. Open/Overdue show the remaining balance owed (`openBalanceBase`, server-computed), Draft/Paid document totals (`baseCurrencyAmount`). A tile applies the same server-side status filter as the
 * dashboard drill-through links; pressing the active tile clears it.
 */
function InvoiceStatusTiles({
  companyId,
  active,
  onSelect,
}: {
  companyId: string | undefined;
  active: string | null;
  onSelect: (status: InvoiceStatusFilter | null) => void;
}) {
  const { t } = useTranslation();
  const totalsQuery = useQuery<InvoiceListItem[]>({
    queryKey: ["/api/companies", companyId, "invoices"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/invoices?all=true`),
    enabled: !!companyId,
  });
  const totalsState = queryReadState(totalsQuery);
  const all = useMemo(
    () => (hasReadData(totalsState) ? (totalsQuery.data ?? []) : []),
    [totalsState, totalsQuery.data]
  );
  const buckets = useMemo(() => {
    const labels: Record<string, string> = {
      draft: t["invoices.statusFilter.draft"],
      open: t["invoices.statusFilter.open"],
      overdue: t["invoices.statusFilter.overdue"],
      paid: t["invoices.statusFilter.paid"],
    };
    return computeInvoiceTiles(all, startOfDay(new Date())).map((b) => ({
      ...b,
      label: labels[b.key],
    }));
  }, [all, t]);

  // Without a company there are no totals to wait for: the list below says why.
  if (!companyId) return null;
  // Neither a pending nor a failed load may read as "0 invoices".
  if (totalsState === "pending") {
    return <Skeleton className="h-24 w-full rounded-xl" data-testid="invoice-tiles-loading" />;
  }
  if (totalsState === "error") {
    return (
      <LoadErrorState
        compact
        error={totalsQuery.error}
        onRetry={() => void totalsQuery.refetch()}
        testId="invoice-tiles-error"
      />
    );
  }

  const tiles = (
    <div
      className="mobile-keep-cols grid grid-cols-2 gap-3 lg:grid-cols-4"
      data-testid="invoice-status-tiles"
    >
      {buckets.map((b) => {
        const isActive = active === b.key;
        return (
          <button
            key={b.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(isActive ? null : b.key)}
            data-testid={`invoice-status-tile-${b.key}`}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-start shadow-card-soft transition-colors duration-fast",
              "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "border-primary ring-1 ring-primary" : "border-border"
            )}
          >
            <span className="flex items-center gap-2 text-small font-medium text-muted-foreground">
              <span
                aria-hidden
                className={statusDotClass(
                  b.key === "open"
                    ? "info"
                    : b.key === "overdue"
                      ? "danger"
                      : b.key === "paid"
                        ? "success"
                        : "neutral"
                )}
              />
              {b.label}
            </span>
            <Money
              amount={b.value}
              className={cn(
                "mt-1 flex text-h3 font-semibold text-foreground",
                b.key === "overdue" && b.value > 0 && "text-danger"
              )}
            />
            <span className="mt-0.5 block text-caption text-muted-foreground">
              {formatMessage(t["screens.invoicesCount"], { count: b.count })}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      {totalsState === "stale" && (
        <StaleDataNotice onRetry={() => void totalsQuery.refetch()} testId="invoice-tiles-stale" />
      )}
      {tiles}
    </div>
  );
}
