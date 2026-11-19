-- 0131_journal_memo_keys (STEP1-D S2): journal entries keep a description key and its params so the
-- UI renders system descriptions in the user's language. Idempotent: ADD COLUMN IF NOT EXISTS only;
-- existing rows keep memo_key NULL and fall back to the pattern matcher over the English memo.
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS memo_key text;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS memo_params jsonb;
