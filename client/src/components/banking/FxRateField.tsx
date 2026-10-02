import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate } from "@/lib/calendar-date";
import { messages } from "./FxRateField.i18n";
import { parseRate, realisedFx, type FxKind } from "./fx-preview";

interface Props {
  companyId: string;
  /** The document's currency. Nothing is shown for AED. */
  currency: string;
  /** The payment day, YYYY-MM-DD. */
  date: string;
  amount: number;
  /** The rate the receivable or payable is carried at (the invoice's or bill's own rate). */
  /** Unknown (undefined) hides the gain or loss line: the rate is still sent. */
  bookRate?: number;
  kind: FxKind;
  value: string;
  onChange: (rate: string) => void;
  testId?: string;
}

/**
 * The exchange rate of a foreign-currency receipt or payment: filled in from the rate on file for that day, editable, with
 * the realised gain or loss it will book. The server books it; this only shows it first.
 */
export function FxRateField({ companyId, currency, date, amount, bookRate, kind, value, onChange, testId = "fx" }: Props) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const foreign = !!currency && currency.toUpperCase() !== "AED";
  const touched = useRef(false);

  const { data, isFetching } = useQuery<{ rate: number; effectiveDate?: string }>({
    queryKey: ["/api/companies", companyId, `exchange-rates/convert?from=${currency}&to=AED&amount=1&date=${date}`],
    enabled: foreign && !!companyId && /^\d{4}-\d{2}-\d{2}$/.test(date),
    retry: false,
  });

  // a new day or currency starts from the rate on file again; a rate the person typed is kept until then
  useEffect(() => {
    touched.current = false;
  }, [currency, date]);
  useEffect(() => {
    if (!foreign || touched.current) return;
    if (data?.rate) onChange(String(data.rate));
    else if (!isFetching && !data) onChange("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.rate, foreign, date, currency, isFetching]);

  if (!foreign) return null;
  const rate = parseRate(value);
  const fx = rate && bookRate && bookRate > 0 ? realisedFx({ kind, amount, bookRate, paymentRate: rate }) : null;
  // the amount in AED at the rate typed is worth showing even when the document's own rate is unknown
  const aedAtRate = rate && amount > 0 ? Math.round((amount * rate + Number.EPSILON) * 100) / 100 : null;
  const money = (n: number) => formatCurrency(n, "AED", locale);

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`${testId}-field`}>
      <Label htmlFor={`${testId}-rate`}>{tr("label", { currency })}</Label>
      <Input
        id={`${testId}-rate`}
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => {
          touched.current = true;
          onChange(e.target.value);
        }}
        aria-invalid={value.trim() !== "" && !rate}
        className="font-mono text-start"
        data-testid={`${testId}-rate`}
      />
      <p className="text-xs text-muted-foreground">
        {data?.rate ? tr("hintFound", { date: formatCalendarDate(data.effectiveDate ?? date, locale, "short") }) : tr("hintMissing", { currency })}
        {touched.current && data?.rate && (
          <button type="button" className="ms-2 underline text-primary" onClick={() => { touched.current = false; onChange(String(data.rate)); }}>
            {tr("reset")}
          </button>
        )}
      </p>
      {value.trim() !== "" && !rate && <p className="text-xs text-destructive">{tr("invalid")}</p>}
      {aedAtRate !== null && (
        <div className="text-xs space-y-0.5" data-testid={`${testId}-preview`} data-gain-loss={fx ? fx.gainLoss : ""} data-aed-at-rate={aedAtRate}>
          <p className="flex justify-between gap-3">
            <span>{tr("amountLine")}</span>
            <span dir="ltr" className="font-mono">{formatCurrency(amount, currency, locale)}</span>
          </p>
          <p className="flex justify-between gap-3">
            <span>{tr("inAedAtRate")}</span>
            <span dir="ltr" className="font-mono" data-testid={`${testId}-aed`}>{money(aedAtRate)}</span>
          </p>
          {fx ? (
            <>
              <p className="flex justify-between gap-3">
                <span>{tr("atDocument")}</span>
                <span dir="ltr" className="font-mono">{money(fx.aedAtBook)}</span>
              </p>
              <p className={`flex justify-between gap-3 font-medium ${fx.gainLoss > 0 ? "text-[hsl(var(--chart-5))]" : fx.gainLoss < 0 ? "text-destructive" : ""}`} data-testid={`${testId}-gainloss`}>
                <span>{fx.gainLoss > 0 ? tr("gain") : fx.gainLoss < 0 ? tr("loss") : tr("none")}</span>
                <span dir="ltr" className="font-mono">{fx.gainLoss === 0 ? "" : money(Math.abs(fx.gainLoss))}</span>
              </p>
              {fx.gainLoss !== 0 && <p className="text-muted-foreground">{tr("booksTo", { account: fx.gainLoss > 0 ? tr("account4090") : tr("account5140") })}</p>}
            </>
          ) : (
            <p className="text-muted-foreground">{tr("noDocRate")}</p>
          )}
        </div>
      )}
    </div>
  );
}
