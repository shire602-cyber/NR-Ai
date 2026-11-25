# Muhasib release register — public-launch remediation

Opened 2026-11-25. This is the single register for the Astra 6.2 handoff campaign.
Dispositions: `open` · `fixed awaiting verification` · `verified fixed` ·
`verified unaffected` · `verified product limitation` · `blocked`.
A confirmed defect stays in the open count until it is **verified fixed** on the
frozen candidate in staging. "Fixed awaiting verification" is not closed.

## 1. Candidate identification (O05, first pass)

| Field | Value | Evidence |
|---|---|---|
| Working branch | `claude/gracious-bohr-pymgxi` | `git branch --show-current` |
| Branch base SHA (pre-campaign) | `83fcbdcf7fb7dd6d508f06a1951ef2e386596e99` | `git rev-parse HEAD` |
| `origin/main` (Railway production deploy source) | `bcef2255175fbcdd942d5dfb6f24a4471436c9cf` | `git rev-parse origin/main` |
| Branch vs main | 4 commits ahead (e-invoicing: A-Cube/Complyance adapters, Peppol EndpointID, PINT AE party details, client partner setup), 0 behind | `git log origin/main..HEAD` |
| Original source-review SHA | `ad817efa4ee82b613f6cd853518eae83a9dfa58c` | from assignment; not yet diffed |
| Migration head | `0090_einvoice_asp_appointments` (journal idx 89) | `migrations/meta/_journal.json` |
| Staging deployment SHA / build ID | **blocked**: no staging URL or Railway access in this environment | — |
| Worker versions / feature flags / provider env | **blocked**: needs Railway/operator access | — |
| Local runtime | Node **18.16.0**. The repo requires Node ≥ 20.19 for the Vite 8/Rolldown build | `node -v`; AGENTS.md |
| GitHub access | `gh` is **not authenticated**, so PRs 116/125/137/167, CI runs and issues can't be read | `gh pr view` → auth prompt |
| Untracked, not part of the candidate | `reports/`, `research_notes/` (e-invoicing pricing research) | `git status` |

**Open O05 blockers:** (1) authenticated `gh` or a GitHub token, so PRs/CI can be reconciled;
(2) staging URL plus Railway read access for the deployment SHA, build ID, migration state
and worker versions; (3) a Node 20.19 runtime for `npm run build` and the browser crawl.
The referenced `Muhasib-Staging-Audit-2026-11-25.md` and the November CI baseline are **not in the
repository**. Expected/observed values below come from the assignment text plus source inspection.

PR reconciliation: only PR #104 is visible locally (merge `e278909e`,
`codex/fix-accounting-audit-remainder`). PRs 116, 125, 137 and 167 have no local refs or merge
commits. Per the assignment, a PR merge alone does not close any item. Every fix below was made
and tested against the current source.

## 2. Register

Owner for every row is the implementation agent (this campaign) unless stated otherwise.
Severity: S1 = money/evidence integrity · S2 = wrong figure/state shown · S3 = journey/copy ·
S4 = ops/evidence.

### Accounting

