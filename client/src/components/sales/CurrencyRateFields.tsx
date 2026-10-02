import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BASE_CURRENCY, DOCUMENT_CURRENCIES, parseRate, pickRate, type RateRow } from "@/lib/fx";
import { formatCalendarDate } from "@/lib/calendar-date";
import { useTranslation } from "@/lib/i18n";
import { messages } from "./SalesShared.i18n";

interface Props {
  companyId: string | undefined | null;
  currency: string;
  onCurrencyChange: (currency: string) => void;
  rateText: string;
  onRateTextChange: (text: string) => void;
  /** The document date (YYYY-MM-DD): the rate defaults to the latest one on or before it. */
  dateYmd: string;
  /** Currency and rate are fixed (a posted document, or a credit note that inherits them). */
  disabled?: boolean;
  /** A saved document is open: keep its stored rate until the person changes the currency. */
  rateIsStored?: boolean;
  /** Changes when a different document is opened, so the defaulting starts again. */
  docKey: string;
}

/** The document currency (company currency by default) and, for a foreign one, the rate to AED: defaulted from the rate table, editable. */
export function CurrencyRateFields({ companyId, currency, onCurrencyChange, rateText, onRateTextChange, dateYmd, disabled, rateIsStored, docKey }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const foreign = currency !== BASE_CURRENCY;
  const [auto, setAuto] = useState(!rateIsStored);
  useEffect(() => setAuto(!rateIsStored), [docKey, rateIsStored]);

  const { data: rates = [], isFetched } = useQuery<RateRow[]>({
    queryKey: ["/api/companies", companyId, "exchange-rates"],
    enabled: !!companyId && foreign,
  });
  const picked = foreign ? pickRate(rates, currency, dateYmd) : null;

  useEffect(() => {
    if (!foreign || !auto || !isFetched) return;
    onRateTextChange(picked ? String(Math.round(picked.rate * 1e6) / 1e6) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreign, auto, isFetched, picked?.rate, picked?.date, currency]);

  const typed = parseRate(rateText);
  return (
    <div className="grid grid-cols-2 gap-4" data-testid="currency-rate-fields">
      <div className="space-y-1.5">
        <Label htmlFor="doc-currency">{tr("currencyLabel")}</Label>
        <Select
          value={currency}
          disabled={disabled}
          onValueChange={(c) => {
            setAuto(true);
            onCurrencyChange(c);
          }}
        >
          <SelectTrigger id="doc-currency" data-testid="select-document-currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOCUMENT_CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {foreign && (
        <div className="space-y-1.5">
          <Label htmlFor="doc-rate">{tr("rateToAed", { currency })}</Label>
          <Input
            id="doc-rate"
            type="number"
            min={0}
            step="0.0001"
            dir="ltr"
            className="font-mono"
            disabled={disabled}
            value={rateText}
            aria-invalid={!typed}
            onChange={(e) => {
              setAuto(false);
              onRateTextChange(e.target.value);
            }}
            data-testid="input-document-rate"
          />
        </div>
      )}
      {foreign && (
        <p className="col-span-2 text-xs text-muted-foreground" data-testid="rate-hint">
          {picked && auto
            ? tr("rateFromTable", { date: formatCalendarDate(picked.date, locale, "short") })
            : !typed
              ? tr("rateMissing", { currency })
              : tr("rateTyped")}
        </p>
      )}
    </div>
  );
}
