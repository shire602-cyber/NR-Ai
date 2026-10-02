import { useState } from "react";
import { pickerDate, parseYmd, todayYmd, formatCalendarDate, toYmd } from "@/lib/calendar-date";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogTrigger,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  CalendarIcon,
  Trash2,
  Edit,
  MoreHorizontal,
  Pause,
  Play,
  CalendarDays,
} from "lucide-react";
import type { RecurringInvoice } from "@shared/schema";
import { cn } from "@/lib/utils";
import { messages as pageMessages } from "./RecurringInvoices.i18n";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { ContactPicker } from "@/components/sales/ContactPicker";
import { salesErrorMessage } from "@/lib/sales-api";
import { jobCreatedCount, salesEndpoints } from "@/lib/sales-endpoints";
import { useCanManageFinance } from "@/hooks/useCanManageFinance";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Mail } from "lucide-react";
import { LineDiscountFields } from "@/components/sales/LineDiscountFields";
import { buildTemplateLines, splitTemplateLines } from "@/lib/recurring-template-lines";

const lineItemSchema = z.object({
  description: z.string().min(1, pageMessages.marker("descriptionIsRequired")),
  quantity: z.coerce.number().min(0.01, pageMessages.marker("quantityMustBePositive")),
  unitPrice: z.coerce.number().min(0, pageMessages.marker("priceMustBePositive")),
  vatRate: z.coerce.number().default(0.05),
  // A line discount (percent, or an amount before VAT) carried onto every generated invoice.
  discountType: z.enum(["percent", "amount"]).nullable().optional(),
  discountValue: z.union([z.number(), z.string()]).nullable().optional(),
});

const recurringInvoiceSchema = z.object({
  customerName: z.string().min(1, pageMessages.marker("customerNameIsRequired")),
  customerTrn: z.string().optional(),
  contactId: z.string().nullable().optional(),
  autoSend: z.boolean().default(false),
  paymentTermsDays: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().default("AED"),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  startDate: z.date(),
  endDate: z.date().optional().nullable(),
  shippingAmount: z.union([z.number(), z.string()]).default(""),
  shippingVatRate: z.coerce.number().default(0.05),
  lines: z.array(lineItemSchema).min(1, pageMessages.marker("atLeastOneLineItemIs")),
});

type RecurringInvoiceFormData = z.infer<typeof recurringInvoiceSchema>;

const getFrequencyLabels = (): Record<string, string> => ({
  weekly: pageMessages.t("weekly"),
  monthly: pageMessages.t("monthly"),
  quarterly: pageMessages.t("quarterly"),
  yearly: pageMessages.t("yearly"),
});

const frequencyLabelsAr: Record<string, string> = {
  weekly: "اسبوعي",
  monthly: "شهري",
  quarterly: "ربع سنوي",
  yearly: "سنوي",
};

