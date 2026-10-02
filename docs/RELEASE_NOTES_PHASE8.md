# Release notes: Phase 8 (complete product)

Plain-language summary for the owner. Branch `launch/phase-8-complete-product`, stacked on #64. Migrations 0102-0124.
Built by a team of ten implementers, five domain leads and two product VPs; every domain went through a live
adversarial review and a fix round with regression tests.

## Sales and getting paid
- **Customer advances / retainer invoices.** An advance is a real tax invoice whose VAT is declared when the money is
  received and deducted on the final invoice; the 2055 Customer Advances account always equals the open advances.
  Advances are AED only. Refunds and credits of an advance go through the advance, never a plain credit note.
- **Sales orders.** Quote → sales order → one or more invoices and delivery notes, with available-to-promise (stock
  minus committed orders, including draft-invoiced ones) when inventory costing is on.
- **Quotes online.** A customer can accept or decline from a public link; the acceptance record (name, email, IP,
  time, consent) is kept; expired quotes close automatically; a revised quote can be signed again.
- **Discounts, shipping, price lists.** Line and document discounts, a shipping line (4035, standard-rated), price
  lists per customer. Discounts reduce the value of supply; the e-invoice XML carries them as allowances.
- **Online payment (Stripe Connect).** Each company connects its own Stripe account; Muhasib never holds customer
  money. "Pay now" on the public invoice and in the customer portal, partial payments optional, the Stripe fee posted
  through 1025 Payment Gateway Clearing. Off until the company connects; needs your Stripe Connect keys.
- **Late fees** (off by default, outside VAT), **recurring invoices auto-sent by email**, **custom fields** on contacts,
  invoices, quotes and sales orders (shown on PDFs when flagged).

## Purchases, projects and people
- **One contacts list.** Customers and vendors live in the same list with a type; bills, purchase orders and vendor
  credits now link to the vendor record (old bills were matched by name, and vendors created where none matched).
- **Vendor statements** with ageing, PDF and email.
- **Approval workflows.** Rules by amount and role (up to two steps) on bills, expense claims, purchase orders,
  payroll runs and manual journals. Nothing posts while a rule is unmet; the approval queue and history are
  audit-logged; nobody can approve their own document.
- **Projects and time.** Projects with tasks, a timer, time entries, billable expenses, invoice-from-unbilled, and
  profitability from the ledger (revenue is split by project on posting, credit notes included).
- **Leave, loans and final settlement** per Decree-Law 33/2021: leave types and balances (30 days annual, 2 days a
  month in service months 7-12, sick-leave tiers), unpaid-leave deductions in the payroll run (capped at 30 days a
  month), employee loans through 1080 with instalments capped at 20% of wage across all loans, final settlement
  posting against the gratuity provision, and a payroll register that ties to the ledger. WPS SIF now requires an
  approved run.

## Banking
- **Statement import** for CSV, OFX, MT940, CAMT.053 and PDF (text layer; an AI fallback for scanned PDFs is a
  per-company setting, off by default, on the OCR provider you already use), with a review grid and duplicate
  detection across formats.
- **Matching** with scored suggestions and bulk accept; **rules** with split lines and VAT (a rule with VAT writes a
  receipt so box 9 claims it); **reconciliation sessions** with a two-sided statement-vs-ledger report (deposits in
  transit, outstanding payments, unmatched bank lines) that reaches zero difference.
- **Bank feeds** (Lean, UAE) are built against the sandbox behind keys; nothing in the product says "live" until a
  connection exists. Needs your Lean sandbox token now and a production contract before any public claim.
- **Cash-flow forecast** from real due dates, recurring templates and payroll, with saved scenarios.
- **Fixed assets**: register and depreciation schedule reports, a choice of proceeds account on disposal.
- Fixed on the way: bank tokens were being sent to the browser; reconciliation could mark lines reconciled with
  nothing posted, post twice on re-match, or hide excess amounts; transfers between two bank accounts could never
  reconcile.

## Reports and insight
- **67 live reports** (from 33), all through one server engine: date range or as-of, comparison periods, drill-down to
  the document, Arabic PDF, CSV and XLSX, and scheduled email delivery to company members. Every balance report ties
  to the ledger (receivables = 1040, payables = 2010, advances = 2055, inventory = 1070, loans = 1080, VAT control).
