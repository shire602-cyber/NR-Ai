# Phase 8 design — D3 Banking, automation and assets (lead L3, 2026-10-02)

Branch `launch/phase-8-complete-product`. Implementers: S5 backend, S6 frontend. Migrations 0110-0113.
Cost first: cheapest correct route, no paid services, batch your work, consult before spending.

## 1. Scope

| # | Stream | Delivers |
|---|---|---|
| A | Statement import | One path for CSV, OFX, MT940, CAMT.053 (auto-detected) and PDF (staged + review grid); file kept in `stored_files` |
| B | Matching | New scorer, batch suggestions, bulk accept, invoice **and bill** matching, correct unmatch |
| C | Bank rules | Percent splits, 5% VAT on outflows, suggest-then-post |
| D | Reconciliation | Two-sided statement-vs-ledger, complete/reopen sessions, CSV |
| E | Bank feeds | Finish Lean (sandbox, env-gated), Link SDK, owned-entity check, hourly sync through A |
| F | Cash-flow forecast | Due-date forecast from AR, bills, recurring templates, payroll; saved scenarios |
| G | Fixed assets | Register (as-of), schedule (actual + projection), proceeds account, `disposal_journal_id` |

**Defects to fix first (they block the streams):**
1. **Critical:** `GET bank-connections` returns decrypted tokens (bank.routes.ts:38; storage.ts:3333); `POST bank-connections` accepts client-set provider and tokens (:58).
2. **Critical:** callback trusts any `code` as a Lean entity id (open-banking.service.ts:223; bank.routes.ts:276), so a user could read another tenant's bank.
3. Sync writes a `bank_accounts` id into an FK to `accounts` (bank.routes.ts:382); the "unique constraint on reference" (:392) does not exist.
4. Rule auto-match reconciles with no journal (reconciliation-rules.routes.ts:150); user regex unguarded (:208).
5. `/auto-reconcile/apply` posts Dr bank / Cr 1040 without an invoice payment, and Dr 2010 / Cr bank for expense receipts (storage.ts:2884-2949).
6. Unmatch leaves the posted entry (bank-statements.routes.ts:1006); re-matching posts twice. `create-entry` has no lock and posts foreign amounts as AED (:915).
7. `POST bank-transactions/import` (ai.routes.ts:1060) inserts orphan, unvalidated rows; `/api/ai/parse-bank-statement` (:210) is unscoped AI spend.
8. Dead: `bank-import.service.ts`, `depreciation.service.ts` (wrong column names). Delete.
9. Forecast opening = Σ bank lines (cashflow-forecast.service.ts:125), payables = unposted receipts (:150), N+1 (:74).
10. Disposal proceeds always 1010 (fixed-assets.routes.ts:1239); bill payments always 1020/1010 (bill-posting.service.ts:271).

**VP corrections.** D3-3: providers answers `{providers: [], isConfigured: false}`; the cited 400 does not exist (`getBankProvider` returns Lean unconfigured, open-banking.service.ts:320). D3-2: description leaves the dedupe key (OFX `NAME` ≠ CSV narrative). D3-5: today's scorer gives 65 (auto-reconcile.service.ts:139-175); new scorer in §3. Disposal columns are `disposal_date/disposal_amount`. Client PDF extraction (pdf.js/Tesseract, BankReconciliation.tsx:486-532) already exists and stays; parsing and staging move server-side. Locks answer 403 (period-lock.service.ts:31).

**Cuts:** VAT on asset disposal (owner); Wio (never listed); scanned PDFs over 10 pages; Lean webhooks (hourly poll); forecast VAT, claims and run-rate; rules auto-posting on import; matching of FX-revaluation lines.

## 2. Data

All tables carry `company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE`; every query filters it; every referenced id (bank account, GL account, rule, scenario) is re-checked against the company in the service. All DDL `IF NOT EXISTS`.

