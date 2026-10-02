import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { todayYmd, uaeDayOf } from "@/lib/calendar-date";
import { formatCurrency } from "@/lib/format";
import { aedEquivalent } from "@/lib/fx";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  creditNoteBody,
  creditSelectionTotals,
  creditableLines,
  remainingCreditable,
  salesErrorMessage,
  type CreditLineChoice,
  type CreditableInvoice,
} from "@/lib/credit-note";
import { useEmirateLabel } from "./EmirateSelect";
import { messages } from "./SalesShared.i18n";

interface Props {
  companyId: string;
  invoiceId: string | null;
  onClose: () => void;
}

/**
 * Credit part of an invoice or all of it. Pick the lines and quantities to credit (each line names the original line it
 * credits), see how much of the invoice can still be credited, and choose whether the goods go back into stock.
 */
export function CreditNoteDialog({ companyId, invoiceId, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"lines" | "whole">("lines");
  const [date, setDate] = useState(todayYmd());
  const [restock, setRestock] = useState(false);
  const [reason, setReason] = useState("");

  const invoice = useQuery<CreditableInvoice>({
    queryKey: ["/api/invoices", invoiceId],
    enabled: !!invoiceId,
  });
  const inv = invoice.data;
  const lines = useMemo(() => (inv ? creditableLines(inv) : []), [inv]);
  const remaining = inv ? remainingCreditable(inv) : 0;
  const advanceBlocks = !!inv && (inv.advanceApplications ?? []).some((a) => a.kind === "application" && a.status === "active");

  useEffect(() => {
    if (!inv) return;
    setQty({});
    setMode(advanceBlocks ? "whole" : "lines");
    setDate(todayYmd());
    setRestock(false);
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv?.id]);

  const choices: CreditLineChoice[] = lines.map((l) => ({ line: l, quantity: Number(qty[l.id] ?? 0) || 0 }));
  const picked = creditSelectionTotals(choices);
  const hasStockLine = lines.some((l) => !!l.productId);
  const over = mode === "lines" && picked.total > remaining + 0.005;
  const overLine = choices.some((c) => c.quantity > c.line.creditableQty + 1e-9);
  const invoiceDay = uaeDayOf(inv?.date);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayYmd() && (!invoiceDay || date >= invoiceDay);
  const canSubmit = !!inv && remaining > 0.004 && !over && !overLine && dateOk && (mode === "whole" || picked.total > 0);

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/invoices/${invoiceId}/credit-note`, creditNoteBody({ mode, choices, date, restock, reason })),
    onSuccess: (created: { number?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "credit-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "products"] });
      toast({ title: tr("creditNoteIssued"), description: created?.number ?? "" });
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: tr("creditNoteFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  const money = (n: number) => formatCurrency(n, inv?.currency || "AED", locale);
  const emirateLabel = useEmirateLabel();
  const rateToAed = Number(inv?.exchangeRate ?? 1);

  return (
    <Dialog open={invoiceId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="credit-note-dialog">
        <DialogHeader>
          <DialogTitle>{tr("creditNoteTitle", { number: inv?.number ?? "" })}</DialogTitle>
          <DialogDescription>{tr("creditNoteHelp")}</DialogDescription>
        </DialogHeader>
        {!inv ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{tr("loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm" data-testid="credit-remaining">
              <span>{tr("remainingCreditable")}</span>
              <span className="font-mono font-semibold" dir="ltr">{money(remaining)}</span>
              <span className="w-full text-xs text-muted-foreground">
                {tr("invoiceTotalCredited", { total: money(Number(inv.total)), credited: money(Number(inv.creditedAmount ?? 0)) })}
              </span>
            </div>

            {/* A credit note takes the currency, rate and emirate of the invoice it credits: shown, not editable. */}
            <dl className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm" data-testid="credit-inherited">
              <div>
                <dt className="text-xs text-muted-foreground">{tr("currencyLabel")}</dt>
                <dd className="font-mono" dir="ltr">
                  {inv.currency || "AED"}
                  {inv.currency && inv.currency !== "AED" && rateToAed > 0 ? ` @ ${rateToAed}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{tr("emirateOfSupply")}</dt>
                <dd data-testid="credit-emirate">{emirateLabel(inv.emirate) || tr("emirateSameAsCompany")}</dd>
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">{tr("creditInheritsHelp")}</p>
            </dl>

            {advanceBlocks && (
              <p role="alert" className="text-sm text-warning" data-testid="credit-advance-note">{tr("errAdvancePartialCredit")}</p>
            )}

            <div className="flex gap-2" role="group" aria-label={tr("creditWhat")}>
              <Button type="button" size="sm" variant={mode === "lines" ? "default" : "outline"} disabled={advanceBlocks} onClick={() => setMode("lines")} data-testid="button-credit-part">
                {tr("creditPart")}
              </Button>
              <Button type="button" size="sm" variant={mode === "whole" ? "default" : "outline"} onClick={() => setMode("whole")} data-testid="button-credit-whole">
                {tr("creditWholeRemaining")}
              </Button>
            </div>

            {mode === "lines" ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-start font-medium">{tr("description")}</th>
                      <th className="p-2 text-end font-medium">{tr("creditableQty")}</th>
                      <th className="p-2 text-end font-medium">{tr("price")}</th>
                      <th className="p-2 text-end font-medium">{tr("creditQty")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t" data-testid={`credit-line-${l.id}`}>
                        <td className="p-2">{l.description}</td>
                        <td className="p-2 text-end font-mono" dir="ltr">{l.creditableQty}</td>
                        <td className="p-2 text-end font-mono" dir="ltr">{money(l.creditUnitPrice)}</td>
                        <td className="p-2 text-end">
                          <Input
                            type="number"
                            min={0}
                            max={l.creditableQty}
                            step="0.01"
                            dir="ltr"
                            className="ms-auto h-8 w-24 text-end font-mono"
                            disabled={l.creditableQty <= 0}
                            aria-label={tr("creditQtyFor", { description: l.description })}
                            value={qty[l.id] ?? ""}
                            onChange={(e) => setQty((p) => ({ ...p, [l.id]: e.target.value }))}
                            data-testid={`input-credit-qty-${l.id}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{tr("creditWholeHelp")}</p>
            )}

            {mode === "lines" && (
              <div className="space-y-1 text-sm" data-testid="credit-selection">
                <div className="flex justify-between"><span className="text-muted-foreground">{tr("subtotal")}</span><span className="font-mono" dir="ltr">{money(picked.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{tr("vat")}</span><span className="font-mono" dir="ltr">{money(picked.vat)}</span></div>
                <div className="flex justify-between font-semibold"><span>{tr("thisCreditNote")}</span><span className="font-mono" dir="ltr" data-testid="credit-this-total">{money(picked.total)}</span></div>
                {inv.currency && inv.currency !== "AED" && rateToAed > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground" data-testid="credit-aed-equivalent"><span>{tr("aedEquivalent")}</span><span className="font-mono" dir="ltr">{formatCurrency(aedEquivalent(picked.total, rateToAed), "AED", locale)}</span></div>
                )}
              </div>
            )}
            {over && <p role="alert" className="text-sm text-destructive" data-testid="credit-over">{tr("creditOverRemaining")}</p>}
            {overLine && <p role="alert" className="text-sm text-destructive">{tr("creditOverLine")}</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="credit-date">{tr("creditNoteDate")}</Label>
                <Input id="credit-date" type="date" dir="ltr" min={invoiceDay || undefined} max={todayYmd()} aria-invalid={!dateOk} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-credit-date" />
              </div>
              {!dateOk && <p role="alert" className="text-xs text-destructive sm:col-span-2" data-testid="credit-date-problem">{tr("creditDateProblem")}</p>}
              {hasStockLine && (
                <div className="flex items-start gap-2 pt-6">
                  <Checkbox id="credit-restock" checked={restock} onCheckedChange={(v) => setRestock(v === true)} data-testid="checkbox-credit-restock" />
                  <Label htmlFor="credit-restock" className="text-sm font-normal leading-snug">{tr("creditRestock")}</Label>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-reason">{tr("creditReason")}</Label>
              <Textarea id="credit-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={onClose}>{tr("cancel")}</Button>
              <Button className="flex-1" disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()} data-testid="button-confirm-credit-note">
                {submit.isPending ? tr("saving") : tr("issueCreditNote")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
