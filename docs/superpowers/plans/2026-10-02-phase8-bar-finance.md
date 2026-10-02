# Phase 8 — Finance bar and acceptance criteria, D1–D3 (VP Finance Product, 2026-10-02)

Covers D1–D3 of `2026-10-02-phase8-complete-product.md`. Every feasibility claim was checked against
`launch/phase-8-complete-product` (file:line cited). Competitor facts are from memory; "unsure" means unsure.
Cost first: cheapest correct route, no paid services, batch your work, consult before spending.

Codes (server/defaultChartOfAccounts.ts): 1020 Bank, 1040 AR, 1050 Input VAT, 1240 Accumulated Depreciation, 1290 Assets
at Cost, 2010 AP, 2020 Output VAT, 2030 Salaries Payable, 2034 Deductions Payable, 2036 EOS Provision, **2040 Accrued
Expenses**, 2050 Deferred Revenue, 4010 Revenue, 4040 Interest Income, 4050 Discounts Given, 4080/5130 Disposal gain/loss,
5020 Salaries, 5028 EOS Expense, 5100 Depreciation, 5110 Bank Charges. Proposed new system accounts: **1025 Payment
Gateway Clearing** (bank-type), **1080 Employee Loans**, **2055 Customer Advances**, **4035 Shipping Income**.

Tests: `tests/integration/*.test.mjs` run against `BASE_URL`+`DATABASE_URL`, print PASS/FAIL, chained in `package.json`
`test:integration`. Each AC below is one `ok()` block; ledger checks read `journal_lines`.

## D1 Sales and getting paid

### Bar

| Stream | Zoho Books | FreshBooks | Wafeq | Watin | We win when |
|---|---|---|---|---|---|
| Sales orders | SO → partial invoices; shipments need Inventory add-on | none | unsure | unsure | SO → delivery note → partial invoices, available-to-promise shown, no add-on |
| Online payment | Stripe, PayPal, PayTabs; portal pay; partial | Stripe, checkout links, auto-charge | Stripe links (unsure) | unsure | Fee and payout posted through a clearing account and matched by the feed; Arabic pay page |
| Quote acceptance | portal accept/decline | online accept, e-signature proposals | unsure | unsure | Bilingual public page, signature record, auto-expiry, one click to SO |
| Retainers | retainer invoices applied later | retainers with budgets | advance invoices (unsure) | unsure | UAE-correct VAT at receipt, advance shown on the final tax invoice and statement |
| Discounts, shipping, price lists, late fees | all four | discounts, auto late fees | discounts; rest unsure | unsure | Discount per Art. 59; late fee outside VAT scope by default |
| Custom fields | all modules, on PDF | limited | unsure | unsure | On PDF, public pages, portal; EN/AR labels |

### UAE rules and postings

| Rule (source) | Posting |
|---|---|
| Date of supply = earliest of delivery, invoice or **receipt of payment**; tax invoice within 14 days (Decree-Law 8/2017 Art. 25–26, 67) | Advance for a 5% supply, issued as an **advance tax invoice**: Dr 1020 gross / Cr 2055 net / Cr 2020 VAT; box 1 in the period of receipt |
| Final invoice deducts the advance by reference; VAT on the balance only (Art. 59 ER) | Dr 1040 balance gross, Dr 2055 advance net / Cr 4010 full net, Cr 2020 VAT on balance. Unapplied advance: credit note on the advance invoice, then existing refund flow |
| Refundable security deposit is not consideration | Dr 1020 / Cr 2055, `vatTreatment outside_scope` |
| Tax invoice content incl. **discount**, FX rate, supply date; simplified ≤ AED 10,000 (Art. 59 ER); discount reduces value of supply (Art. 28) | Dr 1040 net gross, Dr 4050 discount / Cr 4010 gross, Cr 2020 VAT on net; document discount allocated pro rata per line (mixed rates) |
| Delivery charge with goods is standard-rated | Shipping line: Cr 4035 / Cr 2020 |
| Compensatory late-payment penalties are outside scope (FTA clarification on fines and penalties; number unsure) | Dr 1040 / Cr 4040, VAT outside scope by default, company override |
| Gateway fee is a fee-based (taxable) financial service (Art. 42 ER); Stripe bills UAE merchants from a non-resident entity (unsure) → reverse charge (Art. 48) | Dr 5110 / Cr 1025; setting "gateway fee reverse charge" adds Dr 1050 / Cr 2020 at 5%. Accountant to confirm |
| Online receipt and payout | Webhook posts via `storage.recordInvoicePayment` with payment account 1025 (mandated by server/services/invoice-payment.service.ts:8-14): Dr 1025 / Cr 1040. Payout Dr 1020 / Cr 1025 matched from the feed |
| Stripe refund | Credit note, then existing customer-refund service with account 1025 (it only accepts cash/bank-type accounts) |
| Records kept 5 years (Art. 78) | Signatures, webhook events, advance invoices immutable; retention like `vendor_bills.retention_expires_at` |