**0110_bank_imports_rules.sql** (sketch; every column `ADD COLUMN IF NOT EXISTS`, every index `IF NOT EXISTS`)
```sql
CREATE TABLE IF NOT EXISTS bank_statement_imports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('csv','ofx','mt940','camt053','pdf','feed')),
  status text NOT NULL DEFAULT 'committed' CHECK (status IN ('staged','committed','discarded')),
  stored_file_key text, filename text, parser text, currency text, statement_from date, statement_to date,
  opening_balance numeric(15,2), closing_balance numeric(15,2), row_count int, imported_count int, duplicate_count int,
  staged_rows jsonb, warnings jsonb NOT NULL DEFAULT '[]', created_by uuid, created_at timestamp DEFAULT now(), committed_at timestamp);
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES bank_statement_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_id text, ADD COLUMN IF NOT EXISTS dedupe_key text, ADD COLUMN IF NOT EXISTS value_date date,
  ADD COLUMN IF NOT EXISTS matched_bill_id uuid REFERENCES vendor_bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_rule_id uuid REFERENCES reconciliation_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamp, ADD COLUMN IF NOT EXISTS reconciled_by uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_id uuid;  -- FK in 0112
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_txn_external ON bank_transactions(bank_statement_account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_txn_dedupe ON bank_transactions(bank_statement_account_id, dedupe_key);
UPDATE bank_transactions SET is_reconciled=false, match_status='unmatched'   -- flipped by the old rule auto-match, nothing posted
 WHERE is_reconciled AND matched_journal_entry_id IS NULL AND matched_invoice_id IS NULL AND matched_receipt_id IS NULL;
```
Also: `reconciliation_rules` + `split_lines jsonb NOT NULL DEFAULT '[]'` (`[{accountId, percent, description?}]`), `vat_rate numeric(5,2) DEFAULT 0`, `direction text DEFAULT 'any'`, `bank_account_id → bank_accounts`, `amount_min/amount_max`; `receipts.bank_transaction_id → bank_transactions`; `bill_payments.payment_account_id → accounts`; indexes on `bsi(company_id, bank_account_id, statement_to)` and `bank_transactions(matched_journal_entry_id)`. Backfills (RAISE NOTICE counts): GL id from `bank_accounts.gl_account_id` where null; `dedupe_key` = `YYYY-MM-DD|amount`; `reconciled_at = created_at` for reconciled rows.

**0111_cashflow_scenarios.sql** — `cashflow_forecast_scenarios(id, company_id, name, is_default, receipt_delay_days int CHECK -60..180, payment_delay_days, collection_rate_pct numeric(5,2) CHECK 0..100 DEFAULT 100, include_recurring, include_payroll, payroll_pay_day int CHECK 1..28 DEFAULT 28, adjustments jsonb ≤50 {date, amount, label}, created_by, created_at, updated_at)`, `UNIQUE(company_id, name)`, partial unique default per company.

**0112_bank_feeds_reconciliations.sql** — `bank_provider_customers(id, company_id, provider, external_customer_id, created_at)` `UNIQUE(company_id, provider)`; `bank_connections` + `provider_entity_id` (encrypted), `sync_lease_until`, `consecutive_failures int DEFAULT 0`, `environment`, partial unique `(company_id, provider, external_account_id)` while not disconnected; `bank_reconciliations(id, company_id, bank_account_id, statement_date, statement_balance, ledger_balance, status completed|reopened, snapshot jsonb, completed_by/at, reopened_by/at)` partial unique `(bank_account_id, statement_date) WHERE status='completed'`; `bank_accounts.reconcile_from date`; FK `bank_transactions.reconciliation_id`.

**0113_fixed_asset_reporting.sql** — `fixed_assets` + `disposal_journal_id → journal_entries ON DELETE SET NULL`, `disposal_account_id → accounts`; backfill the journal id from posted entries `source='system' AND source_id=fa.id AND memo LIKE 'Disposal:%'`; indexes `fixed_assets(company_id, status)`, `depreciation_schedules(company_id, period_year, period_month)`.

