import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { T } from "@/components/layout/T";
import { FormActions, FormErrorSummary } from "@/components/ui/form-layout";
import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { DataTableCard } from "@/components/ui/data-table";
import { MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { Link } from "wouter";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, CalendarIcon, Trash2, Download, FileText, Loader2, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

const creditNoteLineSchema = z.object({
  description: z.string().min(1, "forms.errors.descriptionRequired"),
  quantity: z.coerce.number().min(0.01, "forms.errors.quantityPositive"),
  unitPrice: z.coerce.number().min(0, "forms.errors.pricePositive"),
  vatRate: z.coerce.number().default(0.05),
});

const creditNoteSchema = z.object({
  companyId: z.string().guid(),
  number: z.string().min(1, "forms.errors.creditNoteNumberRequired"),
  invoiceId: z.string().optional(),
  customerName: z.string().min(1, "forms.errors.customerNameRequired"),
  customerTrn: z.string().optional(),
  date: z.date(),
  reason: z.string().min(1, "forms.errors.reasonRequired"),
  // S1 (W4-B): product lines go back into stock (default) or are written off.
  restock: z.boolean().default(true),
  lines: z.array(creditNoteLineSchema).min(1, "forms.errors.lineItemRequired"),
});

type CreditNoteFormData = z.infer<typeof creditNoteSchema>;

interface CreditNote {
  id: string;
  companyId: string;
  number: string;
  invoiceId?: string;
  invoiceNumber?: string;
  customerName: string;
  customerTrn?: string;
  date: string;
  reason: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string;
  status: string;
}

interface Invoice {
  id: string;
  number: string;
  customerName: string;
}

export default function CreditNotes() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company: _company, companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCreditNote, setEditingCreditNote] = useState<CreditNote | null>(null);

  const { data: creditNotes, isLoading } = useQuery<CreditNote[]>({
    queryKey: ["/api/companies", selectedCompanyId, "credit-notes"],
    enabled: !!selectedCompanyId,
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    // R20-05: the list endpoint paginates by default; the picker needs every invoice.
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/invoices?all=true`),
    enabled: !!selectedCompanyId,
  });

  const form = useForm<CreditNoteFormData>({
    resolver: zodResolver(creditNoteSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      number: `CN-${Date.now()}`,
      invoiceId: "",
      customerName: "",
      customerTrn: "",
      date: new Date(),
      reason: "",
      restock: true,
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    },
  });

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
    // R03-21: standalone credit notes are created as drafts against an issued
    // invoice (strict contract: no number / companyId / customer fields).
    mutationFn: (data: CreditNoteFormData) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/credit-notes`, {
        invoiceId: data.invoiceId,
        reason: data.reason,
        restock: data.restock !== false,
        date: data.date.toISOString().slice(0, 10),
        lines: data.lines.map((l) => {
          const vat = Number(l.vatRate) > 0 ? 0.05 : 0;
          return {
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: Math.round(Number(l.unitPrice) * 100) / 100,
            vatRate: vat,
            vatSupplyType: vat > 0 ? "standard_rated" : "zero_rated",
          };
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "credit-notes"],
      });
      toast({
        title: "Credit note created",
        description: "Your credit note has been created successfully.",
      });
      setDialogOpen(false);
      setEditingCreditNote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create credit note",
        description: error?.message || "Please try again.",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreditNoteFormData }) =>
      apiRequest("PUT", `/api/credit-notes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "credit-notes"],
      });
      toast({
        title: "Credit note updated",
        description: "Your credit note has been updated successfully.",
      });
      setDialogOpen(false);
      setEditingCreditNote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update credit note",
        description: error?.message || "Please try again.",
      });
    },
  });

  // R03-21: issue posts the mirrored reversal through the ledger kernel; void
  // reverses it and restores the invoice balance; drafts can be deleted.
  const lifecycleMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "issue" | "void" | "delete" }) =>
      action === "delete"
        ? apiRequest("DELETE", `/api/credit-notes/${id}`)
        : apiRequest("POST", `/api/credit-notes/${id}/${action}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "credit-notes"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: t["invoices.error"], description: error?.message });
    },
  });

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId || "",
      number: `CN-${Date.now()}`,
      invoiceId: "",
      customerName: "",
      customerTrn: "",
      date: new Date(),
      reason: "",
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditingCreditNote(null);
  };

  const _handleEditCreditNote = async (creditNote: CreditNote) => {
    try {
      const full = await apiRequest("GET", `/api/credit-notes/${creditNote.id}`);
      setEditingCreditNote(full);
      form.reset({
        companyId: full.companyId,
        number: full.number,
        invoiceId: full.invoiceId || "",
        customerName: full.customerName,
        customerTrn: full.customerTrn || "",
        date: new Date(full.date),
        reason: full.reason || "",
        lines: full.lines || [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to load credit note details.",
      });
    }
  };

  const onSubmit = async (data: CreditNoteFormData) => {
    const noteData = {
      ...data,
      companyId: selectedCompanyId!,
      lines: fields.map((_, index) => ({
        description: data.lines[index].description,
        quantity: Number(data.lines[index].quantity),
        unitPrice: Number(data.lines[index].unitPrice),
        vatRate: Number(data.lines[index].vatRate),
      })),
    };

    if (editingCreditNote) {
      editMutation.mutate({ id: editingCreditNote.id, data: noteData });
    } else {
      createMutation.mutate(noteData);
    }
  };

  const watchLines = form.watch("lines");
  const subtotal = watchLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const vatAmount = watchLines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice * line.vatRate,
    0
  );
  const total = subtotal + vatAmount;

  if (subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccess("creditNotes")) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <UpgradePrompt
          feature="creditNotes"
          requiredTier={getRequiredTier("creditNotes")}
          description={t["creditNotes.issueCreditNotesAgainstInvoices"]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title={t.creditNotes}
        description={(t as any).creditNotesSubtitle ?? t["creditNotes.viewCreditNotesCreatedFrom"]}
        actions={
          <Button asChild title={t["screens.creditNoteFromInvoiceHint"]}>
            <Link href="/invoices">
              <Plus aria-hidden />
              <T k="pages.createFromInvoice" />
            </Link>
          </Button>
        }
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {editingCreditNote ? t["screens.editCreditNote"] : t["screens.newCreditNote"]}
            </DialogTitle>
            <DialogDescription>
              {editingCreditNote ? t["forms.creditNote.editDesc"] : t["forms.creditNote.newDesc"]}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
              <FormErrorSummary />
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.creditNoteNumber" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="invoiceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.relatedInvoice" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t["screens.selectInvoiceOptional"]} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {invoices.map((inv: Invoice) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.number} - {inv.customerName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="customerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.customerName" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="customerTrn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.customerTrn" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t["screens.optional"]} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
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
                            >
                              <CalendarIcon className="h-4 w-4" />
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
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.reason" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t["screens.creditNoteReason"]} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="restock"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div className="space-y-1">
                        <FormLabel>
                          <T k="pages.creditNoteRestock" />
                        </FormLabel>
                        <p className="text-xs text-muted-foreground">
                          <T k="pages.creditNoteRestockHint" />
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value !== false}
                          onCheckedChange={field.onChange}
                          data-testid="switch-credit-note-restock"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

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
                      append({ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 })
                    }
                  >
                    <Plus className="w-4 h-4" />
                    <T k="pages.addLine" />
                  </Button>
                </div>

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md"
                  >
                    <div className="col-span-4">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.description`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input {...field} placeholder={t.description} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder={t["screens.qty"]}
                                value={field.value ?? ""}
                                onChange={(e) =>
                                  field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                                }
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.unitPrice`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder={t["screens.price"]}
                                value={field.value ?? ""}
                                onChange={(e) =>
                                  field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                                }
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-2">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.vatRate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Select
                                value={String(field.value * 100)}
                                onValueChange={(val) => field.onChange(parseFloat(val) / 100)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">0%</SelectItem>
                                  <SelectItem value="5">5%</SelectItem>
                                  <SelectItem value="10">10%</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="col-span-1">
                      <div className="h-10 flex items-center justify-end text-sm">
                        {formatCurrency(
                          (watchLines[index]?.quantity || 0) *
                            (watchLines[index]?.unitPrice || 0) *
                            (1 + (watchLines[index]?.vatRate || 0)),
                          "AED",
                          locale
                        )}
                      </div>
                    </div>
                    <div className="col-span-1 flex items-center justify-center">
                      {fields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    <T k="pages.subtotal" />
                  </span>
                  <span className="font-medium">{formatCurrency(subtotal, "AED", locale)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">VAT</span>
                  <span className="font-medium">{formatCurrency(vatAmount, "AED", locale)}</span>
                </div>
                <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                  <span>
                    <T k="pages.total2" />
                  </span>
                  <span>{formatCurrency(total, "AED", locale)}</span>
                </div>
              </div>

              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  <T k="pages.cancel" />
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={createMutation.isPending || editMutation.isPending}
                >
                  {createMutation.isPending || editMutation.isPending ? t["forms.saving"] : t.save}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <DataTableCard
        status={isLoading ? "loading" : creditNotes && creditNotes.length > 0 ? "ready" : "empty"}
        columnLabels={[t.date, t.total, t.status]}
        testId="credit-notes-table"
        empty={{
          icon: FileText,
          title: (t as any).noCreditNotesYet ?? "No credit notes yet",
          description:
            (t as any).creditNotesEmptyDesc ??
            "Issue a credit note to correct or refund an invoice — it posts to your ledger and VAT return automatically.",
          action: {
            label: t["pages.createFromInvoice"],
            href: "/invoices",
          },
          testId: "empty-credit-notes",
        }}
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead>
                <T k="pages.number" />
              </TableHead>
              <TableHead className="w-full">
                <T k="pages.customer" />
              </TableHead>
              <TableHead>{t["screens.originalInvoice"]}</TableHead>
              <TableHead>{t.date}</TableHead>
              <TableHead data-numeric="">
                <T k="pages.total2" />
              </TableHead>
              <TableHead>
                <T k="pages.status" />
              </TableHead>
              <TableHead>
                <span className="sr-only">{t.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(creditNotes ?? []).map((creditNote) => (
              <TableRow key={creditNote.id}>
                <TableCell data-nowrap="" data-cell="meta" className="font-medium">
                  <MiddleTruncate text={String(creditNote.number ?? "")} />
                </TableCell>
                <TableCell data-truncate="" data-cell="title" dir="auto">
                  {creditNote.customerName}
                </TableCell>
                <TableCell data-nowrap="" className="text-muted-foreground">
                  <span dir="ltr" className="[unicode-bidi:isolate]">
                    {creditNote.invoiceNumber || "—"}
                  </span>
                </TableCell>
                <TableCell
                  data-nowrap=""
                  data-cell="meta"
                  data-keep=""
                  className="text-muted-foreground"
                >
                  {formatDate(creditNote.date, locale)}
                </TableCell>
                <MoneyCell
                  amount={Number(creditNote.total)}
                  currency={creditNote.currency || "AED"}
                  className="font-medium"
                  data-cell="amount"
                />
                <TableCell data-nowrap="" data-cell="status">
                  <StatusBadge status={creditNote.status} />
                </TableCell>
                <TableCell data-cell="actions">
                  <RowActions
                    collapseOnMobile
                    menu={
                      <>
                        {creditNote.status === "draft" && (
                          <DropdownMenuItem
                            onClick={() =>
                              lifecycleMutation.mutate({ id: creditNote.id, action: "issue" })
                            }
                            data-testid={`button-issue-credit-note-${creditNote.id}`}
                          >
                            <FileText aria-hidden />
                            {t["invoices.issueCreditNote"]}
                          </DropdownMenuItem>
                        )}
                        {creditNote.status === "issued" && (
                          <DropdownMenuItem
                            onClick={() =>
                              lifecycleMutation.mutate({ id: creditNote.id, action: "void" })
                            }
                            data-testid={`button-void-credit-note-${creditNote.id}`}
                          >
                            <Ban aria-hidden />
                            {t["invoices.voidCreditNote"]}
                          </DropdownMenuItem>
                        )}
                        {creditNote.status === "draft" && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() =>
                              lifecycleMutation.mutate({ id: creditNote.id, action: "delete" })
                            }
                          >
                            <Trash2 aria-hidden />
                            <T k="pages.delete" />
                          </DropdownMenuItem>
                        )}
                      </>
                    }
                  >
                    <RowActionButton
                      label={t["pages.downloadPdf"]}
                      icon={Download}
                      onClick={() =>
                        window.open(`/api/credit-notes/${creditNote.id}/pdf`, "_blank")
                      }
                    />
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableCard>
    </div>
  );
}