- **Dashboard** figures are period-scoped and defined in `docs/KPI_DEFINITIONS.md`; the old all-time revenue and the
  payables figure built from unposted receipts are gone.
- **Firm consolidation**: consolidated P&L and balance sheet across client companies with intercompany eliminations.
- **Audit trail** now shows financial activity (journals, approvals, bills) as well as access events.
- Fixed on the way: VAT rounding now follows one rule in the return, the audit rows and the ledger; Small Business
  Relief stops for periods ending after 31 Dec 2026; a missing index made the dashboard take 23 seconds on 10,000
  invoices (now 0.3 s).

## Platform, security and experience
- **Security**: two-factor authentication (authenticator app + recovery codes), optional "require 2FA" per company
  (enforced for API keys and existing sessions too), session list and revoke, change password, new-device email.
  Fixed on the way: a refresh token was accepted as an access token; sessions were never actually stored.
- **Public API v1** with scoped keys, per-key limits, idempotency keys, cursor pagination, OpenAPI 3.1 at
  `/api/v1/openapi.json` and a docs page. Available on Professional and above.
- **Your data**: full company export as a ZIP (every company table except secrets, plus documents) and a deletion
  request with a 30-day grace period; export stays available during the grace period.
- **Migration wizard** from Zoho Books, QuickBooks, Xero or any CSV: preview, mapping, dry run, then contacts, items,
  chart and an opening position (balanced trial balance at the fiscal-year start plus open invoices and bills).
- **Help centre**: 48 articles in English and Arabic, searchable, linked from each page.
- **Mobile and accessibility**: 25 screens audited at 375 px in both languages; camera receipt capture; an
  accessibility check in `npm run check` that can only improve.
- **Performance**: every measured endpoint under 500 ms p95 on a company with 10,000 invoices.

## Decisions I made for you
| Decision | Reason |
|---|---|
| Stripe Connect per company, no platform fee | Routing customer money through Muhasib's account would make us a payment facilitator |
| API access, projects and approvals on Professional and above | Matches the plan matrix the pricing page already shows |
| 2FA available to all, off by default | Opt-in first; "require 2FA" is a company switch |
| Vendor backfill creates vendor contacts for unmatched names | Otherwise old bills never reach vendor statements |
| Mid-year opening import refused | Folding year-to-date profit into retained earnings would wipe it from the P&L and the CT computation |

## Needs you
- Stripe Connect keys (test first); Lean sandbox token, and a production contract before any "bank feeds" claim.
- Accountant: VAT on gateway fees (reverse charge?), VAT on asset disposal, 7-year CT retention vs the 5 years coded.
- Native-speaker review of the Arabic on new screens, PDFs and the 48 help articles.
- `TOKEN_ENCRYPTION_KEY` set once and never rotated (2FA secrets are encrypted with it).

## Known limitations
- Lean was exercised only against a mock; the real sandbox round trip is unverified.
- Real Stripe was exercised only through the fake adapter; the Connect OAuth round trip is unit-tested only.
- Emails (new device, export ready, scheduled reports, quote send) are tested only up to "email not configured".
- Employees can read every employee's leave balances and loans (same as existing payroll reads); restricting that is
  an owner decision.
- Recurring template lines have no discount or shipping fields.

# Phase 9 (launch gate): five blind accountants, and what they changed

Five independent accountant personas (zero code access; only the running app, the API docs and the help centre)
each ran a full quarter: a Sharjah trader with inventory, a Dubai services firm with projects and online payment, a
payroll/HR company, a banking-heavy Abu Dhabi trader with assets and a year-end, and a firm partner acting as auditor
across three client companies. Their reports are in `docs/superpowers/plans/2026-10-02-teardown6-t1..t5.md`. Before
the fixes, none would sign. Everything they found that was wrong in money, VAT or compliance is fixed with regression
tests (`tests/integration/phase9-*.test.mjs`).

## Money and VAT defects they found (all fixed)
- **Dates stored one day early.** A document dated the 1st from the date picker was stored as UTC and landed in the
  previous month's VAT return, VAT summary and audit file while the P&L used the local date. Every document date is now a
  UAE calendar day end to end (server contract: "YYYY-MM-DD" or an ISO instant converted to the UAE day).
