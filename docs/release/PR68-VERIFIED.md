# PR #68 detailed verification record

Detailed verification record for PR #68 (launch hardening on top of #67): the full per-section evidence, the end-to-end checks in both languages, the dated audit subsections (English then Arabic) and the GitGuardian note. The PR description holds only the summary.

## 1. Release-line consolidation

### PR #65 (cross-tenant writes)

Both holes are already closed on #67.

**Team member PUT/DELETE.** `server/storage/companies.ts` addresses memberships through `scopedGet`, `scopedUpdate` and `scopedDelete`, and `team.routes.ts` loads the member first, so another company's membership is a 404.

**Firm client edits.** `firmClientCondition` limits a firm to active `firm_client_links` and legacy `company_type='client'` companies, and excludes deleted ones.

`tests/db/pr65-tenant-boundaries.test.ts` ports #65's regression tests onto #67's tenancy helpers:

- B's membership rows are untouched (404).
- A body `companyId` cannot re-home a membership (400).
- A firm owner gets 404 on a SaaS company's PUT, summary, switch and archive, and the row is unchanged.
- An archived client returns 404.

One behaviour change: firm client summary, PUT and switch used to answer **403** for a company outside the caller's firm. Under the tenancy rule (another tenant is 404) they now answer **404**. They answer 403 only for an unassigned client of the caller's own firm (`denyClientAccess`). Three existing assertions on revoked-link companies moved from 403 to 404.

### PRs #61, #62, #63, #64, #66

Full per-PR tables with file evidence are in `docs/release/SUPERSEDED-PRS.md`. Live defects on #67 that this audit found and this PR fixes, each with a DB test:

| From | Fix                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #62  | **Stripe webhooks never verified.** `/api/webhooks/stripe` was JSON-parsed before `constructEvent`, so every billing event got 400. It now gets the raw body. `RAW_WEBHOOK_PREFIXES` is one list in `server/http/body-limits.ts`, shared with the harness. The test fails on the old list. |
| #62  | **Stripe retries were skipped after a failed delivery.** The event is now claimed atomically and the claim is released on failure.                                                                                                                                                         |
| #62  | **Client-portal users could read the company's books.** Confirmed by request first: P&L, balance sheet, dashboard and team returned 200. `authMiddleware` now confines `client_portal` users to `/api/client-portal/*` and `/api/auth/*` (403 `PORTAL_SCOPE`).                             |
| #62  | **Password hashes leaked in member lists.** `/api/firm/clients/:id/summary` and `/api/admin/clients/:id` returned full user rows. They now return a public projection.                                                                                                                     |
| #66  | **The month-end checklist never accepted a quarterly VAT return.** Every quarterly filer needed a lock override each month. The base's E3 (J3-r3) fixed this too; on merge I kept E3's version and kept the PR-66 regression test against it.                                              |
| #61  | **Payment chasing ignored credit notes.** It now reads the settlement rule.                                                                                                                                                                                                                |
| #61  | **Entertainment VAT was recovered on expense claims.** Art. 53 rules now apply.                                                                                                                                                                                                            |

Larger missing items are listed for review in `SUPERSEDED-PRS.md` and are not ported. Among them: Sentry, filing-evidence hash and acknowledgement, the posting-vs-filing advisory lock, VAT part-payments, leave-pay provision, employee loans, vendor-credit and refund screens, and FX bank reconciliation.

### Superseded PRs: what happened to each, and whether to close it

Recommendations only; the owner closes PRs himself. "On #67" means the fix already existed on #67 by its own design. The per-fix evidence is in `docs/release/SUPERSEDED-PRS.md`.

| PR                                        | Ported into #68                                                                                                                       | Already on #67                                                                                                                                                      | Intentionally not ported, and why                                                                                                                                                                                                                                                                                             | Proof                                                                                                                                                                       | Close?                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| #61 phase 1 (precision, FX, VAT, posting) | Art. 53 non-recovery on expense claims; payment chasing net of credit notes                                                           | 15 of 25 fixes: FX scoping and direction, no silent 1.0 rate, credit notes and voids, payment dates, VAT period gating, one VAT engine, pool starvation             | **Owner or product calls (small):** bcrypt cost 10 to 12+, backdated-journal confirmation, zero-salary payroll exclusion, CSRF 401 vs 403, VAT date display in UAE time. **Large:** sub-fils unit prices and numeric quantities, claim VAT in Box 9 amounts. Per-line income account is now on the base (E3, migration 0124). | `tests/db/superseded-ports.test.ts` (PR-61 blocks); SUPERSEDED-PRS #61 table                                                                                                | **Yes**, once the not-ported rows are in the backlog                       |
| #62 phases 2-3 (operable, honest)         | Stripe raw-body verification; Stripe retry-safe claim; client-portal confinement; no password hashes in member lists                  | 8 of 17: durable vault, portal and receipt uploads, honest surfaces                                                                                                 | **Sentry** (large; needs a vendor and DSN decision). VAT-evidence upload content check (small). Trial and billing enforcement semantics (product). Account deactivation flag. Portal "shared with portal" document flag.                                                                                                      | `tests/db/stripe-webhook-raw-body.test.ts` (fails without the fix); `tests/db/portal-access.test.ts` (PR-62 block); `tests/db/pr65-tenant-boundaries.test.ts` (PR-62 block) | **Yes**; keep Sentry on the launch backlog                                 |
| #63 phases 4-5 (compliance, Arabic)       | Nothing                                                                                                                               | 14 of 21: year-end close, opening balances kept out of VAT, date-based voids, system journals read-only, manual-journal source, one VAT engine, Arabic and RTL PDFs | **Posting vs filing race** (advisory locks in the ledger kernel and submit; it touches the posting kernel and needs its own concurrency test). Stale-return recompute at submit. Numbering after imported numbers. Filing-evidence hash and acknowledgement. VAT part-payments. FAF one-year cap.                             | SUPERSEDED-PRS #63 table (each covered row cites #67's own test)                                                                                                            | **Yes**, but track the posting vs filing race as a correctness launch item |
| #64 phases 6-7 (parity, public pages)     | Nothing                                                                                                                               | 12 of 16: inventory costing, statements, payslip and delivery-note PDFs, ageing as-of, usage caps, truthful public pages                                            | Proforma PDF (small). CSV links on report screens (small). Vendor-credit void and screens. Customer-refund UI and refund void.                                                                                                                                                                                                | SUPERSEDED-PRS #64 table                                                                                                                                                    | **Yes**                                                                    |
| #65 cross-tenant writes                   | Its regression tests, rewritten against #67's tenancy helpers; firm-client routes return 404 (not 403) for companies outside the firm | Both holes were already closed (scoped membership writes; firm client scope)                                                                                        | Its `tests/integration/tenant-boundaries.test.mjs` is replaced by DB-harness tests and by `tests/integration/pr68-verified.test.mjs`. Its "NRA clients only" edit rule is replaced by the owner's decision to keep invited-customer edits, scoped to the inviting firm.                                                       | `tests/db/pr65-tenant-boundaries.test.ts` (9 tests); `tests/db/identity-rbac.test.ts` R01-01                                                                                | **Yes**                                                                    |
| #66 phase 8 (complete product)            | Month-end checklist and quarterly VAT. The base's E3 then fixed it too; E3's version is kept, with the PR-66 regression test.         | 20 of 36: double reversal, void dating, emirate split, FX realised and revaluation, disposal reversal, payroll gratuity and dates                                   | **Large:** leave-pay provision, employee loans, "filed outside Muhasib" VAT periods, final-settlement approval, FX bank reconciliation, vendor-credit UI, employee read scope (a product decision). **Small:** TZ pin, credit card as a liability bank account, credit balances on the ageing screens.                        | `tests/db/superseded-ports.test.ts` (PR-66 block); SUPERSEDED-PRS #66 table                                                                                                 | **Yes**, once the backlog has the not-ported rows                          |

## 2. Migration rehearsal (0089-0133)

**Renumber (2026-11-19, round 3):** the base took `0132_journal_line_keys` (G1), so our settlement-index migration is now `0136_settlement_open_balance_indexes` (journal idx 132, `when` 1781430480000). All references follow. A fresh database migrated twice: 133 ledger rows, both indexes valid. The text below that says 0132 describes the earlier renumber.

**Renumber (2026-11-19):** the base took `0131_journal_memo_keys` (S2), so our settlement-index migration is now `0132_settlement_open_balance_indexes` (journal idx 131; the references in the runbook, the rehearsal notes, `docs/database-migrations.md` and `tests/integration/pr68-verified.test.mjs` follow). The numbers below that say 0131 describe the earlier renumber. The audit database that had applied our old 0131 skipped the base's file (same journal `when`), so it needed `0131_journal_memo_keys.sql` applied by hand; a fresh database applies both.
The record is in `docs/release/MIGRATION-REHEARSAL.md`; the driver is in `docs/release/rehearsal/`.

**Setup:** Postgres 16. Main's chain (0000-0088) plus main's `ensureCriticalSchema`, then a production-like multi-tenant seed, then #67's chain, at 1x and 20x volume. The main run covered 0089-0123 (35 files); later migrations are covered below.

**Results:**

- All files applied first time; none needed a fix.
- `db:migrate` took 1.55 s at 1x and 8.8 s at 20x. The slowest file is 0109, the audit chain, at about 0.12 ms per audit row.
- A second migrate was a no-op, and all 35 files re-ran idempotently.
- The per-file runner produced an identical schema.
- Boot check: `/health/ready` and `/api/version` both returned 200.
- The backup restore reproduced the pre-0089 database exactly.

The runbook table is filled in: placeholders, roles, FX flags, rules, tokens, firm backfill, audit chain, Free backfill, findings, and the 0118 indexes.

After the first merge, the base's new `0124_e3_invoice_line_income` was applied and re-run on both migrated snapshots: about 0.3-0.6 s, no rows changed, and the second run was a no-op.

**Migration 0131 (owner-approved exception to the frozen chain):** partial indexes on `invoices.original_invoice_id` and `credit_notes.invoice_id`, also declared in `shared/schema/sales.ts`. It was added as 0125 and renumbered four times (0125 -> 0127 -> 0129 -> 0130 -> 0131), before any deploy, as the base took 0125-0130 (WQ7, WQ3, WQ2, WQ5, and the latest merge with `0130_cash_sale_numbering`). It is now the next free number, 0131.

