import { T } from "@/components/layout/T";
import {
  FormErrorSummary,
  FormGrid,
  FormSection,
  LineAmount,
  LineItem,
  LineItemList,
  lineLabelClass,
} from "@/components/ui/form-layout";
import { EditorShell } from "@/components/ui/editor-shell";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useEditorRoute } from "@/hooks/useEditorRoute";
import { useEffect, useState } from "react";
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
  FormDescription,
} from "@/components/ui/form";
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
import { PageHeader } from "@/components/ui/page-header";
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
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, CalendarIcon, Trash2, Edit, Pause, Play, CalendarDays } from "lucide-react";
import type { RecurringInvoice } from "@shared/schema";
import { cn } from "@/lib/utils";

const lineItemSchema = z.object({
  description: z.string().min(1, "forms.errors.descriptionRequired"),
  quantity: z.coerce.number().min(0.01, "forms.errors.quantityPositive"),
  unitPrice: z.coerce.number().min(0, "forms.errors.pricePositive"),
  vatRate: z.coerce.number().default(0.05),
});

const recurringInvoiceSchema = z.object({
  customerName: z.string().min(1, "forms.errors.customerNameRequired"),
  customerTrn: z.string().optional(),
  currency: z.string().default("AED"),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  startDate: z.date(),
  endDate: z.date().optional().nullable(),
  lines: z.array(lineItemSchema).min(1, "forms.errors.lineItemRequired"),
  // R03-23: draft vs auto-issue, optional auto-send through the email provider.
  autoIssue: z.boolean().default(true),
  autoSend: z.boolean().default(false),
  sendToEmail: z.string().email().optional().or(z.literal("")),
});

type RecurringInvoiceFormData = z.infer<typeof recurringInvoiceSchema>;

const frequencyLabels: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const frequencyLabelsAr: Record<string, string> = {
  weekly: "اسبوعي",
  monthly: "شهري",
  quarterly: "ربع سنوي",
  yearly: "سنوي",
};

