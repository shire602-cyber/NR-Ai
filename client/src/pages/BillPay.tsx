import { T } from "@/components/layout/T";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useSearch } from "wouter";
import { InboundCreditNotesCard } from "@/components/bills/InboundCreditNotesCard";
import {
  billPayTabFromSearch,
  billStatusFilterFromSearch,
  filterBills,
  type BillPayTab,
} from "@/lib/bill-filters";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency, formatDate } from "@/lib/format";
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
  Clock,
  AlertTriangle,
  CreditCard,
  BarChart3,
  Receipt,
  Send,
  Ban,
  Search,
} from "lucide-react";

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
    defaultBank: "Default bank account",
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
    defaultBank: "الحساب البنكي الافتراضي",
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
  created_at: string;
}

interface BillPayment {
  id: string;
  bill_id: string;
  payment_date: string;
  amount: string;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

interface BillDetail extends VendorBill {
  line_items: BillLineItem[];
  payments: BillPayment[];
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
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().min(0.01, "Quantity must be positive"),
  unit_price: z.coerce.number().min(0, "Price must be non-negative"),
  vat_rate: z.coerce.number().default(5),
  vat_supply_type: z.string().default("standard_rated"),
  account_id: z.string().optional(),
  cost_center_id: z.string().optional(),
});

const billFormSchema = z.object({
  vendor_name: z.string().min(1, "Vendor name is required"),
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
  line_items: z.array(billLineSchema).min(1, "At least one line item is required"),
});