| ID | Sev | Evidence class | Expected | Observed on baseline `83fcbdcf` | Fix / regression test | Disposition |
|---|---|---|---|---|---|---|
| F01 | S1 | Source + deterministic unit | 2 × AED 0.10 @ 5% → VAT 0.01 + 0.01 = 0.02, gross 0.22. The same rule applies in editor, API, PDF, payload, VAT 201 and credits | Server `calculateDocumentTotals` / `calculateInvoiceTotals` rounded **once at document level**: 0.005 + 0.005 = 0.01 VAT, **0.21 gross**. The editor summed float values with no rounding. PDF VAT buckets and PINT-AE tax subtotals used unrounded `qty×price×rate`. Autopilot Box 1 rounded per bucket. A final credit after a partial credit used a pro-rata net and could leave fil residuals | New `shared/document-totals.ts`: line-level half-up rounding (Decimal), used by the API (`invoices.routes`, quotes/POs/CNs via `document-totals.service`), editor (`Invoices.tsx`), PDF buckets, e-invoice line/tax subtotals and validation, and `aggregateInvoiceLines`. The final credit clears the persisted remaining net + VAT exactly, with a pro-rata fallback only for legacy rows where subtotal + VAT ≠ total. Test: `tests/unit/document-totals-rounding.test.ts` | **fixed awaiting verification**. Still open: no line discount or tax-inclusive price fields exist in the schema (confirm as a product limitation or add them); EN/AR PDF render comparison; staging check that issued historical docs still render persisted totals; PINT-AE validator acceptance of line-summed tax subtotals (ties to O01); credit-note CN-line totals path. `invoice-posting.service` already posts persisted `vatAmount` |
| F02 | S2 | Source + unit | Original AED 10,000 superseded by AED 9,000 counts once at 9,000; pending amendment has no effect; refunds net; periods and companies separate | `VATFiling.tsx` card summed `box14PayableTax` over **all** rows: drafts, `amended` (superseded) rows and pending amendments. 10,000 + 9,000 showed **19,000** | `shared/vat-effective-returns.ts` selects one effective version (submitted/filed, latest) per company + period. The card is relabelled "Net VAT declared (effective returns)" (EN/AR) and explicitly is not outstanding cash. Test: `tests/unit/vat-effective-returns.test.ts` | **fixed awaiting verification**. Still open: the schema has no explicit supersedes link, so selection relies on status + submittedAt (confirm against the filing lifecycle owner); the drilldown list must use the same selector (not yet wired); server-side summaries (firm command centre) not yet aligned; PR #125 not inspected |
| F03 | S2 | Source + unit | Failed initial read shows an EN/AR retry; a genuinely empty ledger can show zero; a company switch never shows the prior company's totals; exports match source | P&L cards rendered `formatCurrency(profitLoss?.totalRevenue \|\| 0)`, so a **failed read showed AED 0.00** for revenue, expenses and net profit, the same as an empty ledger. Balance sheet and VAT tabs were the same. Single-report and workspace-pack exports of a failed report produced zero-valued sheets. Company switch: keys include `selectedCompanyId` + `dateParams`, with no `placeholderData`/`keepPreviousData`, so prior-company data is not reused (source check) | `client/src/lib/reportReadState.ts` (idle/loading/error/stale/ready). P&L (4 figures), balance-sheet and VAT tabs render an EN/AR error + retry instead of numbers, and a stale banner when a refetch fails over last-known data. Excel export of the active tab and Excel/Sheets pack exports refuse failed reports with a named toast. Test: `tests/unit/report-read-state.test.ts`. Report suites (`report-discovery`, `report-catalog-routes`, `report-export-helpers`, `mobile-launch-ux`) pass | **fixed awaiting verification**. Still open: the remaining ~40 report queries on the page (aging, cash-flow statement, cost centres, trial balance…) still use `\|\| 0` / `= []` defaults; Google Sheets single-tab export path not guarded; component test with delayed/failed responses and company switch mid-request; reconciliation of recovered reads to source balances; PR #116 not inspected |
| F04 | S2 | Source + unit | No fabricated counts; 2 of 5 → 3 remaining; history failure separate; server-side readiness on close; stale close revalidates | `totalCount = checklist.length \|\| 7` fabricated "0/7" on failure. An empty checklist showed **"All Clear"** (0 === 0). A checklist read failure showed "Select a period". A history failure showed "No period closings recorded". Lock had **no server readiness check** | `shared/month-end-readiness.ts`. The page derives progress only from a successful response, has distinct loading/error(+retry)/empty states and a separate history error + retry. The lock button is disabled unless the checklist is loaded and not refetching, and the dialog warns about open items. `POST /month-end/lock-period` recomputes the checklist and refuses empty (422), unacknowledged open items (409 `CLOSE_NOT_READY`) or a stale acknowledgement (409 `CLOSE_STALE_CHECKLIST`). The client refetches on refusal, and the audit records acknowledged open items. Integration script `tests/integration/fixes.test.mjs` is updated to acknowledge. Test: `tests/unit/month-end-readiness.test.ts` | **fixed awaiting verification**. Still open: page copy is English-only (pre-existing; AR strings needed); component-level render test with controlled failures; the `isCurrentPeriodLocked` check uses UTC `toISOString` (see F06); "no configuration" case semantics; PR #137 not inspected |
| F05 | S2 | Source + unit | Forecast, history and scheduled items have independent states; failed removal keeps the item with a retry; empty history distinguishable | `CashFlowForecast.tsx` (this candidate) has **only** forecast + history queries; there are no scheduled items and no removal action. A failed history read showed "No historical data available yet", the same as empty. A failed forecast read showed nothing at all for summary cards, and "No projection data" for the table | Forecast summary, weekly projections and history each render their own EN/AR error + retry. History error is distinct from the empty message. The other panels keep their data when one fails. Test: `tests/unit/report-read-state.test.ts` (F05 block) | **fixed awaiting verification** (forecast/history). **Scheduled items/removal: blocked.** That scope does not exist on this branch; it may live in unmerged PR #167, which needs GitHub access to inspect. Rest of page copy is English-only |
| F06 | S1 | Source + unit | Nov locked / Dec open: 1 Dec 00:30 Dubai → December; 30 Nov 23:59 Dubai locked; year end; date-only; UTC instant; reversal; stored date = selected period | `assertPeriodNotLocked` used `toISOString().slice(0,10)` (UTC). 1 Dec 00:30 Dubai (= 30 Nov 20:30Z) **was refused as November**. Journal reversal stored `new Date()` | `shared/accounting-date.ts` (date-only preserved; instants → Asia/Dubai; persisted as UTC midnight of the business date). `assertPeriodNotLocked` checks the business date and returns it. Journal create, update and reverse now **store** that normalised date (`storesBusinessDate: true`). Callers not yet migrated are also blocked when the UTC reading is locked, so no locked period can be mutated during the transition. `isFutureDate` uses the Dubai business day. Test: `tests/unit/accounting-date-period-lock.test.ts` (+ existing `future-date-guard.test.ts` passes) | **fixed awaiting verification** (journals). **Still open:** about 35 other callers (invoices, bills, payments, bank, fixed assets, FX reval, expense claims, CT, closing entries, credit notes on `new Date()`) still persist raw instants and keep the conservative dual check, so they don't yet get the December acceptance behaviour. Close/reopen period-key derivation needs review. There is no per-company time-zone column; Asia/Dubai is hard-wired. DB-backed assertion of the stored journal date is not yet run |
| F07 | S1 | Source + deterministic unit (hand-calculated fixture) | Credits reverse at the original rate; tax-treatment legs reverse their own accounts; after the final credit every A/R, revenue, zero-rated and VAT leg nets to zero to the fil; exchange differences are separate from rounding residuals | **(a)** The credit-note JE posted **document-currency amounts into the AED ledger**: a USD 1,035 invoice posted AR AED 3,801.04, and a USD 367.50 partial credit reversed only "AED 367.50" (982.15 AED short). **(b)** The CN reversal always debited standard revenue, so **Zero-Rated Sales was never reversed** (Box 4 ↔ GL drift). **(c)** The CN document stored no `exchangeRate` / `baseCurrencyAmount`. **(d)** The void reversal had the same doc-currency bug. **(e)** Invoice posting's zero-rated net used unrounded qty×price (F01 drift) | `server/services/credit-note-posting.ts`: the planner converts at the original rate, splits standard / zero-rated / VAT, caps each leg at what is still posted, and on the final credit reverses exactly the remaining posted AED per leg (original JE lines less prior CN JE lines). The CN stores the original rate and AED base amount. The CN date and JE use the Dubai business date (F06). Void now mirrors the original posted lines (accounts, AED amounts, FX metadata swapped, cost centre kept). Posting uses `lineNetAmount`. Decision recorded: **a credit note creates no exchange difference**; FX gains/losses belong to settlement and revaluation only. Test: `tests/unit/credit-note-fx-reversal.test.ts` (USD 3.6725 fixture: partial then final credit nets all four legs to zero; the 0.01 residual a naive conversion would leave is shown to be rounding, not FX) | **fixed awaiting verification**. Still open: **foreign overpayment, refund-date FX and settlement exchange differences are not yet traced**; customer statement / trial balance / VAT box reconciliation needs a DB-backed run; capped full-reversal CN *document lines* still scale unit prices to 4 dp, so line sums can differ from CN header totals by fils (header and GL are now exact); **cost centres:** invoices and credit notes never assign cost centres (only manual journal lines carry `costCenterId`), so named-cost-centre revenue/credit reconciliation is a product limitation to confirm with the owner; export/reload survival not yet run; PR #104 overlap not re-diffed |

