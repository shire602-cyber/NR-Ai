import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { publicPost } from "@/lib/sales-public";
import { checkAmountState, payNowState, salesErrorMessage, type OnlinePaymentView } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

interface Props {
  onlinePayment: OnlinePaymentView | null | undefined;
  outstanding: number;
  currency: string;
  /** POST endpoint that returns `{ url }` (public invoice or portal checkout). */
  checkoutPath: string;
  /** Compact: a small button for a table row (full amount only; partial amounts are paid from the invoice page). */
  compact?: boolean;
  testId?: string;
}

/**
 * "Pay now". Rendered only when the company can really take payment (the server's `onlinePayment.configured`, which
 * needs provider keys AND a connected account) and the invoice is payable. Otherwise nothing is shown: there is no
 * dead button and no promise of a feature that is off.
 */
export function PayNowButton({ onlinePayment, outstanding, currency, checkoutPath, compact, testId }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (payNowState(onlinePayment, outstanding) !== "available") return null;
  const allowPartial = !!onlinePayment?.allowPartial && !compact;

  const start = async () => {
    setError(null);
    const checked = checkAmountState({ amount: allowPartial ? amount : "", outstanding, allowPartial });
    if (!checked.ok) {
      setError(checked.reason === "exceeds" ? tr("errAmountExceedsOutstanding") : checked.reason === "partial_not_allowed" ? tr("errPartialNotAllowed") : tr("payAmountInvalid"));
      return;
    }
    setBusy(true);
    try {
      const result = await publicPost<{ url: string }>(checkoutPath, checked.amount === null ? {} : { amount: checked.amount });
      window.location.assign(result.url);
    } catch (e) {
      setError(salesErrorMessage(e, (k) => tr(k), tr("payFailed")));
      setBusy(false);
    }
  };

  if (compact) {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <Button size="sm" onClick={start} disabled={busy} data-testid={testId ?? "button-pay-now"}>
          {busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <CreditCard className="me-1 h-4 w-4" />}
          {tr("payNow")}
        </Button>
        {error && (
          <span role="alert" className="max-w-[16rem] text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid="pay-now-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{tr("amountDue")}</span>
        <span dir="ltr" className="font-mono text-lg font-semibold" data-testid="pay-now-outstanding">
          {formatCurrency(outstanding, currency, locale)}
        </span>
      </div>
      {allowPartial && (
        <div className="space-y-1.5">
          <Label htmlFor="pay-now-amount">{tr("payAmountLabel")}</Label>
          <Input
            id="pay-now-amount"
            type="number"
            min={0.01}
            step="0.01"
            dir="ltr"
            className="font-mono"
            placeholder={String(outstanding)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="input-pay-amount"
          />
          <p className="text-xs text-muted-foreground">{tr("payAmountHint")}</p>
        </div>
      )}
      <Button className="w-full" size="lg" onClick={start} disabled={busy} data-testid={testId ?? "button-pay-now"}>
        {busy ? <Loader2 className="me-2 h-5 w-5 animate-spin" /> : <CreditCard className="me-2 h-5 w-5" />}
        {tr("payNow")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="pay-now-error">
          {error}
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">{tr("payNowSecure")}</p>
    </div>
  );
}