### Acceptance criteria

| # | Input | Expected |
|---|---|---|
| D1-1 | Quote Q (2 lines, 5%) → `POST /quotes/:id/convert-to-sales-order` | SO-0001 `open`, totals = Q, zero journal lines |
| D1-2 | SO qty 10 of tracked product with stock 6 | `availableToPromise 6, shortfall 4`; saves; no stock movement |
| D1-3 | SO qty 10 → invoice 4 → invoice 6 → invoice 1 | `partially_invoiced` → `invoiced`; third 409 `SO_FULLY_INVOICED`; each invoice posts Dr 1040 / Cr 4010 / Cr 2020 for its own lines; delivery note PDF has no prices and `deliveredQty` ≤ ordered |
| D1-4 | Advance invoice 1,050 (1,000+5%) paid | Dr 1020 1,050 / Cr 2055 1,000 / Cr 2020 50; VAT 201 box 1 shows 1,000/50; statement shows credit 1,050. Zero-rated advance: no 2020 line, box 4 |
| D1-5 | Final invoice 3,150 applying the advance | Dr 1040 2,100, Dr 2055 1,000 / Cr 4010 3,000, Cr 2020 100; PDF line "Less advance ADV-0001"; box 1 2,000/100; applying more than open advance 422 `ADVANCE_EXCEEDED` |
| D1-6 | `POST /customer-advances/:id/refund` 1,050 | Credit note Dr 2055 1,000, Dr 2020 50 / Cr 1040 1,050; refund Dr 1040 / Cr 1020; customer's 2055 balance 0; dated in a locked month → 409 |
| D1-7 | Line discount 10% on 1,000, document discount 50, shipping 100 | subtotal 850, VAT 47.50, total 997.50; Dr 4050 150, Cr 4035 100; PDF shows discount column and delivery line; AR = total |
| D1-8 | Price list (P → 80) on customer C; new invoice for C with P | `unitPrice` defaults 80, editable; list id stored on the line |
| D1-9 | Chasing config `lateFee {percent 2, afterDays 15}`; invoice 1,000 overdue 16 days; run job twice | Exactly one line 20.00, `outside_scope`; Dr 1040 / Cr 4040; default `enabled=false` adds nothing |
| D1-10 | Recurring template with `contactId`, `autoSend true` | Run creates invoice **and** emails it (`status sent`); with `EMAIL_NOT_CONFIGURED` invoice still created, notification "not sent", template stays active |
| D1-11 | Stripe test checkout for 997.50; webhook `checkout.session.completed`, `metadata.kind=invoice` | `invoice_payments` 997.50 with `paymentAccountId` 1025; Dr 1025 / Cr 1040; fee Dr 5110 / Cr 1025; invoice `paid`; `payment.received` webhook; replaying the event id (`stripe_events`) posts nothing |
| D1-12 | Partial 500 when `allowPartialOnline` | `partial`, outstanding 497.50; amount above outstanding refused 422 at checkout creation |
| D1-13 | No `STRIPE_SECRET_KEY` | `GET /api/public/invoices/:token` → `onlinePayment.configured false`; no "Pay now"; checkout 503 `PAYMENT_NOT_CONFIGURED` |
| D1-14 | Stripe refund 200 (`charge.refunded`) | Credit note 200 + refund via 1025; idempotent on replay |
| D1-15 | `POST /quotes/:id/send` → public `GET /api/public/quotes/:token` → `accept {name,email}` | `accepted` + `quote_signatures` row (name, email, IP, UA, time); second accept 409; `decline` stores reason; past `expiryDate` → 410 and daily job sets `expired` |
| D1-16 | Custom field "PO Number" (text, `showOnPdf`) on invoices; select field | Appears on PDF, public page, portal with Arabic label; select value outside options 422 |

