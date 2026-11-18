import { T } from "@/components/layout/T";
import { EditorShell } from "@/components/ui/editor-shell";
import {
  FormErrorSummary,
  FormGrid,
  FormSection,
  FormTotals,
  LineItem,
  LineItemList,
  lineLabelClass,
} from "@/components/ui/form-layout";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import {
  Receipt,
  Plus,
  Edit,
  Trash2,
  Send,
  CheckCircle,
  XCircle,
  DollarSign,
  Clock,
  FileText,
  Eye,
  CreditCard,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton, StatCardSkeleton } from "@/components/ui/loading-skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTableCard } from "@/components/ui/data-table";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatCurrency, formatDate } from "@/lib/format";
import { postablePaymentAccounts } from "@/lib/payment-accounts";
import { accountDisplayName } from "@/lib/account-name";

// ─── Types ────────────────────────────────────────────────

interface ExpenseClaimItem {
  id?: string;
  claim_id?: string;
  expense_date: string;
  category: string;
  description: string;
  amount: number;
  vat_amount: number;
  receipt_url?: string | null;
  supplier_trn?: string | null;
  has_tax_invoice?: boolean;
  merchant_name?: string | null;
  created_at?: string;
}

interface ExpenseClaim {
  id: string;
  company_id: string;
  submitted_by: string;
  claim_number: string;
  title: string;
  description?: string | null;
  total_amount: number;
  currency: string;
  status: string;
  submitted_at?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  paid_at?: string | null;
  payment_reference?: string | null;
  /** S2 (R04-20): reimbursed on the employee's next payroll run. */
  reimburse_via_payroll?: boolean;
  payroll_run_id?: string | null;
  employee_id?: string | null;
  created_at: string;
  items?: ExpenseClaimItem[];
}

interface ClaimSummary {
  all: Record<string, { count: number; total: number }>;
  thisMonth: Record<string, { count: number; total: number }>;
}

// ─── Constants ────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  "Travel",
  "Meals",
  "Transport",
  "Accommodation",
  "Office Supplies",
  "Client Entertainment",
  "Telephone",
  "Internet",
  "Other",
] as const;

// ─── Schemas ──────────────────────────────────────────────

const expenseItemSchema = z.object({
  expense_date: z.string().min(1, "forms.errors.dateRequired"),
  category: z.string().min(1, "forms.errors.categoryRequired"),
  description: z.string().min(1, "forms.errors.descriptionRequired"),
  amount: z.coerce.number().min(0.01, "forms.errors.amountGreaterThanZero"),
  vat_amount: z.coerce.number().min(0, "forms.errors.vatAmountNonNegative"),
  merchant_name: z.string().optional().nullable(),
  receipt_url: z.string().optional().nullable(),
  supplier_trn: z.string().optional().nullable(),
  has_tax_invoice: z.boolean().default(true),
});

const claimFormSchema = z.object({
  title: z.string().min(1, "forms.errors.titleRequired"),
  description: z.string().optional().nullable(),
  items: z.array(expenseItemSchema).min(1, "forms.errors.expenseItemRequired"),
});

type ClaimFormData = z.infer<typeof claimFormSchema>;

const reviewFormSchema = z.object({
  // Notes are optional on approve (the API treats them as optional) and
  // required on reject; handleReviewSubmit enforces the reject case.
  review_notes: z.string().optional(),
});

type ReviewFormData = z.infer<typeof reviewFormSchema>;

const paymentFormSchema = z.object({
  payment_reference: z.string().optional().nullable(),
  payment_account_id: z.string().optional().nullable(),
});

type PaymentFormData = z.infer<typeof paymentFormSchema>;

// ─── W3-B copy (en + ar) ──────────────────────────────────

const CLAIM_COPY = {
  en: {
    taxInvoice: "Valid tax invoice (VAT recoverable)",
    supplierTrn: "Supplier TRN",
    paidFrom: "Paid from (bank / cash account)",
    defaultBank: "Default bank account",
    paid: "Paid",
  },
  ar: {
    taxInvoice: "فاتورة ضريبية صالحة (ضريبة قابلة للاسترداد)",
    supplierTrn: "الرقم الضريبي للمورد",
    paidFrom: "مدفوع من (حساب بنكي / نقدي)",
    defaultBank: "الحساب البنكي الافتراضي",
    paid: "مدفوعة",
  },
} as const;

/** Server contract: blanks become null, amounts stay numbers (validated server-side). */
function claimPayload(data: ClaimFormData) {
  return {
    title: data.title,
    description: data.description || null,
    items: data.items.map((i) => ({
      expense_date: i.expense_date,
      category: i.category,
      description: i.description,
      amount: i.amount,
      vat_amount: i.vat_amount,
      merchant_name: i.merchant_name || null,
      receipt_url: i.receipt_url || null,
      supplier_trn: i.supplier_trn || null,
      has_tax_invoice: i.has_tax_invoice,
    })),
  };
}

