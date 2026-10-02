import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  buildSalesBody,
  itemFormFromRow,
  lineTotalWithVat,
  previewTotals,
  priceForProduct,
  salesErrorMessage,
  salesKeys,
  splitStoredLines,
  type ItemLineForm,
  type SalesOrderDetail,
} from "@/lib/sales-api";
import { AvailabilityBadge, useProductAvailability } from "./AvailabilityBadge";
import { ContactPicker, usePriceListResolution } from "./ContactPicker";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { DocumentAdjustments, SalesTotalsSummary } from "./DocumentAdjustments";
import { LineDiscountFields } from "./LineDiscountFields";
import { LineProductPicker, type PickerProduct } from "./LineProductPicker";
import { messages } from "./SalesShared.i18n";
import { useCustomFieldDraft } from "./useCustomFieldDraft";
import { useSalesAdjustments } from "./useSalesAdjustments";

const todayYmd = () => new Date().toISOString().slice(0, 10);
const ymdOf = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");
const blankLine = (): ItemLineForm => ({ description: "", quantity: 1, unitPrice: 0, vatRate: 0.05, discountType: null, discountValue: null });

interface Props {
  companyId: string;
  open: boolean;
  /** The order being edited, or null for a new one. */
  order: SalesOrderDetail | null;
  onClose: () => void;
}

