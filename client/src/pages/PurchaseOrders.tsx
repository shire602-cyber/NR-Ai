import { T } from "@/components/layout/T";
import {
  FormActions,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useTranslation, formatMessage } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  CalendarIcon,
  Trash2,
  Download,
  Edit,
  Send,
  CheckCircle,
  PackageCheck,
  ShoppingCart,
  Loader2,
  Ban,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTableCard } from "@/components/ui/data-table";
import { MoneyCell, Money } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";

const poLineSchema = z.object({
  description: z.string().min(1, "forms.errors.descriptionRequired"),
  quantity: z.coerce.number().min(0.01, "forms.errors.quantityPositive"),
  unitPrice: z.coerce.number().min(0, "forms.errors.pricePositive"),
  vatRate: z.coerce.number().default(0.05),
});

const purchaseOrderSchema = z.object({
  companyId: z.string().guid(),
  number: z.string().min(1, "forms.errors.poNumberRequired"),
  vendorName: z.string().min(1, "forms.errors.vendorNameRequired"),
  vendorTrn: z.string().optional(),
  date: z.date(),
  expectedDeliveryDate: z.date(),
  currency: z.string().default("AED"),
  notes: z.string().optional(),
  lines: z.array(poLineSchema).min(1, "forms.errors.lineItemRequired"),
});

type PurchaseOrderFormData = z.infer<typeof purchaseOrderSchema>;

/** The server owns number / status / totals; only these fields are sent (W3-B, R04-09/10). */
type PoPayload = {
  vendorName: string;
  vendorTrn: string | null;
  date: string;
  expectedDeliveryDate: string | null;
  currency: string;
  notes: string | null;
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number }>;
};

const PO_COPY = {
  en: {
    cancel: "Cancel order",
    convert: "Convert to bill",
    converted: "Bill created from the purchase order (pending approval)",
    cancelled: "Purchase order cancelled",
    partiallyReceived: "Partially received",
    receiveAll: "Receive outstanding",
    numberAssigned: "Assigned on save",
  },
  ar: {
    cancel: "إلغاء أمر الشراء",
    convert: "تحويل إلى فاتورة",
    converted: "تم إنشاء فاتورة من أمر الشراء (بانتظار الاعتماد)",
    cancelled: "تم إلغاء أمر الشراء",
    partiallyReceived: "مستلم جزئيًا",
    receiveAll: "استلام الكميات المتبقية",
    numberAssigned: "يُحدد عند الحفظ",
  },
} as const;

interface PurchaseOrder {
  id: string;
  companyId: string;
  number: string;
  vendorName: string;
  vendorTrn?: string;
  date: string;
  expectedDeliveryDate: string;
  currency: string;
  notes?: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  status: string;
}

