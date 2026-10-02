import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { salesErrorMessage, salesKeys, type PriceListSummary } from "@/lib/sales-api";
import type { PickerProduct } from "./LineProductPicker";
import { messages } from "./SalesShared.i18n";

interface Row { productId: string; unitPrice: string }

/** Price lists: a name, a currency and a price per product. A list is attached to a customer on the contact. */
export function PriceListsPanel({ companyId }: { companyId: string }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PriceListSummary | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("AED");
  const [isActive, setIsActive] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  const lists = useQuery<PriceListSummary[]>({ queryKey: salesKeys.priceLists(companyId) });
  const products = useQuery<PickerProduct[]>({ queryKey: ["/api/companies", companyId, "products"] });
  const productName = (id: string) => {
    const p = products.data?.find((x) => x.id === id);
    return p ? (locale === "ar" && p.nameAr ? p.nameAr : p.name) : id;
  };

  const startNew = () => {
    setEditing(null); setName(""); setCurrency("AED"); setIsActive(true); setRows([{ productId: "", unitPrice: "" }]); setOpen(true);
  };
  const startEdit = async (list: PriceListSummary) => {
    try {
      const full: PriceListSummary = await apiRequest("GET", `/api/companies/${companyId}/price-lists/${list.id}`);
      setEditing(full); setName(full.name); setCurrency(full.currency); setIsActive(full.isActive);
      setRows((full.items ?? []).map((i) => ({ productId: i.productId, unitPrice: String(i.unitPrice) })));
      setOpen(true);
    } catch (error) {
      toast({ variant: "destructive", title: tr("priceListLoadFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) });
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: salesKeys.priceLists(companyId) });
  const items = rows.filter((r) => r.productId && Number(r.unitPrice) > 0).map((r) => ({ productId: r.productId, unitPrice: Number(r.unitPrice) }));
  const duplicate = new Set(items.map((i) => i.productId)).size !== items.length;

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), currency, isActive, items };
      return editing ? apiRequest("PUT", `/api/companies/${companyId}/price-lists/${editing.id}`, body) : apiRequest("POST", `/api/companies/${companyId}/price-lists`, body);
    },
    onSuccess: () => { toast({ title: editing ? tr("priceListUpdated") : tr("priceListCreated") }); setOpen(false); refresh(); },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("priceListSaveFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/companies/${companyId}/price-lists/${id}`),
    onSuccess: () => { toast({ title: tr("priceListDeleted") }); refresh(); },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("priceListDeleteFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  return (
    <Card data-testid="price-lists-panel">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><Tag className="h-5 w-5" />{tr("priceLists")}</CardTitle>
          <CardDescription>{tr("priceListsHelp")}</CardDescription>
        </div>
        <Button onClick={startNew} data-testid="button-new-price-list"><Plus className="me-2 h-4 w-4" />{tr("newPriceList")}</Button>
      </CardHeader>
      <CardContent>
        {(lists.data ?? []).length === 0 ? (
          <EmptyState compact icon={Tag} title={tr("noPriceLists")} description={tr("noPriceListsBody")} testId="empty-price-lists" />
        ) : (
          <ul className="space-y-2">
            {lists.data!.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2" data-testid={`price-list-${l.name}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.name}</span>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">{l.currency}</span>
                  <StatusBadge tone={l.isActive ? "success" : "neutral"}>{l.isActive ? tr("active") : tr("inactive")}</StatusBadge>
                  <span className="text-xs text-muted-foreground">{tr("priceListItems", { count: l.items?.length ?? 0 })}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(l)} aria-label={tr("editPriceList", { name: l.name })}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => window.confirm(tr("deletePriceListConfirm", { name: l.name })) && remove.mutate(l.id)} aria-label={tr("deletePriceListAria", { name: l.name })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? tr("editPriceList", { name: editing.name }) : tr("newPriceList")}</DialogTitle>
            <DialogDescription>{tr("priceListDialogHelp")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="price-list-name">{tr("name")}</Label>
                <Input id="price-list-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-price-list-name" />
              </div>
              <div className="space-y-1.5">
                <Label>{tr("currency")}</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["AED", "USD", "EUR", "GBP", "SAR"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <Label htmlFor="price-list-active">{tr("priceListActive")}</Label>
              <Switch id="price-list-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{tr("priceListPrices")}</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, { productId: "", unitPrice: "" }])}><Plus className="me-2 h-4 w-4" />{tr("addProduct")}</Button>
              </div>
              {(products.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{tr("noProductsYet")}</p>}
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2" data-testid={`price-row-${i}`}>
                  <Select value={r.productId || undefined} onValueChange={(v) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, productId: v } : x)))}>
                    <SelectTrigger aria-label={tr("priceRowProduct", { row: i + 1 })} data-testid={`select-price-product-${i}`}><SelectValue placeholder={tr("selectProduct")} /></SelectTrigger>
                    <SelectContent>{(products.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{productName(p.id)}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0.01} step="0.01" dir="ltr" className="w-32 font-mono" aria-label={tr("priceRowPrice", { row: i + 1 })} value={r.unitPrice} onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} data-testid={`input-price-value-${i}`} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} aria-label={tr("removeRow", { row: i + 1 })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {duplicate && <p role="alert" className="text-xs text-destructive">{tr("duplicateProduct")}</p>}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>{tr("cancel")}</Button>
              <Button className="flex-1" disabled={!name.trim() || duplicate || save.isPending} onClick={() => save.mutate()} data-testid="button-save-price-list">{save.isPending ? tr("saving") : tr("save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
