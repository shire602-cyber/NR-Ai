-- Invoice PDF FTA compliance fields.
--
-- customer_address: FTA Article 59 requires the recipient's name AND address
-- on every tax invoice. Previously the PDF only had customer name + TRN.
--
-- reverse_charge: when an outbound supply falls under the reverse-charge
-- mechanism (e.g. designated-zone B2B, certain cross-border services), the
-- invoice must carry a clear notice that the recipient self-assesses VAT.
-- This is invoice-level, not line-level — one banner per document.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "customer_address" text;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "reverse_charge" boolean NOT NULL DEFAULT false;