// ─── Component ────────────────────────────────────────────

export default function ExpenseClaims() {
  const { t, locale } = useTranslation();
  // E2 (J3-r2 / J4-r2): review actions follow the role and the maker-checker rule.
  const { gate, gateApproval } = useCompanyPermission();
  const cc = CLAIM_COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { data: ledgerAccounts = [] } = useQuery<
    Array<{
      id: string;
      code: string;
      nameEn: string;
      nameAr?: string;
      type: string;
      subType?: string;
    }>
  >({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  // X5 (J1 D1): only postable cash/bank leaves (a header account never receives postings).
  const cashAccounts = postablePaymentAccounts(ledgerAccounts);
  const { data: currentUser } = useCurrentUser();

  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<ExpenseClaim | null>(null);
  const [viewingClaim, setViewingClaim] = useState<ExpenseClaim | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [reviewClaimId, setReviewClaimId] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [claimToDelete, setClaimToDelete] = useState<string | null>(null);
  const [paymentClaimId, setPaymentClaimId] = useState<string | null>(null);
  const [payrollClaimId, setPayrollClaimId] = useState<string | null>(null);
  const [payrollEmployeeId, setPayrollEmployeeId] = useState<string>("");
  const { data: employees = [] } = useQuery<
    Array<{ id: string; full_name: string; employee_number?: string | null; status?: string }>
  >({
    queryKey: [`/api/companies/${companyId}/employees`],
    enabled: !!companyId && !!payrollClaimId,
  });
  const activeEmployees = employees.filter((e) => !e.status || e.status === "active");

  // ─── Queries ──────────────────────────────────────────

  const { data: allClaims = [], isLoading: isLoadingClaims } = useQuery<ExpenseClaim[]>({
    queryKey: [`/api/companies/${companyId}/expense-claims`],
    enabled: !!companyId,
  });

  const { data: summary } = useQuery<ClaimSummary>({
    queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
    enabled: !!companyId,
  });

  // ─── Derived data ─────────────────────────────────────

  const myClaims = useMemo(
    () => allClaims.filter((c) => c.submitted_by === currentUser?.id),
    [allClaims, currentUser?.id]
  );

  const submittedClaims = useMemo(
    () => allClaims.filter((c) => c.status === "submitted"),
    [allClaims]
  );

  const pendingTotal = summary?.thisMonth?.submitted?.total || 0;
  const approvedTotal = summary?.thisMonth?.approved?.total || 0;
  const paidTotal = summary?.thisMonth?.paid?.total || 0;

  // ─── Forms ────────────────────────────────────────────

  const claimForm = useForm<ClaimFormData>({
    resolver: zodResolver(claimFormSchema),
    defaultValues: {
      title: "",
      description: "",
      items: [
        {
          expense_date: format(new Date(), "yyyy-MM-dd"),
          category: "",
          description: "",
          amount: 0,
          vat_amount: 0,
          merchant_name: "",
          receipt_url: "",
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: claimForm.control,
    name: "items",
  });

  const reviewForm = useForm<ReviewFormData>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: { review_notes: "" },
  });

  const paymentForm = useForm<PaymentFormData>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: { payment_reference: "" },
  });

  // ─── Mutations ────────────────────────────────────────

  const createClaimMutation = useMutation({
    mutationFn: (data: ClaimFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/expense-claims`, claimPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: translateNow("toasts.claimCreated"),
        description: translateNow("toasts.yourExpenseClaimHasBeenCreatedAs"),
      });
      setClaimDialogOpen(false);
      claimForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const updateClaimMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClaimFormData }) =>
      apiRequest("PATCH", `/api/expense-claims/${id}`, claimPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: translateNow("toasts.claimUpdated"),
        description: translateNow("toasts.yourExpenseClaimHasBeenUpdated"),
      });
      setClaimDialogOpen(false);
      setEditingClaim(null);
      claimForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const deleteClaimMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/expense-claims/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: translateNow("toasts.claimDeleted"),
        description: translateNow("toasts.theExpenseClaimHasBeenDeleted"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const submitClaimMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/expense-claims/${id}/submit`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: translateNow("toasts.claimSubmitted"),
        description: translateNow("toasts.yourExpenseClaimHasBeenSubmittedFor"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const approveClaimMutation = useMutation({
    mutationFn: ({ id, review_notes }: { id: string; review_notes?: string }) =>
      apiRequest("POST", `/api/expense-claims/${id}/approve`, { review_notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: translateNow("toasts.claimApproved"),
        description: translateNow("toasts.theExpenseClaimHasBeenApproved"),
      });
      setReviewDialogOpen(false);
      reviewForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const rejectClaimMutation = useMutation({
    mutationFn: ({ id, review_notes }: { id: string; review_notes: string }) =>
      apiRequest("POST", `/api/expense-claims/${id}/reject`, { review_notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: translateNow("toasts.claimRejected"),
        description: translateNow("toasts.theExpenseClaimHasBeenRejected"),
      });
      setReviewDialogOpen(false);
      reviewForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: ({
      id,
      payment_reference,
      payment_account_id,
    }: {
      id: string;
      payment_reference?: string | null;
      payment_account_id?: string | null;
    }) =>
      apiRequest("POST", `/api/expense-claims/${id}/mark-paid`, {
        payment_reference: payment_reference || null,
        payment_account_id: payment_account_id || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: translateNow("toasts.claimPaid"),
        description: translateNow("toasts.theExpenseClaimHasBeenMarkedAs"),
      });
      setPaymentDialogOpen(false);
      paymentForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // S2 (R04-20): queue an approved claim for the employee's next payroll run (or take it off).
  const payrollMutation = useMutation({
    mutationFn: ({
      id,
      enabled,
      employee_id,
    }: {
      id: string;
      enabled: boolean;
      employee_id?: string | null;
    }) =>
      apiRequest("POST", `/api/expense-claims/${id}/payroll-reimbursement`, {
        enabled,
        ...(enabled && employee_id ? { employee_id } : {}),
      }),
    onSuccess: (_data, vars) => {
      setPayrollClaimId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      toast({
        title: vars.enabled ? t["purchases.claimQueuedForPayroll"] : t["purchases.claimUnqueued"],
      });
    },
    onError: (error: Error) => {
      toast({
        title: t["purchases.claimPayrollFailed"],
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingClaim(null);
    claimForm.reset({
      title: "",
      description: "",
      items: [
        {
          expense_date: format(new Date(), "yyyy-MM-dd"),
          category: "",
          description: "",
          amount: 0,
          vat_amount: 0,
          merchant_name: "",
          receipt_url: "",
        },
      ],
    });
    setClaimDialogOpen(true);
  };

  const handleOpenEditDialog = async (claim: ExpenseClaim) => {
    try {
      const fullClaim = await apiRequest("GET", `/api/expense-claims/${claim.id}`);
      setEditingClaim(fullClaim);
      claimForm.reset({
        title: fullClaim.title,
        description: fullClaim.description || "",
        items:
          fullClaim.items && fullClaim.items.length > 0
            ? fullClaim.items.map((item: ExpenseClaimItem) => ({
                expense_date: item.expense_date
                  ? format(new Date(item.expense_date), "yyyy-MM-dd")
                  : "",
                category: item.category,
                description: item.description,
                amount: parseFloat(String(item.amount)),
                vat_amount: parseFloat(String(item.vat_amount)) || 0,
                merchant_name: item.merchant_name || "",
                receipt_url: item.receipt_url || "",
                supplier_trn: item.supplier_trn || "",
                has_tax_invoice: item.has_tax_invoice !== false,
              }))
            : [
                {
                  expense_date: format(new Date(), "yyyy-MM-dd"),
                  category: "",
                  description: "",
                  amount: 0,
                  vat_amount: 0,
                  merchant_name: "",
                  receipt_url: "",
                },
              ],
      });
      setClaimDialogOpen(true);
    } catch (error: any) {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    }
  };

  const handleViewClaim = async (claim: ExpenseClaim) => {
    try {
      const fullClaim = await apiRequest("GET", `/api/expense-claims/${claim.id}`);
      setViewingClaim(fullClaim);
      setViewDialogOpen(true);
    } catch (error: any) {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    }
  };

  const handleClaimSubmit = (data: ClaimFormData) => {
    if (editingClaim) {
      updateClaimMutation.mutate({ id: editingClaim.id, data });
    } else {
      createClaimMutation.mutate(data);
    }
  };

  const handleOpenReviewDialog = (claimId: string, action: "approve" | "reject") => {
    setReviewClaimId(claimId);
    setReviewAction(action);
    reviewForm.reset({ review_notes: "" });
    setReviewDialogOpen(true);
  };

  const handleReviewSubmit = (data: ReviewFormData) => {
    if (!reviewClaimId) return;
    const notes = (data.review_notes ?? "").trim();
    if (reviewAction === "approve") {
      approveClaimMutation.mutate({ id: reviewClaimId, review_notes: notes || undefined });
    } else {
      if (!notes) {
        reviewForm.setError("review_notes", { message: "forms.errors.reviewNotesRequired" });
        return;
      }
      rejectClaimMutation.mutate({ id: reviewClaimId, review_notes: notes });
    }
  };

  const handleOpenPaymentDialog = (claimId: string) => {
    setPaymentClaimId(claimId);
    paymentForm.reset({ payment_reference: "", payment_account_id: "" });
    setPaymentDialogOpen(true);
  };

  const handlePaymentSubmit = (data: PaymentFormData) => {
    if (!paymentClaimId) return;
    markPaidMutation.mutate({
      id: paymentClaimId,
      payment_reference: data.payment_reference,
      payment_account_id: data.payment_account_id,
    });
  };

  // ─── Helpers ──────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return (
          <StatusBadge tone="neutral">
            <T k="pages.draft" />
          </StatusBadge>
        );
      case "submitted":
        return (
          <StatusBadge tone="info">
            <T k="pages.submitted" />
          </StatusBadge>
        );
      case "approved":
        return (
          <StatusBadge tone="success">
            <T k="pages.approved" />
          </StatusBadge>
        );
      case "rejected":
        return (
          <StatusBadge tone="danger">
            <T k="pages.rejected" />
          </StatusBadge>
        );
      case "paid":
        return <StatusBadge tone="success">{cc.paid}</StatusBadge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  const calculateItemsTotal = () => {
    const items = claimForm.watch("items");
    return items.reduce(
      (sum, item) => sum + (Number(item.amount) || 0) + (Number(item.vat_amount) || 0),
      0
    );
  };

  // ─── Loading State ────────────────────────────────────

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <StatCardSkeleton count={3} />
        <Card>
          <CardContent className="pt-6">
            <TableSkeleton rows={5} columns={6} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!companyId) {
    return (
      <EmptyState
        icon={Receipt}
        title={t["screens.setUpCompanyFirst"]}
        description={t["screens.claimsNeedCompany"]}
        action={{
          label: t["screens.continueSetup"],
          onClick: () => {
            window.location.href = "/onboarding";
          },
          testId: "button-go-onboarding",
        }}
      />
    );
  }

  // ─── Claims Table Component ───────────────────────────

  const ClaimsTable = ({
    claims,
    loading = false,
    showActions = true,
    isReview = false,
    emptyTitle,
    emptyDescription,
    emptyAction,
  }: {
    claims: ExpenseClaim[];
    loading?: boolean;
    showActions?: boolean;
    isReview?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyAction?: { label: string; onClick: () => void };
  }) => (
    <DataTableCard
      status={loading ? "loading" : claims.length === 0 ? "empty" : "ready"}
      columnLabels={[t["pages.title"], t.date, t.amount, t.status]}
      empty={{
        icon: Receipt,
        title: emptyTitle ?? (t as any).noExpenseClaimsYet ?? "No expense claims yet",
        description:
          emptyDescription ??
          (t as any).expenseClaimsEmptyDesc ??
          "Submit your first reimbursement to get started.",
        action: emptyAction
          ? { label: emptyAction.label, onClick: emptyAction.onClick, icon: Plus }
          : undefined,
        testId: "empty-state-expense-claims",
      }}
    >
      <Table className="row-cards">
        <TableHeader>
          <TableRow>
            <TableHead>{t["screens.claimNumber"]}</TableHead>
            <TableHead className="w-full">
              <T k="pages.title" />
            </TableHead>
            <TableHead>{t.date || "Date"}</TableHead>
            <TableHead data-numeric="">{t.amount || "Amount"}</TableHead>
            <TableHead>{t.status || "Status"}</TableHead>
            {showActions && (
              <TableHead>
                <span className="sr-only">{t.actions || "Actions"}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.map((claim) => {
            const canEdit = !isReview && claim.status === "draft";
            const canReview = isReview && claim.status === "submitted";
            const canPay = claim.status === "approved" && !claim.payroll_run_id;
            return (
              <TableRow key={claim.id}>
                <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                  <span dir="ltr" className="[unicode-bidi:isolate]">
                    {claim.claim_number}
                  </span>
                </TableCell>
                <TableCell data-truncate="" data-cell="title" dir="auto" className="font-medium">
                  {claim.title}
                </TableCell>
                <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                  {claim.created_at ? formatDate(claim.created_at, locale) : "—"}
                </TableCell>
                <MoneyCell
                  amount={parseFloat(String(claim.total_amount)) || 0}
                  currency={claim.currency || "AED"}
                  className="font-medium"
                  data-cell="amount"
                />
                <TableCell data-nowrap="" data-cell="status">
                  {getStatusBadge(claim.status)}
                  {claim.status === "approved" && claim.payroll_run_id && (
                    <span className="ms-2 text-caption text-muted-foreground">
                      {t["purchases.onPayrollRun"]}
                    </span>
                  )}
                </TableCell>
                {showActions && (
                  <TableCell data-cell="actions">
                    <RowActions
                      // One visible action (a reviewer's is Approve); Reject and View details live in ⋯.
                      maxInline={1}
                      collapseOnMobile
                      menu={
                        canEdit || canPay ? (
                          <>
                            {canEdit && (
                              <DropdownMenuItem onSelect={() => handleOpenEditDialog(claim)}>
                                <Edit aria-hidden />
                                {t.edit}
                              </DropdownMenuItem>
                            )}
                            {canPay && (
                              <DropdownMenuItem onSelect={() => handleOpenPaymentDialog(claim.id)}>
                                <CreditCard aria-hidden />
                                {t["screens.markAsPaid"]}
                              </DropdownMenuItem>
                            )}
                            {canPay && (
                              <DropdownMenuItem
                                disabled={payrollMutation.isPending}
                                onSelect={() => {
                                  if (claim.reimburse_via_payroll) {
                                    payrollMutation.mutate({ id: claim.id, enabled: false });
                                  } else {
                                    // Ask which employee's payroll reimburses the claim
                                    // (the submitter's email may not match an employee).
                                    setPayrollEmployeeId(claim.employee_id ?? "");
                                    setPayrollClaimId(claim.id);
                                  }
                                }}
                                aria-pressed={!!claim.reimburse_via_payroll}
                                data-testid={`claim-payroll-${claim.id}`}
                              >
                                <Wallet aria-hidden />
                                {claim.reimburse_via_payroll
                                  ? t["purchases.removeFromPayroll"]
                                  : t["purchases.reimburseViaPayroll"]}
                              </DropdownMenuItem>
                            )}
                            {canEdit && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => setClaimToDelete(claim.id)}
                                >
                                  <Trash2 aria-hidden />
                                  {t.delete}
                                </DropdownMenuItem>
                              </>
                            )}
                          </>
                        ) : undefined
                      }
                    >
                      {canEdit && (
                        <RowActionButton
                          label={t["screens.submitForReview"]}
                          icon={Send}
                          onClick={() => submitClaimMutation.mutate(claim.id)}
                        />
                      )}
                      {canReview && (
                        <>
                          <RowActionButton
                            label={t["pages.approve"]}
                            icon={CheckCircle}
                            onClick={() => handleOpenReviewDialog(claim.id, "approve")}
                            data-testid={`claim-approve-${claim.id}`}
                            {...gateApproval("documents.approve", claim.submitted_by)}
                          />
                          <RowActionButton
                            label={t["screens.reject"]}
                            icon={XCircle}
                            onClick={() => handleOpenReviewDialog(claim.id, "reject")}
                            data-testid={`claim-reject-${claim.id}`}
                            {...gateApproval("documents.approve", claim.submitted_by)}
                          />
                        </>
                      )}
                      <RowActionButton
                        label={t["screens.viewDetails"]}
                        icon={Eye}
                        onClick={() => handleViewClaim(claim)}
                      />
                    </RowActions>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableCard>
  );

  // ─── Claim editor ─────────────────────────────────────
  // Spec 2.2 / Fable P2: a claim has line items, so it is written on a full page (EditorShell),
  // not in a dialog.
  if (claimDialogOpen) {
    return (
      <EditorShell
        testId="dialog-claim-form"
        eyebrow="Purchases"
        title={editingClaim ? t["forms.claim.editTitle"] : t["forms.claim.newTitle"]}
        description={editingClaim ? t["forms.claim.editDesc"] : t["forms.claim.newDesc"]}
        footerSummary={
          <span className="flex flex-wrap items-baseline gap-x-2" data-testid="editor-total">
            <span>{t["forms.claim.total"]}</span>
            <Money
              amount={calculateItemsTotal()}
              currency="AED"
              className="text-h3 font-semibold text-foreground"
            />
          </span>
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setClaimDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              type="submit"
              form="expense-claim-form"
              className="sm:min-w-32"
              disabled={createClaimMutation.isPending || updateClaimMutation.isPending}
            >
              {createClaimMutation.isPending || updateClaimMutation.isPending
                ? t["forms.saving"]
                : editingClaim
                  ? t["forms.claim.update"]
                  : t["forms.claim.saveDraft"]}
            </Button>
          </>
        }
      >
        <Form {...claimForm}>
          <form
            id="expense-claim-form"
            onSubmit={claimForm.handleSubmit(handleClaimSubmit)}
            noValidate
            className="space-y-6"
          >
            <FormErrorSummary />
            <FormSection title={t["forms.section.claim"]}>
              <FormGrid cols={1}>
                <FormField
                  control={claimForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t["forms.claim.title"]}</FormLabel>
                      <FormControl>
                        <Input
                          dir="auto"
                          placeholder={t["forms.claim.titlePlaceholder"]}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={claimForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.description}</FormLabel>
                      <FormControl>
                        <Textarea
                          dir="auto"
                          rows={2}
                          placeholder={t["screens.claimDescPlaceholder"]}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>
            </FormSection>

            <FormSection
              title={<T k="pages.expenseItems" />}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({
                      expense_date: format(new Date(), "yyyy-MM-dd"),
                      category: "",
                      description: "",
                      amount: 0,
                      vat_amount: 0,
                      merchant_name: "",
                      receipt_url: "",
                      has_tax_invoice: true,
                    })
                  }
                >
                  <Plus className="h-4 w-4" />
                  <T k="pages.addItem" />
                </Button>
              }
            >
              <LineItemList>
                {fields.map((field, index) => (
                  <LineItem
                    key={field.id}
                    index={index}
                    onRemove={() => remove(index)}
                    canRemove={fields.length > 1}
                    gridClassName="sm:grid-cols-3"
                    main={
                      <FormField
                        control={claimForm.control}
                        name={`items.${index}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required className={lineLabelClass}>
                              {t.description}
                            </FormLabel>
                            <FormControl>
                              <Input
                                dir="auto"
                                placeholder={t["screens.describeExpense"]}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    }
                  >
                    <FormField
                      control={claimForm.control}
                      name={`items.${index}.expense_date`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required className={lineLabelClass}>
                            {t.date}
                          </FormLabel>
                          <FormControl>
                            <DatePicker value={field.value ?? ""} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={claimForm.control}
                      name={`items.${index}.category`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required className={lineLabelClass}>
                            {t["forms.claim.category"]}
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={t["screens.selectCategory"]} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {EXPENSE_CATEGORIES.map((cat) => (
                                <SelectItem key={cat} value={cat}>
                                  {t[`forms.claim.cat.${cat}`] || cat}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={claimForm.control}
                      name={`items.${index}.merchant_name`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={lineLabelClass}>
                            <T k="pages.merchant" />
                          </FormLabel>
                          <FormControl>
                            <Input dir="auto" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={claimForm.control}
                      name={`items.${index}.amount`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required className={lineLabelClass}>
                            {t["forms.claim.amountExclVatAed"]}
                          </FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={claimForm.control}
                      name={`items.${index}.vat_amount`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={lineLabelClass}>
                            {t["screens.vatAmountAed"]}
                          </FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={claimForm.control}
                      name={`items.${index}.supplier_trn`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={lineLabelClass}>{cc.supplierTrn}</FormLabel>
                          <FormControl>
                            <Input ltr inputMode="numeric" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {/* Spec 3.8: no receipt-link field until receipt upload exists; an
                      existing link on the line is kept as it is. */}
                    <FormField
                      control={claimForm.control}
                      name={`items.${index}.has_tax_invoice`}
                      render={({ field }) => (
                        <FormItem className="col-span-2 flex items-center gap-2 space-y-0 sm:col-span-1 sm:mt-6">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(v) => field.onChange(v === true)}
                            />
                          </FormControl>
                          <FormLabel className="font-normal">{cc.taxInvoice}</FormLabel>
                        </FormItem>
                      )}
                    />
                  </LineItem>
                ))}
              </LineItemList>

              {claimForm.formState.errors.items?.message && (
                <p className="text-caption font-medium text-danger">
                  {claimForm.formState.errors.items.message}
                </p>
              )}

              <FormTotals
                rows={[]}
                total={{
                  label: t["forms.claim.total"],
                  value: <Money amount={calculateItemsTotal()} currency="AED" />,
                }}
              />
            </FormSection>
          </form>
        </Form>
      </EditorShell>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title={t["pages.expenseClaims"]}
        description={t["pages.submitTrackAndManageEmployeeExpenseReimbursement"]}
        actions={
          <Button
            onClick={handleOpenCreateDialog}
            data-testid="button-new-claim"
            {...gate("documents.write")}
          >
            <Plus aria-hidden />
            <T k="pages.newClaim" />
          </Button>
        }
      />

      {/* ─── Summary (spec 2.6: hidden until the first claim exists) ─── */}
      {allClaims.length > 0 && (
        <div className="mobile-keep-cols grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard
            label={t["pages.pendingThisMonth"]}
            icon={Clock}
            value={<Money amount={pendingTotal} />}
            hint={formatMessage(t["screens.claimsAwaitingReview"], {
              count: summary?.thisMonth?.submitted?.count || 0,
            })}
          />
          <StatCard
            label={t["pages.approvedThisMonth"]}
            icon={CheckCircle}
            value={<Money amount={approvedTotal} />}
            hint={formatMessage(t["screens.claimsApproved"], {
              count: summary?.thisMonth?.approved?.count || 0,
            })}
          />
          <StatCard
            label={t["pages.paidThisMonth"]}
            icon={DollarSign}
            value={<Money amount={paidTotal} />}
            hint={formatMessage(t["screens.claimsPaidOut"], {
              count: summary?.thisMonth?.paid?.count || 0,
            })}
          />
        </div>
      )}

      {/* ─── Tabs ──────────────────────────────────────── */}
      <Tabs defaultValue="my-claims" className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-claims">
            <FileText aria-hidden />
            <T k="pages.myClaims" />
          </TabsTrigger>
          <TabsTrigger value="review">
            <CheckCircle aria-hidden />
            {t["screens.review"]}
            {submittedClaims.length > 0 && (
              <StatusBadge tone="info" className="ms-1 px-1.5 py-0 text-xs">
                {submittedClaims.length}
              </StatusBadge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all-claims">
            <Receipt aria-hidden />
            <T k="pages.allClaims" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my-claims" className="space-y-3">
          <p className="text-small text-muted-foreground">
            {formatMessage(t["screens.claimsSubmittedCountPlural"], { count: myClaims.length })}
          </p>
          <ClaimsTable
            claims={myClaims}
            loading={isLoadingClaims}
            emptyTitle={t["screens.noClaimsYet"]}
            emptyDescription={t["screens.noClaimsYetBody"]}
            emptyAction={{ label: t["pages.newClaim"], onClick: handleOpenCreateDialog }}
          />
        </TabsContent>

        <TabsContent value="review" className="space-y-3">
          <p className="text-small text-muted-foreground">
            {formatMessage(t["screens.claimsPendingApproval"], { count: submittedClaims.length })}
          </p>
          <ClaimsTable
            claims={submittedClaims}
            loading={isLoadingClaims}
            isReview
            emptyTitle={t["screens.nothingToReview"]}
            emptyDescription={t["screens.nothingToReviewBody"]}
          />
        </TabsContent>

        <TabsContent value="all-claims" className="space-y-3">
          <p className="text-small text-muted-foreground">
            {formatMessage(t["screens.claimsAcrossCompanyPlural"], { count: allClaims.length })}
          </p>
          <ClaimsTable
            claims={allClaims}
            loading={isLoadingClaims}
            emptyTitle={t["screens.noExpenseClaims"]}
            emptyDescription={t["screens.noExpenseClaimsBody"]}
          />
        </TabsContent>
      </Tabs>

      {/* ─── View Claim Dialog ───────────────────────────── */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              <T k="pages.expenseClaimDetails" />
            </DialogTitle>
            <DialogDescription>
              {viewingClaim?.claim_number} - {viewingClaim?.title}
            </DialogDescription>
          </DialogHeader>

          {viewingClaim && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">
                    <T k="pages.status" />
                  </span>
                  <div className="mt-1">{getStatusBadge(viewingClaim.status)}</div>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    <T k="pages.totalAmount" />
                  </span>
                  <div className="mt-1 font-bold text-lg">
                    {formatCurrency(
                      parseFloat(String(viewingClaim.total_amount)) || 0,
                      viewingClaim.currency || "AED",
                      locale
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    <T k="pages.created" />
                  </span>
                  <div className="mt-1">
                    {viewingClaim.created_at ? formatDate(viewingClaim.created_at, locale) : "-"}
                  </div>
                </div>
                {viewingClaim.submitted_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">
                      <T k="pages.submitted" />
                    </span>
                    <div className="mt-1">{formatDate(viewingClaim.submitted_at, locale)}</div>
                  </div>
                )}
                {viewingClaim.reviewed_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">
                      <T k="pages.reviewed" />
                    </span>
                    <div className="mt-1">{formatDate(viewingClaim.reviewed_at, locale)}</div>
                  </div>
                )}
                {viewingClaim.paid_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">{t["screens.paid"]}</span>
                    <div className="mt-1">{formatDate(viewingClaim.paid_at, locale)}</div>
                  </div>
                )}
              </div>

              {viewingClaim.description && (
                <div>
                  <span className="text-sm text-muted-foreground">
                    <T k="pages.description" />
                  </span>
                  <p className="mt-1">{viewingClaim.description}</p>
                </div>
              )}

              {viewingClaim.review_notes && (
                <div>
                  <span className="text-sm text-muted-foreground">
                    <T k="pages.reviewNotes" />
                  </span>
                  <p className="mt-1 text-sm bg-muted p-2 rounded">{viewingClaim.review_notes}</p>
                </div>
              )}

              {viewingClaim.payment_reference && (
                <div>
                  <span className="text-sm text-muted-foreground">
                    <T k="pages.paymentReference" />
                  </span>
                  <p className="mt-1 text-sm">{viewingClaim.payment_reference}</p>
                </div>
              )}

              {/* Items table */}
              {viewingClaim.items && viewingClaim.items.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">
                    <T k="pages.expenseItems" />
                  </h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.date || "Date"}</TableHead>
                          <TableHead>
                            <T k="pages.category" />
                          </TableHead>
                          <TableHead>{t.description || "Description"}</TableHead>
                          <TableHead>
                            <T k="pages.merchant" />
                          </TableHead>
                          <TableHead className="text-end">{t.amount || "Amount"}</TableHead>
                          <TableHead className="text-end">{t["screens.vat"]}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewingClaim.items.map((item, idx) => (
                          <TableRow key={item.id || idx}>
                            <TableCell className="whitespace-nowrap">
                              {item.expense_date ? formatDate(item.expense_date, locale) : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{item.category}</Badge>
                            </TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {item.merchant_name || "-"}
                            </TableCell>
                            <TableCell className="text-end">
                              {formatCurrency(parseFloat(String(item.amount)) || 0, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-end">
                              {formatCurrency(
                                parseFloat(String(item.vat_amount)) || 0,
                                "AED",
                                locale
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Review Dialog ───────────────────────────────── */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve"
                ? t["expenseClaims.approveClaim"]
                : t["expenseClaims.rejectClaim"]}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "approve"
                ? t["purchases.claimApproveHint"]
                : t["purchases.claimRejectHint"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...reviewForm}>
            <form onSubmit={reviewForm.handleSubmit(handleReviewSubmit)} className="space-y-4">
              <FormField
                control={reviewForm.control}
                name="review_notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.reviewNotes" />
                      {reviewAction === "reject" && <span className="ms-0.5 text-danger">*</span>}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={
                          reviewAction === "approve"
                            ? t["screens.optionalApprovalNotes"]
                            : t["screens.rejectionReasonRequired"]
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setReviewDialogOpen(false)}>
                  {t.cancel || "Cancel"}
                </Button>
                <Button
                  type="submit"
                  variant={reviewAction === "approve" ? "default" : "destructive"}
                  disabled={approveClaimMutation.isPending || rejectClaimMutation.isPending}
                >
                  {approveClaimMutation.isPending || rejectClaimMutation.isPending
                    ? t.loading || "Loading..."
                    : reviewAction === "approve"
                      ? t["purchases.claimApprove"]
                      : t["purchases.claimReject"]}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Payment Dialog ──────────────────────────────── */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              <T k="pages.markAsPaid" />
            </DialogTitle>
            <DialogDescription>
              <T k="pages.recordThePaymentDetailsForThisApprovedExpenseCla" />
            </DialogDescription>
          </DialogHeader>

          <Form {...paymentForm}>
            <form onSubmit={paymentForm.handleSubmit(handlePaymentSubmit)} className="space-y-4">
              <FormField
                control={paymentForm.control}
                name="payment_reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.paymentReference" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Bank transfer ref, cheque number"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={paymentForm.control}
                name="payment_account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{cc.paidFrom}</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={cc.defaultBank} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {cashAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.code} - {accountDisplayName(a, locale)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                  {t.cancel || "Cancel"}
                </Button>
                <Button type="submit" disabled={markPaidMutation.isPending}>
                  {markPaidMutation.isPending ? t.loading || "Loading..." : t["pages.markAsPaid"]}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Payroll reimbursement: choose the employee ──── */}
      <Dialog
        open={!!payrollClaimId}
        onOpenChange={(open) => {
          if (!open) setPayrollClaimId(null);
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t["purchases.reimburseViaPayroll"]}</DialogTitle>
            <DialogDescription>{t["purchases.claimPayrollEmployeeHint"]}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!payrollClaimId || payrollMutation.isPending) return;
              payrollMutation.mutate({
                id: payrollClaimId,
                enabled: true,
                employee_id: payrollEmployeeId || null,
              });
            }}
          >
            <div className="space-y-2">
              <label htmlFor="claim-payroll-employee" className="text-sm font-medium">
                {t["purchases.claimPayrollEmployee"]}
              </label>
              <Select value={payrollEmployeeId} onValueChange={setPayrollEmployeeId}>
                <SelectTrigger id="claim-payroll-employee" data-testid="claim-payroll-employee">
                  <SelectValue placeholder={t["purchases.claimPayrollEmployeeMatch"]} />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.employee_number ? `${e.employee_number} - ` : ""}
                      {e.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayrollClaimId(null)}>
                {t.cancel || "Cancel"}
              </Button>
              <Button
                type="submit"
                data-testid="claim-payroll-confirm"
                disabled={payrollMutation.isPending}
              >
                {t["purchases.reimburseViaPayroll"]}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!claimToDelete}
        onOpenChange={(open) => {
          if (!open) setClaimToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="pages.deleteExpenseClaim" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t["expenseClaims.thisWillPermanentlyDeleteThis"]}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (claimToDelete) {
                  deleteClaimMutation.mutate(claimToDelete);
                  setClaimToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pages.delete" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
