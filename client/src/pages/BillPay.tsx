import { useState, useEffect, useMemo } from "react";
import { accountName } from "@/lib/account-name";
import { pickerDate, parseYmd, todayYmd, formatCalendarDate } from "@/lib/calendar-date";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, parseISO, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { toDateOnly } from "@/components/PaymentDateField";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
  Plus,
  FileText,
  CalendarIcon,
  Trash2,
  Edit,
  MoreHorizontal,
  CheckCircle,
  DollarSign,
  Clock,
  AlertTriangle,
  CreditCard,
  BarChart3,
  Receipt,
} from "lucide-react";
import { VendorPicker } from "@/components/purchases/VendorPicker";
import { LineProjectFields } from "@/components/projects/LineProjectFields";
import { LineProductPicker, type PickerProduct } from "@/components/sales/LineProductPicker";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { ApprovalStatusBadge, approverRoleLabel } from "@/components/approvals/ApprovalStatusBadge";
import { useApprovalProgress } from "@/hooks/useApprovalProgress";
import { failureToast } from "@/lib/approval-feedback";
import { isForeignVendorCountry, isPendingApprovalBody, reverseChargePreview } from "@/lib/purchasing-hr";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { messages as approvalMessages } from "@/components/approvals/ApprovalStatusBadge.i18n";
import { PaymentAccountSelect } from "@/components/banking/PaymentAccountSelect";
import { FxRateField } from "@/components/banking/FxRateField";
import { parseRate as parseFxRate } from "@/components/banking/fx-preview";
import { messages as pageMessages } from "./BillPay.i18n";

// ===========================
// Types
// ===========================

interface VendorBill {
  id: string;
  company_id: string;
  vendor_id?: string | null;
  reverse_charge?: boolean;
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
  /** A draft sent back by an approver: why, and who. */
  rejection_reason?: string | null;
  rejected_by_name?: string | null;
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
  product_id?: string | null;
  project_id?: string | null;
  is_billable?: boolean;
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
  description: z.string().min(1, pageMessages.marker("descriptionIsRequired")),
  quantity: z.coerce.number().min(0.01, pageMessages.marker("quantityMustBePositive")),
  unit_price: z.coerce.number().min(0, pageMessages.marker("priceMustBeNonNegative")),
  vat_rate: z.coerce.number().default(5),
  account_id: z.string().optional(),
  // A stock item on the line: the bill receives stock on the bill date (the ledger entry debits Inventory).
  product_id: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  is_billable: z.boolean().optional(),
});

const billFormSchema = z.object({
  reverse_charge: z.boolean().optional(),
  vendor_id: z.string().optional().nullable(),
  vendor_name: z.string().min(1, pageMessages.marker("vendorNameIsRequired")),
  vendor_trn: z.string().optional(),
  bill_number: z.string().optional(),
  bill_date: z.date(),
  due_date: z.date().optional(),
  currency: z.string().default("AED"),
  category: z.string().optional(),
  notes: z.string().optional(),
  line_items: z.array(billLineSchema).min(1, pageMessages.marker("atLeastOneLineItemIs")),
});

