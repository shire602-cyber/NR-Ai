-- 0123_payment_links_open_unique (Phase 8 D1 review fix): at most ONE open payment link per invoice, enforced by the
-- database. Checkout creation expires older open sessions first, but two parallel requests could both pass that step.
-- Idempotent; any pre-existing duplicate open links are expired (all but the newest) before the index is built.

UPDATE "payment_links" p SET "status" = 'expired'
 WHERE p."status" = 'open'
   AND EXISTS (
     SELECT 1 FROM "payment_links" n
      WHERE n."invoice_id" = p."invoice_id" AND n."status" = 'open'
        AND (n."created_at" > p."created_at" OR (n."created_at" = p."created_at" AND n."id" > p."id"))
   );

CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_links_open_per_invoice"
  ON "payment_links"("invoice_id") WHERE "status" = 'open';