**Drizzle (S5, anchored):** the four new tables, the new columns, read definitions for `fixedAssets` and `depreciationSchedules`. `vendor_bills`, `bill_payments`, `payroll_*` definitions are D2's; D3 uses parameterised `pool.query` until they land.

## 3. Posting rules

| Event | Dr / Cr | Date | Source (read-only) |
|---|---|---|---|
| Inflow matched to invoice | `storage.recordInvoicePayment`: Dr bank GL / Cr 1040 (existing realised FX) | bank date or `paymentDate` | `payment` |
| Outflow matched to bill | new `recordBillPayment`: Dr 2010 / Cr bank GL (`bill_payments.payment_account_id`) | bank date | `bill_payment` |
| Create entry (one account) | inflow Dr bank / Cr chosen; outflow reverse | bank date | `bank_reconciliation`, `source_id` = txn |
| Rule, outflow | Dr split accounts (net), Dr 1050 VAT / Cr bank gross; plus a posted `receipts` row (amount net, vat, `journal_entry_id`, `bank_transaction_id`) so box 9 sees it | bank date | `bank_rule` |
| Rule, inflow | Dr bank / Cr split accounts; VAT refused | bank date | `bank_rule` |
| Payout / transfer (D3-8) | Dr 1020 / Cr 1025 (or any bank/cash account) via create entry | bank date | `bank_reconciliation` |
| Match to existing journal or posted receipt | link only | — | — |
| Unmatch | reverses the entry only when `source ∈ {bank_reconciliation, bank_rule}` and `source_id` = txn; deletes the rule's receipt row; payment-linked lines keep the payment and become re-linkable | original date | `reversal` (`reversed_entry_id`, pattern customer-refund.service.ts:332) |
| Disposal (existing) | unchanged lines; proceeds to `proceedsAccountId` (cash/bank type, default 1010) | disposal date | `system` |

D3-6: 1,050 → VAT `round2(1050×5/105)` = 50, net 1,000, largest-remainder split 900/100. Splits: 1-10 lines, percents sum to 100; accounts this company's, active, not 1040/2010/1050/2020 or bank/cash.

**Rule VAT needs the receipt row:** box 9 reads receipts, bills and claims (vat-return-compute.service.ts:104-150) and only `manual` journals as adjustments (vat-adjustments.service.ts:38); a `bank_rule` journal alone leaves 1050 unclaimed. Receipt edit/delete refuses rows with `bank_transaction_id` (409 `BANK_RULE_RECEIPT`).

**Forecast rules:** opening = ledger balance of bank/cash GL accounts today (AED); invoice outstanding (AED) at due date (or issue + 30) + receipt delay × collection rate, overdue → week 1; approved/pending bills via `billOutstandingAsOfSql` (aging-as-of.service.ts:83) at due date + payment delay; active recurring templates at each run date + 30 days; payroll = latest approved run `total_net` on the pay day each month; scenario one-offs. No posting.

**Locks:** `resolveSettlementDate`/`assertPeriodNotLocked` first (403), then `storage.createJournalEntry(..., { tx })`, which takes the month's shared posting lock inside the transaction (storage.ts:1910-1913). **FX:** non-AED bank account posts AED = round2(amount × company rate on the bank date) with foreign fields on the bank line; residue to the largest split; no rate → 422 `FX_RATE_MISSING`.

**Scorer (pure):** amount vs open balance exact 60, ≤1% 40, ≤5% 20, else reject; days to the nearer of issue/due date 0→30, ≤3→20, ≤7→10, ≤30→5; document number in text +25; name similarity ≥0.5 +15, ≥0.25 +8. D3-5 = 80. Candidates: open invoices, open approved bills, unlinked posted entries on this bank GL (same direction), receipts paid from it, rules, clearing accounts whose balance equals the amount (1025). Greedy one-to-one for batches.

**Dedupe (pure):** key = bank account + Dubai day + signed amount. Multiset: insert `max(0, incoming − existing)` per key, so identical same-day lines survive and re-uploads add nothing. `external_id` (FITID, AcctSvcrRef, Lean id) checked first, backed by the unique index. Dates stored at UTC midnight of the statement day.

