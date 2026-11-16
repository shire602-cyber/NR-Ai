import { T } from "@/components/layout/T";
import { useState } from "react";
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
import { StatusBadge } from "@/components/ui/badge";
import { DataTableCard } from "@/components/ui/data-table";
import { MoneyCell } from "@/components/ui/money";
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
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, CalendarIcon, Trash2, Edit, Pause, Play, CalendarDays } from "lucide-react";
import type { RecurringInvoice } from "@shared/schema";
import { cn } from "@/lib/utils";

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().min(0.01, "Quantity must be positive"),
  unitPrice: z.coerce.number().min(0, "Price must be positive"),
  vatRate: z.coerce.number().default(0.05),
});

const recurringInvoiceSchema = z.object({
  customerName: z.string().min(1, "Customer name is required"),
  customerTrn: z.string().optional(),
  currency: z.string().default("AED"),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  startDate: z.date(),
  endDate: z.date().optional().nullable(),
  lines: z.array(lineItemSchema).min(1, "At least one line item is required"),
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
      setDialogOpen(false);
      form.reset();
      toast({
        title: "Recurring invoice created",
        description: "The recurring invoice template has been created.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
      setDialogOpen(false);
      setEditingItem(null);
      form.reset();
      toast({
        title: "Recurring invoice updated",
        description: "The recurring invoice template has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
      toast({ title: "Deleted", description: "Recurring invoice has been deleted." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
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
    setDialogOpen(true);
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
    setDialogOpen(true);
  };

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title={(t as any).recurringInvoices || "Recurring Invoices"}
        description={
          locale === "ar" ? "ادارة قوالب الفواتير المتكررة" : "Manage recurring invoice templates"
        }
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleCreate}>
                <Plus className="w-4 h-4" />
                {locale === "ar" ? "فاتورة متكررة جديدة" : "New Recurring Invoice"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingItem
                    ? locale === "ar"
                      ? "تعديل الفاتورة المتكررة"
                      : "Edit Recurring Invoice"
                    : locale === "ar"
                      ? "فاتورة متكررة جديدة"
                      : "New Recurring Invoice"}
                </DialogTitle>
                <DialogDescription>
                  {locale === "ar"
                    ? "حدد تفاصيل قالب الفاتورة المتكررة"
                    : "Define the recurring invoice template details"}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="customerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.customerName || "Customer Name"}</FormLabel>
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
                          <FormLabel>{t.customerTRN || "Customer TRN"}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
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
                          <FormLabel>{locale === "ar" ? "العملة" : "Currency"}</FormLabel>
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
                          <FormLabel>{locale === "ar" ? "التكرار" : "Frequency"}</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="weekly">
                                {locale === "ar" ? "اسبوعي" : "Weekly"}
                              </SelectItem>
                              <SelectItem value="monthly">
                                {locale === "ar" ? "شهري" : "Monthly"}
                              </SelectItem>
                              <SelectItem value="quarterly">
                                {locale === "ar" ? "ربع سنوي" : "Quarterly"}
                              </SelectItem>
                              <SelectItem value="yearly">
                                {locale === "ar" ? "سنوي" : "Yearly"}
                              </SelectItem>
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
                          <FormLabel>{locale === "ar" ? "تاريخ البدء" : "Start Date"}</FormLabel>
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
                                  {field.value
                                    ? format(field.value, "PPP")
                                    : locale === "ar"
                                      ? "اختر التاريخ"
                                      : "Pick a date"}
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
                          <FormLabel>
                            {locale === "ar" ? "تاريخ الانتهاء (اختياري)" : "End Date (optional)"}
                          </FormLabel>
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
                                  {field.value
                                    ? format(field.value, "PPP")
                                    : locale === "ar"
                                      ? "غير محدد"
                                      : "Indefinite"}
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

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="autoIssue"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2">
                          <FormControl>
                            <input
                              type="checkbox"
                              checked={field.value}
                              onChange={(e) => field.onChange(e.target.checked)}
                              data-testid="checkbox-recurring-auto-issue"
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">{t["invoices.autoIssue"]}</FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="autoSend"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2">
                          <FormControl>
                            <input
                              type="checkbox"
                              checked={field.value}
                              onChange={(e) => field.onChange(e.target.checked)}
                              data-testid="checkbox-recurring-auto-send"
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">{t["invoices.autoSend"]}</FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sendToEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder={t["invoices.sendToEmail"]}
                              aria-label={t["invoices.sendToEmail"]}
                              {...field}
                              data-testid="input-recurring-send-to"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Line Items */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-base font-semibold">
                        {locale === "ar" ? "بنود الفاتورة" : "Line Items"}
                      </FormLabel>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          append({ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 })
                        }
                      >
                        <Plus className="w-4 h-4" />
                        {t.addLine || "Add Line"}
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
                                  <FormLabel>{t.description || "Description"}</FormLabel>
                                )}
                                <FormControl>
                                  <Input {...field} placeholder={t.description || "Description"} />
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
                                {index === 0 && <FormLabel>{t.quantity || "Qty"}</FormLabel>}
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
                                {index === 0 && <FormLabel>{t.unitPrice || "Price"}</FormLabel>}
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
                                {index === 0 && <FormLabel>{t.vat || "VAT"}</FormLabel>}
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
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      {t.cancel || "Cancel"}
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending}
                    >
                      {createMutation.isPending || updateMutation.isPending
                        ? t.loading || "Loading..."
                        : t.save || "Save"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
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
            label: locale === "ar" ? "فاتورة متكررة جديدة" : "New Recurring Invoice",
            onClick: handleCreate,
          },
        }}
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead className="w-full">{t.customerName || "Customer"}</TableHead>
              <TableHead>{locale === "ar" ? "التكرار" : "Frequency"}</TableHead>
              <TableHead>{locale === "ar" ? "التشغيل التالي" : "Next Run Date"}</TableHead>
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
                      onClick={() => handleEdit(item)}
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
              This will permanently delete this recurring invoice schedule. This action cannot be
              undone.
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
