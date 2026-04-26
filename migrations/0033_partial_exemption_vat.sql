-- Sprint 3.2: Partial-exemption input VAT apportionment
-- When a company makes both taxable and exempt supplies, FTA requires that input VAT
-- be apportioned: only the taxable-supply portion is recoverable. Stored as a fraction
-- 0..1 where 0 = no exempt supplies (full recovery), 1 = fully exempt (no recovery).

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "exempt_supply_ratio" numeric(5,4) NOT NULL DEFAULT 0;

ALTER TABLE "companies"
  ADD CONSTRAINT "exempt_supply_ratio_range"
  CHECK ("exempt_supply_ratio" >= 0 AND "exempt_supply_ratio" <= 1);
