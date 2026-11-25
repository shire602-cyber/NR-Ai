-- 0127_wq2_purchases (WQ2 purchases finished; W3-B purchases): expense-claim items keep an uploaded receipt file.
-- Idempotent: ADD COLUMN IF NOT EXISTS only, so re-running the file changes nothing.
--
-- 8.7: older expense-claim items stored a receipt URL. The receipt file is now
-- uploaded through the upload guard (magic number, size, malware scan) and kept through
-- fileStorage; the item stores the storage key and the original file name. receipt_url stays for
-- legacy items that link to a receipt elsewhere.
ALTER TABLE expense_claim_items ADD COLUMN IF NOT EXISTS receipt_path text;
ALTER TABLE expense_claim_items ADD COLUMN IF NOT EXISTS receipt_name text;
