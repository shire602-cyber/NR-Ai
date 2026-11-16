import { T } from "@/components/layout/T";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { CardListSkeleton } from "@/components/ui/loading-skeletons";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
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
  accountId: z.string().uuid("Please select an account"),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
});

const journalSchema = z
  .object({
    companyId: z.string().uuid(),
    date: z.date(),
    memo: z.string().optional(),
    lines: z.array(journalLineSchema).min(2, "At least two line items are required"),
  })
  .refine(
    (data) => {
      const totalDebit = data.lines.reduce((sum, line) => sum + toFils(line.debit), 0);
      const totalCredit = data.lines.reduce((sum, line) => sum + toFils(line.credit), 0);
      return totalDebit === totalCredit;
    },
    {
      message: "Total debits must equal total credits",
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
    <div className="space-y-8">
      <PageHeader
        eyebrow={t["journal.pageEyebrow"]}
        title={t.journal}
        description={t["journal.pageDescription"]}
        actions={
          <Button onClick={() => setDialogOpen(true)} data-testid="button-create-entry">
            <Plus className="w-4 h-4 mr-2" />
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Edit Journal Entry" : t.newEntry}</DialogTitle>
            <DialogDescription>
              {editingEntry
                ? "Update journal entry details"
                : "Create a balanced double-entry journal entry"}
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
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                              data-testid="button-date-picker"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value ? (
                                format(field.value, "PPP")
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
                          placeholder="Optional description"
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
                  <h3 className="font-medium">
                    <T k="pageLabels.journalLines" />
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ accountId: "", debit: 0, credit: 0 })}
                    data-testid="button-add-line"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    <T k="pages.addLine" />
                  </Button>
                </div>

                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground px-3 pb-2">
                  <div className="col-span-5">
                    <T k="consolidation.account" />
                  </div>
                  <div className="col-span-3 text-right">{t.debit}</div>
                  <div className="col-span-3 text-right">{t.credit}</div>
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
                                  <SelectValue placeholder="Select account" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {accounts?.map((acc: any) => (
                                  <SelectItem key={acc.id} value={acc.id}>
                                    <span className="font-mono text-xs mr-2">{acc.code}</span>
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
                                className="font-mono text-right"
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
                                className="font-mono text-right"
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
                  <span className="text-muted-foreground">Total {t.debit}</span>
                  <span className="font-mono font-medium">{formatNumber(totalDebit, locale)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total {t.credit}</span>
                  <span className="font-mono font-medium">{formatNumber(totalCredit, locale)}</span>
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
                          {formatNumber(Math.abs(totalDebitFils - totalCreditFils) / 100, locale)})
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
                    <RotateCcw className="w-3 h-3 mr-1" />
                    {lifecycle === "voided"
                      ? t["journal.statusVoided"]
                      : t["journal.statusReversed"]}
                  </StatusBadge>
                );
              }
              if (isDraft && entry.approvalStatus === "pending") {
                return (
                  <StatusBadge tone="warning">
                    <FileText className="w-3 h-3 mr-1" />
                    {t["journal.statusPendingApproval"]}
                  </StatusBadge>
                );
              }
              if (isPosted) {
                return (
                  <StatusBadge tone="success">
                    <Lock className="w-3 h-3 mr-1" />
                    <T k="hr.status.posted" />
                  </StatusBadge>
                );
              } else if (isVoid) {
                return (
                  <StatusBadge tone="danger">
                    <XCircle className="w-3 h-3 mr-1" />
                    Void
                  </StatusBadge>
                );
              } else {
                return (
                  <StatusBadge tone="warning">
                    <FileText className="w-3 h-3 mr-1" />
                    <T k="banking.statement.draft" />
                  </StatusBadge>
                );
              }
            };

            const getSourceBadge = () => {
              if (!entry.source || entry.source === "manual") return null;
              const sources: Record<string, { label: string; tone: StatusTone }> = {
                invoice: { label: "Invoice", tone: "info" },
                receipt: { label: "Receipt", tone: "accent" },
                payment: { label: "Payment", tone: "success" },
                reversal: { label: t["journal.sourceReversal"], tone: "warning" },
                journal_template: { label: t["journal.sourceTemplate"], tone: "info" },
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
                          <span className="font-mono font-medium">{entry.entryNumber}</span>
                        )}
                        <span>{formatDate(entry.date, locale)}</span>
                      </div>
                      {entry.memo && <div className="font-medium">{entry.memo}</div>}
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
                          <FileText className="w-4 h-4 mr-2" />
                          <T k="reportCenter.proof" />
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
                            <Send className="w-4 h-4 mr-2" />
                            Post
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditEntry(entry)}
                            data-testid={`button-edit-journal-${entry.id}`}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
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
                                <AlertDialogTitle>
                                  <T k="pageLabels.deleteDraftEntry" />
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete this draft entry. This action cannot
                                  be undone.
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
                              data-testid={`button-reverse-journal-${entry.id}`}
                            >
                              <RotateCcw className="w-4 h-4 mr-2" />
                              {t["journal.reverse"]}
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
                              size="sm"
                              data-testid={`button-void-journal-${entry.id}`}
                            >
                              <Ban className="w-4 h-4 mr-2" />
                              {t["journal.void"]}
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
                  <div className="space-y-2">
                    {entry.lines?.map((line: any, idx: number) => (
                      <div
                        key={idx}
                        className="grid grid-cols-12 gap-4 text-sm py-2 border-b last:border-0"
                      >
                        <div className="col-span-6 flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {line.account?.code}
                          </span>
                          <span>{line.account?.nameEn}</span>
                        </div>
                        <div className="col-span-3 text-right font-mono">
                          {line.debit > 0 ? formatNumber(line.debit, locale) : "-"}
                        </div>
                        <div className="col-span-3 text-right font-mono">
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
