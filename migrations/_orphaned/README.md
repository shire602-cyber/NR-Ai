# Orphaned migrations (never journaled, never ran)

These eight `.sql` files existed in `migrations/` but were **never listed in
`meta/_journal.json`**, so Drizzle's migrator never executed them. They have
been moved here to make that explicit and to keep the journal-integrity check
(`scripts/check-migration-journal.mjs`) green.

Moving them changes nothing at runtime — they were dead already. The point is to
force a deliberate decision about each, instead of leaving latent, unrun SQL in
the live migrations path.

| File | Intent | Status |
|---|---|---|
| `0009_schema_hardening.sql` | `real → numeric` for accounting tables + unique constraints | **Superseded.** The live schema already stores these as `numeric` (verified). Money-type coverage is now enforced by `scripts/check-money-types.mjs`. |
| `0015_fix_monetary_types.sql` | `real → numeric` for money columns | **Superseded** by the journaled `0086_money_numeric.sql`, which also covers the `vat_returns` columns 0015 missed. |
| `0016_add_indexes.sql` | Performance indexes (all `IF NOT EXISTS`) | **Re-apply recommended.** Safe/idempotent. Fold into a new journaled migration if these indexes are not already present. |
| `0017_receipts_date_timestamp.sql` | `receipts.date text → timestamp` | **Verify.** Check the live type before re-applying; a later journaled migration may already cover it. |
| `0018_journal_entry_unique.sql` | `UNIQUE(company_id, entry_number)` on `journal_entries` | **Verify then re-apply.** Uses an un-guarded `ADD CONSTRAINT`; wrap in an existence check before journaling. |
| `0019_companies_soft_delete.sql` | `companies.deleted_at`, `is_active` (both `IF NOT EXISTS`) | **Verify.** May already exist via `ensureCriticalSchema`; re-apply as a guarded forward migration if not. |
| `0020_add_firm_leads.sql` | `firm_leads` table + FKs | **Verify.** Un-guarded `ADD CONSTRAINT` FKs; only journal after confirming the table/constraints are absent. |
| `0020_invoice_contact_fk.sql` | `invoices.contact_id` FK + index (`IF NOT EXISTS`) | **Re-apply recommended.** Safe/idempotent. |

## How to re-apply one

1. Confirm the change is genuinely absent from the live schema.
2. Copy the SQL into a new, correctly-numbered file at `migrations/00NN_*.sql`,
   making every statement idempotent (`IF NOT EXISTS`, guarded `DO $$ … $$`).
3. Add it to `meta/_journal.json` as the next entry.
4. Run `npm run db:migrate` against a fresh database and confirm it applies clean.
5. `scripts/check-migration-journal.mjs` must stay green.
