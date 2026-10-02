import { PageHeader } from "@/components/ui/page-header";
import { pickerDate, parseYmd, todayYmd, formatCalendarDate } from "@/lib/calendar-date";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
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
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { downloadPdf } from "@/lib/download-pdf";
import {
  Plus,
  CalendarIcon,
  Trash2,
  Download,
  Edit,
  FileText,
  MoreHorizontal,
  ArrowRightLeft,
  ClipboardList,
  Send,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { messages as pageMessages } from "./Quotes.i18n";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { LineDiscountFields } from "@/components/sales/LineDiscountFields";
import { LineProductPicker } from "@/components/sales/LineProductPicker";
import { DocumentAdjustments, SalesTotalsSummary } from "@/components/sales/DocumentAdjustments";
import { CustomFieldsEditor } from "@/components/sales/CustomFieldsEditor";
import { useCustomFieldDraft } from "@/components/sales/useCustomFieldDraft";
import { useSalesAdjustments } from "@/components/sales/useSalesAdjustments";
import { ContactPicker, usePriceListResolution } from "@/components/sales/ContactPicker";
import { AvailabilityBadge, useProductAvailability } from "@/components/sales/AvailabilityBadge";
import { QuoteSendDialog } from "@/components/sales/QuoteSendDialog";
import { QuoteStatusBadge } from "@/components/sales/SalesShared";
import { SignatureRecord } from "@/components/sales/SignatureRecord";
import {
  buildSalesBody,
  itemFormFromRow,
  lineTotalWithVat,
  previewTotals,
  priceForProduct,
  quoteActions,
  salesErrorMessage,
  splitStoredLines,
  type ItemLineForm,
} from "@/lib/sales-api";
import { Link } from "wouter";
import { vatChoiceOf, vatFieldsOf, vatFromSelectValue, vatSelectValue } from "@/lib/vat-choice";

const quoteLineSchema = z.object({
  description: z.string().min(1, pageMessages.marker("descriptionIsRequired")),
  quantity: z.coerce.number().min(0.01, pageMessages.marker("quantityMustBePositive")),
  unitPrice: z.coerce.number().min(0, pageMessages.marker("priceMustBePositive")),
  vatRate: z.coerce.number().default(0.05),
  productId: z.string().nullable().optional(),
  priceListId: z.string().nullable().optional(),
  discountType: z.enum(["percent", "amount"]).nullable().optional(),
  discountValue: z.union([z.number(), z.string()]).nullable().optional(),
  vatSupplyType: z.string().nullable().optional(),
});

const quoteSchema = z.object({
  companyId: z.string().uuid(),
  number: z.string().min(1, pageMessages.marker("quoteNumberIsRequired")),
  customerName: z.string().min(1, pageMessages.marker("customerNameIsRequired")),
  customerTrn: z.string().optional(),
  contactId: z.string().nullable().optional(),
  date: z.date(),
  expiryDate: z.date(),
  currency: z.string().default("AED"),
  notes: z.string().optional(),
  lines: z.array(quoteLineSchema).min(1, pageMessages.marker("atLeastOneLineItemIs")),
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
  contactId?: string | null;
  discountType?: string | null;
  discountValue?: number | string | null;
  shareToken?: string | null;
  lines: Array<any>;
  subtotal: number;
  vatAmount: number;
  total: number;
  status: string;
}

export default function Quotes() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  const { data: quotes, isLoading } = useQuery<Quote[]>({
    queryKey: ["/api/companies", selectedCompanyId, "quotes"],
    enabled: !!selectedCompanyId,
  });

  const salesTr = salesMessages.useT();
  const adjustments = useSalesAdjustments();
  const customFieldDraft = useCustomFieldDraft(selectedCompanyId, "quote", editingQuote?.id);
  const [sendingQuote, setSendingQuote] = useState<Quote | null>(null);
  const [signatureFor, setSignatureFor] = useState<Quote | null>(null);
  const { data: pickerProducts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", selectedCompanyId, "products"],
    enabled: !!selectedCompanyId,
  });
  const saveCustomFields = async (id: string | undefined) => {
    if (!id || !customFieldDraft.dirty) return;
    try {
      await customFieldDraft.save(id);
    } catch (error: any) {
      toast({ variant: "destructive", title: salesTr("customFieldsNotSaved"), description: salesErrorMessage(error, (k) => salesTr(k), salesTr("pleaseTryAgain")) });
    }
  };

  const form = useForm<QuoteFormData>({
    resolver: zodResolver(quoteSchema),
    defaultValues: {
      companyId: selectedCompanyId || "",
      number: `QT-${Date.now()}`,
      customerName: "",
      customerTrn: "",
      date: parseYmd(todayYmd()),
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
    mutationFn: async (data: QuoteFormData) => {
      const saved = await apiRequest("POST", `/api/companies/${selectedCompanyId}/quotes`, data);
      await saveCustomFields(saved?.id);
      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      toast({ title: tr("quoteCreated"), description: tr("yourQuoteHasBeenCreatedSuccessfully") });
      setDialogOpen(false);
      setEditingQuote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateQuote"),
        description: salesErrorMessage(error, (k) => salesTr(k), tr("pleaseTryAgain")),
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: QuoteFormData }) => {
      const saved = await apiRequest("PUT", `/api/quotes/${id}`, data);
      await saveCustomFields(id);
      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      toast({ title: tr("quoteUpdated"), description: tr("yourQuoteHasBeenUpdatedSuccessfully") });
      setDialogOpen(false);
      setEditingQuote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateQuote"),
        description: salesErrorMessage(error, (k) => salesTr(k), tr("pleaseTryAgain")),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/quotes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      toast({ title: tr("quoteDeleted"), description: tr("theQuoteHasBeenDeleted") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeleteQuote"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/quotes/${id}/convert-to-invoice`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "invoices"],
      });
      toast({
        title: tr("quoteConverted"),
        description: tr("theQuoteHasBeenConvertedTo"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToConvertQuote"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const reviseMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/quotes/${id}/revise`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      toast({ title: salesTr("quoteRevised"), description: salesTr("quoteRevisedBody") });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: salesTr("quoteReviseFailed"), description: salesErrorMessage(error, (k) => salesTr(k), salesTr("pleaseTryAgain")) }),
  });

  const toSalesOrderMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/quotes/${id}/convert-to-sales-order`),
    onSuccess: (order: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "sales-orders"] });
      toast({ title: salesTr("quoteToSoDone"), description: salesTr("quoteToSoDoneBody", { number: order?.number ?? "" }) });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: salesTr("quoteToSoFailed"), description: salesErrorMessage(error, (k) => salesTr(k), salesTr("pleaseTryAgain")) }),
  });

  const resetForm = () => {
    adjustments.reset();
    customFieldDraft.reset();
    form.reset({
      companyId: selectedCompanyId || "",
      number: `QT-${Date.now()}`,
      customerName: "",
      customerTrn: "",
      date: parseYmd(todayYmd()),
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
        contactId: fullQuote.contactId ?? null,
        date: (pickerDate(fullQuote.date) as Date),
        expiryDate: (pickerDate(fullQuote.expiryDate) as Date),
        currency: fullQuote.currency,
        notes: fullQuote.notes || "",
        lines: splitStoredLines(fullQuote.lines).items.length
          ? splitStoredLines(fullQuote.lines).items.map(itemFormFromRow) as QuoteFormData["lines"]
          : [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      adjustments.loadFrom(fullQuote);
      customFieldDraft.reset();
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("error"),
        description: error?.message || tr("failedToLoadQuoteDetails"),
      });
    }
  };

  const onSubmit = async (data: QuoteFormData) => {
    const salesBody = buildSalesBody({
      items: data.lines as ItemLineForm[],
      shipping: adjustments.shipping,
      shippingDescription: salesTr("shippingLineDescription"),
      discountType: adjustments.discountType,
      discountValue: adjustments.discountValue,
    });
    const quoteData = {
      ...data,
      companyId: selectedCompanyId!,
      contactId: data.contactId || null,
      ...salesBody,
    };

    if (editingQuote) {
      editMutation.mutate({ id: editingQuote.id, data: quoteData });
    } else {
      createMutation.mutate(quoteData);
    }
  };

  const watchLines = form.watch("lines");
  const preview = previewTotals({
    items: watchLines as ItemLineForm[],
    shipping: adjustments.shipping,
    discountType: adjustments.discountType,
    discountValue: adjustments.discountValue,
  });
  const watchContactId = form.watch("contactId");
  const priceResolution = usePriceListResolution(selectedCompanyId, watchContactId, form.watch("currency") || "AED");
  const availability = useProductAvailability(
    selectedCompanyId,
    watchLines.map((l) => l.productId)
  );

  if (!canAccess("quotes")) {
    return <UpgradePrompt feature="quotes" requiredTier={getRequiredTier("quotes")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("sales")}
        title={t.quotes}
        description={(t as any).quotesSubtitle ?? tr("createAndManageQuotesForYour")}
      />

      <div className="flex items-center justify-end flex-wrap gap-4">
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 me-2" />
              {tr("newQuote")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingQuote ? tr("editQuote") : tr("newQuote")}</DialogTitle>
              <DialogDescription>
                {editingQuote ? tr("updateQuoteDetails") : tr("createANewQuoteWithAutomatic")}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("quoteNumber")}</FormLabel>
                        <FormControl>
                          <Input {...field} className="font-mono" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("date")}</FormLabel>
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
                </div>

                <ContactPicker
                  companyId={selectedCompanyId}
                  contactId={watchContactId}
                  testId="select-quote-contact"
                  onSelect={(contact) => {
                    form.setValue("contactId", contact?.id ?? null);
                    if (contact) {
                      form.setValue("customerName", contact.name);
                      form.setValue("customerTrn", contact.trnNumber ?? "");
                    }
                  }}
                />
                {priceResolution.data?.priceListId && (
                  <p className="text-xs text-muted-foreground" data-testid="price-list-applied">
                    {salesTr("priceListApplied")}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("customerName")}</FormLabel>
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
                        <FormLabel>{tr("customerTrn")}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder={tr("optional")} className="font-mono" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="expiryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("expiryDate")}</FormLabel>
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
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("currency")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={tr("selectCurrency")} />
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
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("notes")}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={tr("optionalNotesForTheCustomer")}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{tr("lineItems")}</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        append({ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 })
                      }
                    >
                      <Plus className="w-4 h-4 me-2" />
                      {tr("addLine")}
                    </Button>
                  </div>

                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md"
                    >
                      <div className="col-span-12 sm:col-span-4">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.description`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} placeholder={tr("description")} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.quantity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder={tr("qty")}
                                  className="font-mono"
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
                      <div className="col-span-4 sm:col-span-2">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.unitPrice`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder={tr("price")}
                                  className="font-mono"
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
                      <div className="col-span-4 sm:col-span-2">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.vatRate`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Select
                                  value={vatSelectValue(field.value, watchLines[index]?.vatSupplyType)}
                                  onValueChange={(val) => {
                                    const picked = vatFromSelectValue(val);
                                    field.onChange(picked.vatRate);
                                    form.setValue(`lines.${index}.vatSupplyType`, picked.vatRate === 0 ? picked.vatSupplyType : null);
                                  }}
                                >
                                  <SelectTrigger className="font-mono">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="5">5%</SelectItem>
                                    <SelectItem value="0:zero_rated">{salesTr("vatZeroRated")}</SelectItem>
                                    <SelectItem value="0:exempt">{salesTr("vatExempt")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-10 sm:col-span-1">
                        <div className="h-10 flex items-center justify-end font-mono text-sm">
                          {formatCurrency(
                            lineTotalWithVat({
                              quantity: watchLines[index]?.quantity || 0,
                              unitPrice: watchLines[index]?.unitPrice || 0,
                              vatRate: watchLines[index]?.vatRate || 0,
                              discountType: watchLines[index]?.discountType,
                              discountValue: watchLines[index]?.discountValue,
                            }),
                            "AED",
                            locale
                          )}
                        </div>
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex items-center justify-center">
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
                      <div className="col-span-12 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span className="text-xs text-muted-foreground">{salesTr("lineDiscount")}</span>
                        <LineDiscountFields
                          label={String(index + 1)}
                          type={watchLines[index]?.discountType}
                          value={watchLines[index]?.discountValue}
                          testId={`quote-line-discount-${index}`}
                          onChange={(next) => {
                            form.setValue(`lines.${index}.discountType`, next.type);
                            form.setValue(`lines.${index}.discountValue`, next.value);
                          }}
                        />
                        <LineProductPicker
                          products={pickerProducts}
                          value={watchLines[index]?.productId}
                          testId={`quote-line-product-${index}`}
                          onPick={(picked) => {
                            form.setValue(`lines.${index}.productId`, picked?.id ?? null);
                            if (!picked) return;
                            form.setValue(`lines.${index}.description`, locale === "ar" && picked.nameAr ? picked.nameAr : picked.name);
                            const priced = priceForProduct(picked.id, picked.unitPrice, priceResolution.data);
                            form.setValue(`lines.${index}.unitPrice`, priced.unitPrice);
                            form.setValue(`lines.${index}.priceListId`, priced.priceListId);
                            const choice = vatChoiceOf(picked.vatRate, (picked as { vatSupplyType?: string | null }).vatSupplyType);
                            form.setValue(`lines.${index}.vatRate`, vatFieldsOf(choice).vatRate);
                            form.setValue(`lines.${index}.vatSupplyType`, choice === "standard_rated" ? null : choice);
                          }}
                        />
                        {watchLines[index]?.productId && (
                          <AvailabilityBadge
                            requested={Number(watchLines[index]?.quantity) || 0}
                            availability={availability.get(watchLines[index]?.productId as string)}
                            tracked={pickerProducts.find((p) => p.id === watchLines[index]?.productId)?.trackInventory !== false}
                            testId={`quote-availability-${index}`}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4 space-y-4">
                  <DocumentAdjustments
                    discountType={adjustments.discountType}
                    discountValue={adjustments.discountValue}
                    onDiscountChange={adjustments.setDiscount}
                    shipping={adjustments.shipping}
                    onShippingChange={adjustments.setShipping}
                  />
                  <CustomFieldsEditor draft={customFieldDraft} />
                  <SalesTotalsSummary preview={preview} currency="AED" />
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                    className="flex-1"
                  >
                    {tr("cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || editMutation.isPending}
                    className="flex-1"
                  >
                    {createMutation.isPending || editMutation.isPending ? tr("saving") : tr("save")}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold">{tr("number")}</TableHead>
                  <TableHead className="font-semibold">{tr("customer")}</TableHead>
                  <TableHead className="font-semibold">{tr("date")}</TableHead>
                  <TableHead className="font-semibold">{tr("expiry")}</TableHead>
                  <TableHead className="font-semibold text-end">{tr("total")}</TableHead>
                  <TableHead className="font-semibold text-center">{tr("status")}</TableHead>
                  <TableHead className="font-semibold text-center">{tr("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes && quotes.length > 0 ? (
                  quotes.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell className="font-mono font-medium">{quote.number}</TableCell>
                      <TableCell>{quote.customerName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(quote.date, locale)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(quote.expiryDate, locale)}
                      </TableCell>
                      <TableCell className="text-end font-mono font-medium">
                        {formatCurrency(quote.total, quote.currency, locale)}
                      </TableCell>
                      <TableCell className="text-center">
                        <QuoteStatusBadge status={quote.status} />
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {quoteActions(quote.status).edit && (
                              <DropdownMenuItem onClick={() => handleEditQuote(quote)}>
                                <Edit className="w-4 h-4 me-2" />
                                {tr("edit")}
                              </DropdownMenuItem>
                            )}
                            {quoteActions(quote.status).send && (
                              <DropdownMenuItem onClick={() => setSendingQuote(quote)} data-testid={`menu-send-quote-${quote.id}`}>
                                <Send className="w-4 h-4 me-2" />
                                {salesTr("sendQuote")}
                              </DropdownMenuItem>
                            )}
                            {quoteActions(quote.status).revise && (
                              <DropdownMenuItem onClick={() => reviseMutation.mutate(quote.id)} data-testid={`menu-revise-quote-${quote.id}`}>
                                <Undo2 className="w-4 h-4 me-2" />
                                {salesTr("reviseQuote")}
                              </DropdownMenuItem>
                            )}
                            {(quote.status === "accepted" || quote.status === "declined") && (
                              <DropdownMenuItem onClick={() => setSignatureFor(quote)} data-testid={`menu-signature-quote-${quote.id}`}>
                                <ShieldCheck className="w-4 h-4 me-2" />
                                {salesTr("viewResponse")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => convertMutation.mutate(quote.id)}
                              disabled={!quoteActions(quote.status).convert}
                            >
                              <ArrowRightLeft className="w-4 h-4 me-2" />
                              {tr("convertToInvoice")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => toSalesOrderMutation.mutate(quote.id)}
                              disabled={!quoteActions(quote.status).convert}
                              data-testid={`menu-quote-to-so-${quote.id}`}
                            >
                              <ClipboardList className="w-4 h-4 me-2" />
                              {salesTr("convertToSalesOrder")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, "_blank")}
                            >
                              <Download className="w-4 h-4 me-2" />
                              {tr("downloadPdf")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                downloadPdf(
                                  `/api/quotes/${quote.id}/pdf?variant=proforma`,
                                  `proforma-${quote.number}.pdf`
                                ).catch((err: Error) =>
                                  toast({
                                    title: tr("proformaFailed"),
                                    description: err.message,
                                    variant: "destructive",
                                  })
                                )
                              }
                              data-testid={`menu-proforma-${quote.id}`}
                            >
                              <FileText className="w-4 h-4 me-2" />
                              {tr("downloadProforma")}
                            </DropdownMenuItem>
                            {quoteActions(quote.status).remove && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  if (window.confirm(tr("areYouSureYouWantTo"))) {
                                    deleteMutation.mutate(quote.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4 me-2" />
                                {tr("delete")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-4">
                      <EmptyState
                        icon={FileText}
                        title={(t as any).noQuotesYet ?? tr("noQuotesYet")}
                        description={
                          (t as any).quotesEmptyDesc ?? tr("sendAProfessionalQuoteInMinutes")
                        }
                        action={{
                          label: (t as any).newQuote ?? tr("newQuote"),
                          onClick: () => setDialogOpen(true),
                        }}
                        testId="empty-quotes"
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {selectedCompanyId && (
        <QuoteSendDialog quote={sendingQuote} companyId={selectedCompanyId} onClose={() => setSendingQuote(null)} />
      )}
      <Dialog open={signatureFor !== null} onOpenChange={(open) => !open && setSignatureFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{salesTr("viewResponseTitle", { number: signatureFor?.number ?? "" })}</DialogTitle>
            <DialogDescription>{salesTr("viewResponseHelp")}</DialogDescription>
          </DialogHeader>
          {signatureFor && <SignatureRecord quoteId={signatureFor.id} />}
          {signatureFor?.status === "accepted" && (
            <Button asChild variant="outline">
              <Link href="/sales-orders">{salesTr("openSalesOrders")}</Link>
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