### Cuts and owner items

Cut: stock reservation (available-to-promise instead), PayTabs/Telr adapters (interface only), late fees on by default,
volume price tiers, saved-card auto-charge (PCI). Owner: Stripe **test** keys, gateway-fee reverse-charge view from the
accountant, 2055 vs reusing 2050.

## D2 Purchases, projects and people

### Bar

| Stream | Zoho Books | FreshBooks | Wafeq | Watin | We win when |
|---|---|---|---|---|---|
| Projects/time | projects, tasks, timer, billable expenses, profitability | core strength | none (unsure) | none | Profitability from the ledger, Arabic timesheets, no per-user fee |
| Approvals | one-step on most documents | none | expense approval (unsure) | none | Amount/role rules on bills, claims, POs, journals, payroll; nothing posts unapproved |
| Leave/EOS/loans | Zoho Payroll UAE (separate product) | none | WPS payroll; EOS unsure | unsure | Labour Law 33/2021 defaults: 30-day leave, 21/30-day gratuity, 20% loan cap, final settlement posted |
| Vendor statements | vendor balance (unsure) | none | unsure | none | Statement PDF + ageing detail mirroring the customer one |

### UAE rules and postings

| Rule (Decree-Law 33/2021) | Posting |
|---|---|
| Annual leave 30 days after one year, 2 days/month from month 6; unused leave encashed at basic on exit (Art. 29) | Leave taken: none. Encashment Dr 5020 / Cr 2030 |
| Sick leave 90 days: 15 full, 30 half, 45 unpaid (Art. 31); daily wage = basic/30 (already the convention, payroll.routes.ts:38-40) | Half/unpaid days reduce gross on the run |
| Gratuity: 21 days basic/year ≤ 5 years, 30 after, pro rata after year 1, cap 2 years' wage, paid within 14 days (Art. 51–53) | Monthly accrual **exists**: Dr 5028 / Cr 2036 (payroll.routes.ts:1042-1043). Final settlement: Dr 2036 accrued, Dr/Cr 5028 true-up / Cr 2030; pay Dr 2030 / Cr 1020 |
| Loan deductions ≤ 20% of wage, all deductions ≤ 50% (Art. 25) | Disbursement Dr 1080 / Cr 1020; run Cr 1080 per instalment (not 2034); SIF net reflects it |
| WPS: SIF through the bank within 15 days of due date (MOHRE Res. 598/2022) | Existing `generate-sif` |
| Only approved bills post (bill-posting.service.ts:137) | Rules gate the existing `approve` routes; no WIP accrual for projects, costs stay in expense accounts tagged `projectId` |

### Acceptance criteria

| # | Input | Expected |
|---|---|---|
| D2-1 | Project (customer C, rate 200/h); entries 2h, 1.5h, 0.5h non-billable; timer start/stop | `unbilledHours 3.5`, `unbilledAmount 700`; timer entry rounded to the minute |
| D2-2 | Claim item 300 and bill line 500 with `projectId`, `billable` → `POST /projects/:id/invoice` | One invoice: 2 time lines + 2 expense lines, VAT 5%, lines carry `projectId`; entries `billed`; second call 409 |
| D2-3 | Profitability report after D2-2 issued | revenue 1,500 net, costs 800, margin 700, from `journal_lines` by project |
| D2-4 | Rule: bills > 5,000 need accountant then owner | Bookkeeper approve 403 `APPROVAL_REQUIRED`; accountant → `pending_approval 2/2`; owner → `approved`, `postBillApprovalJournal` once; audit row per step; bill 4,000 approves in one step as today |
| D2-5 | Same rule type on claim, PO, manual journal, payroll run | Each existing approve route refuses without a satisfied rule; `GET /approvals?pending` lists all five; in-app + email (503 tolerated) |
| D2-6 | Employee joined 2024-01-01, basic 6,000; annual leave type | Balance 2026-09-30 = 22.5 accrued YTD (+ carry per setting); request 5 → 17.5; overlapping request 409 |
| D2-7 | Sick leave 20 days in a year | Run gross = 6,000 − 5 × 200 / 2 = 5,500 |
| D2-8 | Loan 12,000 in 6 instalments, wage 6,000 | 2,000 > 20% → 422 `DEDUCTION_CAP`; 10 instalments → Dr 1080 12,000 / Cr 1020; run Cr 1080 1,200, net and SIF 4,800 |
| D2-9 | Final settlement: expat, 3y 6m, basic 6,000, 4 unused leave days, 2036 balance 10,500 | Gratuity 200 × 21 × 3.5 = 14,700: Dr 2036 10,500, Dr 5028 4,200 / Cr 2030 14,700; leave Dr 5020 800 / Cr 2030; GCC national 0; 2-year cap enforced |
| D2-10 | Payroll register for a run | Per employee basic, allowances, deductions by type, net; totals equal the run journal |
| D2-11 | Vendor V: 3 bills, 1 credit, 1 payment; `GET /contacts/:vendorId/statement?from&to` | Running balance, closing = AP for V; ageing detail = payables ageing for V; PDF/email as customer statement |