- **Blocked input VAT (Article 53) reached box 9.** Entertainment VAT was correctly not posted to 1050 but still
  claimed on the return. One blocked-input rule now governs posting, the return, the audit rows, the autopilot and the
  workpaper.
- **Month-end "closing entries" wiped the quarter.** Month-end close moved the whole year's profit into retained
  earnings dated the month end. Month-end posts no P&L closing entries; only year-end does, and never for postings after
  its date.
- **VAT by journal.** Sales or purchases recorded by manual journal reached the return as VAT-only adjustments; the net
  amounts now reach box 1 and box 9 exactly once, and the return screen's boxes 12-14 include adjustments so the screen
  never differs from the stored return.
- **Purchase-to-stock chain.** Bills and purchase orders carry products; approving a bill with tracked products posts
  stock and debits Inventory (1070) instead of expense; receiving a PO posts goods-received-not-invoiced; movements have
  dates and can be negative; opening stock sets quantity and cost. Inventory always equals stock × average cost.
- **Depreciation.** Catch-up never posts into a closed or locked period: those months go into one labelled
  prior-period catch-up journal dated the first open day (closed years against retained earnings), nothing counted
  twice; disposal catch-up is dated the disposal date; a company owner can reopen their own closed period with a reason.
- **Payroll.** Mid-month joiners are pro-rated (30-day basis); leave and sick deductions use the full wage; the final
  settlement uses the whole gratuity provision (opening + accrued); the preparer cannot approve their own run; the WPS
  SIF uses the MOHRE layout (EDR rows then SCR) and refuses to generate without the establishment and person IDs; a
  leave-pay provision accrues monthly (5029/2037, company setting); leave balances start at zero carry-forward.
- **Reconciliation.** One receipt can settle several invoices, an overpayment can be kept as customer credit (2050),
  a bank line can be split, transfers between own accounts in different currencies reconcile on both sides, USD accounts
  reconcile in USD, and the reconciliation report never says "balanced" with unexplained items.
- **Approvals.** A rejection ends the request (document back to draft, reason visible, resubmit required); a sole
  approver may approve their own document only with an explicit acknowledgement recorded in the audit trail.
- **Corporate tax.** Small Business Relief can be elected (when eligible, periods ending on or before 31 Dec 2026),
  add-backs and deductions (entertainment 50%, fines, donations, depreciation differences, other with reason) are part
  of the computation and the workpaper; labels corrected (375,000 = 0% band; 3m = SBR threshold).
- **Audit trail** now records bill edits (with old and new values), contacts, invitations, company setup, VAT draft
  regeneration, rejections and refused actions.

## Also fixed from the teardowns
Partial credit notes with a chosen date through the screens (one real path); invoice status can no longer be set to
"Paid" by hand; a local simulated checkout page so online payment can be exercised without Stripe; refund of a payment
and of a customer credit balance; reverse charge on bills in the UI; bank account and GL account screens; bill payments
require a real bank account; "run now" for recurring invoices and late fees; tax credit notes titled and referenced per
FTA rules; customer address and TRN on tax invoices; opening-balance invoices no longer print as tax invoices; FTA
branding removed from the VAT 201; exports owner-only and scoped to the right company after a deletion request;
employees see only their own payroll records and no financial reports; Arabic calendars, statuses, account names and
server messages; 22 help articles rewritten in both languages.

## Still for the owner or an accountant
WPS SIF field widths and the bank routing code were written from the MOHRE layout as known, not verified against a
bank's file check; manual payroll deductions post to 2034 (a payroll-deductions payable) and need a policy; the gratuity
cap is unchanged (unpaid leave no longer counts as service, see below); recurring-invoice generation still posts its journal after
the invoice insert.

## Teardown 7 payroll and trader fixes
- **Unpaid leave is not service** (Decree-Law 33/2021): approved unpaid days come out of the gratuity service period
  (calculator and final settlement), take their share off the month's gratuity accrual, and reduce annual-leave
  accrual by 30/360 of a day each. Known: half-pay sick days still count as service.
