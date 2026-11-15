# Muhasib.ai — End-to-End Accountant → Reviewer → CFO Test (Codex Prompt)

> **Hand this whole file to Codex.** It runs three personas back-to-back against the live local app, then writes a structured audit. Total expected runtime: 2–4 hours.

## Mission

Simulate a full quarterly bookkeeping cycle on Muhasib.ai in **three voices**, switching cleanly between them:

1. **Sara — Senior Accountant** (8 years UAE bookkeeping). Enters every transaction.
2. **Ahmed — Internal Reviewer** (5 years audit). Reviews Sara's work line-by-line.
3. **Raj — CFO** (15+ years on QuickBooks Online + Desktop + Enterprise, one quarter on Xero). Reviews Ahmed's review **and** audits the platform against his QuickBooks standards.

Keep a single running log so any persona's work could be reproduced from your transcript.

## Environment

- **Repository:** `/Users/arahm/Desktop/NR-Ai` (branch `codex/audit-remediation-production`).
- Stack: React + Express + Drizzle + Postgres. OpenAI optional.

### Setup (run this FIRST, before Phase 1)

```bash
cd /Users/arahm/Desktop/NR-Ai
bash scripts/qa/bootstrap-e2e.sh
```

That bootstrap is idempotent and:

- Starts a containerised Postgres 16 on port 5499 (container `muhasib-e2e-pg`).
- Writes a fresh `.env` with random `SESSION_SECRET` / `JWT_SECRET`, `BCRYPT_COST=12`, `AUTO_MIGRATE_ON_BOOT=true`.
- Runs `npm ci` (if `node_modules` is missing) and `npm run db:migrate`.
- Starts `npm run dev` in the background (logs `.e2e-server.log`, PID `.e2e-server.pid`).
- Waits for `/health`.
- Registers the E2E customer **`sara@e2e.test` / `E2eTestPassword!2026`** (or logs in if it already exists), saves the JWT to `.e2e-token` and the company id to `.e2e-company-id`.

Reset everything with `bash scripts/qa/bootstrap-e2e.sh --clean`. Stop the server with `kill $(cat .e2e-server.pid)`.

### Why a customer, not an admin

This is a bookkeeping test (invoices, bills, VAT, reports). In Muhasib.ai's model, bookkeeping is the **customer** role (a SaaS tenant). The `admin` role is for the SaaS operator (NR Accounting staff) — it is **not** what these personas do. Migration `0051_revoke_test_backdoor_accounts.sql` deliberately revoked all historical seeded admin accounts, so don't try them — they're gone by design. Use the customer account the bootstrap provisions.

### Using the customer's JWT

Every API call authenticates with the JWT from `.e2e-token`:

```bash
curl -H "Authorization: Bearer $(cat .e2e-token)" \
     http://localhost:5000/api/companies/$(cat .e2e-company-id)
```

### First action in Phase 1

PATCH the bootstrap-provisioned company (default name "Sara Accountant's Company (…)") to the test fixture:

```bash
curl -X PATCH "http://localhost:5000/api/companies/$(cat .e2e-company-id)" \
  -H "Authorization: Bearer $(cat .e2e-token)" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Al Habib Trading LLC","trnVatNumber":"100123456700003","emirate":"dubai","baseCurrency":"AED","vatFilingFrequency":"Quarterly"}'
```

### Rules

- Use the real API the way a bookkeeper would (no direct SQL seeding except the bootstrap container itself).
- Confirm you're on the local DB (`localhost:5499`) before any action.
- Never click external links you didn't author.

### If a feature is broken or missing

Log it as `[BLOCKED] <symptom> <evidence>` and continue with a workaround. Do **not** route around silently.

## Test Company: Al Habib Trading LLC

| Field | Value |
|---|---|
| Legal name | Al Habib Trading LLC |
| TRN | 100123456700003 |
| Emirate | Dubai |
| Base currency | AED |
| VAT filing | Quarterly (Q1 = Jan–Mar 2026) |
| Locale | en (Arabic notes acceptable) |
| Activities | Trading + business consulting |
| Headcount | 4 (CEO, Sales, Ops, Admin) |
| Opening owner equity | AED 286,700 |

## Chart of accounts

Verify the seeded default UAE COA contains these codes; create missing ones:

| Code | Name | Notes |
|---|---|---|
| 1010 | Cash on Hand | |
| 1020 | Bank — Emirates NBD (AED) | |
| 1021 | Bank — Emirates NBD (USD) | Create if missing — currency USD |
| 1040 | Accounts Receivable | system |
| 1050 | VAT Receivable (Input VAT) | vatType `input` |
| 2010 | Accounts Payable | system |
| 2020 | VAT Payable (Output VAT) | vatType `output` |
| 3000 | Owner Equity | |
| 4010 | Product Sales / 4020 Service Revenue | system, type=income |
| 5xxx | Various expenses | |

## Customers & vendors to seed