export default function RecurringInvoices() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const { routed, editor, toNew, toEdit, toList } = useEditorRoute("/recurring-invoices");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RecurringInvoice | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const { data: recurringInvoices, isLoading } = useQuery<RecurringInvoice[]>({
    queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<RecurringInvoiceFormData>({
    resolver: zodResolver(recurringInvoiceSchema),
    defaultValues: {
      customerName: "",
      customerTrn: "",
      currency: "AED",
      frequency: "monthly",
      startDate: new Date(),
      endDate: null,
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      autoIssue: true,
      autoSend: false,
      sendToEmail: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });
  const watchedLines = form.watch("lines");
  const watchedCurrency = form.watch("currency");

  const createMutation = useMutation({
    mutationFn: async (data: RecurringInvoiceFormData) => {
      return await apiRequest("POST", `/api/companies/${selectedCompanyId}/recurring-invoices`, {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        currency: data.currency,
        frequency: data.frequency,
        startDate: format(data.startDate, "yyyy-MM-dd"),
        endDate: data.endDate ? format(data.endDate, "yyyy-MM-dd") : null,
        lines: data.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Math.round(Number(l.unitPrice) * 100) / 100,
          vatRate: Number(l.vatRate) > 0 ? 0.05 : 0,
          vatSupplyType: Number(l.vatRate) > 0 ? "standard_rated" : "zero_rated",
        })),
        autoIssue: data.autoIssue,
        autoSend: data.autoSend,
        sendToEmail: data.autoSend && data.sendToEmail ? data.sendToEmail : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"],
      });
      leaveEditor();
      toast({
        title: translateNow("toasts.recurringInvoiceCreated"),
        description: translateNow("toasts.theRecurringInvoiceTemplateHasBeenCreated"),
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RecurringInvoiceFormData }) => {
      return await apiRequest("PATCH", `/api/recurring-invoices/${id}`, {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        currency: data.currency,
        frequency: data.frequency,
        startDate: format(data.startDate, "yyyy-MM-dd"),
        nextRunDate: format(data.startDate, "yyyy-MM-dd"),
        endDate: data.endDate ? format(data.endDate, "yyyy-MM-dd") : null,
        lines: data.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Math.round(Number(l.unitPrice) * 100) / 100,
          vatRate: Number(l.vatRate) > 0 ? 0.05 : 0,
          vatSupplyType: Number(l.vatRate) > 0 ? "standard_rated" : "zero_rated",
        })),
        autoIssue: data.autoIssue,
        autoSend: data.autoSend,
        sendToEmail: data.autoSend && data.sendToEmail ? data.sendToEmail : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"],
      });
      leaveEditor();
      toast({
        title: translateNow("toasts.recurringInvoiceUpdated"),
        description: translateNow("toasts.theRecurringInvoiceTemplateHasBeenUpdated"),
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

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PATCH", `/api/recurring-invoices/${id}/toggle`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"],
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/recurring-invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"],
      });
      toast({
        title: translateNow("toasts.deleted"),
        description: translateNow("toasts.recurringInvoiceHasBeenDeleted"),
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

  const handleCreate = () => {
    setEditingItem(null);
    form.reset({
      customerName: "",
      customerTrn: "",
      currency: "AED",
      frequency: "monthly",
      startDate: new Date(),
      endDate: null,
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditorOpen(true);
  };

  const handleEdit = (item: RecurringInvoice) => {
    setEditingItem(item);
    let parsedLines = [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }];
    try {
      parsedLines = JSON.parse(item.linesJson);
    } catch {
      // keep default
    }
    form.reset({
      customerName: item.customerName,
      customerTrn: item.customerTrn || "",
      currency: item.currency,
      frequency: item.frequency as "weekly" | "monthly" | "quarterly" | "yearly",
      startDate: new Date(item.startDate),
      endDate: item.endDate ? new Date(item.endDate) : null,
      lines: parsedLines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        vatRate: Number(l.vatRate),
      })),
      autoIssue: (item as RecurringInvoice & { autoIssue?: boolean }).autoIssue ?? true,
      autoSend: (item as RecurringInvoice & { autoSend?: boolean }).autoSend ?? false,
      sendToEmail: (item as RecurringInvoice & { sendToEmail?: string | null }).sendToEmail ?? "",
    });
    setEditorOpen(true);
  };

  const openNewRecurring = () => {
    if (routed) toNew();
    else handleCreate();
  };

  const openRecurringEditor = (item: RecurringInvoice) => {
    if (routed && editor !== item.id) toEdit(item.id);
    else handleEdit(item);
  };

  /** Closes the editor and returns to the list. */
  function leaveEditor() {
    setEditorOpen(false);
    setEditingItem(null);
    form.reset();
    if (routed && editor) toList();
  }

  const closeEditor = leaveEditor;

  // The editor routes: a blank template, or the one being edited once the list has loaded.
  useEffect(() => {
    if (editor === "new") {
      if (!editorOpen) handleCreate();
    } else if (editor && !editingItem && recurringInvoices) {
      const item = recurringInvoices.find((r) => r.id === editor);
      if (item) handleEdit(item);
      else toList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, recurringInvoices]);

  const onSubmit = (data: RecurringInvoiceFormData) => {
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  /** Per-run amount (subtotal + VAT) from the template lines, for the list's amount column. */
  const cycleTotal = (item: RecurringInvoice): number | null => {
    try {
      const lines = JSON.parse(item.linesJson) as Array<{
        quantity: number | string;
        unitPrice: number | string;
        vatRate?: number | string;
      }>;
      return lines.reduce((sum, l) => {
        const net = Number(l.quantity) * Number(l.unitPrice);
        const rate = Number(l.vatRate ?? 0);
        return sum + net + net * (rate > 1 ? rate / 100 : rate);
      }, 0);
    } catch {
      return null;
    }
  };

  const getFreqLabel = (freq: string) => {
    if (locale === "ar") return frequencyLabelsAr[freq] || freq;
    return frequencyLabels[freq] || freq;
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t.noData || "No data available"}</p>
      </div>
    );
  }

  // Spec 3.7: a recurring invoice is written on a full page (EditorShell), not in a modal.
  const cycleAmount = watchedLines.reduce(
    (sum, l) =>
      sum + Number(l?.quantity || 0) * Number(l?.unitPrice || 0) * (1 + Number(l?.vatRate || 0)),
    0
  );
  const recurringEditor = (
    <EditorShell
      testId="dialog-recurring-form"
      backHref="/recurring-invoices"
      backLabel={t["invoices.editor.backRecurring"]}
      eyebrow="Sales"
      title={editingItem ? t["forms.recurring.editTitle"] : t["forms.recurring.newTitle"]}
      description={t["forms.recurring.desc"]}
      footerSummary={
        <span className="flex flex-wrap items-baseline gap-x-2" data-testid="editor-total">
          <span>{t["invoices.editor.total"]}</span>
          <Money
            amount={cycleAmount}
            currency={watchedCurrency || "AED"}
            className="text-h3 font-semibold text-foreground"
          />
        </span>
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={closeEditor}>
            {t.cancel}
          </Button>
          <Button
            type="submit"
            form="recurring-editor-form"
            className="sm:min-w-32"
            disabled={createMutation.isPending || updateMutation.isPending}
            data-testid="button-submit-recurring"
          >
            {createMutation.isPending || updateMutation.isPending ? t["forms.saving"] : t.save}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id="recurring-editor-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="min-w-0 space-y-6"
        >
          <FormErrorSummary />
          <FormSection title={t["forms.section.customer"]}>
            <FormGrid>
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t.customerName}</FormLabel>
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
                    <FormLabel>{t.customerTRN}</FormLabel>
                    <FormControl>
                      <Input {...field} ltr inputMode="numeric" placeholder={t["forms.optional"]} />
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
                    <FormLabel>{t["forms.recurring.currency"]}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
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
            </FormGrid>
          </FormSection>

          <FormSection
            title={t["forms.section.schedule"]}
            description={t["forms.section.scheduleDesc"]}
          >
            <FormGrid>
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t["forms.recurring.frequency"]}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(["weekly", "monthly", "quarterly", "yearly"] as const).map((f) => (
                          <SelectItem key={f} value={f}>
                            {getFreqLabel(f)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="hidden sm:block" aria-hidden />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t["forms.recurring.startDate"]}</FormLabel>
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
                            {field.value ? formatDate(field.value, locale) : t["pages.pickADate"]}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
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
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t["forms.recurring.endDate"]}</FormLabel>
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
                            {field.value
                              ? formatDate(field.value, locale)
                              : t["forms.recurring.indefinite"]}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value || undefined}
                          onSelect={(date) => field.onChange(date || null)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>{t["forms.recurring.endDateHelp"]}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <div className="space-y-3 rounded-lg bg-surface-sunken/60 p-4">
              <FormField
                control={form.control}
                name="autoIssue"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        data-testid="checkbox-recurring-auto-issue"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">{t["invoices.autoIssue"]}</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="autoSend"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        data-testid="checkbox-recurring-auto-send"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">{t["invoices.autoSend"]}</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sendToEmail"
                render={({ field }) => (
                  <FormItem className="sm:max-w-sm">
                    <FormLabel className="sr-only">{t["invoices.sendToEmail"]}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder={t["invoices.sendToEmail"]}
                        {...field}
                        data-testid="input-recurring-send-to"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </FormSection>

          <FormSection
            title={t["forms.section.lines"]}
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
                {t.addLine}
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
                          <Input {...field} type="number" step="0.01" />
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
                          <Input {...field} type="number" step="0.01" />
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
                          onValueChange={(val) => field.onChange(parseFloat(val))}
                          defaultValue={String(field.value)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="0.05">5%</SelectItem>
                            <SelectItem value="0">0%</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <LineAmount label={t["forms.col.amount"]}>
                    <Money
                      amount={
                        Number(watchedLines[index]?.quantity || 0) *
                        Number(watchedLines[index]?.unitPrice || 0) *
                        (1 + Number(watchedLines[index]?.vatRate || 0))
                      }
                      currency={watchedCurrency || "AED"}
                    />
                  </LineAmount>
                </LineItem>
              ))}
            </LineItemList>
          </FormSection>
        </form>
      </Form>
    </EditorShell>
  );

  if (editor && editor !== "new" && !editingItem) {
    return isLoading ? <PageSkeleton variant="form" /> : null;
  }
  if (editorOpen || editor) return recurringEditor;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title={(t as any).recurringInvoices || "Recurring Invoices"}
        description={t["invoices.recurringManageRecurringInvoiceTemplates"]}
        actions={
          <Button onClick={openNewRecurring}>
            <Plus className="w-4 h-4" />
            {t["forms.recurring.newTitle"]}
          </Button>
        }
      />

      <DataTableCard
        status={
          isLoading
            ? "loading"
            : !recurringInvoices || recurringInvoices.length === 0
              ? "empty"
              : "ready"
        }
        columnLabels={[t.customerName, t.status]}
        testId="recurring-invoices-table"
        empty={{
          icon: CalendarDays,
          title: locale === "ar" ? "لا توجد فواتير متكررة بعد" : "No recurring invoices yet",
          description:
            locale === "ar"
              ? "انشئ قالب فاتورة متكررة للبدء"
              : "Create a recurring invoice template to get started",
          action: {
            label: locale === "ar" ? "فاتورة متكررة جديدة" : "New recurring invoice",
            onClick: openNewRecurring,
          },
        }}
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead className="w-full">{t.customerName || "Customer"}</TableHead>
              <TableHead>{locale === "ar" ? "التكرار" : "Frequency"}</TableHead>
              <TableHead>{t["invoices.recurringNextRunDate"]}</TableHead>
              <TableHead data-numeric="">{t["screens.perRun"]}</TableHead>
              <TableHead data-numeric="">{locale === "ar" ? "تم التوليد" : "Generated"}</TableHead>
              <TableHead>{t.status || "Status"}</TableHead>
              <TableHead>
                <span className="sr-only">{t.actions || "Actions"}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(recurringInvoices ?? []).map((item) => (
              <TableRow key={item.id}>
                <TableCell data-truncate="" data-cell="title" dir="auto" className="font-medium">
                  {item.customerName}
                </TableCell>
                <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                  {getFreqLabel(item.frequency)}
                </TableCell>
                <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                  {formatDate(item.nextRunDate, locale)}
                </TableCell>
                <MoneyCell
                  amount={cycleTotal(item)}
                  currency={item.currency}
                  className="font-medium"
                  data-cell="amount"
                />
                <TableCell data-numeric="" className="text-muted-foreground">
                  {item.totalGenerated}
                </TableCell>
                <TableCell data-nowrap="" data-cell="status">
                  <StatusBadge status={item.isActive ? "active" : "paused"} />
                </TableCell>
                <TableCell data-cell="actions">
                  <RowActions
                    collapseOnMobile
                    menu={
                      <>
                        <DropdownMenuItem onClick={() => toggleMutation.mutate(item.id)}>
                          {item.isActive ? (
                            <>
                              <Pause aria-hidden />
                              {locale === "ar" ? "ايقاف مؤقت" : "Pause"}
                            </>
                          ) : (
                            <>
                              <Play aria-hidden />
                              {locale === "ar" ? "استئناف" : "Resume"}
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setItemToDelete(item.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 aria-hidden />
                          {t.delete || "Delete"}
                        </DropdownMenuItem>
                      </>
                    }
                  >
                    <RowActionButton
                      label={t.edit || "Edit"}
                      icon={Edit}
                      onClick={() => openRecurringEditor(item)}
                    />
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableCard>

      <AlertDialog
        open={!!itemToDelete}
        onOpenChange={(open) => {
          if (!open) setItemToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="pages.deleteRecurringInvoice" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T k="invoices.recurringDeleteConfirm" />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (itemToDelete) {
                  deleteMutation.mutate(itemToDelete);
                  setItemToDelete(null);
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
