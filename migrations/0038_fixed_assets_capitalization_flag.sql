-- ============================================================================
-- 0038: Fixed-asset capitalization flag
-- ----------------------------------------------------------------------------
-- Adds `needs_capitalization_je` to fixed_assets so the create endpoint can
-- mark assets that were registered without a paymentAccountId — those still
-- need a manual capitalization JE to balance the GL. Defaults to false so
-- existing assets are unaffected.
-- ============================================================================

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "needs_capitalization_je" boolean NOT NULL DEFAULT false;
