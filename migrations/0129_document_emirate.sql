-- 0129_document_emirate: place of supply per document. Additive and idempotent.
--
-- customer_contacts.emirate is the customer's place of establishment; invoices.emirate (credit notes are invoice
-- rows) is the emirate the VAT 201 box 1 split uses for that supply. An invoice takes body.emirate, else the
-- contact's; a credit note copies its original invoice's. NULL = fall back to the company's own emirate.
-- Values are the companies.emirate set: abu_dhabi, dubai, sharjah, ajman, umm_al_quwain, ras_al_khaimah, fujairah.

ALTER TABLE "customer_contacts" ADD COLUMN IF NOT EXISTS "emirate" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "emirate" text;
-- Why a credit note was issued (printed on its PDF).
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "credit_note_reason" text;

-- 2050 holds customer overpayments: name it for what it is (it was "Deferred Revenue"). Only the untouched default name.
UPDATE "accounts" SET "name_en" = 'Customer Credit', "name_ar" = 'رصيد دائن للعملاء'
 WHERE "code" = '2050' AND "name_en" = 'Deferred Revenue';