## 4. State machines and invariants

- **bank_transactions:** `unmatched → suggested → matched`; back to `unmatched` only via the unmatch service; frozen once `reconciliation_id` is set (409 `BANK_TXN_IN_COMPLETED_RECONCILIATION`) until reopened.
- **bank_statement_imports:** `staged → committed | discarded`; only PDF stages; committed rows are immutable.
- **bank_connections:** `active ⇄ error → disconnected`; three failed syncs pause auto-sync and notify; disconnect nulls secrets, keeps rows.
- **bank_reconciliations:** `completed → reopened` (latest only); new sessions dated after the latest (409 `RECONCILIATION_OUT_OF_ORDER`); difference must be 0 (422).

**Concurrency.** `LOCK_NS` additions: `BANK_TRANSACTION 1301`, `BANK_ACCOUNT_IMPORT 1302`, `BANK_RECONCILIATION 1303`.
- match, create-entry, rule, unmatch: `withDocumentLock(txnId, BANK_TRANSACTION)`, re-read inside, 409 `ALREADY_RECONCILED` if matched, post with `{ tx }` and update the row in that transaction. Payments keep their own `FOR UPDATE` (storage.ts:5020; bill-pay.routes.ts:676).
- bulk-match: `runExclusive("bank-bulk:"+companyId)`; phase 1 validates all items, aggregating amounts per invoice/bill against the open balance (any failure → 422, nothing posted); phase 2 applies each under its lock; a late race stops with 409 `BULK_MATCH_PARTIAL` listing applied ids (each complete).
- import/sync: `withDocumentLock(bankAccountId, BANK_ACCOUNT_IMPORT)` around count-and-insert; sync lease `UPDATE … SET sync_lease_until=now()+10 min WHERE … lease expired RETURNING id`, else 409 `SYNC_IN_PROGRESS`.
- complete reconciliation: `BANK_RECONCILIATION` lock on the account, recompute inside, `FOR UPDATE` the cleared rows, stamp `reconciliation_id`.

**Reconciliation computation** — `computeBankReconciliationStatement(companyId, bankAccountId, asOf, statementBalance?)`, exported for D4. L = bank GL balance at asOf (account currency). A bank line is cleared when dated ≤ asOf and matched to an entry dated ≤ asOf; a ledger line is on the statement when such a bank line matches its entry; lines before `reconcile_from` count as cleared. S = param, else completed session, else import `closing_balance` at asOf, else last running `balance`, else null. Returns `statementBalance, ledgerBalance, unreconciledCredits (SC), unreconciledDebits (SD), depositsInTransit (LD), outstandingPayments (LC), adjustedStatementBalance = S + LD − LC, adjustedLedgerBalance = L + SC − SD, difference`, item lists, `statementBalanceSource`.

## 5. API contract

Every route: `authMiddleware, requireCustomer, requireCompanyAccess("params")` (auth.ts:195), or the loaded row's `company_id` re-checked on `/api/<entity>/:id`. Ledger-posting and feed routes also call `assertCanPostBanking` (role owner/accountant/cfo or firm access; employee → 403 `ROLE_NOT_ALLOWED`). Zod failures 400 (validate.ts:27), business rules 422, conflicts 409, locks 403. Prefix `/api/companies/:companyId`.