/** New / edit sales order: customer, lines with percent discounts, shipping, custom fields, and stock availability per line. */
export function SalesOrderEditor({ companyId, open, order, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const adjustments = useSalesAdjustments();
  const customFieldDraft = useCustomFieldDraft(companyId, "sales_order", order?.id);

  const [contactId, setContactId] = useState<string | null>(null);
  const [date, setDate] = useState(todayYmd());
  const [expectedDate, setExpectedDate] = useState("");
  const [currency, setCurrency] = useState("AED");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ItemLineForm[]>([blankLine()]);

  const { data: products = [] } = useQuery<PickerProduct[]>({
    queryKey: ["/api/companies", companyId, "products"],
    enabled: open && !!companyId,
  });
  const priceResolution = usePriceListResolution(companyId, contactId, currency);
  const availability = useProductAvailability(companyId, open ? lines.map((l) => l.productId) : []);

  // Open on a fresh form, or on the order being edited.
  useEffect(() => {
    if (!open) return;
    if (order) {
      setContactId(order.contactId);
      setDate(ymdOf(order.date));
      setExpectedDate(ymdOf(order.expectedDate));
      setCurrency(order.currency);
      setNotes(order.notes ?? "");
      const items = splitStoredLines(order.lines).items.map(itemFormFromRow);
      setLines(items.length ? items : [blankLine()]);
      adjustments.loadFrom(order);
    } else {
      setContactId(null);
      setDate(todayYmd());
      setExpectedDate("");
      setCurrency("AED");
      setNotes("");
      setLines([blankLine()]);
      adjustments.reset();
    }
    customFieldDraft.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  const setLine = (index: number, patch: Partial<ItemLineForm>) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const preview = previewTotals({ items: lines, shipping: adjustments.shipping, discountType: adjustments.discountType, discountValue: adjustments.discountValue });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        contactId,
        date,
        expectedDate: expectedDate || null,
        currency,
        notes: notes.trim() || null,
        ...buildSalesBody({
          items: lines,
          shipping: adjustments.shipping,
          shippingDescription: tr("shippingLineDescription"),
          discountType: adjustments.discountType,
          discountValue: adjustments.discountValue,
        }),
      };
      const saved: SalesOrderDetail = order
        ? await apiRequest("PUT", `/api/companies/${companyId}/sales-orders/${order.id}`, body)
        : await apiRequest("POST", `/api/companies/${companyId}/sales-orders`, body);
      if (customFieldDraft.dirty) {
        try {
          await customFieldDraft.save(saved.id);
        } catch (error) {
          toast({ variant: "destructive", title: tr("customFieldsNotSaved"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) });
        }
      }
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: salesKeys.salesOrders(companyId) });
      toast({ title: order ? tr("soUpdated") : tr("soCreated"), description: saved.number });
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: tr("soSaveFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  const canSave = !!contactId && lines.some((l) => l.description.trim() !== "" && Number(l.quantity) > 0) && !(preview && !preview.ok);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="sales-order-editor">
        <DialogHeader>
          <DialogTitle>{order ? tr("editSalesOrder", { number: order.number }) : tr("newSalesOrder")}</DialogTitle>
          <DialogDescription>{tr("salesOrderHelp")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <ContactPicker companyId={companyId} contactId={contactId} required testId="select-so-contact" onSelect={(c) => setContactId(c?.id ?? null)} label={tr("customer")} />
          {priceResolution.data?.priceListId && <p className="text-xs text-muted-foreground">{tr("priceListApplied")}</p>}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="so-date">{tr("orderDate")}</Label>
              <Input id="so-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-so-date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-expected">{tr("expectedDate")}</Label>
              <Input id="so-expected" type="date" dir="ltr" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} data-testid="input-so-expected" />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("currency")}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger data-testid="select-so-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["AED", "USD", "EUR", "GBP", "SAR"].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{tr("lineItems")}</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])} data-testid="button-so-add-line">
                <Plus className="me-2 h-4 w-4" />
                {tr("addLine")}
              </Button>
            </div>
            {lines.map((line, index) => {
              const product = products.find((p) => p.id === line.productId);
              const stored = order?.lines.find((l) => l.productId === line.productId && l.availableToPromise !== null && l.availableToPromise !== undefined);
              return (
                <div key={index} className="grid grid-cols-12 items-start gap-2 rounded-md border p-3" data-testid={`so-line-${index}`}>
                  <div className="col-span-12 sm:col-span-4">
                    <Input
                      placeholder={tr("description")}
                      aria-label={tr("lineDescription", { line: index + 1 })}
                      value={line.description}
                      onChange={(e) => setLine(index, { description: e.target.value })}
                      data-testid={`input-so-description-${index}`}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      dir="ltr"
                      className="font-mono"
                      placeholder={tr("qty")}
                      aria-label={tr("lineQuantity", { line: index + 1 })}
                      value={line.quantity}
                      onChange={(e) => setLine(index, { quantity: e.target.value === "" ? "" : parseFloat(e.target.value) })}
                      data-testid={`input-so-qty-${index}`}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      dir="ltr"
                      className="font-mono"
                      placeholder={tr("price")}
                      aria-label={tr("lineUnitPrice", { line: index + 1 })}
                      value={line.unitPrice}
                      onChange={(e) => setLine(index, { unitPrice: e.target.value === "" ? "" : parseFloat(e.target.value) })}
                      data-testid={`input-so-price-${index}`}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Select value={String(Math.round(line.vatRate * 100))} onValueChange={(v) => setLine(index, { vatRate: parseFloat(v) / 100, vatSupplyType: null })}>
                      <SelectTrigger className="font-mono" aria-label={tr("lineVat", { line: index + 1 })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0%</SelectItem>
                        <SelectItem value="5">5%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-10 flex h-10 items-center justify-end font-mono text-sm sm:col-span-1">{formatCurrency(lineTotalWithVat(line), currency, locale)}</div>
                  <div className="col-span-2 flex items-center justify-center sm:col-span-1">
                    {lines.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))} aria-label={tr("removeLine", { line: index + 1 })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="col-span-12 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-xs text-muted-foreground">{tr("lineDiscount")}</span>
                    <LineDiscountFields
                      label={String(index + 1)}
                      percentOnly
                      type={line.discountType}
                      value={line.discountValue}
                      testId={`so-line-discount-${index}`}
                      onChange={(next) => setLine(index, { discountType: next.type, discountValue: next.value })}
                    />
                    <LineProductPicker
                      products={products}
                      value={line.productId}
                      testId={`so-line-product-${index}`}
                      onPick={(picked) => {
                        if (!picked) return setLine(index, { productId: null, priceListId: null });
                        const priced = priceForProduct(picked.id, picked.unitPrice, priceResolution.data);
                        setLine(index, {
                          productId: picked.id,
                          description: locale === "ar" && picked.nameAr ? picked.nameAr : picked.name,
                          unitPrice: priced.unitPrice,
                          priceListId: priced.priceListId,
                          vatRate: Number(picked.vatRate) === 0 ? 0 : 0.05,
                          vatSupplyType: null,
                        });
                      }}
                    />
                    {line.productId && (
                      <AvailabilityBadge
                        requested={Number(line.quantity) || 0}
                        availability={stored ? { available: Number(stored.availableToPromise) } : availability.get(line.productId)}
                        tracked={product?.trackInventory !== false}
                        testId={`so-availability-${index}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-notes">{tr("notes")}</Label>
            <Textarea id="so-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="space-y-4 border-t pt-4">
            <DocumentAdjustments
              percentOnly
              discountType={adjustments.discountType}
              discountValue={adjustments.discountValue}
              onDiscountChange={adjustments.setDiscount}
              shipping={adjustments.shipping}
              onShippingChange={adjustments.setShipping}
            />
            <CustomFieldsEditor draft={customFieldDraft} />
            <SalesTotalsSummary preview={preview} currency={currency} />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              {tr("cancel")}
            </Button>
            <Button type="button" className="flex-1" disabled={!canSave || save.isPending} onClick={() => save.mutate()} data-testid="button-save-so">
              {save.isPending ? tr("saving") : tr("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
