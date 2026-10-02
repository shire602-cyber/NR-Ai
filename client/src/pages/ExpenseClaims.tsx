import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { PaymentDateField, toDateOnly } from "@/components/PaymentDateField";
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
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getStoredUser } from "@/lib/auth";
import { formatCurrency } from "@/lib/format";
import { ReceiptUploadField } from "@/components/expense-claims/ReceiptUploadField";
import { downloadAuthenticatedFile } from "@/lib/file-upload";
import { LineProjectFields } from "@/components/projects/LineProjectFields";
import { ApprovalStatusBadge, approverRoleLabel } from "@/components/approvals/ApprovalStatusBadge";
import { messages as approvalMessages } from "@/components/approvals/ApprovalStatusBadge.i18n";
import { useApprovalProgress } from "@/hooks/useApprovalProgress";
import { failureToast } from "@/lib/approval-feedback";
import { isPendingApprovalBody } from "@/lib/purchasing-hr";
import { messages as pageMessages } from "./ExpenseClaims.i18n";
import { resolveMessage } from "@/lib/i18n-messages";

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
  merchant_name?: string | null;
  project_id?: string | null;
  is_billable?: boolean;
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
  created_at: string;
  items?: ExpenseClaimItem[];
}

interface ClaimSummary {
  all: Record<string, { count: number; total: number }>;
  thisMonth: Record<string, { count: number; total: number }>;
}

// ─── Constants ────────────────────────────────────────────

// i18n-ignore-start: category ids stored with each claim item; the UI shows translated labels (see categoryLabel)
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
// i18n-ignore-end

const CATEGORY_LABEL_KEYS = {
  Travel: "categoryTravel",
  Meals: "categoryMeals",
  Transport: "categoryTransport",
  Accommodation: "categoryAccommodation",
  "Office Supplies": "categoryOfficeSupplies",
  "Client Entertainment": "categoryClientEntertainment",
  Telephone: "categoryTelephone",
  Internet: "categoryInternet",
  Other: "categoryOther",
} as const;

/** Display label for a stored category id (the id itself stays English). */
function categoryLabel(category: string): string {
  const key = CATEGORY_LABEL_KEYS[category as keyof typeof CATEGORY_LABEL_KEYS];
  return key ? pageMessages.t(key) : category;
}

// ─── Schemas ──────────────────────────────────────────────

const expenseItemSchema = z.object({
  expense_date: z.string().min(1, pageMessages.marker("dateIsRequired")),
  category: z.string().min(1, pageMessages.marker("categoryIsRequired")),
  description: z.string().min(1, pageMessages.marker("descriptionIsRequired")),
  amount: z.coerce.number().min(0.01, pageMessages.marker("amountMustBeGreaterThan0")),
  vat_amount: z.coerce.number().min(0, pageMessages.marker("vatAmountMustBe0")),
  merchant_name: z.string().optional().nullable(),
  receipt_url: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  is_billable: z.boolean().optional(),
});

const claimFormSchema = z.object({
  title: z.string().min(1, pageMessages.marker("titleIsRequired")),
  description: z.string().optional().nullable(),
  items: z.array(expenseItemSchema).min(1, pageMessages.marker("atLeastOneExpenseItemIs")),
});

type ClaimFormData = z.infer<typeof claimFormSchema>;

const reviewFormSchema = z.object({
  review_notes: z.string().min(1, pageMessages.marker("reviewNotesAreRequired")),
});

type ReviewFormData = z.infer<typeof reviewFormSchema>;

const paymentFormSchema = z.object({
  payment_reference: z.string().optional().nullable(),
});

type PaymentFormData = z.infer<typeof paymentFormSchema>;

// ─── Component ────────────────────────────────────────────

