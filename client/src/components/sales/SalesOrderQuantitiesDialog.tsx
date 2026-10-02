import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { salesErrorMessage, salesKeys, type SalesOrderDetail } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

export type QuantityMode = "invoice" | "deliver";

interface Props {
  companyId: string;
  order: SalesOrderDetail | null;
  mode: QuantityMode;
  onClose: () => void;
  /** Called with the refreshed order after a successful save. */
  onDone: () => void;
}

const todayYmd = () => new Date().toISOString().slice(0, 10);

/** How much of each line to invoice (a draft invoice) or deliver (a delivery note). Quantities start at what is left. */
export function SalesOrderQuantitiesDialog({ companyId, order, mode, onClose, onDone }: Props) {
  const tr = messages.useT();
  const { toast } = useToast();
  const [date, setDate] = useState(todayYmd());
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

  const rows = (order?.lines ?? [])
    .filter((l) => (mode === "invoice" ? l.lineKind === "item" || l.lineKind === "shipping" : l.lineKind === "item"))
    .map((l) => {
      const ordered = Number(l.quantity);
      const done = Number((mode === "invoice" ? l.invoicedQty : l.deliveredQty) ?? 0);
      return { line: l, ordered, done, left: Math.max(0, Math.round((ordered - done) * 1e6) / 1e6) };
    });

  useEffect(() => {
    if (!order) return;
    setDate(todayYmd());
    setNotes("");
    setQty(Object.fromEntries(rows.map((r) => [r.line.id as string, r.left > 0 ? String(r.left) : ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, mode]);

  const chosen = rows
    .map((r) => ({ id: r.line.id as string, quantity: Number(qty[r.line.id as string] ?? ""), left: r.left }))
    .filter((r) => Number.isFinite(r.quantity) && r.quantity > 0);
  const overLeft = chosen.some((c) => c.quantity > c.left + 1e-9);

  const submit = useMutation({
    mutationFn: () => {
      const lines = chosen.map((c) => ({ salesOrderLineId: c.id, quantity: c.quantity }));
      return mode === "invoice"
        ? apiRequest("POST", `/api/companies/${companyId}/sales-orders/${order!.id}/invoices`, { date, lines })
        : apiRequest("POST", `/api/companies/${companyId}/sales-orders/${order!.id}/deliveries`, { date, notes: notes.trim() || null, lines });
    },
    onSuccess: (created: { number?: string }) => {
      queryClient.invalidateQueries({ queryKey: salesKeys.salesOrders(companyId) });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      toast({
        title: mode === "invoice" ? tr("soInvoiceCreated") : tr("soDeliveryCreated"),
        description: created?.number ?? "",
      });
      onDone();
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: mode === "invoice" ? tr("soInvoiceFailed") : tr("soDeliveryFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  return (
    <Dialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid={`so-${mode}-dialog`}>
        <DialogHeader>
          <DialogTitle>{mode === "invoice" ? tr("soInvoiceTitle", { number: order?.number ?? "" }) : tr("soDeliverTitle", { number: order?.number ?? "" })}</DialogTitle>
          <DialogDescription>{mode === "invoice" ? tr("soInvoiceHelp") : tr("soDeliverHelp")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="so-qty-date">{tr("documentDate")}</Label>
              <Input id="so-qty-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-so-qty-date" />
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-start">
                <tr>
                  <th className="p-2 text-start font-medium">{tr("description")}</th>
                  <th className="p-2 text-end font-medium">{tr("ordered")}</th>
                  <th className="p-2 text-end font-medium">{mode === "invoice" ? tr("invoiced") : tr("delivered")}</th>
                  <th className="p-2 text-end font-medium">{tr("thisTime")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line.id} className="border-t">
                    <td className="p-2">{r.line.description}</td>
                    <td className="p-2 text-end font-mono" dir="ltr">{r.ordered}</td>
                    <td className="p-2 text-end font-mono" dir="ltr">{r.done}</td>
                    <td className="p-2 text-end">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        dir="ltr"
                        className="ms-auto h-8 w-24 font-mono"
                        disabled={r.left <= 0}
                        aria-label={tr("quantityForLine", { description: r.line.description })}
                        value={qty[r.line.id as string] ?? ""}
                        onChange={(e) => setQty((prev) => ({ ...prev, [r.line.id as string]: e.target.value }))}
                        data-testid={`input-so-${mode}-qty-${r.line.id}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overLeft && (
            <p role="alert" className="text-sm text-destructive" data-testid="so-qty-over">
              {mode === "invoice" ? tr("errSoQtyExceeded") : tr("errDeliveryExceeds")}
            </p>
          )}
          {mode === "deliver" && (
            <div className="space-y-1.5">
              <Label htmlFor="so-delivery-notes">{tr("notes")}</Label>
              <Textarea id="so-delivery-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <p className="text-xs text-muted-foreground">{tr("deliveryNoPrices")}</p>
            </div>
          )}
          {mode === "invoice" && (
            <p className="text-xs text-muted-foreground">
              {tr("soInvoiceDraftNote")}{" "}
              <Link href="/invoices" className="underline">
                {tr("openInvoices")}
              </Link>
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              {tr("cancel")}
            </Button>
            <Button className="flex-1" disabled={chosen.length === 0 || overLeft || submit.isPending} onClick={() => submit.mutate()} data-testid={`button-confirm-so-${mode}`}>
              {submit.isPending ? tr("saving") : mode === "invoice" ? tr("createInvoice") : tr("createDelivery")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