export default function RecurringInvoices() {
  const tr = pageMessages.useT();
  const salesTr = salesMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const canManageFinance = useCanManageFinance(selectedCompanyId);
  const [dialogOpen, setDialogOpen] = useState(false);
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
      contactId: null,
      autoSend: false,
      paymentTermsDays: 30,
      currency: "AED",
      frequency: "monthly",
      startDate: parseYmd(todayYmd()),
      endDate: null,
      shippingAmount: "",
      shippingVatRate: 0.05,
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const createMutation = useMutation({
    mutationFn: async (data: RecurringInvoiceFormData) => {
      return await apiRequest("POST", `/api/companies/${selectedCompanyId}/recurring-invoices`, {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        contactId: data.contactId || null,
        autoSend: data.autoSend,
        paymentTermsDays: data.paymentTermsDays === "" || data.paymentTermsDays === null || data.paymentTermsDays === undefined ? null : Number(data.paymentTermsDays),
        currency: data.currency,
        frequency: data.frequency,
        startDate: toYmd(data.startDate),
        endDate: data.endDate ? toYmd(data.endDate) : null,
        linesJson: JSON.stringify(buildTemplateLines(data.lines, { amount: data.shippingAmount, vatRate: data.shippingVatRate }, salesTr("shippingLineDescription"))),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"],
      });
      setDialogOpen(false);
      form.reset();
      toast({
        title: tr("recurringInvoiceCreated"),
        description: tr("theRecurringInvoiceTemplateHasBeen"),
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: salesErrorMessage(error, (k) => salesTr(k), tr("error")), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RecurringInvoiceFormData }) => {
      return await apiRequest("PATCH", `/api/recurring-invoices/${id}`, {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        contactId: data.contactId || null,
        autoSend: data.autoSend,
        paymentTermsDays: data.paymentTermsDays === "" || data.paymentTermsDays === null || data.paymentTermsDays === undefined ? null : Number(data.paymentTermsDays),
        currency: data.currency,
        frequency: data.frequency,
        startDate: toYmd(data.startDate),
        nextRunDate: toYmd(data.startDate),
        endDate: data.endDate ? toYmd(data.endDate) : null,
        linesJson: JSON.stringify(buildTemplateLines(data.lines, { amount: data.shippingAmount, vatRate: data.shippingVatRate }, salesTr("shippingLineDescription"))),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"],
      });
      setDialogOpen(false);
      setEditingItem(null);
      form.reset();
      toast({
        title: tr("recurringInvoiceUpdated"),
        description: tr("theRecurringInvoiceTemplateHasBeen2"),
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: salesErrorMessage(error, (k) => salesTr(k), tr("error")), variant: "destructive" });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async () => apiRequest("POST", salesEndpoints.runRecurringNow(selectedCompanyId as string), {}),
    onSuccess: (result: unknown) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "recurring-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "invoices"] });
      const n = jobCreatedCount(result);
      toast({ title: salesTr("runNowDone"), description: n > 0 ? salesTr("runNowCreated", { count: n }) : salesTr("runNowNothingDue") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: salesErrorMessage(error, (k) => salesTr(k), salesTr("runNowFailed")), variant: "destructive" });
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
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
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
      toast({ title: tr("deleted"), description: tr("recurringInvoiceHasBeenDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    setEditingItem(null);
    form.reset({
      customerName: "",
      customerTrn: "",
      contactId: null,
      autoSend: false,
      paymentTermsDays: 30,
      currency: "AED",
      frequency: "monthly",
      startDate: parseYmd(todayYmd()),
      endDate: null,
      shippingAmount: "",
      shippingVatRate: 0.05,
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setDialogOpen(true);
  };

  const handleEdit = (item: RecurringInvoice) => {
    setEditingItem(item);
    let parsedLines: any[] = [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }];
    try {
      parsedLines = JSON.parse(item.linesJson);
    } catch {
      // keep default
    }
    // The shipping line has its own fields; every other line keeps its discount.
    const { items: itemLines, shipping: shippingLine } = splitTemplateLines(parsedLines);
    form.reset({
      customerName: item.customerName,
      customerTrn: item.customerTrn || "",
      contactId: (item as any).contactId ?? null,
      autoSend: Boolean((item as any).autoSend),
      paymentTermsDays: (item as any).paymentTermsDays ?? null,
      currency: item.currency,
      frequency: item.frequency as "weekly" | "monthly" | "quarterly" | "yearly",
      startDate: (pickerDate(item.startDate) as Date),
      endDate: item.endDate ? (pickerDate(item.endDate) as Date) : null,
      shippingAmount: shippingLine ? Number(shippingLine.unitPrice) : "",
      shippingVatRate: shippingLine ? Number(shippingLine.vatRate ?? 0.05) : 0.05,
      lines: itemLines.length > 0 ? itemLines : [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: RecurringInvoiceFormData) => {
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getFreqLabel = (freq: string) => {
    if (locale === "ar") return frequencyLabelsAr[freq] || freq;
    return getFrequencyLabels()[freq] || freq;
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t.noData || tr("noDataAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="w-8 h-8" />
            {(t as any).recurringInvoices || tr("recurringInvoices")}
          </h1>
          <p className="text-muted-foreground mt-1">{tr("manageRecurringInvoiceTemplates")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {canManageFinance && (
          <Button variant="outline" onClick={() => runNowMutation.mutate()} disabled={runNowMutation.isPending} data-testid="button-run-recurring-now" title={salesTr("runRecurringHelp")}>
            <Play className="w-4 h-4 me-2" />
            {salesTr("runNow")}
          </Button>
        )}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleCreate}>
              <Plus className="w-4 h-4 me-2" />
              {tr("newRecurringInvoice")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingItem ? tr("editRecurringInvoice") : tr("newRecurringInvoice")}
              </DialogTitle>
              <DialogDescription>
                {tr("defineTheRecurringInvoiceTemplateDetails")}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <ContactPicker
                  companyId={selectedCompanyId}
                  contactId={form.watch("contactId")}
                  testId="select-recurring-contact"
                  onSelect={(contact) => {
                    form.setValue("contactId", contact?.id ?? null);
                    if (contact) {
                      form.setValue("customerName", contact.name);
                      form.setValue("customerTrn", contact.trnNumber ?? "");
                    } else {
                      form.setValue("autoSend", false);
                    }
                  }}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.customerName || tr("customerName")}</FormLabel>
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
                        <FormLabel>{t.customerTRN || tr("customerTrn")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3 rounded-md border p-3" data-testid="recurring-auto-send">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label htmlFor="recurring-auto-send-switch">{salesTr("autoSend")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {form.watch("contactId") ? salesTr("autoSendHelp") : salesTr("autoSendNeedsContact")}
                      </p>
                    </div>
                    <Switch
                      id="recurring-auto-send-switch"
                      checked={form.watch("autoSend")}
                      disabled={!form.watch("contactId")}
                      onCheckedChange={(v) => form.setValue("autoSend", v)}
                      data-testid="switch-recurring-auto-send"
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="paymentTermsDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{salesTr("paymentTermsDays")}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            dir="ltr"
                            className="w-32 font-mono"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                            data-testid="input-recurring-terms"
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">{salesTr("paymentTermsHelp")}</p>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("currency")}</FormLabel>
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
                  <FormField
                    control={form.control}
                    name="frequency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("frequency")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="weekly">{tr("weekly")}</SelectItem>
                            <SelectItem value="monthly">{tr("monthly")}</SelectItem>
                            <SelectItem value="quarterly">{tr("quarterly")}</SelectItem>
                            <SelectItem value="yearly">{tr("yearly")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>{tr("startDate")}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full ps-3 text-start font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? formatCalendarDate(field.value, locale) : tr("pickADate")}
                                <CalendarIcon className="ms-auto h-4 w-4 opacity-50" />
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
                      <FormItem className="flex flex-col">
                        <FormLabel>{tr("endDateOptional")}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full ps-3 text-start font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? formatCalendarDate(field.value, locale) : tr("indefinite")}
                                <CalendarIcon className="ms-auto h-4 w-4 opacity-50" />
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Line Items */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-base font-semibold">{tr("lineItems")}</FormLabel>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        append({ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 })
                      }
                    >
                      <Plus className="w-4 h-4 me-1" />
                      {t.addLine || tr("addLine")}
                    </Button>
                  </div>
                  {fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-start">
                      <div className="col-span-5">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.description`}
                          render={({ field }) => (
                            <FormItem>
                              {index === 0 && (
                                <FormLabel>{t.description || tr("description")}</FormLabel>
                              )}
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={t.description || tr("description")}
                                />
                              </FormControl>
                              <FormMessage />
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
                              {index === 0 && <FormLabel>{t.quantity || tr("qty")}</FormLabel>}
                              <FormControl>
                                <Input {...field} type="number" step="0.01" />
                              </FormControl>
                              <FormMessage />
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
                              {index === 0 && <FormLabel>{t.unitPrice || tr("price")}</FormLabel>}
                              <FormControl>
                                <Input {...field} type="number" step="0.01" />
                              </FormControl>
                              <FormMessage />
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
                              {index === 0 && <FormLabel>{t.vat || tr("vat")}</FormLabel>}
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
                      </div>
                      <div className="col-span-1 flex items-end">
                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                            className={cn(index === 0 && "mt-6")}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <div className="col-span-12 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span className="text-xs text-muted-foreground">{salesTr("lineDiscount")}</span>
                        <LineDiscountFields
                          label={String(index + 1)}
                          type={form.watch(`lines.${index}.discountType`)}
                          value={form.watch(`lines.${index}.discountValue`)}
                          testId={`recurring-line-discount-${index}`}
                          onChange={(next) => {
                            form.setValue(`lines.${index}.discountType`, next.type, { shouldDirty: true });
                            form.setValue(`lines.${index}.discountValue`, next.value, { shouldDirty: true });
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="space-y-1.5 border-t pt-3" data-testid="recurring-shipping">
                    <Label>{salesTr("shipping")}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        dir="ltr"
                        className="w-40 font-mono"
                        placeholder={salesTr("shippingAmountPlaceholder")}
                        aria-label={salesTr("shippingAmount")}
                        value={form.watch("shippingAmount") ?? ""}
                        onChange={(e) => form.setValue("shippingAmount", e.target.value === "" ? "" : parseFloat(e.target.value), { shouldDirty: true })}
                        data-testid="input-recurring-shipping-amount"
                      />
                      <Select
                        value={String(Math.round((form.watch("shippingVatRate") ?? 0.05) * 100))}
                        onValueChange={(v) => form.setValue("shippingVatRate", parseFloat(v) / 100, { shouldDirty: true })}
                      >
                        <SelectTrigger className="w-24 font-mono" aria-label={salesTr("shippingVat")} data-testid="select-recurring-shipping-vat">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">0%</SelectItem>
                          <SelectItem value="5">5%</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">{tr("discountsAndShippingHint")}</p>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    {t.cancel || tr("cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {createMutation.isPending || updateMutation.isPending
                      ? t.loading || tr("loading")
                      : t.save || tr("save")}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{(t as any).recurringInvoices || tr("recurringInvoices")}</CardTitle>
          <CardDescription>{tr("invoiceTemplatesThatAreAutomaticallyGenerated")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !recurringInvoices || recurringInvoices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">{tr("noRecurringInvoicesYet")}</p>
              <p className="text-sm mt-1">{tr("createARecurringInvoiceTemplateTo")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.customerName || tr("customer")}</TableHead>
                  <TableHead>{tr("frequency")}</TableHead>
                  <TableHead>{tr("nextRunDate")}</TableHead>
                  <TableHead>{t.status || tr("status")}</TableHead>
                  <TableHead>{tr("generated")}</TableHead>
                  <TableHead className="text-end">{t.actions || tr("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recurringInvoices.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.customerName}
                      {(item as any).autoSend && (
                        <Badge variant="outline" className="ms-2 gap-1 text-xs" data-testid={`badge-auto-send-${item.id}`}>
                          <Mail className="h-3 w-3" />
                          {salesTr("autoSendBadge")}
                        </Badge>
                      )}
                      {(item as any).autoSend && (item as any).lastSendStatus === "not_sent" && (
                        <span className="mt-1 block text-xs font-normal text-warning" data-testid={`last-send-failed-${item.id}`}>
                          {salesTr("lastSendFailed")}
                          {(item as any).lastSendError ? `: ${(item as any).lastSendError}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getFreqLabel(item.frequency)}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(item.nextRunDate, locale)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={item.isActive ? "default" : "outline"}
                        className={cn(
                          item.isActive
                            ? "bg-success-subtle text-success-subtle-foreground "
                            : "bg-warning-subtle text-warning-subtle-foreground "
                        )}
                      >
                        {item.isActive ? tr("active") : tr("paused")}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.totalGenerated}</TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(item)}>
                            <Edit className="w-4 h-4 me-2" />
                            {t.edit || tr("edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleMutation.mutate(item.id)}>
                            {item.isActive ? (
                              <>
                                <Pause className="w-4 h-4 me-2" />
                                {tr("pause")}
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4 me-2" />
                                {tr("resume")}
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setItemToDelete(item.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-4 h-4 me-2" />
                            {t.delete || tr("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!itemToDelete}
        onOpenChange={(open) => {
          if (!open) setItemToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("deleteRecurringInvoice")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("thisWillPermanentlyDeleteThisRecurring")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (itemToDelete) {
                  deleteMutation.mutate(itemToDelete);
                  setItemToDelete(null);
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
