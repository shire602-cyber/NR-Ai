import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  applicableAdvances,
  salesErrorMessage,
  salesKeys,
  type AdvanceApplicationRow,
  type CustomerAdvance,
} from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

interface Props {
  companyId: string;
  invoiceId: string;
  contactId: string | null | undefined;
  /** Advances already deducted on this invoice (from GET /api/invoices/:id). */
  applications: AdvanceApplicationRow[];
  /** Called after an advance was applied or removed: reload the invoice to show the server's totals. */
  onChanged: () => void;
  /** Only a draft invoice takes advances. */
  disabled?: boolean;
}

/** Deduct a customer's advance from a draft invoice, or take a deducted advance off again. */
export function ApplyAdvanceDialog({ companyId, invoiceId, contactId, applications, onChanged, disabled }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const advances = useQuery<CustomerAdvance[]>({
    queryKey: [...salesKeys.advances(companyId), "open", contactId ?? "none"],
    enabled: open && Boolean(contactId),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/customer-advances?contactId=${contactId}&status=open`),
  });
  const usable = applicableAdvances(advances.data, contactId);
  const active = applications.filter((a) => a.kind === "application" && a.status === "active");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: salesKeys.advances(companyId) });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
    onChanged();
  };
  const fail = (title: string) => (error: unknown) =>
    toast({ variant: "destructive", title, description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) });

  const apply = useMutation({
    mutationFn: (args: { advanceId: string; amount: number }) => apiRequest("POST", `/api/invoices/${invoiceId}/advance-applications`, args),
    onSuccess: () => {
      toast({ title: tr("advanceApplied") });
      refresh();
    },
    onError: fail(tr("advanceApplyFailed")),
  });
  const remove = useMutation({
    mutationFn: (applicationId: string) => apiRequest("DELETE", `/api/invoices/${invoiceId}/advance-applications/${applicationId}`),
    onSuccess: () => {
      toast({ title: tr("advanceRemoved") });
      refresh();
    },
    onError: fail(tr("advanceRemoveFailed")),
  });

  const money = (n: number) => formatCurrency(n, "AED", locale);

  return (
    <div className="space-y-2" data-testid="advance-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{tr("advances")}</h3>
        <Button type="button" variant="outline" size="sm" disabled={disabled || !contactId} onClick={() => setOpen(true)} data-testid="button-apply-advance">
          <WalletCards className="me-2 h-4 w-4" />
          {tr("applyAdvance")}
        </Button>
      </div>
      {!contactId && <p className="text-xs text-muted-foreground">{tr("advanceNeedsCustomer")}</p>}
      {disabled && contactId && <p className="text-xs text-muted-foreground">{tr("advanceDraftOnly")}</p>}
      {active.length > 0 && (
        <ul className="space-y-1" data-testid="advance-applications">
          {active.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span>
                {tr("lessAdvance", { number: a.advanceNumber })}
                <span dir="ltr" className="ms-2 font-mono text-muted-foreground">
                  -{money(a.netAmount)}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || remove.isPending}
                onClick={() => remove.mutate(a.id)}
                aria-label={tr("removeAdvance", { number: a.advanceNumber })}
                data-testid={`button-remove-advance-${a.advanceNumber}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("applyAdvance")}</DialogTitle>
            <DialogDescription>{tr("applyAdvanceHelp")}</DialogDescription>
          </DialogHeader>
          {advances.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" aria-label={tr("loading")} />
            </div>
          ) : usable.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground" data-testid="no-open-advances">
              {tr("noOpenAdvances")}
            </p>
          ) : (
            <ul className="space-y-3">
              {usable.map((a) => {
                const available = Number(a.available ?? 0);
                const draft = amounts[a.id] ?? String(available);
                const n = Number(draft);
                const valid = Number.isFinite(n) && n > 0 && n <= available + 0.004;
                return (
                  <li key={a.id} className="space-y-2 rounded-md border p-3" data-testid={`open-advance-${a.number}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span dir="ltr" className="font-mono font-medium">{a.number}</span>
                      <span className="text-muted-foreground">
                        {tr("advanceAvailable")}{" "}
                        <span dir="ltr" className="font-mono">
                          {money(available)}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0.01}
                        step="0.01"
                        dir="ltr"
                        className="font-mono"
                        aria-label={tr("advanceAmountToApply", { number: a.number })}
                        value={draft}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        data-testid={`input-advance-amount-${a.number}`}
                      />
                      <Button
                        type="button"
                        disabled={!valid || apply.isPending}
                        onClick={() => apply.mutate({ advanceId: a.id, amount: n }, { onSuccess: () => setOpen(false) })}
                        data-testid={`button-confirm-advance-${a.number}`}
                      >
                        {apply.isPending ? tr("loading") : tr("apply")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{tr("advanceNetHint")}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