const paymentFormSchema = z.object({
  payment_date: z.date(),
  amount: z.coerce.number().min(0.01, pageMessages.marker("amountMustBePositive")),
  payment_method: z.string().default("bank_transfer"),
  payment_account_id: z.string().min(1, pageMessages.marker("paymentAccountRequired")),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type BillFormData = z.infer<typeof billFormSchema>;
type PaymentFormData = z.infer<typeof paymentFormSchema>;

// ===========================
// Status helpers
// ===========================

function getStatusBadge(status: string, progress?: { completedSteps: number; requiredSteps: number }) {
  switch (status) {
    case "pending_approval":
      return <ApprovalStatusBadge status="pending_approval" completedSteps={progress?.completedSteps} requiredSteps={progress?.requiredSteps} />;
    case "pending":
      return (
        <Badge variant="outline" className="bg-muted text-foreground ">
          {pageMessages.t("pending")}
        </Badge>
      );
    case "draft":
      return (
        <Badge variant="outline" className="bg-destructive/10 text-destructive" data-testid="badge-bill-rejected">
          {pageMessages.t("rejectedDraft")}
        </Badge>
      );
    case "approved":
      return (
        <Badge variant="outline" className="bg-info-subtle text-info ">
          {pageMessages.t("approved")}
        </Badge>
      );
    case "partial":
      return (
        <Badge variant="outline" className="bg-warning-subtle text-warning ">
          {pageMessages.t("partial")}
        </Badge>
      );
    case "paid":
      return (
        <Badge variant="outline" className="bg-success-subtle text-success ">
          {pageMessages.t("paid")}
        </Badge>
      );
    case "overdue":
      return (
        <Badge variant="outline" className="bg-danger-subtle text-destructive ">
          {pageMessages.t("overdue")}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ===========================
// Main Component
// ===========================

const billPayTabs = ["bills", "payments", "summary"] as const;
type BillPayTab = (typeof billPayTabs)[number];

function initialBillPayTab(): BillPayTab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return billPayTabs.includes(tab as BillPayTab) ? (tab as BillPayTab) : "bills";
}

export default function BillPay() {
  const tr = pageMessages.useT();
  const salesTr = salesMessages.useT();
  const approvalTr = approvalMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId } = useDefaultCompany();

  const [activeTab, setActiveTab] = useState<BillPayTab>(initialBillPayTab);
  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<BillDetail | null>(null);
  const [foreignVendor, setForeignVendor] = useState(false);
  const [payingBill, setPayingBill] = useState<VendorBill | null>(null);
  // foreign-currency bills: the rate on the payment day (AED per unit), defaulted from the rates on file
  const [payRateText, setPayRateText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorSearch, setVendorSearch] = useState("");

  // ===========================
  // Queries
  // ===========================

  const { data: bills = [], isLoading: billsLoading } = useQuery<VendorBill[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });

  const approvalProgress = useApprovalProgress(companyId ?? undefined, "bill", bills.some((b) => b.status === "pending_approval"));

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
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
  const allPayments = useMemo(() => {
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
        .sort((a, b) => (pickerDate(b.payment_date) as Date).getTime() - (pickerDate(a.payment_date) as Date).getTime());
    },
    enabled: !!companyId && bills.length > 0,
  });

  // ===========================
  // Filtered bills
  // ===========================

  const filteredBills = useMemo(() => {
    let filtered = [...bills];
    if (statusFilter !== "all") {
      filtered = filtered.filter((b) => b.status === statusFilter);
    }
    if (vendorSearch.trim()) {
      const search = vendorSearch.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.vendor_name.toLowerCase().includes(search) ||
          (b.bill_number && b.bill_number.toLowerCase().includes(search))
      );
    }
    return filtered;
  }, [bills, statusFilter, vendorSearch]);

  // ===========================
  // Bill Form
  // ===========================

  const billForm = useForm<BillFormData>({
    resolver: zodResolver(billFormSchema),
    defaultValues: {
      vendor_id: null,
      reverse_charge: false,
      vendor_name: "",
      vendor_trn: "",
      bill_number: "",
      bill_date: parseYmd(todayYmd()),
      due_date: undefined,
      currency: "AED",
      category: "",
      notes: "",
      line_items: [{ description: "", quantity: 1, unit_price: 0, vat_rate: 5, account_id: "", project_id: null, is_billable: false }],
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
      payment_date: parseYmd(todayYmd()),
      amount: 0,
      payment_method: "bank_transfer",
      payment_account_id: "",
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

  const createBillMutation = useMutation({
    mutationFn: (data: BillFormData) => {
      const payload = {
        ...data,
        bill_date: toDateOnly(data.bill_date),
        due_date: data.due_date ? toDateOnly(data.due_date) : null,
        line_items: data.line_items.map((l) => ({
          ...l,
          account_id: l.account_id || null,
          product_id: l.product_id || null,
          project_id: l.project_id || null,
          is_billable: !!l.project_id && !!l.is_billable,
        })),
      };
      return apiRequest("POST", `/api/companies/${companyId}/bills`, payload);
    },
    onSuccess: () => {
      invalidateBills();
      toast({ title: tr("billCreated"), description: tr("vendorBillHasBeenCreatedSuccessfully") });
      setBillDialogOpen(false);
      resetBillForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateBill"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const updateBillMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: BillFormData }) => {
      const payload = {
        ...data,
        bill_date: toDateOnly(data.bill_date),
        due_date: data.due_date ? toDateOnly(data.due_date) : null,
        line_items: data.line_items.map((l) => ({
          ...l,
          account_id: l.account_id || null,
          product_id: l.product_id || null,
          project_id: l.project_id || null,
          is_billable: !!l.project_id && !!l.is_billable,
        })),
      };
      return apiRequest("PATCH", `/api/bills/${id}`, payload);
    },
    onSuccess: () => {
      invalidateBills();
      toast({ title: tr("billUpdated"), description: tr("vendorBillHasBeenUpdatedSuccessfully") });
      setBillDialogOpen(false);
      setEditingBill(null);
      resetBillForm();
    },
    onError: (error: any) => {
      toast(failureToast(error, tr("failedToUpdateBill")));
    },
  });

  const deleteBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/bills/${id}`),
    onSuccess: () => {
      invalidateBills();
      toast({ title: tr("billDeleted"), description: tr("vendorBillHasBeenDeleted") });
    },
    onError: (error: any) => {
      toast(failureToast(error, tr("failedToDeleteBill")));
    },
  });

  const resubmitBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/approvals/bill/${id}/resubmit`, {}),
    onSuccess: () => {
      invalidateBills();
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "approvals"] });
      toast({ title: tr("billResubmitted"), description: tr("billResubmittedBody") });
    },
    onError: (error: any) => {
      toast(failureToast(error, tr("billResubmitFailed")));
    },
  });

  const approveBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/bills/${id}/approve`),
    onSuccess: (body: unknown) => {
      invalidateBills();
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "approvals"] });
      if (isPendingApprovalBody(body)) {
        toast({
          title: approvalMessages.t("pendingApprovalSteps", { done: body.approval.completedSteps, total: body.approval.requiredSteps }),
          description: body.approval.nextRole ? approvalMessages.t("nextRole", { role: approverRoleLabel(body.approval.nextRole) }) : undefined,
        });
        return;
      }
      toast({ title: tr("billApproved"), description: tr("theBillHasBeenApproved") });
    },
    onError: (error: any) => {
      toast(failureToast(error, tr("failedToApproveBill")));
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ billId, data }: { billId: string; data: PaymentFormData }) => {
      const payload = {
        ...data,
        payment_date: toDateOnly(data.payment_date),
        ...(parseFxRate(payRateText) && (payingBill?.currency || "AED") !== "AED" ? { exchange_rate: parseFxRate(payRateText) } : {}),
      };
      return apiRequest("POST", `/api/bills/${billId}/payments`, payload);
    },
    onSuccess: (result: any) => {
      invalidateBills();
      toast({
        title: tr("paymentRecorded"),
        description: tr("paymentRecordedBillStatusRemaining", {
          bill_status: result.bill_status,
          formatCurrency: formatCurrency(result.remaining, "AED"),
        }),
      });
      setPaymentDialogOpen(false);
      setPayingBill(null);
      paymentForm.reset({
        payment_date: parseYmd(todayYmd()),
        amount: 0,
        payment_method: "bank_transfer",
        payment_account_id: "",
        reference: "",
        notes: "",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToRecordPayment"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  // ===========================
  // Handlers
  // ===========================

  const resetBillForm = () => {
    billForm.reset({
      vendor_id: null,
      reverse_charge: false,
      vendor_name: "",
      vendor_trn: "",
      bill_number: "",
      bill_date: parseYmd(todayYmd()),
      due_date: undefined,
      currency: "AED",
      category: "",
      notes: "",
      line_items: [{ description: "", quantity: 1, unit_price: 0, vat_rate: 5, account_id: "", project_id: null, is_billable: false }],
    });
    setEditingBill(null);
    setForeignVendor(false);
  };

  const handleEditBill = async (bill: VendorBill) => {
    try {
      const detail: BillDetail = await apiRequest("GET", `/api/bills/${bill.id}`);
      setEditingBill(detail);
      billForm.reset({
        vendor_id: detail.vendor_id ?? null,
        reverse_charge: !!detail.reverse_charge,
        vendor_name: detail.vendor_name,
        vendor_trn: detail.vendor_trn || "",
        bill_number: detail.bill_number || "",
        bill_date: (pickerDate(detail.bill_date) as Date),
        due_date: detail.due_date ? (pickerDate(detail.due_date) as Date) : undefined,
        currency: detail.currency || "AED",
        category: detail.category || "",
        notes: detail.notes || "",
        line_items:
          detail.line_items.length > 0
            ? detail.line_items.map((l) => ({
                description: l.description,
                quantity: Number(l.quantity),
                unit_price: Number(l.unit_price),
                vat_rate: Number(l.vat_rate),
                account_id: l.account_id || "",
                product_id: l.product_id ?? null,
                project_id: l.project_id ?? null,
                is_billable: !!l.is_billable,
              }))
            : [{ description: "", quantity: 1, unit_price: 0, vat_rate: 5, account_id: "", project_id: null, is_billable: false }],
      });
      setBillDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("error"),
        description: error?.message || tr("failedToLoadBillDetails"),
      });
    }
  };

  const handlePayBill = (bill: VendorBill) => {
    const remaining = Number(bill.total_amount) - Number(bill.amount_paid);
    setPayingBill(bill);
    setPayRateText("");
    paymentForm.reset({
      payment_date: parseYmd(todayYmd()),
      amount: Number(remaining.toFixed(2)),
      payment_method: "bank_transfer",
      payment_account_id: "",
      reference: "",
      notes: "",
    });
    setPaymentDialogOpen(true);
  };

  const onBillSubmit = (data: BillFormData) => {
    if (editingBill) {
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
    return sum + lineAmount * ((Number(line.vat_rate) || 0) / 100);
  }, 0);
  const reverseCharge = !!billForm.watch("reverse_charge");
  const rcPreview = reverseChargePreview(watchLines);
  // Reverse charge: the vendor charges no VAT, so the payable is the net amount.
  const totalAmount = reverseCharge ? subtotal : subtotal + vatAmount;

  // Expense account options
  // Stock items (tracked products) can be bought on a bill line: the bill adds them to stock.
  const { data: allProducts = [] } = useQuery<Array<PickerProduct & { costPrice?: number | string | null }>>({
    queryKey: ["/api/companies", companyId, "products"],
    enabled: !!companyId,
  });
  const stockItems = allProducts.filter((p) => p.trackInventory && p.isActive !== false);

  const expenseAccounts = accounts.filter((a: any) => a.type === "expense" || a.type === "asset");

  // ===========================
  // Render
  // ===========================

  if (!companyId) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold">{tr("billPay")}</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{tr("pleaseCreateACompanyFirstTo")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("purchases")}
        title={t.billPay}
        description={(t as any).billPaySubtitle ?? tr("manageVendorBillsApprovalsAndPayments")}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BillPayTab)}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="bills">
            <FileText className="w-4 h-4 me-2" />
            {tr("bills")}
          </TabsTrigger>
          <TabsTrigger value="payments">
            <CreditCard className="w-4 h-4 me-2" />
            {tr("payments")}
          </TabsTrigger>
          <TabsTrigger value="summary">
            <BarChart3 className="w-4 h-4 me-2" />
            {tr("summary")}
          </TabsTrigger>
        </TabsList>

        {/* ================================== */}
        {/* BILLS TAB                          */}
        {/* ================================== */}
        <TabsContent value="bills" className="space-y-6 mt-0">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                  <Input
                    placeholder={tr("searchVendorOrBill")}
                    value={vendorSearch}
                    onChange={(e) => setVendorSearch(e.target.value)}
                    className="w-64"
                  />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder={tr("status")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("allStatuses")}</SelectItem>
                      <SelectItem value="pending">{tr("pending")}</SelectItem>
                      <SelectItem value="pending_approval">{approvalTr("pendingApproval")}</SelectItem>
                      <SelectItem value="approved">{tr("approved")}</SelectItem>
                      <SelectItem value="partial">{tr("partial")}</SelectItem>
                      <SelectItem value="paid">{tr("paid")}</SelectItem>
                      <SelectItem value="overdue">{tr("overdue")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Dialog
                  open={billDialogOpen}
                  onOpenChange={(open) => {
                    setBillDialogOpen(open);
                    if (!open) resetBillForm();
                  }}
                >
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 me-2" />
                      {tr("newBill")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>
                        {editingBill ? tr("editBill") : tr("newVendorBill")}
                      </DialogTitle>
                      <DialogDescription>
                        {editingBill
                          ? tr("updateVendorBillDetails")
                          : tr("createANewVendorBillWith")}
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
                                <FormLabel>{tr("vendorName")}</FormLabel>
                                <FormControl>
                                  <VendorPicker
                                    companyId={companyId ?? undefined}
                                    vendorId={billForm.watch("vendor_id")}
                                    fallbackName={field.value}
                                    onSelect={(vendor) => {
                                      billForm.setValue("vendor_id", vendor.id, { shouldDirty: true });
                                      billForm.setValue("vendor_name", vendor.name, { shouldDirty: true, shouldValidate: true });
                                      if (vendor.trnNumber) billForm.setValue("vendor_trn", vendor.trnNumber, { shouldDirty: true });
                                      // A vendor outside the UAE: imported services are normally reverse charge. New bills only.
                                      if (!editingBill) {
                                        const foreign = isForeignVendorCountry(vendor.country);
                                        setForeignVendor(foreign);
                                        billForm.setValue("reverse_charge", foreign, { shouldDirty: true });
                                      }
                                    }}
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
                                <FormLabel>{tr("vendorTrn")}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder={tr("taxRegistrationNumberOptional")}
                                    className="font-mono"
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
                                <FormLabel>{tr("billNumber")}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="e.g. BILL-001"
                                    className="font-mono"
                                  />
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
                                <FormLabel>{tr("billDate")}</FormLabel>
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
                                        <CalendarIcon className="me-2 h-4 w-4" />
                                        {field.value ? formatCalendarDate(field.value, locale) : tr("pickADate")}
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
                                <FormLabel>{tr("dueDate")}</FormLabel>
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
                                        <CalendarIcon className="me-2 h-4 w-4" />
                                        {field.value ? formatCalendarDate(field.value, locale) : tr("pickADate")}
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
                                <FormLabel>{tr("category")}</FormLabel>
                                <Select value={field.value || ""} onValueChange={field.onChange}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder={tr("selectCategory")} />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="utilities">{tr("utilities")}</SelectItem>
                                    <SelectItem value="rent">{tr("rent")}</SelectItem>
                                    <SelectItem value="supplies">{tr("supplies")}</SelectItem>
                                    <SelectItem value="services">
                                      {tr("professionalServices")}
                                    </SelectItem>
                                    <SelectItem value="equipment">{tr("equipment")}</SelectItem>
                                    <SelectItem value="travel">{tr("travel")}</SelectItem>
                                    <SelectItem value="insurance">{tr("insurance")}</SelectItem>
                                    <SelectItem value="maintenance">{tr("maintenance")}</SelectItem>
                                    <SelectItem value="other">{tr("other")}</SelectItem>
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
                                <FormLabel>{tr("currency")}</FormLabel>
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

                        {/* Reverse charge (imported services, Article 48) */}
                        <div className="rounded-md border p-3 space-y-2" data-testid="section-reverse-charge">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <Label htmlFor="bill-reverse-charge" className="font-medium">
                                {tr("reverseCharge")}
                              </Label>
                              <p className="text-xs text-muted-foreground">{tr("reverseChargeHelp")}</p>
                              {foreignVendor && !editingBill && (
                                <p className="text-xs text-info" data-testid="text-reverse-charge-hint">
                                  {tr("reverseChargeForeignHint")}
                                </p>
                              )}
                              {editingBill && <p className="text-xs text-muted-foreground">{tr("reverseChargeLocked")}</p>}
                            </div>
                            <Switch
                              id="bill-reverse-charge"
                              checked={reverseCharge}
                              disabled={!!editingBill}
                              onCheckedChange={(checked) => billForm.setValue("reverse_charge", checked, { shouldDirty: true })}
                              data-testid="switch-reverse-charge"
                            />
                          </div>
                          {reverseCharge && (
                            <div className="rounded-md bg-muted/40 p-2 text-sm space-y-1" data-testid="reverse-charge-preview">
                              <div className="flex justify-between">
                                <span>{tr("reverseChargeOutput")}</span>
                                <span className="tabular-nums" data-testid="text-rc-output">{formatCurrency(rcPreview.outputVatBox3, "AED")}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>{tr("reverseChargeInput")}</span>
                                <span className="tabular-nums" data-testid="text-rc-input">{formatCurrency(rcPreview.inputVatBox10, "AED")}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">{tr("reverseChargeNet", { payable: formatCurrency(rcPreview.payable, "AED") })}</p>
                            </div>
                          )}
                        </div>

                        {/* Line Items */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium">{tr("lineItems")}</h3>
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
                                  account_id: "",
                                })
                              }
                            >
                              <Plus className="w-4 h-4 me-2" />
                              {tr("addLine")}
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
                                        <Input {...field} placeholder={tr("description")} />
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
                                          placeholder={tr("qty")}
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
                                          placeholder={tr("unitPrice")}
                                        />
                                      </FormControl>
                                    </FormItem>
                                  )}
                                />
                              </div>
                              <div className="col-span-1">
                                <FormField
                                  control={billForm.control}
                                  name={`line_items.${index}.vat_rate`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="number"
                                          step="0.01"
                                          placeholder="VAT%"
                                        />
                                      </FormControl>
                                    </FormItem>
                                  )}
                                />
                              </div>
                              <div className="col-span-3">
                                <FormField
                                  control={billForm.control}
                                  name={`line_items.${index}.account_id`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <Select
                                        value={field.value || ""}
                                        onValueChange={field.onChange}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder={tr("account")} />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          {expenseAccounts.map((acc: any) => (
                                            <SelectItem key={acc.id} value={acc.id}>
                                              {accountName(acc, locale)}
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
                              {stockItems.length > 0 && (
                                <div className="col-span-12" data-testid={`bill-line-stock-${index}`}>
                                  <LineProductPicker
                                    products={stockItems}
                                    value={watchLines[index]?.product_id}
                                    testId={`select-bill-line-product-${index}`}
                                    onPick={(picked) => {
                                      billForm.setValue(`line_items.${index}.product_id`, picked?.id ?? null, { shouldDirty: true });
                                      if (!picked) return;
                                      billForm.setValue(`line_items.${index}.description`, locale === "ar" && picked.nameAr ? picked.nameAr : picked.name, { shouldDirty: true });
                                      if (Number(picked.costPrice) > 0) billForm.setValue(`line_items.${index}.unit_price`, Number(picked.costPrice), { shouldDirty: true });
                                      billForm.setValue(`line_items.${index}.vat_rate`, Math.round(Number(picked.vatRate ?? 0.05) * 100), { shouldDirty: true });
                                    }}
                                  />
                                  {watchLines[index]?.product_id && <p className="mt-1 text-xs text-muted-foreground">{salesTr("billLineStockHint")}</p>}
                                </div>
                              )}
                              <div className="col-span-12">
                                <LineProjectFields
                                  companyId={companyId ?? undefined}
                                  projectId={watchLines[index]?.project_id}
                                  isBillable={watchLines[index]?.is_billable}
                                  testIdSuffix={`-${index}`}
                                  onChange={({ projectId, isBillable }) => {
                                    billForm.setValue(`line_items.${index}.project_id`, projectId, { shouldDirty: true });
                                    billForm.setValue(`line_items.${index}.is_billable`, isBillable, { shouldDirty: true });
                                  }}
                                />
                              </div>
                            </div>
                          ))}

                          {/* Totals */}
                          <div className="flex justify-end">
                            <div className="w-64 space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{tr("subtotal")}</span>
                                <span>{formatCurrency(subtotal, "AED")}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{reverseCharge ? tr("vatSelfAssessed") : tr("vat")}</span>
                                <span>{formatCurrency(vatAmount, "AED")}</span>
                              </div>
                              <div className="flex justify-between font-semibold border-t pt-1">
                                <span>{tr("total")}</span>
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
                              <FormLabel>{tr("notes")}</FormLabel>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  placeholder={tr("optionalNotesAboutThisBill")}
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
                            {tr("cancel")}
                          </Button>
                          <Button
                            type="submit"
                            disabled={createBillMutation.isPending || updateBillMutation.isPending}
                          >
                            {createBillMutation.isPending || updateBillMutation.isPending
                              ? tr("saving")
                              : editingBill
                                ? tr("updateBill")
                                : tr("createBill")}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          {/* Bills Table */}
          <Card>
            <CardContent className="pt-6">
              {billsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filteredBills.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-1">{tr("noBillsFound")}</h3>
                  <p className="text-muted-foreground">
                    {bills.length === 0
                      ? tr("createYourFirstVendorBillTo")
                      : tr("noBillsMatchYourCurrentFilters")}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("vendor")}</TableHead>
                        <TableHead>{tr("bill")}</TableHead>
                        <TableHead>{tr("date")}</TableHead>
                        <TableHead>{tr("dueDate")}</TableHead>
                        <TableHead className="text-end">{tr("amount")}</TableHead>
                        <TableHead className="text-end">{tr("paid")}</TableHead>
                        <TableHead>{tr("status")}</TableHead>
                        <TableHead className="text-end">{tr("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBills.map((bill) => {
                        const remaining = Number(bill.total_amount) - Number(bill.amount_paid);
                        return (
                          <TableRow key={bill.id}>
                            <TableCell className="font-medium">{bill.vendor_name}</TableCell>
                            <TableCell className="font-mono text-sm">
                              {bill.bill_number || "-"}
                            </TableCell>
                            <TableCell>{formatDate(bill.bill_date)}</TableCell>
                            <TableCell>{bill.due_date ? formatDate(bill.due_date) : "-"}</TableCell>
                            <TableCell className="text-end">
                              {formatCurrency(Number(bill.total_amount), bill.currency || "AED")}
                            </TableCell>
                            <TableCell className="text-end">
                              {formatCurrency(Number(bill.amount_paid), bill.currency || "AED")}
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(bill.status, approvalProgress.get(bill.id))}
                              {bill.status === "draft" && bill.rejection_reason && (
                                <p className="mt-1 max-w-xs text-xs text-destructive break-words" data-testid={`text-bill-rejection-${bill.id}`}>
                                  {tr("rejectionNote", { by: bill.rejected_by_name || "-", reason: bill.rejection_reason })}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" data-testid={`button-bill-actions-${bill.id}`}>
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEditBill(bill)}>
                                    <Edit className="w-4 h-4 me-2" />
                                    {tr("edit")}
                                  </DropdownMenuItem>
                                  {(bill.status === "pending" || bill.status === "pending_approval") && (
                                    <DropdownMenuItem
                                      onClick={() => approveBillMutation.mutate(bill.id)}
                                    >
                                      <CheckCircle className="w-4 h-4 me-2" />
                                      {tr("approve")}
                                    </DropdownMenuItem>
                                  )}
                                  {bill.status === "draft" && (
                                    <DropdownMenuItem onClick={() => resubmitBillMutation.mutate(bill.id)} data-testid={`button-resubmit-bill-${bill.id}`}>
                                      <CheckCircle className="w-4 h-4 me-2" />
                                      {tr("resubmit")}
                                    </DropdownMenuItem>
                                  )}
                                  {!["paid", "pending", "pending_approval", "draft"].includes(bill.status) && (
                                    <DropdownMenuItem onClick={() => handlePayBill(bill)} data-testid={`menu-pay-bill-${bill.id}`}>
                                      <DollarSign className="w-4 h-4 me-2" />
                                      {tr("recordPayment")}
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => {
                                      if (confirm(tr("areYouSureYouWantTo"))) {
                                        deleteBillMutation.mutate(bill.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4 me-2" />
                                    {tr("delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
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
        </TabsContent>

        {/* ================================== */}
        {/* PAYMENTS TAB                       */}
        {/* ================================== */}
        <TabsContent value="payments" className="space-y-6 mt-0">
          <Card>
            <CardHeader>
              <CardTitle>{tr("paymentHistory")}</CardTitle>
              <CardDescription>{tr("allPaymentsRecordedAgainstVendorBills")}</CardDescription>
            </CardHeader>
            <CardContent>
              {paymentsData.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-1">{tr("noPaymentsYet")}</h3>
                  <p className="text-muted-foreground">{tr("paymentsWillAppearHereWhenYou")}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("date")}</TableHead>
                      <TableHead>{tr("vendor")}</TableHead>
                      <TableHead>{tr("bill")}</TableHead>
                      <TableHead className="text-end">{tr("amount")}</TableHead>
                      <TableHead>{tr("method")}</TableHead>
                      <TableHead>{tr("reference")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentsData.map((payment: any) => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDate(payment.payment_date)}</TableCell>
                        <TableCell className="font-medium">{payment.vendor_name}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {payment.bill_number || "-"}
                        </TableCell>
                        <TableCell className="text-end font-medium">
                          {formatCurrency(Number(payment.amount), "AED")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {(payment.payment_method || "bank_transfer").replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {payment.reference || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================== */}
        {/* SUMMARY TAB                        */}
        {/* ================================== */}
        <TabsContent value="summary" className="space-y-6 mt-0">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{tr("pending")}</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(summary?.pending.total || 0, "AED")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary?.pending.count || 0} {tr("bills2")}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-muted-foreground/70" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{tr("approved")}</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(summary?.approved.total || 0, "AED")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary?.approved.count || 0} {tr("bills2")}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-info" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{tr("partiallyPaid")}</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(summary?.partial.total || 0, "AED")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary?.partial.count || 0} {tr("bills2")}
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 text-warning" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{tr("paid")}</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(summary?.paid.total || 0, "AED")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary?.paid.count || 0} {tr("bills2")}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-success" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{tr("overdue")}</p>
                    <p className="text-2xl font-bold text-destructive">
                      {formatCurrency(summary?.overdue.total || 0, "AED")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary?.overdue.count || 0} {tr("bills2")}
                    </p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-destructive" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Aging Report */}
          <Card>
            <CardHeader>
              <CardTitle>{tr("agingReport")}</CardTitle>
              <CardDescription>{tr("outstandingPayablesByAgeOfDue")}</CardDescription>
            </CardHeader>
            <CardContent>
              {aging ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("period")}</TableHead>
                      <TableHead className="text-end">{tr("amount")}</TableHead>
                      <TableHead className="text-end">{tr("bills")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">{tr("currentNotYetDue")}</TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(aging.current.amount, "AED")}
                      </TableCell>
                      <TableCell className="text-end">{aging.current.count}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">{tr("n130Days")}</TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(aging.days_1_30.amount, "AED")}
                      </TableCell>
                      <TableCell className="text-end">{aging.days_1_30.count}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">{tr("n3160Days")}</TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(aging.days_31_60.amount, "AED")}
                      </TableCell>
                      <TableCell className="text-end">{aging.days_31_60.count}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">{tr("n6190Days")}</TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(aging.days_61_90.amount, "AED")}
                      </TableCell>
                      <TableCell className="text-end">{aging.days_61_90.count}</TableCell>
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell className="text-destructive">{tr("n90Days")}</TableCell>
                      <TableCell className="text-end text-destructive">
                        {formatCurrency(aging.days_90_plus.amount, "AED")}
                      </TableCell>
                      <TableCell className="text-end text-destructive">
                        {aging.days_90_plus.count}
                      </TableCell>
                    </TableRow>
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>{tr("totalOutstanding")}</TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(
                          aging.current.amount +
                            aging.days_1_30.amount +
                            aging.days_31_60.amount +
                            aging.days_61_90.amount +
                            aging.days_90_plus.amount,
                          "AED"
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        {aging.current.count +
                          aging.days_1_30.count +
                          aging.days_31_60.count +
                          aging.days_61_90.count +
                          aging.days_90_plus.count}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
            <DialogTitle>{tr("recordPayment")}</DialogTitle>
            <DialogDescription>
              {payingBill && (
                <>
                  {tr("billFrom")} <strong>{payingBill.vendor_name}</strong>
                  {payingBill.bill_number && <> ({payingBill.bill_number})</>}
                  <br />
                  {tr("total2", {
                    formatCurrency: formatCurrency(
                      Number(payingBill.total_amount),
                      payingBill.currency || "AED"
                    ),
                  })}
                  {" | "}
                  {tr("remaining")}
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
                    <FormLabel>{tr("amount")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.01"
                        placeholder={tr("paymentAmount")}
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
                    <FormLabel>{tr("paymentDate")}</FormLabel>
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
                            <CalendarIcon className="me-2 h-4 w-4" />
                            {field.value ? formatCalendarDate(field.value, locale) : tr("pickADate")}
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
                    <FormLabel>{tr("paymentMethod")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="bank_transfer">{tr("bankTransfer")}</SelectItem>
                        <SelectItem value="cash">{tr("cash")}</SelectItem>
                        <SelectItem value="cheque">{tr("cheque")}</SelectItem>
                        <SelectItem value="card">{tr("card")}</SelectItem>
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
                    <PaymentAccountSelect companyId={companyId ?? ""} value={field.value} onChange={field.onChange} testId="select-bill-payment-account" />
                    <FormMessage />
                  </FormItem>
                )}
              />
              {payingBill && (
                <FxRateField
                  companyId={companyId ?? ""}
                  currency={payingBill.currency || "AED"}
                  date={toDateOnly(paymentForm.watch("payment_date"))}
                  amount={Number(paymentForm.watch("amount")) || 0}
                  bookRate={Number((payingBill as any).exchange_rate) || 1}
                  kind="payment"
                  value={payRateText}
                  onChange={setPayRateText}
                  testId="bill-payment-fx"
                />
              )}
              <FormField
                control={paymentForm.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("reference")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={tr("paymentReferenceOptional")} />
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
                    <FormLabel>{tr("notes")}</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder={tr("optionalNotes")} rows={2} />
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
                  {tr("cancel")}
                </Button>
                <Button type="submit" disabled={recordPaymentMutation.isPending || ((payingBill?.currency || "AED") !== "AED" && !parseFxRate(payRateText))}>
                  {recordPaymentMutation.isPending ? tr("recording") : tr("recordPayment")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
