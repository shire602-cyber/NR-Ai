-- 0132_journal_line_keys (STEP1-E S1, G1): journal lines keep a description key and its params so the
-- UI, the GL report and the exports render system line descriptions in the user's language.
-- Idempotent: ADD COLUMN IF NOT EXISTS only; existing rows keep line_key NULL and fall back to the
-- pattern matcher over the English line description.
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS line_key text;
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS line_params jsonb;