| Method path | Input (zod) | Response / errors |
|---|---|---|
| POST `/bank-statements/import` (extends bank-statements.routes.ts:549) | `{bankAccountId, content? \| csvContent?, fileName?, format: auto\|csv\|ofx\|mt940\|camt053}`, ≤5 MB | 201 `{importId, format, imported, duplicates, skippedDuplicates, statement{from,to,openingBalance,closingBalance,currency}, warnings}`; 422 `STATEMENT_PARSE_ERROR{line\|tag}`, `STATEMENT_EMPTY`, `STATEMENT_CURRENCY_MISMATCH`, `STATEMENT_ACCOUNT_MISMATCH` (IBAN) |
| POST `/bank-statements/imports/pdf` (upload route) | `{bankAccountId, fileName, fileData base64 PDF, pages: string[] ≤10, ≤200k chars}` | 201 `{importId, status:'staged', parser:'text'\|'ai', rows[{date,description,reference,amount,balance,issues[]}], statement, warnings}`; 422 `PDF_NO_TRANSACTIONS` (+`AI_NOT_CONFIGURED`) |
| GET `/bank-statements/imports[/:importId]`; POST `…/:importId/commit` `{rows ≤2000}`, `…/discard` | — | list / staged rows; commit as import; 409 `IMPORT_NOT_STAGED` |
| GET `/bank-statements/suggestions?bankAccountId&minConfidence=60`; GET `/:tid/suggestions` (:955, top 5) | — | `[{transactionId, kind, targetId, confidence, reasons[], label, amount, date, proposedLines[]}]` |
| POST `/:tid/match` (:693), `/:tid/create-entry` (:846), `/:tid/apply-rule {ruleId}` | match adds `bill`; receipts must be posted | 409 `ALREADY_RECONCILED`; 422 `RECEIPT_NOT_POSTED`, `FX_RATE_MISSING`, `BANK_GL_NOT_LINKED`, `RULE_NOT_APPLICABLE` |
| DELETE `/:tid/match` (:1006) | — | 200 `{reversedEntryId?}`; 409 frozen; 403 lock |
| POST `/bank-statements/bulk-match` | `{items[1..200]{transactionId, kind: invoice\|bill\|journal\|receipt\|rule\|account, targetId, paymentDate?}, dryRun?}` | 200 `{applied, results[]}`; 422 `BULK_MATCH_INVALID{errors[]}`; 409 `BULK_MATCH_PARTIAL` |
| POST `/bank-statements/apply-rules` | `{bankAccountId?, commit: false\|true, transactionIds?}` | preview `[{transactionId, ruleId, proposedLines}]` or posted results |
| GET `/bank-statements/reconciliation-report?bankAccountId&asOf&statementBalance?&format=json\|csv` | — | §4 object; CSV with BOM |
| POST `/bank-reconciliations`; GET list; POST `/:id/reopen` | `{bankAccountId, statementDate, statementBalance}` | 201; 422 `RECONCILIATION_NOT_BALANCED{difference}`; 409 out of order / `NOT_LATEST`; audit-logged |
| PATCH `/bank-accounts/:accountId` (:500) | + `reconcileFrom`; GL change backfills unmatched rows | 409 `BANK_GL_IN_USE` when matched rows exist |
| Rules CRUD (reconciliation-rules.routes.ts:18-114) | `{name, matchField, matchType contains\|equals\|starts_with\|regex ≤64, matchValue ≤200, direction, bankAccountId?, amountMin/Max?, splitLines[1..10], vatRate 0\|5, priority, isActive}` | 422 `RULE_SPLIT_INVALID`, `RULE_ACCOUNT_INVALID`, `RULE_REGEX_UNSAFE`, `RULE_VAT_INFLOW_UNSUPPORTED` |
| POST `/reconciliation-rules/auto-match` (:116); POST `/auto-reconcile/apply` (auto-reconcile.routes.ts:44) | unchanged | suggest-only; apply delegates to bulk-match |
| GET `/api/bank/providers` (bank.routes.ts:212) | — | `{providers: []\|['lean'], isConfigured, environment}` |
| POST `/bank-feeds/lean/session` | — | `{appToken, customerId, accessToken, sandbox, state}`; 400 `BANK_PROVIDER_NOT_CONFIGURED` |
| POST `/bank-feeds/lean/accounts` | `{state, entityId}` | `{accounts[]}`; 400 `STATE_INVALID`; 403 `BANK_ENTITY_NOT_OWNED` |
| POST `/bank-feeds/connections` | `{state, entityId, externalAccountId, bankAccountId, autoSync}` | 201 redacted connection; 409 connected; 422 currency |
| Legacy `/bank-connections` GET (:24), POST (:44), `/connect` (:225), `/callback` (:255) | — | never serialise tokens/entity id; POST manual only; connect 400 when unset else session; callback 410 |
| POST `/api/bank-connections/:id/sync` (:312) | `{fromDate?}` | `{imported, duplicates, total, lastSyncedAt}`; 409 `SYNC_IN_PROGRESS`; 502 `BANK_PROVIDER_ERROR` |
| GET `/cashflow/forecast` (cashflow.routes.ts:20) | `days 7..365, scenarioId?` or inline scenario fields | `{asOf, currency, openingBalance, scenario, weeks[{weekStart,weekEnd,inflows,outflows,net,closingBalance}], projections (legacy alias), items[{date,type,sourceId,label,amount,originalDate}], insights[{code,params}]}` |
| GET/POST/PATCH/DELETE `/cashflow/scenarios[/:id]` | 0111 fields | 404 cross-company |
| GET `/fixed-assets/register?asOf&format=json\|csv` | — | rows `{assetId, number, name, category, purchaseDate, cost, accumulated, nbv, status}`, totals, `glTie{gl1290, gl1240, difference, needsCapitalization[]}` |
| GET `/fixed-assets/depreciation-schedule?from&to&projectToEnd` | — | posted rows + projected rows (`projected: true`) |
| POST `/api/fixed-assets/:id/dispose` (:1187) | + `proceedsAccountId?` | 422 `PROCEEDS_ACCOUNT_INVALID`; sets `disposal_journal_id` |
| Retired | `POST /bank-transactions/import`, `POST /api/ai/parse-bank-statement` | 410 `USE_STATEMENT_IMPORT` |