- **Prior service**: gratuity (2036) and leave pay (2037) accrue month by month from the first payroll period. What an
  employee earned before is entered per employee (opening gratuity provision, opening leave days, opening leave-pay
  provision, as-of date) or booked once with "Book prior-service catch-up journal" (its own journal, Dr 3020, dated the
  run). The first run no longer books a year-to-date leave catch-up, and says which employees have no opening provisions.
- **Mid-month joiner**: inclusive calendar days over a 30-day month (15-31 Aug = 17/30), rounded once per line; the SIF row
  reports the same days.
- **Payslips** exist for calculated, pending, approved and paid runs; before approval they say "DRAFT - not yet approved".
- **Register**: employer cost columns (employer pension, gratuity, leave accrual) and a tie-out block to 5020, 2030,
  5025, 5028 and 5029 with the difference.
- **Final settlement**: a draft is recalculated on every read (it shows when) and "final settlement" is a document type in
  approval rules.
- **Opening stock** posts with the opening date inside the opening entry and as a stock movement dated that day.

## Teardown 7 (blind re-verification) and fixes

Three fresh accountants re-ran the trader, payroll and banking scenarios blind against the Phase 9 build
(`docs/superpowers/plans/2026-10-02-teardown7-v1.md`, `-v3.md`, `-v4.md`). All three confirmed the Phase 9
fixes held (COGS, advances, blocked VAT, box 9, AED reconciliation, duplicate statement detection, depreciation
catch-up, period locks; trial balances tied to their own ledgers). Trader and payroll would still not sign; banking
would sign the VAT return but not the close. Every money, VAT, compliance and access finding was fixed with a
failing test first. Migrations 0128-0130.

**Access (critical).** An employee-role member could read the whole journal, chart of accounts, bank reconciliation,
team list and activity log, and post a manual journal. Company access now refuses employee-role membership at the
single choke point (`storage.hasCompanyAccess`) unless a route opts into employee self-service (own payslips and pay
lines, own leave requests, own loans and settlements, own expense claims, notifications, company list). Everything else
returns 403 `ROLE_REQUIRED`. The client shows employees only My payroll, Leave, Loans, Expense claims, My account and
Help, and redirects finance routes with a notice; `tests/e2e/mobile-audit.mjs --employee` covers it.

**Sales and VAT.** A refund of a customer's credit balance is a payment-side event (never a second tax credit note),
refunds are voidable, and the customer credit endpoint, ageing and statement all show the same balance. Contacts and
documents carry an emirate (place of supply, company emirate by default); box 1 is split by emirate in the return,
VAT 201, Autopilot, audit rows and workpaper, and printed on the invoice PDF. Preparing or computing a return never
hits the period lock; filing posts its clearing journal on the filing date under a labelled `vat_filing` bypass; locking
a month with the VAT item open needs an explicit, audit-logged override; owners can unlock a single month with a
reason. The VAT page defaults to the last ended unfiled period, Autopilot lists no period before the VAT start, and the
ledger tie uses the return's own days. Journal reversals take a date. Invoice numbers are assigned in sequence; the
status dropdown no longer offers Paid/Partial; invoices take a currency and rate on the form; the credit-note reason
prints on the PDF.

**Inventory.** Opening stock posts on the opening date into 1070 with a movement; sale stock-outs take the invoice
date and restocks the credit-note date; vendor credits with a product move stock out (420 → 410).

**Payroll.** Payslips serve paid and posted runs (DRAFT banner on unapproved ones) and employees have a Payslips tab.
Leave accrues monthly; prior service is captured by per-employee opening provisions (gratuity, leave days, leave
provision, as-of date) and an explicit, separately labelled catch-up journal replaces the silent year-to-date catch-up.
Mid-month joiners are prorated on inclusive days over 30 (15–31 Aug = 17/30) and the SIF days match. The register has
employer-cost columns, split deductions and a tie-out block against 5020/2030/5025/5028/5029. Draft settlements
recalculate on every read and `final_settlement` is an approval document type. Unpaid leave is excluded from service for
gratuity and from annual-leave accrual. Record payment and Payroll register work inside the run detail view.

