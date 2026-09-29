-- 0096_vat_return_adjustments
-- Manual journals to the VAT accounts are VAT adjustments on the return. Fully idempotent.
--
--  * vat_returns.vat_adjustments: the journals behind the return's adjustment columns, one entry
--    per journal and side ({ entryId, entryNumber, description, date, side, box, amount }), so the
--    accountant can see what each adjustment is. Server-owned: written when the return is generated
--    or re-computed at filing, never by a client. A filed return keeps its own copy in the filing
--    snapshot.

ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "vat_adjustments" jsonb;