### Cuts and owner items

**Vendor identity is a prerequisite not in the plan**: `vendor_bills` carries only `vendor_name/vendor_trn` (migrations), no
id. Add `vendor_id → customer_contacts(category='vendor')` in 0106 before statements, approvals by vendor and D4
purchases-by-vendor. Cut: approvals beyond two steps, leave pay-rule engine (maternity as a type with manual override),
leave-salary provision posting (report only), WIP accrual, cross-device live timer.

## D3 Banking, automation and assets

### Bar

| Stream | Zoho Books | FreshBooks | Wafeq | Watin | We win when |
|---|---|---|---|---|---|
| Bank feeds | Yodlee/Salt Edge, thin UAE coverage | Plaid, no UAE | Lean feeds (unsure) | none | Lean feed deduped against CSV/OFX history; "live" never claimed without a connection |
| Statement import | CSV, OFX, QIF, CAMT.053 | CSV | CSV/Excel; PDF unsure | unsure | OFX/MT940/CAMT.053 + CSV auto-detect, UAE bank presets |
| Reconciliation | suggestions, rules, reconciliation statement | basic | rules, matching | basic | Bulk accept, split rules, statement-vs-ledger report an auditor accepts |
| Fixed assets | module with disposal | none | module | none | Register and schedule reports (posting already right) |
| Cash-flow forecast | limited report | none | unsure | none | Real due dates, recurring, payroll |

### Rules and postings (verified)

| Item | Posting |
|---|---|
| Feeds post nothing; only `/match` or `/create-entry` posts (existing) | unchanged |
| Bank charges from UAE banks carry 5% VAT when invoiced | Rule may set `vatRate 5`: Dr 5110, Dr 1050 / Cr 1020 |
| Depreciation | Dr 5100 / Cr **1240** (fixed-assets.routes.ts:841-878, 967-972; depreciation.service.ts:128-135). "Cr 1040" in the inventory is false |
| Disposal **exists**: `POST /api/fixed-assets/:id/dispose` (fixed-assets.routes.ts:1187-1590) | Catch-up depreciation, Dr 1240, Dr 1020 proceeds, Cr asset cost, Cr 4080 gain / Dr 5130 loss; period lock enforced |
| Reconciliation statement | Statement closing − unreconciled credits + unreconciled debits = ledger 1020 as of date; no posting |
| FTA record keeping | Statement files kept as `stored_files` 5 years; reconciled feed rows immutable |

### Acceptance criteria

