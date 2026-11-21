-- 0138_preserve_reminder_language (W4-D): keep the effective language of existing reminder rules.
-- Idempotent: the old default identifies databases where legacy values still need conversion.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'reminder_settings'
      AND column_name = 'language'
      AND column_default = '''bilingual''::text'
  ) THEN
    ALTER TABLE reminder_settings ALTER COLUMN language SET DEFAULT 'contact';
    UPDATE reminder_settings SET language = 'contact' WHERE language = 'bilingual';
  END IF;
END $$;