Lean (S5 verifies each path on docs.leantech.me first and records it in the adapter): OAuth client-credentials token (customer-scoped for Link), `/customers/v1`, `/customers/v1/{id}/entities`, `/data/v2/accounts[/{id}/balances|transactions]`. Env (config/env.ts:95-97) adds `LEAN_CLIENT_SECRET`, `LEAN_ENV` (default sandbox), `LEAN_AUTH_BASE_URL`; configured = token + secret. `state` = HMAC(SESSION_SECRET) of company, user, 15-min expiry. Link SDK hosts join the CSP only when configured.

## 6. UI

- **BankReconciliation.tsx** (1,368 lines, split into components): tabs Transactions (bulk select), Import, Feeds (only when `providers` is non-empty), Reconciliation. Existing pdf.js/Tesseract extraction moves into `StatementImportDialog` → `/imports/pdf` → `StatementReviewGrid` (edit, exclude, opening + Σ = closing check). "Live bank feeds are not required" stays without a connection; "Connected · last synced" (plus "Sandbox") only for an active one.
- **AutoReconcile.tsx:** bulk accept table over `/bank-statements/suggestions` with a confidence filter and a Dr/Cr preview per row.
- **ReconciliationRules.tsx:** `RuleSplitEditor` (account select, percent, live total), VAT toggle (outflows only), direction, bank account, amount range, preview and apply.
- **CashFlowForecast.tsx:** weekly bars + balance line (Recharts), item table, `ScenarioPanel` (delays, collection rate, toggles, one-offs, save/load), insights from codes.
- **FixedAssets.tsx:** Register (as-of) and Schedule tabs with CSV export; disposal dialog gains a proceeds account select.
- **Nav:** add `{ titleKey: "cashFlowForecast", url: "/cashflow-forecast" }` to Banking (key exists, i18n.ts:438/886; route App.tsx:632); `/reconciliation-rules` stays in More (navigation-config.test.ts:76). Primary count 28 → 29 of 40.
- **i18n:** page tables plus one `*.i18n.ts` per new component, Arabic for all; `check-i18n` passes.
- **PDF:** reconciliation statement and asset register via D4's Arabic renderer; D3 adds no PDF code.

## 7. Tests

Integration suite `tests/integration/phase8-banking.test.mjs` (S5; fixtures in `tests/integration/fixtures/bank/`), chained in `test:integration`.

