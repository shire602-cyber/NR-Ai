import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
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
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { getStoredUser } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';

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

const EXPENSE_CATEGORIES = [
  'Travel',
  'Meals',
  'Transport',
  'Accommodation',
  'Office Supplies',
  'Client Entertainment',
  'Telephone',
  'Internet',
  'Other',
] as const;

// ─── Schemas ──────────────────────────────────────────────

const expenseItemSchema = z.object({
  expense_date: z.string().min(1, 'Date is required'),
  category: z.string().min(1, 'Category is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  vat_amount: z.coerce.number().min(0, 'VAT amount must be >= 0'),
  merchant_name: z.string().optional().nullable(),
  receipt_url: z.string().optional().nullable(),
});

const claimFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  items: z.array(expenseItemSchema).min(1, 'At least one expense item is required'),
});

type ClaimFormData = z.infer<typeof claimFormSchema>;

const reviewFormSchema = z.object({
  review_notes: z.string().min(1, 'Review notes are required'),
});

type ReviewFormData = z.infer<typeof reviewFormSchema>;

const paymentFormSchema = z.object({
  payment_reference: z.string().optional().nullable(),
});

type PaymentFormData = z.infer<typeof paymentFormSchema>;

// ─── Component ────────────────────────────────────────────

export default function ExpenseClaims() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const currentUser = getStoredUser();

  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<ExpenseClaim | null>(null);
  const [viewingClaim, setViewingClaim] = useState<ExpenseClaim | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewClaimId, setReviewClaimId] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
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
    () => allClaims.filter((c) => c.status === 'submitted'),
    [allClaims]
  );

  const pendingTotal = summary?.thisMonth?.submitted?.total || 0;
  const approvedTotal = summary?.thisMonth?.approved?.total || 0;
  const paidTotal = summary?.thisMonth?.paid?.total || 0;

  // ─── Forms ────────────────────────────────────────────

  const claimForm = useForm<ClaimFormData>({
    resolver: zodResolver(claimFormSchema),
    defaultValues: {
      title: '',
      description: '',
      items: [
        {
          expense_date: format(new Date(), 'yyyy-MM-dd'),
          category: '',
          description: '',
          amount: 0,
          vat_amount: 0,
          merchant_name: '',
          receipt_url: '',
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: claimForm.control,
    name: 'items',
  });

  const reviewForm = useForm<ReviewFormData>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: { review_notes: '' },
  });

  const paymentForm = useForm<PaymentFormData>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: { payment_reference: '' },
  });

  // ─── Mutations ────────────────────────────────────────

  const createClaimMutation = useMutation({
    mutationFn: (data: ClaimFormData) =>
      apiRequest('POST', `/api/companies/${companyId}/expense-claims`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims/summary`] });
      toast({ title: 'Claim Created', description: 'Your expense claim has been created as a draft.' });
      setClaimDialogOpen(false);
      claimForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateClaimMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClaimFormData }) =>
      apiRequest('PATCH', `/api/expense-claims/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims/summary`] });
      toast({ title: 'Claim Updated', description: 'Your expense claim has been updated.' });
      setClaimDialogOpen(false);
      setEditingClaim(null);
      claimForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteClaimMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/expense-claims/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims/summary`] });
      toast({ title: 'Claim Deleted', description: 'The expense claim has been deleted.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const submitClaimMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/expense-claims/${id}/submit`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims/summary`] });
      toast({ title: 'Claim Submitted', description: 'Your expense claim has been submitted for review.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const approveClaimMutation = useMutation({
    mutationFn: ({ id, review_notes }: { id: string; review_notes?: string }) =>
      apiRequest('POST', `/api/expense-claims/${id}/approve`, { review_notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims/summary`] });
      toast({ title: 'Claim Approved', description: 'The expense claim has been approved.' });
      setReviewDialogOpen(false);
      reviewForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const rejectClaimMutation = useMutation({
    mutationFn: ({ id, review_notes }: { id: string; review_notes: string }) =>
      apiRequest('POST', `/api/expense-claims/${id}/reject`, { review_notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims/summary`] });
      toast({ title: 'Claim Rejected', description: 'The expense claim has been rejected.' });
      setReviewDialogOpen(false);
      reviewForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: ({ id, payment_reference }: { id: string; payment_reference?: string | null }) =>
      apiRequest('POST', `/api/expense-claims/${id}/mark-paid`, { payment_reference }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/expense-claims/summary`] });
      toast({ title: 'Claim Paid', description: 'The expense claim has been marked as paid.' });
      setPaymentDialogOpen(false);
      paymentForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingClaim(null);
    claimForm.reset({
      title: '',
      description: '',
      items: [
        {
          expense_date: format(new Date(), 'yyyy-MM-dd'),
          category: '',
          description: '',
          amount: 0,
          vat_amount: 0,
          merchant_name: '',
          receipt_url: '',
        },
      ],
    });
    setClaimDialogOpen(true);
  };

  const handleOpenEditDialog = async (claim: ExpenseClaim) => {
    try {
      const fullClaim = await apiRequest('GET', `/api/expense-claims/${claim.id}`);
      setEditingClaim(fullClaim);
      claimForm.reset({
        title: fullClaim.title,
        description: fullClaim.description || '',
        items:
          fullClaim.items && fullClaim.items.length > 0
            ? fullClaim.items.map((item: ExpenseClaimItem) => ({
                expense_date: item.expense_date
                  ? format(new Date(item.expense_date), 'yyyy-MM-dd')
                  : '',
                category: item.category,
                description: item.description,
                amount: parseFloat(String(item.amount)),
                vat_amount: parseFloat(String(item.vat_amount)) || 0,
                merchant_name: item.merchant_name || '',
                receipt_url: item.receipt_url || '',
              }))
            : [
                {
                  expense_date: format(new Date(), 'yyyy-MM-dd'),
                  category: '',
                  description: '',
                  amount: 0,
                  vat_amount: 0,
                  merchant_name: '',
                  receipt_url: '',
                },
              ],
      });
      setClaimDialogOpen(true);
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    }
  };

  const handleViewClaim = async (claim: ExpenseClaim) => {
    try {
      const fullClaim = await apiRequest('GET', `/api/expense-claims/${claim.id}`);
      setViewingClaim(fullClaim);
      setViewDialogOpen(true);
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    }
  };

  const handleClaimSubmit = (data: ClaimFormData) => {
    if (editingClaim) {
      updateClaimMutation.mutate({ id: editingClaim.id, data });
    } else {
      createClaimMutation.mutate(data);
    }
  };

  const handleOpenReviewDialog = (claimId: string, action: 'approve' | 'reject') => {
    setReviewClaimId(claimId);
    setReviewAction(action);
    reviewForm.reset({ review_notes: '' });
    setReviewDialogOpen(true);
  };

  const handleReviewSubmit = (data: ReviewFormData) => {
    if (!reviewClaimId) return;
    if (reviewAction === 'approve') {
      approveClaimMutation.mutate({ id: reviewClaimId, review_notes: data.review_notes });
    } else {
      rejectClaimMutation.mutate({ id: reviewClaimId, review_notes: data.review_notes });
    }
  };

  const handleOpenPaymentDialog = (claimId: string) => {
    setPaymentClaimId(claimId);
    paymentForm.reset({ payment_reference: '' });
    setPaymentDialogOpen(true);
  };

  const handlePaymentSubmit = (data: PaymentFormData) => {
    if (!paymentClaimId) return;
    markPaidMutation.mutate({ id: paymentClaimId, payment_reference: data.payment_reference });
  };

  // ─── Helpers ──────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="secondary" className="bg-gray-100 text-gray-800 hover:bg-gray-100">Draft</Badge>;
      case 'submitted':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Submitted</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      case 'paid':
        return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Paid</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const calculateItemsTotal = () => {
    const items = claimForm.watch('items');
    return items.reduce((sum, item) => sum + (Number(item.amount) || 0) + (Number(item.vat_amount) || 0), 0);
  };

  // ─── Loading State ────────────────────────────────────

  if (isLoadingCompany) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t.loading || 'Loading...'}</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Please create a company first.</div>
      </div>
    );
  }

  // ─── Claims Table Component ───────────────────────────

  const ClaimsTable = ({ claims, showActions = true, isReview = false }: {
    claims: ExpenseClaim[];
    showActions?: boolean;
    isReview?: boolean;
  }) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Claim #</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>{t.date || 'Date'}</TableHead>
            <TableHead className="text-right">{t.amount || 'Amount'}</TableHead>
            <TableHead>{t.status || 'Status'}</TableHead>
            {showActions && <TableHead className="text-right">{t.actions || 'Actions'}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showActions ? 6 : 5} className="text-center py-8 text-muted-foreground">
                No expense claims found.
              </TableCell>
            </TableRow>
          ) : (
            claims.map((claim) => (
              <TableRow key={claim.id}>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {claim.claim_number}
                </TableCell>
                <TableCell className="font-medium">{claim.title}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {claim.created_at ? format(new Date(claim.created_at), 'MMM dd, yyyy') : '-'}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(parseFloat(String(claim.total_amount)) || 0, claim.currency || 'AED', locale)}
                </TableCell>
                <TableCell>{getStatusBadge(claim.status)}</TableCell>
                {showActions && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewClaim(claim)}
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {!isReview && claim.status === 'draft' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEditDialog(claim)}
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => submitClaimMutation.mutate(claim.id)}
                            title="Submit for Review"
                            className="text-blue-600 hover:text-blue-700"
                          >
                            <Send className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteClaimMutation.mutate(claim.id)}
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {isReview && claim.status === 'submitted' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReviewDialog(claim.id, 'approve')}
                            title="Approve"
                            className="text-green-600 hover:text-green-700"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReviewDialog(claim.id, 'reject')}
                            title="Reject"
                            className="text-red-600 hover:text-red-700"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {claim.status === 'approved' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenPaymentDialog(claim.id)}
                          title="Mark as Paid"
                          className="text-purple-600 hover:text-purple-700"
                        >
                          <CreditCard className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Receipt className="w-8 h-8" />
            Expense Claims
          </h1>
          <p className="text-muted-foreground mt-1">
            Submit, track, and manage employee expense reimbursements
          </p>
        </div>
      </div>

      {/* ─── Summary Cards ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending This Month</CardTitle>
            <Clock className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(pendingTotal, 'AED', locale)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary?.thisMonth?.submitted?.count || 0} claims awaiting review
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved This Month</CardTitle>
            <CheckCircle className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(approvedTotal, 'AED', locale)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary?.thisMonth?.approved?.count || 0} claims approved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paid This Month</CardTitle>
            <DollarSign className="w-4 h-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(paidTotal, 'AED', locale)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary?.thisMonth?.paid?.count || 0} claims paid out
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Tabs ──────────────────────────────────────── */}
      <Tabs defaultValue="my-claims" className="space-y-4">
        <TabsList>
          <TabsTrigger value="my-claims" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            My Claims
          </TabsTrigger>
          <TabsTrigger value="review" className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Review
            {submittedClaims.length > 0 && (
              <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-800 text-xs px-1.5 py-0">
                {submittedClaims.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all-claims" className="flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            All Claims
          </TabsTrigger>
        </TabsList>

        {/* ─── My Claims Tab ───────────────────────────── */}
        <TabsContent value="my-claims">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>My Expense Claims</CardTitle>
                  <CardDescription>
                    {myClaims.length} claim{myClaims.length !== 1 ? 's' : ''} submitted
                  </CardDescription>
                </div>
                <Button onClick={handleOpenCreateDialog} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  New Claim
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingClaims ? (
                <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
              ) : (
                <ClaimsTable claims={myClaims} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Review Tab ──────────────────────────────── */}
        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle>Claims for Review</CardTitle>
              <CardDescription>
                {submittedClaims.length} claim{submittedClaims.length !== 1 ? 's' : ''} pending approval
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingClaims ? (
                <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
              ) : (
                <ClaimsTable claims={submittedClaims} isReview />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── All Claims Tab ──────────────────────────── */}
        <TabsContent value="all-claims">
          <Card>
            <CardHeader>
              <CardTitle>All Company Claims</CardTitle>
              <CardDescription>
                {allClaims.length} total claim{allClaims.length !== 1 ? 's' : ''} across the organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingClaims ? (
                <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
              ) : (
                <ClaimsTable claims={allClaims} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Create/Edit Claim Dialog ────────────────────── */}
      <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingClaim ? 'Edit Expense Claim' : 'New Expense Claim'}</DialogTitle>
            <DialogDescription>
              {editingClaim
                ? 'Update your expense claim details and items.'
                : 'Create a new expense claim with your expense items. You can save as draft and submit later.'}
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
                      <FormLabel>Title *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Business trip to Dubai - March 2026" {...field} />
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
                      <FormLabel>{t.description || 'Description'}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Optional description of the expense claim"
                          {...field}
                          value={field.value || ''}
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
                  <h3 className="text-lg font-semibold">Expense Items</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({
                        expense_date: format(new Date(), 'yyyy-MM-dd'),
                        category: '',
                        description: '',
                        amount: 0,
                        vat_amount: 0,
                        merchant_name: '',
                        receipt_url: '',
                      })
                    }
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Item
                  </Button>
                </div>

                {fields.map((field, index) => (
                  <Card key={field.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-sm font-medium text-muted-foreground">
                        Item {index + 1}
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
                            <FormLabel>{t.date || 'Date'} *</FormLabel>
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
                            <FormLabel>Category *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EXPENSE_CATEGORIES.map((cat) => (
                                  <SelectItem key={cat} value={cat}>
                                    {cat}
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
                            <FormLabel>Merchant</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., Emirates Airlines" {...field} value={field.value || ''} />
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
                            <FormLabel>{t.description || 'Description'} *</FormLabel>
                            <FormControl>
                              <Input placeholder="Describe the expense" {...field} />
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
                            <FormLabel>{t.amount || 'Amount'} (AED) *</FormLabel>
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
                            <FormLabel>VAT Amount (AED)</FormLabel>
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
                            <FormLabel>Receipt</FormLabel>
                            <FormControl>
                              <Input placeholder="Receipt URL (upload coming soon)" {...field} value={field.value || ''} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </Card>
                ))}

                {claimForm.formState.errors.items?.message && (
                  <p className="text-sm text-destructive">{claimForm.formState.errors.items.message}</p>
                )}

                {/* Total */}
                <div className="flex justify-end">
                  <div className="text-right">
                    <span className="text-sm text-muted-foreground">Claim Total: </span>
                    <span className="text-lg font-bold">
                      {formatCurrency(calculateItemsTotal(), 'AED', locale)}
                    </span>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setClaimDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  disabled={createClaimMutation.isPending || updateClaimMutation.isPending}
                >
                  {(createClaimMutation.isPending || updateClaimMutation.isPending)
                    ? (t.loading || 'Loading...')
                    : editingClaim
                      ? 'Update Claim'
                      : 'Save as Draft'}
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
            <DialogTitle>Expense Claim Details</DialogTitle>
            <DialogDescription>
              {viewingClaim?.claim_number} - {viewingClaim?.title}
            </DialogDescription>
          </DialogHeader>

          {viewingClaim && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">Status</span>
                  <div className="mt-1">{getStatusBadge(viewingClaim.status)}</div>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Total Amount</span>
                  <div className="mt-1 font-bold text-lg">
                    {formatCurrency(
                      parseFloat(String(viewingClaim.total_amount)) || 0,
                      viewingClaim.currency || 'AED',
                      locale
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Created</span>
                  <div className="mt-1">
                    {viewingClaim.created_at
                      ? format(new Date(viewingClaim.created_at), 'MMM dd, yyyy HH:mm')
                      : '-'}
                  </div>
                </div>
                {viewingClaim.submitted_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">Submitted</span>
                    <div className="mt-1">
                      {format(new Date(viewingClaim.submitted_at), 'MMM dd, yyyy HH:mm')}
                    </div>
                  </div>
                )}
                {viewingClaim.reviewed_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">Reviewed</span>
                    <div className="mt-1">
                      {format(new Date(viewingClaim.reviewed_at), 'MMM dd, yyyy HH:mm')}
                    </div>
                  </div>
                )}
                {viewingClaim.paid_at && (
                  <div>
                    <span className="text-sm text-muted-foreground">Paid</span>
                    <div className="mt-1">
                      {format(new Date(viewingClaim.paid_at), 'MMM dd, yyyy HH:mm')}
                    </div>
                  </div>
                )}
              </div>

              {viewingClaim.description && (
                <div>
                  <span className="text-sm text-muted-foreground">Description</span>
                  <p className="mt-1">{viewingClaim.description}</p>
                </div>
              )}

              {viewingClaim.review_notes && (
                <div>
                  <span className="text-sm text-muted-foreground">Review Notes</span>
                  <p className="mt-1 text-sm bg-muted p-2 rounded">{viewingClaim.review_notes}</p>
                </div>
              )}

              {viewingClaim.payment_reference && (
                <div>
                  <span className="text-sm text-muted-foreground">Payment Reference</span>
                  <p className="mt-1 font-mono text-sm">{viewingClaim.payment_reference}</p>
                </div>
              )}

              {/* Items table */}
              {viewingClaim.items && viewingClaim.items.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Expense Items</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.date || 'Date'}</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>{t.description || 'Description'}</TableHead>
                          <TableHead>Merchant</TableHead>
                          <TableHead className="text-right">{t.amount || 'Amount'}</TableHead>
                          <TableHead className="text-right">VAT</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewingClaim.items.map((item, idx) => (
                          <TableRow key={item.id || idx}>
                            <TableCell className="whitespace-nowrap">
                              {item.expense_date
                                ? format(new Date(item.expense_date), 'MMM dd, yyyy')
                                : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{item.category}</Badge>
                            </TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {item.merchant_name || '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(parseFloat(String(item.amount)) || 0, 'AED', locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(parseFloat(String(item.vat_amount)) || 0, 'AED', locale)}
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
              {reviewAction === 'approve' ? 'Approve Claim' : 'Reject Claim'}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === 'approve'
                ? 'Add optional notes and approve this expense claim.'
                : 'Please provide a reason for rejecting this expense claim.'}
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
                      Review Notes {reviewAction === 'reject' ? '*' : ''}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={
                          reviewAction === 'approve'
                            ? 'Optional approval notes'
                            : 'Reason for rejection (required)'
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
                  {t.cancel || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  variant={reviewAction === 'approve' ? 'default' : 'destructive'}
                  disabled={approveClaimMutation.isPending || rejectClaimMutation.isPending}
                >
                  {(approveClaimMutation.isPending || rejectClaimMutation.isPending)
                    ? (t.loading || 'Loading...')
                    : reviewAction === 'approve'
                      ? 'Approve'
                      : 'Reject'}
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
            <DialogTitle>Mark as Paid</DialogTitle>
            <DialogDescription>
              Record the payment details for this approved expense claim.
            </DialogDescription>
          </DialogHeader>

          <Form {...paymentForm}>
            <form onSubmit={paymentForm.handleSubmit(handlePaymentSubmit)} className="space-y-4">
              <FormField
                control={paymentForm.control}
                name="payment_reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Reference</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Bank transfer ref, cheque number"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  disabled={markPaidMutation.isPending}
                >
                  {markPaidMutation.isPending
                    ? (t.loading || 'Loading...')
                    : 'Mark as Paid'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
