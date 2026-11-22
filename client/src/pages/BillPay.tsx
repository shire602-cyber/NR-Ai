import { accountDisplayName } from "@/lib/account-name";
import { withoutControlAccounts } from "@/lib/control-account-options";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { T } from "@/components/layout/T";
import {
  FormErrorSummary,
  FormGrid,
  FormSection,
  FormTotals,
  LineAmount,
  LineItem,
  LineItemList,
  lineLabelClass,
} from "@/components/ui/form-layout";
import { EditorShell } from "@/components/ui/editor-shell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useEditorRoute } from "@/hooks/useEditorRoute";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/badge";
import { DataTableCard } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PurchaseAccountOptions } from "@/components/accounts/PurchaseAccountOptions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useLocation, useSearch } from "wouter";
import { InboundCreditNotesCard } from "@/components/bills/InboundCreditNotesCard";
import {
  BillCapturePanel,
  ConfidenceBadge,
  type PendingBillFile,
} from "@/components/bills/BillCapturePanel";
import { SupplierPicker, type SupplierOption } from "@/components/bills/SupplierPicker";
import { BillItemPicker } from "@/components/bills/BillItemPicker";
import { isStockItem, purchasePriceOf } from "@/lib/purchase-pickers";
import { ScrollTabs } from "@/components/ui/scroll-tabs";
import type { BillCaptureResult, BillCaptureField } from "@shared/bill-capture";
import { EInvoiceOriginTag } from "@/components/einvoice/EInvoiceListCell";
import {
  billPayTabFromSearch,
  billStatusFilterFromSearch,
  billTabCounts,
  billTabForFilter,
  BILL_LIST_TABS,
  filterBills,
  type ApprovalQueueEntry,
  type BillPayTab,
} from "@/lib/bill-filters";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatCurrency, formatDate } from "@/lib/format";
import { statusLabel } from "@/lib/status-label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/ui/page-header";
import {
  Plus,
  FileText,
  CalendarIcon,
  Trash2,
  Edit,
  CheckCircle,
  DollarSign,
  AlertTriangle,
  CreditCard,
  BarChart3,
  Receipt,
  Send,
  Ban,
  Search,
  Undo2,
  Paperclip,
} from "lucide-react";
import {
  defaultPaymentAccountId,
  postablePaymentAccounts,
  type BankAccountLike,
} from "@/lib/payment-accounts";
import { parseCalendarDate } from "@/lib/format-date";

// ===========================
// W3-B copy (en + ar)
// ===========================

const COPY = {
  en: {
    reverseCharge: "Reverse charge (imported services / designated zone)",
    exchangeRate: "Exchange rate to AED",
    exchangeRateHint: "Leave blank to use the company rate for the date",
    isImport: "Import of goods (customs)",
    customsNo: "Customs declaration no.",
    importVat: "Import VAT (customs)",
    placeOfSupply: "Place of supply (emirate)",
    supplyType: "VAT treatment",
    standardRated: "Standard 5%",
    zeroRated: "Zero-rated 0%",
    exempt: "Exempt",
    outOfScope: "Out of scope",
    reverseChargeLine: "Reverse charge 5%",
    paymentAccount: "Paid from (bank / cash account)",
    defaultBank: "Choose the bank or cash account",
    paymentRate: "Payment-date rate to AED",
    voidBill: "Void",
    rejectBill: "Reject",
    submitBill: "Submit for approval",
    reasonPrompt: "Reason (required, kept in the audit trail)",
    reviseNotice: "This bill is approved: saving posts a reversal and a corrected journal.",
    voided: "Bill voided",
    rejected: "Bill rejected",
    submitted: "Bill submitted for approval",
    draft: "Draft",
    rejectedStatus: "Rejected",
    voidStatus: "Void",
    paidStatus: "Paid",
    card: "Card",
    cash: "Cash",
  },
  ar: {
    reverseCharge: "احتساب عكسي (خدمات مستوردة / منطقة محددة)",
    exchangeRate: "سعر الصرف إلى الدرهم",
    exchangeRateHint: "اتركه فارغًا لاستخدام سعر الشركة في التاريخ",
    isImport: "استيراد بضائع (جمارك)",
    customsNo: "رقم البيان الجمركي",
    importVat: "ضريبة الاستيراد (الجمارك)",
    placeOfSupply: "مكان التوريد (الإمارة)",
    supplyType: "المعاملة الضريبية",
    standardRated: "نسبة أساسية 5%",
    zeroRated: "نسبة صفرية 0%",
    exempt: "معفاة",
    outOfScope: "خارج النطاق",
    reverseChargeLine: "احتساب عكسي 5%",
    paymentAccount: "مدفوع من (حساب بنكي / نقدي)",
    defaultBank: "اختر الحساب البنكي أو النقدي",
    paymentRate: "سعر الصرف بتاريخ الدفع",
    voidBill: "إلغاء",
    rejectBill: "رفض",
    submitBill: "إرسال للاعتماد",
    reasonPrompt: "السبب (مطلوب، يُحفظ في سجل التدقيق)",
    reviseNotice: "هذه الفاتورة معتمدة: الحفظ يسجل قيدًا عكسيًا وقيدًا مصححًا.",
    voided: "تم إلغاء الفاتورة",
    rejected: "تم رفض الفاتورة",
    submitted: "تم إرسال الفاتورة للاعتماد",
    draft: "مسودة",
    rejectedStatus: "مرفوضة",
    voidStatus: "ملغاة",
    paidStatus: "مدفوعة",
    card: "بطاقة",
    cash: "نقدًا",
  },
} as const;
type Copy = { [K in keyof (typeof COPY)["en"]]: string };

const SUPPLY_TYPES = [
  "standard_rated",
  "zero_rated",
  "exempt",
  "out_of_scope",
  "reverse_charge",
] as const;

const EMIRATE_CODES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;