export default function PurchaseOrders() {
  const { t, locale } = useTranslation();
  const pc = PO_COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { company: _company, companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);

  const { data: purchaseOrders, isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<PurchaseOrderFormData>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      number: `PO-${Date.now()}`,
      vendorName: "",
      vendorTrn: "",
      date: new Date(),
      expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
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
    mutationFn: (data: PoPayload) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/purchase-orders`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      toast({
        title: "Purchase order created",
        description: "Your purchase order has been created successfully.",
      });
      setDialogOpen(false);
      setEditingPO(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create purchase order",
        description: error?.message || "Please try again.",
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PoPayload }) =>
      apiRequest("PUT", `/api/purchase-orders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      toast({
        title: "Purchase order updated",
        description: "Your purchase order has been updated successfully.",
      });
      setDialogOpen(false);
      setEditingPO(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update purchase order",
        description: error?.message || "Please try again.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/purchase-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      toast({
        title: "Purchase order deleted",
        description: "The purchase order has been deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to delete purchase order",
        description: error?.message || "Please try again.",
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => {
      // Backend uses separate POST endpoints per action, not a generic PATCH
      const actionMap: Record<string, string> = {
        sent: "send",
        approved: "approve",
        received: "receive",
        cancelled: "cancel",
        billed: "convert-to-bill",
      };
      const action = actionMap[status];
      if (!action) throw new Error(`Unknown status: ${status}`);
      return apiRequest("POST", `/api/purchase-orders/${id}/${action}`, {});
    },
    onSuccess: (_r: unknown, vars: { id: string; status: string }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      if (vars.status === "billed") toast({ title: pc.converted });
      else if (vars.status === "cancelled") toast({ title: pc.cancelled });
      else
        toast({ title: "Status updated", description: "Purchase order status has been updated." });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to update status",
        description: error?.message || "Please try again.",
      });
    },
  });

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId || "",
      number: `PO-${Date.now()}`,
      vendorName: "",
      vendorTrn: "",
      date: new Date(),
      expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      currency: "AED",
      notes: "",
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditingPO(null);
  };

  const handleEditPO = async (po: PurchaseOrder) => {
    try {
      const full = await apiRequest("GET", `/api/purchase-orders/${po.id}`);
      setEditingPO(full);
      form.reset({
        companyId: full.companyId,
        number: full.number,
        vendorName: full.vendorName,
        vendorTrn: full.vendorTrn || "",
        date: new Date(full.date),
        expectedDeliveryDate: new Date(full.expectedDeliveryDate),
        currency: full.currency,
        notes: full.notes || "",
        lines: full.lines || [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to load purchase order details.",
      });
    }
  };

  const onSubmit = async (data: PurchaseOrderFormData) => {
    const poData: PoPayload = {
      vendorName: data.vendorName,
      vendorTrn: data.vendorTrn || null,
      date: format(data.date, "yyyy-MM-dd"),
      expectedDeliveryDate: data.expectedDeliveryDate
        ? format(data.expectedDeliveryDate, "yyyy-MM-dd")
        : null,
      currency: data.currency,
      notes: data.notes || null,
      lines: fields.map((_, index) => ({
        description: data.lines[index].description,
        quantity: Number(data.lines[index].quantity),
        unitPrice: Number(data.lines[index].unitPrice),
        vatRate: Number(data.lines[index].vatRate),
      })),
    };

    if (editingPO) {
      editMutation.mutate({ id: editingPO.id, data: poData });
    } else {
      createMutation.mutate(poData);
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

  if (!canAccess("purchaseOrders")) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <UpgradePrompt
          feature="purchaseOrders"
          requiredTier={getRequiredTier("purchaseOrders")}
          description={t["purchases.poUpgradeDescription"]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title={t.purchaseOrders}
        description={(t as any).purchaseOrdersSubtitle}
        actions={
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4" />
                <T k="pageLabels.newPurchaseOrder" />
              </Button>
            </DialogTrigger>
            <DialogContent size="lg" data-testid="dialog-po-form">
              <DialogHeader>
                <DialogTitle>
                  {editingPO ? t["screens.editPo"] : t["pageLabels.newPurchaseOrder"]}
                </DialogTitle>
                <DialogDescription>
                  {editingPO ? t["forms.po.editDesc"] : t["forms.po.newDesc"]}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
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
                              <T k="pageLabels.poNumber" />
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                ltr={!!editingPO}
                                value={editingPO ? field.value : pc.numberAssigned}
                                readOnly
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
                      {(["date", "expectedDeliveryDate"] as const).map((name) => (
                        <FormField
                          key={name}
                          control={form.control}
                          name={name}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel required>
                                {name === "date" ? (
                                  t.date
                                ) : (
                                  <T k="pageLabels.expectedDeliveryDate" />
                                )}
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

                  <FormSection title={t["forms.section.vendor"]}>
                    <FormGrid>
                      <FormField
                        control={form.control}
                        name="vendorName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>
                              <T k="pages.vendorName" />
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
                        name="vendorTrn"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <T k="pages.vendorTrn" />
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
                                <FormLabel className={lineLabelClass}>
                                  {t["forms.col.qty"]}
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    name={field.name}
                                    ref={field.ref}
                                    onBlur={field.onBlur}
                                    value={field.value ?? ""}
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value ? parseFloat(e.target.value) : ""
                                      )
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
                                <FormLabel className={lineLabelClass}>
                                  {t["forms.col.unitPrice"]}
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    name={field.name}
                                    ref={field.ref}
                                    onBlur={field.onBlur}
                                    value={field.value ?? ""}
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value ? parseFloat(e.target.value) : ""
                                      )
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
                                <FormLabel className={lineLabelClass}>
                                  {t["forms.col.vat"]}
                                </FormLabel>
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
                              placeholder={t["screens.poNotesPlaceholder"]}
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </FormSection>

                  <FormActions sticky>
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      <T k="pages.cancel" />
                    </Button>
                    <Button
                      type="submit"
                      className="sm:min-w-32"
                      disabled={createMutation.isPending || editMutation.isPending}
                    >
                      {createMutation.isPending || editMutation.isPending
                        ? t["forms.saving"]
                        : t.save}
                    </Button>
                  </FormActions>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        }
      />

      <DataTableCard
        status={
          isLoading ? "loading" : purchaseOrders && purchaseOrders.length > 0 ? "ready" : "empty"
        }
        columnLabels={[t["pages.vendor"], t.date, t.total, t.status]}
        testId="purchase-orders-table"
        empty={{
          icon: ShoppingCart,
          title: (t as any).noPurchaseOrdersYet ?? "No purchase orders yet",
          description:
            (t as any).purchaseOrdersEmptyDesc ??
            "Track what you've ordered from suppliers and match deliveries to bills when they arrive.",
          action: {
            label: (t as any).newPurchaseOrder ?? "New Purchase Order",
            onClick: () => setDialogOpen(true),
          },
          testId: "empty-purchase-orders",
        }}
      >
        <Table className="row-cards">
          <TableHeader>
            <TableRow>
              <TableHead>
                <T k="pages.number" />
              </TableHead>
              <TableHead className="w-full">
                <T k="pages.vendor" />
              </TableHead>
              <TableHead>{t.date}</TableHead>
              <TableHead>
                <T k="pageLabels.expectedDelivery" />
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
            {(purchaseOrders ?? []).map((po) => (
              <TableRow key={po.id}>
                <TableCell data-nowrap="" data-cell="meta" className="font-medium">
                  <span dir="ltr" className="[unicode-bidi:isolate]">
                    {po.number}
                  </span>
                </TableCell>
                <TableCell data-truncate="" data-cell="title" dir="auto">
                  {po.vendorName}
                </TableCell>
                <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                  {formatDate(po.date, locale)}
                </TableCell>
                <TableCell data-nowrap="" className="text-muted-foreground">
                  {po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate, locale) : "—"}
                </TableCell>
                <MoneyCell
                  amount={Number(po.total)}
                  currency={po.currency}
                  className="font-medium"
                  data-cell="amount"
                />
                <TableCell data-nowrap="" data-cell="status">
                  <StatusBadge status={po.status} />
                </TableCell>
                <TableCell data-cell="actions">
                  <RowActions
                    collapseOnMobile
                    menu={
                      <>
                        <DropdownMenuItem
                          onClick={() => updateStatusMutation.mutate({ id: po.id, status: "sent" })}
                          disabled={po.status !== "draft"}
                        >
                          <Send aria-hidden />
                          {t["screens.markSent"]}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateStatusMutation.mutate({ id: po.id, status: "approved" })
                          }
                          disabled={po.status !== "sent"}
                        >
                          <CheckCircle aria-hidden />
                          <T k="pages.approve" />
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateStatusMutation.mutate({ id: po.id, status: "received" })
                          }
                          disabled={po.status !== "approved" && po.status !== "partially_received"}
                        >
                          <PackageCheck aria-hidden />
                          {pc.receiveAll}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateStatusMutation.mutate({ id: po.id, status: "billed" })
                          }
                          disabled={
                            !["approved", "partially_received", "received"].includes(po.status)
                          }
                        >
                          <FileText aria-hidden />
                          {pc.convert}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            updateStatusMutation.mutate({ id: po.id, status: "cancelled" })
                          }
                          disabled={!["draft", "sent", "approved"].includes(po.status)}
                        >
                          <Ban aria-hidden />
                          {pc.cancel}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            if (window.confirm(t["screens.confirmDeletePo"])) {
                              deleteMutation.mutate(po.id);
                            }
                          }}
                          disabled={po.status !== "draft"}
                        >
                          <Trash2 aria-hidden />
                          <T k="pages.delete" />
                        </DropdownMenuItem>
                      </>
                    }
                  >
                    {po.status === "draft" && (
                      <RowActionButton
                        label={t.edit}
                        icon={Edit}
                        onClick={() => handleEditPO(po)}
                      />
                    )}
                    <RowActionButton
                      label={t["pages.downloadPdf"]}
                      icon={Download}
                      onClick={() => window.open(`/api/purchase-orders/${po.id}/pdf`, "_blank")}
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
