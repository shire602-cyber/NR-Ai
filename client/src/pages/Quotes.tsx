import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { T } from "@/components/layout/T";
import {
  FormErrorSummary,
  FormGrid,
  FormSection,
  FormTotals,
  LineAmount,
  LineItem,
  LineItemList,
  lineLabelClass,
} from "@/components/ui/form-layout";
import { PageHeader } from "@/components/ui/page-header";
import { EditorShell } from "@/components/ui/editor-shell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useEditorRoute } from "@/hooks/useEditorRoute";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { DataTableCard } from "@/components/ui/data-table";
import { MoneyCell, Money } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
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
import { useTranslation, formatMessage, translateNow } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, CalendarIcon, Trash2, Download, Edit, FileText, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const quoteLineSchema = z.object({
  description: z.string().min(1, "forms.errors.descriptionRequired"),
  quantity: z.coerce.number().min(0.01, "forms.errors.quantityPositive"),
  unitPrice: z.coerce.number().min(0, "forms.errors.pricePositive"),
  vatRate: z.coerce.number().default(0.05),
});

const quoteSchema = z.object({
  companyId: z.string().guid(),
  // The server assigns the number (R03-11); the field only shows it once a quote exists.
  number: z.string().optional(),
  customerName: z.string().min(1, "forms.errors.customerNameRequired"),
  customerTrn: z.string().optional(),
  date: z.date(),
  expiryDate: z.date(),
  currency: z.string().default("AED"),
  notes: z.string().optional(),
  lines: z.array(quoteLineSchema).min(1, "forms.errors.lineItemRequired"),
});

type QuoteFormData = z.infer<typeof quoteSchema>;

interface Quote {
  id: string;
  companyId: string;
  number: string;
  customerName: string;
  customerTrn?: string;
  date: string;
  expiryDate: string;
  currency: string;
  notes?: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  status: string;
}

