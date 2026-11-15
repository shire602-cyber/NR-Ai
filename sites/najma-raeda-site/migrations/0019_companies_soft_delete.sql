-- Soft delete for companies: adds deleted_at and is_active columns.
-- UAE FTA requires 5-year record retention; hard deletes would violate this requirement.
-- Queries should filter WHERE deleted_at IS NULL to exclude soft-deleted companies.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS deleted_at timestamp,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