| AC | Test |
|---|---|
| D3-1 | 3 files × 3 lines → 9 rows, source per file, closing balance; truncated MT940 → 422 line; CAMT missing `Amt` → 422 tag |
| D3-2 | OFX again → 0 new, duplicates 3; CSV of same days → 0; identical same-day pair kept |
| D3-3 | Without Lean: providers `[]`, connect 400 |
| D3-4 | Boot with Lean base URLs on an in-test mock (node http): session → accounts → connection → sync twice (second 0); foreign entity 403; SKIP when providers `[]` |
| D3-5 | Invoice first, confidence ≥ 80; bulk-match writes `invoice_payments`; over-outstanding batch → 422, zero lines |
| D3-6 | Exact lines, `timesApplied +1`, receipt row, box 9 includes 1,000/50 |
| D3-7 | Fields; difference 0; with deposit in transit and outstanding payment adjusted balances equal; complete → reopen → unmatch |
| D3-8 | With D1's 1025: payout suggestion, accept, 1025 = 0; else SKIP |
| D3-9 | Register = GL 1290 − 1240; disposed excluded after date; projection ends at salvage; `disposal_journal_id` set |
| D3-10 | Four inputs bucketed; delay 15 shifts the receipt; opening = ledger |
| Extra | Tenant swaps (403/404); no tokens in GET connections; 10 parallel create-entry → 1; unmatch + re-create → one net posting; locked month 403; regex `(a+)+$` 422; USD account converts |

**Unit (S5, vitest, `tests/unit/`):** `bank-statement-parsers.test.ts` (OFX SGML/XML; MT940 multi-statement, comma decimals, RC/RD, `:86:`; CAMT BOOK/PDNG, batches, balances; detection), `bank-dedupe.test.ts`, `bank-rule-split.test.ts`, `bank-match-scoring.test.ts`, `bank-reconciliation-math.test.ts`, `cashflow-forecast-math.test.ts`, `fixed-asset-depreciation-math.test.ts`, `lean-adapter.test.ts` (mocked fetch), `bank-feed-state.test.ts`, `bank-feed-sync.test.ts` (hourly selection); update `bank-statement-import.test.ts`, `auto-reconcile-settlement-date.test.ts`.
**Unit (S6):** `statement-review.test.ts` (row validation, balance check), `cashflow-chart-data.test.ts`, `navigation-config.test.ts` (anchored), plus `check-i18n`.

## 8. Work split

**S5 owns:** migrations 0110-0113; anchored edits in `shared/schema.ts`, `server/routes.ts`, `scheduler.service.ts` (one hourly cron), `document-lock.ts`, `journal-entry-protection.ts`, `config/env.ts`, `config/upload-routes.ts`, `middleware/csp.ts`, `ai.routes.ts`, `bill-pay.routes.ts` (:628 delegates), `receipts.routes.ts` (guard), `package.json`; all of `server/routes/{bank,bank-statements,auto-reconcile,reconciliation-rules,cashflow,fixed-assets}.routes.ts`, new `bank-feeds.routes.ts`, `bank-reconciliations.routes.ts`; services `bank-statement-parsers/*`, `bank-import.service.ts` (rewritten), `bank-matching.service.ts`, `bank-match-scoring.ts`, `bank-rule-split.ts`, `bank-reconciliation{-math,.service}.ts`, `open-banking.service.ts`, `bank-feed-{sync.service,state}.ts`, `bill-payment.service.ts`, `cashflow-forecast{.service,-math}.ts`, `fixed-asset-{depreciation-math,reports.service}.ts`; delete `depreciation.service.ts`; backend tests and fixtures.
**S6 owns:** `client/src/pages/{BankReconciliation,AutoReconcile,ReconciliationRules,CashFlowForecast,FixedAssets}.tsx` and their `.i18n.ts`; new `client/src/components/banking/*`, `client/src/components/cashflow/*`, `client/src/components/assets/*` (+ i18n); `client/src/lib/banking-api-types.ts`, `client/src/lib/statement-review.ts`; anchored edits in `nav-config.ts` and `tests/unit/navigation-config.test.ts`; `scripts/i18n-allowlist.json`; S6's unit tests.