function supplyLabel(c: Copy, v: string): string {
  switch (v) {
    case "zero_rated":
      return c.zeroRated;
    case "exempt":
      return c.exempt;
    case "out_of_scope":
      return c.outOfScope;
    case "reverse_charge":
      return c.reverseChargeLine;
    default:
      return c.standardRated;
  }
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

// ===========================
// Types
// ===========================

interface VendorBill {
  id: string;
  company_id: string;
  vendor_name: string;
  vendor_trn: string | null;
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  currency: string;
  subtotal: string;
  vat_amount: string;
  total_amount: string;
  amount_paid: string;
  status: string;
  category: string | null;
  notes: string | null;
  attachment_url: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  reverse_charge?: boolean;
  exchange_rate?: string;
  is_import?: boolean;
  customs_declaration_no?: string | null;
  import_vat_amount?: string;
  place_of_supply?: string | null;
  display_status?: string;
  /** E1: "einvoice" when the bill was created from a received structured e-invoice. */
  origin?: string | null;
  vendor_id?: string | null;
  has_attachment?: boolean;
  attachment_name?: string | null;
}

interface BillLineItem {
  id: string;
  bill_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  amount: string;
  account_id: string | null;
  cost_center_id?: string | null;
  vat_supply_type?: string;
  product_id?: string | null;
  created_at: string;
}

interface BillPayment {
  id: string;
  bill_id: string;
  payment_date: string;
  amount: string;
  payment_method: string;
  kind: "payment" | "reversal" | "vendor_credit" | "prepayment";
  status: "active" | "voided";
  reference: string | null;
  notes: string | null;
  created_at: string;
}

interface BillDetail extends VendorBill {
  line_items: BillLineItem[];
  payments: BillPayment[];
}

interface BillPaymentPage {
  items: Array<BillPayment & Pick<VendorBill, "vendor_name" | "bill_number" | "currency">>;
  nextCursor: string | null;
}

interface BillSummary {
  pending: { count: number; total: number };
  approved: { count: number; total: number };
  partial: { count: number; total: number; paid: number };
  paid: { count: number; total: number };
  overdue: { count: number; total: number };
}

interface AgingReport {
  current: { amount: number; count: number };
  days_1_30: { amount: number; count: number };
  days_31_60: { amount: number; count: number };
  days_61_90: { amount: number; count: number };
  days_90_plus: { amount: number; count: number };
}

// ===========================
// Schemas
// ===========================

const billLineSchema = z.object({
  description: z.string().min(1, "forms.errors.descriptionRequired"),
  quantity: z.coerce.number().min(0.01, "forms.errors.quantityPositive"),
  unit_price: z.coerce.number().min(0, "forms.errors.priceNonNegative"),
  vat_rate: z.coerce.number().default(5),
  vat_supply_type: z.string().default("standard_rated"),
  account_id: z.string().optional(),
  cost_center_id: z.string().optional(),
  product_id: z.string().optional(),
});

const billFormSchema = z.object({
  vendor_id: z.string().optional(),
  vendor_name: z.string().min(1, "forms.errors.vendorNameRequired"),
  vendor_trn: z.string().optional(),
  bill_number: z.string().optional(),
  bill_date: z.date(),
  due_date: z.date().optional(),
  currency: z.string().default("AED"),
  exchange_rate: z.string().optional(),
  reverse_charge: z.boolean().default(false),
  is_import: z.boolean().default(false),
  customs_declaration_no: z.string().optional(),
  import_vat_amount: z.string().optional(),
  place_of_supply: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
  line_items: z.array(billLineSchema).min(1, "forms.errors.lineItemRequired"),
});

const paymentFormSchema = z.object({
  payment_date: z.date(),
  amount: z.coerce.number().min(0.01, "forms.errors.amountPositive"),
  payment_method: z.string().default("bank_transfer"),
  payment_account_id: z.string().optional(),
  exchange_rate: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type BillFormData = z.infer<typeof billFormSchema>;
type PaymentFormData = z.infer<typeof paymentFormSchema>;

// ===========================
// Status helpers
// ===========================

// ===========================
// Main Component
// ===========================

// R13-21: dashboard drill-through opens /bill-pay?tab=bills&status=open|overdue|<status>.
// The filter follows the URL on every navigation (client/src/lib/bill-filters.ts).

/** Select sentinel for "no cost centre" (Radix Select items cannot have an empty value). */
const NO_COST_CENTER = "__none__";

const EMPTY_LINE = {
  description: "",
  quantity: 1,
  unit_price: 0,
  vat_rate: 5,
  vat_supply_type: "standard_rated",
  account_id: "",
  cost_center_id: "",
  product_id: "",
};

/** WQ2 (8.13): enter the bill as one amount (Summary) or line by line. */
type LineMode = "summary" | "lines";

export default function BillPay() {
  const { t, locale } = useTranslation();
  const c: Copy = COPY[locale === "ar" ? "ar" : "en"];
  const paymentMethodLabel = (method: string) =>
    (
      ({
        bank_transfer: t["pages.bankTransfer"],
        cash: c.cash,
        cheque: t["pages.cheque"],
        credit_card: c.card,
      }) as Record<string, string>
    )[method] ?? method.replace(/_/g, " ");
  const { toast } = useToast();
  const { company: _company, companyId } = useDefaultCompany();
  const { gate } = useCompanyPermission();

  const search = useSearch();
  const [activeTab, setActiveTab] = useState<BillPayTab>(() => billPayTabFromSearch(search));
  const { routed, editor, toNew, toEdit, toList } = useEditorRoute("/bill-pay");
  const [billEditorOpen, setBillEditorOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<BillDetail | null>(null);
  const [payingBill, setPayingBill] = useState<VendorBill | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    billStatusFilterFromSearch(search)
  );
  const [vendorSearch, setVendorSearch] = useState("");
  // WQ2: the supplier invoice in the editor (uploaded as the attachment on save) and what the
  // capture read from it; nothing is stored until the bill is saved.
  const [pendingFile, setPendingFile] = useState<PendingBillFile | null>(null);
  const [capture, setCapture] = useState<BillCaptureResult | null>(null);
  const [lineMode, setLineMode] = useState<LineMode>("lines");
  const [, navigate] = useLocation();
  // A later drill-through (?status= / ?tab=) while the page is open re-applies the filter.
  const [appliedSearch, setAppliedSearch] = useState(search);
  if (appliedSearch !== search) {
    setAppliedSearch(search);
    setStatusFilter(billStatusFilterFromSearch(search));
    setActiveTab(billPayTabFromSearch(search));
  }

  // ===========================
  // Queries
  // ===========================

  const {
    data: bills = [],
    isLoading: billsLoading,
    isLoadingError: billsFailed,
    refetch: refetchBills,
  } = useQuery<VendorBill[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });

  // X5 (J1 D1): payments default to the primary bank account's GL, never a header account.
  const { data: bankAccounts = [] } = useQuery<BankAccountLike[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });

  // R10-11: bill lines carry an optional cost centre (hidden when the company has none).
  const { data: costCenters = [] } = useQuery<Array<{ id: string; code: string; name: string }>>({
    queryKey: [`/api/companies/${companyId}/cost-centers`],
    enabled: !!companyId,
    retry: false,
  });

  const {
    data: summary,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<BillSummary>({
    queryKey: ["/api/companies", companyId, "bills", "summary"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills/summary`),
    enabled: !!companyId && activeTab === "summary",
  });

  const {
    data: aging,
    error: agingError,
    refetch: refetchAging,
  } = useQuery<AgingReport>({
    queryKey: ["/api/companies", companyId, "bills", "aging"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills/aging`),
    enabled: !!companyId && activeTab === "summary",
  });

  // WQ2 (8.15): pending bills and whether this user may sign the next step (approval rules).
  const { data: approvalQueue = [] } = useQuery<ApprovalQueueEntry[]>({
    queryKey: ["/api/companies", companyId, "bills", "approval-queue"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills/approval-queue`),
    enabled: !!companyId,
    retry: false,
  });
  const awaitingMe = useMemo(
    () => new Set(approvalQueue.filter((q) => q.awaiting_me).map((q) => q.bill_id)),
    [approvalQueue]
  );
  const tabCounts = useMemo(() => billTabCounts(bills, approvalQueue), [bills, approvalQueue]);

  // WQ2 (8.2): OCR capture says whether AI reading is enabled at all.
  const { data: ocrStatus } = useQuery<{ aiConfigured: boolean }>({
    queryKey: ["/api/ocr/status"],
    retry: false,
  });

  const paymentPages = useInfiniteQuery({
    queryKey: ["/api/companies", companyId, "bills", "all-payments"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<BillPaymentPage> =>
      apiRequest(
        "GET",
        `/api/companies/${companyId}/bills/all-payments${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`
      ),
    getNextPageParam: (page) => page.nextCursor,
    enabled: !!companyId && activeTab === "payments",
  });
  const paymentsData = paymentPages.data?.pages.flatMap((page) => page.items) ?? [];

  // ===========================
  // Filtered bills
  // ===========================

  const filteredBills = useMemo(
    () => filterBills(bills, statusFilter, vendorSearch),
    [bills, statusFilter, vendorSearch]
  );

  // ===========================
  // Bill Form
  // ===========================

  const billForm = useForm<BillFormData>({
    resolver: zodResolver(billFormSchema),
    defaultValues: {
      vendor_id: "",
      vendor_name: "",
      vendor_trn: "",
      bill_number: "",
      bill_date: new Date(),
      due_date: undefined,
      currency: "AED",
      exchange_rate: "",
      reverse_charge: false,
      is_import: false,
      customs_declaration_no: "",
      import_vat_amount: "",
      place_of_supply: "",
      category: "",
      notes: "",
      line_items: [{ ...EMPTY_LINE }],
    },
  });

  const {
    fields: lineFields,
    append: appendLine,
    remove: removeLine,
  } = useFieldArray({
    control: billForm.control,
    name: "line_items",
  });

  // ===========================
  // Payment Form
  // ===========================

  const paymentForm = useForm<PaymentFormData>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      payment_date: new Date(),
      amount: 0,
      payment_method: "bank_transfer",
      payment_account_id: "",
      exchange_rate: "",
      reference: "",
      notes: "",
    },
  });

  // ===========================
  // Mutations
  // ===========================

  const invalidateBills = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bills"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bills", "summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bills", "aging"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/companies", companyId, "bills", "all-payments"],
    });
  };

  const buildBillPayload = (data: BillFormData) => ({
    vendor_id: data.vendor_id || null,
    vendor_name: data.vendor_name,
    vendor_trn: data.vendor_trn || null,
    bill_number: data.bill_number || null,
    bill_date: ymd(data.bill_date),
    due_date: data.due_date ? ymd(data.due_date) : null,
    currency: data.currency,
    exchange_rate: data.currency !== "AED" && data.exchange_rate ? data.exchange_rate : null,
    reverse_charge: data.reverse_charge || data.is_import,
    is_import: data.is_import,
    customs_declaration_no: data.is_import ? data.customs_declaration_no || null : null,
    import_vat_amount: data.is_import && data.import_vat_amount ? data.import_vat_amount : null,
    place_of_supply: data.place_of_supply || null,
    category: data.category || null,
    notes: data.notes || null,
    line_items: data.line_items.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      vat_supply_type: l.vat_supply_type,
      vat_rate: ["zero_rated", "exempt", "out_of_scope"].includes(l.vat_supply_type) ? 0 : 5,
      account_id: l.account_id || null,
      cost_center_id: l.cost_center_id || null,
      product_id: l.product_id || null,
    })),
  });

  /** WQ2: the file chosen in the editor becomes the bill's attachment once the bill is saved. */
  const uploadPendingFile = async (billId: string) => {
    if (!pendingFile) return;
    try {
      await apiRequest("POST", `/api/bills/${billId}/attachment`, {
        file: pendingFile.dataUrl,
        filename: pendingFile.name.slice(0, 200),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: t["purchases.capture.attachFailed"],
        description: (error as Error)?.message,
      });
    }
  };

  const createBillMutation = useMutation({
    mutationFn: async (data: BillFormData) => {
      const bill = await apiRequest(
        "POST",
        `/api/companies/${companyId}/bills`,
        buildBillPayload(data)
      );
      if (bill?.id) await uploadPendingFile(bill.id);
      return bill;
    },
    onSuccess: () => {
      invalidateBills();
      toast({
        title: translateNow("toasts.billCreated"),
        description: translateNow("toasts.vendorBillHasBeenCreatedSuccessfully"),
      });
      leaveEditor();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToCreateBill"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const updateBillMutation = useMutation({
    mutationFn: async ({
      id,
      data,
      reason,
    }: {
      id: string;
      data: BillFormData;
      reason?: string;
    }) => {
      const payload = buildBillPayload(data);
      // Approved bills are corrected by reversal + repost (POST /revise), never edited in place.
      const out = reason
        ? await apiRequest("POST", `/api/bills/${id}/revise`, { ...payload, reason })
        : await apiRequest("PATCH", `/api/bills/${id}`, payload);
      await uploadPendingFile(id);
      return out;
    },
    onSuccess: () => {
      invalidateBills();
      toast({
        title: translateNow("toasts.billUpdated"),
        description: translateNow("toasts.vendorBillHasBeenUpdatedSuccessfully"),
      });
      leaveEditor();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToUpdateBill"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const deleteBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/bills/${id}`),
    onSuccess: () => {
      invalidateBills();
      toast({
        title: translateNow("toasts.billDeleted"),
        description: translateNow("toasts.vendorBillHasBeenDeleted"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToDeleteBill"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const approveBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/bills/${id}/approve`),
    onSuccess: () => {
      invalidateBills();
      toast({
        title: translateNow("toasts.billApproved"),
        description: translateNow("toasts.theBillHasBeenApproved"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToApproveBill"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  type BillAction = "void" | "reject" | "submit";
  const billActionMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: BillAction; reason?: string }) =>
      apiRequest("POST", `/api/bills/${id}/${action}`, action === "submit" ? {} : { reason }),
    onSuccess: (_r: unknown, vars: { id: string; action: BillAction; reason?: string }) => {
      invalidateBills();
      toast({
        title:
          vars.action === "void" ? c.voided : vars.action === "reject" ? c.rejected : c.submitted,
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: error?.message || translateNow("toasts.error") });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ billId, data }: { billId: string; data: PaymentFormData }) => {
      const payload = {
        payment_date: ymd(data.payment_date),
        amount: data.amount,
        payment_method: data.payment_method,
        payment_account_id: data.payment_account_id || null,
        exchange_rate: data.exchange_rate || null,
        reference: data.reference || null,
        notes: data.notes || null,
      };
      return apiRequest("POST", `/api/bills/${billId}/payments`, payload);
    },
    onSuccess: (result: any) => {
      invalidateBills();
      toast({
        title: translateNow("toasts.paymentRecorded"),
        description: formatMessage(translateNow("toasts.paymentRecordedBillStatus"), {
          status: statusLabel(t, result.bill_status),
          remaining: formatCurrency(result.remaining, payingBill?.currency || "AED", locale),
        }),
      });
      setPaymentDialogOpen(false);
      setPayingBill(null);
      paymentForm.reset({
        payment_date: new Date(),
        amount: 0,
        payment_method: "bank_transfer",
        reference: "",
        notes: "",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToRecordPayment"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  // ===========================
  // Handlers
  // ===========================

  const resetBillForm = () => {
    billForm.reset({
      vendor_id: "",
      vendor_name: "",
      vendor_trn: "",
      bill_number: "",
      bill_date: new Date(),
      due_date: undefined,
      currency: "AED",
      exchange_rate: "",
      reverse_charge: false,
      is_import: false,
      customs_declaration_no: "",
      import_vat_amount: "",
      place_of_supply: "",
      category: "",
      notes: "",
      line_items: [{ ...EMPTY_LINE }],
    });
    setEditingBill(null);
    setPendingFile(null);
    setCapture(null);
    setLineMode("lines");
  };

  const handleEditBill = async (bill: VendorBill) => {
    try {
      const detail: BillDetail = await apiRequest("GET", `/api/bills/${bill.id}`);
      setEditingBill(detail);
      setPendingFile(null);
      setCapture(null);
      setLineMode("lines");
      billForm.reset({
        vendor_id: detail.vendor_id || "",
        vendor_name: detail.vendor_name,
        vendor_trn: detail.vendor_trn || "",
        bill_number: detail.bill_number || "",
        bill_date: parseCalendarDate(detail.bill_date),
        due_date: detail.due_date ? parseCalendarDate(detail.due_date) : undefined,
        currency: detail.currency || "AED",
        exchange_rate:
          detail.currency && detail.currency !== "AED" ? String(detail.exchange_rate ?? "") : "",
        reverse_charge: detail.reverse_charge === true,
        is_import: detail.is_import === true,
        customs_declaration_no: detail.customs_declaration_no || "",
        import_vat_amount:
          detail.is_import && Number(detail.import_vat_amount) > 0
            ? String(detail.import_vat_amount)
            : "",
        place_of_supply: detail.place_of_supply || "",
        category: detail.category || "",
        notes: detail.notes || "",
        line_items:
          detail.line_items.length > 0
            ? detail.line_items.map((l) => ({
                description: l.description,
                quantity: Number(l.quantity),
                unit_price: Number(l.unit_price),
                vat_rate: Number(l.vat_rate),
                vat_supply_type:
                  l.vat_supply_type ?? (Number(l.vat_rate) === 0 ? "zero_rated" : "standard_rated"),
                account_id: l.account_id || "",
                cost_center_id: l.cost_center_id || "",
                product_id: l.product_id || "",
              }))
            : [{ ...EMPTY_LINE }],
      });
      setBillEditorOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: error?.message || translateNow("toasts.failedToLoadBillDetails"),
      });
      if (routed) toList();
    }
  };

  const openNewBill = () => {
    if (routed) toNew();
    else setBillEditorOpen(true);
  };

  const openBillEditor = (bill: VendorBill) => {
    if (routed && editor !== bill.id) toEdit(bill.id);
    else void handleEditBill(bill);
  };

  /** Closes the editor and returns to the list. */
  function leaveEditor() {
    setBillEditorOpen(false);
    resetBillForm();
    if (routed && editor) toList();
  }

  const closeEditor = leaveEditor;

  // The editor routes: a blank bill, or the one being edited.
  useEffect(() => {
    if (editor === "new") setBillEditorOpen(true);
    else if (editor) void handleEditBill({ id: editor } as VendorBill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const handlePayBill = (bill: VendorBill) => {
    const remaining = Number(bill.total_amount) - Number(bill.amount_paid);
    setPayingBill(bill);
    paymentForm.reset({
      payment_date: new Date(),
      amount: Number(remaining.toFixed(2)),
      payment_method: "bank_transfer",
      payment_account_id: defaultPaymentAccountId(accounts, bankAccounts, {
        currency: bill.currency,
      }),
      exchange_rate: "",
      reference: "",
      notes: "",
    });
    setPaymentDialogOpen(true);
  };

  const onBillSubmit = (data: BillFormData) => {
    if (editingBill) {
      if (["approved", "overdue"].includes(editingBill.status)) {
        const reason = window.prompt(`${c.reviseNotice}\n${c.reasonPrompt}`);
        if (!reason) return;
        updateBillMutation.mutate({ id: editingBill.id, data, reason });
        return;
      }
      updateBillMutation.mutate({ id: editingBill.id, data });
    } else {
      createBillMutation.mutate(data);
    }
  };

  const onPaymentSubmit = (data: PaymentFormData) => {
    if (!payingBill) return;
    recordPaymentMutation.mutate({ billId: payingBill.id, data });
  };

  // Watch line items for live total calculation
  const watchLines = billForm.watch("line_items");
  const subtotal = watchLines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unit_price) || 0),
    0
  );
  const vatAmount = watchLines.reduce((sum, line) => {
    const lineAmount = (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
    const rated = !["zero_rated", "exempt", "out_of_scope"].includes(line.vat_supply_type);
    return sum + (rated ? lineAmount * 0.05 : 0);
  }, 0);
  const watchReverseCharge = billForm.watch("reverse_charge") || billForm.watch("is_import");
  const watchCurrency = billForm.watch("currency");
  const watchIsImport = billForm.watch("is_import");
  // Reverse charge: VAT is self-assessed, the vendor is owed the subtotal only.
  const totalAmount = watchReverseCharge ? subtotal : subtotal + vatAmount;
  const cashAccounts = postablePaymentAccounts(accounts);

  // Expense account options
  // C1 (RH1): control accounts (A/R, A/P, inventory, VAT, payroll) are posted by their own module.
  const expenseAccounts = withoutControlAccounts(accounts).filter(
    (a: any) => a.type === "expense" || a.type === "asset"
  );
  const costCenterList = Array.isArray(costCenters) ? costCenters : [];

  // ── WQ2: supplier, item and capture handlers ───────────────────────────
  /** A supplier's default expense account goes on the lines that have none yet. */
  const applySupplierDefaults = (supplier: {
    defaultExpenseAccountId?: string | null;
    paymentTermsDays?: number | null;
  }) => {
    const lines = billForm.getValues("line_items");
    if (supplier.defaultExpenseAccountId) {
      lines.forEach((l, i) => {
        if (!l.account_id && !l.product_id)
          billForm.setValue(`line_items.${i}.account_id`, supplier.defaultExpenseAccountId!);
      });
    }
    const billDate = billForm.getValues("bill_date");
    const terms = supplier.paymentTermsDays;
    if (billDate && !billForm.getValues("due_date") && typeof terms === "number" && terms > 0) {
      const due = new Date(billDate);
      due.setDate(due.getDate() + terms);
      billForm.setValue("due_date", due);
    }
  };

  const pickSupplier = (s: SupplierOption) => {
    billForm.setValue("vendor_id", s.id);
    billForm.setValue("vendor_name", s.name, { shouldValidate: true });
    billForm.setValue("vendor_trn", s.trn ?? "");
    if (s.currency && !editingBill && !capture) billForm.setValue("currency", s.currency);
    applySupplierDefaults(s);
  };

  const pickItem = (index: number, item: Parameters<typeof purchasePriceOf>[0] | null) => {
    billForm.setValue(`line_items.${index}.product_id`, item?.id ?? "");
    if (!item) return;
    billForm.setValue(`line_items.${index}.description`, item.name, { shouldValidate: true });
    billForm.setValue(`line_items.${index}.unit_price`, purchasePriceOf(item));
    // A stock item is posted to inventory by the item itself; its line takes no expense account.
    if (isStockItem(item)) billForm.setValue(`line_items.${index}.account_id`, "");
  };

  /** Fill the form from a capture. The user reviews it; nothing is saved here. */
  const applyCapture = (result: BillCaptureResult) => {
    setCapture(result);
    const d = result.draft;
    billForm.setValue("vendor_id", d.vendor_id ?? "");
    billForm.setValue("vendor_name", d.vendor_name, { shouldValidate: !!d.vendor_name });
    billForm.setValue("vendor_trn", d.vendor_trn ?? "");
    billForm.setValue("bill_number", d.bill_number ?? "");
    if (d.bill_date) billForm.setValue("bill_date", parseCalendarDate(d.bill_date));
    billForm.setValue("due_date", d.due_date ? parseCalendarDate(d.due_date) : undefined);
    billForm.setValue("currency", d.currency);
    billForm.setValue("reverse_charge", d.reverse_charge);
    const supplier = d.vendor_id
      ? (
          queryClient.getQueryData<SupplierOption[]>(["/api/companies", companyId, "vendors"]) ?? []
        ).find((s) => s.id === d.vendor_id)
      : undefined;
    billForm.setValue(
      "line_items",
      d.line_items.map((l) => ({
        ...EMPTY_LINE,
        description: l.description,
        quantity: l.quantity,
        unit_price: Number(l.unit_price),
        vat_supply_type: l.vat_supply_type,
        vat_rate: l.vat_supply_type === "zero_rated" ? 0 : 5,
        account_id: supplier?.defaultExpenseAccountId ?? "",
      }))
    );
    setLineMode(d.line_items.length > 1 ? "lines" : "summary");
  };

  /** Confidence pill next to a form label, after a capture. */
  const conf = (field: BillCaptureField) =>
    capture ? (
      <ConfidenceBadge band={capture.confidence[field]} testId={`field-confidence-${field}`} />
    ) : null;

  // ===========================
  // Render
  // ===========================

  if (!companyId) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold">
          <T k="pages.billPay" />
        </h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              <T k="pages.pleaseCreateACompanyFirstToManageBills" />
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Spec 3.7: a bill is written on a full page (EditorShell), not in a modal. Posting, VAT and
  // settlement are unchanged: the form submits the same payloads as before.
  const billEditor = (
    <EditorShell
      testId="dialog-bill-form"
      backHref="/bill-pay"
      backLabel={t["invoices.editor.backBills"]}
      eyebrow="Purchases"
      title={editingBill ? t["screens.editBill"] : t["screens.newVendorBill"]}
      description={editingBill ? t["screens.billDialogEditDesc"] : t["screens.billDialogNewDesc"]}
      preview={
        <BillCapturePanel
          companyId={companyId}
          file={pendingFile}
          onFile={(f) => {
            setPendingFile(f);
            if (!f) setCapture(null);
          }}
          storedAttachment={
            editingBill?.has_attachment
              ? { billId: editingBill.id, name: editingBill.attachment_name ?? null }
              : null
          }
          onCaptured={applyCapture}
          result={capture}
          aiAvailable={ocrStatus?.aiConfigured !== false}
        />
      }
      previewLabel={t["purchases.capture.title"]}
      mobilePreview="first"
      headerActions={
        editingBill && ["approved", "partial", "paid", "overdue"].includes(editingBill.status) ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(`/debit-notes/new?billId=${editingBill.id}`)}
            {...gate("ledger.post")}
            data-testid="button-supplier-credit"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            {t["purchases.debitNote.fromBill"]}
          </Button>
        ) : undefined
      }
      footerSummary={
        <span className="flex flex-wrap items-baseline gap-x-2" data-testid="editor-total">
          <span>{t["invoices.editor.total"]}</span>
          <Money
            amount={totalAmount}
            currency={watchCurrency || "AED"}
            className="text-h3 font-semibold text-foreground"
          />
        </span>
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={closeEditor}>
            <T k="pages.cancel" />
          </Button>
          <Button
            type="submit"
            form="bill-editor-form"
            className="sm:min-w-32"
            disabled={createBillMutation.isPending || updateBillMutation.isPending}
            data-testid="button-submit-bill"
          >
            {createBillMutation.isPending || updateBillMutation.isPending
              ? t["forms.saving"]
              : editingBill
                ? t["screens.updateBill"]
                : t["screens.createBill"]}
          </Button>
        </>
      }
    >
      <Form {...billForm}>
        <form
          id="bill-editor-form"
          onSubmit={billForm.handleSubmit(onBillSubmit)}
          noValidate
          className="min-w-0 space-y-6"
        >
          <FormErrorSummary />
          <FormSection
            title={t["forms.section.vendor"]}
            description={t["forms.section.vendorDesc"]}
          >
            <FormGrid>
              <FormField
                control={billForm.control}
                name="vendor_name"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel required className="flex items-center gap-2">
                      {t["purchases.supplier.label"]}
                      {conf("supplier")}
                    </FormLabel>
                    <FormControl>
                      <SupplierPicker
                        ref={field.ref}
                        name={field.name}
                        onBlur={field.onBlur}
                        companyId={companyId}
                        vendorId={billForm.watch("vendor_id")}
                        vendorName={field.value}
                        invalid={!!fieldState.error}
                        onPick={pickSupplier}
                        onFreeText={(name) => {
                          billForm.setValue("vendor_id", "");
                          field.onChange(name);
                        }}
                        createSuggestion={
                          capture && capture.supplierMatch === "none"
                            ? { name: capture.draft.vendor_name, trn: capture.draft.vendor_trn }
                            : null
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={billForm.control}
                name="vendor_trn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.vendorTrn" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        ltr
                        inputMode="numeric"
                        placeholder={t["screens.trnOptional"]}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title={t["forms.section.document"]}
            description={t["forms.section.documentDesc"]}
          >
            <FormGrid>
              <FormField
                control={billForm.control}
                name="bill_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <T k="pages.billNumber" />
                      {conf("billNumber")}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} ltr placeholder={t["forms.bill.numberHint"]} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={billForm.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.category" />
                    </FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t["screens.selectCategory"]} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="utilities">
                          <T k="pages.utilities" />
                        </SelectItem>
                        <SelectItem value="rent">{t["forms.bill.rent"]}</SelectItem>
                        <SelectItem value="supplies">
                          <T k="pages.supplies" />
                        </SelectItem>
                        <SelectItem value="services">
                          <T k="pages.professionalServices" />
                        </SelectItem>
                        <SelectItem value="equipment">
                          <T k="pages.equipment" />
                        </SelectItem>
                        <SelectItem value="travel">
                          <T k="pages.travel" />
                        </SelectItem>
                        <SelectItem value="insurance">
                          <T k="pages.insurance" />
                        </SelectItem>
                        <SelectItem value="maintenance">
                          <T k="pages.maintenance" />
                        </SelectItem>
                        <SelectItem value="other">
                          <T k="pages.other" />
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {(["bill_date", "due_date"] as const).map((name) => (
                <FormField
                  key={name}
                  control={billForm.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel
                        required={name === "bill_date"}
                        className="flex items-center gap-2"
                      >
                        {name === "bill_date" ? <T k="pages.billDate" /> : <T k="pages.dueDate" />}
                        {name === "bill_date" && conf("billDate")}
                      </FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-start font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="h-4 w-4" />
                              {field.value ? formatDate(field.value, locale) : t["pages.pickADate"]}
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
              ))}
              <FormField
                control={billForm.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <T k="pages.currency" />
                      {conf("currency")}
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="AED">AED</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="SAR">SAR</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {watchCurrency !== "AED" && (
                <FormField
                  control={billForm.control}
                  name="exchange_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{c.exchangeRate}</FormLabel>
                      <FormControl>
                        <Input {...field} ltr inputMode="decimal" />
                      </FormControl>
                      <FormDescription>{c.exchangeRateHint}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </FormGrid>
          </FormSection>

          <FormSection title={t["forms.section.tax"]} description={t["forms.bill.taxDesc"]}>
            <FormGrid>
              <FormField
                control={billForm.control}
                name="place_of_supply"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{c.placeOfSupply}</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={c.placeOfSupply} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EMIRATE_CODES.map((e) => (
                          <SelectItem key={e} value={e}>
                            {t[`invoices.emirate.${e}`] ?? e.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <div className="flex flex-col justify-end gap-3 sm:pb-2">
                <FormField
                  control={billForm.control}
                  name="reverse_charge"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(v) => field.onChange(v === true)}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">{c.reverseCharge}</FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={billForm.control}
                  name="is_import"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(v) => field.onChange(v === true)}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">{c.isImport}</FormLabel>
                    </FormItem>
                  )}
                />
              </div>
              {watchIsImport && (
                <>
                  <FormField
                    control={billForm.control}
                    name="customs_declaration_no"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{c.customsNo}</FormLabel>
                        <FormControl>
                          <Input {...field} ltr />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={billForm.control}
                    name="import_vat_amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{c.importVat}</FormLabel>
                        <FormControl>
                          <Input {...field} ltr inputMode="decimal" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </>
              )}
            </FormGrid>
          </FormSection>

          <FormSection
            title={
              <span className="flex items-center gap-2">
                {lineMode === "summary" ? t["purchases.lines.summary"] : <T k="pages.lineItems" />}
                {conf("lines")}
              </span>
            }
            description={
              lineMode === "summary"
                ? t["purchases.lines.summaryDesc"]
                : t["forms.section.linesDesc"]
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label={t["purchases.lines.modeLabel"]}
                  className="inline-flex rounded-lg border p-0.5"
                  data-testid="bill-line-mode"
                >
                  {(["summary", "lines"] as const).map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={lineMode === m ? "secondary" : "ghost"}
                      aria-pressed={lineMode === m}
                      disabled={m === "summary" && lineFields.length > 1}
                      title={
                        m === "summary" && lineFields.length > 1
                          ? t["purchases.lines.summaryNeedsOne"]
                          : undefined
                      }
                      onClick={() => {
                        if (m === "summary") billForm.setValue("line_items.0.quantity", 1);
                        setLineMode(m);
                      }}
                      data-testid={`bill-line-mode-${m}`}
                    >
                      {m === "summary"
                        ? t["purchases.lines.modeSummary"]
                        : t["purchases.lines.modeLines"]}
                    </Button>
                  ))}
                </div>
                {lineMode === "lines" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendLine({ ...EMPTY_LINE })}
                  >
                    <Plus className="h-4 w-4" />
                    <T k="pages.addLine" />
                  </Button>
                )}
              </div>
            }
          >
            <LineItemList>
              {lineFields.map((field, index) =>
                lineMode === "summary" && index > 0 ? null : (
                  <LineItem
                    key={field.id}
                    index={index}
                    onRemove={() => removeLine(index)}
                    canRemove={lineFields.length > 1 && lineMode === "lines"}
                    gridClassName="sm:grid-cols-3"
                    main={
                      <FormField
                        control={billForm.control}
                        name={`line_items.${index}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                {...field}
                                dir="auto"
                                placeholder={t.description}
                                aria-label={formatMessage(t["forms.lineDescription"], {
                                  n: index + 1,
                                })}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    }
                  >
                    {lineMode === "lines" && (
                      <BillItemPicker
                        companyId={companyId}
                        index={index}
                        value={watchLines[index]?.product_id}
                        onPick={(item) => pickItem(index, item)}
                      />
                    )}
                    {lineMode === "lines" && (
                      <FormField
                        control={billForm.control}
                        name={`line_items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className={lineLabelClass}>{t["forms.col.qty"]}</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" step="0.01" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={billForm.control}
                      name={`line_items.${index}.unit_price`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={lineLabelClass}>
                            {lineMode === "summary"
                              ? t["purchases.lines.amountBeforeVat"]
                              : t["forms.col.unitPrice"]}
                          </FormLabel>
                          <FormControl>
                            <Input {...field} type="number" step="0.01" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <LineAmount label={t["forms.col.amount"]}>
                      <Money
                        amount={
                          (Number(watchLines[index]?.quantity) || 0) *
                          (Number(watchLines[index]?.unit_price) || 0)
                        }
                        currency={watchCurrency || "AED"}
                      />
                    </LineAmount>
                    <FormField
                      control={billForm.control}
                      name={`line_items.${index}.vat_supply_type`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={lineLabelClass}>{c.supplyType}</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={c.supplyType} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {SUPPLY_TYPES.map((st) => (
                                <SelectItem key={st} value={st}>
                                  {supplyLabel(c, st)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={billForm.control}
                      name={`line_items.${index}.account_id`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={lineLabelClass}>{t["forms.col.account"]}</FormLabel>
                          <Select value={field.value || ""} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={t["screens.account"]} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <PurchaseAccountOptions accounts={expenseAccounts} />
                            </SelectContent>
                          </Select>
                          {index === 0 && (
                            <FormDescription>{t["forms.controlAccountsHidden"]}</FormDescription>
                          )}
                        </FormItem>
                      )}
                    />
                    {costCenterList.length > 0 && (
                      <FormField
                        control={billForm.control}
                        name={`line_items.${index}.cost_center_id`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className={lineLabelClass}>
                              {t["purchases.costCenter"]}
                            </FormLabel>
                            <Select
                              value={field.value || NO_COST_CENTER}
                              onValueChange={(v) => field.onChange(v === NO_COST_CENTER ? "" : v)}
                            >
                              <FormControl>
                                <SelectTrigger data-testid={`bill-line-cost-center-${index}`}>
                                  <SelectValue placeholder={t["purchases.costCenter"]} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value={NO_COST_CENTER}>
                                  {t["purchases.noCostCenter"]}
                                </SelectItem>
                                {costCenterList.map((cc) => (
                                  <SelectItem key={cc.id} value={cc.id}>
                                    {cc.code} · {cc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                    )}
                  </LineItem>
                )
              )}
            </LineItemList>
            <FormTotals
              rows={[
                {
                  label: t["forms.preview.subtotal"],
                  value: <Money amount={subtotal} currency={watchCurrency || "AED"} />,
                },
                {
                  label: t["forms.col.vat"],
                  value: <Money amount={vatAmount} currency={watchCurrency || "AED"} />,
                },
              ]}
              total={{
                label: t["forms.preview.total"],
                value: <Money amount={totalAmount} currency={watchCurrency || "AED"} />,
              }}
            />
          </FormSection>

          <FormSection title={t["forms.section.notes"]}>
            <FormField
              control={billForm.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">
                    <T k="pages.notes" />
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      dir="auto"
                      placeholder={t["screens.billNotesPlaceholder"]}
                      rows={2}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>
        </form>
      </Form>
    </EditorShell>
  );

  if (editor && editor !== "new" && !editingBill) return <PageSkeleton variant="form" />;
  if (billEditorOpen || editor) return billEditor;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title={t["purchases.billsTitle"]}
        description={(t as any).billPaySubtitle ?? "Manage vendor bills, approvals, and payments"}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate("/debit-notes")}
              data-testid="button-debit-notes"
            >
              <Undo2 className="w-4 h-4" aria-hidden />
              {t["purchases.debitNote.listTitle"]}
            </Button>
            <Button
              data-testid="button-new-bill"
              onClick={openNewBill}
              {...gate("documents.write")}
            >
              <Plus className="w-4 h-4" />
              <T k="pages.newBill" />
            </Button>
          </>
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BillPayTab)}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="bills">
            <FileText className="w-4 h-4" />
            <T k="pages.bills" />
          </TabsTrigger>
          <TabsTrigger value="payments">
            <CreditCard className="w-4 h-4" />
            <T k="pages.payments" />
          </TabsTrigger>
          <TabsTrigger value="summary">
            <BarChart3 className="w-4 h-4" />
            <T k="pages.summary" />
          </TabsTrigger>
        </TabsList>

        {/* ================================== */}
        {/* BILLS TAB                          */}
        {/* ================================== */}
        <TabsContent value="bills" className="space-y-6 mt-0">
          <InboundCreditNotesCard companyId={companyId} />
          {/* WQ2 (8.15): status tabs; each tab is one status filter (?status= keeps working). */}
          <Tabs
            value={billTabForFilter(statusFilter)}
            onValueChange={(id) =>
              setStatusFilter(BILL_LIST_TABS.find((tab) => tab.id === id)?.filter ?? "all")
            }
          >
            <ScrollTabs
              variant="line"
              maxVisible={5}
              value={billTabForFilter(statusFilter)}
              onValueChange={(id) =>
                setStatusFilter(BILL_LIST_TABS.find((tab) => tab.id === id)?.filter ?? "all")
              }
              moreLabel={t["purchases.tabs.more"]}
              aria-label={t["purchases.tabs.label"]}
              data-testid="bill-status-tabs"
            >
              {BILL_LIST_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} data-testid={`bill-tab-${tab.id}`}>
                  {t[`purchases.tabs.${tab.id}`]}
                  <span
                    className="ms-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
                    data-testid={`bill-tab-count-${tab.id}`}
                  >
                    {tabCounts[tab.id]}
                  </span>
                </TabsTrigger>
              ))}
            </ScrollTabs>
          </Tabs>
          {billTabForFilter(statusFilter) === "to_approve" && (
            <p className="text-sm text-muted-foreground" data-testid="bill-awaiting-me">
              {formatMessage(t["purchases.tabs.awaitingMe"], { n: tabCounts.awaitingMe })}
            </p>
          )}
          {/* Filters (one row, not in a card) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                placeholder={t["screens.searchVendorOrBill"]}
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                className="h-9 ps-9"
                aria-label={t["screens.searchVendorOrBill"]}
              />
            </div>
          </div>

          <DataTableCard
            status={
              billsLoading
                ? "loading"
                : billsFailed
                  ? "error"
                  : filteredBills.length === 0
                    ? "empty"
                    : "ready"
            }
            error={{ onRetry: () => void refetchBills() }}
            columnLabels={[t["pages.vendor"], t.date, t.amount, t.status]}
            testId="bills-table"
            empty={{
              icon: FileText,
              title: t["pages.noBillsFound"],
              description:
                bills.length === 0 ? t["screens.billsEmptyBody"] : t["screens.billsNoMatchBody"],
              action:
                bills.length === 0
                  ? {
                      label: t["pages.newBill"],
                      href: "/bill-pay/new",
                      permission: "documents.write",
                      icon: Plus,
                    }
                  : undefined,
            }}
          >
            <Table className="row-cards">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-full">
                    <T k="pages.vendor" />
                  </TableHead>
                  <TableHead>{t["screens.billNumber"]}</TableHead>
                  <TableHead className="hidden 2xl:table-cell">{t.date}</TableHead>
                  <TableHead>
                    <T k="pages.dueDate" />
                  </TableHead>
                  <TableHead data-numeric="">
                    <T k="pages.amount" />
                  </TableHead>
                  <TableHead data-numeric="">{t["screens.paid"]}</TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t.actions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBills.map((bill) => {
                  const status = bill.display_status ?? bill.status;
                  const overdueDays =
                    status === "overdue" && bill.due_date
                      ? Math.max(
                          0,
                          Math.floor((Date.now() - new Date(bill.due_date).getTime()) / 86_400_000)
                        )
                      : undefined;
                  const payable = ["approved", "partial", "overdue"].includes(bill.status);
                  return (
                    <TableRow key={bill.id}>
                      <TableCell
                        data-truncate=""
                        data-cell="title"
                        dir="auto"
                        className="font-medium"
                      >
                        {bill.vendor_name}
                        <EInvoiceOriginTag origin={bill.origin} />
                        {bill.has_attachment && (
                          <Paperclip
                            className="ms-1.5 inline h-3.5 w-3.5 text-muted-foreground"
                            aria-label={t["purchases.capture.hasAttachment"]}
                          />
                        )}
                        {bill.status === "pending" && awaitingMe.has(bill.id) && (
                          <span className="ms-2 rounded-full bg-info-subtle px-2 py-0.5 text-xs text-info-subtle-foreground">
                            {t["purchases.tabs.awaitingYou"]}
                          </span>
                        )}
                      </TableCell>
                      <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                        <MiddleTruncate text={bill.bill_number || "—"} />
                      </TableCell>
                      <TableCell
                        data-nowrap=""
                        data-cell="meta"
                        data-keep=""
                        className="hidden text-muted-foreground 2xl:table-cell"
                      >
                        {formatDate(bill.bill_date, locale)}
                      </TableCell>
                      <TableCell data-nowrap="" className="text-muted-foreground">
                        {bill.due_date ? formatDate(bill.due_date, locale) : "—"}
                      </TableCell>
                      <MoneyCell
                        amount={Number(bill.total_amount)}
                        currency={bill.currency || "AED"}
                        className="font-medium"
                        data-cell="amount"
                      />
                      <MoneyCell
                        amount={Number(bill.amount_paid)}
                        currency={bill.currency || "AED"}
                        className="text-muted-foreground"
                      />
                      <TableCell data-nowrap="" data-cell="status">
                        <StatusBadge status={status} overdueDays={overdueDays} />
                      </TableCell>
                      <TableCell data-cell="actions">
                        <RowActions
                          maxInline={1}
                          collapseOnMobile
                          menu={
                            <>
                              {(bill.status === "draft" || bill.status === "rejected") && (
                                <DropdownMenuItem
                                  {...gate("documents.write")}
                                  onClick={() =>
                                    billActionMutation.mutate({ id: bill.id, action: "submit" })
                                  }
                                >
                                  <Send aria-hidden />
                                  {c.submitBill}
                                </DropdownMenuItem>
                              )}
                              {bill.status === "pending" && (
                                <DropdownMenuItem
                                  {...gate("documents.approve")}
                                  onClick={() => {
                                    const reason = window.prompt(c.reasonPrompt);
                                    if (reason)
                                      billActionMutation.mutate({
                                        id: bill.id,
                                        action: "reject",
                                        reason,
                                      });
                                  }}
                                >
                                  <AlertTriangle aria-hidden />
                                  {c.rejectBill}
                                </DropdownMenuItem>
                              )}
                              {["draft", "pending", "approved", "overdue"].includes(bill.status) &&
                                Number(bill.amount_paid) === 0 && (
                                  <DropdownMenuItem
                                    {...gate("documents.write")}
                                    onClick={() => {
                                      const reason = window.prompt(c.reasonPrompt);
                                      if (reason)
                                        billActionMutation.mutate({
                                          id: bill.id,
                                          action: "void",
                                          reason,
                                        });
                                    }}
                                  >
                                    <Ban aria-hidden />
                                    {c.voidBill}
                                  </DropdownMenuItem>
                                )}
                              {["approved", "partial", "paid", "overdue"].includes(bill.status) && (
                                <DropdownMenuItem
                                  {...gate("ledger.post")}
                                  onClick={() => navigate(`/debit-notes/new?billId=${bill.id}`)}
                                >
                                  <Undo2 aria-hidden />
                                  {t["purchases.debitNote.fromBill"]}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                {...gate("documents.write")}
                                onClick={() => {
                                  if (confirm(t["screens.confirmDeleteBill"])) {
                                    deleteBillMutation.mutate(bill.id);
                                  }
                                }}
                              >
                                <Trash2 aria-hidden />
                                <T k="pages.delete" />
                              </DropdownMenuItem>
                            </>
                          }
                        >
                          {bill.status === "pending" && (
                            <RowActionButton
                              label={t["pages.approve"]}
                              icon={CheckCircle}
                              onClick={() => approveBillMutation.mutate(bill.id)}
                              {...gate("documents.approve")}
                            />
                          )}
                          {payable && (
                            <RowActionButton
                              label={t["pages.recordPayment"]}
                              icon={DollarSign}
                              onClick={() => handlePayBill(bill)}
                              {...gate("payments.release")}
                            />
                          )}
                          <RowActionButton
                            label={t.edit}
                            icon={Edit}
                            onClick={() => openBillEditor(bill)}
                            {...gate("documents.write")}
                          />
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTableCard>
        </TabsContent>

        {/* ================================== */}
        {/* PAYMENTS TAB                       */}
        {/* ================================== */}
        <TabsContent value="payments" className="space-y-4 mt-0">
          <div>
            <h2 className="text-h2 text-foreground">
              <T k="pages.paymentHistory" />
            </h2>
            <p className="mt-1 text-small text-muted-foreground">
              <T k="pages.allPaymentsRecordedAgainstVendorBills" />
            </p>
          </div>
          <DataTableCard
            status={
              paymentPages.isLoading
                ? "loading"
                : paymentPages.isLoadingError
                  ? "error"
                  : paymentsData.length === 0
                    ? "empty"
                    : "ready"
            }
            error={{ onRetry: () => void paymentPages.refetch() }}
            empty={{
              icon: Receipt,
              title: t["pages.noPaymentsYet"],
              description: t["pages.paymentsWillAppearHereWhenYouRecordThemAgainstBi"],
            }}
          >
            <Table className="row-cards">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.date}</TableHead>
                  <TableHead className="w-full">
                    <T k="pages.vendor" />
                  </TableHead>
                  <TableHead>{t["screens.billNumber"]}</TableHead>
                  <TableHead data-numeric="">
                    <T k="pages.amount" />
                  </TableHead>
                  <TableHead>
                    <T k="screens.billHistoryTypeAndStatus" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.reference" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentsData.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                      {formatDate(payment.payment_date, locale)}
                    </TableCell>
                    <TableCell
                      data-truncate=""
                      data-cell="title"
                      dir="auto"
                      className="font-medium"
                    >
                      {payment.vendor_name}
                    </TableCell>
                    <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                      <span dir="ltr" className="[unicode-bidi:isolate]">
                        {payment.bill_number || "—"}
                      </span>
                    </TableCell>
                    <MoneyCell
                      amount={Number(payment.amount)}
                      currency={payment.currency || "AED"}
                      className="font-medium"
                      data-cell="amount"
                    />
                    <TableCell
                      data-cell="status"
                      data-nowrap=""
                      className="text-muted-foreground max-md:text-caption"
                    >
                      <div>{t[`screens.billHistoryKind.${payment.kind}`]}</div>
                      <div>{t[`screens.billHistoryStatus.${payment.status}`]}</div>
                      {payment.kind === "payment" && payment.payment_method && (
                        <div className="hidden md:block">
                          {paymentMethodLabel(payment.payment_method)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell data-nowrap="" className="text-muted-foreground">
                      <span dir="ltr" className="[unicode-bidi:isolate]">
                        {payment.reference || "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTableCard>
          {paymentPages.isFetchNextPageError ? (
            <ErrorState compact onRetry={() => void paymentPages.fetchNextPage()} />
          ) : paymentPages.hasNextPage ? (
            <Button
              variant="outline"
              disabled={paymentPages.isFetchingNextPage}
              onClick={() => void paymentPages.fetchNextPage()}
            >
              {paymentPages.isFetchingNextPage
                ? t["components.ui.loading"]
                : t["screens.loadMorePayments"]}
            </Button>
          ) : null}
        </TabsContent>

        {/* ================================== */}
        {/* SUMMARY TAB                        */}
        {/* ================================== */}
        <TabsContent value="summary" className="space-y-6 mt-0">
          {summaryError && !summary ? (
            <ErrorState compact onRetry={() => void refetchSummary()} />
          ) : (
            <div
              className="grid grid-cols-2 gap-4 xl:grid-cols-4 mobile-keep-cols"
              data-testid={summary ? "bill-summary-balances" : undefined}
            >
              <StatCard
                label={t["pages.pending"]}
                value={<Money amount={summary?.pending.total || 0} />}
                hint={formatMessage(t["screens.billsCount"], {
                  count: summary?.pending.count || 0,
                })}
                loading={!summary}
              />
              <StatCard
                label={t["pages.approved"]}
                value={<Money amount={summary?.approved.total || 0} />}
                hint={formatMessage(t["screens.billsCount"], {
                  count: summary?.approved.count || 0,
                })}
                loading={!summary}
              />
              <StatCard
                label={c.paidStatus}
                value={<Money amount={summary?.paid.total || 0} />}
                hint={formatMessage(t["screens.billsCount"], { count: summary?.paid.count || 0 })}
                loading={!summary}
              />
              <StatCard
                label={t["pages.overdue"]}
                value={<Money amount={summary?.overdue.total || 0} />}
                hint={formatMessage(t["screens.billsCount"], {
                  count: summary?.overdue.count || 0,
                })}
                loading={!summary}
              />
            </div>
          )}

          {/* Aging Report */}
          <SectionCard
            title={t["pages.agingReport"]}
            description={t["pages.outstandingPayablesByAgeOfDueDate"]}
            flush
          >
            {aging ? (
              <Table className="mobile-fit">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-full">
                      <T k="pages.period" />
                    </TableHead>
                    <TableHead data-numeric="">
                      <T k="pages.amount" />
                    </TableHead>
                    <TableHead data-numeric="">
                      <T k="pages.bills" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      ["screens.agingCurrent", aging.current],
                      ["screens.aging1to30", aging.days_1_30],
                      ["screens.aging31to60", aging.days_31_60],
                      ["screens.aging61to90", aging.days_61_90],
                      ["screens.aging90plus", aging.days_90_plus],
                    ] as const
                  ).map(([key, bucket]) => (
                    <TableRow key={key}>
                      <TableCell
                        className={cn(
                          "font-medium",
                          key === "screens.aging90plus" && bucket.amount > 0 && "text-danger"
                        )}
                      >
                        {t[key]}
                      </TableCell>
                      <MoneyCell
                        amount={bucket.amount}
                        className={
                          key === "screens.aging90plus" && bucket.amount > 0
                            ? "text-danger"
                            : undefined
                        }
                      />
                      <TableCell data-numeric="" className="text-muted-foreground">
                        {bucket.count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>
                      <T k="pages.totalOutstanding" />
                    </TableCell>
                    <MoneyCell
                      amount={
                        aging.current.amount +
                        aging.days_1_30.amount +
                        aging.days_31_60.amount +
                        aging.days_61_90.amount +
                        aging.days_90_plus.amount
                      }
                    />
                    <TableCell data-numeric="">
                      {aging.current.count +
                        aging.days_1_30.count +
                        aging.days_31_60.count +
                        aging.days_61_90.count +
                        aging.days_90_plus.count}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            ) : agingError ? (
              <ErrorState compact onRetry={() => void refetchAging()} />
            ) : (
              <div className="space-y-3 p-5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ================================== */}
      {/* RECORD PAYMENT DIALOG              */}
      {/* ================================== */}
      <Dialog
        open={paymentDialogOpen}
        onOpenChange={(open) => {
          setPaymentDialogOpen(open);
          if (!open) {
            setPayingBill(null);
            paymentForm.reset();
          }
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              <T k="pages.recordPayment" />
            </DialogTitle>
            <DialogDescription>
              {payingBill && (
                <>
                  <T k="pages.billFrom" /> <strong>{payingBill.vendor_name}</strong>
                  {payingBill.bill_number && <> ({payingBill.bill_number})</>}
                  <br />
                  {formatMessage(t["pages.billPayTotalRemaining"], {
                    total: formatCurrency(
                      Number(payingBill.total_amount),
                      payingBill.currency || "AED",
                      locale
                    ),
                    remaining: formatCurrency(
                      Number(payingBill.total_amount) - Number(payingBill.amount_paid),
                      payingBill.currency || "AED",
                      locale
                    ),
                  })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Form {...paymentForm}>
            <form onSubmit={paymentForm.handleSubmit(onPaymentSubmit)} className="space-y-4">
              <FormField
                control={paymentForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.amount" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.01"
                        placeholder={t["screens.paymentAmount"]}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={paymentForm.control}
                name="payment_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.paymentDate" />
                    </FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-start font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="h-4 w-4" />
                            {field.value ? formatDate(field.value, locale) : t["pages.pickADate"]}
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
              <FormField
                control={paymentForm.control}
                name="payment_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.paymentMethod" />
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="bank_transfer">
                          <T k="pages.bankTransfer" />
                        </SelectItem>
                        <SelectItem value="cash">{c.cash}</SelectItem>
                        <SelectItem value="cheque">
                          <T k="pages.cheque" />
                        </SelectItem>
                        <SelectItem value="credit_card">{c.card}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={paymentForm.control}
                name="payment_account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{c.paymentAccount}</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={c.defaultBank} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {cashAccounts.map(
                          (a: { id: string; code: string; nameEn: string; nameAr?: string }) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.code} - {accountDisplayName(a, locale)}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              {payingBill && payingBill.currency && payingBill.currency !== "AED" && (
                <FormField
                  control={paymentForm.control}
                  name="exchange_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{c.paymentRate}</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode="decimal" placeholder={c.exchangeRateHint} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={paymentForm.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.reference" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        dir="ltr"
                        placeholder={t["screens.paymentReferenceOptional"]}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={paymentForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.notes" />
                    </FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder={t["screens.optionalNotes"]} rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPaymentDialogOpen(false);
                    setPayingBill(null);
                  }}
                >
                  <T k="pages.cancel" />
                </Button>
                <Button type="submit" disabled={recordPaymentMutation.isPending}>
                  {recordPaymentMutation.isPending ? "Recording..." : t["pages.recordPayment"]}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