### Environment / gate hygiene (new)

| ID | Sev | Expected | Observed | Fix | Disposition |
|---|---|---|---|---|---|
| ENV-01 | S4 | Unit suite is green on supported dev platforms | `report-discovery.test.ts > offers persona report packs` failed on this Windows checkout (`core.autocrlf=true`): it asserted LF-joined snippets against a CRLF working copy. It passed once `Reports.tsx` had LF endings, which confirms the root cause | `read()` helper in that test normalises `\r\n` → `\n` | **fixed awaiting verification** (needs a Linux CI run) |

### Records, privacy, controls

| ID | Disposition | Note |
|---|---|---|
| S01 | open | Retention model review not started |
| S05 | open | Parser validation not started |
| S02+S03 | open | Atomic delete/audit/outbox not started |
| S04 | blocked (partly) | Provider contract terms need the operator; code trace not started |
| S06 | blocked | Needs deployed headers from staging |
| S07 | blocked | Needs operator backup/encryption evidence and an isolated restore |
| S08 | open | Role matrix not started; needs a disposable DB |

### Public website and buyer journey

| ID | Disposition | Note |
|---|---|---|
| W01–W10 | open | Not started. W07 needs a dated vendor pricing source; W09 needs the designated test destination; W10 needs staging and production header captures |

