import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
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
import {
  Plus,
  CalendarIcon,
  Trash2,
  Download,
  Edit,
  MoreHorizontal,
  Send,
  CheckCircle,
  PackageCheck,
  ShoppingCart,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { messages as pageMessages } from "./PurchaseOrders.i18n";

const poLineSchema = z.object({
  description: z.string().min(1, pageMessages.marker("descriptionIsRequired")),
  quantity: z.coerce.number().min(0.01, pageMessages.marker("quantityMustBePositive")),
  unitPrice: z.coerce.number().min(0, pageMessages.marker("priceMustBePositive")),
  vatRate: z.coerce.number().default(0.05),
});

const purchaseOrderSchema = z.object({
  companyId: z.string().uuid(),
  number: z.string().min(1, pageMessages.marker("poNumberIsRequired")),
  vendorName: z.string().min(1, pageMessages.marker("vendorNameIsRequired")),
  vendorTrn: z.string().optional(),
  date: z.date(),
  expectedDeliveryDate: z.date(),
  currency: z.string().default("AED"),
  notes: z.string().optional(),
  lines: z.array(poLineSchema).min(1, pageMessages.marker("atLeastOneLineItemIs")),
});

type PurchaseOrderFormData = z.infer<typeof purchaseOrderSchema>;

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
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
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
    mutationFn: (data: PurchaseOrderFormData) =>
      apiRequest("POST", `/api/companies/${selectedCompanyId}/purchase-orders`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      toast({
        title: tr("purchaseOrderCreated"),
        description: tr("yourPurchaseOrderHasBeenCreated"),
      });
      setDialogOpen(false);
      setEditingPO(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreatePurchaseOrder"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PurchaseOrderFormData }) =>
      apiRequest("PUT", `/api/purchase-orders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      toast({
        title: tr("purchaseOrderUpdated"),
        description: tr("yourPurchaseOrderHasBeenUpdated"),
      });
      setDialogOpen(false);
      setEditingPO(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdatePurchaseOrder"),
        description: error?.message || tr("pleaseTryAgain"),
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
        title: tr("purchaseOrderDeleted"),
        description: tr("thePurchaseOrderHasBeenDeleted"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeletePurchaseOrder"),
        description: error?.message || tr("pleaseTryAgain"),
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
      };
      const action = actionMap[status];
      if (!action) throw new Error(`Unknown status: ${status}`);
      return apiRequest("POST", `/api/purchase-orders/${id}/${action}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "purchase-orders"],
      });
      toast({ title: tr("statusUpdated"), description: tr("purchaseOrderStatusHasBeenUpdated") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateStatus"),
        description: error?.message || tr("pleaseTryAgain"),
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
        title: tr("error"),
        description: error?.message || tr("failedToLoadPurchaseOrderDetails"),
      });
    }
  };

  const onSubmit = async (data: PurchaseOrderFormData) => {
    const poData = {
      ...data,
      companyId: selectedCompanyId!,
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

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "draft":
        return "bg-muted text-foreground ";
      case "sent":
        return "bg-info-subtle text-info ";
      case "approved":
        return "bg-success-subtle text-success ";
      case "received":
        return "bg-success-subtle text-success ";
      case "cancelled":
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

  if (!canAccess("purchaseOrders")) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <UpgradePrompt
          feature="purchaseOrders"
          requiredTier={getRequiredTier("purchaseOrders")}
          description={tr("createAndTrackPurchaseOrdersTo")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("purchases")}
        title={t.purchaseOrders}
        description={(t as any).purchaseOrdersSubtitle ?? tr("createAndManagePurchaseOrdersFor")}
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
              {tr("newPurchaseOrder")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingPO ? tr("editPurchaseOrder") : tr("newPurchaseOrder")}
              </DialogTitle>
              <DialogDescription>
                {editingPO ? tr("updatePurchaseOrderDetails") : tr("createANewPurchaseOrderWith")}
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
                        <FormLabel>{tr("poNumber")}</FormLabel>
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
                                  format(field.value, "PPP")
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

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="vendorName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("vendorName")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
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
                        <FormLabel>{tr("vendorTrn")}</FormLabel>
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
                    name="expectedDeliveryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tr("expectedDeliveryDate")}</FormLabel>
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
                                  format(field.value, "PPP")
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
                          placeholder={tr("optionalNotesOrSpecialInstructions")}
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
                  <TableHead className="font-semibold">{tr("vendor")}</TableHead>
                  <TableHead className="font-semibold">{tr("date")}</TableHead>
                  <TableHead className="font-semibold">{tr("expectedDelivery")}</TableHead>
                  <TableHead className="font-semibold text-end">{tr("total")}</TableHead>
                  <TableHead className="font-semibold text-center">{tr("status")}</TableHead>
                  <TableHead className="font-semibold text-center">{tr("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders && purchaseOrders.length > 0 ? (
                  purchaseOrders.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono font-medium">{po.number}</TableCell>
                      <TableCell>{po.vendorName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(po.date, locale)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {po.expectedDeliveryDate
                          ? formatDate(po.expectedDeliveryDate, locale)
                          : "-"}
                      </TableCell>
                      <TableCell className="text-end font-mono font-medium">
                        {formatCurrency(po.total, po.currency, locale)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={cn("capitalize", getStatusBadgeColor(po.status))}>
                          {po.status}
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
                            <DropdownMenuItem
                              onClick={() => handleEditPO(po)}
                              disabled={po.status !== "draft"}
                            >
                              <Edit className="w-4 h-4 me-2" />
                              {tr("edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updateStatusMutation.mutate({ id: po.id, status: "sent" })
                              }
                              disabled={po.status !== "draft"}
                            >
                              <Send className="w-4 h-4 me-2" />
                              {tr("send")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updateStatusMutation.mutate({ id: po.id, status: "approved" })
                              }
                              disabled={po.status !== "sent"}
                            >
                              <CheckCircle className="w-4 h-4 me-2" />
                              {tr("approve")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updateStatusMutation.mutate({ id: po.id, status: "received" })
                              }
                              disabled={po.status !== "approved"}
                            >
                              <PackageCheck className="w-4 h-4 me-2" />
                              {tr("receive")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(`/api/purchase-orders/${po.id}/pdf`, "_blank")
                              }
                            >
                              <Download className="w-4 h-4 me-2" />
                              {tr("downloadPdf")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (window.confirm(tr("areYouSureYouWantTo"))) {
                                  deleteMutation.mutate(po.id);
                                }
                              }}
                              disabled={po.status !== "draft"}
                            >
                              <Trash2 className="w-4 h-4 me-2" />
                              {tr("delete")}
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
                        icon={ShoppingCart}
                        title={(t as any).noPurchaseOrdersYet ?? tr("noPurchaseOrdersYet")}
                        description={
                          (t as any).purchaseOrdersEmptyDesc ?? tr("trackWhatYouVeOrderedFrom")
                        }
                        action={{
                          label: (t as any).newPurchaseOrder ?? tr("newPurchaseOrder"),
                          onClick: () => setDialogOpen(true),
                        }}
                        testId="empty-purchase-orders"
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
