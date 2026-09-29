import { useState, useEffect, useMemo } from "react";
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
import { messages as pageMessages } from "./BillPay.i18n";

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
});

const billFormSchema = z.object({
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
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type BillFormData = z.infer<typeof billFormSchema>;
type PaymentFormData = z.infer<typeof paymentFormSchema>;

// ===========================
// Status helpers
// ===========================

function getStatusBadge(status: string) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="bg-muted text-foreground ">
          {pageMessages.t("pending")}
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

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId } = useDefaultCompany();

  const [activeTab, setActiveTab] = useState<BillPayTab>(initialBillPayTab);
  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<BillDetail | null>(null);
  const [payingBill, setPayingBill] = useState<VendorBill | null>(null);
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
        .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
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
      vendor_name: "",
      vendor_trn: "",
      bill_number: "",
      bill_date: new Date(),
      due_date: undefined,
      currency: "AED",
      category: "",
      notes: "",
      line_items: [{ description: "", quantity: 1, unit_price: 0, vat_rate: 5, account_id: "" }],
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
      toast({
        variant: "destructive",
        title: tr("failedToUpdateBill"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const deleteBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/bills/${id}`),
    onSuccess: () => {
      invalidateBills();
      toast({ title: tr("billDeleted"), description: tr("vendorBillHasBeenDeleted") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeleteBill"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const approveBillMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/bills/${id}/approve`),
    onSuccess: () => {
      invalidateBills();
      toast({ title: tr("billApproved"), description: tr("theBillHasBeenApproved") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToApproveBill"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: ({ billId, data }: { billId: string; data: PaymentFormData }) => {
      const payload = {
        ...data,
        payment_date: toDateOnly(data.payment_date),
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
      vendor_name: "",
      vendor_trn: "",
      bill_number: "",
      bill_date: new Date(),
      due_date: undefined,
      currency: "AED",
      category: "",
      notes: "",
      line_items: [{ description: "", quantity: 1, unit_price: 0, vat_rate: 5, account_id: "" }],
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
              }))
            : [{ description: "", quantity: 1, unit_price: 0, vat_rate: 5, account_id: "" }],
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
    paymentForm.reset({
      payment_date: new Date(),
      amount: Number(remaining.toFixed(2)),
      payment_method: "bank_transfer",
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
  const totalAmount = subtotal + vatAmount;

  // Expense account options
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
                                  <Input {...field} placeholder={tr("vendorCompanyName")} />
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
                                        {field.value ? format(field.value, "PPP") : tr("pickADate")}
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
                                        {field.value ? format(field.value, "PPP") : tr("pickADate")}
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
                                <span className="text-muted-foreground">{tr("subtotal")}</span>
                                <span>{formatCurrency(subtotal, "AED")}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{tr("vat")}</span>
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
                            <TableCell>{getStatusBadge(bill.status)}</TableCell>
                            <TableCell className="text-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEditBill(bill)}>
                                    <Edit className="w-4 h-4 me-2" />
                                    {tr("edit")}
                                  </DropdownMenuItem>
                                  {bill.status === "pending" && (
                                    <DropdownMenuItem
                                      onClick={() => approveBillMutation.mutate(bill.id)}
                                    >
                                      <CheckCircle className="w-4 h-4 me-2" />
                                      {tr("approve")}
                                    </DropdownMenuItem>
                                  )}
                                  {bill.status !== "paid" && (
                                    <DropdownMenuItem onClick={() => handlePayBill(bill)}>
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
                            {field.value ? format(field.value, "PPP") : tr("pickADate")}
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
                <Button type="submit" disabled={recordPaymentMutation.isPending}>
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