export default function ExpenseClaims() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const currentUser = getStoredUser();

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
    () => allClaims.filter((c) => c.status === "submitted" || c.status === "pending_approval"),
    [allClaims]
  );
  const approvalProgress = useApprovalProgress(companyId ?? undefined, "expense_claim", allClaims.some((c) => c.status === "pending_approval"));

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
  const [paymentDate, setPaymentDate] = useState<Date>(() => new Date());

  // ─── Mutations ────────────────────────────────────────

  const createClaimMutation = useMutation({
    mutationFn: (data: ClaimFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/expense-claims`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({
        title: tr("claimCreated"),
        description: tr("yourExpenseClaimHasBeenCreated"),
      });
      setClaimDialogOpen(false);
      claimForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const updateClaimMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClaimFormData }) =>
      apiRequest("PATCH", `/api/expense-claims/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({ title: tr("claimUpdated"), description: tr("yourExpenseClaimHasBeenUpdated") });
      setClaimDialogOpen(false);
      setEditingClaim(null);
      claimForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const deleteClaimMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/expense-claims/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({ title: tr("claimDeleted"), description: tr("theExpenseClaimHasBeenDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
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
        title: tr("claimSubmitted"),
        description: tr("yourExpenseClaimHasBeenSubmitted"),
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const approveClaimMutation = useMutation({
    mutationFn: ({ id, review_notes }: { id: string; review_notes?: string }) =>
      apiRequest("POST", `/api/expense-claims/${id}/approve`, { review_notes }),
    onSuccess: (body: unknown) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "approvals"] });
      if (isPendingApprovalBody(body)) {
        toast({
          title: approvalMessages.t("pendingApprovalSteps", { done: body.approval.completedSteps, total: body.approval.requiredSteps }),
          description: body.approval.nextRole ? approvalMessages.t("nextRole", { role: approverRoleLabel(body.approval.nextRole) }) : undefined,
        });
      } else {
        toast({ title: tr("claimApproved"), description: tr("theExpenseClaimHasBeenApproved") });
      }
      setReviewDialogOpen(false);
      reviewForm.reset();
    },
    onError: (error: Error) => {
      toast(failureToast(error, tr("error")));
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
      toast({ title: tr("claimRejected"), description: tr("theExpenseClaimHasBeenRejected") });
      setReviewDialogOpen(false);
      reviewForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: ({
      id,
      payment_reference,
      payment_date,
    }: {
      id: string;
      payment_reference?: string | null;
      payment_date?: string;
    }) =>
      apiRequest("POST", `/api/expense-claims/${id}/mark-paid`, {
        payment_reference,
        payment_date,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/expense-claims/summary`],
      });
      toast({ title: tr("claimPaid"), description: tr("theExpenseClaimHasBeenMarked") });
      setPaymentDialogOpen(false);
      paymentForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
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
                project_id: item.project_id ?? null,
                is_billable: !!item.is_billable,
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
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    }
  };

  const handleViewClaim = async (claim: ExpenseClaim) => {
    try {
      const fullClaim = await apiRequest("GET", `/api/expense-claims/${claim.id}`);
      setViewingClaim(fullClaim);
      setViewDialogOpen(true);
    } catch (error: any) {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
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
    if (reviewAction === "approve") {
      approveClaimMutation.mutate({ id: reviewClaimId, review_notes: data.review_notes });
    } else {
      rejectClaimMutation.mutate({ id: reviewClaimId, review_notes: data.review_notes });
    }
  };

  const handleOpenPaymentDialog = (claimId: string) => {
    setPaymentClaimId(claimId);
    paymentForm.reset({ payment_reference: "" });
    setPaymentDate(new Date());
    setPaymentDialogOpen(true);
  };

  const handlePaymentSubmit = (data: PaymentFormData) => {
    if (!paymentClaimId) return;
    markPaidMutation.mutate({
      id: paymentClaimId,
      payment_reference: data.payment_reference,
      payment_date: toDateOnly(paymentDate),
    });
  };

  // ─── Helpers ──────────────────────────────────────────

  const getStatusBadge = (status: string, claimId?: string) => {
    switch (status) {
      case "pending_approval": {
        const progress = claimId ? approvalProgress.get(claimId) : undefined;
        return <ApprovalStatusBadge status="pending_approval" completedSteps={progress?.completedSteps} requiredSteps={progress?.requiredSteps} />;
      }
      case "draft":
        return <StatusBadge tone="neutral">{tr("draft")}</StatusBadge>;
      case "submitted":
        return <StatusBadge tone="info">{tr("submitted")}</StatusBadge>;
      case "approved":
        return <StatusBadge tone="success">{tr("approved")}</StatusBadge>;
      case "rejected":
        return <StatusBadge tone="danger">{tr("rejected")}</StatusBadge>;
      case "paid":
        return <StatusBadge tone="accent">{tr("paid")}</StatusBadge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
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
        title={tr("setUpYourCompanyFirst")}
        description={tr("expenseClaimsLiveInsideACompany")}
        action={{
          label: tr("continueSetup"),
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
    showActions = true,
    isReview = false,
    emptyTitle,
    emptyDescription,
    emptyAction,
  }: {
    claims: ExpenseClaim[];
    showActions?: boolean;
    isReview?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    emptyAction?: { label: string; onClick: () => void };
  }) => {
    const tr = pageMessages.useT();

    if (claims.length === 0) {
      return (
        <EmptyState
          icon={Receipt}
          title={emptyTitle ?? (t as any).noExpenseClaimsYet ?? tr("noExpenseClaimsYet")}
          description={
            emptyDescription ??
            (t as any).expenseClaimsEmptyDesc ??
            tr("submitYourFirstReimbursementToGet")
          }
          action={
            emptyAction
              ? { label: emptyAction.label, onClick: emptyAction.onClick, icon: Plus }
              : undefined
          }
          testId="empty-state-expense-claims"
        />
      );
    }
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("claim")}</TableHead>
              <TableHead>{tr("title")}</TableHead>
              <TableHead>{t.date || tr("date")}</TableHead>
              <TableHead className="text-end">{t.amount || tr("amount")}</TableHead>
              <TableHead>{t.status || tr("status")}</TableHead>
              {showActions && (
                <TableHead className="text-end">{t.actions || tr("actions")}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((claim) => (
              <TableRow key={claim.id}>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {claim.claim_number}
                </TableCell>
                <TableCell className="font-medium">{claim.title}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {claim.created_at ? format(new Date(claim.created_at), "MMM dd, yyyy") : "-"}
                </TableCell>
                <TableCell className="text-end font-mono">
                  {formatCurrency(
                    parseFloat(String(claim.total_amount)) || 0,
                    claim.currency || "AED",
                    locale
                  )}
                </TableCell>
                <TableCell>{getStatusBadge(claim.status, claim.id)}</TableCell>
                {showActions && (
                  <TableCell className="text-end">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewClaim(claim)}
                        title={tr("viewDetails")}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {!isReview && claim.status === "draft" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEditDialog(claim)}
                            title={tr("edit")}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => submitClaimMutation.mutate(claim.id)}
                            title={tr("submitForReview")}
                            className="text-primary hover:text-primary"
                          >
                            <Send className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setClaimToDelete(claim.id)}
                            title={tr("delete")}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {isReview && (claim.status === "submitted" || claim.status === "pending_approval") && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReviewDialog(claim.id, "approve")}
                            title={tr("approve")}
                            className="text-[hsl(var(--chart-5))] hover:text-[hsl(var(--chart-5))]"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReviewDialog(claim.id, "reject")}
                            title={tr("reject")}
                            className="text-destructive hover:text-destructive"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {claim.status === "approved" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenPaymentDialog(claim.id)}
                          title={tr("markAsPaid")}
                          className="text-[hsl(var(--chart-3))] hover:text-[hsl(var(--chart-3))]"
                        >
                          <CreditCard className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Receipt className="w-8 h-8" />
            {tr("expenseClaims")}
          </h1>
          <p className="text-muted-foreground mt-1">{tr("submitTrackAndManageEmployeeExpense")}</p>
        </div>
      </div>

      {/* ─── Summary Cards ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("pendingThisMonth")}</CardTitle>
            <Clock className="w-4 h-4 text-[hsl(var(--chart-1))]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(pendingTotal, "AED", locale)}</div>
            <p className="text-xs text-muted-foreground">
              {summary?.thisMonth?.submitted?.count || 0} {tr("claimsAwaitingReview")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("approvedThisMonth")}</CardTitle>
            <CheckCircle className="w-4 h-4 text-[hsl(var(--chart-5))]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(approvedTotal, "AED", locale)}</div>
            <p className="text-xs text-muted-foreground">
              {summary?.thisMonth?.approved?.count || 0} {tr("claimsApproved")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("paidThisMonth")}</CardTitle>
            <DollarSign className="w-4 h-4 text-[hsl(var(--chart-3))]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(paidTotal, "AED", locale)}</div>
            <p className="text-xs text-muted-foreground">
              {summary?.thisMonth?.paid?.count || 0} {tr("claimsPaidOut")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Tabs ──────────────────────────────────────── */}
      <Tabs defaultValue="my-claims" className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-claims" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {tr("myClaims")}
          </TabsTrigger>
          <TabsTrigger value="review" className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            {tr("review")}
            {submittedClaims.length > 0 && (
              <StatusBadge tone="info" className="ms-1 text-xs px-1.5 py-0">
                {submittedClaims.length}
              </StatusBadge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all-claims" className="flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            {tr("allClaims")}
          </TabsTrigger>
        </TabsList>

        {/* ─── My Claims Tab ───────────────────────────── */}
        <TabsContent value="my-claims">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{tr("myExpenseClaims")}</CardTitle>
                  <CardDescription>{tr.plural("claimsSubmitted", myClaims.length)}</CardDescription>
                </div>
                <Button onClick={handleOpenCreateDialog} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {tr("newClaim")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingClaims ? (
                <TableSkeleton rows={4} columns={6} />
              ) : (
                <ClaimsTable
                  claims={myClaims}
                  emptyTitle={tr("noClaimsYet")}
                  emptyDescription={tr("submitYourFirstReimbursementToGet")}
                  emptyAction={{ label: tr("newClaim"), onClick: handleOpenCreateDialog }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Review Tab ──────────────────────────────── */}
        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle>{tr("claimsForReview")}</CardTitle>
              <CardDescription>
                {tr.plural("claimsPendingApproval", submittedClaims.length)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingClaims ? (
                <TableSkeleton rows={4} columns={6} />
              ) : (
                <ClaimsTable
                  claims={submittedClaims}
                  isReview
                  emptyTitle={tr("nothingToReview")}
                  emptyDescription={tr("thereAreNoExpenseClaimsAwaiting")}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── All Claims Tab ──────────────────────────── */}
        <TabsContent value="all-claims">
          <Card>
            <CardHeader>
              <CardTitle>{tr("allCompanyClaims")}</CardTitle>
              <CardDescription>
                {tr.plural("totalClaimsAcrossOrganization", allClaims.length)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingClaims ? (
                <TableSkeleton rows={6} columns={6} />
              ) : (
                <ClaimsTable
                  claims={allClaims}
                  emptyTitle={tr("noExpenseClaims")}
                  emptyDescription={tr("noOneInThisCompanyHas")}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Create/Edit Claim Dialog ────────────────────── */}
      <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingClaim ? tr("editExpenseClaim") : tr("newExpenseClaim")}
            </DialogTitle>
            <DialogDescription>
              {editingClaim
                ? tr("updateYourExpenseClaimDetailsAnd")
                : tr("createANewExpenseClaimWith")}
            </DialogDescription>
          </DialogHeader>

          <Form {...claimForm}>
            <form onSubmit={claimForm.handleSubmit(handleClaimSubmit)} className="space-y-6">
              {/* Claim details */}
              <div className="space-y-4">
                <FormField
                  control={claimForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("title2")}</FormLabel>
                      <FormControl>
                        <Input placeholder={tr("eGBusinessTripToDubai")} {...field} />
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
                      <FormLabel>{t.description || tr("description")}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={tr("optionalDescriptionOfTheExpenseClaim")}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Expense items */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{tr("expenseItems")}</h3>
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
                      })
                    }
                  >
                    <Plus className="w-4 h-4 me-1" />
                    {tr("addItem")}
                  </Button>
                </div>

                {fields.map((field, index) => (
                  <Card key={field.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-sm font-medium text-muted-foreground">
                        {tr("item", { value: index + 1 })}
                      </span>
                      {fields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          className="text-destructive hover:text-destructive h-6 w-6 p-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <FormField
                        control={claimForm.control}
                        name={`items.${index}.expense_date`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.date || tr("date")} *</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
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
                            <FormLabel>{tr("category")}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={tr("selectCategory")} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EXPENSE_CATEGORIES.map((cat) => (
                                  <SelectItem key={cat} value={cat}>
                                    {categoryLabel(cat)}
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
                            <FormLabel>{tr("merchant")}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={tr("eGEmiratesAirlines")}
                                {...field}
                                value={field.value || ""}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="mt-3">
                      <FormField
                        control={claimForm.control}
                        name={`items.${index}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.description || tr("description")} *</FormLabel>
                            <FormControl>
                              <Input placeholder={tr("describeTheExpense")} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <FormField
                        control={claimForm.control}
                        name={`items.${index}.amount`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.amount || tr("amount")} (AED) *</FormLabel>
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
                            <FormLabel>{tr("vatAmountAed")}</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={claimForm.control}
                        name={`items.${index}.receipt_url`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tr("receipt")}</FormLabel>
                            <FormControl>
                              <ReceiptUploadField
                                companyId={companyId}
                                value={field.value}
                                onChange={field.onChange}
                                locale={locale}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="mt-3">
                      <LineProjectFields
                        companyId={companyId ?? undefined}
                        projectId={claimForm.watch(`items.${index}.project_id`)}
                        isBillable={claimForm.watch(`items.${index}.is_billable`)}
                        testIdSuffix={`-${index}`}
                        onChange={({ projectId, isBillable }) => {
                          claimForm.setValue(`items.${index}.project_id`, projectId, { shouldDirty: true });
                          claimForm.setValue(`items.${index}.is_billable`, isBillable, { shouldDirty: true });
                        }}
                      />
                    </div>
                  </Card>
                ))}

                {claimForm.formState.errors.items?.message && (
                  <p className="text-sm text-destructive">
                    {resolveMessage(claimForm.formState.errors.items.message, tr.locale)}
                  </p>
                )}

                {/* Total */}
                <div className="flex justify-end">
                  <div className="text-end">
                    <span className="text-sm text-muted-foreground">{tr("claimTotal")}</span>
                    <span className="text-lg font-bold">
                      {formatCurrency(calculateItemsTotal(), "AED", locale)}
                    </span>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setClaimDialogOpen(false)}>
                  {t.cancel || tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={createClaimMutation.isPending || updateClaimMutation.isPending}
                >
                  {createClaimMutation.isPending || updateClaimMutation.isPending
                    ? t.loading || tr("loading")
                    : editingClaim
                      ? tr("updateClaim")
                      : tr("saveAsDraft")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── View Claim Dialog ───────────────────────────── */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("expenseClaimDetails")}</DialogTitle>
            <DialogDescription>
              {viewingClaim?.claim_number} - {viewingClaim?.title}
            </DialogDescription>
          </DialogHeader>

          {viewingClaim && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">{tr("status")}</span>
                  <div className="mt-1">{getStatusBadge(viewingClaim.status)}</div>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{tr("totalAmount")}</span>
                  <div className="mt-1 font-bold text-lg">
                    {formatCurrency(
                      parseFloat(String(viewingClaim.total_amount)) || 0,
                      viewingClaim.currency || "AED",
                      locale
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">{tr("created")}</span>
                  <div className="mt-1">
                    {viewingClaim.created_at
                      ? format(new Date(viewingClaim.created_at), "MMM dd, yyyy HH:mm")
                      : "-"}
                  </div>
                </div>
                {viewingClaim.submitted_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">{tr("submitted")}</span>
                    <div className="mt-1">
                      {format(new Date(viewingClaim.submitted_at), "MMM dd, yyyy HH:mm")}
                    </div>
                  </div>
                )}
                {viewingClaim.reviewed_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">{tr("reviewed")}</span>
                    <div className="mt-1">
                      {format(new Date(viewingClaim.reviewed_at), "MMM dd, yyyy HH:mm")}
                    </div>
                  </div>
                )}
                {viewingClaim.paid_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">{tr("paid")}</span>
                    <div className="mt-1">
                      {format(new Date(viewingClaim.paid_at), "MMM dd, yyyy HH:mm")}
                    </div>
                  </div>
                )}
              </div>

              {viewingClaim.description && (
                <div>
                  <span className="text-sm text-muted-foreground">{tr("description")}</span>
                  <p className="mt-1">{viewingClaim.description}</p>
                </div>
              )}

              {viewingClaim.review_notes && (
                <div>
                  <span className="text-sm text-muted-foreground">{tr("reviewNotes")}</span>
                  <p className="mt-1 text-sm bg-muted p-2 rounded">{viewingClaim.review_notes}</p>
                </div>
              )}

              {viewingClaim.payment_reference && (
                <div>
                  <span className="text-sm text-muted-foreground">{tr("paymentReference")}</span>
                  <p dir="ltr" className="mt-1 font-mono text-sm">
                    {viewingClaim.payment_reference}
                  </p>
                </div>
              )}

              {/* Items table */}
              {viewingClaim.items && viewingClaim.items.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">{tr("expenseItems")}</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.date || tr("date")}</TableHead>
                          <TableHead>{tr("category2")}</TableHead>
                          <TableHead>{t.description || tr("description")}</TableHead>
                          <TableHead>{tr("merchant")}</TableHead>
                          <TableHead className="text-end">{t.amount || tr("amount")}</TableHead>
                          <TableHead className="text-end">{tr("vat")}</TableHead>
                          <TableHead>{tr("receipt")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewingClaim.items.map((item, idx) => (
                          <TableRow key={item.id || idx}>
                            <TableCell className="whitespace-nowrap">
                              {item.expense_date
                                ? format(new Date(item.expense_date), "MMM dd, yyyy")
                                : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{categoryLabel(item.category)}</Badge>
                            </TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {item.merchant_name || "-"}
                            </TableCell>
                            <TableCell className="text-end font-mono">
                              {formatCurrency(parseFloat(String(item.amount)) || 0, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-end font-mono">
                              {formatCurrency(
                                parseFloat(String(item.vat_amount)) || 0,
                                "AED",
                                locale
                              )}
                            </TableCell>
                            <TableCell>
                              {item.receipt_url && item.id ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await downloadAuthenticatedFile(
                                        `/api/expense-claims/${viewingClaim.id}/items/${item.id}/receipt`,
                                        "receipt"
                                      );
                                    } catch (error: any) {
                                      toast({
                                        title: tr("downloadFailed"),
                                        description: error?.message,
                                        variant: "destructive",
                                      });
                                    }
                                  }}
                                >
                                  {tr("download")}
                                </Button>
                              ) : (
                                "-"
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? tr("approveClaim") : tr("rejectClaim")}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "approve"
                ? tr("addOptionalNotesAndApproveThis")
                : tr("pleaseProvideAReasonForRejecting")}
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
                      {tr("reviewNotes")} {reviewAction === "reject" ? "*" : ""}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={
                          reviewAction === "approve"
                            ? tr("optionalApprovalNotes")
                            : tr("reasonForRejectionRequired")
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
                  {t.cancel || tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  variant={reviewAction === "approve" ? "default" : "destructive"}
                  disabled={approveClaimMutation.isPending || rejectClaimMutation.isPending}
                >
                  {approveClaimMutation.isPending || rejectClaimMutation.isPending
                    ? t.loading || tr("loading")
                    : reviewAction === "approve"
                      ? tr("approve")
                      : tr("reject")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Payment Dialog ──────────────────────────────── */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("markAsPaid")}</DialogTitle>
            <DialogDescription>{tr("recordThePaymentDetailsForThis")}</DialogDescription>
          </DialogHeader>

          <Form {...paymentForm}>
            <form onSubmit={paymentForm.handleSubmit(handlePaymentSubmit)} className="space-y-4">
              <FormField
                control={paymentForm.control}
                name="payment_reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("paymentReference")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tr("eGBankTransferRefCheque")}
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <PaymentDateField
                value={paymentDate}
                onChange={setPaymentDate}
                testId="button-claim-payment-date"
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                  {t.cancel || tr("cancel")}
                </Button>
                <Button type="submit" disabled={markPaidMutation.isPending}>
                  {markPaidMutation.isPending ? t.loading || tr("loading") : tr("markAsPaid")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
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
            <AlertDialogTitle>{tr("deleteExpenseClaim")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("thisWillPermanentlyDeleteThisExpense")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (claimToDelete) {
                  deleteClaimMutation.mutate(claimToDelete);
                  setClaimToDelete(null);
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
