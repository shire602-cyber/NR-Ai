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
