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
| F03 | S2 | — | Error/empty/stale states distinct; no prior-company totals after a switch | Not yet investigated | — | **open** |
| F04 | S2 | Source + unit | No fabricated counts; 2 of 5 → 3 remaining; history failure separate; server-side readiness on close; stale close revalidates | `totalCount = checklist.length \|\| 7` fabricated "0/7" on failure. An empty checklist showed **"All Clear"** (0 === 0). A checklist read failure showed "Select a period". A history failure showed "No period closings recorded". Lock had **no server readiness check** | `shared/month-end-readiness.ts`. The page derives progress only from a successful response, has distinct loading/error(+retry)/empty states and a separate history error + retry. The lock button is disabled unless the checklist is loaded and not refetching, and the dialog warns about open items. `POST /month-end/lock-period` recomputes the checklist and refuses empty (422), unacknowledged open items (409 `CLOSE_NOT_READY`) or a stale acknowledgement (409 `CLOSE_STALE_CHECKLIST`). The client refetches on refusal, and the audit records acknowledged open items. Integration script `tests/integration/fixes.test.mjs` is updated to acknowledge. Test: `tests/unit/month-end-readiness.test.ts` | **fixed awaiting verification**. Still open: page copy is English-only (pre-existing; AR strings needed); component-level render test with controlled failures; the `isCurrentPeriodLocked` check uses UTC `toISOString` (see F06); "no configuration" case semantics; PR #137 not inspected |
| F05 | S2 | — | Independent panel states; failed removal keeps the item | Not yet investigated | — | **open** |
| F06 | S1 | Source + unit | Nov locked / Dec open: 1 Dec 00:30 Dubai → December; 30 Nov 23:59 Dubai locked; year end; date-only; UTC instant; reversal; stored date = selected period | `assertPeriodNotLocked` used `toISOString().slice(0,10)` (UTC). 1 Dec 00:30 Dubai (= 30 Nov 20:30Z) **was refused as November**. Journal reversal stored `new Date()` | `shared/accounting-date.ts` (date-only preserved; instants → Asia/Dubai; persisted as UTC midnight of the business date). `assertPeriodNotLocked` checks the business date and returns it. Journal create, update and reverse now **store** that normalised date (`storesBusinessDate: true`). Callers not yet migrated are also blocked when the UTC reading is locked, so no locked period can be mutated during the transition. `isFutureDate` uses the Dubai business day. Test: `tests/unit/accounting-date-period-lock.test.ts` (+ existing `future-date-guard.test.ts` passes) | **fixed awaiting verification** (journals). **Still open:** about 35 other callers (invoices, bills, payments, bank, fixed assets, FX reval, expense claims, CT, closing entries, credit notes on `new Date()`) still persist raw instants and keep the conservative dual check, so they don't yet get the December acceptance behaviour. Close/reopen period-key derivation needs review. There is no per-company time-zone column; Asia/Dubai is hard-wired. DB-backed assertion of the stored journal date is not yet run |
| F07 | S1 | — | FX/credit/cost-centre reconciliation to the smallest unit | Not yet investigated; depends on the F01 credit change | — | **open** |

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
- Fixed awaiting verification: **4** (F01, F02, F04, F06; each has open sub-scope listed).
- Open: 21 · Blocked or partly blocked: 7.
- Handoff to Astra 6.2: **not eligible**.

## 4. Commands run (local, Node 18.16, Windows)

```
npx vitest run tests/unit/document-totals-rounding.test.ts tests/unit/vat-autopilot.test.ts tests/unit/einvoice.test.ts   # 104 passed
npx vitest run tests/unit/month-end-readiness.test.ts                                                                    # 10 passed
npx vitest run tests/unit/accounting-date-period-lock.test.ts tests/unit/future-date-guard.test.ts ...                  # 34 passed
npx vitest run tests/unit/vat-effective-returns.test.ts                                                                  # 6 passed
```
npx tsc --noEmit -p .                     # exit 0 (after F01/F02/F04/F06)
npx eslint <changed files>                # 0 errors; warnings are pre-existing unused imports
node scripts/check-{money-types,no-stray-duplicates,client-bundle-hygiene,api-contract}.mjs  # ok
npx vitest run                            # 1016 passed, 1 skipped, 1 failed (90 files)
```

Full-suite failure triage: `tests/unit/report-discovery.test.ts > offers persona report packs`
expects LF-joined source text, and `client/src/pages/Reports.tsx` is checked out with CRLF line
endings on this Windows working copy. The file is untouched by this campaign. Logged as a
**pre-existing environment issue (new register row ENV-01, open)**; it must be re-run on Linux CI
before it can be called unaffected. The one skipped test file is not yet triaged (gate stays
open). Not run: `npm run build` (Node 18.16 < 20.19), DB integration tests, browser crawl,
coverage ratchet, dependency audit.
```