export default function Quotes() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();
  const { routed, editor, toNew, toEdit, toList } = useEditorRoute("/quotes");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  const { data: quotes, isLoading } = useQuery<Quote[]>({
    queryKey: ["/api/companies", selectedCompanyId, "quotes"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<QuoteFormData>({
    resolver: zodResolver(quoteSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      number: "",
      customerName: "",
      customerTrn: "",
      date: new Date(),
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      currency: "AED",
      notes: "",
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
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/quotes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      toast({
        title: translateNow("toasts.quoteCreated"),
        description: translateNow("toasts.yourQuoteHasBeenCreatedSuccessfully"),
      });
      leaveEditor();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToCreateQuote"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest("PUT", `/api/quotes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      toast({
        title: translateNow("toasts.quoteUpdated"),
        description: translateNow("toasts.yourQuoteHasBeenUpdatedSuccessfully"),
      });
      leaveEditor();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToUpdateQuote"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/quotes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      toast({
        title: translateNow("toasts.quoteDeleted"),
        description: translateNow("toasts.theQuoteHasBeenDeleted"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToDeleteQuote"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/quotes/${id}/convert-to-invoice`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: translateNow("toasts.quoteConverted"),
        description: translateNow("toasts.theQuoteHasBeenConvertedToAn"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToConvertQuote"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId || "",
      number: "",
      customerName: "",
      customerTrn: "",
      date: new Date(),
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      currency: "AED",
      notes: "",
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditingQuote(null);
  };

  const handleEditQuote = async (quote: Quote) => {
    try {
      const fullQuote = await apiRequest("GET", `/api/quotes/${quote.id}`);
      setEditingQuote(fullQuote);
      form.reset({
        companyId: fullQuote.companyId,
        number: fullQuote.number,
        customerName: fullQuote.customerName,
        customerTrn: fullQuote.customerTrn || "",
        date: new Date(fullQuote.date),
        expiryDate: new Date(fullQuote.expiryDate),
        currency: fullQuote.currency,
        notes: fullQuote.notes || "",
        lines: fullQuote.lines || [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setEditorOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: error?.message || translateNow("toasts.failedToLoadQuoteDetails"),
      });
      if (routed) toList();
    }
  };

  const openNewQuote = () => {
    if (routed) toNew();
    else setEditorOpen(true);
  };

  const openQuoteEditor = (quote: Quote) => {
    if (routed && editor !== quote.id) toEdit(quote.id);
    else void handleEditQuote(quote);
  };

  /** Closes the editor and returns to the list. */
  function leaveEditor() {
    setEditorOpen(false);
    resetForm();
    if (routed && editor) toList();
  }

  const closeEditor = leaveEditor;

  // The editor routes: a blank quote, or the one being edited.
  useEffect(() => {
    if (editor === "new") setEditorOpen(true);
    else if (editor) void handleEditQuote({ id: editor } as Quote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const onSubmit = async (data: QuoteFormData) => {
    // R03-11: strict contract — number, status and totals are server-owned.
    const quoteData = {
      customerName: data.customerName,
      customerTrn: data.customerTrn || null,
      date: format(data.date, "yyyy-MM-dd"),
      expiryDate: data.expiryDate ? format(data.expiryDate, "yyyy-MM-dd") : null,
      currency: data.currency,
      notes: data.notes || null,
      lines: fields.map((_, index) => {
        const vat = Number(data.lines[index].vatRate) > 0 ? 0.05 : 0;
        return {
          description: data.lines[index].description,
          quantity: Number(data.lines[index].quantity),
          unitPrice: Math.round(Number(data.lines[index].unitPrice) * 100) / 100,
          vatRate: vat,
          vatSupplyType: vat > 0 ? "standard_rated" : "zero_rated",
        };
      }),
    };

    if (editingQuote) {
      editMutation.mutate({ id: editingQuote.id, data: quoteData });
    } else {
      createMutation.mutate(quoteData);
    }
  };

  const watchLines = form.watch("lines");
  const subtotal = watchLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const vatAmount = watchLines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice * line.vatRate,
    0
  );
  const total = subtotal + vatAmount;

  if (!canAccess("quotes")) {
    return <UpgradePrompt feature="quotes" requiredTier={getRequiredTier("quotes")} />;
  }

  // Spec 3.7: a quote is written on a full page (EditorShell), not in a modal.
  const quoteEditor = (
    <EditorShell
      testId="dialog-quote-form"
      backHref="/quotes"
      backLabel={t["invoices.editor.backQuotes"]}
      eyebrow="Sales"
      title={editingQuote ? t["screens.editQuote"] : t["pageLabels.newQuote"]}
      description={
        editingQuote ? t["screens.quoteDialogEditDesc"] : t["screens.quoteDialogNewDesc"]
      }
      footerSummary={
        <span className="flex flex-wrap items-baseline gap-x-2" data-testid="editor-total">
          <span>{t["invoices.editor.total"]}</span>
          <Money amount={total} currency="AED" className="text-h3 font-semibold text-foreground" />
        </span>
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={closeEditor}>
            <T k="pages.cancel" />
          </Button>
          <Button
            type="submit"
            form="quote-editor-form"
            className="sm:min-w-32"
            disabled={createMutation.isPending || editMutation.isPending}
            data-testid="button-submit-quote"
          >
            {createMutation.isPending || editMutation.isPending ? t["forms.saving"] : t.save}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id="quote-editor-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="min-w-0 space-y-6"
        >
          <FormErrorSummary />
          <FormSection
            title={t["forms.section.document"]}
            description={t["forms.section.documentDesc"]}
          >
            <FormGrid>
              <FormField
                control={form.control}
                name="number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pageLabels.quoteNumber" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        ltr
                        readOnly
                        placeholder={editingQuote ? undefined : t["invoices.numberAssignedOnSave"]}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.currency" />
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t["screens.selectCurrency"]} />
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
              {(["date", "expiryDate"] as const).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {name === "date" ? t.date : <T k="pageLabels.expiryDate" />}
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
              ))}
            </FormGrid>
          </FormSection>

          <FormSection title={t["forms.section.customer"]}>
            <FormGrid>
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      <T k="pages.customerName" />
                    </FormLabel>
                    <FormControl>
                      <Input {...field} dir="auto" />
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
                      <Input
                        {...field}
                        ltr
                        inputMode="numeric"
                        placeholder={t["screens.optional"]}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title={<T k="pages.lineItems" />}
            actions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 })
                }
              >
                <Plus className="h-4 w-4" />
                <T k="pages.addLine" />
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
                  gridClassName="sm:grid-cols-[6rem_8rem_7rem_minmax(0,1fr)]"
                  main={
                    <FormField
                      control={form.control}
                      name={`lines.${index}.description`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              {...field}
                              dir="auto"
                              placeholder={t.description}
                              aria-label={formatMessage(t["forms.lineDescription"], {
                                n: index + 1,
                              })}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  }
                >
                  <FormField
                    control={form.control}
                    name={`lines.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={lineLabelClass}>{t["forms.col.qty"]}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${index}.unitPrice`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={lineLabelClass}>{t["forms.col.unitPrice"]}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${index}.vatRate`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={lineLabelClass}>{t["forms.col.vat"]}</FormLabel>
                        <Select
                          value={String(field.value * 100)}
                          onValueChange={(val) => field.onChange(parseFloat(val) / 100)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="0">0%</SelectItem>
                            <SelectItem value="5">5%</SelectItem>
                            <SelectItem value="10">10%</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <LineAmount label={t["forms.col.amount"]}>
                    <Money
                      amount={
                        (watchLines[index]?.quantity || 0) *
                        (watchLines[index]?.unitPrice || 0) *
                        (1 + (watchLines[index]?.vatRate || 0))
                      }
                      currency="AED"
                    />
                  </LineAmount>
                </LineItem>
              ))}
            </LineItemList>
            <FormTotals
              rows={[
                {
                  label: <T k="pages.subtotal" />,
                  value: <Money amount={subtotal} currency="AED" />,
                },
                {
                  label: t["forms.col.vat"],
                  value: <Money amount={vatAmount} currency="AED" />,
                },
              ]}
              total={{
                label: <T k="pages.total2" />,
                value: <Money amount={total} currency="AED" />,
              }}
            />
          </FormSection>

          <FormSection title={t["forms.section.notes"]}>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">
                    <T k="pages.notes" />
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      dir="auto"
                      placeholder={t["screens.quoteNotesPlaceholder"]}
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>
        </form>
      </Form>
    </EditorShell>
  );

  if (editor && editor !== "new" && !editingQuote) return <PageSkeleton variant="form" />;
  if (editorOpen || editor) return quoteEditor;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title={t.quotes}
        description={(t as any).quotesSubtitle}
        actions={
          <Button onClick={openNewQuote}>
            <Plus className="w-4 h-4" />
            <T k="pageLabels.newQuote" />
          </Button>
        }
      />

      <DataTableCard
        status={isLoading ? "loading" : quotes && quotes.length > 0 ? "ready" : "empty"}
        columnLabels={[t.date, t.total, t.status]}
        testId="quotes-table"
        empty={{
          icon: FileText,
          title: (t as any).noQuotesYet ?? "No quotes yet",
          description:
            (t as any).quotesEmptyDesc ??
            "Send a professional quote in minutes — accepted quotes convert to invoices with one click.",
          action: {
            label: (t as any).newQuote ?? "New Quote",
            onClick: openNewQuote,
          },
          testId: "empty-quotes",
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
              <TableHead>{t.date}</TableHead>
              <TableHead>
                <T k="pages.expiry" />
              </TableHead>
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
            {(quotes ?? []).map((quote) => (
              <TableRow key={quote.id}>
                <TableCell data-nowrap="" data-cell="meta" className="font-medium">
                  <MiddleTruncate text={String(quote.number ?? "")} />
                </TableCell>
                <TableCell data-truncate="" data-cell="title" dir="auto">
                  {quote.customerName}
                </TableCell>
                <TableCell
                  data-nowrap=""
                  data-cell="meta"
                  data-keep=""
                  className="text-muted-foreground"
                >
                  {formatDate(quote.date, locale)}
                </TableCell>
                <TableCell data-nowrap="" className="text-muted-foreground">
                  {formatDate(quote.expiryDate, locale)}
                </TableCell>
                <MoneyCell
                  amount={Number(quote.total)}
                  currency={quote.currency}
                  className="font-medium"
                  data-cell="amount"
                />
                <TableCell data-nowrap="" data-cell="status">
                  <StatusBadge status={quote.status} />
                </TableCell>
                <TableCell data-cell="actions">
                  <RowActions
                    maxInline={1}
                    collapseOnMobile
                    menu={
                      <>
                        <DropdownMenuItem
                          onClick={() => convertMutation.mutate(quote.id)}
                          disabled={quote.status === "converted"}
                        >
                          <ArrowRightLeft aria-hidden />
                          <T k="pageLabels.convertToInvoice" />
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            if (window.confirm(t["screens.confirmDeleteQuote"])) {
                              deleteMutation.mutate(quote.id);
                            }
                          }}
                        >
                          <Trash2 aria-hidden />
                          <T k="pages.delete" />
                        </DropdownMenuItem>
                      </>
                    }
                  >
                    <RowActionButton
                      label={t.edit}
                      icon={Edit}
                      onClick={() => openQuoteEditor(quote)}
                    />
                    <RowActionButton
                      label={t["pages.downloadPdf"]}
                      icon={Download}
                      onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, "_blank")}
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