### Integration and release operations

| ID | Disposition | Note |
|---|---|---|
| O05 | open (partial) | Local identifiers recorded above; staging receipt blocked |
| O03 | open | bills-aging p95 (108 ms vs 101 ms budget) not reproduced; needs Postgres and the defined dataset |
| O04 | open | Import preview default not started |
| O01 | blocked (partly) | Provider sandbox credentials/references needed; F01 changes the tax-subtotal derivation, so revalidate |
| O02 | blocked (partly) | OCR provider sandbox needed |
| O06 | blocked (partly) | Test billing account needed |
| O07 | open | Migration + WPS fixture not started |

## 3. Counts

- Original items: 32. Verified dispositions: **0**.
- Fixed awaiting verification: **7** (F01–F07; each has open sub-scope listed) plus new ENV-01.
- Open: 18 · Blocked or partly blocked: 7 (+ F05 scheduled-items scope).
- Handoff to Astra 6.2: **not eligible**.

## 4. Commands run (local, Node 18.16, Windows)

Commit `7e622382` (F01, F02, F04, F06):

```
npx vitest run tests/unit/document-totals-rounding.test.ts tests/unit/vat-autopilot.test.ts tests/unit/einvoice.test.ts   # 104 passed
npx vitest run tests/unit/month-end-readiness.test.ts                                                                    # 10 passed
npx vitest run tests/unit/accounting-date-period-lock.test.ts tests/unit/future-date-guard.test.ts (+ above)            # 34 passed
npx vitest run tests/unit/vat-effective-returns.test.ts                                                                  # 6 passed
npx tsc --noEmit -p .                                                                                                    # exit 0
npx eslint <changed files>                                                                                               # 0 errors
node scripts/check-{money-types,no-stray-duplicates,client-bundle-hygiene,api-contract}.mjs                              # ok
npx vitest run                                                                                                           # 1016 passed, 1 skipped, 1 failed (ENV-01)
```

Follow-up commit (F03, F05, ENV-01):

```
npx vitest run tests/unit/report-read-state.test.ts                                                                      # 9 passed
npx vitest run tests/unit/report-discovery.test.ts tests/unit/report-catalog-routes.test.ts \
  tests/unit/report-export-helpers.test.ts tests/unit/mobile-launch-ux.test.ts                                           # 38 passed
npx tsc --noEmit -p .                                                                                                    # exit 0
npx eslint <changed files>                                                                                               # 0 errors
npx vitest run                                                                                                           # 1026 passed, 1 skipped, 0 failed (91 files)
```

The one skipped unit test file is not yet triaged, so that gate stays open. Not run on this
machine: `npm run build` (Node 18.16 < 20.19), DB integration tests, browser crawl, coverage
ratchet, dependency audit.

Follow-up commit (F07):

```
npx vitest run tests/unit/credit-note-fx-reversal.test.ts tests/unit/invoice-lifecycle.test.ts   tests/unit/document-totals-rounding.test.ts                                                                            # 40 passed
npx tsc --noEmit -p .                                                                                                    # exit 0
npx vitest run                                                                                                           # 1034 passed, 1 skipped, 0 failed (92 files)
```