**Banking and fixed assets.** Foreign-currency receipts book at the receipt-date rate with realised FX gain/loss, so a
USD bank ledger equals its statement; bank balances can be revalued at a closing rate (one entry per account and date,
auto-reversed, treated as a rate difference by the reconciliation). Assets link to their bill or journal line and the
register ties to 1290 less 1240, with unlinked assets listed apart. Disposal depreciation runs to the disposal date
(pro rata by days in the disposal month) and disposals carry proceeds, buyer and VAT treatment, reaching box 1 by
emirate without counting as revenue. Assets acquired in a closed year register with a warning instead of failing
silently. Every bank account has a ledger account (1021+), credit cards are liability accounts, the sign-up TRN is
saved and onboarding never blanks it.

**Gate (fresh DB, full tree):** `npm run check` pass; vitest 3,504; 42 integration suites; crawl 77 routes / 0
failures; build pass; 130 migrations.

## Teardown 8 (re-verification of the Teardown 7 fixes)

The same three accountants re-ran their scenarios on the fixed build
(`docs/superpowers/plans/2026-10-02-teardown8-v{1,3,4}.md`). Every Teardown 7 finding was confirmed fixed and every
re-tied figure (VAT 201, both bank reconciliations, trial balances, P&L, balance sheet, the final settlement) matched
their own ledgers. Payroll: would sign. Banking: would sign the return, and the close on two conditions. Trader: two
items still blocked signing. All of those, plus the smaller findings, are fixed here with failing tests first.
Migration 0131.

- **Journals:** a posted journal can no longer be reversed twice (409 `ALREADY_REVERSED`, per-entry lock, reversal
  links on the API, Reverse hidden in the UI); a reversal can be voided to re-open the original; reversals take a date.
- **Voids:** voiding an invoice or credit note reverses it on the document's own date (or the first open day after a
  locked or filed period, named in the memo); a voided document leaves an unfiled return, workpaper, audit rows and the
  credit dialog; in a filed period the void shows as a negative line in the reversal month and the filed snapshot is
  untouched. "Credited", like paid and partial, is derived (400 `STATUS_DERIVED`).
- **VAT periods:** the month-end checklist accepts a draft or filed return for the quarter and asks for the override
  only when the period has ended with no return; historical periods can be marked "Filed outside Muhasib" (audit-logged,
  posts nothing) and a "VAT books start" setting trims Autopilot and the filing list.
- **Purchases and stock:** vendor credit lines take a product and show the resulting stock movement, so goods go back
  to the supplier from the screen (420 → 410).
- **Receivables:** customers with a credit balance appear as credit rows on the A/R ageing and customer balances
  screens, so the screen totals equal 1040 less 2050.
- **Payroll:** opening leave days apply to annual leave only; employee dates no longer shift a day on save; payslips
  print the payment date; the prior-service catch-up counts to the day before each employee's first run; validation
  returns field-specific codes; one register tie-out block; settlement rows in the approval queue show the net amount.
- **Banking and assets:** unrealised exchange differences post to their own account 4095 (4090/5140 stay realised);
  a bill or journal line funds one asset (409 `LINE_ALREADY_LINKED`); the register refreshes without a reload; the
  closed-year warning is an inline notice; the receipt preview shows the AED value at the receipt rate and the gain or
  loss line.
- **Platform:** the server and migrator pin the process timezone to UTC before anything loads, so DATE columns never
  shift on a non-UTC host; `/api/version` reports it.
- **Arabic:** purchase, payment, vendor-credit and receipt journal text, standard account names, receipt categories
  and the financial-year range now render in Arabic.

## Launch gate verdict (2026-10-02)

Teardown 9 (`docs/superpowers/plans/2026-10-02-teardown9-v1.md`) confirmed the trader's two remaining items fixed:
the Q3 return shows Dubai 12,835.00 / 641.75, Abu Dhabi 5,400.00 / 270.00, box 9 17,580.00 / 879.00 and box 14
32.75 payable; receivables equal the ageing; stock is 410 bags at 8,264.00 equal to account 1070. All three blind
accountants (trader, payroll, banking and year-end) would now sign their VAT returns and year-ends. Minor non-blocking
items noted for later: credit dialog and Autopilot row refresh after a void, the opening-balances wording about
Opening Balance Equity, and one "Credit Note" fragment in an Arabic cost-of-sales line. Customer advances stay AED-only.
