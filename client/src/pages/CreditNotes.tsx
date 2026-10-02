import { PageHeader } from "@/components/ui/page-header";
import { pickerDate, parseYmd, todayYmd, formatCalendarDate } from "@/lib/calendar-date";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
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
import {
  Plus,
  CalendarIcon,
  Trash2,
  Download,
  Banknote,
  MoreHorizontal,
  FileText,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { CreditNoteRefunds, type RefundableCreditNote } from "@/components/CreditNoteRefunds";
import { messages as pageMessages } from "./CreditNotes.i18n";
import { CreditNoteDialog } from "@/components/sales/CreditNoteDialog";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";

const creditNoteLineSchema = z.object({
  description: z.string().min(1, pageMessages.marker("descriptionIsRequired")),
  quantity: z.coerce.number().min(0.01, pageMessages.marker("quantityMustBePositive")),
  unitPrice: z.coerce.number().min(0, pageMessages.marker("priceMustBePositive")),
  vatRate: z.coerce.number().default(0.05),
});

const creditNoteSchema = z.object({
  companyId: z.string().uuid(),
  number: z.string().min(1, pageMessages.marker("creditNoteNumberIsRequired")),
  invoiceId: z.string().optional(),
  customerName: z.string().min(1, pageMessages.marker("customerNameIsRequired")),
  customerTrn: z.string().optional(),
  date: z.date(),
  reason: z.string().min(1, pageMessages.marker("reasonIsRequired")),
  lines: z.array(creditNoteLineSchema).min(1, pageMessages.marker("atLeastOneLineItemIs")),
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
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedInvoiceId, setPickedInvoiceId] = useState<string | null>(null);
  const [creditInvoiceId, setCreditInvoiceId] = useState<string | null>(null);
  const salesTr = salesMessages.useT();
  const [editingCreditNote, setEditingCreditNote] = useState<CreditNote | null>(null);
  const [refundTarget, setRefundTarget] = useState<RefundableCreditNote | null>(null);

  const { data: creditNotes, isLoading } = useQuery<CreditNote[]>({
    queryKey: ["/api/companies", selectedCompanyId, "credit-notes"],
    enabled: !!selectedCompanyId,
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
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
      date: parseYmd(todayYmd()),
      reason: "",
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
    mutationFn: (data: CreditNoteFormData) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/credit-notes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "credit-notes"],
      });
      toast({
        title: tr("creditNoteCreated"),
        description: tr("yourCreditNoteHasBeenCreated"),
      });
      setDialogOpen(false);
      setEditingCreditNote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateCreditNote"),
        description: error?.message || tr("pleaseTryAgain"),
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
        title: tr("creditNoteUpdated"),
        description: tr("yourCreditNoteHasBeenUpdated"),
      });
      setDialogOpen(false);
      setEditingCreditNote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateCreditNote"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  // The delete / issue / void mutations that used to live here targeted the
  // retired standalone credit-note endpoints (the server answers 410 — credit
  // notes are created from the original invoice so VAT, FX and journal entries
  // stay unified). Their UI triggers were permanently disabled and have been
  // removed, so the mutations had no callers left. Removed rather than kept as
  // dead code that reads like working functionality.

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId || "",
      number: `CN-${Date.now()}`,
      invoiceId: "",
      customerName: "",
      customerTrn: "",
      date: parseYmd(todayYmd()),
      reason: "",
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditingCreditNote(null);
  };

  const handleEditCreditNote = async (creditNote: CreditNote) => {
    try {
      const full = await apiRequest("GET", `/api/credit-notes/${creditNote.id}`);
      setEditingCreditNote(full);
      form.reset({
        companyId: full.companyId,
        number: full.number,
        invoiceId: full.invoiceId || "",
        customerName: full.customerName,
        customerTrn: full.customerTrn || "",
        date: (pickerDate(full.date) as Date),
        reason: full.reason || "",
        lines: full.lines || [{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("error"),
        description: error?.message || tr("failedToLoadCreditNoteDetails"),
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

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "draft":
        return "bg-muted text-foreground ";
      case "issued":
        return "bg-success-subtle text-success ";
      case "void":
        return "bg-danger-subtle text-destructive ";
      default:
        return "bg-muted text-foreground ";
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
          description={tr("issueCreditNotesAgainstInvoicesManage")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("sales")}
        title={t.creditNotes}
        description={(t as any).creditNotesSubtitle ?? tr("viewCreditNotesCreatedFromInvoices")}
      />

      <div className="flex items-center justify-end flex-wrap gap-4">
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <Button onClick={() => setPickerOpen(true)} data-testid="button-credit-from-invoice">
            <Plus className="w-4 h-4 me-2" />
            {tr("createFromInvoice")}
          </Button>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingCreditNote ? tr("editCreditNote") : tr("newCreditNote")}
              </DialogTitle>
              <DialogDescription>
                {editingCreditNote
                  ? tr("updateCreditNoteDetails")
                  : tr("createANewCreditNoteLinked")}
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
                        <FormLabel>{tr("creditNoteNumber")}</FormLabel>
                        <FormControl>
                          <Input {...field} className="font-mono" />
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
                        <FormLabel>{tr("relatedInvoice")}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={tr("selectInvoiceOptional")} />
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
                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("reason")}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder={tr("reasonForCreditNote")} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                      <div className="col-span-4">
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
                                  <SelectTrigger className="font-mono">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="0">0%</SelectItem>
                                    <SelectItem value="5">5%</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-1">
                        <div className="h-10 flex items-center justify-end font-mono text-sm">
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
                    <span className="text-muted-foreground">{tr("subtotal")}</span>
                    <span dir="ltr" className="font-mono font-medium">
                      {formatCurrency(subtotal, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr("vat")}</span>
                    <span dir="ltr" className="font-mono font-medium">
                      {formatCurrency(vatAmount, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                    <span>{tr("total")}</span>
                    <span dir="ltr" className="font-mono">
                      {formatCurrency(total, "AED", locale)}
                    </span>
                  </div>
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
                  <TableHead className="font-semibold">{tr("invoice")}</TableHead>
                  <TableHead className="font-semibold">{tr("date")}</TableHead>
                  <TableHead className="font-semibold text-end">{tr("total")}</TableHead>
                  <TableHead className="font-semibold text-center">{tr("status")}</TableHead>
                  <TableHead className="font-semibold text-center">{tr("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditNotes && creditNotes.length > 0 ? (
                  creditNotes.map((creditNote) => (
                    <TableRow key={creditNote.id}>
                      <TableCell className="font-mono font-medium">{creditNote.number}</TableCell>
                      <TableCell>{creditNote.customerName}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {creditNote.invoiceNumber || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(creditNote.date, locale)}
                      </TableCell>
                      <TableCell className="text-end font-mono font-medium">
                        {formatCurrency(creditNote.total, creditNote.currency || "AED", locale)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={cn("capitalize", getStatusBadgeColor(creditNote.status))}>
                          {creditNote.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {/* Edit / Issue / Void / Delete were permanently
                                disabled: standalone credit-note writes are
                                retired (the server answers 410). Credit notes
                                are created from the original invoice so VAT,
                                FX and journal entries stay unified. Showing
                                four un-clickable items was pure noise, so they
                                are removed rather than left greyed out. */}
                            {creditNote.status === "issued" ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  setRefundTarget({
                                    id: creditNote.id,
                                    number: creditNote.number,
                                    customerName: creditNote.customerName,
                                    currency: creditNote.currency || "AED",
                                  })
                                }
                                data-testid={`menu-refund-${creditNote.id}`}
                              >
                                <Banknote className="w-4 h-4 me-2" />
                                {tr("refund")}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(`/api/credit-notes/${creditNote.id}/pdf`, "_blank")
                              }
                            >
                              <Download className="w-4 h-4 me-2" />
                              {tr("downloadPdf")}
                            </DropdownMenuItem>
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
                        title={(t as any).noCreditNotesYet ?? tr("noCreditNotesYet")}
                        description={
                          (t as any).creditNotesEmptyDesc ?? tr("issueACreditNoteToCorrect")
                        }
                        action={{
                          label: tr("createFromInvoice"),
                          onClick: () => setPickerOpen(true),
                        }}
                        testId="empty-credit-notes"
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <CreditNoteRefunds
        companyId={selectedCompanyId ?? ""}
        creditNote={refundTarget}
        onOpenChange={(open) => {
          if (!open) setRefundTarget(null);
        }}
      />

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md" data-testid="credit-invoice-picker">
          <DialogHeader>
            <DialogTitle>{salesTr("pickInvoiceToCredit")}</DialogTitle>
            <DialogDescription>{salesTr("pickInvoiceToCreditHelp")}</DialogDescription>
          </DialogHeader>
          <Select value={pickedInvoiceId ?? undefined} onValueChange={setPickedInvoiceId}>
            <SelectTrigger data-testid="select-credit-invoice">
              <SelectValue placeholder={salesTr("selectInvoice")} />
            </SelectTrigger>
            <SelectContent>
              {(invoices as Array<Invoice & { status?: string; invoiceType?: string }>)
                .filter((i) => i.invoiceType !== "credit_note" && i.invoiceType !== "advance" && i.status && !["draft", "void", "cancelled"].includes(i.status))
                .map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.number} - {i.customerName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!pickedInvoiceId}
            onClick={() => {
              setCreditInvoiceId(pickedInvoiceId);
              setPickerOpen(false);
            }}
            data-testid="button-continue-credit"
          >
            {salesTr("continueLabel")}
          </Button>
        </DialogContent>
      </Dialog>
      {selectedCompanyId && (
        <CreditNoteDialog companyId={selectedCompanyId} invoiceId={creditInvoiceId} onClose={() => setCreditInvoiceId(null)} />
      )}
    </div>
  );
}
