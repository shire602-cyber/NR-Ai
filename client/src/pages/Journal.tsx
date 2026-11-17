import { T } from "@/components/layout/T";
import {
  FormActions,
  FormErrorSummary,
  FormGrid,
  FormSection,
  lineLabelClass,
} from "@/components/ui/form-layout";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { Link } from "wouter";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { BooksStatusStrip } from "@/components/reports/BooksStatusStrip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Money, MoneyCell } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CardListSkeleton } from "@/components/ui/loading-skeletons";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatDate, formatNumber } from "@/lib/format";
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
  Ban,
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

/** Integer fils: balance is compared exactly, never with a 0.01 tolerance. */
const toFils = (v: unknown) => Math.round((Number(v) || 0) * 100);

const journalLineSchema = z.object({
  accountId: z.string().guid("forms.errors.accountRequired"),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
});

const journalSchema = z
  .object({
    companyId: z.string().guid(),
    date: z.date(),
    memo: z.string().optional(),
    lines: z.array(journalLineSchema).min(2, "forms.errors.twoLineItemsRequired"),
  })
  .refine(
    (data) => {
      const totalDebit = data.lines.reduce((sum, line) => sum + toFils(line.debit), 0);
      const totalCredit = data.lines.reduce((sum, line) => sum + toFils(line.credit), 0);
      return totalDebit === totalCredit;
    },
    {
      message: "forms.errors.debitsEqualCredits",
      path: ["lines"],
    }
  );

type JournalFormData = z.infer<typeof journalSchema>;

/** Body of POST /api/companies/:id/journal and PUT /api/journal/:id (strict on the server). */
interface JournalPayload {
  date: string;
  memo: string | null;
  lines: Array<{ accountId: string; debit: number; credit: number }>;
}