| # | Input | Expected |
|---|---|---|
| D3-1 | OFX, MT940, CAMT.053 files (3 txns each) to `/bank-statements/import`, format auto-detected | 9 `bank_transactions`, `importSource` per file, closing balance stored; malformed → 422 with line/tag |
| D3-2 | Re-upload same OFX, then CSV of the same days | 0 new, `duplicates 3`; key = bankAccountId + date + amount + normalised reference/description (+ `externalId`) |
| D3-3 | `LEAN_APP_TOKEN` unset | `GET /api/bank/providers` `[]`; UI manual only; connect 400 (open-banking.service.ts:326-331) |
| D3-4 | Sandbox token; connect → callback → `sync` twice | Rows inserted through the D3-1 path (same dedupe); `lastSyncedAt`; second sync 0; hourly job syncs `autoSync` only |
| D3-5 | Txn 997.50 dated T; invoice 997.50 due T+2; receipt 997.50 dated T−20 | `/suggestions` ranks the invoice first, confidence ≥ 80 (auto-reconcile.service.ts:127-175); `POST /bank-statements/bulk-match` posts via `recordInvoicePayment`; any item above outstanding fails the whole batch |
| D3-6 | Rule "DEWA" → split 90% 5030 / 10% 5040, VAT 5%; debit 1,050 | Dr 5030 900, Dr 5040 100, Dr 1050 50 / Cr 1020 1,050; `timesApplied` +1 |
| D3-7 | `GET /bank-statements/reconciliation-report?bankAccountId&asOf` | `statementBalance, ledgerBalance, unreconciledCredits, unreconciledDebits, difference` (0 after D3-5/6); PDF/CSV; in the catalogue (frozen-count test updated) |
| D3-8 | Stripe payout 2,990 in the feed, 1025 holds 2,990 | Suggestion proposes Dr 1020 / Cr 1025; accept → 1025 = 0 |
| D3-9 | Asset register and depreciation schedule as of date | Cost, accumulated (= posted `depreciation_schedules`), NBV; totals = 1290 − 1240; disposed assets excluded after disposal date; schedule to end of life respects salvage |
| D3-10 | Forecast 90 days: invoice 1,000 due +10d, bill 400 due +20d, recurring 500 monthly, payroll 6,000 on the 28th | Weekly buckets +1,000, −400, +500/m, −6,000/m; opening = ledger bank; "customers pay 15 days late" toggle shifts receipts |

### Cuts and owner items

Cut: PDF statements via OCR unless `local-ocr.service.ts` handles tables (cloud OCR is paid per page); forecast scenario
persistence (two toggles only); claiming Wio (keep adapter untested); dead `depreciation.service.ts` disposal function
(lines 193-260, gain/loss to the wrong account at line 209) — delete. Owner: Lean sandbox token now; Lean production is a
commercial contract with per-connection fees — decision before any "bank feeds" claim on the pricing page.

## Cross-stream dependencies and order

| Order | Item | Unblocks |
|---|---|---|
| 1 | Contacts: `vendor_id` on bills/POs/credits; `contactId`, `autoSend` on recurring templates; price-list and custom-field tables (0102, 0106) | Auto-send, price lists, custom fields, vendor statements, D4 purchases-by-vendor, D5 import |
| 2 | Line math: discounts, shipping, outside-scope lines in `document-totals.service.ts` and `vat-sales-lines.ts` | Sales orders, late fees, advance deduction, online amount due |
| 3 | Accounts 1025, 1080, 2055, 4035 in the default chart, created on demand (CT-account pattern) | Advances, online payment, loans, shipping |
| 4 | Customer advances (advance invoice, apply, refund) | Online partial/overpayment, Stripe refunds, D4 customer-deposits report |
| 5 | Custom fields → quote state machine + public page → sales orders → Stripe checkout and webhook extension | D3-8 payout matching |
| 6 | D2 schema (projects, time, billable tags, approval rules, leave, loans) → approval engine → leave → loans → final settlement → register | D4 project reports |
| 7 | D3 parsers → dedupe key → Lean sync → bulk match → split rules → reconciliation report → forecast (needs bills and payroll) → asset reports | D4 bank reconciliation and asset entries |

D4 report work on D1–D3 tables starts only after migrations 0102–0113 are frozen (end of backend wave 1).

## Corrections to the master plan