**Order (S5):** 1) token redaction + manual-only create, migrations + Drizzle, report "0110-0113 in tree"; 2) parsers, import, PDF staging; 3) matching fixes, scorer, bulk; 4) rules; 5) reconciliation + sessions; 6) Lean + sync; 7) forecast; 8) assets; 9) D3-8 when 1025 lands. **S6** starts now on `banking-api-types.ts` (from §5) with fixtures: grid, rule editor, forecast, assets, Feeds last; wires each screen as S5 reports. No server files or migrations on the frontend side.

## 9. Dependencies

| Need | From | Fallback |
|---|---|---|
| 1025 Payment Gateway Clearing (0102) | D1 | Generic clearing/transfer suggestion for any bank/cash account; D3-8 SKIP |
| `vendor_bills`/`bill_payments`/`payroll_*` Drizzle; bill-pay.routes.ts approve-route edits | D2 | Raw SQL; S5 touches only the payment route region (:628-770) and tells S3 first |
| Approval gate excludes `bank_reconciliation`/`bank_rule` | D2 confirm | Else bank postings call D2's check |
| Catalog entries, frozen count, PDF renderer; register/schedule definitions call D3 services | D4 | D3 pages give JSON/CSV |
| Export includes `bank-statements` files; deletion purges bank secrets | D5 | Sync skips deleted companies itself |
| CSP edit for Lean | D5 (owner of security middleware) | S5 anchored edit, env-conditional |

## 10. Review plan (live requests, two boots: without and with mock Lean)

1. **Tenant:** B's user on every A route and id; B's accounts in A's splits or `proceedsAccountId` (422); B's Lean entity (403).
2. **Secrets:** no token or entity id in any connection response or activity log.
3. **Money:** batch over outstanding (422, zero lines); 20 parallel bulk-matches on one invoice (Σ ≤ total); 10 parallel create-entry (one); unmatch/re-create ×5 (ledger moves once); 33.33/33.33/33.34 on 100.01 balances; USD account at the dated rate.
4. **VAT:** VAT rule → box 9 = 1050 movement on the return preview; inflow VAT rule 422; filed period 403.
5. **Reconciliation:** hand-built statement with deposits in transit and outstanding cheques → difference 0; frozen rows; reopen latest only.
6. **Imports:** wrong IBAN/currency, 6 MB, XML entity bomb, MT940 without `:62F:`, same file twice in parallel.
7. **Forecast/assets:** D3-10 by hand; register vs GL; disposal account and journal link.
8. **UI honesty:** no provider → no "feed/live/connected" text; Arabic at 375 px on all five pages.

## Summary for the CTO

1. D3 mostly finishes code that exists but is wired wrong: Lean, OFX, scorer, rules, forecast, disposal.
2. Two critical security bugs ship today: decrypted bank tokens in `GET bank-connections` and an unverified Lean entity id. Fix first.
3. Ledger bugs: rule auto-match reconciles without posting; auto-apply credits AR without a payment; unmatch never reverses. 0110 reopens the silently reconciled rows.
4. Rule VAT must create a receipt row, or box 9 never claims it.
5. Dedupe drops description from the key and counts duplicates as a multiset (VP key would miss OFX/CSV overlaps).
6. Depreciation and disposal post correctly; we add reports, a proceeds account and `disposal_journal_id`, and delete two dead services.
7. Reconciliation statement is two-sided (deposits in transit and outstanding payments too), exported to D4 as `computeBankReconciliationStatement`.
8. Please reserve advisory-lock namespaces 13xx for D3, and confirm D2's approval gate excludes bank postings.
9. Owner: Lean sandbox app token and secret; Lean production contract (per-connection fees) before any "bank feeds" claim; accountant view on VAT for asset disposals.
10. Owner: AI fallback for scanned PDF statements uses the existing OCR provider (paid per call, capped at 10 pages); approve or we ship text-layer PDFs only.
