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
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterPurchaseOrders } from "@/lib/purchase-order-filters";
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
import { STATUS_NAMESPACES } from "@/components/ui/status-meta";
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
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  Search,
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
import { parseCalendarDate } from "@/lib/format-date";

const poLineSchema = z.object({
  /** Stocked product received on this line (X4/J3): without one the receipt moves no stock. */
  productId: z.string().optional().nullable(),
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
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    productId?: string;
  }>;
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
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    productId?: string | null;
  }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  status: string;
  createdBy?: string | null;
}

export default function PurchaseOrders() {
  const { t, locale } = useTranslation(STATUS_NAMESPACES);
  // E2 (J3-r2 / J4-r2): approve needs documents.approve and someone other than the preparer.
  const { gate, gateApproval, can } = useCompanyPermission();
  const pc = PO_COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { company: _company, companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const { routed, editor, toNew, toEdit, toList } = useEditorRoute("/purchase-orders");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    data: purchaseOrders,
    isLoading,
    isError,
    isPaused,
    refetch,
  } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
    enabled: !!selectedCompanyId,
  });
  // Only without cached data: a failed or paused background refresh keeps the list on screen.
  const loadPaused = purchaseOrders === undefined && isPaused;
  const loadFailed = purchaseOrders === undefined && isError;
  const { data: products = [] } = useQuery<
    Array<{
      id: string;
      name: string;
      nameAr?: string | null;
      sku?: string | null;
      costPrice?: number | string | null;
      trackInventory?: boolean;
      isActive?: boolean;
    }>
  >({
    queryKey: [`/api/companies/${selectedCompanyId}/products`],
    enabled: !!selectedCompanyId && (editorOpen || !!editor),
  });
  const visibleOrders = filterPurchaseOrders(purchaseOrders, searchQuery, t);
  const hasSearchNoMatches =
    !isLoading &&
    searchQuery.trim() !== "" &&
    (purchaseOrders?.length ?? 0) > 0 &&
    visibleOrders.length === 0;
  const stockProducts = products.filter((p) => p.isActive !== false);

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
        title: translateNow("toasts.purchaseOrderCreated"),
        description: translateNow("toasts.yourPurchaseOrderHasBeenCreatedSuccessfully"),
      });
      leaveEditor();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToCreatePurchaseOrder"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
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
        title: translateNow("toasts.purchaseOrderUpdated"),
        description: translateNow("toasts.yourPurchaseOrderHasBeenUpdatedSuccessfully"),
      });
      leaveEditor();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToUpdatePurchaseOrder"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
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
        title: translateNow("toasts.purchaseOrderDeleted"),
        description: translateNow("toasts.thePurchaseOrderHasBeenDeleted"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToDeletePurchaseOrder"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
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
    onSuccess: (r: unknown, vars: { id: string; status: string }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      const warnings = (r as { warnings?: Array<{ code: string }> } | null)?.warnings ?? [];
      if (vars.status === "received") {
        queryClient.invalidateQueries({
          queryKey: [`/api/companies/${selectedCompanyId}/products`],
        });
      }
      if (warnings.some((w) => w.code === "PO_LINES_WITHOUT_PRODUCT")) {
        // X4 (J3): never let a receipt silently skip stock.
        toast({
          title: t["purchases.poReceivedNoStock"],
          description: t["purchases.poReceivedNoStockHint"],
          variant: "warning",
        });
      } else if (vars.status === "billed") toast({ title: pc.converted });
      else if (vars.status === "cancelled") toast({ title: pc.cancelled });
      else
        toast({
          title: translateNow("toasts.statusUpdated"),
          description: translateNow("toasts.purchaseOrderStatusHasBeenUpdated"),
        });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToUpdateStatus"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
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
        date: parseCalendarDate(full.date),
        expectedDeliveryDate: parseCalendarDate(full.expectedDeliveryDate),
        currency: full.currency,
        notes: full.notes || "",
        lines: full.lines || [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setEditorOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: error?.message || translateNow("toasts.failedToLoadPurchaseOrderDetails"),
      });
      if (routed) toList();
    }
  };

  const openNewPO = () => {
    if (routed) toNew();
    else setEditorOpen(true);
  };

  const openPOEditor = (po: PurchaseOrder) => {
    if (routed && editor !== po.id) toEdit(po.id);
    else void handleEditPO(po);
  };

  /** Closes the editor and returns to the list. */
  function leaveEditor() {
    setEditorOpen(false);
    resetForm();
    if (routed && editor) toList();
  }

  const closeEditor = leaveEditor;

  // The editor routes: a blank purchase order, or the one being edited.
  useEffect(() => {
    if (editor === "new") setEditorOpen(true);
    else if (editor) void handleEditPO({ id: editor } as PurchaseOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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
        ...(data.lines[index].productId ? { productId: data.lines[index].productId! } : {}),
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

  // Spec 3.7: a purchase order is written on a full page (EditorShell), not in a modal.
  const poEditor = (
    <EditorShell
      testId="dialog-po-form"
      backHref="/purchase-orders"
      backLabel={t["invoices.editor.backPurchaseOrders"]}
      eyebrow={t["purchases.eyebrow"]}
      title={editingPO ? t["screens.editPo"] : t["pageLabels.newPurchaseOrder"]}
      description={editingPO ? t["forms.po.editDesc"] : t["forms.po.newDesc"]}
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
            form="po-editor-form"
            className="sm:min-w-32"
            disabled={createMutation.isPending || editMutation.isPending}
            data-testid="button-submit-po"
          >
            {createMutation.isPending || editMutation.isPending ? t["forms.saving"] : t.save}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id="po-editor-form"
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
                        {name === "date" ? t.date : <T k="pageLabels.expectedDeliveryDate" />}
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
                    <div className="space-y-2">
                      <FormField
                        control={form.control}
                        name={`lines.${index}.productId`}
                        render={({ field }) => (
                          <FormItem>
                            <Select
                              value={field.value || "none"}
                              onValueChange={(val) => {
                                const id = val === "none" ? null : val;
                                field.onChange(id);
                                const p = stockProducts.find((x) => x.id === id);
                                if (p) {
                                  if (!form.getValues(`lines.${index}.description`)) {
                                    form.setValue(
                                      `lines.${index}.description`,
                                      locale === "ar" && p.nameAr ? p.nameAr : p.name
                                    );
                                  }
                                  if (!Number(form.getValues(`lines.${index}.unitPrice`))) {
                                    form.setValue(
                                      `lines.${index}.unitPrice`,
                                      Number(p.costPrice) || 0
                                    );
                                  }
                                }
                              }}
                            >
                              <FormControl>
                                <SelectTrigger
                                  aria-label={formatMessage(t["purchases.poLineProduct"], {
                                    n: index + 1,
                                  })}
                                  data-testid={`po-line-product-${index}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">{t["purchases.poNoProduct"]}</SelectItem>
                                {stockProducts.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.sku ? `${p.sku} - ` : ""}
                                    {locale === "ar" && p.nameAr ? p.nameAr : p.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
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
                    </div>
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
                      placeholder={t["screens.poNotesPlaceholder"]}
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

  if (editor && editor !== "new" && !editingPO) return <PageSkeleton variant="form" />;
  if (editorOpen || editor) return poEditor;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["purchases.eyebrow"]}
        title={t.purchaseOrders}
        description={(t as any).purchaseOrdersSubtitle}
        actions={
          <Button onClick={openNewPO} data-testid="button-new-po" {...gate("documents.write")}>
            <Plus className="w-4 h-4" />
            <T k="pageLabels.newPurchaseOrder" />
          </Button>
        }
      />

      {(purchaseOrders?.length ?? 0) > 0 && (
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchInputRef}
            type="search"
            placeholder={t["purchases.poSearch"]}
            aria-label={t["purchases.poSearch"]}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 ps-9"
            data-testid="input-search-po"
          />
        </div>
      )}

      <div role="status" className="sr-only">
        {hasSearchNoMatches ? t["purchases.poNoMatch"] : ""}
      </div>

      <DataTableCard
        status={
          loadPaused || loadFailed
            ? "error"
            : isLoading
              ? "loading"
              : visibleOrders.length > 0
                ? "ready"
                : "empty"
        }
        columnLabels={[t["pages.vendor"], t.date, t.total, t.status]}
        testId="purchase-orders-table"
        error={{
          title: loadPaused ? t["components.offlineLabel"] : undefined,
          onRetry: () => void refetch(),
          testId: loadPaused ? "offline-purchase-orders" : "error-purchase-orders",
        }}
        empty={
          hasSearchNoMatches
            ? {
                icon: Search,
                title: t["purchases.poNoMatch"],
                description: t["purchases.poNoMatchBody"],
                action: {
                  label: t["screens.clearSearch"],
                  onClick: () => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  },
                  variant: "outline",
                },
                testId: "empty-purchase-orders-search",
              }
            : {
                icon: ShoppingCart,
                title: (t as any).noPurchaseOrdersYet ?? "No purchase orders yet",
                description:
                  (t as any).purchaseOrdersEmptyDesc ??
                  "Track what you've ordered from suppliers and match deliveries to bills when they arrive.",
                action: {
                  label: (t as any).newPurchaseOrder ?? "New Purchase Order",
                  onClick: openNewPO,
                },
                testId: "empty-purchase-orders",
              }
        }
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
            {visibleOrders.map((po) => (
              <TableRow key={po.id}>
                <TableCell data-nowrap="" data-cell="meta" className="font-medium">
                  <MiddleTruncate text={String(po.number ?? "")} />
                </TableCell>
                <TableCell data-truncate="" data-cell="title" dir="auto">
                  {po.vendorName}
                </TableCell>
                <TableCell
                  data-nowrap=""
                  data-cell="meta"
                  data-keep=""
                  className="text-muted-foreground"
                >
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
                    maxInline={1}
                    collapseOnMobile
                    menu={
                      <>
                        <DropdownMenuItem
                          onClick={() => updateStatusMutation.mutate({ id: po.id, status: "sent" })}
                          disabled={po.status !== "draft" || !can("documents.write")}
                        >
                          <Send aria-hidden />
                          {t["screens.markSent"]}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            updateStatusMutation.mutate({ id: po.id, status: "approved" })
                          }
                          {...gateApproval("documents.approve", po.createdBy)}
                          disabled={
                            po.status !== "sent" ||
                            "disabled" in gateApproval("documents.approve", po.createdBy)
                          }
                          data-testid={`menu-approve-po-${po.id}`}
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
                        onClick={() => openPOEditor(po)}
                        {...gate("documents.write")}
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
