import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";
import { AED_USD_PEG, currencyChoices, type CompanyRateLike } from "@/lib/document-currency";

/** Same rule as the form schema: a positive rate with up to 6 decimals. */
const isValidRate = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim()) && Number(v) > 0;

interface CurrencyFormShape {
  currency: string;
  exchangeRate?: string;
  date: Date;
}

/**
 * X5 (J1 D2): document currency for invoices. The list is the company's base currency, every
 * currency it keeps a rate for, and the common trade currencies. A foreign currency shows the
 * rate to the base currency, prefilled from the company rate for the invoice date (fx.getRate
 * on the server) and editable; a blank rate lets the server resolve it at save time.
 */
export function InvoiceCurrencyFields<T extends CurrencyFormShape>({
  form,
  companyId,
  baseCurrency,
  readOnly,
}: {
  form: UseFormReturn<T>;
  companyId: string | undefined;
  baseCurrency: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  // The generic form shape is narrowed here; react-hook-form's path types cannot follow it.
  const f = form as unknown as UseFormReturn<CurrencyFormShape>;
  const currency = f.watch("currency") || baseCurrency;
  const date = f.watch("date");
  const foreign = currency !== baseCurrency;
  const isoDate = date ? format(date, "yyyy-MM-dd") : undefined;

  const { data: companyRates = [] } = useQuery<CompanyRateLike[]>({
    queryKey: ["/api/companies", companyId, "exchange-rates"],
    enabled: !!companyId,
    retry: false,
  });
  const choices = useMemo(
    () => currencyChoices(baseCurrency, companyRates),
    [baseCurrency, companyRates]
  );

  const { data: lookup } = useQuery<{
    rate?: number;
    rateText?: string;
    stale?: boolean;
    date?: string;
  }>({
    queryKey: ["/api/companies", companyId, "exchange-rates", "lookup", currency, isoDate],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${companyId}/exchange-rates/lookup?from=${encodeURIComponent(
          currency
        )}&to=${encodeURIComponent(baseCurrency)}${isoDate ? `&date=${isoDate}` : ""}`
      ),
    enabled: !!companyId && foreign,
    retry: false,
  });
  // The server uses the latest company rate on file for the date (even an older one), so it is
  // prefilled either way; an older rate is flagged so the user can confirm or override it.
  const pegged = baseCurrency === "AED" && currency === "USD";
  const suggested = pegged
    ? AED_USD_PEG
    : lookup && lookup.rate !== undefined
      ? String(lookup.rateText ?? lookup.rate)
      : "";
  const rateValue = String(f.watch("exchangeRate") ?? "");
  const rateError = foreign && rateValue.trim() !== "" && !isValidRate(rateValue);
  const staleDate = !pegged && lookup?.stale ? (lookup.date ?? "") : "";

  // Prefill (never overwrite a rate the user typed) when the currency or date changes.
  useEffect(() => {
    if (!foreign) {
      if (f.getValues("exchangeRate")) f.setValue("exchangeRate", "");
      return;
    }
    if (suggested && !f.getFieldState("exchangeRate").isDirty) {
      f.setValue("exchangeRate", suggested);
    }
  }, [foreign, suggested, f]);

  return (
    <>
      <FormField
        control={f.control}
        name="currency"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t["invoices.currency.label"]}</FormLabel>
            <Select
              value={field.value || baseCurrency}
              onValueChange={field.onChange}
              disabled={readOnly}
            >
              <FormControl>
                <SelectTrigger data-testid="select-invoice-currency">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {foreign && (
        <FormField
          control={f.control}
          name="exchangeRate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                {formatMessage(t["invoices.currency.rateLabel"], {
                  from: currency,
                  to: baseCurrency,
                })}
                {pegged && String(field.value ?? "").trim() === AED_USD_PEG && (
                  <Badge variant="secondary" data-testid="badge-rate-peg">
                    {t["invoices.currency.pegBadge"]}
                  </Badge>
                )}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? ""}
                  ltr
                  inputMode="decimal"
                  readOnly={readOnly}
                  aria-invalid={rateError ? true : undefined}
                  aria-describedby={rateError ? "invoice-rate-error" : undefined}
                  data-testid="input-invoice-exchange-rate"
                  placeholder={t["invoices.currency.rateHint"]}
                />
              </FormControl>
              {rateError && (
                <p
                  id="invoice-rate-error"
                  role="alert"
                  className="text-caption text-destructive"
                  data-testid="error-invoice-exchange-rate"
                >
                  {t["invoices.currency.rateInvalid"]}
                </p>
              )}
              <p className="text-caption text-muted-foreground">
                {pegged
                  ? t["invoices.currency.pegNote"]
                  : suggested && staleDate
                    ? formatMessage(t["invoices.currency.rateStale"], {
                        rate: suggested,
                        date: staleDate,
                      })
                    : suggested
                      ? formatMessage(t["invoices.currency.rateSuggested"], { rate: suggested })
                      : t["invoices.currency.rateMissing"]}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
}