The rehearsal was re-run from scratch on the merged tree with 0089-0130 (42 files, including the base's 0125-0129; before the base took 0130) at 1x and 20x:

- every file applied, the second migrate was a no-op, and all 42 files re-ran idempotently;
- the schema is identical between the two migrators, and the rollback restore was exact;
- `db:migrate` took 1.92 s at 1x and 9.24 s at 20x;
- 0131 takes 26 ms at 80,000 invoices; the base's 0125-0130 are DDL only;
- one company's open balances (10k invoices) drop from 30-35 s to 57-99 ms;
- `find-sales-ledger-drift` drops from 388 s to under 1 s.

After merging the base at ffa0c725 (merge 9ac68b8c), 0131 was re-checked on a fresh database: migrate ran twice, the ledger had 131 rows both times, the second run was a no-op, and both partial indexes are valid. The 1x/20x figures were then re-timed on the renumbered 0131 chain (0089-0131, 43 files; see the 2026-11-18 re-timing subsection under "Verified working" and `MIGRATION-REHEARSAL.md`).

The runbook now names 0089-0132.

**Production-data rehearsal: skipped by owner decision.** It is recorded as an open launch risk in MIGRATION-REHEARSAL.md.

## 3. Hardcoded admin (S-H3)

- `migrations/0054` is now a documented no-op. drizzle-orm 0.45's migrator picks files by `created_at` and never verifies stored hashes. So a database that applied the old 0054 is neither re-run nor rejected, and keeps its state, which means no lock-out in production. `tests/db/platform-owner.test.ts` pins this: a ledger carrying the original hash re-migrates cleanly and leaves the owner promoted. The journal entry for 0054 is unchanged.
- The opt-in grant is `scripts/ops/platform-owner.ts --email X --grant --confirm X`. It is read-only by default, idempotent and audited. It never creates a user, and it refuses a typo, a missing account, case-duplicate emails, or staff of another firm.
- **Decision:** `docs/proposed-migrations/revoke-shire602-admin.sql` does **not** become a migration, and it is removed. A migration cannot tell the owner's production from staging, so it would lock the owner out. It is replaced by the same command with `--revoke`, which non-owner environments run once. Details are in `docs/release/PLATFORM-OWNER.md`.

## 4. PINT AE EndpointID

`partyXml` in `server/services/einvoice.service.ts` emits `cbc:EndpointID` for both `AccountingSupplierParty` and `AccountingCustomerParty` with schemeID `0235`. The value is the 10-digit TIN taken from the 15-digit TRN, unless a Peppol endpoint is recorded for the party. The `claude/gracious-bohr-pymgxi` flag referred to main's older serializer.

**Gap closed.** A buyer with no recorded endpoint and no valid TRN used to pass the data check, and the document then failed the fatal `PINT-EndpointID` rule with a generic schematron error. Now:

- **Data check:** `validateForEInvoicing` reports `customer.endpointId` with code `EINVOICE_BUYER_ENDPOINT_MISSING` and a fix: add the buyer's 15-digit TRN, or record the customer's Peppol endpoint.
- **API:** submit and generate answer 422 `EINVOICE_VALIDATION_FAILED` with that issue, and neither ASP is called.
- **Rule text:** the `PINT-EndpointID` message now says where each party's endpoint comes from.
- **UI:** the invoice e-invoice dialog and the e-invoice status panel show localised fix text (en and ar) under a "Customer electronic address" label, with a link to the customer.
- **Tests** (`tests/unit/einvoice-endpoint-id-asp.test.ts`):
  - the serializer, with both parties on 0235 + TIN;
  - A-Cube, whose outgoing body is the raw XML;
  - Complyance in GETS mode (`parties.*.peppolId`, `peppol_*_peppolIdScheme = 0235`) and in Unify XML mode;
  - the refusal path for both providers;
  - the client mapping, and both locale catalogs.

One existing unit test encoded the old gap ("absent buyer TRN is fine") and was updated to the new contract. Both adapters stay selectable with no default ASP, and ZATCA stays hidden. Existing tests already pin both (`einvoice-provider-registry`, `sidebar-nav-behaviour`), and neither was changed.

## 5. ASP sandbox readiness

- `docs/release/asp-sandbox-runbook.md` has the env var names per ASP (secret or not, required or optional; no values), how to run the dry run, a checklist of what we need from A-Cube and from Complyance, and a run log.
- `scripts/ops/asp-sandbox-dryrun.ts` builds one sample PINT AE invoice and validates it locally (XSD, schematron and rules all pass). It then submits it to each sandbox whose credentials are present. It skips cleanly without them (exit 0), refuses any non-sandbox `ACUBE_ENV` or `COMPLYANCE_ENV` (exit 2), uses no database and prints no secret. It has not been run against a real sandbox: no credentials exist here, by design.

### Dry run, offline (no credentials), re-run on the WQ2/WQ5 merge (fd6fa0f)

```
=== EINVOICE_PROVIDER=acube (no credentials)
local validation: VALID (xsd=pass, schematron=pass, rules=pass)
SKIP A-Cube: not configured (missing ACUBE_EMAIL, ACUBE_PASSWORD)
no ASP sandbox credentials present: nothing was submitted (this is not an error)
exit=0
=== EINVOICE_PROVIDER=complyance (no credentials)
local validation: VALID (xsd=pass, schematron=pass, rules=pass)
SKIP Complyance: not configured (missing COMPLYANCE_API_KEY)
no ASP sandbox credentials present: nothing was submitted (this is not an error)
exit=0
```

Selection, probed through the provider registry with dummy credentials for **both** ASPs present:

```
EINVOICE_PROVIDER=(unset)     -> configured=[]              aspConfigured=false
EINVOICE_PROVIDER=acube       -> configured=["acube"]       aspConfigured=true
EINVOICE_PROVIDER=complyance  -> configured=["complyance"]  aspConfigured=true
ZATCA_ENABLED unset           -> zatcaEnabled=false; Saudi company jurisdiction=AE
```

There is no default ASP, each adapter is selectable on its own, and ZATCA stays hidden: the base's WQ3 `ZATCA_ENABLED` flag is off by default. The suites `einvoice-provider-registry`, `sidebar-nav-behaviour`, `einvoice-acube-adapter` and `einvoice-complyance-adapter` pass (65 tests), and the base's `tests/db/wq3-accounting-core.test.ts` passed in the DB run. WQ5's new e-invoicing identity and contacts did not change any of this.

**Owner checklist for the first live sandbox submission:** see "Owner request sheet" at the top of `docs/release/asp-sandbox-runbook.md`. For each ASP it covers the sandbox account, credentials by variable name only, the test seller and buyer TRNs and Peppol IDs, the webhook URLs to register (`/api/webhooks/einvoice/{acube|complyance}/sandbox`), network hosts, what to confirm in writing, and the activation order.

## Verified working (end to end on the latest #67)

### End-to-end checks in both languages (code head `523f150a`; later commits on this branch are documentation only)

Every row below was run on this head (the merge of #67 `066eeb88`, merge commit `1e4da558`) with a local production build and a throwaway Postgres, in English and Arabic, at phone (iPhone SE 375x667, Android 360x740, iPhone 13) and desktop (1440x900) sizes unless noted. Shots and logs: `/var/tmp/polish/shots-v9/`, `/var/tmp/polish/e2e-v9-*.log`.

| Flow (EN and AR)                                                                                                                                                                                                                                                   | Command                                                                                                              | Latest result                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Invoice link `/view/invoice/:token` (PDF, print, language, invalid/expired)                                                                                                                                                                                        | `npm run e2e:customer-links`                                                                                         | 962/962                                                               |
| Customer portal link `/portal/:token` (invoices, statement, quote, partial payment)                                                                                                                                                                                | `npm run e2e:customer-links`                                                                                         | 962/962                                                               |
| EmaraTax approval link, request and done mail                                                                                                                                                                                                                      | `npm run e2e:customer-links`                                                                                         | 962/962                                                               |
| Customer e-mails read from the outbox: invoice, reminder, quote, statement (Arabic greeting by Arabic name)                                                                                                                                                        | `npm run e2e:customer-links`                                                                                         | 962/962                                                               |
| Receipt e-mail (card payment, needs a gateway, so not in the browser run)                                                                                                                                                                                          | `npm run test:db` (`customer-links-flow`, `customer-emails-routes`) and `tests/unit/customer-email-greeting.test.ts` | pass (969 db tests)                                                   |
| Pricing, plan mailto subject                                                                                                                                                                                                                                       | `npm run e2e:auth-portal`                                                                                            | 1418/1418                                                             |
| Login, forgot password, reset password (incl. first paint: lang/dir and no English at DOMContentLoaded, first paint, FCP)                                                                                                                                          | `npm run e2e:auth-portal`                                                                                            | 1418/1418                                                             |
| Client portal pages (dashboard, invoices, documents, statements, messages)                                                                                                                                                                                         | `npm run e2e:auth-portal`                                                                                            | 1418/1418                                                             |
| Firm dashboard (command centre), client list (cards on phones, paging, Arabic search), "Open books" lands on the client's dashboard, client profile, invoice list and e-invoicing settings in a client's books, staff views, failing-API states                    | `npm run e2e:firm-tools`                                                                                             | 1092/1092                                                             |
| Firm API checks (assigned staff shown, no bank details in the list, A/R equals the settlement figure, client links scoped, 404 for another tenant)                                                                                                                 | `npm run e2e:firm-tools`                                                                                             | 1092/1092                                                             |
| 25 launch routes in Arabic, 0 English text nodes                                                                                                                                                                                                                   | `npm run e2e:arabic-runtime`                                                                                         | 25 routes, 0 English lines                                            |
| Accounting pages (Journal, entry detail, account ledger, bank reconciliation transactions/suggestions/rules, Reports and 26 report screens, Admin documents) at 1440, iPhone 13 and 360 px; empty, populated, failing-API and unknown-id states                    | `npm run e2e:books-pages`                                                                                            | 5,121 checks over 6 runs, 0 failed                                    |
| Customer links at 360 px Android with long EN/AR names, 24 lines and failing-API states                                                                                                                                                                            | `E2E_VIEWPORTS=android npm run e2e:customer-links`                                                                   | 595/595 (default run 1184/1184)                                       |
| Per-client e-invoicing: settings, provider choice, generate/validate/submit refused, sheet, XML/PDF, approval request, approver page states, firm column; owner and NR staff via Open books; iPhone 13, 360 px, 1440x900; every customer e-mail at 375/700/1000 px | `E2E_VIEWPORTS=android,13,desktop npm run e2e:einvoice-client`                                                       | 2107/2107 (2026-11-19, merged head)                                   |
| Bilingual customer e-mails: Arabic company with no preference gets both languages (invoice, reminder, quote, statement, approver); explicit ar/en wins                                                                                                             | `npm run e2e:customer-links` (phone, desktop) and `E2E_VIEWPORTS=android` on a restarted app                         | 1156/1156 and 581/581 (2026-11-19, merged head)                       |
| Accounting pages, auth and portal, firm tools, Arabic runtime re-run on the merged head                                                                                                                                                                            | `e2e:books-pages`, `e2e:auth-portal`, `e2e:firm-tools`, `e2e:arabic-runtime`                                         | 4921 ok / 0 fail, 1418/1418, 1112/1112, 25 routes 0 English lines     |
| Earlier PR-68 API and permission checks (tenant scoping, firm clients, portal confinement, Stripe webhook, migration 0131)                                                                                                                                         | `npm run test:integration` (`pr68-verified`)                                                                         | 52/52, suite 233/233 (last run at `fd6fa0f`; CI re-runs it each head) |
| Earlier PR-68 authenticated UI crawl (customer, NR firm, client portal)                                                                                                                                                                                            | `tests/e2e/authenticated-smoke-crawl.mjs`                                                                            | 0 failures (last run at `fd6fa0f`)                                    |

Checked against the merged head `fd6fa0f` (#67 base with WQ2, WQ3, WQ5 and WQ7) using a production build (`npm start`), a fresh database migrated through the index migration (then numbered 0129; the same file is now 0131), and real HTTP. There are no mocks. Later heads add the script's tooling-rule fix, docs, the secret-hygiene and CI change, the renumber to 0131 (with `pr68-verified` now asserting 131 ledger rows), and the model-roles rule; CI re-runs `pr68-verified` on each head.

**API: `tests/integration/pr68-verified.test.mjs`, 52/52 passing.** It is now part of `npm run test:integration`, so CI runs it. It follows the repo's integration rules: throttled fetch, and no skips. Without a Stripe secret it checks that the webhook answers 503 or 400, which also passes (50/50 in that mode). The whole `npm run test:integration` suite passes with it, 233/233.

| Area                   | What was exercised                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team member scoping    | Changing or removing another company's member through your own URL returns 404 and the row is untouched. The owner's own role change returns 200 and removal returns 204. The team list has no hashes.                                                                                    |
| Firm clients           | An NR client: create 201, edit 200, summary 200 with members and no credentials, switch 200, listed. A never-invited company: PUT, summary, switch and archive all 404, row unchanged.                                                                                                    |
| Firm-invited customers | Invite 201, accept 200. The inviting firm edits the profile (200). The customer revokes (200), after which the firm's edit is 404.                                                                                                                                                        |
| Admin client detail    | 200, with no credentials in the payload.                                                                                                                                                                                                                                                  |
| Client portal          | Profit and loss, balance sheet, dashboard, team and invoices are refused (403). `/api/auth/me` returns 200. `/api/companies` returns 200 `[]`. Binding the user to a contact returns 201. `/api/client-portal/{dashboard,invoices,statements,messages,documents,company}` all return 200. |
| Stripe webhook         | A signed raw-body event returns 200, a replay is a no-op (one event row), and a tampered body returns 400.                                                                                                                                                                                |
| Payment chasing        | An overdue invoice with a credit note shows outstanding 945. The chase queue returns 200.                                                                                                                                                                                                 |
| E-invoicing            | `/api/invoices/:id/einvoice/validate` reports `EINVOICE_BUYER_ENDPOINT_MISSING` for a buyer with no TRN. The offline dry run validates and skips cleanly for both `acube` and `complyance` (output above).                                                                                |
| Expense claims         | Entertainment VAT is not recoverable; travel VAT is recoverable.                                                                                                                                                                                                                          |
| Month-end              | A quarterly filer's mid-quarter month is not blocked.                                                                                                                                                                                                                                     |
| Migration 0131         | Both indexes exist and are valid, the ledger has 131 rows, and the planner uses `idx_invoices_original_invoice_id`.                                                                                                                                                                       |

**UI: authenticated browser crawl (`tests/e2e/authenticated-smoke-crawl.mjs`, Chromium) on `fd6fa0f`, 0 failures.** The crawl flags failed `/api/*` calls (>= 400), JS errors, redirects, blank pages, error text, and now not-found pages.

- **Customer owner (14 routes):** dashboard, invoices, an invoice edit page, contacts, payment chasing, expense claims, month-end, team, e-invoicing settings, company settings, bank reconciliation (where the reconciliation rules live), firm relationship, subscription, reports.
- **NR firm owner (5 routes):** the client list, an NR client's profile, the invited customer's profile, the command centre, health.
- **Client-portal user (5 routes):** portal dashboard, invoices, documents, statements, messages. A portal user who opens `/dashboard` is sent to `/client-portal/dashboard` with no failed calls.

`/company-profile` and `/reconciliation-rules` are intentional redirects, to `/settings/company` and the rules tab of `/bank-reconciliation`. Both targets load. Relative links and repository paths in the docs this PR adds resolve. (Old-branch paths in SUPERSEDED-PRS' "PR evidence" column are labelled as such.)

WQ5's new no-login e-invoicing approver page (`/portal/einvoicing-approve/:token`) uses a token and sits outside `authMiddleware`, so the portal confinement does not affect it.

**Broken paths found by this pass and fixed here:**

1. **Portal pages made a failing call (my regression).** The app shell lists companies on every page, and the portal confinement refused `GET /api/companies` with 403, so every portal page logged a failed call. That one call now answers `200 []` for portal users, so no supplier row reaches the customer. The accounting app (`ProtectedRoute`) now sends portal users to their portal instead of onboarding pages full of refused calls.
2. **The runbook's post-deploy route crawl could not sign in.** `npm run smoke:prod:routes` bounced every route to `/login`, because the SPA only probes the session after the login page sets its sign-in hint (R18-04). The crawler now sets that hint, and it also flags the in-app not-found page.
3. **Undocumented `FRONTEND_URL`.** In production, a browser loading the site with `FRONTEND_URL` unset gets every JS/CSS asset refused (403 `ORIGIN_NOT_ALLOWED`), so pages are blank. `curl` checks miss it. It is now in the runbook's environment table, with how to check it.

### Launch-readiness check (2026-11-18)

**Target.** Staging (`nr-ai-staging.up.railway.app`) was not reachable: the sandbox proxy answers `CONNECT ... 403`. I used a local production build of this branch instead (fresh Postgres 16, all migrations, `npm run build`, `npm start`). Stripe, email delivery, AI, ASP credentials and `ZATCA_ENABLED` were not configured locally, so they were not exercised.

**What was checked.** 7 checks: ZATCA hidden, e-invoicing on every plan, pricing 59/119/229 (590/1,190/2,290 a year), provider selectable with none pre-selected, PINT AE EndpointID scheme 0235, EmaraTax approval link (no login, no TRN), click-through (signup, onboarding, plans, settings, e-invoicing, portals). 4 passes each: EN and AR, desktop and phone. 14 public routes and 95 app routes per pass, every tab clicked.

**Results.** All 7 checks pass. Across 4 passes and 95 routes: 0 error screens, 0 blank pages, 0 horizontal scroll, 0 page errors, 0 API errors, `dir` correct everywhere. Re-run after the fixes on a fresh build: 95 routes x 4 passes, 0 events, public pass clean, with the OAuth limiter at its real default (the audit had to raise it).

**What was broken, and the fix** (tests fail before, pass after):

| Defect                                                                         | Fix (commit)                                                                                      | Test                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Login/register 429 after 30 loads, social buttons vanish                       | providers list exempt from the OAuth limiter, start/callback still limited (a24dc8ed)             | `tests/unit/oauth-providers-rate-limit.test.ts`                                  |
| `.env.example` said `EINVOICE_PROVIDER=http`                                   | empty, comment lists acube / complyance (a24dc8ed)                                                | n/a (docs)                                                                       |
| `/sitemap.xml`, `/llms.txt`, `/.well-known/security.txt` returned the SPA page | 404 (no real files exist, nothing invented) (875f88af)                                            | `tests/unit/unpublished-files-404.test.ts`                                       |
| Customer portal always English, left-to-right, no switch                       | opens in customer/company language, RTL for Arabic, language switch, remembered choice (143cdf12) | `tests/unit/customer-portal-language.test.ts`                                    |
| Missing buyer address showed only rule `ibr-144-ae`                            | named issue `customer.address` / `EINVOICE_BUYER_ADDRESS_MISSING` with EN/AR fix text (143cdf12)  | `tests/unit/einvoice-buyer-address.test.ts`, `tests/db/f1-reaudit-fixes.test.ts` |
| Arabic approval page step 3 garbled brackets                                   | bidi isolation of Latin names (afb96b81)                                                          | `tests/unit/emaratax-steps-bidi.test.ts`                                         |
| No cue that the workspace is read-only after the trial                         | localised banner on e-invoicing settings (c5e0cf80)                                               | `tests/unit/trial-banner-ended-only.test.ts`                                     |
| Overlapping provider blocks on e-invoicing settings                            | self-serve partner card first, status card after (c5e0cf80)                                       | same file (source-order check)                                                   |

Merge of the base (`ffa0c725`, which took migration 0130 for cash-sale numbering): merge commit `9ac68b8c`. Our settlement-index migration is now `0131_settlement_open_balance_indexes` (journal idx 130). Fresh database: migrated through 0131 twice (131 ledger rows both times, second run a no-op), both partial indexes exist and are valid. Gates: `npm run check`, `npm run lint`, `npm test` (264 files, 2,656 tests), `npm run test:db` (134 files, 941 tests), `check:migrations`, `tests/db/migrations.test.ts` all pass.

**Left alone on purpose.** `POST /customer-contacts` with an unknown key: the UI sends `trnNumber`, so nothing is dropped. The English reminder bodies and invoice preview labels are customer-facing document templates, not UI copy.

### Arabic runtime, migration re-timing, support email and plan buttons (2026-11-18)

**Arabic runtime crawl.** `npm run e2e:arabic-runtime` on a local production build, on the pre-merge head and again on the merged build: 25 routes/states (22 launch routes plus the three state probes), 0 English lines, 0 failures. Nothing was broken, so no fix or new test was needed. (Note for anyone re-running it: use `BASE_URL=http://localhost:PORT`, matching `FRONTEND_URL`; `127.0.0.1` gets the assets refused with 403 and the crawl reports every route as not RTL.)

**Migration re-timing after the renumber to 0131** (fresh 1x and 20x pre-0089 databases from main's chain plus the seed, then the full `rehearse.sh`, 0089-0131, 43 files):

| Check                                       | 1x                | 20x               |
| ------------------------------------------- | ----------------- | ----------------- |
| `db:migrate` total                          | 1.55 s            | 8.25 s            |
| 0131 on its own                             | 6 ms              | 21 ms             |
| Second `db:migrate`                         | no-op (131 = 131) | no-op (131 = 131) |
| Open balances, 10,000 invoices, one company | -                 | 56-82 ms          |

All 43 files re-ran by hand, the two migrators give the same schema, both indexes are valid, the rollback restore was exact (commit a4dbf222, `MIGRATION-REHEARSAL.md`). It did not re-run `find-sales-ledger-drift`.

**Support email and plan buttons.** Addresses in the UI and server: `support@muhasib.ai` (account menu, help centre, trust page, services, pricing and plan CTAs, plan-limit dialog, Najma handoff, forgot-password text, push subject), `hello@muhasib.ai` (marketing footer, legal layout, e-invoicing partner cards), `privacy@`, `security@`, `legal@muhasib.ai` (legal pages, EN and AR), and `noreply@muhasib.ai` (outbox sender). All well-formed; every `mailto:` link is valid. Plan and CTA check on `/`, `/pricing` and in-app `/subscription`, EN and AR, desktop and phone: every internal link resolves (no 404 or not-found page), the plan buttons open a mail link or `/register`, and there were 0 console errors and 0 failed requests. Nothing was broken, so nothing was changed. Not unified, as asked: two addresses are in use (`support@` and `hello@`). One small inconsistency was left then, and is fixed in the phone and Arabic audit below: the Enterprise mail subject on `/pricing` was in English even in Arabic mode.

**Merge and CI.** The base was merged again as `5525583e` (one conflict, `EmaraTaxSteps.tsx`: kept both the bidi isolate and the base's `translate="no"` span). CI on `5525583e` failed one unit test: the secret-hygiene test flagged the base's sweep scripts' password literal. Fixed in `834f7fda` (the persona password now declares itself fake). The migration number is still 0131. CI is re-run on every head; the CI row in the PR body holds the current result, not this page.

---

### فحص الجاهزية للإطلاق (2026-11-18)

**البيئة المستخدمة.** تعذّر الوصول إلى بيئة الاختبار (`nr-ai-staging.up.railway.app`) لأن الوكيل في بيئة العمل يرفض الاتصال (`CONNECT ... 403`). استخدمتُ بدلًا منها نسخة إنتاج محلية من هذا الفرع (قاعدة Postgres 16 جديدة مع كل الترحيلات ثم البناء والتشغيل). لم تُضبط محليًا خدمات Stripe والبريد والذكاء الاصطناعي وبيانات مزود الفوترة و`ZATCA_ENABLED`، لذلك لم تُختبر.

**ما جرى فحصه.** سبعة فحوص: إخفاء ZATCA، توفر الفوترة الإلكترونية في كل الباقات، الأسعار 59 و119 و229 شهريًا (590 و1,190 و2,290 سنويًا)، إمكانية اختيار المزود دون اختيار مسبق، رمز المخطط 0235 لمعرّف نقطة النهاية في PINT AE، رابط موافقة إمارات تاكس بلا تسجيل دخول ولا رقم ضريبي، ومسار الاستخدام الكامل (التسجيل والتهيئة والباقات والإعدادات والفوترة الإلكترونية والبوابات). أربع تمريرات لكل فحص: عربي وإنجليزي، حاسوب وجوال. 14 مسارًا عامًا و95 مسارًا داخل التطبيق في كل تمريرة مع الضغط على كل تبويب.

**النتائج.** نجحت الفحوص السبعة. عبر أربع تمريرات و95 مسارًا: صفر شاشات أخطاء، صفر صفحات فارغة، صفر تمرير أفقي، صفر أخطاء صفحة، صفر أخطاء واجهة برمجية، واتجاه الصفحة صحيح دائمًا. أُعيد التشغيل بعد الإصلاحات على بناء جديد: 95 مسارًا في أربع تمريرات بلا أي حدث خطأ، والتمريرة العامة نظيفة، وحدّ OAuth على قيمته الافتراضية الفعلية (كان الفحص الأول مضطرًا لرفعه).

**ما كان معطلًا وما أُصلح** (الاختبارات تفشل قبل الإصلاح وتنجح بعده):

| العيب                                                                      | الإصلاح (الإيداع)                                                                                              | الاختبار                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| خطأ 429 في الدخول والتسجيل بعد 30 تحميلًا واختفاء أزرار الدخول الاجتماعي   | استثناء قائمة المزودين من حدّ OAuth مع بقاء الحد على البدء والاستدعاء (a24dc8ed)                               | `tests/unit/oauth-providers-rate-limit.test.ts`                                  |
| `.env.example` يذكر `EINVOICE_PROVIDER=http`                               | قيمة فارغة وتعليق يذكر acube وcomplyance (a24dc8ed)                                                            | لا ينطبق (توثيق)                                                                 |
| `/sitemap.xml` و`/llms.txt` و`/.well-known/security.txt` تعيد صفحة التطبيق | تعيد 404 (لا توجد ملفات حقيقية ولم يُختلق محتوى) (875f88af)                                                    | `tests/unit/unpublished-files-404.test.ts`                                       |
| بوابة العميل بالإنجليزية ومن اليسار دائمًا بلا مبدّل لغة                   | تفتح بلغة العميل أو الشركة، من اليمين للعربية، مع مبدّل لغة واختيار محفوظ (143cdf12)                           | `tests/unit/customer-portal-language.test.ts`                                    |
| غياب عنوان المشتري يظهر كقاعدة `ibr-144-ae` فقط                            | مشكلة مسماة `customer.address` برمز `EINVOICE_BUYER_ADDRESS_MISSING` ونص إصلاح بالعربية والإنجليزية (143cdf12) | `tests/unit/einvoice-buyer-address.test.ts` و`tests/db/f1-reaudit-fixes.test.ts` |
| تشوه الأقواس في الخطوة 3 من صفحة الموافقة بالعربية                         | عزل اتجاه النص للأسماء اللاتينية (afb96b81)                                                                    | `tests/unit/emaratax-steps-bidi.test.ts`                                         |
| لا إشارة إلى أن مساحة العمل للقراءة فقط بعد انتهاء التجربة                 | شريط تنبيه مترجم في إعدادات الفوترة الإلكترونية (c5e0cf80)                                                     | `tests/unit/trial-banner-ended-only.test.ts`                                     |
| تداخل كتلتي المزود في إعدادات الفوترة الإلكترونية                          | بطاقة اختيار الشريك أولًا ثم بطاقة حالة الربط (c5e0cf80)                                                       | الملف نفسه (فحص ترتيب المصدر)                                                    |

دمج الفرع الأساسي (`ffa0c725` الذي أخذ ترحيل 0130 لترقيم البيع النقدي): إيداع الدمج `9ac68b8c`. أصبح ترحيل فهارس التسوية `0131_settlement_open_balance_indexes` (رقم السجل 130). على قاعدة جديدة: نُفّذ الترحيل حتى 0131 مرتين (131 صفًا في السجل في المرتين، والثانية بلا أثر) والفهرسان الجزئيان موجودان وصالحان. نجحت كل البوابات: `npm run check` و`npm run lint` و`npm test` (264 ملفًا، 2,656 اختبارًا) و`npm run test:db` (134 ملفًا، 941 اختبارًا) و`check:migrations` و`tests/db/migrations.test.ts`.

**ما تُرك عمدًا.** إرسال مفتاح غير معروف في `POST /customer-contacts`: الواجهة ترسل `trnNumber` فلا يضيع شيء. نصوص التذكير الإنجليزية وعناوين معاينة الفاتورة قوالب مستندات موجهة للعملاء وليست نصوص واجهة.

### العربية وقت التشغيل، إعادة قياس الترحيل، بريد الدعم وأزرار الباقات (2026-11-18)

**زحف العربية وقت التشغيل.** نُفّذ `npm run e2e:arabic-runtime` على نسخة إنتاج محلية، قبل الدمج الأخير وبعده: 25 مسارًا وحالة (22 مسار إطلاق وثلاثة فحوص حالات)، صفر أسطر إنجليزية، صفر إخفاقات. لم يكن هناك عطل فلم يلزم إصلاح أو اختبار جديد. (ملاحظة لمن يعيد التشغيل: استخدم `BASE_URL=http://localhost:PORT` ليطابق `FRONTEND_URL`؛ العنوان `127.0.0.1` يُرفض معه تحميل الملفات بخطأ 403.)

**إعادة قياس الترحيل بعد إعادة الترقيم إلى 0131** (قاعدتان جديدتان بحجم 1x و20x من سلسلة main مع البيانات التجريبية، ثم `rehearse.sh` كاملًا، الترحيلات 0089-0131 أي 43 ملفًا):

| الفحص                                  | 1x                  | 20x                 |
| -------------------------------------- | ------------------- | ------------------- |
| زمن `db:migrate` الكلي                 | 1.55 ث              | 8.25 ث              |
| ترحيل 0131 وحده                        | 6 م.ث               | 21 م.ث              |
| `db:migrate` الثاني                    | بلا أثر (131 = 131) | بلا أثر (131 = 131) |
| الأرصدة المفتوحة لشركة بـ10,000 فاتورة | -                   | 56-82 م.ث           |

أُعيد تنفيذ الملفات الـ43 يدويًا بنجاح، والمخطط متطابق بين الأداتين، والفهرسان صالحان، واستعادة النسخة الاحتياطية دقيقة (الإيداع a4dbf222 و`MIGRATION-REHEARSAL.md`). لم يُعد تشغيل `find-sales-ledger-drift`.

**بريد الدعم وأزرار الباقات.** العناوين الظاهرة في الواجهة والخادم: `support@muhasib.ai` (قائمة الحساب ومركز المساعدة وصفحة الثقة والخدمات وأزرار الأسعار والباقات ونافذة حد الباقة وتحويل نجمة ونص نسيان كلمة المرور)، و`hello@muhasib.ai` (تذييل التسويق وقالب الصفحات القانونية وبطاقات شركاء الفوترة الإلكترونية)، و`privacy@` و`security@` و`legal@muhasib.ai` (الصفحات القانونية بالعربية والإنجليزية)، و`noreply@muhasib.ai` (مرسل البريد). كلها سليمة الصياغة وكل روابط `mailto:` صحيحة. فُحصت الصفحة الرئيسية و`/pricing` و`/subscription` داخل التطبيق بالعربية والإنجليزية على الحاسوب والجوال: كل الروابط الداخلية تعمل (بلا 404 ولا صفحة غير موجودة)، وأزرار الباقات تفتح رابط بريد أو `/register`، وبلا أخطاء في وحدة التحكم ولا طلبات فاشلة. لم يكن هناك عطل فلم يُغيَّر شيء. لم يُوحَّد العنوانان كما طُلب (`support@` و`hello@`). ملاحظة صغيرة تُركت حينها وأُصلحت في فحص الهاتف والعربية أدناه: موضوع رسالة Enterprise في `/pricing` كان بالإنجليزية حتى في الوضع العربي.

**الدمج والتكامل المستمر.** دُمج الفرع الأساسي مجددًا (`5525583e`، تعارض واحد في `EmaraTaxSteps.tsx`: أبقيتُ عزل الاتجاه ووسم `translate="no"` من الأساس). فشل في CI على `5525583e` اختبار وحدة واحد: اختبار نظافة الأسرار رصد كلمة مرور في نصوص الفحص الشامل من الأساس. أُصلح في `834f7fda` (كلمة المرور تعلن الآن أنها وهمية). رقم الترحيل ما زال 0131. يُعاد تشغيل التكامل المستمر على كل رأس جديد، ونتيجته الحالية في صف CI من وصف الطلب وليس في هذه الصفحة.

---

### Customer-facing polish: invoice link, EmaraTax approval, emails (2026-11-18)

**Audited.** The customer portal `/portal/:token`, the no-login EmaraTax approval page `/portal/einvoicing-approve/:token` (390x844 iPhone 13 and 1440x900, EN and AR, valid, invalid, expired and revoked states; production build, Playwright, axe) and every customer e-mail (invoice, reminder, receipt, quote, statement, portal sign-in code, approver request/done, password reset) rendered in EN, AR and bilingual. Full list: `/var/tmp/polish/AUDIT.md`.

**What was wrong.** Both pages booted the whole signed-in app (582 KB JS, 115 requests); an invalid link read "has ended"; English server text reached Arabic users; the `?payment=` return was ignored; the approver page never reached network idle on a bad token (unread body); Arabic names and the partner label were not bidi-isolated (brackets flipped); no page title, h1 or main landmark. E-mails: Arabic messages had English subjects and English plain text, mixed-language reminder subjects, `AED 3886.05` without grouping, ISO dates, a provider event id as "Reference", the seller TRN in every footer, no preheader, no `lang`/`dir`, fixed 600 px layout, unstyled quote and approver e-mails.

**What changed.**

- `c4b3eea5` e-mail: one responsive bilingual layout (`server/services/email-layout.ts`) and pure templates (`customer-emails.ts`): preheader, `lang`/`dir`, fluid card, 48 px bulletproof button plus the plain link, one footer, plain-text part from the same content, subject/HTML/text in one language (customer's `preferredLanguage`, now settable on contacts, else both), the app's money/date formatters, no TRN and no provider ids. Tests: `tests/unit/customer-emails.test.ts` (48), `tests/db/customer-emails-routes.test.ts` (6).
- `f11b5530` pages: `/portal/*` boots the light `PublicApp` root with only its catalogs; first screen is one `/api/portal/:token/overview` request, other tabs load on open; status-based link states (invalid, expired, revoked, busy, retry); localized errors; payment return banner; Pay busy state; skeleton; titles, h1, main; print stylesheet; 44 px tabs on touch; Arabic browser opens Arabic; approver page reads bodies and isolates names. Tests: `tests/unit/customer-link-pages.test.ts` (14), `tests/db/portal-overview.test.ts` (3), updated `emaratax-steps-bidi`, `wq5-einvoice-ui`, `customer-portal-language`.
- `ed40234d` bidi pin, `431f827a` bundle baseline refresh (CustomerPortal chunk grew 14.6 to 19.8 KB for the new states; total shipped JS per page fell).

**Before / after** (local, encoded bytes, cold; LCP is noisy): portal EN JS 582 to 255 KB, requests 115 to 54, LCP 548 to 376 ms (phone); portal AR JS 665 to 261 KB, 122 to 60 requests; approve EN JS 569 to 239 KB, 101 to 36 requests, LCP 360 to 204 ms; approve invalid-token network idle never (8 s cap) to 0.7 s. After: 0 console errors on valid pages, 0 failed requests, 0 horizontal overflow, 0 axe violations across 28 captures; the only console line on invalid/expired states is the browser's own "Failed to load resource 404/410". E-mails: 12 templates re-rendered, 0 overflow at 390 px.

**Gates.** `npm run check`, `npm run lint`, `npm test` (269 files, 2741 passed), `npm run test:db` (136 files, 950 passed), `npm run e2e:arabic-runtime` (25 routes, 0 English lines), bundle budget. CI on final head `431f827a`: all 6 checks passed (typecheck/lint/unit/build/bundle budget, DB harness, browser E2E crawl, boot gate, self-hosting gate, GitGuardian).

**Skipped (off-limits or out of scope).** ZATCA, registration/onboarding (welcome and e-mail verification e-mails), the client-portal invite flow and `/client-portal/*`, the admin plan editor, prices, the support address (`support@muhasib.ai` stays in auth responses), team invitations, payslips, firm WhatsApp/document chasing. Left for later: a "preferred language" field in the contact form, `/view/invoice/:token` still booted the full app and the entry bundle still carried zod (39 KB) for every public page (both done in round 2 below).

---

### تحسين الواجهات المواجهة للعملاء: رابط الفاتورة، موافقة إمارات تاكس، رسائل البريد (18-11-2026)

**ما جرى تدقيقه.** بوابة العملاء `/portal/:token` وصفحة الموافقة بلا تسجيل دخول `/portal/einvoicing-approve/:token` (بدقة 390x844 و1440x900، بالعربية والإنجليزية، وحالات الرابط الصالح وغير الصالح والمنتهي والمسحوب؛ نسخة إنتاجية مع Playwright وaxe)، وكل رسائل البريد الموجهة للعملاء (فاتورة، تذكير، إيصال، عرض سعر، كشف حساب، رمز دخول البوابة، طلب الموافقة وإشعار الإتمام، إعادة تعيين كلمة المرور) بالعربية والإنجليزية وثنائية اللغة. القائمة كاملة في `/var/tmp/polish/AUDIT.md`.

**ما كان خاطئاً.** الصفحتان كانتا تحمّلان التطبيق الكامل (582 كيلوبايت جافاسكربت و115 طلباً)؛ والرابط غير الصالح كان يظهر "انتهى"؛ ونصوص أخطاء إنجليزية تصل إلى مستخدمي العربية؛ وعودة الدفع `?payment=` كانت تُتجاهل؛ وصفحة الموافقة لا تبلغ حالة السكون مع رمز خاطئ؛ والأسماء اللاتينية وتسمية الشريك غير معزولة اتجاهياً فتنقلب الأقواس؛ ولا عنوان للصفحة ولا h1 ولا main. وفي الرسائل: موضوع ونص عاديان بالإنجليزية في الرسائل العربية، وموضوع تذكير مختلط، ومبالغ بلا فواصل آلاف وتواريخ ISO، ومعرّف حدث من مزود الدفع بوصفه "مرجعاً"، والرقم الضريبي للبائع في كل تذييل، ولا نص معاينة ولا `lang`/`dir`، وعرض ثابت 600 بكسل، ورسائل عرض السعر والموافقة بلا تنسيق.

**ما تغيّر.**

- `c4b3eea5` البريد: قالب واحد متجاوب ثنائي اللغة مع نص معاينة و`lang`/`dir` وزر 48 بكسل مع الرابط الصريح وتذييل موحّد ونسخة نصية من المحتوى نفسه؛ الموضوع والنص والـHTML بلغة واحدة (لغة العميل المفضلة وقد صار ممكناً حفظها، وإلا اللغتان معاً)؛ تنسيق المبالغ والتواريخ كما في التطبيق؛ بلا رقم ضريبي ولا معرّفات داخلية. الاختبارات: `customer-emails.test.ts` (48) و`customer-emails-routes.test.ts` (6).
- `f11b5530` الصفحات: مسارات `/portal/*` تعمل بالجذر الخفيف مع الفهارس اللازمة فقط؛ الشاشة الأولى طلب واحد `/overview` والتبويبات الأخرى عند فتحها؛ حالات الرابط من رمز HTTP (غير صالح، منتهٍ، مسحوب، ازدحام مع إعادة المحاولة)؛ رسائل مترجمة؛ إشعار عودة الدفع؛ حالة انتظار لزر الدفع؛ هيكل تحميل؛ عنوان وh1 وmain؛ طباعة؛ أهداف لمس 44 بكسل؛ فتح العربية لمتصفح عربي؛ عزل اتجاهي للأسماء. الاختبارات: `customer-link-pages.test.ts` (14) و`portal-overview.test.ts` (3) مع تحديث ثلاثة اختبارات قائمة.
- `ed40234d` تثبيت العزل الاتجاهي، و`431f827a` تحديث خط أساس الحزم.

**قبل / بعد** (محلياً، بالبايتات المضغوطة، وLCP متذبذب): البوابة بالإنجليزية 582 إلى 255 كيلوبايت و115 إلى 54 طلباً؛ وبالعربية 665 إلى 261؛ صفحة الموافقة 569 إلى 239 كيلوبايت و101 إلى 36 طلباً؛ بلوغ السكون مع رمز خاطئ من "لا يحدث" إلى 0.7 ثانية. بعد التعديل: صفر أخطاء في وحدة التحكم للصفحات الصالحة، وصفر طلبات فاشلة، وصفر تجاوز أفقي، وصفر مخالفات axe في 28 لقطة.

**البوابات.** `npm run check` و`lint` و`npm test` (2741 ناجحاً) و`npm run test:db` (950 ناجحاً) و`e2e:arabic-runtime` (25 مساراً، صفر أسطر إنجليزية)، وميزانية الحزم. نتيجة CI على آخر إيداع `431f827a`: نجحت الفحوص الستة كلها.

**ما تُرك (خارج النطاق أو محظور).** ZATCA، التسجيل والتهيئة (بريد الترحيب والتحقق)، دعوة بوابة العميل و`/client-portal/*`، محرر الأسعار، عنوان الدعم، دعوات الفريق، قسائم الرواتب، واتساب المكتب. مؤجل: حقل "اللغة المفضلة" في نموذج جهة الاتصال، و`/view/invoice/:token` كان يحمّل التطبيق الكامل (أُنجز في الجولة الثانية أدناه).

---

### Customer-facing polish, round 2 and end-to-end check (2026-11-18)

**What changed** (`26be3457`):

- `/view/invoice/:token` now boots the light `PublicApp` root like `/portal/:token` (no signed-in app, motion or socket). Invalid (404), expired (410), busy (429) and failed states are told apart by HTTP status and localized; it opens in the customer's language, else the company's, else the browser's; title, one h1, main landmark, print stylesheet (controls hidden), 44 px targets, the PDF is a plain download link, a busy state on Pay and a payment-cancelled banner. Tests: `tests/unit/public-invoice-view.test.ts` (render: states, language, Pay with and without a gateway).
- zod is off the public entry path: landing, pricing and the three no-login links no longer download `vendor-forms` (130,673 B raw, 39,428 B gzip). The zod configuration loads before form pages only (`main.tsx`, `PublicApp.tsx`); `zCompanyRole` moved to `shared/validators/company-role.ts` so the browser session code is zod-free. Signed-in app unchanged. The e2e asserts `/` and `/pricing` request no zod and `/login`, `/register` still load the config first.
- Contact form: optional "Preferred language for emails and links" (English / Arabic / company default), EN+AR catalog. Saves through the existing API (`preferredLanguage`); an Arabic company now writes to customers without a preference in Arabic (invoice, reminder, quote, statement, receipt, approver request and done mail); an English company keeps both languages. Tests: `tests/db/customer-links-flow.test.ts` (5: save/change/clear, English and Arabic company mail, card receipt, approver mail without TRN, 404/410), the contact body in `public-invoice-view.test.ts`, `d5b-form-payloads` updated.
- Bundle baseline refreshed: `PublicInvoiceView` chunk 11.9 to 14.3 KB (new states, title, language); the page no longer ships the app.

**End to end** (local production build, throwaway Postgres on :5441, no mail provider, no gateway; `npm run e2e:customer-links`, `tests/e2e/customer-links-flow.mjs`): English company, Arabic company and an Arabic-preferring contact of an English company, each at iPhone 13 and 1440x900. Customer created (once through the contact form UI), invoice sent, mail read from the outbox, link opened signed out; PDF download, print view, language switch, Pay absent without a gateway; reminder; partial payment (page shows new status and balance); quote (portal link opened); statement; EmaraTax request, approver link opened logged out and approved, done mail; invalid and expired tokens. 906/906 checks: 0 console errors (browser's own 404/410 line excepted), 0 failed `/api` calls on valid flows, 0 horizontal overflow, `lang`/`dir` correct, no English text in Arabic pages and mail, no TRN on the approval page or its API, every mail link absolute and resolving. Shots: `/var/tmp/polish/shots-e2e/`. The e2e found and this commit fixed: zod still in the link pages (via `shared/permissions.ts`), invalid/expired invoice links ignoring an Arabic browser, 38 px and 32 px targets, Arabic company mail still bilingual.

**Gates.** `npm run check`, `npm run lint`, `npm test` (270 files, 2751 passed), `npm run test:db` (139 files, 961 passed), `e2e:arabic-runtime` (25 routes, 0 English lines), bundle budget (baseline refreshed for the growth above). CI on `26be3457`: all 6 checks passed.

**Skipped.** Receipt mail in the browser e2e (it exists only for a confirmed card payment, which needs a gateway; covered by the DB test with a signed webhook). A statement mail has no link of its own (PDF attached). Off-limits items untouched.

---

### تحسين الواجهات للعملاء، الجولة الثانية والفحص الشامل (18-11-2026)

**ما تغيّر** (`26be3457`):

- صفحة `/view/invoice/:token` تعمل الآن بالجذر الخفيف `PublicApp` مثل البوابة (بلا التطبيق الكامل). حالات الرابط (غير صالح 404، منتهٍ 410، ازدحام 429، فشل) تُميَّز برمز HTTP وتُترجم؛ وتفتح بلغة العميل ثم الشركة ثم المتصفح؛ عنوان وh1 وmain وطباعة تخفي الأزرار وأهداف لمس 44 بكسل وتنزيل PDF برابط عادي وحالة انتظار للدفع. الاختبار: `tests/unit/public-invoice-view.test.ts`.
- أُخرجت zod من مسار الصفحات العامة: الرئيسية والأسعار وروابط العملاء الثلاثة لا تحمّل `vendor-forms` (130,673 بايت، و39,428 مضغوطة). تُحمَّل إعدادات zod قبل صفحات النماذج فقط، ونُقل `zCompanyRole` إلى `shared/validators/company-role.ts`. سلوك التطبيق بعد الدخول لم يتغير.
- نموذج جهة الاتصال: حقل اختياري "اللغة المفضلة للرسائل والروابط" (إنجليزية، عربية، افتراضي الشركة) بنصوص عربية وإنجليزية. الشركة العربية تراسل عملاءها بالعربية عند عدم تحديد تفضيل (فاتورة، تذكير، عرض سعر، كشف حساب، إيصال، طلب الموافقة وإشعارها)؛ والشركة الإنجليزية تبقى بلغتين. الاختبارات: `tests/db/customer-links-flow.test.ts` (5) واختبار النموذج وتحديث `d5b-form-payloads`.
- تحديث خط أساس الحزم: ارتفعت حزمة `PublicInvoiceView` من 11.9 إلى 14.3 كيلوبايت (حالات جديدة)، ولم تعد الصفحة تحمّل التطبيق.

**الفحص الشامل** (نسخة إنتاج محلية وPostgres مؤقت ولا مزود بريد ولا بوابة دفع؛ `npm run e2e:customer-links`): شركة إنجليزية وأخرى عربية وجهة اتصال عربية في شركة إنجليزية، بدقة iPhone 13 و1440x900. إنشاء العميل (مرة عبر نموذج الواجهة) والفاتورة، إرسالها، قراءة الرسالة من جدول الصادر وفتح الرابط بلا دخول؛ تنزيل PDF والطباعة ومبدّل اللغة وغياب زر الدفع دون بوابة؛ تذكير؛ دفعة جزئية؛ عرض سعر (فتح رابط البوابة)؛ كشف حساب؛ طلب موافقة إمارات تاكس وفتح الرابط دون دخول والموافقة؛ ورموز غير صالحة ومنتهية. النتيجة 906 من 906: صفر أخطاء وحدة تحكم (عدا سطر المتصفح 404/410)، صفر طلبات `/api` فاشلة، صفر تمرير أفقي، `lang`/`dir` صحيحان، لا إنجليزية في الصفحات والرسائل العربية، لا رقم ضريبي في صفحة الموافقة، وكل روابط الرسائل مطلقة وتعمل. اللقطات: `/var/tmp/polish/shots-e2e/`. وجد الفحص وأُصلح: بقاء zod في صفحات الروابط، وتجاهل الرابط غير الصالح لمتصفح عربي، وأهداف أصغر من 44 بكسل، ورسائل الشركة العربية بلغتين.

**البوابات.** `check` و`lint` و`npm test` (270 ملفاً، 2751 ناجحاً) و`test:db` (139 ملفاً، 961 ناجحاً) و`e2e:arabic-runtime` (25 مساراً، صفر أسطر إنجليزية) وميزانية الحزم. نتيجة CI على `26be3457`: نجحت الفحوص الستة كلها.

**ما تُرك.** رسالة الإيصال في فحص المتصفح (لا تُرسل إلا عند دفعة بطاقة مؤكدة وتحتاج بوابة؛ مغطاة باختبار قاعدة البيانات بإشعار موقّع). رسالة كشف الحساب بلا رابط (PDF مرفق). البنود المحظورة لم تُمس.

---

### Phone and Arabic audit of customer-facing screens (2026-11-18)

**Covered.** Public invoice link, customer portal link, EmaraTax approval page, all customer e-mails (EN and AR at 375 px), `/pricing` and the landing plan strip, login, forgot/reset password, and `/client-portal/*` (dashboard, invoices, documents, statements, messages). iPhone SE 375x667, iPhone 13, a 360x740 Android and 1440x900, English and Arabic; loading, empty, error, long-name and many-line states, keyboard open on the forms. Local production build, throwaway Postgres, axe-core. Full list: `/var/tmp/polish/AUDIT-3.md`.

**What was wrong, what changed** (`bceb4a51`):

- `/client-portal/*` booted the whole signed-in app (589 KB JS, 118 requests, LCP 6.0 s on Slow 4G). It now has its own light root `PortalApp` with portal-only catalogs and no motion: 290 KB, 56 requests, LCP 3.2 s (Arabic 672 to 294 KB, 6.4 to 3.3 s). Also fixed: two `h1`s and skipped heading levels, the marketing tab title, broken nav pills (nested anchors) on phones, a silent failure when an invoice PDF download fails (now a localized message). Tests: `tests/unit/portal-app-light-root.test.ts`.
- The Enterprise mailto subject on `/pricing` stayed English in Arabic. Every plan mailto (pricing table, plan cards, plan-limit dialog, billing page) now takes its subject from the catalogs; address and prices unchanged, no body. Test: `tests/unit/plan-contact-subject.test.ts`.
- Sign-in LCP 4.5 to 2.6 s: catalogs are warmed on the first touch of the form instead of on `load`; forgot/reset chunks prefetched, auth pages load only their catalogs, the install banner (and framer-motion) loads only when the browser offers an install. Test: `tests/unit/warm-on-interaction.test.ts`.
- 44 px targets (logo, pricing toggles, landing links, portal links and inputs), currency code never under 12 px and readable in the amount-due box (axe contrast), 12 px minimum in the landing mock, login e-mail is the saved `username` with e-mail keyboard hints and `dir=ltr`, one Arabic FAQ sentence reworded. Test: `tests/unit/auth-forms-attributes.test.ts`.
- New browser check `npm run e2e:auth-portal` (`tests/e2e/auth-portal-flow.mjs`): 4 devices x en/ar, login (wrong password, keyboard), forgot, reset, pricing, five portal pages, PDF download and failure: 1346/1346.

**Gates.** `check`, `lint`, `npm test` (274 files, 2773 passed), `test:db` (139 files, 961 passed), `e2e:arabic-runtime` (25 routes, 0 English lines), `e2e:customer-links` (906/906), `e2e:auth-portal` (1346/1346), bundle budget passes without a baseline update. CI on `bceb4a51`: all six checks green.

**Skipped.** Arabic customer e-mails greeted with the invoice's customer-name snapshot (fixed in `f7fed68c`, below). Sign-in still warms all catalogs after the first touch. Off-limits items (ZATCA, signup/onboarding, invite flow, price editor, prices, support address, bundle baseline) untouched.

---

### فحص الهاتف والعربية للواجهات المواجهة للعملاء (18-11-2026)

**ما شمله الفحص.** رابط الفاتورة العام، رابط بوابة العميل، صفحة موافقة إمارات تاكس، رسائل العملاء كلها (بالإنجليزية والعربية بعرض 375)، صفحة الأسعار وشريط الباقات في الرئيسية، تسجيل الدخول، نسيان كلمة المرور وإعادة تعيينها، و`/client-portal/*` (لوحة التحكم، الفواتير، المستندات، الكشوف، الرسائل). iPhone SE وiPhone 13 وأندرويد 360x740 وسطح مكتب 1440x900، بالإنجليزية والعربية؛ حالات التحميل والفراغ والخطأ والأسماء الطويلة وكثرة البنود ولوحة المفاتيح مفتوحة. نسخة إنتاج محلية وPostgres مؤقت وaxe-core. التفاصيل: `/var/tmp/polish/AUDIT-3.md`.

**ما كان خطأً وما تغيّر** (`bceb4a51`):

- كانت `/client-portal/*` تحمّل التطبيق الكامل (589 ك.ب جافاسكربت و118 طلباً وLCP 6.0 ثانية على 4G بطيء). صار لها جذر خفيف `PortalApp` بفهارس نصوص خاصة بها وبلا حركات: 290 ك.ب و56 طلباً وLCP 3.2 ثانية (بالعربية 672 إلى 294 ك.ب و6.4 إلى 3.3 ثانية). وأُصلح أيضاً: عنوانان h1 وتخطي مستويات العناوين، وعنوان التبويب التسويقي، وأزرار التنقل المكسورة على الهاتف (روابط متداخلة)، وفشل صامت عند تعذر تنزيل PDF (صار برسالة مترجمة). الاختبار: `tests/unit/portal-app-light-root.test.ts`.
- موضوع رسالة "تحدث إلينا" لباقة المؤسسات في `/pricing` بقي بالإنجليزية في وضع العربية. صار موضوع كل روابط الباقات (جدول الأسعار وبطاقات الباقات ونافذة حد الباقة وصفحة الفوترة) من الفهارس؛ العنوان والأسعار كما هي ولا نص للرسالة. الاختبار: `tests/unit/plan-contact-subject.test.ts`.
- تسجيل الدخول: LCP من 4.5 إلى 2.6 ثانية بتأجيل تحميل بقية الفهارس إلى أول لمسة للنموذج بدل حدث `load`؛ وتحميل مسبق لصفحتي النسيان والتعيين، وتحميل فهارس صفحات الدخول فقط، ولافتة التثبيت (وframer-motion) لا تُحمَّل إلا حين يعرض المتصفح التثبيت. الاختبار: `tests/unit/warm-on-interaction.test.ts`.
- أهداف لمس 44 بكسل (الشعار ومفاتيح الأسعار وروابط الرئيسية وروابط البوابة وحقولها)، ورمز العملة لا يقل عن 12 بكسل ويُقرأ داخل مربع المبلغ المستحق (تباين axe)، وحد أدنى 12 بكسل في صورة المنتج بالرئيسية، وبريد الدخول هو "اسم المستخدم" المحفوظ مع لوحة مفاتيح البريد واتجاه `ltr`، وإعادة صياغة جملة عربية واحدة في الأسئلة الشائعة. الاختبار: `tests/unit/auth-forms-attributes.test.ts`.
- فحص متصفح جديد `npm run e2e:auth-portal` (`tests/e2e/auth-portal-flow.mjs`): 4 أجهزة بالإنجليزية والعربية، الدخول (كلمة مرور خاطئة ولوحة مفاتيح) والنسيان والتعيين والأسعار وخمس صفحات بوابة وتنزيل PDF وفشله: 1346 من 1346.

**البوابات.** `check` و`lint` و`npm test` (274 ملفاً، 2773 ناجحاً) و`test:db` (139 ملفاً، 961 ناجحاً) و`e2e:arabic-runtime` (25 مساراً، صفر أسطر إنجليزية) و`e2e:customer-links` (906 من 906) و`e2e:auth-portal` (1346 من 1346) وميزانية الحزم تنجح دون تحديث خط الأساس. نتيجة CI على `bceb4a51`: نجحت الفحوص الستة كلها.

**ما تُرك.** رسائل العملاء بالعربية كانت تخاطب باسم الفاتورة (أُصلح في `f7fed68c`، أدناه). وتسجيل الدخول ما زال يسخّن كل الفهارس بعد أول لمسة. البنود المحظورة (ZATCA والتسجيل والتهيئة ودعوة البوابة ومحرر الأسعار والأسعار وبريد الدعم وخط أساس الحزم) لم تُمس.

---

### Arabic greetings and instant Arabic sign-in (2026-11-18)

**What changed.**

- `f7fed68c`: Arabic customer e-mails greeted by the English invoice-name snapshot. `arabicGreeting()` (`server/services/customer-emails.ts`) now picks the contact's Arabic name (`name_ar`, no migration), else an Arabic-script document name, else the company's Arabic name, else a neutral "عزيزنا العميل،"; a Latin-script name is never used in Arabic. All five senders (invoice, reminder, receipt, quote, statement) pass the contact's Arabic name; English keeps the English name; bilingual mail shows each in its own block. The EmaraTax approver mail greets a person, not a customer, and is unchanged.
- `8e82d28d`: an Arabic user saw the sign-in page start left-to-right and flip after mount (`<html dir>` was set in an effect). The stored locale now sets `lang`/`dir` in the head script before first paint and in `main.tsx` before the first render; catalogs were already loaded before the first render, only the active language's auth set (login, forgot, reset), the rest stays lazy.

**Tests.** `tests/unit/customer-email-greeting.test.ts` (helper: Arabic name, only English name, company Arabic name, none, Latin-in-Arabic-field, escaping; all five builders in ar/en/bilingual), `tests/db/customer-emails-routes.test.ts` (an Arabic invoice and reminder send uses the Arabic name end to end, neutral without one, English unchanged), `tests/unit/auth-first-paint-locale.test.ts` (catalog choice and the head script), `e2e:customer-links` (962/962, greeting asserted from the outbox) and `e2e:auth-portal` (1418/1418, lang/dir and no English text at DOMContentLoaded, first paint and FCP on phone and desktop; it fails on the previous build).

**LCP, Slow 4G, iPhone SE, 4x CPU, Arabic, 3 runs each (before to after).** Sign-in 2.42-2.49 s to 2.44-2.52 s, forgot 2.49-2.56 s to 2.44-2.50 s, reset 2.48-2.52 s to 2.48-2.54 s: unchanged within noise. The gain is correctness: first paint is already right-to-left Arabic, so there is no direction flip or layout shift. Preloading the Arabic font before the first render was tried and rejected (sign-in LCP rose to about 3.5 s).

**Gates.** `check`, `lint`, `npm test` (276 files, 2809 passed), `test:db` (139 files, 963 passed), the three e2e commands above, bundle budget passes with no baseline update. CI on `8e82d28d`: not started. The base branch has moved and the PR now reports merge conflicts, so GitHub does not start the `pull_request` workflow; only GitGuardian ran (success). Per the owner's instruction the base is not merged this round; CI re-runs once #67's fix sets are merged and the base is merged in. Last full CI: all six green on `bceb4a51`.

---

### التحيات العربية وتسجيل دخول عربي فوري (18-11-2026)

**ما تغيّر.**

- `f7fed68c`: كانت رسائل العملاء بالعربية تخاطب باسم الفاتورة الإنجليزي. صارت `arabicGreeting()` تختار الاسم العربي لجهة الاتصال (`name_ar` بلا ترحيل)، ثم اسماً مكتوباً بالعربية من المستند، ثم الاسم العربي للشركة، ثم تحية محايدة "عزيزنا العميل،"؛ ولا يدخل اسم لاتيني في تحية عربية أبداً. المرسِلات الخمسة (فاتورة، تذكير، إيصال، عرض سعر، كشف حساب) تمرر الاسم العربي؛ والإنجليزية تبقى كما هي؛ والرسالة بلغتين تعرض كل اسم في كتلته. رسالة طلب موافقة إمارات تاكس تخاطب شخصاً لا عميلاً ولم تتغير.
- `8e82d28d`: كان مستخدم العربية يرى صفحة الدخول تبدأ من اليسار ثم تنقلب بعد التحميل (كان `<html dir>` يُضبط في تأثير جانبي). صار اللغة المحفوظة تضبط `lang`/`dir` في سكربت الرأس قبل أول رسم وفي `main.tsx` قبل أول عرض؛ وكانت الفهارس تُحمَّل قبل أول عرض أصلاً، لغة المستخدم فقط ومجموعة صفحات الدخول فقط، والباقي كسول.

**الاختبارات.** `customer-email-greeting` (الدالة بكل الحالات والمنشئات الخمسة)، واختبار قاعدة البيانات (الإرسال العربي للفاتورة والتذكير يستعمل الاسم العربي من الطرف إلى الطرف)، `auth-first-paint-locale` (اختيار الفهارس وسكربت الرأس)، `e2e:customer-links` (962 من 962 مع قراءة التحية من جدول الصادر) و`e2e:auth-portal` (1418 من 1418: `lang`/`dir` وغياب الإنجليزية عند DOMContentLoaded وأول رسم وFCP على الهاتف والسطح؛ ويفشل على النسخة السابقة).

**LCP (4G بطيء، iPhone SE، معالج أبطأ 4 مرات، عربي، 3 مرات لكل صفحة).** الدخول 2.42-2.49 إلى 2.44-2.52 ثانية، النسيان 2.49-2.56 إلى 2.44-2.50، التعيين 2.48-2.52 إلى 2.48-2.54: لا تغيّر يُذكر. الفائدة في الصحة: أول رسم يأتي عربياً من اليمين، بلا انقلاب اتجاه ولا إزاحة. جُرّب تحميل الخط العربي قبل أول عرض ورُفض (ارتفع LCP إلى 3.5 ثانية تقريباً).

**البوابات.** `check` و`lint` و`npm test` (276 ملفاً، 2809 ناجحاً) و`test:db` (139 ملفاً، 963 ناجحاً) وفحوص المتصفح الثلاثة وميزانية الحزم بلا تحديث للخط الأساس. نتيجة CI على `8e82d28d`: لم يبدأ. تحرّك الفرع الأساسي وصار الطلب يعرض تعارضاً في الدمج فلا يشغّل GitHub سير `pull_request`؛ نجح GitGuardian فقط. بحسب تعليمات المالك لم يُدمج الفرع الأساسي في هذه الجولة؛ يعمل CI بعد دمج مجموعات إصلاح #67 ودمج الأساس. آخر CI كامل: الفحوص الستة ناجحة على `bceb4a51`.

---

### Merge of #67 step-1 fixes (2026-11-19)

- **Base merged:** `claude/eloquent-maxwell-kjxxjc` at `6eee9e6d` (STEP1-A and STEP1-B fix sets), normal merge, head `00fce539`. The PR is mergeable again and CI runs.
- **Conflicts (4), base as the foundation:** `client/src/locales/{en,ar}/forms.json` (both sides added keys at the end: kept our contact `preferredLanguage` keys and the base invoice-preview keys); `tests/e2e/broken-path-sweep.mjs` (took the base `harvestUserStrings`, kept our fake sweep password); `scripts/qa/bundle-baseline.json` (took the base file, then refreshed).
- **Not in the base:** no invite or accept flow, no new portal pages, no migration. Migration stays `0131`; a fresh database migrated twice, both indexes exist.
- **Bundle:** merged tree 8,252,017 B (370 chunks). Against the base baseline only `CustomerPortal.js` (14.6 to 19.8 KB) and `PublicInvoiceView.js` (11.9 to 14.3 KB) grew over 10%: the bilingual and light-root code from this PR. Baseline refreshed.
- **Gates:** `check`, `lint`, `check:migrations` pass; `npm test` 2927 passed (290 files); `test:db` 969 passed (142 files). CI: all six checks green on `00fce539`, `mergeable_state` clean.
- **E2E on a local production build:** `e2e:auth-portal` 1418/1418, `e2e:customer-links` 962/962, `e2e:arabic-runtime` 25 routes, 0 English lines (EN and AR, phone and desktop, no console errors, failed calls or overflow).

### دمج إصلاحات الخطوة الأولى من #67 (19-11-2026)

- **الأساس المدموج:** `claude/eloquent-maxwell-kjxxjc` عند `6eee9e6d` (مجموعتا STEP1-A وSTEP1-B)، دمج عادي، الرأس `00fce539`. صار الطلب قابلاً للدمج ويعمل CI.
- **التعارضات (4) والأساس هو المرجع:** `client/src/locales/{en,ar}/forms.json` (أضاف الطرفان مفاتيح في النهاية: أبقينا مفاتيح اللغة المفضلة لجهة الاتصال ومفاتيح معاينة الفاتورة من الأساس)؛ `tests/e2e/broken-path-sweep.mjs` (أخذنا `harvestUserStrings` من الأساس وأبقينا كلمة المرور الوهمية)؛ `scripts/qa/bundle-baseline.json` (أخذنا ملف الأساس ثم حدّثناه).
- **غير موجود في الأساس:** لا مسار دعوة أو قبول ولا صفحات بوابة جديدة ولا ترحيل. يبقى الترحيل `0131`؛ قاعدة جديدة رُحّلت مرتين وكلا الفهرسين موجود.
- **الحزم:** الشجرة المدموجة 8,252,017 بايت (370 ملفاً). مقابل خط الأساس تجاوز النمو 10% في `CustomerPortal.js` (من 14.6 إلى 19.8 ك.ب) و`PublicInvoiceView.js` (من 11.9 إلى 14.3 ك.ب) فقط: كود اللغتين والجذر الخفيف من هذا الطلب. حُدّث خط الأساس.
- **البوابات:** `check` و`lint` و`check:migrations` ناجحة؛ `npm test` 2927 ناجحاً (290 ملفاً)؛ `test:db` 969 ناجحاً (142 ملفاً). CI: الفحوص الستة ناجحة على `00fce539` وحالة الدمج نظيفة.
- **فحوص المتصفح على بناء إنتاج محلي:** `e2e:auth-portal` 1418 من 1418، `e2e:customer-links` 962 من 962، `e2e:arabic-runtime` 25 مساراً و0 سطر إنجليزي (عربي وإنجليزي، هاتف وسطح مكتب، بلا أخطاء وحدة التحكم أو طلبات فاشلة أو تجاوز أفقي).

---

### Merge of #67 round 3 (2026-11-19)

- **Base merged:** `claude/eloquent-maxwell-kjxxjc` at `46bc0dea` (journal memo and line keys, server error copy catalog, Sheets export and AI error codes), normal merge, code head `523f150a`.
- **Conflicts (3), base as the foundation:** `migrations/meta/_journal.json` (both sides took 0132: the base's `0132_journal_line_keys` kept, ours is now `0136_settlement_open_balance_indexes`, idx 132, `when` +10 s; the file, header, AGENTS.md, runbook, rehearsal notes, `docs/database-migrations.md` and the ledger count in `tests/integration/pr68-verified.test.mjs` follow); `docs/platform-rules.md` (kept the firm A/R rule and the journal memo rule); `scripts/qa/bundle-baseline.json` (took the base file, then refreshed).
- **One fix on our side:** `PORTAL_SCOPE` (our client-portal API scope error) had no entry in the new `serverErrors` catalog, so `tests/unit/server-error-copy.test.ts` failed; added English and Arabic copy. No new pages or routes came from the base, so nothing new needed registering in the firm build.
- **Bundle:** 377 chunks, 8,588,964 B. Against the base baseline (old chunk names) `ClientPortfolio.js` (+21%), `CustomerPortal.js` (+35%), `PublicInvoiceView.js` (+20%) and `index.js` (+13%) grew, and `reportCatalogApi.js` grew from a stub to 30.6 KB: the firm build, bilingual and light-root work of this PR plus the lazy report catalog split. Baseline refreshed.
- **Gates:** `check`, `lint`, `check:migrations`, bundle budget pass; `npm test` 3026 passed (306 files); `test:db` 984 passed (147 files).
- **E2E on a local production build (fresh database):** `e2e:firm-tools` 1112/1112 (firm pages on throttled iPhone 13: LCP 4.7 to 5.0 s, 32 to 38 requests), `e2e:customer-links` 962/962, `e2e:auth-portal` 1418/1418, `e2e:arabic-runtime` 25 routes, 0 English lines.
- **CI:** all six checks green on `523f150a` (the documentation-only commit after it changes no code).

### دمج الجولة الثالثة من #67 (19-11-2026)

- **الأساس المدموج:** `claude/eloquent-maxwell-kjxxjc` عند `46bc0dea` (مفاتيح مذكرات القيود وبنودها، كتالوج نصوص أخطاء الخادم، تصدير Sheets ورموز أخطاء الذكاء الاصطناعي)، دمج عادي، رأس الشيفرة `523f150a`.
- **التعارضات (3) والأساس هو المرجع:** `migrations/meta/_journal.json` (أخذ الطرفان الرقم 0132: أبقينا `0132_journal_line_keys` من الأساس وصار ترحيلنا `0136_settlement_open_balance_indexes` بالفهرس 132 وقيمة `when` أكبر بعشر ثوانٍ؛ وتبعه الملف والترويسة وAGENTS.md ودليل النشر وملاحظات البروفة و`docs/database-migrations.md` وعدّاد السجل في اختبار `pr68-verified`)؛ `docs/platform-rules.md` (أبقينا قاعدة ذمم المكتب وقاعدة مذكرات القيود)؛ `scripts/qa/bundle-baseline.json` (أخذنا ملف الأساس ثم حدّثناه).
- **إصلاح واحد من جهتنا:** رمز `PORTAL_SCOPE` (خطأ نطاق واجهة بوابة العميل) لم يكن في كتالوج `serverErrors` الجديد فسقط اختبار `server-error-copy`؛ أضفنا النص بالعربية والإنجليزية. لم يضف الأساس صفحات أو مسارات جديدة فلا شيء يُسجَّل في بناء المكتب.
- **الحزم:** 377 ملفاً و8,588,964 بايت. نمت `ClientPortfolio.js` و`CustomerPortal.js` و`PublicInvoiceView.js` و`index.js` فوق 10% مقابل خط الأساس القديم، ونما `reportCatalogApi.js` إلى 30.6 ك.ب: بناء المكتب وكود اللغتين والجذر الخفيف وفصل كتالوج التقارير. حُدّث خط الأساس.
- **البوابات:** `check` و`lint` و`check:migrations` وميزانية الحزم ناجحة؛ `npm test` 3026 ناجحاً (306 ملفاً)؛ `test:db` 984 ناجحاً (147 ملفاً).
- **فحوص المتصفح على بناء إنتاج محلي (قاعدة جديدة):** `e2e:firm-tools` 1112 من 1112 (صفحات المكتب على iPhone 13 مع تقييد: LCP بين 4.7 و5.0 ث و32 إلى 38 طلباً)، `e2e:customer-links` 962 من 962، `e2e:auth-portal` 1418 من 1418، `e2e:arabic-runtime` 25 مساراً و0 سطر إنجليزي.
- **CI:** الفحوص الستة ناجحة على `523f150a` (التزام التوثيق اللاحق للتوثيق فقط).

### Firm and accountant tools audit and fixes (2026-11-19)

**Audited:** the NR firm owner, an assigned preparer, an unassigned preparer and a second firm's owner, in English and Arabic at 1440, iPhone 13 and 360 px, on a production build with 60 clients and 167 invoices (288 route visits, axe, API probes, throttled phone profile). 20 defects; 14 fixed in code, the rest are owner decisions, #67-owned or already clean.
**Fixed (each with a test that failed before):** (1) staff assignments are read from `firm_staff_assignments`, so Owner and the "Unassigned" count are right (`4858cbf0`, `tests/db/firm-audit-fixes.test.ts`); (2) `/api/firm/client-links` is scoped like the client list (`4858cbf0`); (3) "Open books" lands on the client's dashboard even when the staffer's own company is not onboarded (`f594482f`, `onboardingRedirectTarget` unit tests and the e2e); (4) firm A/R comes from the settlement rule in AED per company (partial payments, credit notes, USD at the booking rate): portfolio, overview, command centre and bookkeeper dashboard (`4858cbf0`, db test; a part-paid 1,050 invoice now counts 650 and a USD 1,050 invoice counts 3,856.13); (5) a failed portfolio load shows an error state with Retry, never "No clients yet" (`f594482f`, render test); (6) a failed invoice list shows an error state and hides the zeroed tiles (`f594482f`, render test; list component only); (7) `GET /firm/clients` is a fixed number of grouped queries (was 367 statements for 60 clients), returns an allow-listed projection with no WPS or IBAN fields, and takes `limit`, `offset`, `sort`, `q` and `view=names` (`4858cbf0`); (8) Add, Import, invite, assign and unassign controls follow the role through `FIRM_UI_PERMISSIONS` and an "assigned to you" empty state (`f594482f`, `63391e08`); (9) one VAT-due count and "issued this month" by invoice date (`4858cbf0`); (10) translated, cause-specific load errors on the command centre and client profile (a 500 no longer reads as "removed"; `f594482f`); (11) 404 instead of 403 for another firm's client on health, comms log and email intake (`4858cbf0`); (12) Arabic "Monthly", the empty-search sentence, the Contact card title and assignment roles (`f594482f`, `dc8e2b19`); (13) phone: card list, 25 per page, 44 px touch targets incl. the command-centre checkboxes and the self-approval switch (`f594482f`, `dc8e2b19`); (15) company switcher search above 8 companies (`dc8e2b19`); (16) no forbidden payroll or approver-link calls for a bookkeeper (`dc8e2b19`); (17) last login is stamped (`4858cbf0`); (18) Arabic-aware search and sort; (19) focusable scroll regions, h1 on error states, label for the invite field.
**Speed (defect 14), before and after.** iPhone 13, 4x CPU, Slow 4G (1.44 Mbps, 562 ms round trip), cold cache, production build on the local HTTP/1.1 server (behind HTTP/2 the request count costs less; the bytes and the chain of round trips are what these numbers show). Largest contentful paint (the page heading), requests until the network is idle, JS on the wire:

| Screen                    | Audit                        | First pass (`ca66e01f`, re-measured) | Now                   |
| ------------------------- | ---------------------------- | ------------------------------------ | --------------------- |
| `/firm/clients` EN        | 14.8 s, 129 requests, 770 KB | 12.0 s, 131, 594 KB                  | **4.8 s, 31, 415 KB** |
| `/firm/clients` AR        | 15.0 s, 137, 856 KB          | 12.1 s, 139, 627 KB                  | **4.9 s, 38, 423 KB** |
| `/firm/command-center` EN | 13.9 s, 140, 770 KB          | 11.2 s, 140, 594 KB                  | **4.7 s, 33, 415 KB** |
| `/firm/command-center` AR | 14.2 s, 148, 856 KB          | 11.4 s, 148, 627 KB                  | **4.8 s, 40, 423 KB** |

Runs repeat to within 0.1 s. Four changes, in order of effect. (1) A second build of the same sources for `/firm/*` (`FIRM_BUILD=1`, `client/firm.html`): the signed-in app and the two landing screens are one entry chunk plus nine vendor chunks, where the main bundle needed about 45 shared chunks, each one a round trip (LCP 7.1 s with the other fixes, 4.8 s with this). The main bundle, and so every public, portal and no-login page, is built exactly as before. (2) The firm document starts the work early: it preloads the first-screen catalogs of the language cookie (`muhasib_locale`), and with a session cookie an inline nonce script starts `/api/auth/me`, the company list and the two reads the screen paints from before any JavaScript arrives. (3) The first screens boot on 6 catalogs, not 19 (the other firm catalogs follow when the page is idle; the three firm-only ones are one chunk); the e-invoice state labels and four cross-namespace words moved into `firm.json` for this. (4) framer-motion is out of the shell (the page fade is CSS; sidebar and bottom-sheet entrances are CSS keyframes, reduced-motion still neutralises them), `date-fns` is out of the firm helpers, and assets get brotli quality 11 twins (about 15 percent smaller than on-the-fly). Motion differences, deliberately small: the 160 ms fade-out of the page being left, and the sidebar group collapse animation, are gone; entrances and the chevron turn are unchanged.

Customer pages, measured on the same build (static chunk graph, gzip, root plus page, against the previous build): sign-in, registration, password recovery, landing, pricing, invoice link, approver link, customer-portal link and the five client-portal pages all within +0.7 KB of before (+0.1 to +0.4 percent, the larger startup chunk), within one file of before. Tests: `tests/unit/firm-boot.test.ts`, `firm-first-screen-keys.test.ts`, `first-load-chunks.test.ts` (build output: firm entry at most 14 files and 480 KB gzip, no motion/pdf/socket/report chunk, no firm chunk reachable from any public or portal root), and a first-load budget in `e2e:firm-tools` (at most 50 requests and 25 scripts up to LCP, LCP under 9 s; about 32-39, 16 and 4.6-5.1 s measured). Bundle baseline refreshed: new `catalog-firm-en|ar`, `ActiveCompanyProvider`, `DeferredInstallPrompt`, `access`; no longer emitted `api`, `arabic-text`, `clientsFirm`, `dialog`, `firm`, `firmOps` (merged or inlined); total +2.6 KB over 376 chunks. The firm build adds `dist/public/firm-assets/` (the lazy pages a second time, about 8 MB raw, 2 MB brotli) to the image.
**Skipped, owner decisions:** a firm-wide e-invoicing queue and a firm approvals queue (not built; confirmed 2026-11-19: firms send e-invoices and approve one client at a time); an Arabic company's customers with no language preference get both languages, not Arabic only (decided 2026-11-19); a read-only invoice view for firm staff; one health model (command centre score vs portfolio priority); 403 vs 404 for a non-member on `/api/companies/:id/*`; platform-admin visibility of every client.
**Skipped, #67-owned:** the invoice editor on sent invoices and its switch, report exports, journal descriptions, anything ZATCA, `PortalApp.tsx`, and defect 20 (the e-invoice submit 503 text lives in `einvoice-provider.ts`, e-invoicing provider code).
**Base:** merged `066eeb88` as `1e4da558` (migration renumbered to 0132; bundle baseline refreshed for CustomerPortal and PublicInvoiceView in `cb03e02a`, then for the lazy palette chunk and portfolio growth in `7363ed24`).

### تدقيق أدوات المكتب والمحاسبين وإصلاحاتها (19-11-2026)

**ما دُقّق:** مالك مكتب NR، وموظف معيَّن، وموظف غير معيَّن، ومالك مكتب آخر، بالإنجليزية والعربية على 1440 وiPhone 13 و360 بكسل، على نسخة إنتاج فيها 60 عميلًا و167 فاتورة (288 زيارة صفحة وaxe وفحوص API وملف هاتف مُقيَّد). 20 عيبًا: أُصلح 14 في الشيفرة والباقي قرارات للمالك أو يخص #67 أو سليم أصلًا.
**أُصلح (كل بند باختبار كان يفشل قبل الإصلاح):** (1) المعيَّنون يُقرؤون من `firm_staff_assignments` فيظهر المالك وعدّاد "غير معيَّن" صحيحَين (`4858cbf0`)؛ (2) `/api/firm/client-links` يُحصر كقائمة العملاء؛ (3) "فتح الدفاتر" يصل إلى لوحة العميل حتى لو لم تُستكمل تهيئة شركة الموظف نفسه (`f594482f`)؛ (4) ذمم المكتب من قاعدة التسوية بالدرهم لكل شركة (الدفعات الجزئية والإشعارات الدائنة والدولار بسعر الحجز): فاتورة 1,050 مدفوع منها 400 تُحتسب 650، وفاتورة 1,050 دولار تُحتسب 3,856.13؛ (5) فشل تحميل المحفظة يعرض حالة خطأ مع إعادة المحاولة بدل "لا يوجد عملاء"؛ (6) فشل قائمة الفواتير يعرض خطأ ويخفي البطاقات الصفرية (القائمة فقط)؛ (7) `GET /firm/clients` بعدد ثابت من الاستعلامات المجمّعة (كان 367 لـ60 عميلًا) وبحقول مسموحة فقط دون بيانات IBAN أو WPS، مع `limit` و`offset` و`sort` و`q`؛ (8) أزرار الإضافة والاستيراد والدعوة والتعيين تتبع الدور عبر `FIRM_UI_PERMISSIONS` مع رسالة "غير معيَّن لك"؛ (9) عدّ واحد لاستحقاق الضريبة و"صادرة هذا الشهر" بتاريخ الفاتورة؛ (10) رسائل خطأ مترجمة بحسب السبب في لوحة المكتب وملف العميل؛ (11) 404 بدل 403 لعميل مكتب آخر؛ (12) "Monthly" وجملة البحث الفارغ وعنوان بطاقة الاتصال وأدوار التعيين بالعربية؛ (13) الهاتف: بطاقات و25 صفًا في الصفحة وأهداف لمس 44 بكسل بما فيها مربعات اختيار لوحة المكتب؛ (15) بحث في مبدّل الشركات؛ (16) لا طلبات ممنوعة لموظف الدفاتر؛ (17) تسجيل آخر دخول؛ (18) بحث عربي ذكي وفرز؛ (19) مناطق تمرير قابلة للتركيز وh1 وتسمية حقل الدعوة.
**السرعة (العيب 14)، قبل وبعد.** iPhone 13، معالج أبطأ 4 أضعاف، 4G بطيء (1.44 ميغابت/ث، زمن ذهاب وإياب 562 مللي ثانية)، ذاكرة مؤقتة فارغة، نسخة إنتاجية على الخادم المحلي HTTP/1.1 (خلف HTTP/2 تكلّف كثرة الطلبات أقل؛ الأرقام تعكس الحجم وسلسلة الذهاب والإياب). أكبر عنصر محتوى (عنوان الصفحة)، عدد الطلبات حتى هدوء الشبكة، وجافاسكربت المنقول:

| الشاشة                         | التدقيق                    | المرحلة الأولى (`ca66e01f`، أُعيد قياسها) | الآن                   |
| ------------------------------ | -------------------------- | ----------------------------------------- | ---------------------- |
| `/firm/clients` إنجليزي        | 14.8 ث، 129 طلبًا، 770 ك.ب | 12.0 ث، 131، 594 ك.ب                      | **4.8 ث، 31، 415 ك.ب** |
| `/firm/clients` عربي           | 15.0 ث، 137، 856 ك.ب       | 12.1 ث، 139، 627 ك.ب                      | **4.9 ث، 38، 423 ك.ب** |
| `/firm/command-center` إنجليزي | 13.9 ث، 140، 770 ك.ب       | 11.2 ث، 140، 594 ك.ب                      | **4.7 ث، 33، 415 ك.ب** |
| `/firm/command-center` عربي    | 14.2 ث، 148، 856 ك.ب       | 11.4 ث، 148، 627 ك.ب                      | **4.8 ث، 40، 423 ك.ب** |

التكرار يعطي نتائج متقاربة خلال 0.1 ث. أربعة تغييرات بحسب الأثر. (1) بناء ثانٍ لنفس الشيفرة لمسارات `/firm/*` (`FIRM_BUILD=1` و`client/firm.html`): التطبيق وشاشتا الدخول ملف دخول واحد وتسعة ملفات مكتبات، بينما كانت الحزمة الرئيسية تحتاج نحو 45 ملفًا مشتركًا لكل منها ذهاب وإياب (7.1 ث مع باقي الإصلاحات، 4.8 ث معه). الحزمة الرئيسية، وبالتالي كل صفحات الزوار والبوابة والروابط بلا تسجيل دخول، تُبنى كما كانت تمامًا. (2) تبدأ وثيقة المكتب العمل مبكرًا: تحمّل مسبقًا فهارس الشاشة الأولى للغة المحفوظة في ملف تعريف الارتباط `muhasib_locale`، ومع وجود ملف الجلسة يبدأ سكربت مضمّن بنونس `/api/auth/me` وقائمة الشركات وقراءتَي الشاشة قبل وصول أي جافاسكربت. (3) تُقلِع الشاشتان الأوليان على 6 فهارس بدل 19 (تلحقها بقية فهارس المكتب عند خمول الصفحة، والفهارس الثلاثة الخاصة بالمكتب ملف واحد)؛ ولذلك نُقلت تسميات حالات الفوترة الإلكترونية وأربع كلمات مشتركة إلى `firm.json`. (4) أُخرج framer-motion من الإطار (ظهور الصفحة بـCSS، وانزلاق الشريط الجانبي والورقة السفلية بإطارات CSS، وتفضيل تقليل الحركة ما زال يعطّلها)، وأُخرج `date-fns` من مساعدات المكتب، وأُضيفت نسخ brotli بجودة 11 للأصول (أصغر بنحو 15 بالمئة). فروق الحركة الصغيرة عن قصد: اختفى تلاشي الصفحة المغادَرة (160 مللي ثانية) وحركة طيّ مجموعة الشريط الجانبي؛ أما الدخول ودوران السهم فكما كانا.

صفحات العملاء، على البناء نفسه (رسم الملفات الساكن، gzip، الجذر مع الصفحة، مقابل البناء السابق): تسجيل الدخول والتسجيل واستعادة كلمة المرور والرئيسية والأسعار ورابط الفاتورة ورابط الموافقة ورابط بوابة العميل وصفحات بوابة العميل الخمس كلها ضمن +0.7 ك.ب من قبل (من +0.1 إلى +0.4 بالمئة بسبب كبر ملف البدء)، وبفارق ملف واحد على الأكثر في العدد. الاختبارات: `tests/unit/firm-boot.test.ts` و`firm-first-screen-keys.test.ts` و`first-load-chunks.test.ts` (ملفات البناء: ملف دخول المكتب بحد أقصى 14 ملفًا و480 ك.ب gzip، بلا ملفات motion أو pdf أو socket أو تقارير، ولا يصل أي جذر عام أو بوابة إلى ملفات المكتب)، وميزانية أول تحميل في `e2e:firm-tools` (حتى 50 طلبًا و25 سكربتًا حتى أكبر عنصر محتوى، وأقل من 9 ث؛ المقيس نحو 32-39 و16 و4.6-5.1 ث). حُدّث خط أساس الحزم: ملفات جديدة `catalog-firm-en|ar` و`ActiveCompanyProvider` و`DeferredInstallPrompt` و`access`؛ ولم تعد تُصدر `api` و`arabic-text` و`clientsFirm` و`dialog` و`firm` و`firmOps` (دُمجت)؛ الإجمالي +2.6 ك.ب عبر 376 ملفًا. ويضيف بناء المكتب مجلد `dist/public/firm-assets/` (الصفحات الكسولة مرة ثانية، نحو 8 ميغابايت خام و2 مضغوطة) إلى الصورة.
**متروك لقرار المالك:** طابور إرسال الفوترة الإلكترونية على مستوى المكتب وطابور الموافقات (لم يُبنيا؛ أكّده المالك في 19-11-2026: يرسل المكتب ويوافق عميلًا عميلًا)؛ عملاء الشركة العربية بلا تفضيل لغة يتلقون اللغتين لا العربية فقط (قرار 19-11-2026)؛ عرض فاتورة للقراءة فقط لموظفي المكتب؛ نموذج صحة واحد؛ 403 أم 404 لغير العضو في `/api/companies/:id/*`؛ رؤية مدير المنصة لكل العملاء.
**متروك لأنه يخص #67:** محرر الفاتورة المُرسلة وتصدير التقارير ووصف القيود وكل ما يخص ZATCA وملف `PortalApp.tsx` والعيب 20 (نص خطأ 503 في `einvoice-provider.ts`).
**الأساس:** دُمج `066eeb88` كإيداع `1e4da558` (رُقّم الترحيل 0132).

### Accounting pages and customer links verification (2026-11-19)

**Covered (pages x languages x viewports):** Journal list, journal entry detail (posted, reversed, draft, unknown id), account ledger, bank reconciliation (transactions, suggestions, rules, rule dialog), the Reports page and 26 report screens (P&L, balance sheet, trial balance, cash flow, AR and AP aging, VAT, general ledger, account transactions, corporate tax, balances, sales, expenses, planning, payroll, close, consolidated, statements of account), and Admin documents; each in English and Arabic at 1440x900, iPhone 13 and 360 px Android, with empty, populated (69 journals, 45 bank lines, matches, rules, invoices, a bill), failing-API (route interception) and unknown-id states. Customer side: invoice link, customer portal, EmaraTax approval and the client portal, with a 360 px run, long English and Arabic names, a 24-line invoice, invalid/expired tokens and failing APIs. Checks per screen: console and page errors, failed `/api` calls, blank or not-found pages, horizontal overflow and elements outside the viewport, 44 px targets on phones, raw catalog keys, English text in Arabic, axe serious/critical, RTL.
**Defects (14, all fixed, each with a test that failed before):** (1) a server error on the journal entry page read "not found" after a long skeleton: now a retryable error state; (2) the AdminDocuments company and document lists showed "no clients" / "no documents" when the API failed: now an error state with Retry; (3) icon-only and unnamed controls (entry back link, three admin selects, two statement selects, four progress bars); (4) 14-16 px entry-number and reversal links on phones (Journal, account ledger); (5) 36x20 rule switches on phones; (6) `[class*="table"]` in `mobile.css` turned every table cell into a scroll region on phones; (7) ten journal sources (including "Reversal") showed in English in Arabic reports; (8) the bank rule dialog's category and memo labels and a placeholder were English; (9) the consolidated-statements basis badge overflowed 360 px; (10) stat-card hints ended in an ellipsis on phones; (11) "TRN:" literal in the admin company list. Commit `265a9f22`; tests `tests/unit/books-pages-load-states.test.ts`, `tests/unit/books-pages-catalogs.test.ts`, and the e2e runs above (`tests/e2e/books-pages-flow.mjs`, new; `customer-links-flow.mjs` extended).
**Handed to #67 (code they changed in round 3, fixed minimally here):** `JournalEntryDetail.tsx` (error state, named back link), `AdminDocuments.tsx` (error states, select names, TRN label), `Journal.tsx` and `AccountLedger.tsx` (44 px links), `BankReconciliation.tsx` (progress bar names). Cherry-pick `265a9f22` or take the hunks; no refactor was made.
**Not defects:** the tighter report-only CSP logs inline styles from Radix dialogs (by design); a lazy chunk blip under six parallel browsers is recovered by the ErrorBoundary reload guard (the script re-measures such a screen once). Customer pages with a failing API use the browser language, since the customer's language is unknown. Other gates on the final code: `npm test` 3034, `npm run test:db` 984, `e2e:auth-portal` 1418/1418, `e2e:firm-tools` 1112/1112 (fresh DB), `e2e:arabic-runtime` 25 routes and 0 English lines (these three ran one commit earlier, before the stat-card hint change).

### التحقق من صفحات المحاسبة وروابط العملاء (19-11-2026)

**ما غُطّي (الصفحات × اللغات × الشاشات):** قائمة القيود، وتفاصيل القيد (مرحَّل، معكوس، مسودة، معرّف غير موجود)، ودفتر الأستاذ للحساب، والتسوية البنكية (الحركات والاقتراحات والقواعد ونافذة القاعدة)، وصفحة التقارير و26 شاشة تقرير (الأرباح والخسائر، المركز المالي، ميزان المراجعة، التدفقات النقدية، أعمار الذمم المدينة والدائنة، ضريبة القيمة المضافة، الأستاذ العام، حركات الحساب، ضريبة الشركات، الأرصدة، المبيعات، المصروفات، التخطيط، الرواتب، الإقفال، التجميع، كشوف الحساب)، ومستندات الإدارة؛ كلٌّ بالإنجليزية والعربية على 1440×900 وiPhone 13 وأندرويد 360 بكسل، بحالات فارغة ومعبّأة (69 قيدًا و45 حركة بنكية ومطابقات وقواعد وفواتير وفاتورة مورّد) وفشل الواجهة (اعتراض المسار) ومعرّف غير موجود. جهة العميل: رابط الفاتورة وبوابة العميل وموافقة EmaraTax وبوابة العملاء، مع تشغيل 360 بكسل وأسماء طويلة بالعربية والإنجليزية وفاتورة من 24 سطرًا ورموز غير صالحة أو منتهية وفشل الواجهة. الفحوص لكل شاشة: أخطاء وحدة التحكم والصفحة، وطلبات `/api` الفاشلة، والصفحات الفارغة أو غير الموجودة، والتمرير الأفقي والعناصر خارج الشاشة، وأهداف اللمس 44 بكسل، ومفاتيح الفهارس الخام، والإنجليزية في العربية، وaxe، والاتجاه من اليمين لليسار.
**العيوب (14، أُصلحت كلها، ولكل منها اختبار كان يفشل قبل الإصلاح):** (1) خطأ الخادم في صفحة القيد كان يظهر "غير موجود" بعد هيكل تحميل طويل: صار حالة خطأ قابلة لإعادة المحاولة؛ (2) قائمتا الشركات والمستندات في مستندات الإدارة كانتا تعرضان "لا عملاء" / "لا مستندات" عند فشل الواجهة: صارت حالة خطأ مع إعادة المحاولة؛ (3) عناصر بلا اسم (رابط الرجوع، وثلاث قوائم اختيار في الإدارة، وقائمتان في كشوف الحساب، وأربعة أشرطة تقدم)؛ (4) روابط أرقام القيود وروابط العكس بارتفاع 14-16 بكسل على الهاتف؛ (5) مفاتيح القواعد 36×20؛ (6) محدّد `[class*="table"]` في `mobile.css` كان يجعل كل خلية جدول منطقة تمرير على الهاتف؛ (7) عشرة مصادر قيود (منها "Reversal") تظهر بالإنجليزية في التقارير العربية؛ (8) عنوان التصنيف والملاحظة في نافذة قاعدة البنك ونص الإيحاء بالإنجليزية؛ (9) شارة أساس التجميع تتجاوز 360 بكسل؛ (10) تلميح بطاقات المؤشرات ينتهي بنقاط على الهاتف؛ (11) نص "TRN:" ثابت في قائمة شركات الإدارة. الإيداع `265a9f22`؛ الاختبارات `tests/unit/books-pages-load-states.test.ts` و`tests/unit/books-pages-catalogs.test.ts` وتشغيلات e2e أعلاه (`tests/e2e/books-pages-flow.mjs` جديد، و`customer-links-flow.mjs` موسَّع).
**مُسلَّم إلى #67 (شيفرة غيّروها في الجولة الثالثة وأُصلحت هنا بأقل تغيير):** `JournalEntryDetail.tsx` (حالة الخطأ واسم رابط الرجوع)، و`AdminDocuments.tsx` (حالات الخطأ وأسماء القوائم وتسمية الرقم الضريبي)، و`Journal.tsx` و`AccountLedger.tsx` (روابط 44 بكسل)، و`BankReconciliation.tsx` (أسماء أشرطة التقدم). يمكن اختيار الإيداع `265a9f22` أو أخذ المقاطع؛ لم يُجرَ أي إعادة هيكلة.
**ليست عيوبًا:** سياسة CSP الأشد (للتقرير فقط) تسجّل أنماطًا مضمَّنة من نوافذ Radix (بالتصميم)؛ وتعثّر ملف كسول عند تشغيل ستة متصفحات معًا يعالجه حارس إعادة التحميل في ErrorBoundary (يعيد السكربت قياس الشاشة مرة). وصفحات العملاء مع فشل الواجهة تستخدم لغة المتصفح لأن لغة العميل غير معروفة. بقية البوابات على الشيفرة النهائية: `npm test` 3034، و`npm run test:db` 984، و`e2e:auth-portal` 1418/1418، و`e2e:firm-tools` 1112/1112 (قاعدة جديدة)، و`e2e:arabic-runtime` 25 مسارًا و0 أسطر إنجليزية (الثلاثة الأخيرة شُغّلت قبل إيداع واحد، أي قبل تغيير تلميح البطاقات).

### Per-client e-invoicing, approvals and bilingual emails (2026-11-19)

**Owner decisions applied.** (1) No firm-wide bulk e-invoicing queue and no shared approvals screen: firms send e-invoices and handle approvals one client at a time, so nothing of the kind was built. (2) An Arabic company writing to a customer with no language preference sends the email in both Arabic and English again (the round-2 Arabic-only rule is reverted, `3dbddebe`); an explicit contact preference (en or ar) still wins and English companies are unchanged. In a bilingual mail each block keeps its own greeting (Arabic block: Arabic name or a neutral Arabic greeting, never a Latin-script name), and the subject and plain text are bilingual too. Tests per case: Arabic company with no preference is bilingual, with `ar` Arabic, with `en` English, English company unchanged (`tests/db/customer-links-flow.test.ts`, `tests/unit/customer-emails.test.ts`, `e2e:customer-links`).

**Checked** (`npm run e2e:einvoice-client`, local production build, no provider credentials; company owner and NR firm staff via "Open books"; iPhone 13, 360 px, 1440x900; English and Arabic; 2,000+ checks): e-invoicing settings and provider choice (A-Cube and Complyance, none pre-selected, "not connected" and what is needed), generate with `EINVOICE_BUYER_ENDPOINT_MISSING` and `EINVOICE_BUYER_ADDRESS_MISSING` as localized fix text with links, the status sheet, XML and PDF download, submit refused with `EINVOICE_PROVIDER_NOT_CONFIGURED` (never a fake "sent"), the approval request, the bilingual approver email, the no-login page (company name only, no TRN; done, used, expired, revoked and invalid links), the outcome in the client's page and the firm column, failing lists, and every customer email template rendered at 375, 700 and 1000 px. Per screen: no console errors, no failed `/api` calls (declared refusals only), no overflow, 44 px targets, axe serious/critical 0, no English in Arabic, no repeated API requests.

**Defects (10, all fixed, each with a test or e2e check that failed before)** (commits `3dbddebe`, `fd194007`, `dc9a9751`): (1) the phone invoice card had no "Generate e-invoice" action; (2) the Arabic issues dialog split the invoice number and its fix link was under 44 px; (3) no XML/PDF download in the e-invoice sheet; (4) settings tables showed raw status words and provider text in Arabic, with no loading or error state and a 42 px link; (5) raw server message in the settings toast, silent archive download failure; (6) after the approver pressed Done the client fell back to "Not started" and the firm column to "Appoint partner": new state `approver_done` (EN+AR), request list shown by default, a different partner withdraws earlier approvals (`tests/db/wq5-einvoice-identity.test.ts`); (7) the approver email's Arabic block used the customer greeting for a Latin name (`tests/unit/customer-email-greeting.test.ts`); (8) the registration verification email was plain English and its link overflowed at 375 px: now the shared bilingual layout; (9) the Latin company name lost its order in the Arabic email footer: `<bdi>` isolation; (10) the self-confirm row was under 44 px.

**Merges and gates on the final head.** The base moved three times while this was in progress (`246a8dd1`, `44a5ccff`, `246e881f`; merge commits `1394ea34`, `f353c428` and the next one). The base is the reference. Conflicts: `package.json` (both script sets kept), `migrations/meta/_journal.json` and the bundle baseline, and `AGENTS.md` (range). The base took migration 0133 (`0133_step2_remove_zatca`), so our settlement-index migration is renumbered to `0136_settlement_open_balance_indexes` (journal idx 133, later `when`; docs, the integration test and the runbook ranges updated). On the merged tree: `check`, `lint`, `check:migrations` pass; `npm test` 3045 passed, 1 skipped; `test:db` 997 passed, 1 skipped; the e2e runs in the table above, each on a fresh database and a restarted app. Bundle baseline refreshed for the e-invoice sheet downloads, settings states and phone invoice action (EInvoicingSettings +2.8 KB, EInvoiceListCell +1.9 KB, export +1.1 KB, einvoicing catalog +0.6 KB, Invoices +0.3 KB).

**Not changed.** The approver page has Done only (no decline); the outcomes an owner sees are done, revoked, expired and invalid. Sending needs a provider; none can be connected without credentials, and the UI says so.

### التحقق من الفوترة الإلكترونية لكل عميل والموافقات والرسائل ثنائية اللغة (19-11-2026)

**قرارا المالك المطبّقان.** (1) لا طابور إرسال فوترة إلكترونية على مستوى المكتب ولا شاشة موافقات مشتركة: يرسل المكتب الفواتير الإلكترونية ويعالج الموافقات عميلًا عميلًا، فلم يُبنَ شيء من ذلك. (2) الشركة العربية التي تراسل عميلًا بلا تفضيل لغة ترسل الرسالة بالعربية والإنجليزية معًا كما كان (أُلغيت قاعدة العربية فقط من الجولة الثانية، `3dbddebe`)؛ تفضيل جهة الاتصال الصريح (en أو ar) يبقى هو الأقوى، والشركات الإنجليزية دون تغيير. في الرسالة ثنائية اللغة يحتفظ كل قسم بتحيته (القسم العربي: الاسم العربي أو تحية عربية محايدة، ولا اسم بحروف لاتينية)، والعنوان والنص العادي ثنائيا اللغة أيضًا. اختبار لكل حالة: شركة عربية بلا تفضيل ثنائية اللغة، وبـ `ar` عربية، وبـ `en` إنجليزية، وشركة إنجليزية دون تغيير.

**ما فُحص** (`npm run e2e:einvoice-client` على نسخة إنتاج محلية بلا بيانات اعتماد مزوّد؛ مالك الشركة وموظف مكتب NR عبر «فتح الدفاتر»؛ iPhone 13 و360 بكسل و1440x900؛ بالعربية والإنجليزية؛ أكثر من 2000 فحص): إعدادات الفوترة الإلكترونية واختيار المزوّد (A-Cube وComplyance دون اختيار مسبق، و«غير متصل» وما يلزم)، والإنشاء مع `EINVOICE_BUYER_ENDPOINT_MISSING` و`EINVOICE_BUYER_ADDRESS_MISSING` بنص إصلاح مترجم وروابط، ولوحة الحالة، وتنزيل XML وPDF، ورفض الإرسال بلا مزوّد مهيّأ (`EINVOICE_PROVIDER_NOT_CONFIGURED`، ولا «تم الإرسال» وهمي)، وطلب الموافقة، ورسالة المعتمِد ثنائية اللغة، والصفحة بلا تسجيل دخول (اسم الشركة فقط دون رقم ضريبي؛ روابط منجزة ومستخدمة ومنتهية وملغاة وغير صالحة)، ونتيجة الموافقة في صفحة العميل وعمود المكتب، والقوائم الفاشلة، وكل قوالب رسائل العملاء بعرض 375 و700 و1000. في كل شاشة: لا أخطاء في الـ console ولا طلبات `/api` فاشلة (الرفض المقصود فقط) ولا تمرير أفقي وأهداف 44 بكسل وaxe صفر ولا إنجليزية في العربية ولا طلبات متكررة.

**العيوب (10، أُصلحت كلها ولكل منها اختبار أو فحص كان يفشل قبل الإصلاح)** (`3dbddebe` و`fd194007` و`dc9a9751`): (1) بطاقة الفاتورة على الهاتف بلا إجراء «إنشاء فاتورة إلكترونية»؛ (2) نافذة المشكلات العربية تشطر رقم الفاتورة ورابط الإصلاح أقل من 44 بكسل؛ (3) لا تنزيل XML أو PDF في لوحة الفاتورة الإلكترونية؛ (4) جداول الإعدادات تعرض كلمات حالة خام ونص المزوّد بالعربية بلا حالة تحميل أو خطأ ورابط 42 بكسل؛ (5) رسالة خادم خام في إشعار الإعدادات وفشل صامت لتنزيل الأرشيف؛ (6) بعد ضغط المعتمِد «تم» كان العميل يعود إلى «لم يبدأ» وعمود المكتب إلى «عيّن الشريك»: حالة جديدة `approver_done` (عربي وإنجليزي)، وقائمة الطلبات ظاهرة افتراضيًا، وتغيير الشريك يسحب الموافقات السابقة؛ (7) القسم العربي في رسالة المعتمِد كان يستعمل تحية العميل لاسم لاتيني؛ (8) رسالة تأكيد البريد عند التسجيل كانت إنجليزية بلا تنسيق ورابطها يتجاوز العرض عند 375: صارت بالتصميم الثنائي المشترك؛ (9) اسم الشركة اللاتيني يفقد ترتيبه في تذييل الرسالة العربية: عزل `<bdi>`؛ (10) صف التأكيد الذاتي أقل من 44 بكسل.

**الدمج والبوابات على الرأس النهائي.** تحرّك الأساس ثلاث مرات أثناء العمل (`246a8dd1` و`44a5ccff` و`246e881f`؛ الدمجان `1394ea34` و`f353c428` والدمج التالي) والأساس هو المرجع. التعارضات: `package.json` (أُبقيت مجموعتا السكربتات) و`migrations/meta/_journal.json` وخط أساس الحزم و`AGENTS.md` (المدى). أخذ الأساس الترحيل 0133 (`0133_step2_remove_zatca`) فأُعيد ترقيم ترحيل فهارس التسوية لدينا إلى `0136_settlement_open_balance_indexes` (idx 133 و`when` أحدث، وحُدّثت الوثائق واختبار التكامل ومدى الدليل). على الشجرة المدموجة: `check` و`lint` و`check:migrations` ناجحة؛ `npm test` 3045 ناجحًا ومتخطى واحد؛ `test:db` 997 ناجحًا ومتخطى واحد؛ وفحوص المتصفح في الجدول أعلاه، كلٌّ على قاعدة جديدة وتطبيق أُعيد تشغيله.

**دون تغيير.** صفحة المعتمِد فيها «تم» فقط (لا رفض)؛ النتائج التي يراها المالك: منجز وملغى ومنتهٍ وغير صالح. الإرسال يحتاج مزوّدًا ولا يمكن ربط أحد دون بيانات اعتماد، وواجهة المستخدم تقول ذلك.

## GitGuardian on #67: 8 findings, all one fake test fixture (no real credential)

GitGuardian reports "8 secrets uncovered" on #67 (head `a3c0b99`). All eight are occurrences of **one incident (40231730, "Generic Password")**: two lines in one test file, repeated across four commits.

| #   | File                                             | Line | Commit     | Type             | Classification |
| --- | ------------------------------------------------ | ---- | ---------- | ---------------- | -------------- |
| 1   | `tests/unit/e3-register-language-switch.test.ts` | 131  | `31bd49e6` | Generic Password | Test fixture   |
| 2   | same                                             | 102  | `953494b5` | Generic Password | Test fixture   |
| 3   | same                                             | 102  | `31bd49e6` | Generic Password | Test fixture   |
| 4   | same                                             | 131  | `953494b5` | Generic Password | Test fixture   |
| 5   | same                                             | 102  | `691a699c` | Generic Password | Test fixture   |
| 6   | same                                             | 131  | `da03c336` | Generic Password | Test fixture   |
| 7   | same                                             | 102  | `da03c336` | Generic Password | Test fixture   |
| 8   | same                                             | 131  | `691a699c` | Generic Password | Test fixture   |

The value is a made-up password typed into the registration form in a unit test (`typeInto("input-password", …)`). The test mocks `fetch`, so nothing is sent anywhere, and no account in any environment uses it. **No real credential was found, and nothing needs rotating.**

Fixed on this branch:

- The test now uses `FAKE_PASSWORD` from the new `tests/fixtures/credentials/fake-credentials.ts`. `scripts/perf-budget.mjs`, the only other unmarked password literal, now uses a value marked as a test value.
- `tests/unit/no-real-looking-test-passwords.test.ts` (unit suite) fails on any password literal in `tests/`, `scripts/` or `tools/` that does not declare itself fake (`fake`, `test`, `password`, `secret`, `sandbox` and similar) or come from the fixture. It reports file and length only, never the value. It catches the original literal when the fix is reverted.
- `.gitguardian.yaml`: one ignored match, keyed by the value's SHA-256 (not the plaintext), with the incident id and reason. It covers only the historical commits that cannot change. #67's GitGuardian check reads this file from #67's own head, so it stays red until this PR lands on #67. Alternatively, the owner can mark incident 40231730 as a test credential in the GitGuardian dashboard.
