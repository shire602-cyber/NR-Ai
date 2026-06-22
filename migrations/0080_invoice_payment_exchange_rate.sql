-- A-B5: capture the exchange rate in effect on the PAYMENT date so realised
-- foreign-exchange gains/losses can be recognised when a foreign-currency
-- invoice is settled at a rate different from the invoice (booking) rate.
-- Nullable and additive: existing payments and the default settlement path are
-- unaffected (realised FX is only computed when a payment rate is supplied).
ALTER TABLE "invoice_payments" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(15, 6);
