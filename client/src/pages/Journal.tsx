import { useState, useEffect } from "react";
import { accountName } from "@/lib/account-name";
import { pickerDate, parseYmd, todayYmd, formatCalendarDate } from "@/lib/calendar-date";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dubaiToday } from "@/lib/report-presets";
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
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CardListSkeleton, PageSkeleton } from "@/components/ui/loading-skeletons";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { localizeJournalText } from "@/lib/journal-text";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { evidenceSourceHref } from "@/lib/evidenceLinks";
import {
  Plus,
  BookMarked,
  CalendarIcon,
  CheckCircle2,
  XCircle,
  Trash2,
  Edit,
  RotateCcw,
  Lock,
  FileText,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { VirtualList } from "@/components/VirtualList";
import { ApprovalStatusBadge, approverRoleLabel } from "@/components/approvals/ApprovalStatusBadge";
import { messages as approvalMessages } from "@/components/approvals/ApprovalStatusBadge.i18n";
import { messages as approvalFeedbackMessages } from "@/lib/approval-feedback.i18n";
import { useApprovalProgress } from "@/hooks/useApprovalProgress";
import { useSubscription } from "@/hooks/useSubscription";
import { approvalFeedback, failureToast } from "@/lib/approval-feedback";
import { ApiError } from "@/lib/queryClient";
import { isPendingApprovalBody } from "@/lib/purchasing-hr";
import { ListPager } from "@/components/ListPager";
import { pageView } from "@/lib/list-paging";
import { messages as pageMessages } from "./Journal.i18n";

const journalLineSchema = z.object({
  accountId: z.string().uuid(pageMessages.marker("pleaseSelectAnAccount")),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
});

const journalSchema = z
  .object({
    companyId: z.string().uuid(),
    date: z.date(),
    memo: z.string().optional(),
    lines: z.array(journalLineSchema).min(2, pageMessages.marker("atLeastTwoLineItemsAre")),
  })
  .refine(
    (data) => {
      const totalDebit = data.lines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredit = data.lines.reduce((sum, line) => sum + line.credit, 0);
      return Math.abs(totalDebit - totalCredit) < 0.01;
    },
    {
      message: pageMessages.marker("totalDebitsMustEqualTotalCredits"),
      path: ["lines"],
    }
  );

type JournalFormData = z.infer<typeof journalSchema>;

const BACKDATED_CONFIRMATION_CODE = "BACKDATED_ENTRY_CONFIRMATION_REQUIRED";

function isBackdatedConfirmation(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null;
  return e?.status === 409 && e?.code === BACKDATED_CONFIRMATION_CODE;
}

// What created a non-manual entry, as a message key (the entry is undone where it was created).
const SYSTEM_SOURCE_LABEL_KEYS = {
  vat_filing: "sourceVatFiling",
  vat_payment: "sourceVatPayment",
  corporate_tax_filing: "sourceCorporateTaxFiling",
  corporate_tax_payment: "sourceCorporateTaxPayment",
  year_end_close: "sourceYearEndClose",
  year_end_close_reversal: "sourceYearEndClose",
  opening_balance: "sourceOpeningBalance",
  opening_balance_reversal: "sourceOpeningBalance",
  fx_revaluation: "sourceFxRevaluation",
  fx_revaluation_reversal: "sourceFxRevaluation",
  bill: "sourceBill",
  vendor_credit_fx: "sourceBill",
  expense_claim: "sourceExpenseClaim",
  expense_claim_payment: "sourceExpenseClaim",
  bank_reconciliation: "sourceBankReconciliation",
  vat_workpaper_row: "sourceVatWorkpaper",
  invoice: "sourceInvoice",
  inventory_cogs: "sourceInvoice", // stock cost posted by an invoice
  inventory_movement: "sourceInventory", // manual stock movement
  inventory_opening: "sourceInventory", // opening stock when inventory costing is switched on
  receipt: "sourceReceipt",
  payment: "sourcePayment",
  customer_refund: "sourceCustomerRefund",
  reversal: "sourceReversal",
} as const;

const getBackdatedCopy = () =>
  ({
    en: {
      title: pageMessages.t("postABackdatedEntry"),
      description: pageMessages.t("thisEntryIsDatedBeforeThe"),
      cancel: pageMessages.t("cancel"),
      confirm: pageMessages.t("postAnyway"),
    },
    ar: {
      title: "ترحيل قيد بتاريخ سابق؟",
      description:
        "هذا القيد مؤرخ قبل بداية السنة المالية الحالية وسيغيّر أرقام السنة السابقة. هل تريد الترحيل على أي حال؟",
      cancel: "إلغاء",
      confirm: "ترحيل على أي حال",
    },
  }) as const;

export default function Journal() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Date the reversal is posted on (a UAE calendar day, default today). Must fall in an open period: the server refuses otherwise.
  const [reverseDate, setReverseDate] = useState(() => dubaiToday());
  const [editingEntry, setEditingEntry] = useState<any>(null);
  // Set when the API answers 409 BACKDATED_ENTRY_CONFIRMATION_REQUIRED; holds
  // the submission to replay with `confirmBackdated: true` once confirmed.
  const [pendingBackdated, setPendingBackdated] = useState<
    | { kind: "create"; data: JournalFormData }
    | { kind: "edit"; id: string; data: JournalFormData }
    | null
  >(null);

  const { data: accounts } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts"],
    enabled: !!selectedCompanyId,
  });

  const { canAccess } = useSubscription();
  const { data: entries, isLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
    enabled: !!selectedCompanyId,
  });
  const [journalPage, setJournalPage] = useState(0);
  const [journalPageSize, setJournalPageSize] = useState<number>(25);
  const journalView = pageView(entries?.length ?? 0, journalPage, journalPageSize);
  const approvalProgress = useApprovalProgress(
    selectedCompanyId ?? undefined,
    "manual_journal",
    canAccess("approvals") &&
      (entries ?? []).some((e) => e.status === "draft" && (!e.source || e.source === "manual"))
  );

  const form = useForm<JournalFormData>({
    resolver: zodResolver(journalSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      date: parseYmd(todayYmd()),
      memo: "",
      lines: [
        { accountId: "", debit: 0, credit: 0 },
        { accountId: "", debit: 0, credit: 0 },
      ],
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
    mutationFn: (data: JournalFormData & { confirmBackdated?: boolean }) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/journal`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast({
        title: tr("journalEntryPosted"),
        description: tr("yourDoubleEntryJournalHasBeen"),
      });
      setDialogOpen(false);
      setEditingEntry(null);
      form.reset({
        companyId: selectedCompanyId,
        date: parseYmd(todayYmd()),
        memo: "",
        lines: [
          { accountId: "", debit: 0, credit: 0 },
          { accountId: "", debit: 0, credit: 0 },
        ],
      });
    },
    onError: (error: any, variables) => {
      if (isBackdatedConfirmation(error)) {
        setPendingBackdated({ kind: "create", data: variables });
        return;
      }
      const approval = approvalFeedback(error);
      toast(
        approval
          ? { variant: "destructive", ...approval }
          : {
              variant: "destructive",
              title: tr("failedToPostEntry"),
              description: error?.message || tr("pleaseCheckThatDebitsEqualCredits"),
            }
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: JournalFormData & { confirmBackdated?: boolean };
    }) => apiRequest("PUT", `/api/journal/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast({
        title: tr("draftEntryUpdated"),
        description: tr("yourJournalEntryHasBeenUpdated"),
      });
      setDialogOpen(false);
      setEditingEntry(null);
      form.reset({
        companyId: selectedCompanyId,
        date: parseYmd(todayYmd()),
        memo: "",
        lines: [
          { accountId: "", debit: 0, credit: 0 },
          { accountId: "", debit: 0, credit: 0 },
        ],
      });
    },
    onError: (error: any, variables) => {
      if (isBackdatedConfirmation(error)) {
        setPendingBackdated({ kind: "edit", id: variables.id, data: variables.data });
        return;
      }
      toast({
        variant: "destructive",
        title: tr("failedToUpdateEntry"),
        description: error?.message || tr("pleaseCheckThatDebitsEqualCredits"),
      });
    },
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/journal/${id}/post`),
    onSuccess: (body: unknown) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "approvals"],
      });
      if (isPendingApprovalBody(body)) {
        toast({
          title: approvalMessages.t("pendingApprovalSteps", {
            done: body.approval.completedSteps,
            total: body.approval.requiredSteps,
          }),
          description: body.approval.nextRole
            ? approvalMessages.t("nextRole", { role: approverRoleLabel(body.approval.nextRole) })
            : undefined,
        });
        return;
      }
      toast({
        title: tr("entryPosted"),
        description: tr("journalEntryHasBeenPostedAnd"),
      });
    },
    onError: (error: any) => {
      toast(failureToast(error, tr("failedToPostEntry")));
    },
  });

  const submitForApprovalMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/journal/${id}/submit-for-approval`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "approvals"],
      });
      toast({
        title: approvalFeedbackMessages.t("submittedTitle"),
        description: approvalFeedbackMessages.t("submittedBody"),
      });
    },
    onError: (error: unknown) => {
      const notRequired = error instanceof ApiError && error.code === "APPROVAL_NOT_REQUIRED";
      toast({
        variant: "destructive",
        title: approvalFeedbackMessages.t("submitFailed"),
        description: notRequired
          ? approvalFeedbackMessages.t("noRuleBody")
          : (error as Error)?.message,
      });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason, date }: { id: string; reason?: string; date?: string }) =>
      apiRequest("POST", `/api/journal/${id}/reverse`, { reason, ...(date ? { date } : {}) }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast({
        title: tr("entryReversed"),
        description: tr("reversalEntryCreatedOriginalEntryMarked", {
          reversalNumber: data.reversalNumber,
        }),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToReverseEntry"),
        description: error?.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/journal/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast({
        title: tr("draftEntryDeleted"),
        description: tr("theDraftJournalEntryHasBeen"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeleteEntry"),
        description: error?.message,
      });
    },
  });

  const handleEditEntry = async (entry: any) => {
    try {
      const fullEntry = await apiRequest("GET", `/api/journal/${entry.id}`);
      setEditingEntry(fullEntry);
      form.reset({
        companyId: fullEntry.companyId,
        date: pickerDate(fullEntry.date) as Date,
        memo: fullEntry.memo || "",
        lines: fullEntry.lines?.map((line: any) => ({
          accountId: line.accountId,
          debit: line.debit || 0,
          credit: line.credit || 0,
        })) || [
          { accountId: "", debit: 0, credit: 0 },
          { accountId: "", debit: 0, credit: 0 },
        ],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("error"),
        description: error?.message || tr("failedToLoadJournalEntryDetails"),
      });
    }
  };

  const onSubmit = (data: JournalFormData) => {
    if (!selectedCompanyId) {
      toast({
        variant: "destructive",
        title: tr("error"),
        description: tr("companyNotFoundPleaseRefreshThe"),
      });
      return;
    }

    // Convert numeric values to ensure proper storage
    const submitData = {
      ...data,
      companyId: selectedCompanyId,
      lines: data.lines.map((line) => ({
        ...line,
        debit: Number(line.debit),
        credit: Number(line.credit),
      })),
    };

    if (editingEntry) {
      editMutation.mutate({ id: editingEntry.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const backdatedCopy = getBackdatedCopy()[locale === "ar" ? "ar" : "en"];

  const confirmBackdatedPost = () => {
    const pending = pendingBackdated;
    setPendingBackdated(null);
    if (!pending) return;
    if (pending.kind === "create") {
      createMutation.mutate({ ...pending.data, confirmBackdated: true });
    } else {
      editMutation.mutate({ id: pending.id, data: { ...pending.data, confirmBackdated: true } });
    }
  };

  // Calculate balance
  const watchLines = form.watch("lines");
  const totalDebit = watchLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = watchLines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={tr("accounting")}
        title={t.journal}
        description={tr("doubleEntryJournalWithAutomaticBalance")}
        actions={
          <Button onClick={() => setDialogOpen(true)} data-testid="button-create-entry">
            <Plus className="w-4 h-4 me-2" />
            {t.newEntry}
          </Button>
        }
      />
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingEntry(null);
            form.reset({
              companyId: selectedCompanyId,
              date: parseYmd(todayYmd()),
              memo: "",
              lines: [
                { accountId: "", debit: 0, credit: 0 },
                { accountId: "", debit: 0, credit: 0 },
              ],
            });
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEntry ? tr("editJournalEntry") : t.newEntry}</DialogTitle>
            <DialogDescription>
              {editingEntry
                ? tr("updateJournalEntryDetails")
                : tr("createABalancedDoubleEntryJournal")}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
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
                                formatCalendarDate(field.value, locale)
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
                <FormField
                  control={form.control}
                  name="memo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.memo}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={tr("optionalDescription")}
                          data-testid="input-memo"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{tr("journalLines")}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ accountId: "", debit: 0, credit: 0 })}
                    data-testid="button-add-line"
                  >
                    <Plus className="w-4 h-4 me-2" />
                    {tr("addLine")}
                  </Button>
                </div>

                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground px-3 pb-2">
                  <div className="col-span-5">{tr("account")}</div>
                  <div className="col-span-3 text-end">{t.debit}</div>
                  <div className="col-span-3 text-end">{t.credit}</div>
                  <div className="col-span-1"></div>
                </div>

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md"
                  >
                    <div className="col-span-5">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.accountId`}
                        render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid={`select-account-${index}`}>
                                  <SelectValue placeholder={tr("selectAccount")} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {accounts?.map((acc: any) => (
                                  <SelectItem key={acc.id} value={acc.id}>
                                    <span dir="ltr" className="font-mono text-xs me-2">
                                      {acc.code}
                                    </span>
                                    {locale === "ar" && acc.nameAr ? acc.nameAr : acc.nameEn}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-3">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.debit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                className="font-mono text-end"
                                value={field.value ?? ""}
                                onChange={(e) =>
                                  field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                                }
                                data-testid={`input-debit-${index}`}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-3">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.credit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                className="font-mono text-end"
                                value={field.value ?? ""}
                                onChange={(e) =>
                                  field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                                }
                                data-testid={`input-credit-${index}`}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-1 flex items-center justify-center">
                      {fields.length > 2 && (
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
                  </div>
                ))}
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tr("total", { debit: t.debit })}</span>
                  <span dir="ltr" className="font-mono font-medium">
                    {formatNumber(totalDebit, locale)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {tr("total2", { credit: t.credit })}
                  </span>
                  <span dir="ltr" className="font-mono font-medium">
                    {formatNumber(totalCredit, locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-semibold">{t.balance}</span>
                  <div className="flex items-center gap-2">
                    {isBalanced ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-[hsl(var(--chart-5))]" />
                        <StatusBadge tone="success">{t.balanced}</StatusBadge>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-destructive" />
                        <StatusBadge tone="danger">
                          {t.notBalanced} (
                          {formatNumber(Math.abs(totalDebit - totalCredit), locale)})
                        </StatusBadge>
                      </>
                    )}
                  </div>
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
                  disabled={!isBalanced || createMutation.isPending || editMutation.isPending}
                  className="flex-1"
                  data-testid="button-submit-entry"
                >
                  {createMutation.isPending || editMutation.isPending ? t.loading : t.save}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <CardListSkeleton count={4} />
      ) : entries && entries.length > 0 ? (
        <>
          <ListPager
            view={journalView}
            pageSize={journalPageSize}
            cap={1000}
            testId="journal-pager"
            onPage={setJournalPage}
            onPageSize={(n) => {
              setJournalPageSize(n);
              setJournalPage(0);
            }}
          />
          <VirtualList
            items={(entries as any[]).slice(journalView.start, journalView.end)}
            estimateSize={220}
            threshold={100000}
            height={Math.min(900, Math.max(600, (entries as any[]).length * 220))}
            getKey={(entry) => entry.id}
            className="space-y-4"
            renderItem={(entry: any) => {
              const isPosted = entry.status === "posted";
              const isDraft = entry.status === "draft";
              const isVoid = entry.status === "void";
              // Only a journal typed in by a user is edited, deleted or reversed here. Entries posted by
              // invoices, payments, filings, the year-end close ... are undone where they were created.
              const isManual = !entry.source || entry.source === "manual";
              const systemSourceLabel = tr(
                (
                  SYSTEM_SOURCE_LABEL_KEYS as Record<
                    string,
                    (typeof SYSTEM_SOURCE_LABEL_KEYS)[keyof typeof SYSTEM_SOURCE_LABEL_KEYS]
                  >
                )[entry.source] ?? "sourceOther"
              );

              const approvalState = approvalProgress.get(entry.id);
              const getStatusBadge = () => {
                if (isPosted) {
                  return (
                    <StatusBadge tone="success">
                      <Lock className="w-3 h-3 me-1" />
                      {tr("posted")}
                    </StatusBadge>
                  );
                } else if (isVoid) {
                  return (
                    <StatusBadge tone="danger">
                      <XCircle className="w-3 h-3 me-1" />
                      {tr("void")}
                    </StatusBadge>
                  );
                } else {
                  if (approvalState) {
                    return (
                      <ApprovalStatusBadge
                        status="pending"
                        completedSteps={approvalState.completedSteps}
                        requiredSteps={approvalState.requiredSteps}
                      />
                    );
                  }
                  return (
                    <StatusBadge tone="warning">
                      <FileText className="w-3 h-3 me-1" />
                      {tr("draft")}
                    </StatusBadge>
                  );
                }
              };

              const getSourceBadge = () => {
                if (!entry.source || entry.source === "manual") return null;
                const sources: Record<string, { label: string; tone: StatusTone }> = {
                  invoice: { label: tr("invoice"), tone: "info" },
                  receipt: { label: tr("receipt"), tone: "accent" },
                  payment: { label: tr("payment"), tone: "success" },
                  reversal: { label: tr("reversal"), tone: "warning" },
                };
                const source = sources[entry.source];
                if (!source) return null;
                return <StatusBadge tone={source.tone}>{source.label}</StatusBadge>;
              };
              const sourceProofHref =
                entry.source && entry.source !== "manual" && entry.sourceId
                  ? evidenceSourceHref(entry.source, entry.sourceId)
                  : evidenceSourceHref("journal_entry", entry.id, "evidence-audit-trail");

              return (
                <Card key={entry.id} className={cn(isVoid && "opacity-60")}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                          {entry.entryNumber && (
                            <span dir="ltr" className="font-mono font-medium">
                              {entry.entryNumber}
                            </span>
                          )}
                          <span>{formatDate(entry.date, locale)}</span>
                        </div>
                        {entry.memo && (
                          <div className="font-medium">
                            {localizeJournalText(entry.memo, locale)}
                          </div>
                        )}
                        {!isManual && (
                          <div
                            className="text-xs text-muted-foreground mt-1"
                            data-testid={`text-system-entry-${entry.id}`}
                          >
                            {tr("createdBySource", { source: systemSourceLabel })}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {getStatusBadge()}
                        {getSourceBadge()}
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          data-testid={`button-proof-journal-${entry.id}`}
                        >
                          <Link href={sourceProofHref}>
                            <FileText className="w-4 h-4 me-2" />
                            {tr("proof")}
                          </Link>
                        </Button>

                        {isDraft && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => postMutation.mutate(entry.id)}
                              disabled={postMutation.isPending}
                              data-testid={`button-post-journal-${entry.id}`}
                            >
                              <Send className="w-4 h-4 me-2" />
                              {tr("post")}
                            </Button>
                            {isManual && !approvalState && canAccess("approvals") && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => submitForApprovalMutation.mutate(entry.id)}
                                disabled={submitForApprovalMutation.isPending}
                                data-testid={`button-submit-approval-${entry.id}`}
                              >
                                {approvalFeedbackMessages.t("submitForApproval")}
                              </Button>
                            )}
                            {isManual && !approvalState && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditEntry(entry)}
                                data-testid={`button-edit-journal-${entry.id}`}
                              >
                                <Edit className="w-4 h-4 me-2" />
                                {tr("edit")}
                              </Button>
                            )}
                            {isManual && !approvalState && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    data-testid={`button-delete-journal-${entry.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>{tr("deleteDraftEntry")}</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {tr("thisWillPermanentlyDeleteThisDraft")}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteMutation.mutate(entry.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      {tr("delete")}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </>
                        )}

                        {isPosted && isManual && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid={`button-reverse-journal-${entry.id}`}
                                onClick={() => setReverseDate(dubaiToday())}
                              >
                                <RotateCcw className="w-4 h-4 me-2" />
                                {tr("reverse")}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{tr("reverseJournalEntry")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {tr("thisWillCreateANewReversing")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <div className="space-y-1.5">
                                <label
                                  htmlFor={`reverse-date-${entry.id}`}
                                  className="text-sm font-medium"
                                >
                                  {tr("reversalDate")}
                                </label>
                                <Input
                                  id={`reverse-date-${entry.id}`}
                                  type="date"
                                  value={reverseDate}
                                  onChange={(e) => setReverseDate(e.target.value)}
                                  data-testid="input-reversal-date"
                                />
                                <p className="text-xs text-muted-foreground">
                                  {tr("reversalDateHint")}
                                </p>
                              </div>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() =>
                                    reverseMutation.mutate({
                                      id: entry.id,
                                      reason: tr("userRequestedReversal"),
                                      date: reverseDate,
                                    })
                                  }
                                >
                                  {tr("reverseEntry")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {entry.lines?.map((line: any, idx: number) => (
                        <div
                          key={idx}
                          className="grid grid-cols-12 gap-4 text-sm py-2 border-b last:border-0"
                        >
                          <div className="col-span-6 flex items-center gap-2">
                            <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                              {line.account?.code}
                            </span>
                            <span>{accountName(line.account, locale)}</span>
                          </div>
                          <div className="col-span-3 text-end font-mono">
                            {line.debit > 0 ? formatNumber(line.debit, locale) : "-"}
                          </div>
                          <div className="col-span-3 text-end font-mono">
                            {line.credit > 0 ? formatNumber(line.credit, locale) : "-"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            }}
          />
          <ListPager
            view={journalView}
            pageSize={journalPageSize}
            cap={1000}
            testId="journal-pager-bottom"
            onPage={setJournalPage}
            onPageSize={(n) => {
              setJournalPageSize(n);
              setJournalPage(0);
            }}
          />
        </>
      ) : (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={BookMarked}
              title={tr("noJournalEntriesYet")}
              description={tr("recordYourFirstManualJournalEntry")}
              action={{
                label: t.newEntry,
                icon: Plus,
                onClick: () => setDialogOpen(true),
                testId: "button-create-first-journal",
              }}
              testId="empty-state-journal"
            />
          </CardContent>
        </Card>
      )}
      <AlertDialog
        open={pendingBackdated !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBackdated(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-backdated-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{backdatedCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>{backdatedCopy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{backdatedCopy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBackdatedPost}
              data-testid="button-confirm-backdated"
            >
              {backdatedCopy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