| # | Plan says | Code shows | Change to |
|---|---|---|---|
| 1 | Customer deposits liability is 2040 | 2040 = Accrued Expenses (defaultChartOfAccounts.ts:248); overpayments park in 2050 (constants.ts `DEFERRED_REVENUE`; storage.ts:5117-5141) | New 2055 Customer Advances; move the overpayment path to it |
| 2 | Verify depreciation; inventory says Cr 1040 | Credits 1240 (fixed-assets.routes.ts:843, 968; depreciation.service.ts:133) | Delete the item |
| 3 | Asset disposal missing | Exists with gain/loss (fixed-assets.routes.ts:1187-1590) | Reports and a UI check only |
| 4 | Build provider interface + Lean adapter | `BankProvider`, Wio and Lean providers, connect/callback/sync/balance routes, env-gated (open-banking.service.ts:56, 201, 315-331; bank.routes.ts:226-409; config/env.ts:91-97); Lean `getAuthUrl` is a placeholder (line 219) | "Finish Lean: Link SDK flow, customer token, sync into the import path with dedupe" |
| 5 | OFX/MT940/CAMT missing | `parseOFXStatement` exists, no caller; import takes `csvContent` only (bank-import.service.ts:112; bank-statements.routes.ts:561-595) | Wire OFX; add MT940, CAMT.053 |
| 6 | Build suggested matches with scoring | Scoring and `/suggestions` exist (auto-reconcile.service.ts:127-175); "report" is a transaction summary (bank-statements.routes.ts:1045-1115); rules have no split (schema.ts:1383-1399) | Build bulk accept, split rules, statement report only |
| 7 | Accrue EOS monthly against 2036 | Already Dr 5028 / Cr 2036 per run (payroll.routes.ts:182-206, 1042-1043); calculator at :1574 | Leave, loans, settlement, register only |
| 8 | Approval workflows new | One-step approvals exist on bills (bill-pay.routes.ts:564-615), claims, POs, payroll runs | Engine gates existing transitions; one new status `pending_approval` |
| 9 | Webhook "posts the payment" | invoice-payment.service.ts:8-14 mandates `storage.recordInvoicePayment`; Stripe webhook exists at `/api/webhooks/stripe` with raw body (index.ts:84; billing.routes.ts:254), subscription events only | Extend `handleWebhookEvent` with `metadata.kind=invoice`; post to 1025 |
| 10 | Pay now on the public invoice view | View exists: `/api/public/invoices/:token` (+`/pdf`), `shareTokenExpiresAt` (invoices.routes.ts:1356, 2216); portal is a separate surface (client-portal.routes.ts) | Same button on both |
| 11 | Quote auto-expiry job | Quotes have `expiryDate`; statuses only draft/converted (quotes.routes.ts) | State machine first |
| 12 | Vendor statements mirror customer ones | No vendor entity; statement is per `contactId` (statements.routes.ts:43) | Add `vendor_id` (0106) |
| 13 | Forecast driven by AR/AP, recurring, payroll | Loads accounts, journals, invoices, receipts, bank txns, payments (cashflow-forecast.service.ts:43); not bills, templates or payroll | Add the three inputs |
| 14 | Recurring auto-send | Daily generator, no email, no contact on template (scheduler.service.ts:208-215) | `contactId`, `autoSend`, skip-and-notify |
| 15 | Stock reservation when costing is on | No reservation concept; PO receive moves no stock (purchase-orders.routes.ts) | Available-to-promise |
| 16 | Shared schema edits for D2/D3 | `employees`, `payroll_*`, `vendor_bills`, `expense_claims`, `fixed_assets` are raw-SQL tables (migrations only) | Leads plan raw SQL, not `shared/schema.ts` |

## Summary for the CTO

1. Already built, drop from scope: depreciation to 1240, asset disposal with gain/loss, monthly EOS accrual to 2036.
2. Half built, finish rather than restart: Lean/Wio feed adapter and routes, OFX parser, match scoring.
3. 2040 is Accrued Expenses; advances need a new 2055 (overpayments sit in 2050 today).
4. Online payments post through `storage.recordInvoicePayment` into a new 1025 clearing account, fee to 5110, payout matched from the feed; extend the existing Stripe webhook.
5. Advances need an "advance tax invoice" document so VAT is declared at receipt and deducted on the final invoice (Art. 25–26, 59).
6. Vendor statements and purchases-by-vendor are blocked until bills carry a vendor id (migration 0106).
7. Payroll gaps: leave, loans with the 20% cap, final settlement posting, register; payroll tables are raw SQL.
8. Cuts: stock reservation, auto late fees by default, N-step approvals, leave provision posting, OCR PDF statements, PayTabs/Telr, saved-card auto-charge, forecast scenarios.
9. Owner: Stripe test keys, Lean sandbox token and any production contract, gateway-fee reverse-charge view from the accountant, 2055 naming.
10. Order: contacts and line math → new accounts → advances → custom fields → quotes → sales orders → Stripe → D2 engine → D3 parsers-to-report; D4 starts after 0102–0113 freeze.