const paymentFormSchema = z.object({
  payment_date: z.date(),
  amount: z.coerce.number().min(0.01, "Amount must be positive"),
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

  const search = useSearch();
  const [activeTab, setActiveTab] = useState<BillPayTab>(() => billPayTabFromSearch(search));
  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<BillDetail | null>(null);
  const [payingBill, setPayingBill] = useState<VendorBill | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    billStatusFilterFromSearch(search)
  );
  const [vendorSearch, setVendorSearch] = useState("");
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

  const { data: bills = [], isLoading: billsLoading } = useQuery<VendorBill[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });

  // R10-11: bill lines carry an optional cost centre (hidden when the company has none).
  const { data: costCenters = [] } = useQuery<Array<{ id: string; code: string; name: string }>>({
    queryKey: [`/api/companies/${companyId}/cost-centers`],
    enabled: !!companyId,
    retry: false,
  });

  const { data: summary } = useQuery<BillSummary>({
    queryKey: ["/api/companies", companyId, "bills", "summary"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills/summary`),
    enabled: !!companyId,
  });

  const { data: aging } = useQuery<AgingReport>({
    queryKey: ["/api/companies", companyId, "bills", "aging"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills/aging`),
    enabled: !!companyId,
  });

  // Get all payments across bills
  const _allPayments = useMemo(() => {
    if (!bills || bills.length === 0) return [];
    // We'll collect payments from individual bill queries as they load
    return [];
  }, [bills]);

  // Collect payments from bills for the Payments tab
  const { data: paymentsData = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "bills", "all-payments"],
    queryFn: async () => {
      if (!bills || bills.length === 0) return [];
      const paidBills = bills.filter((b) => b.status === "paid" || b.status === "partial");
      const paymentPromises = paidBills.map(async (bill) => {
        try {
          const detail: BillDetail = await apiRequest("GET", `/api/bills/${bill.id}`);
          return (detail.payments || []).map((p) => ({
            ...p,
            vendor_name: bill.vendor_name,
            bill_number: bill.bill_number,
          }));
        } catch {
          return [];
        }
      });
      const results = await Promise.all(paymentPromises);
      return results
        .flat()
        .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
    },
    enabled: !!companyId && bills.length > 0,
  });

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
      line_items: [
        {
          description: "",
          quantity: 1,
          unit_price: 0,
          vat_rate: 5,
          vat_supply_type: "standard_rated",
          account_id: "",
          cost_center_id: "",
        },
      ],
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
    })),
  });

  const createBillMutation = useMutation({
    mutationFn: (data: BillFormData) => {
      return apiRequest("POST", `/api/companies/${companyId}/bills`, buildBillPayload(data));
    },
    onSuccess: () => {
      invalidateBills();
      toast({ title: "Bill created", description: "Vendor bill has been created successfully." });
      setBillDialogOpen(false);
      resetBillForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create bill",
        description: error?.message || "Please try again.",
      });
    },
  });

  const updateBillMutation = useMutation({
    mutationFn: ({ id, data, reason }: { id: string; data: BillFormData; reason?: string }) => {
      const payload = buildBillPayload(data);
      // Approved bills are corrected by reversal + repost (POST /revise), never edited in place.
      if (reason) return apiRequest("POST", `/api/bills/${id}/revise`, { ...payload, reason });
      return apiRequest("PATCH", `/api/bills/${id}`, payload);
    },
    onSuccess: () => {
      invalidateBills();
      toast({ title: "Bill updated", description: "Vendor bill has been updated successfully." });
      setBillDialogOpen(false);
      setEditingBill(null);
      resetBillForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update bill",
        description: error?.message || "Please try again.",
      });
    },
  });

  const deleteBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/bills/${id}`),
    onSuccess: () => {
      invalidateBills();
      toast({ title: "Bill deleted", description: "Vendor bill has been deleted." });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to delete bill",
        description: error?.message || "Please try again.",
      });
    },
  });

  const approveBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/bills/${id}/approve`),
    onSuccess: () => {
      invalidateBills();
      toast({ title: "Bill approved", description: "The bill has been approved." });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to approve bill",
        description: error?.message || "Please try again.",
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
      toast({ variant: "destructive", title: error?.message || "Error" });
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
        title: "Payment recorded",
        description: `Payment recorded. Bill status: ${result.bill_status}. Remaining: ${formatCurrency(result.remaining, "AED")}`,
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
        title: "Failed to record payment",
        description: error?.message || "Please try again.",
      });
    },
  });

  // ===========================
  // Handlers
  // ===========================

  const resetBillForm = () => {
    billForm.reset({
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
      line_items: [
        {
          description: "",
          quantity: 1,
          unit_price: 0,
          vat_rate: 5,
          vat_supply_type: "standard_rated",
          account_id: "",
          cost_center_id: "",
        },
      ],
    });
    setEditingBill(null);
  };

  const handleEditBill = async (bill: VendorBill) => {
    try {
      const detail: BillDetail = await apiRequest("GET", `/api/bills/${bill.id}`);
      setEditingBill(detail);
      billForm.reset({
        vendor_name: detail.vendor_name,
        vendor_trn: detail.vendor_trn || "",
        bill_number: detail.bill_number || "",
        bill_date: new Date(detail.bill_date),
        due_date: detail.due_date ? new Date(detail.due_date) : undefined,
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
              }))
            : [
                {
                  description: "",
                  quantity: 1,
                  unit_price: 0,
                  vat_rate: 5,
                  vat_supply_type: "standard_rated",
                  account_id: "",
                  cost_center_id: "",
                },
              ],
      });
      setBillDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to load bill details.",
      });
    }
  };

  const handlePayBill = (bill: VendorBill) => {
    const remaining = Number(bill.total_amount) - Number(bill.amount_paid);
    setPayingBill(bill);
    paymentForm.reset({
      payment_date: new Date(),
      amount: Number(remaining.toFixed(2)),
      payment_method: "bank_transfer",
      payment_account_id: "",
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
  const cashAccounts = accounts.filter(
    (a: { type?: string; subType?: string; code?: string }) =>
      a.type === "asset" &&
      (a.subType === "cash" ||
        a.subType === "bank" ||
        ["1010", "1020", "1030"].includes(a.code ?? ""))
  );

  // Expense account options
  const expenseAccounts = accounts.filter((a: any) => a.type === "expense" || a.type === "asset");
  const costCenterList = Array.isArray(costCenters) ? costCenters : [];

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title={t.billPay}
        description={(t as any).billPaySubtitle ?? "Manage vendor bills, approvals, and payments"}
        actions={
          <Dialog
            open={billDialogOpen}
            onOpenChange={(open) => {
              setBillDialogOpen(open);
              if (!open) resetBillForm();
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4" />
                <T k="pages.newBill" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingBill ? t["screens.editBill"] : t["screens.newVendorBill"]}
                </DialogTitle>
                <DialogDescription>
                  {editingBill ? t["screens.billDialogEditDesc"] : t["screens.billDialogNewDesc"]}
                </DialogDescription>
              </DialogHeader>
              <Form {...billForm}>
                <form onSubmit={billForm.handleSubmit(onBillSubmit)} className="space-y-6">
                  {/* Vendor Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={billForm.control}
                      name="vendor_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <T k="pages.vendorName" />
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              dir="auto"
                              placeholder={t["screens.vendorCompanyName"]}
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
                              dir="ltr"
                              inputMode="numeric"
                              placeholder={t["screens.trnOptional"]}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Bill Info */}
                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={billForm.control}
                      name="bill_number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <T k="pages.billNumber" />
                          </FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g. BILL-001" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={billForm.control}
                      name="bill_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <T k="pages.billDate" />
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
                                  {field.value ? format(field.value, "PPP") : "Pick a date"}
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
                      control={billForm.control}
                      name="due_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <T k="pages.dueDate" />
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
                                  {field.value ? format(field.value, "PPP") : "Pick a date"}
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

                  {/* Category & Notes */}
                  <div className="grid grid-cols-2 gap-4">
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
                              <SelectItem value="rent">Rent</SelectItem>
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
                    <FormField
                      control={billForm.control}
                      name="currency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <T k="pages.currency" />
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
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {watchCurrency !== "AED" && (
                      <FormField
                        control={billForm.control}
                        name="exchange_rate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{c.exchangeRate}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                inputMode="decimal"
                                placeholder={c.exchangeRateHint}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
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
                                  {e.replace(/_/g, " ")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
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
                    {watchIsImport && (
                      <>
                        <FormField
                          control={billForm.control}
                          name="customs_declaration_no"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{c.customsNo}</FormLabel>
                              <FormControl>
                                <Input {...field} />
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
                                <Input {...field} inputMode="decimal" />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </>
                    )}
                  </div>

                  {/* Line Items */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">
                        <T k="pages.lineItems" />
                      </h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          appendLine({
                            description: "",
                            quantity: 1,
                            unit_price: 0,
                            vat_rate: 5,
                            vat_supply_type: "standard_rated",
                            account_id: "",
                            cost_center_id: "",
                          })
                        }
                      >
                        <Plus className="w-4 h-4" />
                        <T k="pages.addLine" />
                      </Button>
                    </div>

                    {lineFields.map((field, index) => (
                      <div
                        key={field.id}
                        className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md"
                      >
                        <div className="col-span-3">
                          <FormField
                            control={billForm.control}
                            name={`line_items.${index}.description`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input {...field} placeholder={t.description} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="col-span-1">
                          <FormField
                            control={billForm.control}
                            name={`line_items.${index}.quantity`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    step="0.01"
                                    placeholder={t["screens.qty"]}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="col-span-2">
                          <FormField
                            control={billForm.control}
                            name={`line_items.${index}.unit_price`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    step="0.01"
                                    placeholder={t["screens.unitPrice"]}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="col-span-1">
                          <FormField
                            control={billForm.control}
                            name={`line_items.${index}.vat_supply_type`}
                            render={({ field }) => (
                              <FormItem>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl>
                                    <SelectTrigger aria-label={c.supplyType}>
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
                        </div>
                        {costCenterList.length > 0 && (
                          <div className="col-span-1">
                            <FormField
                              control={billForm.control}
                              name={`line_items.${index}.cost_center_id`}
                              render={({ field }) => (
                                <FormItem>
                                  <Select
                                    value={field.value || NO_COST_CENTER}
                                    onValueChange={(v) =>
                                      field.onChange(v === NO_COST_CENTER ? "" : v)
                                    }
                                  >
                                    <FormControl>
                                      <SelectTrigger
                                        aria-label={t["purchases.costCenter"]}
                                        data-testid={`bill-line-cost-center-${index}`}
                                      >
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
                          </div>
                        )}
                        <div className={costCenterList.length > 0 ? "col-span-2" : "col-span-3"}>
                          <FormField
                            control={billForm.control}
                            name={`line_items.${index}.account_id`}
                            render={({ field }) => (
                              <FormItem>
                                <Select value={field.value || ""} onValueChange={field.onChange}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder={t["screens.account"]} />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {expenseAccounts.map((acc: any) => (
                                      <SelectItem key={acc.id} value={acc.id}>
                                        {acc.nameEn || acc.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="col-span-2 flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {formatCurrency(
                              (Number(watchLines[index]?.quantity) || 0) *
                                (Number(watchLines[index]?.unit_price) || 0),
                              "AED"
                            )}
                          </span>
                          {lineFields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLine(index)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Totals */}
                    <div className="flex justify-end">
                      <div className="w-64 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Subtotal:</span>
                          <span>{formatCurrency(subtotal, "AED")}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">VAT:</span>
                          <span>{formatCurrency(vatAmount, "AED")}</span>
                        </div>
                        <div className="flex justify-between font-semibold border-t pt-1">
                          <span>Total:</span>
                          <span>{formatCurrency(totalAmount, "AED")}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <FormField
                    control={billForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pages.notes" />
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder={t["screens.billNotesPlaceholder"]}
                            rows={2}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setBillDialogOpen(false);
                        resetBillForm();
                      }}
                    >
                      <T k="pages.cancel" />
                    </Button>
                    <Button
                      type="submit"
                      disabled={createBillMutation.isPending || updateBillMutation.isPending}
                    >
                      {createBillMutation.isPending || updateBillMutation.isPending
                        ? "Saving..."
                        : editingBill
                          ? t["screens.updateBill"]
                          : t["screens.createBill"]}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label={t.status}>
                <SelectValue placeholder={t.status} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <T k="pages.allStatuses" />
                </SelectItem>
                <SelectItem value="open">
                  <T k="pages.billsOpenUnpaid" />
                </SelectItem>
                <SelectItem value="pending">
                  <T k="pages.pending" />
                </SelectItem>
                <SelectItem value="approved">
                  <T k="pages.approved" />
                </SelectItem>
                <SelectItem value="partial">
                  <T k="pages.partial" />
                </SelectItem>
                <SelectItem value="paid">{c.paidStatus}</SelectItem>
                <SelectItem value="overdue">
                  <T k="pages.overdue" />
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DataTableCard
            status={billsLoading ? "loading" : filteredBills.length === 0 ? "empty" : "ready"}
            columnLabels={[t["pages.vendor"], t.date, t.amount, t.status]}
            testId="bills-table"
            empty={{
              icon: FileText,
              title: t["pages.noBillsFound"],
              description:
                bills.length === 0 ? t["screens.billsEmptyBody"] : t["screens.billsNoMatchBody"],
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
                      </TableCell>
                      <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {bill.bill_number || "—"}
                        </span>
                      </TableCell>
                      <TableCell
                        data-nowrap=""
                        data-cell="meta"
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
                          collapseOnMobile
                          menu={
                            <>
                              {(bill.status === "draft" || bill.status === "rejected") && (
                                <DropdownMenuItem
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
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
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
                            />
                          )}
                          {payable && (
                            <RowActionButton
                              label={t["pages.recordPayment"]}
                              icon={DollarSign}
                              onClick={() => handlePayBill(bill)}
                            />
                          )}
                          <RowActionButton
                            label={t.edit}
                            icon={Edit}
                            onClick={() => handleEditBill(bill)}
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
            status={paymentsData.length === 0 ? "empty" : "ready"}
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
                    <T k="pages.method" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.reference" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentsData.map((payment: any) => (
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
                      className="font-medium"
                      data-cell="amount"
                    />
                    <TableCell data-nowrap="" className="text-muted-foreground">
                      {paymentMethodLabel(payment.payment_method || "bank_transfer")}
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
        </TabsContent>

        {/* ================================== */}
        {/* SUMMARY TAB                        */}
        {/* ================================== */}
        <TabsContent value="summary" className="space-y-6 mt-0">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5 mobile-keep-cols">
            <StatCard
              label={t["pages.pending"]}
              icon={Clock}
              value={<Money amount={summary?.pending.total || 0} />}
              hint={formatMessage(t["screens.billsCount"], { count: summary?.pending.count || 0 })}
              loading={!summary}
            />
            <StatCard
              label={t["pages.approved"]}
              icon={CheckCircle}
              value={<Money amount={summary?.approved.total || 0} />}
              hint={formatMessage(t["screens.billsCount"], { count: summary?.approved.count || 0 })}
              loading={!summary}
            />
            <StatCard
              label={t["pages.partiallyPaid"]}
              icon={DollarSign}
              value={<Money amount={summary?.partial.total || 0} />}
              hint={formatMessage(t["screens.billsCount"], { count: summary?.partial.count || 0 })}
              loading={!summary}
            />
            <StatCard
              label={c.paidStatus}
              icon={CheckCircle}
              value={<Money amount={summary?.paid.total || 0} />}
              hint={formatMessage(t["screens.billsCount"], { count: summary?.paid.count || 0 })}
              loading={!summary}
            />
            <StatCard
              label={t["pages.overdue"]}
              icon={AlertTriangle}
              value={
                <Money
                  amount={summary?.overdue.total || 0}
                  className={(summary?.overdue.total || 0) > 0 ? "text-danger" : undefined}
                />
              }
              hint={formatMessage(t["screens.billsCount"], { count: summary?.overdue.count || 0 })}
              loading={!summary}
            />
          </div>

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
        <DialogContent className="max-w-md">
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
                  Total:{" "}
                  {formatCurrency(Number(payingBill.total_amount), payingBill.currency || "AED")}
                  {" | "}
                  Remaining:{" "}
                  {formatCurrency(
                    Number(payingBill.total_amount) - Number(payingBill.amount_paid),
                    payingBill.currency || "AED"
                  )}
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
                            {field.value ? format(field.value, "PPP") : "Pick a date"}
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
                              {a.code} - {locale === "ar" && a.nameAr ? a.nameAr : a.nameEn}
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
                  {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
