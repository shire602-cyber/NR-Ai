-- 0117_e2_einvoice_complyance (E2; W4-C e-invoicing residual): second accredited ASP, Complyance.
-- Idempotent: ADD COLUMN IF NOT EXISTS only, so re-running the file changes nothing.
--
-- einvoice_legal_entities (0116) holds one row per company / provider / environment. Complyance's
-- per-company onboarding (Connect API) returns identifiers that have no column of their own: the
-- invoice source name and version every Unify submission must name, the branch id, and the
-- mapping readiness that decides whether the company can invoice yet. They go into one
-- provider-neutral jsonb column, so neither provider needs its own table and removing a provider
-- later needs no schema change.
ALTER TABLE einvoice_legal_entities ADD COLUMN IF NOT EXISTS provider_details jsonb;
