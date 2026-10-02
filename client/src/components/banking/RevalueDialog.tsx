import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { todayYmd } from "@/lib/calendar-date";
import { formatCurrency, formatNumber } from "@/lib/format";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import type { BankAccount, RevaluationPreview } from "@/lib/banking-api-types";
import { messages } from "./RevalueDialog.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankingErrorText } from "./banking-common";
import { parseRate } from "./fx-preview";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  account: BankAccount | null;
  /** The day to start from (a month-end opens this on the period's last day). */
  initialAsOf?: string;
}

/** Revalue a foreign-currency bank account at a closing rate: the difference to unrealised exchange gain or loss. */
export function RevalueDialog({ open, onOpenChange, companyId, account, initialAsOf }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [asOf, setAsOf] = useState(initialAsOf ?? todayYmd());
  const [rateText, setRateText] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAsOf(initialAsOf ?? todayYmd());
    setRateText("");
    setTouched(false);
  }, [open, account?.id, initialAsOf]);

  const rate = parseRate(rateText);
  const currency = (account?.currency ?? "AED").toUpperCase();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const path = `/api/companies/${companyId}/bank-accounts/${account?.id}/revaluation`;
  const { data, isFetching, isError } = useQuery<RevaluationPreview>({
    queryKey: ["/api/companies", companyId, `bank-accounts/${account?.id}/revaluation?asOf=${asOf}${rate ? `&exchangeRate=${rate}` : ""}`],
    enabled: open && !!account && valid,
    retry: false,
  });

  // the rate on file for the day fills the field until the person types their own
  useEffect(() => {
    if (!touched && data?.closingRate) setRateText(String(data.closingRate));
  }, [data?.closingRate, touched]);

  const post = useMutation({
    mutationFn: () => apiRequest("POST", `${path.replace("/revaluation", "")}/revalue`, { asOf, exchangeRate: rate }),
    onSuccess: (res: { adjustmentAed?: number; posted?: boolean }) => {
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === companyId });
      toast({ title: tr("posted"), description: tr("postedBody", { amount: formatCurrency(Math.abs(res?.adjustmentAed ?? data?.adjustmentAed ?? 0), "AED", locale) }) });
      onOpenChange(false);
    },
    onError: (err: unknown) =>
      toast({
        variant: "destructive",
        title: tr("failed"),
        description: err instanceof ApiError && err.code === "NO_EXCHANGE_RATE" ? tr("errNoRate") : bankingErrorText(trc, err, locale),
      }),
  });

  const diff = data?.adjustmentAed ?? 0;
  const nothing = !!data && Math.abs(diff) < 0.005;
  const money = (n: number) => formatCurrency(n, "AED", locale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto" data-testid="revalue-dialog">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>{tr("description", { currency, name: account?.nameEn ?? "" })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rv-asof">{tr("asOf")}</Label>
              <Input id="rv-asof" type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value); setTouched(false); }} dir="ltr" className="text-start" data-testid="input-revalue-asof" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rv-rate">{tr("rate", { currency })}</Label>
              <Input
                id="rv-rate"
                inputMode="decimal"
                value={rateText}
                onChange={(e) => { setTouched(true); setRateText(e.target.value); }}
                dir="ltr"
                className="font-mono text-start"
                aria-invalid={rateText.trim() !== "" && !rate}
                data-testid="input-revalue-rate"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">{tr("rateHint")}</p>

          {isFetching && !data ? (
            <Skeleton className="h-24 w-full" aria-label={tr("loading")} />
          ) : isError || !data ? (
            <p className="text-sm text-destructive">{tr("previewFailed")}</p>
          ) : (
            <div className="rounded-md border p-3 text-sm space-y-1" data-testid="revalue-preview" data-difference={data.adjustmentAed}>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">{tr("foreignBalance", { currency })}</span>
                <span dir="ltr" className="font-mono">{formatNumber(data.foreignBalance, locale)}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">{tr("bookValue")}</span>
                <span dir="ltr" className="font-mono">{money(data.carryingAed)}</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">{tr("closingValue")}</span>
                <span dir="ltr" className="font-mono">{money(data.targetAed)}</span>
              </p>
              <p className={`flex justify-between gap-3 border-t pt-1 font-semibold ${diff > 0 ? "text-[hsl(var(--chart-5))]" : diff < 0 ? "text-destructive" : ""}`}>
                <span>{nothing ? tr("difference") : diff > 0 ? tr("gain") : tr("loss")}</span>
                <span dir="ltr" className="font-mono">{money(Math.abs(diff))}</span>
              </p>
              {nothing && <p className="text-xs text-muted-foreground">{tr("nothing")}</p>}
              {data.alreadyPosted && <p className="text-xs text-[hsl(var(--chart-4))]" data-testid="revalue-already-posted">{tr("alreadyPosted", { number: data.existingEntry?.entryNumber ?? "" })}</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("cancel")}
          </Button>
          <Button onClick={() => post.mutate()} disabled={!data || !rate || nothing || !!data?.alreadyPosted || post.isPending} data-testid="button-post-revalue">
            {post.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            {post.isPending ? tr("posting") : tr("post")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