export default function Journal() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const { gate } = useCompanyPermission();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [reverseDate, setReverseDate] = useState("");
  const [reverseReason, setReverseReason] = useState("");

  const { data: accounts } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "accounts"],
    enabled: !!selectedCompanyId,
  });

  const { data: entries, isLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<JournalFormData>({
    resolver: zodResolver(journalSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      date: new Date(),
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
    mutationFn: (data: JournalPayload) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/journal`, data),
    onSuccess: (res: { status?: string; approvalStatus?: string | null }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast(
        res?.approvalStatus === "pending"
          ? { title: t["journal.sentForApproval"], description: t["journal.sentForApprovalBody"] }
          : { title: res?.status === "posted" ? t["journal.savedPosted"] : t["journal.savedDraft"] }
      );
      setDialogOpen(false);
      setEditingEntry(null);
      form.reset({
        companyId: selectedCompanyId,
        date: new Date(),
        memo: "",
        lines: [
          { accountId: "", debit: 0, credit: 0 },
          { accountId: "", debit: 0, credit: 0 },
        ],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to post entry",
        description: error?.message || "Please check that debits equal credits.",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: JournalPayload }) =>
      apiRequest("PUT", `/api/journal/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast({
        title: "Draft entry updated",
        description: "Your journal entry has been updated.",
      });
      setDialogOpen(false);
      setEditingEntry(null);
      form.reset({
        companyId: selectedCompanyId,
        date: new Date(),
        memo: "",
        lines: [
          { accountId: "", debit: 0, credit: 0 },
          { accountId: "", debit: 0, credit: 0 },
        ],
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update entry",
        description: error?.message || "Please check that debits equal credits.",
      });
    },
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/journal/${id}/post`, {}),
    onSuccess: (res: { code?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast(
        res?.code === "APPROVAL_REQUIRED"
          ? { title: t["journal.sentForApproval"], description: t["journal.sentForApprovalBody"] }
          : {
              title: "Entry posted",
              description: "Journal entry has been posted and is now immutable.",
            }
      );
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to post entry",
        description: error?.message,
      });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason, date }: { id: string; reason?: string; date?: string }) =>
      apiRequest("POST", `/api/journal/${id}/reverse`, {
        reason: reason || null,
        date: date || null,
      }),
    onSuccess: (data: { reversalNumber?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      setReverseDate("");
      setReverseReason("");
      toast({
        title: t["journal.reversedToast"],
        description: formatMessage(t["journal.reversedToastBody"], {
          number: data?.reversalNumber ?? "",
        }),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: t["journal.actionFailed"],
        description: error?.message,
      });
    },
  });

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiRequest("POST", `/api/journal/${id}/void`, { reason: reason || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      setReverseReason("");
      toast({ title: t["journal.voidedToast"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: t["journal.actionFailed"],
        description: error?.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/journal/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "journal"] });
      toast({
        title: "Draft entry deleted",
        description: "The draft journal entry has been deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to delete entry",
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
        date: new Date(fullEntry.date),
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
        title: "Error",
        description: error?.message || "Failed to load journal entry details.",
      });
    }
  };

  const onSubmit = (data: JournalFormData) => {
    if (!selectedCompanyId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Company not found. Please refresh the page.",
      });
      return;
    }

    // The server owns companyId (from the URL). Empty lines are dropped: the
    // ledger rejects zero-amount lines instead of storing them.
    const submitData: JournalPayload = {
      date: format(data.date, "yyyy-MM-dd"),
      memo: data.memo || null,
      lines: data.lines
        .filter((line) => toFils(line.debit) > 0 || toFils(line.credit) > 0)
        .map((line) => ({
          accountId: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
        })),
    };

    if (editingEntry) {
      editMutation.mutate({ id: editingEntry.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  // Calculate balance
  const watchLines = form.watch("lines");
  const totalDebitFils = watchLines.reduce((sum, line) => sum + toFils(line.debit), 0);
  const totalCreditFils = watchLines.reduce((sum, line) => sum + toFils(line.credit), 0);
  const totalDebit = totalDebitFils / 100;
  const totalCredit = totalCreditFils / 100;
  const isBalanced = totalDebitFils === totalCreditFils;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["journal.pageEyebrow"]}
        title={t.journal}
        description={t["journal.pageDescription"]}
        actions={
          <Button
            onClick={() => setDialogOpen(true)}
            data-testid="button-create-entry"
            {...gate("ledger.post")}
          >
            <Plus className="w-4 h-4" />
            {t.newEntry}
          </Button>
        }
      />
      {/* R3 (CTO 23): books-balanced / period-lock status on the ledger. */}
      <BooksStatusStrip companyId={selectedCompanyId} />
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingEntry(null);
            form.reset({
              companyId: selectedCompanyId,
              date: new Date(),
              memo: "",
              lines: [
                { accountId: "", debit: 0, credit: 0 },
                { accountId: "", debit: 0, credit: 0 },
              ],
            });
          }
        }}
      >
        <DialogContent size="lg" data-testid="dialog-journal-form">
          <DialogHeader>
            <DialogTitle>{editingEntry ? t["forms.journal.editTitle"] : t.newEntry}</DialogTitle>
            <DialogDescription>
              {editingEntry ? t["forms.journal.editDesc"] : t["forms.journal.newDesc"]}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
              <FormErrorSummary />
              <FormSection
                title={t["forms.section.entry"]}
                description={t["forms.section.entryDesc"]}
              >
                <FormGrid>
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
                  <FormField
                    control={form.control}
                    name="memo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.memo}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            dir="auto"
                            placeholder={t["forms.journal.memoPlaceholder"]}
                            data-testid="input-memo"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>

              <FormSection
                title={<T k="pageLabels.journalLines" />}
                description={t["forms.journal.linesDesc"]}
                actions={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ accountId: "", debit: 0, credit: 0 })}
                    data-testid="button-add-line"
                  >
                    <Plus className="h-4 w-4" />
                    <T k="pages.addLine" />
                  </Button>
                }
              >
                <div className="rounded-lg bg-surface-sunken/60">
                  <div
                    aria-hidden
                    className="hidden grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_2.25rem] gap-3 border-b border-border px-3 py-2 text-caption font-medium text-muted-foreground sm:grid"
                  >
                    <span>
                      <T k="consolidation.account" />
                    </span>
                    <span className="text-end">{t.debit}</span>
                    <span className="text-end">{t.credit}</span>
                    <span />
                  </div>
                  <ol className="divide-y divide-border px-3">
                    {fields.map((field, index) => (
                      <li
                        key={field.id}
                        className="mobile-keep-cols grid grid-cols-2 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_2.25rem] sm:items-start"
                      >
                        <FormField
                          control={form.control}
                          name={`lines.${index}.accountId`}
                          render={({ field }) => (
                            <FormItem className="col-span-2 sm:col-span-1">
                              <FormLabel className={cn(lineLabelClass, "sm:sr-only")}>
                                {formatMessage(t["forms.lineN"], { n: index + 1 })} ·{" "}
                                <T k="consolidation.account" />
                              </FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid={`select-account-${index}`}>
                                    <SelectValue placeholder={t["forms.journal.selectAccount"]} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {accounts?.map((acc: any) => (
                                    <SelectItem key={acc.id} value={acc.id}>
                                      <span className="me-2 inline-block tabular-nums text-muted-foreground">
                                        {acc.code}
                                      </span>
                                      {locale === "ar" && acc.nameAr ? acc.nameAr : acc.nameEn}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`lines.${index}.debit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className={cn(lineLabelClass, "sm:sr-only")}>
                                {t.debit}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  className="text-end"
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
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
                        <FormField
                          control={form.control}
                          name={`lines.${index}.credit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className={cn(lineLabelClass, "sm:sr-only")}>
                                {t.credit}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  className="text-end"
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
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
                        <div className="col-span-2 flex justify-end sm:col-span-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-danger"
                            disabled={fields.length <= 2}
                            aria-label={formatMessage(t["forms.removeLine"], { n: index + 1 })}
                            onClick={() => remove(index)}
                            data-testid={
                              fields.length > 2 ? `button-remove-line-${index}` : undefined
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="mobile-keep-cols grid grid-cols-2 gap-3 border-t border-border-strong px-3 py-3 text-sm font-semibold sm:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_2.25rem]">
                    <span className="col-span-2 text-muted-foreground sm:col-span-1">
                      {t["forms.preview.total"]}
                    </span>
                    <span className="text-end" data-testid="journal-total-debit">
                      <Money amount={totalDebit} currency="AED" />
                    </span>
                    <span className="text-end" data-testid="journal-total-credit">
                      <Money amount={totalCredit} currency="AED" />
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2" aria-live="polite">
                  {isBalanced ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                      <StatusBadge tone="success">{t.balanced}</StatusBadge>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-danger" aria-hidden />
                      <StatusBadge tone="danger">
                        {t.notBalanced} (
                        {formatNumber(Math.abs(totalDebitFils - totalCreditFils) / 100, locale)})
                      </StatusBadge>
                    </>
                  )}
                </div>
              </FormSection>

              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={!isBalanced || createMutation.isPending || editMutation.isPending}
                  data-testid="button-submit-entry"
                >
                  {createMutation.isPending || editMutation.isPending ? t["forms.saving"] : t.save}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <CardListSkeleton count={4} />
      ) : entries && entries.length > 0 ? (
        <VirtualList
          items={entries as any[]}
          estimateSize={220}
          height={Math.min(900, Math.max(600, (entries as any[]).length * 220))}
          getKey={(entry) => entry.id}
          className="space-y-4"
          renderItem={(entry: any) => {
            // lifecycleStatus is derived by the API: a reversed or voided
            // original keeps status "posted" (its reversal offsets it).
            const lifecycle: string = entry.lifecycleStatus ?? entry.status;
            const isPosted = lifecycle === "posted";
            const isDraft = lifecycle === "draft";
            const isVoid = lifecycle === "void";
            const isReversalEntry = entry.entryKind === "reversal";
            const canReverse = isPosted && !isReversalEntry;

            const getStatusBadge = () => {
              if (lifecycle === "reversed" || lifecycle === "voided") {
                return (
                  <StatusBadge tone="danger">
                    <RotateCcw className="w-3 h-3 me-1" />
                    {lifecycle === "voided"
                      ? t["journal.statusVoided"]
                      : t["journal.statusReversed"]}
                  </StatusBadge>
                );
              }
              if (isDraft && entry.approvalStatus === "pending") {
                return (
                  <StatusBadge tone="warning">
                    <FileText className="w-3 h-3 me-1" />
                    {t["journal.statusPendingApproval"]}
                  </StatusBadge>
                );
              }
              if (isPosted) {
                return (
                  <StatusBadge tone="success">
                    <Lock className="w-3 h-3 me-1" />
                    <T k="hr.status.posted" />
                  </StatusBadge>
                );
              } else if (isVoid) {
                return (
                  <StatusBadge tone="danger">
                    <XCircle className="w-3 h-3 me-1" />
                    {t["components.statusVoid"]}
                  </StatusBadge>
                );
              } else {
                return (
                  <StatusBadge tone="warning">
                    <FileText className="w-3 h-3 me-1" />
                    <T k="banking.statement.draft" />
                  </StatusBadge>
                );
              }
            };

            const getSourceBadge = () => {
              if (!entry.source || entry.source === "manual") return null;
              const sources: Record<string, { label: string; tone: StatusTone }> = {
                invoice: { label: t["screens.sourceInvoice"], tone: "neutral" },
                receipt: { label: t["screens.sourceReceipt"], tone: "neutral" },
                payment: { label: t["screens.sourcePayment"], tone: "neutral" },
                reversal: { label: t["journal.sourceReversal"], tone: "neutral" },
                journal_template: { label: t["journal.sourceTemplate"], tone: "neutral" },
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
              <Card key={entry.id} className={cn("mb-3", isVoid && "opacity-60")}>
                <CardContent className="p-4 sm:p-5">
                  <div className="mb-3 flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-x-2 text-caption text-muted-foreground">
                        {entry.entryNumber && (
                          <Link
                            href={`/journal/${entry.id}`}
                            dir="ltr"
                            className="min-h-0 whitespace-nowrap font-medium tabular-nums text-foreground [unicode-bidi:isolate] hover:underline"
                          >
                            {entry.entryNumber}
                          </Link>
                        )}
                        <span aria-hidden>·</span>
                        <span className="whitespace-nowrap">{formatDate(entry.date, locale)}</span>
                      </div>
                      {entry.memo && (
                        <div dir="auto" className="truncate text-sm font-medium text-foreground">
                          {entry.memo}
                        </div>
                      )}
                      {entry.reversedByEntry && (
                        <div
                          className="text-xs text-muted-foreground"
                          data-testid={`text-reversed-by-${entry.id}`}
                        >
                          <Link href={`/journal/${entry.reversedByEntry.id}`}>
                            {formatMessage(
                              lifecycle === "voided"
                                ? t["journal.voidedBy"]
                                : t["journal.reversedBy"],
                              { number: entry.reversedByEntry.entryNumber }
                            )}
                          </Link>
                        </div>
                      )}
                      {entry.reversalOfEntry && (
                        <div
                          className="text-xs text-muted-foreground"
                          data-testid={`text-reversal-of-${entry.id}`}
                        >
                          <Link href={`/journal/${entry.reversalOfEntry.id}`}>
                            {formatMessage(t["journal.reversalOf"], {
                              number: entry.reversalOfEntry.entryNumber,
                            })}
                          </Link>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {getStatusBadge()}
                      {getSourceBadge()}
                      <Button
                        asChild
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t["reportCenter.proof"]}
                        title={t["reportCenter.proof"]}
                        data-testid={`button-proof-journal-${entry.id}`}
                      >
                        <Link href={sourceProofHref}>
                          <FileText aria-hidden />
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
                            {...gate("ledger.post")}
                          >
                            <Send aria-hidden />
                            {t["screens.post"]}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={t.edit}
                            title={t.edit}
                            onClick={() => handleEditEntry(entry)}
                            data-testid={`button-edit-journal-${entry.id}`}
                          >
                            <Edit aria-hidden />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-destructive"
                                aria-label={t.delete}
                                title={t.delete}
                                data-testid={`button-delete-journal-${entry.id}`}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  <T k="pageLabels.deleteDraftEntry" />
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t["screens.deleteDraftEntryBody"]}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  <T k="pages.cancel" />
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(entry.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  <T k="hr.delete" />
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}

                      {canReverse && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label={t["journal.reverse"]}
                              data-testid={`button-reverse-journal-${entry.id}`}
                            >
                              <RotateCcw className="w-4 h-4" />
                              <span className="hidden sm:inline">{t["journal.reverse"]}</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t["journal.reverseTitle"]}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t["journal.reverseDescription"]}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <label className="text-sm font-medium">
                                  {t["journal.reversalDate"]}
                                </label>
                                <Input
                                  type="date"
                                  value={reverseDate}
                                  onChange={(e) => setReverseDate(e.target.value)}
                                  data-testid={`input-reversal-date-${entry.id}`}
                                />
                                <p className="text-xs text-muted-foreground">
                                  {t["journal.reversalDateHint"]}
                                </p>
                              </div>
                              <div className="space-y-1">
                                <label className="text-sm font-medium">{t["journal.reason"]}</label>
                                <Input
                                  value={reverseReason}
                                  onChange={(e) => setReverseReason(e.target.value)}
                                  data-testid={`input-reversal-reason-${entry.id}`}
                                />
                              </div>
                            </div>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                <T k="pages.cancel" />
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  reverseMutation.mutate({
                                    id: entry.id,
                                    reason: reverseReason,
                                    date: reverseDate,
                                  })
                                }
                              >
                                {t["journal.confirmReverse"]}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      {canReverse && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={t["journal.void"]}
                              title={t["journal.void"]}
                              data-testid={`button-void-journal-${entry.id}`}
                            >
                              <Ban aria-hidden />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t["journal.voidTitle"]}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t["journal.voidDescription"]}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                <T k="pages.cancel" />
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  voidMutation.mutate({ id: entry.id, reason: reverseReason })
                                }
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {t["journal.confirmVoid"]}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                  <JournalLinesTable lines={entry.lines ?? []} />
                </CardContent>
              </Card>
            );
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={BookMarked}
              title={t["journal.emptyTitle"]}
              description={t["journal.emptyDescription"]}
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
    </div>
  );
}

/**
 * Journal voucher lines (D3a): a compact table with account code + name, debit and credit
 * columns, and a totals row that states whether the entry balances (trust cue).
 */
function JournalLinesTable({
  lines,
}: {
  lines: Array<{
    debit: number | string;
    credit: number | string;
    account?: { code?: string; nameEn?: string; nameAr?: string | null } | null;
  }>;
}) {
  const { t, locale } = useTranslation();
  const debit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const credit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const balanced = Math.round(debit * 100) === Math.round(credit * 100);
  return (
    <div className="-mx-4 -mb-4 mt-3 overflow-hidden rounded-b-xl border-t border-border sm:-mx-5 sm:-mb-5">
      <Table density="compact" className="mobile-fit table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>{t["screens.account"]}</TableHead>
            <TableHead data-numeric="" className="w-[5.75rem] sm:w-32">
              {t["screens.debit"]}
            </TableHead>
            <TableHead data-numeric="" className="w-[5.75rem] sm:w-32">
              {t["screens.credit"]}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, idx) => (
            <TableRow key={idx}>
              <TableCell data-truncate="" className="max-w-none">
                <span
                  dir="ltr"
                  className="me-2 inline-block tabular-nums text-muted-foreground [unicode-bidi:isolate]"
                >
                  {line.account?.code}
                </span>
                <span dir="auto" className="[unicode-bidi:isolate]">
                  {locale === "ar" && line.account?.nameAr
                    ? line.account.nameAr
                    : line.account?.nameEn}
                </span>
              </TableCell>
              <TableCell data-numeric="">
                {Number(line.debit) > 0 ? (
                  <Money amount={Number(line.debit)} showCurrency={false} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell data-numeric="">
                {Number(line.credit) > 0 ? (
                  <Money amount={Number(line.credit)} showCurrency={false} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-caption font-medium",
                  balanced ? "text-success" : "text-danger"
                )}
              >
                {balanced ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                )}
                {balanced ? t.balanced : t["screens.notBalanced"]}
              </span>
            </TableCell>
            <MoneyCell amount={debit} showCurrency={false} />
            <MoneyCell amount={credit} showCurrency={false} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
