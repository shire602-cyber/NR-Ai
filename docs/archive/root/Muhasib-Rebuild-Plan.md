# Muhasib — The Rebuild Plan

**From:** 219,217 lines, 113 screens, ~619 endpoints, 33 "live" reports, 9 navigation groups, 0 customers
**To:** a UAE accounting product that is correct, small, fast, and defensible

**Date:** 7 August 2026
**Execution model:** solo founder + AI agents
**Product decision:** SME first; the firm product is deferred, not cancelled
**Code decision:** hard delete to an archive branch

> **Verification status.** Every checkable claim below was re-verified against the codebase by an independent adversarial pass. Seventeen claims in my first draft were wrong and have been corrected in place — the corrections are listed in [Appendix A](#appendix-a--what-the-fact-check-changed). Runtime figures (observed 7 Aug 2026) are marked as observations. Regulatory and competitor claims carry sources and cannot be verified from the repo — treat them under the same rule as §0.2.

---

## Contents

- [Part I — The three rules](#part-i--the-three-rules)
- [Part II — What "1000× better" means, measured](#part-ii--what-1000-better-means-measured)
- [Phase 0 — Stop the bleeding (Week 1)](#phase-0--stop-the-bleeding-week-1)
- [Phase 1 — Make the numbers true (Weeks 2–4)](#phase-1--make-the-numbers-true-weeks-24)
- [Phase 2 — The Great Deletion (Weeks 5–7)](#phase-2--the-great-deletion-weeks-57)
- [Phase 3 — Make it a product people enjoy (Weeks 8–11)](#phase-3--make-it-a-product-people-enjoy-weeks-811)
- [Phase 4 — The compliance moat (Weeks 12–16)](#phase-4--the-compliance-moat-weeks-1216)
- [Phase 5 — Re-land the firm product (Weeks 17–24)](#phase-5--re-land-the-firm-product-weeks-1724)
- [Part III — How to dominate](#part-iii--how-to-dominate)
- [Part IV — The complete issue register (33 items)](#part-iv--the-complete-issue-register-33-items)
- [Part V — Working with AI agents on this](#part-v--working-with-ai-agents-on-this)
- [Part VI — The weekly scoreboard](#part-vi--the-weekly-scoreboard)
- [Appendix A — What the fact-check changed](#appendix-a--what-the-fact-check-changed)

---

## Part I — The three rules

Everything below follows from three rules. If a decision is ever unclear, apply them in order.

### Rule 1 — A number is computed in exactly one place

Today there are **three VAT calculations**, **two P&L endpoints plus a third inline implementation inside the AI gateway**, and **two balance-sheet endpoints plus that same inline third**. They disagree. That is not a bug you fix once; it is a category of bug you have to make structurally impossible.

Every financial figure gets **one** implementation, in `server/domain/`, with no HTTP in it. Routes become thin adapters. If two screens show the same number, they call the same function. A pull request that adds a second way to compute a figure is rejected on sight.

The clearest illustration is `server/routes/ai.routes.ts:1535-1549`, where `POST /api/ai/nl-gateway` recomputes `totalRevenue`, `totalExpenses`, `totalAssets` and `totalLiabilities` from journal lines by account type — a fourth balance sheet, hidden inside a chatbot. Partial copies also live in `cost-centers.routes.ts:171`, `analytics.routes.ts:683`, `month-end.service.ts` and `ct-workpaper-export.service.ts`.

### Rule 2 — Nothing ships without an integration test that would have caught the bug

You have 939 passing unit tests and none of them caught: a 500 on period lock, a 95× overpayment, a wrong VAT figure, a 500 on bank account creation, or an app that doesn't boot. Those tests are not protecting you, they are reassuring you.

Every fix in this plan lands with a test that drives **real HTTP against a real Postgres**. The rule is literal: write the failing test first, then fix.

### Rule 3 — Surface area is the enemy

61 navigation destinations and zero customers. Every one of those was a guess. The plan is not to improve them; it is to **remove them until what's left is unimprovable**, then add back only what a paying customer asks for by name.

The target is **12 screens**. Not 12 sections — 12 screens.

---

## Part II — What "1000× better" means, measured

"Better" is unfalsifiable. These are the numbers. Put them on a wall.

| Metric | Today | Target | Phase |
|---|---:|---:|---|
| Financial figures with >1 implementation | 3 families | **0** | 1 |
| Money columns still `real` in the live schema | **63** (56 in `vat_returns`) | **0** | 1 |
| Orphaned migrations not in `_journal.json` | **8** | **0** | 1 |
| Integration tests (real HTTP + real DB) | **1** (skipped by default) | **≥60, all in CI** | 1 |
| Critical bugs from the teardown open | **5** | **0** | 1 |
| Navigation destinations | **61** | **12** | 2 |
| Client routes | **113** | **≤20** | 2 |
| API endpoints (unique method+path) | **619** | **≤180** | 2 |
| Reports advertised as "live" | **33** (`apiReportCount: 0`) | **9, all API-backed** | 2 |
| Total TypeScript LOC | **219,217** | **≤90,000** | 2 |
| Largest single file | **21,779** (`Reports.tsx`) | **≤800** | 2 |
| Files over 800 lines | **66** | **0** | 2 |
| Schema definition systems | **3** | **1** | 1 |
| First-paint JavaScript (raw / gzip −6) | **2,013,794 B / ~602 KB** | **≤450 KB / ≤140 KB** | 3 |
| Stylesheet | **254,267 B** | **≤60 KB** | 3 |
| Time to first invoice, new signup | unmeasured | **< 3 minutes** | 3 |
| Hardcoded English strings in JSX | **≥1,004** (see 3.4) | **0** | 3 |
| Pages importing `useTranslation` | **44 / 102** | **100%** | 3 |
| App boots from clean `git clone` | **No** | **Yes, CI-enforced** | 0 |
| Accredited ASP relationship | none | **signed** | 4 |
| Production npm advisories | **7 (5 high)** | **0** | 0 |

**The single headline number:** 219,217 → 90,000 lines, while the product gets *more* correct. That is the whole plan in one row.

---

## Phase 0 — Stop the bleeding (Week 1)

Five days. Nothing here is architecture; it's damage control.

### Day 1 — Legal and reputational exposure

**0.1 — Delete the fabricated testimonial.**
`client/src/pages/MuhasibLanding.tsx:1338–1392` — the "Hassan Mansour" (`:1382`) / "Group CFO · Madar Holdings (Dubai)" (`:1385`) block with the "11 days to under two" quote. Delete the whole section, not just the name.

**0.2 — Delete the competitor comparison table.**
`client/src/pages/Pricing.tsx:287` — the `competitorData` array, the table that renders it, and its i18n keys. The Zoho cells read `arabicSupport: false`, `uaeVATBuiltIn: false`, `corporateTaxComp: false`, `eInvoicingComp: false`. Zoho Books files VAT 201 directly into EmaraTax with emirate splits; your table says it has no UAE VAT support at all. That is a comparative advertising claim you cannot defend.

**The rule going forward, and it applies to this document too:** a comparative claim ships only with a dated screenshot from the competitor's own documentation, with the verification date next to it on the page.

**0.3 — Remove the e-invoicing claim from all marketing** until Phase 4 lands. Your submit endpoint defaults to `provider: "mock"`. Saying otherwise is 0.2 pointed at yourself.

### Day 2 — Make it boot

**0.4 — Commit `server/services/scheduler.service.ts`.**

```bash
git checkout HEAD -- server/services/scheduler.service.ts
git add server/services/scheduler.service.ts
git commit -m "fix(boot): restore scheduler.service, deleted in working tree"
```

**0.5 — Add the clean-clone boot gate to CI.** This class of bug — "works on my machine because my machine has a file git doesn't" — never happens again.

```yaml
- run: git clone . /tmp/clean && cd /tmp/clean && npm ci
- run: cd /tmp/clean && npm run db:migrate && (npm start &) && sleep 20
- run: curl -sf http://localhost:5000/api/version
```

### Day 3 — The dangerous endpoint

**0.6 — Delete `/api/companies/:id/reports/vat-return`.**
`server/routes/reports.routes.ts:754–886`.

**An important correction to the teardown.** This endpoint has **zero callers in the client** — verified twice across the whole tree. `Reports.tsx:3713` and `:4035` call `/reports/vat-summary` (`dashboard.routes.ts:528`), which sums the stored `invoice.vatAmount` excluding drafts and voids, and returns the **correct** figure. The 40-odd `"vat-return"` strings in the client are a catalog report *id* whose href points at `/vat-filing`.

So **no user is currently seeing the wrong number through the UI.** That is a lower severity than the teardown implied, and I'd rather correct myself than have you act on an inflated one.

It is still a publicly-reachable authenticated endpoint returning a confidently wrong VAT liability — observed 7 Aug 2026: AED 75 where the ledger said 50, and AED 1,300 of standard-rated supplies where only AED 1,000 was standard-rated — because line 808 classifies by `invoice_lines.vatSupplyType`, a column the invoice API never writes. It is one wiring change from being user-visible.

Delete it. Don't fix it. Phase 1 replaces the whole family.

### Day 4 — The money guard

**0.7 — Reject payments that exceed the invoice balance.**
`server/routes/invoices.routes.ts`, the `POST .../payments` handler. There is no balance check today; the excess is booked to `2050 Deferred Revenue` (`server/storage.ts:4908-4909`, with a comment saying so).

```ts
const balance = round2(Number(invoice.total) - Number(invoice.amountPaid ?? 0));
if (amount > balance + 0.005) {
  return res.status(422).json({
    message: `Payment of ${amount} exceeds the outstanding balance of ${balance}.`,
    code: "PAYMENT_EXCEEDS_BALANCE",
    details: { balance, attempted: amount },
  });
}
```

A stopgap — Phase 1 builds the proper customer-credit model. But today a typo posts AED 99,450 to Deferred Revenue with a 201 and no way to recover it.

### Day 5 — Housekeeping

**0.8 — `npm audit fix`.** 7 advisories, 5 high, spanning **seven different packages**: `body-parser`, `brace-expansion`, `dompurify`, `pdfjs-dist`, `postcss`, `socket.io-parser`, `undici`. (`pdfjs-dist` is one of them — it also disappears in 3.3, so sequence these.) Add Dependabot.

**0.9 — Pin the CI heap.** `NODE_OPTIONS=--max-old-space-size=6144`. `tsc` OOMs on the default heap — reproduced at exit 134, 2.1 GB peak RSS. Note this is load-bearing for `npm run check` itself, which runs `tsc`, not just for a separate typecheck step.

**0.10 — Confirm `NODE_ENV` in every deploy target.** Dev-mode 500s return raw SQL and bound params. On Railway this is **already closed at build time** — esbuild hardcodes `--define:process.env.NODE_ENV="production"` — and there is no `vercel.json` in the repo. So this is a five-minute audit of any *other* host you deploy to, not a code fix. Lower priority than the teardown implied.

**Phase 0 exit criteria:** clean clone boots in CI · no unverifiable marketing claims live · overpayment returns 422 · zero npm advisories.

---

## Phase 1 — Make the numbers true (Weeks 2–4)

The phase that matters most. An accounting product that is small and pretty and wrong is worth nothing. Do not start Phase 2 until every acceptance test here is green.

### 1.1 — Build the test harness first (Week 2, days 1–2)

Before any fix. `tests/integration/` against a real Postgres.

```
tests/integration/
  harness.ts            spin up pg, migrate, seed, return {api, db, reset}
  ledger.test.ts        invoice → issue → payment → credit note, GL assertions
  vat.test.ts           VAT 201 boxes, emirate split, period validation, GL reconciliation
  period-lock.test.ts   lock, then assert every write path is refused
  reports.test.ts       every surviving report against a known fixture
  tenancy.test.ts       the cross-tenant matrix
  boot.test.ts          clean migrate + boot + /api/version
```

Seed one canonical fixture — **"Al Noor Trading LLC"** — with figures you can check by hand:

| | |
|---|---|
| 1 standard-rated invoice | AED 10,000 net, VAT 500 |
| 1 mixed invoice | AED 5,000 standard + AED 3,000 zero-rated, VAT 250 |
| 1 exempt supply | AED 1,000 |
| 1 foreign invoice | USD 1,000 @ 3.6725 |
| 2 expense receipts | AED 2,000 net, input VAT 100 |
| 1 partial payment, 1 credit note | |
| **Expected VAT 201** | Box 1 = 15,000 · Box 4 = 3,000 · Box 5 = 1,000 · Box 8 = 750 · Box 9 = 2,000 · Box 10 = 100 · **Box 12 = 650** |

Write the expected numbers on paper first, then make the code agree with the paper.

**Two housekeeping items this depends on:** add the `test:integration` script to `package.json` (it doesn't exist today, so Part V's gate command would fail), and remove the `RUN_DB_INTEGRATION` gate from the one existing integration test. A test that doesn't run isn't a test.

### 1.2 — One VAT engine (Week 2, days 3–5)

**Today there are three:**

| Implementation | Location | Behaviour |
|---|---|---|
| Invoice-level sum | `dashboard.routes.ts:528` `/reports/vat-summary` | Sums `invoice.vatAmount`. **Correct**, but no zero-rated split, no emirate, no GL reconciliation. This is what the Reports page uses. |
| Line-level by supply type | `reports.routes.ts:755` `/reports/vat-return` | **Wrong.** Deleted in 0.6. |
| Full VAT 201 | `vat-autopilot.service.ts` | Emirate boxes, GL reconciliation, partial exemption. **The best one — and it's on a screen users don't visit.** |

**Action:** `server/domain/vat/` becomes the only VAT code in the product. Promote the autopilot logic into it, delete the others, repoint every consumer — Reports page, VAT Filing, dashboard tile, VAT 201 generation, workpaper export, and the AI gateway.

```
server/domain/vat/
  computeVatPosition.ts     (companyId, period) → VatPosition   — the only entry point
  vat201.ts                 VatPosition → boxes 1a–1g, 2–12
  reconcile.ts              VatPosition vs GL control accounts 2020 / 1050
  types.ts
```

**Acceptance:** the fixture returns Box 12 = 650 from every consuming surface · `reconcile()` reports zero variance against the GL · a CI check asserts `grep -rn "UAE_VAT_RATE" server/ | grep -v domain/vat` returns nothing.

### 1.3 — Kill the float columns (Week 3, days 1–2)

**This is more interesting than "someone picked the wrong type," and the fix is different from what I first wrote.**

`shared/schema.ts` is **already correct** — it declares a `money` custom type at line 22 returning `numeric(15,2)`, and all money columns use it. There is nothing to fix there.

The live schema disagrees with it because **`migrations/0015_fix_monetary_types.sql` exists but is absent from `migrations/meta/_journal.json`**, so Drizzle never runs it. `0027_apply_missing_migrations.sql` re-applies most of 0015 idempotently — but **omits `vat_returns` entirely**.

Result: **63 money-ish columns are still `real` in a database built from your migrations, 56 of them in `vat_returns`** (54 box columns plus `adjustment_amount` and `payment_amount`), plus `invoices.base_currency_amount` and `corporate_tax_returns.tax_rate`.

Measured consequences (Postgres `real` = IEEE-754 single precision, ~7 significant digits): AED 9,999,999.99 reads back as 10,000,000 · AED 1,234,567.89 becomes 1,234,567.9 · summing 10,000 rows of AED 1,234.56 drifts by AED 1,055.

**And eight migrations are orphaned this way** — absent from the journal, never executed: `0009_schema_hardening`, `0015_fix_monetary_types`, `0016_add_indexes`, `0017_receipts_date_timestamp`, `0018_journal_entry_unique`, `0019_companies_soft_delete`, `0020_add_firm_leads`, `0020_invoice_contact_fk`. Note the duplicated `0015` and `0020` ordinals. **This is a fourth schema defect and belongs with 1.4.**

**Action:**

```sql
-- 0094_money_is_numeric.sql
ALTER TABLE vat_returns
  ALTER COLUMN box1a_abu_dhabi_amount TYPE numeric(15,2),
  -- ... all 56 columns
  ;
ALTER TABLE invoices
  ALTER COLUMN base_currency_amount TYPE numeric(15,2);
ALTER TABLE corporate_tax_returns
  ALTER COLUMN tax_rate TYPE numeric(6,4);
```

Separately: `invoices.exchange_rate` is **already** `numeric(15,6)` (journaled migration 0029). If you want 8-decimal FX precision that's a widening to `numeric(18,8)`, not a float rescue — decide on the merits, don't bundle it with this.

Then reconcile the journal: audit all 8 orphans, apply what's still needed as new journaled migrations, delete what's obsolete.

**Then make it unrepeatable.** Add to `npm run check`:

- `scripts/check-money-types.mjs` — fail if any column matching `/amount|total|balance|debit|credit|vat|subtotal|paid|price|salary/` has `data_type` in `('real','double precision')`
- `scripts/check-migration-journal.mjs` — fail if any `.sql` in `migrations/` is missing from `_journal.json`

**Acceptance:** both checks pass · a test stores AED 9,999,999.99 in every VAT box and reads back exactly `9999999.99` · every migration file is journaled.

### 1.4 — One schema system (Week 3, days 3–5)

**Three today:**

1. `migrations/` — 93 files, 8 of them orphaned (see 1.3)
2. `server/db.ts::ensureCriticalSchema()` — **76 `ALTER TABLE … ADD COLUMN IF NOT EXISTS` *and* 27 `CREATE TABLE IF NOT EXISTS`**, and it is invoked not only at boot (`index.ts:296`, `migrate.ts:20`) but **from a request handler** at `companies.routes.ts:36`. There is live DDL running on user traffic.
3. `server/services/month-end.service.ts:57` — a runtime `CREATE TABLE IF NOT EXISTS`

This is why `month_end_close.closing_entry_id` doesn't exist: migrations `0014` and `0073` create `closing_journal_entry_id`; the service reads and writes `closing_entry_id` (`:320`, `:328`, `:555`, `:562`, `:697`); its own guard is a no-op because the table already exists. Period lock returns 500 — which means `assertPeriodNotLocked()`, called dutifully in the invoice, payment and status paths, **can never fire**.

**Action:**

1. `ALTER TABLE month_end_close RENAME COLUMN closing_journal_entry_id TO closing_entry_id;` — guarded for both states.
2. Squash **all 103 statements** (76 ALTER + 27 CREATE) from `ensureCriticalSchema` into `0095_consolidate_schema_guard.sql`, then delete the function **and its call from `companies.routes.ts:36`**. DDL must never run on a request.
3. Delete the runtime `CREATE TABLE` from `month-end.service.ts`.
4. `scripts/check-no-runtime-ddl.mjs` — fail the build if `CREATE TABLE`, `ALTER TABLE` or `DROP` appears anywhere in `server/` outside `migrations/`.
5. CI job: migrate a blank database, dump the schema, diff against a committed `schema.snapshot.sql`. Drift becomes a red build, not a 500 in production.

**Acceptance:** locking a period succeeds · every write path into a locked period returns 423 with a clear message · no DDL outside migrations · drift check green.

### 1.5 — Customer credit, properly (Week 4, days 1–2)

Phase 0 blocked overpayment. Now model it, because customers really do overpay and really do pay two invoices with one transfer.

Confirmed absent today: any customer-deposits or advances account in the 53 seeded accounts (`server/defaultChartOfAccounts.ts`), and any `customer_credits` table anywhere in the repo.

- New account **`2060 Customer Deposits / Advances`**. Not `2050 Deferred Revenue` (`defaultChartOfAccounts.ts:259`) — under IFRS 15 that's a contract liability for an unsatisfied performance obligation, and an accidental overpayment isn't one.
- New table `customer_credits` (companyId, contactId, sourcePaymentId, amount, appliedAmount, status).
- Payment flow: ≤ balance → allocate. > balance → **require** `allowCredit: true`, allocate the balance, book the excess to 2060 with a `customer_credits` row.
- "Apply credit" affordance on any open invoice for that customer (Phase 3).
- Report: customer credit balances, tied to 2060.

**Acceptance:** overpay by 500 → invoice paid, credit of 500 exists, 2060 balance is 500 · apply it to the next invoice → 2060 goes to zero, AR reduces, trial balance still balances.

### 1.6 — VAT period discipline (Week 4, day 3)

`POST /vat-returns/generate` has no period-range validation — observed accepting **1900-01-01 → 2999-12-31** with a 201.

- Company gets `vatStagger` (monthly | quarterly) and `firstPeriodStart`, set during onboarding, mandatory.
- The API accepts a `periodId` from a generated calendar, **not** a free-text start/end pair.
- Reject periods off the calendar, ending in the future, or overlapping a submitted return.
- Fix the current-period bug: observed on 7 Aug 2026, the autopilot returned Q2 (Apr–Jun) with a due date of 28 July 2026 — already past — and reported zero VAT while the books held a live invoice. Current period = the period containing today; show prior periods separately and labelled.

**Acceptance:** the 1900–2999 request returns 422 · the current period on any date contains that date · a past due date is never presented as upcoming.

### 1.7 — Emirate correctness (Week 4, days 4–5)

Your only structural advantage over Wafeq. Don't waste it.

Today: `COALESCE(emirate, 'dubai')` at `vat-autopilot.service.ts:612`, and the code comment concedes "only the company's emirate is populated" — every supply is attributed to the company's registered emirate regardless of where it was made.

- Emirate becomes a **required** onboarding field with no default. Null → VAT 201 generation refuses with a clear message rather than guessing Dubai.
- Add `placeOfSupplyEmirate` to `customer_contacts`, defaulting to the company emirate, overridable.
- Add an optional `emirate` override on the invoice for businesses with branches.
- Box 1a–1g attributes **per invoice**: invoice → contact → company, first non-null wins.
- Show the attribution on the VAT 201 screen as a clickable breakdown, per emirate, down to the invoice.

**Acceptance:** an invoice to a Sharjah customer from a Dubai company lands in Box 1c · a company with no emirate cannot generate a return · the breakdown sums to the Box 1 total.

### 1.8 — The remaining correctness fixes (Week 4, day 5)

| Fix | Detail |
|---|---|
| Bank account 500 | `POST /companies/:id/bank-accounts` 500s on `{name}` because `bank_accounts.name_en` is `NOT NULL` (`migrations/0016`). Accept both spellings, validate with Zod, return 422 not 500. |
| TRN validation | UAE TRN = 15 digits. Validate on company and contact. Warn (don't block) on invoices ≥ AED 10,000 without a buyer TRN. |
| Confusing post endpoint | `POST /api/invoices/:id/post` is **not** always broken — `invoices.routes.ts:393-435` has a working repair path returning 200 and a 422 `CHART_OF_ACCOUNTS_MISSING` branch. The 400 fires only when there are no draft entries *and* an entry already exists or the invoice isn't issued. It's a confusing dual-purpose endpoint, not a dead one. **Rename it `/repair-journal`** and remove it from the public API docs; `PATCH /:id/status` stays the issue path. |
| Dead 410s | Delete the **five** credit-note routes calling `sendLegacyWriteDisabled` (`credit-notes.routes.ts:67`, called from `:145`, `:168`, `:191`, `:215`, `:239`). |
| Free-tier bypass | Worse than the teardown said: `maxCompanies` is **declared** in `featureGate.ts` and `stripe.service.ts` and **never read anywhere**. A free user creates unlimited companies, each with its own 20-invoice quota. Enforce quota on the owning **user**, and actually read `maxCompanies`. |
| Rate-limit tuning | A general limiter **does** exist (`middleware/security.ts:164-179`): writes 100/min, reads `RL_READ_MAX` default **3000/min**. 80 rapid reads producing no 429s is the configured behaviour, not an absence. Lower the read budget to something defensible (300/min) and alert on sustained approach. |
| CSP | `middleware/csp.ts:37` already nonces scripts in production — `unsafe-inline`/`unsafe-eval` are **dev-only**. The real remaining item is `styleSrc: 'unsafe-inline'` in **both** modes. Fix that one. |

**Phase 1 exit criteria — all must be true:**

- [ ] One VAT implementation; fixture returns Box 12 = 650 from every surface
- [ ] Zero float money columns; all 93 migrations journaled; both check scripts in CI
- [ ] One schema system; no DDL outside migrations; drift check in CI; period lock works and blocks writes
- [ ] Customer credit model live; overpayment cannot corrupt the ledger
- [ ] VAT periods validated against the company calendar
- [ ] Emirate attribution per supply, no silent Dubai default
- [ ] ≥60 integration tests green in CI on every push

---

## Phase 2 — The Great Deletion (Weeks 5–7)

> *"buried under 113 screens, 614 API routes, 33 'live' reports and nine navigation groups"*

This is the phase you actually asked for. Read it twice.

### 2.1 — Why the bloat is the root cause, not a side effect

The teardown found bugs in period locking, bank accounts, VAT reports, payments and month-end close. Those aren't five unrelated bugs. They are what happens when one person maintains 619 endpoints: **the average endpoint gets 0.16% of your attention.**

You cannot make 619 endpoints correct. You can make 180 correct. The deletion isn't housekeeping — it's the only way Phase 1's quality bar survives six months.

The second-order effect matters more: **you don't enjoy using it because it has no opinion.** 61 equally-weighted destinations means every session starts with a navigation decision instead of a task. Wafeq and FreshBooks are pleasant precisely because they refuse to do most of this.

### 2.2 — The Core 12

The only screens that survive. Each has **one job**, stated in a sentence. If you can't state it in a sentence, it doesn't ship.

| # | Screen | Its one job | Absorbs |
|---|---|---|---|
| 1 | **Today** | What needs my attention right now, in ≤5 items | Dashboard, Task Center, Notifications, Compliance Calendar, Anomaly Detection |
| 2 | **Invoices** | Create, send, and get paid for a sale | Invoices, Quotes, Credit Notes, Recurring, Invoice Templates, Payment Chasing |
| 3 | **Expenses** | Capture what I spent and reclaim the input VAT | Receipts, Receipt Autopilot, Bill Pay, Purchase Orders, Expense Claims |
| 4 | **Contacts** | Who I sell to and buy from, and what they owe | Contacts, Customer Contacts, statements |
| 5 | **Bank** | Match money that moved to entries in my books | Bank Reconciliation, Auto-Reconcile, Reconciliation Rules, Bank Statements |
| 6 | **Books** | The ledger, for when I need the truth | Chart of Accounts, Journal, Account Ledger, Journal Detail |
| 7 | **VAT** | Know what I owe the FTA and file it | VAT Filing, VAT Autopilot, Tax Return Archive, workpapers |
| 8 | **Reports** | Nine reports that answer nine questions | Reports, Advanced Reports, Analytics, Advanced Analytics, Financial Statements |
| 9 | **Close** | Lock the month so the numbers stop moving | Month End Close, period lock, Evidence Center |
| 10 | **Settings** | Company, tax, users, branding, integrations | Company Profile, Company Settings, Team, Invoice Settings, Integrations, Developer Settings, Notification Preferences |
| 11 | **Assistant** | One AI surface, one input box | **Six today:** AI Chat, AI CFO, AI Inbox, AI Features, AI Categorize, Smart Assistant |
| 12 | **Billing** | What I pay you | Subscription, Pricing, Referrals |

**Nine navigation groups become zero.** Twelve flat items. No accordions, no sub-menus. If a thing needs a sub-menu it's a tab inside its screen.

### 2.3 — The nine reports

Thirty-three reports carry `status: "live"`. The catalog's own `apiReportCount` is **structurally always 0** — it filters for `status === "api"`, a status no entry ever uses. When I probed every endpoint the Reports page depends on against a company with real data (7 Aug 2026): **25 returned data, 8 returned empty, 1 was a 404.**

Nine survive, each earning its place by answering a question an owner actually asks:

| Report | Question it answers |
|---|---|
| Profit & Loss | Am I making money? |
| Balance Sheet | What do I own and owe? |
| Cash Flow | Where did the cash go? |
| Trial Balance | Do the books balance? |
| General Ledger / Account Transactions | What happened in this account? |
| A/R Aging | Who owes me and how late are they? |
| A/P Aging | What do I owe and when? |
| VAT 201 | What do I pay the FTA? |
| Corporate Tax Estimate | What will I owe in CT? |

**Deleted:** the other 24, plus the entire **report catalog abstraction** — `reportCatalog.ts` (6,650 lines) with its personas, operating rhythms, automation health trends, next-best-actions, decision shortcuts, comparison presets and delivery subscriptions. That layer describes reports rather than producing them. `report-delivery/subscriptions` returns hardcoded objects like `"owner-weekly-executive-delivery"` — catalog fiction served as data.

Nine reports, nine endpoints, nine React components of ≤200 lines, each with an integration test asserting real numbers against the Al Noor fixture.

**`Reports.tsx` goes from 21,779 lines to under 400.**

### 2.4 — What gets deleted, precisely

**Free wins — dead code, zero risk (day 1):**

| Item | Lines |
|---|---:|
| 6 page files never imported: `Landing.tsx` (1,341), `LandingPage.tsx` (942), `WhatsAppDashboard.tsx` (1,414), `InvoiceSettings.tsx` (374), `AICategorize.tsx` (289), `Companies.tsx` (241) | **4,601** |
| 15 unused shadcn wrappers (carousel, chart, menubar, context-menu, breadcrumb, pagination, drawer, slider, navigation-menu, toggle-group, aspect-ratio, input-otp, resizable, radio-group, hover-card) | **1,667** |
| 5 unused components: `WhatsAppComposer` (262), `PricingSummary` (290), `SmartInput` (425), `InlineHelp` (261), `EmailPopup` (151) | **1,389** |
| `client/src/lib/i18n-extended.ts` — 174 keys, written, never imported; its own header says "merge into i18n.ts when ready" | **240** |
| **8** `@radix-ui/*` deps exclusive to those wrappers (`aspect-ratio`, `context-menu`, `hover-card`, `menubar`, `navigation-menu`, `radio-group`, `slider`, `toggle-group`) | — |
| `html2canvas` — imported nowhere in `client/src`; appears only in `vite.config.ts:47` `manualChunks` | — |
| | **7,897** |

**Nearly 8,000 lines and 9 dependencies gone before you make a single product decision.** Two of those files are entire alternative landing pages nobody routes to.

> **Do not delete `ClientDashboard.tsx`.** My first draft listed it as orphaned. It isn't — `Dashboard.tsx:97` imports it and `:152` renders it for `userType === "client"`. Deleting it breaks client users.

**Deferred to the archive branch — the firm product (Phase 5):**

You chose "keep both, SME ships first" *and* "hard delete to a branch." Those reconcile like this: **the firm product is not cancelled. It is archived and re-landed in Phase 5, rebuilt on the fixed core.** Shipping it from the current codebase means shipping the three-VAT-engine, float-money, broken-period-lock foundation twice.

```bash
git checkout -b archive/firm-product-v1
git push -u origin archive/firm-product-v1
git checkout main
```

| Removed from `main` | Scale |
|---|---|
| 15 route modules: `firm*.routes.ts` (8), `client-portal`, `portal`, `portal.public`, `nra`, `document-chasing`, `evidence-center`, `email-intake` | **7,807 server LOC**, ~128 endpoints |
| 10 pages in `client/src/pages/firm/` | **10,800 client LOC** |
| `client/src/pages/portal/` | **783 client LOC** |
| Client-portal, NRA and admin client-management screens | est. ~4,000 LOC |
| Sidebar groups `nra` and `admin` | **2 of 9** (there is no separate `firm` group) |

**Deferred to the archive branch — secondary features (re-land on demand):**

33 route modules, **16,545 server LOC**. Payroll, inventory, fixed assets, budgets, expense claims, purchase orders, bill pay, cost centers, WhatsApp, chasing, reminders, referrals, feedback, push, backups, integrations, analytics, report-delivery, compliance-dashboard, document-versions, reconciliation-rules, anomaly, cashflow forecast, auto-reconcile, ai-gl, corporate tax workpapers, admin.

**Two exceptions come straight back in Phase 3**, because they are real differentiators and three of your five named competitors have neither:

- **WPS SIF payroll** (`server/services/wps-sif.service.ts`) — Wafeq, QuickBooks and FreshBooks have nothing here; Zoho needs a separate paid product. Keep the generator, rebuild a minimal payroll around it.
- **Fixed assets + depreciation** — Wafeq's is straight-line-only and not linked to the bill. Yours posts properly.

Everything else stays on the branch until a paying customer asks by **name**. Then it comes back rebuilt to the Phase 1 standard, not restored.

**Deleted outright — no branch:**

- `/reports/vat-return` (Phase 0)
- Five credit-note routes returning `410 Gone`
- Duplicate figure implementations, collapsed to one each:

| Family | Today | Locations |
|---|---|---|
| VAT summary | **3** | `dashboard.routes.ts:528` · `reports.routes.ts:755` · `vat-autopilot.routes.ts:106` |
| Dashboard stats | **2** | `dashboard.routes.ts:231` · `dashboard.routes.ts:626` |
| P&L | **2 + 1 inline** | `dashboard.routes.ts:349` · `financial-statements.routes.ts:45` · **inline in `ai.routes.ts:1535`** |
| Balance sheet | **2 + 1 inline** | `dashboard.routes.ts:425` · `financial-statements.routes.ts:153` · **inline in `ai.routes.ts:1535`** |

- `ensureCriticalSchema()`'s 103 DDL statements (Phase 1)
- `reportCatalog.ts` and the report-delivery subscription fiction

### 2.5 — The arithmetic

Server-side figures are measured. Client-side reductions are **estimates** — mark them as such and update the scoreboard weekly with actuals.

| | Server LOC | Client LOC | Total |
|---|---:|---:|---:|
| Today (measured) | 75,560 | 137,299 | **219,217** |
| − dead code (measured: 7,897) | — | −7,897 | 211,320 |
| − firm/portal (server measured, client est.) | −7,807 | ~−15,000 | 188,513 |
| − secondary features (server measured, client est.) | −16,545 | ~−40,000 | 131,968 |
| − `Reports.tsx` + `reportCatalog.ts` (measured: 28,429) | — | −28,429 | 103,539 |
| − duplicate endpoints, dead services (est.) | ~−6,000 | ~−5,000 | **~92,500** |
| **Target** | **~45,000** | **~45,000** | **≤90,000** |

**Endpoints:** 619 → ~180. **Screens:** 113 routes → ~18 behind 12 nav items. **Files over 800 lines:** 66 → **0**.

### 2.6 — Sequencing

| Week | Work |
|---|---|
| 5 | Dead code (day 1) · create archive branch · remove firm/portal from `main` · re-point tests · verify green |
| 6 | Remove secondary modules · collapse duplicate figure implementations to one each (including the AI-gateway inline copy) · rebuild the sidebar to 12 flat items |
| 7 | Rebuild Reports from scratch: 9 components, 9 endpoints, 9 tests · delete `reportCatalog.ts` · full regression |

**Rule for the whole phase:** delete, run the integration suite, commit. Never delete two things before running the tests. With AI agents this is what keeps a 130,000-line deletion from becoming a two-week debugging session.

**Phase 2 exit criteria:** ≤90,000 LOC · ≤180 endpoints · 12 nav items · 9 reports all API-backed and tested · no file over 800 lines · integration suite green.

---

## Phase 3 — Make it a product people enjoy (Weeks 8–11)

You said you don't enjoy using it. Phase 2 removed the reason. This builds the replacement.

### 3.1 — The three-minute test (Week 8)

**A new user must go from signup to a sent, correct, FTA-compliant tax invoice in under three minutes**, with no documentation. Time it with a stopwatch, on a phone, on a UAE mobile connection. Every week.

Onboarding collects only what's legally load-bearing, one screen:

1. Company name · **emirate** (required, no default) · TRN (optional, validated if given) · VAT registered? · stagger
2. That's it. Chart of accounts seeds silently. Everything else deferred to first use.

Then drop them **directly into a pre-filled invoice**, not a dashboard. The first thing a business does with accounting software is bill someone.

### 3.2 — "Today" replaces the dashboard (Week 8)

Not a wall of charts. **At most five cards, each a thing to do**, each with a button:

- *3 invoices are overdue — chase them*
- *VAT Q3 is due in 21 days — review the return*
- *12 bank lines are unmatched — reconcile*
- *AED 2,400 in receipts have no VAT captured — fix*
- *Close July — lock the period*

Nothing to do → say so and get out of the way. A dashboard showing a revenue chart to an owner who already knows their revenue is decoration.

### 3.3 — Performance (Week 9)

Measured today: **2,013,794 raw bytes of JavaScript `modulepreload`ed before first paint (~602 KB at gzip −6) plus a 254,267-byte stylesheet** — including `vendor-pdf` (437,080 B) and `vendor-pdfjs` (442,230 B), **879,310 bytes of PDF libraries a first-time visitor to the marketing page will never touch**, both explicitly preloaded.

- Remove every `modulepreload` not on the first-paint critical path. PDF libraries load on demand.
- Move PDF generation server-side. You already run `pdfkit` (5 services import it) and `@pdfme/generator`. The client doesn't need `pdfjs-dist` or `jspdf`.
- Drop `html2canvas` from `package.json` — nothing in `client/src` imports it; it's only named in `vite.config.ts:47` `manualChunks`, and its 201 KB chunk is pulled in transitively by jsPDF and is **not** preloaded. Free win, but it does not reduce first paint — the 879 KB figure above is the real number.
- Purge Tailwind properly: 254 KB of CSS for 12 screens is ~10× what it should be.
- Route-level code splitting so a screen ships only its own code.

**Targets:** ≤450 KB raw / ≤140 KB gzip first paint · ≤60 KB CSS · Lighthouse ≥90 on 4G · interactive ≤2.5s.

### 3.4 — Arabic that is actually Arabic (Week 10)

`client/src/lib/i18n.ts` holds **381 English keys and 381 Arabic keys — perfectly symmetrical, zero keys present in one and missing from the other.** That is genuinely good work and worth saying.

The problem is coverage, not quality: only **44 of 102 pages** import `useTranslation`, and there are large numbers of hardcoded English strings in JSX. My conservative count was 1,004; a looser JSX-text-node heuristic gives ~4,400. **Ship the lint script first and let it define the real baseline** — the number matters less than the gate.

With 12 screens instead of 102 this is a week's work:

- `scripts/check-i18n.mjs` in `npm run check`: fail on any user-visible string literal in JSX outside a `t()` call. **This is the fix** — the gate, not the translation pass.
- Translate all 12 screens completely: UI, validation, empty states, errors, email templates, PDF invoice templates.
- Merge or delete `i18n-extended.ts` (174 orphaned keys).
- **Arabic chart of accounts.** All 53 seeded accounts already carry `nameAr`. **Zoho Books does not have this.** Surface it.
- **Bilingual tax invoices** — Arabic and English side by side on one PDF. FTA-friendly, and Wafeq doesn't document it.
- Real RTL: mirrored layout, logical CSS properties, `Cairo`/`Noto Sans Arabic` (already installed), Arabic-Indic numeral option.

**Acceptance:** switch to Arabic and complete signup → invoice → send → VAT return without seeing one English word.

### 3.5 — Mobile (Week 11)

A UAE SME owner is on a phone. Today's app is 113 desktop screens with a `MobileNav` bolted on. Twelve screens can be designed mobile-first honestly:

- Receipt capture from the camera, one tap, on the home screen
- Invoice creation that works one-handed
- "Today" as the default mobile view
- The PWA manifest already exists — make it real: offline receipt queue, non-annoying install prompt

### 3.6 — Craft pass (Week 11)

Cheap at 12 screens, impossible at 113:

- Every list has a real empty state that teaches the next action
- Every destructive action is undoable, not confirmed with a modal
- Every error says what to do next, never a code
- Optimistic updates everywhere; nothing spins for more than 200 ms
- Keyboard: `⌘K` palette, `n` for new invoice, `/` to search
- One number format, one date format, one currency component, app-wide

**Phase 3 exit criteria:** three-minute test passes · performance targets met · zero hardcoded strings, enforced by CI · Arabic end-to-end · mobile flows usable one-handed.

---

## Phase 4 — The compliance moat (Weeks 12–16)

Where you stop being a nicer accounting app and become the safe choice.

> Every fact in this section comes from the sources listed at the end. None of it can be verified from the repo. Re-verify each before you build a roadmap or a marketing claim on it — the same rule §0.2 imposes.

### 4.1 — The situation, precisely

Two separate UAE regimes, which vendors conflate constantly:

| | FTA Tax Accounting Software Register (TASR) | MoF eInvoicing Accredited Service Provider (ASP) |
|---|---|---|
| Regulator | Federal Tax Authority | **Ministry of Finance** |
| Basis | 2017 administrative guide | **Ministerial Decision 64/2025**, amended by **Ministerial Resolution 56/2026** |
| Nature | Voluntary self-declaration, AED 10,000 | **Compulsory gatekeeper** — you may not supply e-invoicing services in the UAE without it |
| Bar | A form | OpenPeppol certification · **≥2 years operating history** · UAE incorporation · ISO 27001 + 22301 · UAE data residency · AED 12.5m insurance |

**Mandate timetable:**

| Cohort | Appoint ASP by | Live |
|---|---|---|
| Voluntary pilot | — | **1 Jul 2026 — open now** |
| Revenue ≥ AED 50m | **30 Oct 2026** | 1 Jan 2027 |
| Revenue < AED 50m | **31 Mar 2027** | 1 Jul 2027 |

Penalties (Cabinet Decision 106/2025): AED 5,000/month with no ASP, AED 100 per untransmitted invoice.

**Of 42 MoF pre-approved ASPs, exactly two are mainstream accounting vendors: SAP and Tally.** Not Zoho. Not Xero. Not QuickBooks. Not Odoo. Not Wafeq. Not mazeed.

That is the whole opportunity: **nobody you compete with has solved this either.**

### 4.2 — The route in (Week 12 — start immediately, it's the long pole)

You cannot accredit directly — the two-year operating-history rule blocks you. But **MR 56/2026 Art. 5(bis) permits that experience to sit with an outsourced third party.** White-labelling through an accredited UAE ASP is the only viable route and it is available today.

Do this in Week 12, in parallel with everything else, because the signature cycle isn't yours to control:

1. Shortlist accredited ASPs from the MoF list who will white-label. Prioritise ones without their own SME accounting product — don't hand your customers to a competitor.
2. Ask for: PINT AE validation endpoint, Peppol transmission, MLR/status callbacks, sandbox, per-document pricing with volume tiers, co-marketing clause.
3. Sign by **end of Week 14**.

Your UBL 2.1 / PINT AE XML generation is already real and validates. **You are missing the pipe, not the format.** Better position than it sounds.

### 4.3 — Real e-invoicing (Weeks 13–15)

Replace the `"mock"` provider default with:

```
server/domain/einvoice/
  build.ts          Invoice → PINT AE UBL 2.1 XML   (exists, harden it)
  validate.ts       all ~50 mandatory fields, pre-submission
  transmit.ts       ASP adapter — Peppol C2→C3
  status.ts         MLR polling + webhook, per-invoice audit trail
  archive.ts        UAE-resident storage, MD 243/2025 Art. 11
```

Non-negotiables:

- **Never tell a user something was filed unless a provider acknowledged it.** Today `POST /vat-returns/:id/submit` returns 200 and flips a status flag with nothing sent anywhere. That's the most dangerous lie an accounting product can tell.
- Every invoice carries a visible transmission state: `not required · queued · transmitted · accepted · rejected`, with the rejection reason in plain language, in Arabic and English.
- Transmission failure surfaces on **Today** within the hour. AED 100 per untransmitted invoice makes silence expensive.

### 4.4 — EmaraTax filing (Week 16)

Zoho files VAT 201 directly into EmaraTax including Voluntary Disclosures. That's the feature that wins accountants — and the one your pricing page claimed Zoho didn't have.

- Investigate the EmaraTax integration path and its requirements.
- If direct filing isn't available: ship a **verified export pack** — the FTA Audit File (FAF), the VAT 201 in submission format, and a reconciliation showing return-to-GL agreement to the fils. Then say honestly: *"we prepare it, you press submit."* Honest and second-best beats a status flag that says "submitted."
- Consider TASR registration (AED 10,000, one-year validity). Voluntary, confers no ASP status, but unlocks FTA Auto-Fill and is a trust signal accountants recognise. **Wafeq's TASR entry expires this month** — a good moment to be listed while they aren't.

### 4.5 — Corporate Tax, done properly (Week 16)

Today it's a workpaper export. QuickBooks has nothing. Wafeq computes taxable income but explicitly *"not the tax amount itself."* Zoho's module has no Article 20 adjustments, no QFZP, no interest limitation, no loss carry-forward, and doesn't support Small Business Relief.

**Small Business Relief is the gap worth owning** — revenue ≤ AED 3m, elect for 0%. It affects the overwhelming majority of UAE SMEs, which is exactly your ICP, and **nobody supports it properly.**

Ship: taxable income from the ledger · SBR eligibility test and election · AED 375,000 threshold at 0% then 9% · loss carry-forward · a CT workpaper tying every figure back to a GL account.

**Phase 4 exit criteria:** ASP contract signed · invoices transmit and acknowledge for real · nothing ever says "filed" that wasn't · CT with Small Business Relief · FAF export validated.

---

## Phase 5 — Re-land the firm product (Weeks 17–24)

Now, and only now, bring back what you deferred — rebuilt on a core that works.

Accounting firms are the strongest distribution channel in this market: Wafeq has 94 partner firms, and firms buy compliance, not UX. But a firm managing 50 clients on a broken period lock is 50× the damage.

Re-land in this order, each earning its place with an integration suite:

1. **Multi-client switcher** — one login, N companies, fast switching
2. **Firm dashboard** — VAT deadlines and close status across every client, one screen
3. **Bulk VAT filing** — generate, review and transmit N returns in one pass. The firm killer feature, and only possible because Phase 1 made VAT computation single-source
4. **Client portal** — document request, upload, approve
5. **White-label** — firm branding on invoices and reports

Then rebuild `firm-command-center`, `value-ops` and `growth-opportunities` **only if firms ask**. They were built on a guess the first time.

---

## Part III — How to dominate

### The honest position

| | Muhasib after this plan | The market |
|---|---|---|
| Ledger correctness | Single-source, integration-tested | Table stakes — everyone has it |
| Emirate-level VAT 201 | **Per-supply attribution** | **Wafeq structurally cannot.** QuickBooks never tried. Zoho does it via contact only |
| Small Business Relief | **Full support** | **Nobody supports it properly** |
| WPS SIF payroll | Built in | Wafeq ✗ · QuickBooks ✗ · FreshBooks ✗ · Zoho = separate paid product |
| Arabic depth | Full UI + **Arabic CoA** + bilingual invoices | Zoho has **no Arabic chart of accounts**. QuickBooks and FreshBooks have no Arabic at all |
| E-invoicing | ASP white-label, real transmission | Only SAP and Tally are accredited |
| UAE bank feeds | **Weakest point** — CSV only | QuickBooks wins here: ADCB, DIB, ENBD, FAB, RAKBANK |

### The wedge: "the return files itself, and it's right"

Not "AI accounting." Not "all-in-one." One sentence:

> **The only UAE accounting software where the VAT 201 is correct to the emirate, reconciled to the ledger, and transmitted for real.**

Everything in Phases 1–4 serves that sentence. Everything that doesn't, isn't in the plan.

### Sequencing the market

**Months 1–4 — Be right.** Ten design partners, hand-picked, multi-emirate. Free. You do their first VAT return with them. The goal isn't revenue; it's ten businesses who will say on the record that the return was correct. That is the only asset that matters now, and it is the asset Wafeq faked with four incentivised Capterra reviews.

**Months 5–8 — Be the safe choice for the deadline.** The <AED 50m cohort must appoint an ASP by **31 March 2027**. That's your window, and it's a *compliance* purchase — fear beats features. Publish the clearest e-invoicing readiness content in the market in both languages; mazeed's own compliance page still says "Phase 1 — Q2 2026" against the real dates, which is a credibility gap you can drive through. Build a free "Am I ready?" assessment. Own the search term.

**Months 9–12 — Firms.** Land 20 firms with the bulk VAT workspace. One firm with 50 clients is worth 50 direct signups and churns less. Free for the firm, paid per client. Wafeq's 94 partner firms is the number to beat.

**Months 13–18 — Fix the bank-feed gap, or route around it.** Structural, not a backlog item. CBUAE Open Finance (Circular 7/2023, in force 10 July 2025) **bans screen-scraping**, routes everything through one licensed central API Hub, and **meters it with usage fees**. Bank data in the UAE is a COGS line, not a free PSD2-style API. Only 7 of 267 UAE banks are reachable through any aggregator; Plaid has zero UAE coverage; DIFC and ADGM are excluded.

Three options, in order:

1. **Partner with Wio** — the single most important integration partner in this market, already integrated with Zoho, Xero, Fiskl and Wafeq. Start here.
2. **Licensed aggregator** (Lean, Pay10) once business-account AIS is live — verify status before budgeting.
3. **Make CSV import excellent** — the honest interim. Wafeq positions "reconciled without live feeds" and survives. Best-in-class import with format memory, fuzzy matching and one-click rules beats a feed that breaks silently, which is Zoho's most-complained-about flank.

**Beyond the UAE — but not yet.** Saudi (ZATCA Fatoora) is the obvious second market and your Arabic and e-invoicing work transfers. **Do not touch it until 100 paying UAE customers.** Wafeq's warning is right there: 18,000 claimed customers, ~90% of volume in Saudi, and a UAE product with no emirate field. They spread and got thin. Sequence: UAE → Saudi → Bahrain/Oman/Qatar (GCC VAT is harmonised, which makes this cheaper than it looks) → Egypt/Jordan.

### What would make this fail

1. **You skip Phase 1 and go straight to deletion** because deleting is fun. You end up with a small product that's still wrong. Small and wrong is worse than big and wrong, because you'll trust it.
2. **You re-land features because they're easy, not because they're asked for.** Every restored module is a new 619.
3. **The ASP deal slips past March 2027.** Then you're selling accounting software into a compliance deadline you can't meet. **Start Week 12, not Week 16.**
4. **You market before you're right.** You already shipped a fabricated testimonial and a false competitor table. The next version of that mistake — claiming e-invoicing you don't have to a business that gets fined AED 100 per invoice — ends the company.
5. **A design partner's VAT return is wrong.** This is why Phase 1 comes first and why the Al Noor fixture exists. In UAE SME accounting, one wrong return kills you by word of mouth faster than any feature gap.

---

## Part IV — The complete issue register (33 items)

Every finding from the teardown, plus ten found while building and fact-checking this plan. Nothing dropped.

### Critical

| # | Issue | Root cause | Fix | Verified by | Phase |
|---|---|---|---|---|---|
| C1 | VAT endpoint returns wrong figure (observed 75 vs 50; 1,300 vs 1,000 standard-rated) | `reports.routes.ts:808` classifies by `vatSupplyType`, never written by the invoice API. **Correction: zero client callers** — no user sees this today | Delete the endpoint; single VAT engine in `domain/vat/` | `vat.test.ts` — Box 12 = 650 from every surface | 0.6 + 1.2 |
| C2 | **63** money columns still `real` (56 in `vat_returns`); AED 9,999,999.99 → 10,000,000 | **Not a schema.ts defect** — schema.ts is correct. `0015_fix_monetary_types.sql` is missing from `_journal.json` and never ran; `0027` re-applies it but omits `vat_returns` | Migrate to `numeric(15,2)`; journal the 8 orphaned migrations; two CI check scripts | Store/read exact fils in every box | 1.3 |
| C3 | Period lock returns 500 → `assertPeriodNotLocked` can never fire | `closing_entry_id` vs `closing_journal_entry_id`; **three schema systems**, incl. 103 DDL statements in `ensureCriticalSchema` **invoked from a request handler** | Rename column; squash and delete `ensureCriticalSchema` + its route call; drift check | Lock a period, assert every write path refused | 1.4 |
| C4 | AED 100,000 accepted on a AED 1,050 invoice → AED 99,450 to `2050 Deferred Revenue`, unrecoverable | No balance check (`storage.ts:4908`); wrong account; no customer-credit model | 422 guard now; `2060 Customer Deposits` + `customer_credits` + apply-credit | Overpay → credit → applied → TB balances | 0.7 + 1.5 |
| C5 | App does not boot from a clean checkout | `scheduler.service.ts` deleted in working tree | Commit it; clean-clone boot gate in CI | CI boot job | 0.4 |

### Marketing / legal

| # | Issue | Fix | Phase |
|---|---|---|---|
| M1 | Fabricated testimonial: named CFO, named company, quantified claim, zero customers | Delete the section (`MuhasibLanding.tsx:1338-1392`) | 0.1 |
| M2 | Pricing page claims Zoho Books has no UAE VAT, no CT, no Arabic, no e-invoicing — all false | Delete `competitorData`; future claims need a dated screenshot from the competitor's own docs | 0.2 |
| M3 | E-invoicing marketed while the provider defaults to `"mock"` | Remove the claim until Phase 4 | 0.3 |

### High

| # | Issue | Fix | Phase |
|---|---|---|---|
| H1 | Emirate defaults to Dubai via `COALESCE` (`vat-autopilot.service.ts:612`); all supplies attributed to the company emirate | Required field, no default; per-supply attribution | 1.7 |
| H2 | "Submit to FTA" is a status flag — nothing is transmitted | Never mark filed without a provider acknowledgement | 4.3 |
| H3 | E-invoicing provider defaults to `"mock"` | Real ASP adapter | 4.2–4.3 |
| H4 | VAT period 1900→2999 accepted (observed 201) | Period picker bound to the company calendar | 1.6 |
| H5 | Autopilot showed Q2 with a due date already past, on 7 Aug | Current period = period containing today | 1.6 |
| H6 | `POST /bank-accounts` 500s on `{name}` — `name_en` is NOT NULL | Zod validation, accept both, 422 not 500 | 1.8 |
| H7 | Customer TRN unvalidated (`"123"` accepted) | 15-digit validation; warn on invoices ≥ AED 10,000 without buyer TRN | 1.8 |
| H8 | Free tier bypassed by creating unlimited companies — **`maxCompanies` is declared and never read anywhere** | Enforce quota on the owning user; actually read `maxCompanies` | 1.8 |

### Medium

| # | Issue | Fix | Phase |
|---|---|---|---|
| D1 | `POST /invoices/:id/post` is a confusing dual-purpose endpoint — **not always broken**, it has a working repair path | Rename `/repair-journal`, remove from public docs | 1.8 |
| D2 | **Five** credit-note routes return `410 Gone` | Delete | 1.8 |
| D3 | Read rate-limit budget is **3000/min** — a limiter exists, it's just effectively unlimited | Lower to ~300/min; alert on sustained approach | 1.8 |
| D4 | CSP `styleSrc: 'unsafe-inline'` in **both** modes. (`scriptSrc` already nonces in production — dev-only `unsafe-*`) | Fix `styleSrc` | 1.8 |
| D5 | Dev 500s leak SQL. **Already closed on Railway at build time; no `vercel.json` exists** | Five-minute audit of any other host | 0.10 |
| D6 | 7 npm advisories (5 high) across **seven** packages incl. `pdfjs-dist` | `npm audit fix`; Dependabot; sequence with 3.3 | 0.8 |
| D7 | `tsc` OOMs on default heap (exit 134, 2.1 GB peak) — blocks `npm run check` itself | Pin `--max-old-space-size=6144` in CI | 0.9 |

### Architecture / product

| # | Issue | Fix | Phase |
|---|---|---|---|
| A1 | 219,217 LOC, 113 routes, 619 endpoints, 61 nav destinations, 9 groups | The Great Deletion → ≤90k, ≤20 routes, ≤180 endpoints, 12 nav items | 2 |
| A2 | `Reports.tsx` = 21,779 lines; `reportCatalog.ts` = 6,650; **66 files over 800 lines** | 9 reports, ≤200 lines each; delete the catalog | 2.3 |
| A3 | 33 reports "live"; `apiReportCount` is structurally always 0; 8 endpoints empty | 9 reports, all API-backed, all tested | 2.3 |
| A4 | Five reporting surfaces, **six** AI surfaces, three landing pages | One each | 2.2, 2.4 |
| A5 | 2,013,794 B JS + 254,267 B CSS before first paint; 879,310 B of PDF libs eagerly preloaded | ≤450 KB raw / ≤140 KB gzip; server-side PDF; drop `pdfjs-dist`, `jspdf`, `html2canvas` | 3.3 |
| A6 | i18n: **381/381 keys, perfectly symmetrical** — but only 44/102 pages translated, and ≥1,004 hardcoded JSX strings | CI lint gate + full translation of 12 screens + Arabic CoA + bilingual invoices | 3.4 |
| A7 | 939 unit tests, 1 gated integration test, 11 regex-over-source "tests" | ≥60 real integration tests in CI; ban source-regex tests; add `test:integration` script | 1.1 |

### Found while building and fact-checking this plan

| # | Issue | Fix | Phase |
|---|---|---|---|
| N1 | 6 page files imported nowhere (4,601 lines), incl. two complete alternative landing pages | Delete | 2.4 |
| N2 | 15 unused shadcn wrappers (1,667 lines) + **8** orphaned `@radix-ui` deps | Delete | 2.4 |
| N3 | 5 unused components (1,389 lines) | Delete | 2.4 |
| N4 | Duplicate figure implementations: 3 VAT, 2 P&L + 1 inline, 2 BS + 1 inline, 2 dashboard-stats — **the inline pair lives inside `POST /api/ai/nl-gateway`** | One each | 2.4 |
| N5 | `report-delivery/subscriptions` returns hardcoded fiction as data | Delete with the catalog | 2.3 |
| N6 | **8 orphaned migrations** absent from `_journal.json`, with duplicated `0015` and `0020` ordinals | Audit, re-journal or delete; CI check | 1.3 |
| N7 | `ensureCriticalSchema` runs **27 `CREATE TABLE`** as well as 76 ALTERs, and is called from `companies.routes.ts:36` — **live DDL on a request path** | Squash all 103; delete the route call | 1.4 |
| N8 | `client/src/lib/i18n-extended.ts` — 240 lines, 174 keys, never imported | Merge or delete | 2.4 / 3.4 |
| N9 | `html2canvas` in `package.json`, imported nowhere in `client/src` | Drop the dependency | 3.3 |
| N10 | The best VAT engine (autopilot, with GL reconciliation) is on a screen users don't visit; the weakest is on the Reports page | Single engine, surfaced everywhere | 1.2 |

**Total: 33 issues. All addressed.**

---

## Part V — Working with AI agents on this

You're solo. The plan assumes agents do most of the typing. That only works with hard gates, because an agent will happily delete something load-bearing and report success — **as one did in my own first draft, which listed `ClientDashboard.tsx` as orphaned when `Dashboard.tsx:97` imports it.** That deletion would have broken every client user. The fact-check caught it. Yours needs the same step.

**The contract for every task.** Never say "clean up the reports." Say:

> Delete `client/src/lib/reportCatalog.ts` and every import of it. The nine surviving reports are [list]. Each must call exactly one endpoint from [list]. Do not create new endpoints. Run `npm run check && npm test && npm run test:integration` — all must pass. Show me the diff stat and the test summary.

Contract = **exact files · exact scope · explicit prohibitions · a command that proves it worked.**

**The gate that makes deletion safe:**

```bash
npm run check && npm test && npm run test:integration
```

Green before every commit, non-negotiable. (`test:integration` doesn't exist yet — add it in 1.1, and remember `npm run check` runs `tsc`, so the heap pin from 0.9 is load-bearing for the gate itself.)

**One agent, one file, one commit.** Parallel agents in the same file produce conflicts costlier than writing it yourself. Parallelise across *domains* (one on VAT, one on deletion), never across files in one domain.

**Verification is always a separate agent.** The agent that wrote the code is the worst reviewer of it. Spawn a second with: *"Here is the diff. Find what broke. Do not be reassuring."* This document is the proof — the adversarial pass found 17 wrong claims in a draft I was confident about.

**Never delegate:**

- The VAT calculation logic. Read every line yourself. This is the product.
- The money-type migration. One wrong `ALTER` on live data is unrecoverable.
- Anything that decides what a user is told about their tax position.

**Weekly cadence:**

| Day | |
|---|---|
| Mon | Pick the week's phase items. Write the contracts. |
| Tue–Thu | Agents execute. You review every diff. Gate green before each commit. |
| Fri | Integration suite + the three-minute test by hand + update the scoreboard. |

---

## Part VI — The weekly scoreboard

One command, one table, every Friday. If a number goes the wrong way, that's next week's work.

```bash
npm run scoreboard
```

| Metric | Baseline | Target | Now |
|---|---:|---:|---|
| Total TypeScript LOC | 219,217 | ≤90,000 | |
| API endpoints (unique method+path) | 619 | ≤180 | |
| Client routes | 113 | ≤20 | |
| Nav destinations | 61 | 12 | |
| Largest file (lines) | 21,779 | ≤800 | |
| Files > 800 lines | 66 | 0 | |
| Reports live / API-backed | 33 / 0 | 9 / 9 | |
| Integration tests passing | 0 | ≥60 | |
| Money columns typed `real` | 63 | 0 | |
| Unjournaled migrations | 8 | 0 | |
| Duplicate figure implementations | 3 families | 0 | |
| Schema systems | 3 | 1 | |
| Pages importing `useTranslation` | 44 / 102 | 12 / 12 | |
| First-paint JS (gzip −6) | ~602 KB | ≤140 KB | |
| CSS | 254 KB | ≤60 KB | |
| Open criticals | 5 | 0 | |
| npm advisories | 7 | 0 | |
| Clean-clone boot | ✗ | ✓ | |
| Signed ASP agreement | ✗ | ✓ | |

### The 24-week shape

| Weeks | Phase | Ends with |
|---|---|---|
| 1 | Stop the bleeding | Boots clean; no indefensible claims live; overpayment blocked |
| 2–4 | Make the numbers true | One VAT engine; no floats; one schema; period lock works; 60 integration tests |
| 5–7 | The Great Deletion | ≤90k LOC · 12 screens · 9 reports · 180 endpoints |
| 8–11 | Enjoyable | 3-minute first invoice · fast · Arabic end-to-end · mobile |
| 12–16 | Compliance moat | **ASP signed** · real transmission · CT with Small Business Relief |
| 17–24 | Firms | Multi-client, bulk VAT filing, portal, white-label |

---

## Appendix A — What the fact-check changed

An independent adversarial pass over my first draft found seventeen wrong claims. All are corrected above. Recording them here because the pattern matters more than the individual errors — and because §0.2 demands the same standard of this document that it demands of your pricing page.

| # | First draft said | Actually |
|---|---|---|
| 1 | `ClientDashboard.tsx` is unimported — delete it | **It's live.** `Dashboard.tsx:97` imports it, `:152` renders it for client users. Deleting it breaks them. 6 orphaned pages / 4,601 lines, not 7 / 4,905 |
| 2 | 44 float money columns; fix `shared/schema.ts` | **63** columns (56 in `vat_returns`). `shared/schema.ts` is **already correct** — the cause is `0015_fix_monetary_types.sql` missing from `_journal.json`, plus 7 other orphaned migrations |
| 3 | Migrate `exchange_rate` from float | Already `numeric(15,6)`. Widening to `(18,8)` is a separate decision |
| 4 | Six credit-note routes return 410 | **Five** |
| 5 | 7 npm advisories, all `undici` | Seven different packages, incl. `pdfjs-dist` |
| 6 | No general API rate limit | One exists; the **read budget is 3000/min**. Tuning, not absence |
| 7 | CSP allows `unsafe-inline` + `unsafe-eval` | Production already nonces scripts; those are dev-only. `styleSrc` is the real gap |
| 8 | `POST /invoices/:id/post` always fails | It has a working repair path returning 200 |
| 9 | `/api/chasing/overdue` is a 404 with a dead caller | The route exists with `:companyId` and both callers pass it. **Claim withdrawn entirely** |
| 10 | Three sidebar groups removable | **Two** — there is no separate `firm` group |
| 11 | Five AI surfaces | **Six** |
| 12 | 614 endpoints | Not reproducible. **622 registrations, 619 unique** method+path |
| 13 | 940 passing tests, 82 files | **939 passing + 1 skipped**, 83 files |
| 14 | 40+ files over 800 lines | **66** |
| 15 | 382 i18n keys per language | **381** — and perfectly symmetrical, which is worth crediting |
| 16 | Three P&L and three balance-sheet endpoints | **Two each**, plus a third inline implementation inside `POST /api/ai/nl-gateway` — a better example of Rule 1 than the original claim |
| 17 | Verify `NODE_ENV` in Railway and Vercel configs | No `vercel.json` exists; Railway already closes it at build time |

**Also added:** `ensureCriticalSchema` runs 27 `CREATE TABLE` as well as 76 ALTERs and is called from a request handler (N7) · 8 orphaned migrations (N6) · `i18n-extended.ts` dead with 174 keys (N8) · `html2canvas` unused (N9) · `maxCompanies` declared but never read (H8) · `test:integration` script doesn't exist · `npm run check` is the command that OOMs.

**Restated as observations rather than facts:** the AED 75-vs-50 and 1,300-vs-1,000 VAT figures, the AED 99,450 overpayment, the 1900→2999 acceptance, the Q2 due-date bug, and the 25/8/1 report probe — all observed on 7 August 2026 against a local instance. The code paths behind them are confirmed statically; the numbers themselves are runtime results.

**Left imprecise on purpose:** "≥1,004 hardcoded JSX strings" — a looser heuristic gives ~4,400. Ship `check-i18n.mjs` first and let it set the baseline. The 0-target and the lint-gate remedy don't depend on the starting number.

**Not verifiable from the repo:** every regulatory and competitor claim in Phase 4 and Part III. Sources are listed below; re-verify before building a roadmap or a marketing claim on any of them.

---

### Sources for the regulatory and competitive claims

- MoF eInvoicing programme & pre-approved ASP list — https://mof.gov.ae/en/about-us/initiatives/einvoicing/pre-approved-einvoicing-service-providers/
- Ministerial Decision 64/2025 (ASP accreditation) — https://mof.gov.ae/wp-content/uploads/2025/03/Ministerial_Decision_Eligibility_and_Accreditation_procedure_for_SPs_EN.pdf
- Ministerial Resolution 56/2026 (amending MD 64/2025) — https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-56-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-64-of-2025-En-20260510.pdf
- Ministerial Resolution 66/2026 (revised mandate dates) — https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-66-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-244-of-2025-Regarding-the-Implementation-of-the-Electronic-Invoicing-System-En-20260514.pdf
- Cabinet Decision 106/2025 (e-invoicing penalties) — https://mof.gov.ae/wp-content/uploads/2025/12/Cabinet-Decision-Violations-and-Penalties-eInvoicing-final-version-en-8.12.25.pdf
- FTA accredited tax accounting software vendors — https://tax.gov.ae/en/tax.support/tax.accounting.software.vendors/accredited.tax.accounting.software.vendors.aspx
- FTA Requirements Document for Tax Accounting Software — https://tax.gov.ae/DataFolder/Files/Pdf/requirement-document-for-tax-accounting-software.pdf
- Zoho Books UAE — VAT return filing — https://www.zoho.com/ae/books/help/vat-uae/vat-return-filing.html
- Zoho Books UAE — Corporate Tax — https://www.zoho.com/ae/books/help/corporate-tax/
- Zoho Books UAE pricing — https://www.zoho.com/ae/books/pricing/
- ClearTax on Zoho's Peppol position — https://www.cleartax.com/ae/uae-e-invoicing-zoho-integration
- Wafeq pricing — https://www.wafeq.com/en-ae
- Wafeq Corporate Tax guide — https://help.wafeq.com/hc/en-ae/articles/19934722200860-Corporate-Tax-in-Wafeq-A-Practical-Guide
- mazeed pricing — https://mazeed.com/pricing/ · mazeed tax — https://mazeed.com/tax/
- QuickBooks UAE VAT — https://quickbooks.intuit.com/ae/vat-tracking/
- Tally full ASP accreditation — https://www.zawya.com/en/press-release/tally-solutions-becomes-a-fully-accredited-service-provider-by-the-uae-ministry-of-finance-410443
- Avalara on the 2026 mandate — https://www.avalara.com/blog/en/europe/2026/03/uae-e-invoicing-mandate-2026-readiness-asp-pint-ae.html

---

## The one-paragraph version

Spend a week removing what's indefensible and making the app boot. Spend three weeks making every number true — one VAT engine, no float money columns, one schema system, working period locks, sixty real integration tests. Then delete roughly 130,000 lines and 100 screens until twelve remain, each with one job. Spend a month making those twelve fast, Arabic and pleasant enough that you'd use them yourself. Then sign a white-label deal with an accredited ASP and become one of the few UAE accounting products that can legally transmit an invoice in 2027. Then, and only then, bring the firm product back.

You already built the hard part — the ledger, the tenancy, the security, the invoice numbering, the UBL generation. This plan doesn't ask you to build more. It asks you to remove everything standing in front of it, and to make the tax numbers true enough that you'd sign your own name under them.