**Customers**
- ADNOC Distribution — Abu Dhabi, has TRN, standard-rated
- DP World — Dubai, has TRN, standard-rated
- Bin Sina Foundation — Dubai, charity, zero-rated supplies
- ExportCo UK Ltd — London, no TRN, zero-rated exports

**Vendors**
- DEWA — utility, AED
- Etisalat — telecom, AED
- Shenzhen ElectroTrade Co — China, USD bills, **import of goods** (Box 6)
- LondonConsult Ltd — UK, no TRN, **reverse charge** services (Box 3/10)
- Burj Realty — landlord, rent, **exempt** (no VAT)

---

## Phase 1 — Sara enters Q1 2026 data

### Opening balances (1 Jan 2026)

One manual journal entry, posted, narrated "Opening balances 01/01/2026":

| Account | Dr | Cr | Foreign |
|---|---|---|---|
| Cash | 50,000 | | |
| Bank AED | 200,000 | | |
| Bank USD | 36,700 | | foreignDebit 10,000 USD @ 3.67 |
| Owner Equity | | 286,700 | |

### Monthly cadence (repeat each of Jan / Feb / Mar with variation)

**Sales — 4 invoices/month**
- ADNOC: AED 25,000 + 5% VAT, **Abu Dhabi** supply emirate, standard-rated
- DP World: AED 18,750 + 5% VAT, **Dubai**, standard-rated
- Bin Sina Foundation: AED 12,000, **zero-rated**
- ExportCo UK: **USD 5,000** export, zero-rated, FX 3.6725
- *Feb only:* mark January's ADNOC invoice as paid via bank
- *Mar only:* issue **one credit note** against Jan's ADNOC invoice for AED 2,000 (returns)

**Bills — 5–6/month**
- DEWA AED 1,800 + 5% VAT, standard-rated
- Etisalat AED 950 + 5% VAT, standard-rated
- **Shenzhen ElectroTrade**: USD 8,000 bill flagged as **Import of goods (Box 6)**, customs declaration `CUS-2026-0117`, customs taxable AED 30,500, import VAT AED 1,525
- **LondonConsult**: GBP 2,000 (AED 9,400) flagged as **Reverse charge (Box 3/10)**
- Burj Realty rent: AED 15,000, **exempt** (no VAT)
- One small office-supplies receipt **uploaded as a JPG via OCR**: AED 245 + 5% VAT

**Payroll (last day of each month)**
Manual journal "Payroll <Month> 2026":
- Dr Salaries Expense 78,000 (CEO 40,000 + Sales 18,000 + Ops 12,000 + Admin 8,000)
- Cr Bank AED 78,000

**Bank reconciliation (mid-month)**
- Import the matching CSV bank statement.
- Match deposits to invoice payments.
- Match payments to bills/payroll.
- Create entries for unmatched lines (e.g., bank fees AED 75 → Bank Charges expense).

### Period-end (31 Mar 2026)

- Run trial balance.
- Generate Q1 VAT-201 via the autopilot.
- Sanity-check: VAT Payable balance vs Box 8/14 to the cent.
- Period-lock Q1.

### After Phase 1, record in `01-accountant-log.md`

- Counts by transaction type.
- Approx. seconds-per-transaction by type (note UI friction).
- Final trial balance (debits = credits).
- VAT-201 Box 1–14 values.
- Every `[BLOCKED]` event.

---

## Phase 2 — Ahmed reviews

Switch personas. Pretend you have never seen Sara's work. For each of the 10 items, output `PASS / FAIL / CAUTION` + 1 line of evidence (entry number, file path, screenshot path).

1. **Trial balance balanced** to the cent.
2. **GL ↔ subledger reconciliation:**
   - AR aging total = GL 1040 balance
   - AP aging total = GL 2010 balance
   - VAT Receivable GL = sum of input VAT on posted receipts
   - VAT Payable GL = sum of output VAT on posted invoices
3. **VAT classification check** on 10 sampled transactions. Standard-rated has correct emirate; zero-rated has supporting evidence; reverse-charge populates **both Box 3 and Box 10**; imports of goods drive **Box 6 + Box 10, NOT Box 9**; exempt shows in Box 5.
4. **Bank rec discipline**: every statement line is matched OR has a created JE; no unreconciled items in the closed period.
5. **Period lock honoured**: try to post a JE dated 15 Mar after Q1 lock — must be rejected.
6. **Audit trail completeness**: pick 3 transactions; verify `createdBy`, `postedBy`, `postedAt`, `source`, `source_id`.
7. **Credit note shape**: Mar credit note nets revenue/VAT/AR correctly **and** is deduped (a second one for the same invoice is rejected).
8. **FX correctness**:
   - USD invoice posts AR in base AED with `foreign*` fields preserved
   - USD bill (Shenzhen import) used the customs AED override, not supplier subtotal × FX
   - Final FX payment on a USD invoice clears AR to **exactly zero** (no residual fils)
9. **Payroll JEs** balance and hit the right accounts.
10. **Receipt OCR**: the office-supplies receipt was captured, image stored, JE references the right expense account.

