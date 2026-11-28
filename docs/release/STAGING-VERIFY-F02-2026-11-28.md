# F02 staging smoke, 2026-11-28 (VAT effective returns)

Result: FAIL at step 2 (amend). F02 is NOT marked verified. No credentials or tokens appear here.

Staging: https://nr-ai-staging.up.railway.app, `/api/version` commit `0a6797405e2311cd29ebbafa3c6b9a77e18f6b3e` (the tip of
`origin/claude/eloquent-maxwell-kjxxjc`, merge of PR #232; includes batch-3 / PR #183 and the F02 amendment fix 0ceb1d51).
Run on 2026-11-28 (UTC). Demo tenant only: Demo Trading LLC (`15943f48-7ab9-4a57-af69-552d24a4d8cb`). Manual
references only; nothing was transmitted to FTA/EmaraTax/ASP, no email/WhatsApp, no settlement.

Period used: the existing Q1 2026 original `8b9238d8-77ea-4528-9119-a829479486d9`, still `filed`, TEST-REF-0001,
Box 14 payable AED 500 (AED 10,000 sales at 5%, invoice `9f19cbec-f94c-457a-9794-713d59261cae`). Reusing it was chosen
because it is the exact case that failed on 2026-11-26.

| Step | Expected | Observed | Result |
|---|---|---|---|
| 0. `/api/version` | commit recorded | 0a679740 (above) | PASS |
| 1. original filed and effective | filed, 500 | GET vat-returns: 1 row, status filed, ref TEST-REF-0001, box14 500, amendsReturnId null; `selectEffectiveVatReturns` (shared/vat-effective-returns.ts) on that response returns it, `effectiveNetVatDeclared` = 500 | PASS |
| 2. POST `/api/vat-returns/8b9238d8.../amend` `{reason}` | 201 draft, amendsReturnId = original | 409 `DUPLICATE_VALUE` "A record with this value already exists" (requestIds ec617a36-3ad4-44c9-8748-ba2f1fc21782 and e6548742-43ed-4572-a1cf-f052af1245f8; same on a second try) | FAIL |
| 2b. state after the failed amend | no side effects | the whole amend transaction rolled back: still exactly 1 row, original still `filed` (not flipped to `amended`), no draft amendment, period-lock empty | PASS (clean rollback) |
| 3. credit note AED 1,000 + 5% dated 2026-02-20 into Q1 | allowed once the period re-opens via amend | 409 `VAT_PERIOD_FILED` (the amend that would re-open the period has not succeeded; message points to `/api/vat-returns/{id}/amend`) | BLOCKED |
| 3. amended figure 450, submit amendment | not reachable | not run | BLOCKED |
| 4. effective total 450, original `amended`, card and drilldown | not reachable | not run | BLOCKED |
| other company unaffected | no change | Demo Second LLC: 0 VAT returns before and after; it has no TRN, so a return cannot be generated there (`NO_TRN`), so no cross-company supersession check was possible | N/A |

## Diagnosis (no app code changed)

The 409 is the generic mapping of Postgres 23505 (unique violation) in `server/middleware/errorHandler.ts`. In
`amendVatReturn` (server/tax/vat-returns.service.ts ~line 753) the only statement that can raise it is the
`INSERT INTO vat_returns` of the draft amendment (line ~794); the `recordAudit` call swallows its own errors, and the
status update, lock and select statements cannot violate uniqueness. The original `generate` insert (same table) works, so
the amendment row hits a unique index that the plain draft row does not. No migration in this repository declares a unique
constraint or unique index on `vat_returns` (only plain indexes: `idx_vat_returns_company_id`, `idx_vat_returns_company_period`
(company_id, period_start), `idx_vat_returns_amends`, `idx_vat_returns_company_status_period`), and the Drizzle schema
(`shared/schema/vat.ts`) declares none. So the likely cause is schema drift on the staging database: an index that is
UNIQUE there but not in the repo (for example `idx_vat_returns_company_period` created as UNIQUE by an earlier
`db:push` or older migration, which `CREATE INDEX IF NOT EXISTS` in 0043 would not replace). With a unique
(company_id, period_start), the amendment row (same company and period start as the original) always collides, which
matches the 2026-11-26 failure on an older commit. This is a hypothesis: the pg constraint name is logged server side
(27161ad1) but I have no access to the staging logs or database. To confirm, search the Railway logs for the requestIds
above, or run `SELECT indexdef FROM pg_indexes WHERE tablename='vat_returns'` on staging.

Why this blocks F02: the F02 selection fix (0ceb1d51, original stays effective while an amendment is a draft) cannot be
exercised on staging while no amendment row can be inserted. It remains covered by tests/unit/vat-effective-returns.test.ts only.

## Records created / touched on staging

- Demo Second LLC: one draft invoice `eb06fa98-1bbd-429a-8b22-82c60c4d9f79` (INV-2026-00002, AED 10,000 + 5%, dated
  2026-05-10, issue refused 422 because the company has no TRN). It stays a draft; no ledger effect.
- Demo Trading LLC: none (all attempted writes were refused and rolled back).

## Next step

Confirm and repair the drift on staging (and check production for the same index) with an owner-approved migration or
manual `DROP INDEX`, then re-run this smoke: amend (201), credit note into the re-opened Q1, submit the amendment
(TEST-REF-F02-0002), and confirm card and drilldown show 450 once.