End with a 200–400 word **Review Memo** in `02-reviewer-memo.md` summarising findings, severity, and recommended re-work.

---

## Phase 3 — Raj (CFO) reviews + audits the platform

Raj reads Ahmed's memo, then independently walks through the SAME workflows. He's used QuickBooks Online + Desktop + Enterprise for 15 years and one quarter of Xero. Output goes into `03-cfo-audit-report.md`.

### A. Correctness (10 questions — answer each with evidence)

1. Does the GL satisfy the FTA identity `Box 8 − Box 11 = Box 14`?
2. Does the VAT-201 reconcile to the GL VAT control accounts to the cent?
3. Can you drill from VAT-201 Box 1a → source invoices?
4. Can you drill from a trial-balance line → source transactions?
5. Is the audit trail tamper-evident (who/when for every posted entry)?
6. Do bank balances tie to the latest statement reconciliation?
7. Are credit notes flowing through revenue, VAT, AR symmetrically?
8. Does the autopilot VAT return match a hand-calculated one for at least one period?
9. Does period locking actually block back-dated postings (probe it)?
10. Are foreign-currency invoices reportable in BOTH AED and original currency?

### B. QuickBooks-parity matrix (15 features — rate ✅ / ⚠️ / ❌; add 1-line QuickBooks-behaviour note for ⚠️/❌)

1. Memorised transactions / recurring templates
2. Class or location tracking (multi-segment reporting)
3. Customer & vendor centres (single pane: balance, history, contacts, notes)
4. Bank feeds with rules (auto-categorise repeating txns)
5. Batch enter transactions (matrix entry)
6. Multi-currency revaluation at period end
7. UAE FTA quarterly + annual reporting equivalent
8. Job costing / project profitability
9. Inventory FIFO / average + reorder points
10. Memorised reports + saved filters
11. Drill-down from any report to source doc
12. Customisable invoice + report templates (logo, footer)
13. Audit trail / change history surfaced in UI
14. Multi-user permissions + activity log
15. Printable cheques + batch bill payments

### C. Report quality grid (1–5 each on **correctness / layout / drill-down / export**)

Take a screenshot of each report and embed it in the audit report under `docs/qa/2026-06-09-e2e-test/screenshots/`.

- Profit & Loss
- Balance Sheet
- Trial Balance
- General Ledger
- VAT-201
- AR Aging
- AP Aging
- Cash Flow
- Customer Statement
- Vendor Statement

### D. Visual & UX rubric (1–5 each, with one concrete example)

- Typography hierarchy
- Spacing / density (info per screen)
- Numeric alignment in tables (right-align, monospace digits)
- Use of colour (red overdue, green paid, etc.)
- Loading states (skeletons vs spinners vs blank)
- Empty states
- Form ergonomics (tab order, keyboard shortcuts, validation messages)
- Mobile responsiveness (test at 375 px width)
- Print / PDF output fidelity
- Cross-module consistency (do all lists look the same?)

### E. The QuickBooks veteran's 10 nitpicks (`matches / different / missing`)

1. Pressing the date field opens a calendar
2. Account autocomplete on every account field
3. Numeric fields accept inline math (e.g. type `100+50`)
4. Memorised customers carry their default payment terms
5. Voiding an invoice keeps the number (doesn't reuse it)
6. Reconcile screen shows running statement balance + GL balance side by side
7. Right-click on a transaction → contextual actions
8. Undo for recent transactions
9. Reports remember their last filter set
10. Customer balance shown matches customer-aging total to the cent

### F. Verdict

Two paragraphs:
- **Adoption verdict:** would a QuickBooks-trained CFO adopt this system today? With what caveats?
- **Top 10 fixes to reach QuickBooks parity**, prioritised, with effort estimates (S / M / L).

---

## Deliverables

Write to `docs/qa/2026-06-09-e2e-test/` in the worktree:

1. `01-accountant-log.md` — Sara's transaction log: every entry with timestamp, screen, fields filled, error/result. Source of truth for reproduction.
2. `02-reviewer-memo.md` — Ahmed's 10-point checklist + 200–400 word memo.
3. `03-cfo-audit-report.md` — Raj's full audit:
   - Executive summary (1 page)
   - Correctness findings (10 questions answered)
   - QuickBooks parity matrix (15 features)
   - Report quality grid
   - Visual / UX rubric
   - 10 nitpicks
   - Verdict + top-10 fixes
4. `screenshots/` — one image per report and one per visual finding.

---

## Rules of engagement

- If the system rejects a legitimate entry, capture the request/response, screenshot the UI, then either work around or escalate as `[BLOCKED]`.
- Use real API calls (no mocks). Authenticate as a real customer user.
- No direct SQL seeding — go through the API end-to-end.
- When you need a judgement call (e.g., which account to debit), choose the standard QuickBooks/UAE answer and note your reasoning.
- Never modify production data. Confirm the dev DB URL before each phase.

## Begin

Start with the environment check, then enter Sara. Output a one-line status update every ~10 transactions so progress stays visible.
