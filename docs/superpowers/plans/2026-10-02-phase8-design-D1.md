# Phase 8 — D1 design: Sales and getting paid (lead L1, 2026-10-02)

S1 backend, S2 frontend; migrations 0102–0105; binding: CTO decisions, VP bar D1-1..16.
Cost first: cheapest correct route, no paid services, batch your work, consult before spending.

## 1. Scope

Delivered: line model (discounts, shipping, advance deduction, late fees); customer advances (VAT at receipt); custom fields; price lists; quote acceptance; sales orders with available-to-promise (ATP) and delivery notes; online payment (provider interface, Stripe adapter); late fees (off by default); recurring auto-send.

Cut:
- **Stock reservation** (CTO); ATP shown instead.
- **Foreign-currency advances** (422 `ADVANCE_CURRENCY_UNSUPPORTED`): the deducted advance must post at the advance's rate (IAS 21/IFRIC 22), but invoices post at one rate.
- **Partial credit notes on invoices carrying an advance** (422 `ADVANCE_APPLIED_PARTIAL_CREDIT`); full credit or void still works.
- **Gateway-fee reverse charge:** journal-only VAT lines never reach the VAT 201, which reads documents (vat-period-documents.service.ts:65).
- In-app refunds (Stripe-dashboard refunds are reflected), disputes (notification only), saved cards, PayTabs/Telr (interface only), volume tiers, repeat late fees, drawn signatures, bill custom-field UI (D2's page; the API supports bills).

## 2. Data

### Line model
Every VAT engine computes `quantity × unit_price` per line (vat-sales-lines.ts:40, vat-autopilot.service.ts:349, firm-vat-workspace.service.ts:969, revenue-allocation.service.ts:58). Adjustments are therefore stored as **server-derived signed lines** that the engines net unchanged. Clients send item and shipping lines plus discount inputs; the server rebuilds derived lines on each draft save. Pure math: `shared/sales-line-math.ts`, shared by server and client.

| kind | Source | Amount | VAT | Account |
|---|---|---|---|---|
| `item` | client | qty × price | entered | entered/default |
| `discount` child (`parent_line_id`) | server, from parent `discount_type/value` (percent 0–100 or amount ≤ line gross, else 422 `DISCOUNT_EXCEEDS_LINE`) | −amount | parent's | 4050 |
| `discount` document | server, one per (rate, supply-type) bucket, pro rata on item net after line discounts, residual to largest; ≤ item net else 422 `DISCOUNT_EXCEEDS_SUBTOTAL` | −amount | bucket's | 4050 |
| `shipping` (max 1) | client | amount | default dominant item rate | 4035 |
| `advance` | server, from an application | −net | advance's | 2055 |
| `late_fee` | job | fee | `out_of_scope` default | 4040 |

`subtotal` stays "taxable net of all lines" (posting reads it, invoice-posting.service.ts:97); responses add `itemsSubtotal`, `discountAmount`, `shippingAmount`. **Correction to D1-7:** subtotal 950, itemsSubtotal 850; VAT 47.50 and total 997.50 unchanged.

### 0102_sales_lines_and_advances.sql
Idempotent: `IF NOT EXISTS`; constraints inside `DO $$ … EXCEPTION WHEN duplicate_object`.

- `invoice_lines`, `quote_lines`: `line_kind` (default `item`, CHECK), `parent_line_id` (self FK, cascade), `discount_type`, `discount_value numeric(15,6)`, `sort_order` (reads `ORDER BY sort_order, id`; storage.ts:2261/3087 are unordered today); `invoice_lines.customer_advance_id`.
- `invoices`, `quotes`: `discount_type`, `discount_value`, `discount_amount`, `shipping_amount` (numeric(15,2) default 0). `invoices.late_fee_for_invoice_id` (FK RESTRICT) with a partial UNIQUE index: one late fee per invoice, ever.
- New `invoice_type` values `advance` and `late_fee`. No DB constraint exists, and all 21 files that filter it test `= 'credit_note'`, so AR, ageing, statements and VAT include both.
- `customer_advances`: `company_id` (NOT NULL), `contact_id` (NOT NULL), `number` ADV- (unique per company), `kind` (`advance|deposit`), `invoice_id` (UNIQUE, the advance tax invoice), `sales_order_id`, `currency` (CHECK 'AED'), `vat_rate`, `vat_supply_type`, net/VAT/gross, `status` (`open|applied|refunded|void`); index `(company_id, contact_id, status)`.
- `customer_advance_applications`: `company_id`, `advance_id`, `kind` (`application|refund`), `invoice_id` (final invoice or credit note), `invoice_line_id`, `net_amount > 0`, `vat_amount`, `status` (`pending|active|reversed`).

No SQL account inserts: 1025, 2055, 4035 go into `defaultChartOfAccounts.ts` and are created on demand by `ensureSystemAccount` (inventory-costing.service.ts:99, which S1 exports; D2 reuses it for 1080). 4050, 4040 and 5110 are ensured the same way.

### 0103_custom_fields_price_lists_settings.sql
- `custom_field_definitions`: `company_id`, `entity` (`contact|invoice|quote|bill|sales_order`), `key` (`^[a-z][a-z0-9_]{0,39}$`), `label_en`, `label_ar`, `field_type` (`text|number|date|select`), `options jsonb` (≤ 50), `show_on_pdf`, `sort_order`, `is_archived`; UNIQUE `(company_id, entity, key)`; ≤ 30 active per entity.
- `custom_field_values`: `company_id`, `entity`, `record_id` (polymorphic, so every read joins `company_id`), `definition_id`, `value`; UNIQUE `(definition_id, record_id)`.
- `price_lists` (`name` unique per company, `currency`, `is_active`), `price_list_items` (`unit_price > 0`, UNIQUE `(price_list_id, product_id)`); `price_list_id` on `customer_contacts`, `invoice_lines`, `quote_lines`.
- `recurring_invoices`: `contact_id`, `auto_send` (false), `payment_terms_days`, `last_send_status`, `last_send_error`.
- `chase_configs`: `late_fee_enabled` (**false**), `late_fee_type` (`percent|fixed`), `late_fee_value`, `late_fee_after_days` (15), `late_fee_vat_treatment` (`out_of_scope`).

### 0104_sales_orders_quote_acceptance.sql
- `quotes`: `share_token` (unique), `share_token_expires_at`, `sent_at`, `accepted_at`, `declined_at`, `converted_sales_order_id`.
- `quote_signatures`: `company_id`, `quote_id` **UNIQUE**, `action`, signer name/email, `ip`, `user_agent`, `reason`, `quote_hash` (sha256 of totals + lines), `signed_at`, `retention_expires_at` (+5 years).
- `sales_orders` (`number` SO-, `contact_id` NOT NULL, `quote_id`, dates, currency/rate, discounts, totals, `status` `open|closed|cancelled`), `sales_order_lines` (same line model, percent discounts only), `sales_order_deliveries` (DN-), `sales_order_delivery_lines` (`quantity > 0`); indexed `invoices.sales_order_id`, `invoice_lines.sales_order_line_id`.
- Invoiced and delivered quantities are **derived** (Σ over invoices not void/cancelled), so a void releases quantity by itself.

### 0105_online_payments.sql
- `payment_gateway_connections` (D1-internal addition): `company_id`, `provider`, `external_account_id` (`acct_…`, unique), `status` (`pending|active|revoked`), `livemode`, `state_hash`, `allow_partial` (false), `enabled`; UNIQUE `(company_id, provider)`.
- `payment_links`: `invoice_id`, `provider_session_id` (UNIQUE), `amount`, `currency`, `status`, `url`, `created_via`, `expires_at`.
- `gateway_payments`: `invoice_id`, `payment_link_id`, `provider_payment_id` (UNIQUE per provider), `provider_charge_id`, `amount`, `currency`, `exchange_rate`, `fee_aed`, `status` (`received|payment_posted|settled|unallocated`), `invoice_payment_id`, `fee_journal_entry_id`, `refunded_amount`.
- `gateway_refunds`: `provider_refund_id` (UNIQUE), `amount`, `credit_note_id`, `customer_refund_id`, `status`.
- `UNIQUE INDEX uq_invoice_payments_gateway_ref ON invoice_payments(company_id, reference) WHERE method = 'gateway'` (a new method value, so no existing row collides).

Every new table carries `company_id`. All of the above also go into `shared/schema.ts` (anchored Edits) and `migrations/meta/_journal.json`.

## 3. Posting rules

Posting goes only through existing services: `postInvoiceRevenueJournal` (source `invoice`), `storage.recordInvoicePayment` (`payment`), the credit-note path, `createRefund` (`customer_refund`). One new source, `gateway_fee`, gets an undo hint in `UNDO_HINTS` (journal-entry-protection.ts:17); non-manual sources are already read-only.

Locks: every posting date passes `assertPeriodNotLocked` (403, period-lock.service.ts:38), plus `lockAndCheckMonth` inside transactions. VAT filing locks its months (vat-filing.service.ts:225-234), so this covers the filing lock too.

Engine fixes (test-first): `buildRevenueCreditLines` (revenue-allocation.service.ts:98-108) drops groups ≤ 0, which would unbalance the entry, so negative groups must become **debits**. `remainingByAccount` (credit-note-remainder.service.ts:84-88) keeps only net > 0 and must carry contra groups, so a remainder credit mirrors discount and advance lines.

| Event | Journal (date) |
|---|---|
| Invoice with D1-7 lines | Dr 1040 997.50, Dr 4050 150 / Cr 4010 1,000, Cr 4035 100, Cr 2020 47.50 (invoice date) |
| Advance tax invoice issued (`advance`, line → 2055) | Dr 1040 1,050 / Cr 2055 1,000, Cr 2020 50. Zero-rated: no 2020. Deposit: `out_of_scope` (issue/receipt date) |
| Advance received (same call when `receive` is given) | `recordInvoicePayment`: Dr 1020 / Cr 1040 1,050 |
| Final invoice with an advance line | Dr 1040 2,100, Dr 2055 1,000 / Cr 4010 3,000, Cr 2020 100 |
| Advance refund | Credit note on the advance invoice: Dr 2055 1,000, Dr 2020 50 / Cr 1040 1,050; then `createRefund`: Dr 1040 / Cr bank |
| Late fee (`late_fee` invoice) | Dr 1040 20 / Cr 4040 20. A standard-rated override adds Cr 2020 |
| Online receipt | `recordInvoicePayment` with 1025, `method 'gateway'`, `reference pi_…`, `allowCredit: true`: Dr 1025 / Cr 1040; excess → 2050. Foreign invoice: `paymentExchangeRate` = settled AED ÷ charge, realised FX as today |
| Gateway fee | Separate journal `gateway_fee`: Dr 5110 / Cr 1025, fee in AED from `balance_transaction.fee` (payment date) |
| Stripe refund | Credit note (gross split per VAT bucket, `splitGrossRefund`), then `createRefund` from 1025 (a cash/bank code per financial-statements.ts:88): Dr 1040 / Cr 1025 |
| Payout | D3 posts Dr 1020 / Cr 1025 |

Deviations from the VP: (1) the advance passes through 1040, netting to the VP's Dr 1020 / Cr 2055 / Cr 2020 while reusing issue, payment, Pay now, VAT and statements (tests assert account deltas); (2) payment and fee are two journals, because settlement is mandated through `recordInvoicePayment` (invoice-payment.service.ts:8-14); (3) overpayments stay in 2050 (storage.ts:5139-5160), since 2055 must tie to the advances subledger and an overpayment has no VAT document.

Void: `reverseToZero` (unchanged) reinstates 2055, then `invoice-void.service` marks the invoice's applications `reversed`. A voided late fee is never recreated.

## 4. State machines and invariants

**Quote:** `draft → sent` (mints token) → `accepted | declined | expired`; `sent/declined/expired → draft` (revise, revokes token); `draft/sent/accepted → converted`.
- `PUT /api/quotes/:id` accepts `status` from the body today (quotes.routes.ts:162-197): strip it; 409 `QUOTE_NOT_EDITABLE` unless draft. Delete only draft/declined/expired (signatures kept 5 years).
- Convert under `withDocumentLock(quoteId, LOCK_NS.QUOTE)` (new namespaces in document-lock.ts:74: QUOTE 1005, GATEWAY 1006) with a compare-and-swap status update in the same transaction as the target insert. Today's convert (236-330) is not atomic and drops `contactId`; fix both.
- Accept/decline: one transaction, `FOR UPDATE`, must be `sent` (else 409 `QUOTE_NOT_OPEN`), expired → 410; the UNIQUE signature row backstops races. Daily job expires `sent` quotes with `expiry_date < uaeTodayYmd()`.

**Sales order:** `open → closed` (short-close) or `cancelled` (nothing invoiced/delivered); `invoicingStatus`/`deliveryStatus` derived; edits after invoicing or delivery → 409 `SO_LOCKED`.
- Invoicing locks the SO row and recomputes the remainder: 409 `SO_FULLY_INVOICED`, 422 `SO_QTY_EXCEEDED`, else a draft invoice in the same transaction. `PUT` on an SO-linked draft takes `INVOICE_POSTING`, then the SO row, and re-checks; `salesOrderLineId` must belong to that invoice's SO.
- Deliveries: delivered ≤ ordered (422 `DELIVERY_EXCEEDS_ORDERED`); post nothing (stock moves at invoice issue, as today).
- ATP = `current_stock` − remaining qty on other open SOs (tracked products); `shortfall = max(0, remaining − ATP)`. Quote amount discounts become 6-dp percents; differing totals → 422 `DISCOUNT_CONVERSION_ROUNDING`.

**Advance:** `available = net − active applications − active/pending refunds`.
- Apply (draft only): `withDocumentLock(invoiceId, LOCK_NS.INVOICE_POSTING)` (the issue path's lock), then advance row `FOR UPDATE` (order always invoice → advance); same contact, AED, advance invoice issued, ≤ available (422 `ADVANCE_EXCEEDED`), ≤ item net at that rate (422 `ADVANCE_EXCEEDS_INVOICE`); insert application + line, recompute totals.
- Refund without nested locks: `pending` reservation under the advance row lock → credit note + refund → `active` (deleted on failure).
- **Invariant:** GL 2055 = Σ unapplied, unrefunded advance net, per company.

**Gateway payment:** `received → payment_posted → settled | unallocated`, each step under `runExclusive` + `FOR UPDATE`. After a crash before linking, the retry hits the unique reference and links the existing payment. Fee unavailable → throw after step 1 so the claim is released (stripe.service.ts:252-258) and the retry resumes. Paid/void invoice → `unallocated`, owner notified.

**Late fee:** no chasing job exists (`autoChaseEnabled` is stored but never read, chasing.routes.ts:133), so a new daily job (06:30 UTC) runs for enabled companies over issued `invoice`-type documents, not opening balances, with outstanding > 0 and `due_date + afterDays` < today. Fee = round(outstanding × %, 2) or fixed; a unique-index conflict means skip.

**Recurring:** after the existing post (scheduler.service.ts:747-770), `auto_send` mints a share token, renders the PDF, calls `sendInvoiceEmail`; on failure `last_send_status='not_sent'` + notification, template stays active, no resend. Generated invoices now get `contact_id` and `due_date`.

## 5. API contract

New company routes use `authMiddleware, requireCustomer, requireCompanyAccess("params")`; existing `/api/quotes/:id` and `/api/invoices/:id` actions resolve the document, then `hasCompanyAccess`. Every query includes `company_id`. Codes: 422 business rule (with `code`), 409 state conflict, 403 access/period lock/owner-only, 404 not found (including another tenant's ids), 410 expired token. Inputs are zod: money > 0 and ≤ 9e12, dates `YYYY-MM-DD`.

**Changes to existing routes:**

| Route | Change |
|---|---|
| POST/PUT invoices (invoices.routes.ts:396, 643) | Lines gain `lineKind ∈ {item, shipping}`, `discountType/Value`, `priceListId`, `salesOrderLineId`; documents gain `discountType/Value`. **Fix mass assignment:** `...invoiceData` is spread into the insert (513, 763); allow-list it so `invoiceType`, `status`, `salesOrderId` and `lateFeeForInvoiceId` cannot be set by clients |
| POST/PUT quotes (quotes.routes.ts:94, 154) | Same line fields; 409 `QUOTE_NOT_EDITABLE` |
| GET `/api/public/invoices/:token` (invoices.routes.ts:1356) | Adds `outstanding`, line kinds, custom fields (`show_on_pdf`), advances, `onlinePayment {configured, allowPartial}` |
| Contacts PUT (contacts.routes.ts:345) | `priceListId`, checked against the company |
| PATCH `/api/chasing/config/:companyId` (chasing.routes.ts:647) | `lateFee {enabled, type, value, afterDays, vatTreatment}` |
| Recurring (recurring-invoices.routes.ts:96, 175) | `contactId`, `autoSend`, `paymentTermsDays`; 422 `CONTACT_EMAIL_REQUIRED` |
| Statement (statements.routes.ts:77) | `unappliedAdvances[]`. **Correction to D1-4:** shown as a memo, not as a credit on the AR balance |
| POST `/api/webhooks/stripe` (billing.routes.ts:253) | Verify with `STRIPE_WEBHOOK_SECRET`, then `STRIPE_CONNECT_WEBHOOK_SECRET`. Connect events (`event.account`) go to `payment-gateway/webhook.service` (`checkout.session.completed`/`.expired`, `charge.refunded`, `account.application.deauthorized`). **Post only when** our `payment_links` row has this `session.id`, its company owns `event.account`, and the invoice matches; forged metadata posts nothing |

**New routes:**

| Route | Contract |
|---|---|
| POST `/api/quotes/:id/send` `{email?, message?}` | `{quote, shareUrl, emailed, emailError?}`; 409 `QUOTE_NOT_DRAFT` |
| POST `/api/quotes/:id/revise`; GET `/api/quotes/:id/signature`; POST `/api/quotes/:id/convert-to-sales-order` | 201 SO; 409 `QUOTE_ALREADY_CONVERTED` |
| GET `/api/public/quotes/:token` (+`/pdf`); POST `…/accept` `{name, email, agree: true}`; POST `…/decline` `{name, email, reason}` | 404, 409, 410. Added to `PUBLIC_CSRF_PROTECTED` (csrf.ts:33) plus a `publicAction` limiter (20 per 15 min per IP) |
| `/api/companies/:companyId/sales-orders` GET/POST; `/:id` GET/PUT/DELETE; POST `/:id/close`, `/:id/cancel` | Lines carry `invoicedQty`, `deliveredQty`, `availableToPromise`, `shortfall` |
| POST `…/sales-orders/:id/invoices` `{date?, lines: [{salesOrderLineId, quantity}]}`; POST `…/:id/deliveries`; GET `…/deliveries/:deliveryId/pdf`; GET `…/:id/pdf` | Errors as in §4 |
| GET `/api/companies/:companyId/products/availability?ids=` | `[{productId, onHand, committed, available}]` |
| `/api/companies/:companyId/customer-advances` GET/POST; `/:id` GET | POST `{contactId, date, amount (gross), vatRate 0/0.05, kind, description, salesOrderId?, receive?: {paymentAccountId, method, reference}}` → 201 `{advance, invoice, payment?, paymentError?}` |
| POST `…/customer-advances/:id/refund` `{amount, date, bankAccountId}` | `{creditNote, refund}`; 422 `ADVANCE_EXCEEDED`; 403 locked period. **Correction to D1-6:** 403, not 409 |
| POST `/api/invoices/:id/advance-applications` `{advanceId, amount}`; DELETE `…/:applicationId` | 409 `INVOICE_NOT_DRAFT`; 422 codes as in §4 |
| `/api/companies/:companyId/custom-fields?entity=` CRUD (delete archives when values exist); GET/PUT `…/custom-fields/values/:entity/:recordId` | 422 `CUSTOM_FIELD_INVALID`; 409 `DOCUMENT_LOCKED` (issued invoice); 404 cross-tenant record |
| `/api/companies/:companyId/price-lists` CRUD; GET `…/resolve?contactId&currency` | `{priceListId, prices}` |
| GET/PATCH `/api/companies/:companyId/payment-gateway[/settings]`; POST `…/stripe/connect` → `{url}`; DELETE `…/stripe` | **Owner only** via `storage.getUserRole` (team.routes.ts:39); otherwise 403 `OWNER_ONLY` |
| GET `/api/payment-gateway/stripe/callback` | HMAC-signed state, 10-minute expiry |
| POST `/api/public/invoices/:token/checkout` `{amount?}`; POST `/api/portal/:token/invoices/:invoiceId/checkout` | `{url}`; 503 `PAYMENT_NOT_CONFIGURED`; 409 `INVOICE_NOT_PAYABLE`; 422 `AMOUNT_EXCEEDS_OUTSTANDING` / `PARTIAL_NOT_ALLOWED` / `AMOUNT_BELOW_MINIMUM`. Expires older open sessions. Portal matches `contact_id` first (today name only, portal.public.routes.ts:110) |
| GET `/api/companies/:companyId/gateway-payments` | For reconciliation |

**Provider interface** (`payment-gateway/types.ts`): `isConfigured`, `createCheckout`, `expireCheckout`, `retrievePayment` (amount, fee and settlement in AED), `parseRefunds`. `stripe-connect.adapter.ts` makes direct card charges on the connected account (`Stripe-Account` header). `fake.adapter.ts` is for tests (boot fails if `PAYMENT_GATEWAY_FAKE=1` in production). PayTabs/Telr: interface only. **Why Connect:** the existing key is Muhasib's own subscription account (stripe.service.ts:10-24); collecting tenants' customer money there would make Muhasib a payment facilitator (Stripe terms, CBUAE).

## 6. UI (S2)

**Navigation** (nav-config.ts): Sales gets `salesOrders`, `customerAdvances`; Settings gets `salesSettings` (`/settings/sales`): +3, within the caps (navigation-config.test.ts:48-51); update that test and AppSidebar.i18n.ts.

**New pages** (each with an en/ar `*.i18n.ts`): `SalesOrders` (ATP badge, invoice and delivery dialogs, PDFs); `CustomerAdvances` (record with "received now" toggle, refund); `SalesSettings` (tabs: price lists, custom fields, online payments, "Not configured" without keys); `PublicQuoteView` at `/view/quote/:token` (bilingual accept/decline with consent).

**New components** in `client/src/components/sales/`: `LineDiscountFields`, `DocumentAdjustments`, `ApplyAdvanceDialog`, `CustomFieldsEditor`/`Display`, `PayNowButton` (rendered only when `onlinePayment.configured`), `QuoteSendDialog`, `SignatureRecord`, `AvailabilityBadge`.

**Changed pages** (anchored Edits mounting those components): `Invoices` (discount column, adjustments, editable price-list default, custom fields, apply advance); `Quotes` (send, status, signature, convert to SO); `PublicInvoiceView`, `CustomerPortal` (Pay now, outstanding, "payment processing"); `RecurringInvoices` (contact, auto-send); `PaymentChasing` (late fee, off by default); `CustomerContacts` (price list, custom fields); `CustomerStatementDialog` (advances memo); `App.tsx` routes. `check-i18n.mjs` passes with no allow-list growth.

**PDFs** (S1, server-side, Arabic via `pdf-fonts.ts`/`pdf-rtl.ts`): `pdf-invoice.service.ts` (qty × price at 251, 656) gets the discount column, discount/shipping rows, "Less advance ADV-… (INV-…)", custom fields and "Advance Tax Invoice"/"Deposit Receipt" titles; also `pdf-quote`, new `pdf-sales-order`, a priceless SO variant of `pdf-delivery-note`, and an advances block on the statement.

**E-invoice:** derived negative lines become document-level `cac:AllowanceCharge` per tax category, exempt from the unit-price check (einvoice-validation.ts:161).

## 7. Tests

**Integration suite** `tests/integration/phase8-sales.test.mjs`, appended to `test:integration`. Jobs run via `helpers/run-sales-jobs.ts <late-fees|quote-expiry|recurring> <companyId>` (run-recurring.ts pattern); Stripe events are signed with `stripe.webhooks.generateTestHeaderString` against the fake adapter. **S1 writes all of these.**

| AC | Assertions |
|---|---|
| D1-1 | SO `open`, totals = quote, 0 journal lines, contact carried |
| D1-2 | ATP 6, shortfall 4, no stock movement |
| D1-3 | 4/6/1 → partial → invoiced → 409; balanced journals; delivery PDF has no prices; over-delivery 422 |
| D1-4 | Δ1020 +1,050, Δ2055 −1,000, Δ2020 −50, Δ1040 0; box 1 1,000/50; zero-rated → box 4; statement memo |
| D1-5 | Journal as §3; PDF contains "ADV-"; box 1 2,000/100; 422 `ADVANCE_EXCEEDED`; 5 parallel applies stay ≤ available |
| D1-6 | 2055 → 0; locked month → 403 |
| D1-7 | 950 / 47.50 / 997.50; journal as §3; AR = total; credit remainder zeroes every account |
| D1-8 | Default price 80; `price_list_id` stored; another company's list → 422 |
| D1-9 | Two runs → exactly one 20.00 `out_of_scope` line, Dr 1040 / Cr 4040; disabled → nothing |
| D1-10 | Mail not configured: invoice `sent`, `not_sent` recorded, notification, template active |
| D1-11 | 997.50 at 1025, fee entry, `paid`, `payment.received` delivery; replay → nothing; event from a foreign `acct_` → nothing |
| D1-12 | Partial 500 → outstanding 497.50; over outstanding → 422; partial disabled → 422 |
| D1-13 | `configured false`; checkout 503 |
| D1-14 | Credit note 200 + refund via 1025; replay idempotent |
| D1-15 | send / accept / 2nd accept 409 / decline / 410 / expiry job; signature row complete |
| D1-16 | en and ar labels in PDF and public view; bad select → 422; another tenant's record → 404 |

Further integration checks: I-1 company B refused on every new route; I-2 2055 = subledger after all flows; I-3 parallel invoicing of one SO; I-4 mass assignment; I-5 payment on a void invoice → `unallocated`.

**Unit tests (S1, vitest):**
- `sales-line-math` (derivation, pro rata, residuals, mixed rates, `splitGross`, `splitGrossRefund`, percent conversion);
- negative groups in revenue-allocation and credit-note-remainder;
- `quote-state-machine`, `late-fee`, `payment-gateway-webhook` (fake store, as stripe.service does);
- einvoice allowances.

**S2 writes** `navigation-config.test.ts`, `tests/unit/sales-ui.test.ts` (Pay-now visibility, badges) and a 375 px / Arabic browser walkthrough on its own port.

## 8. Work split

**S1 owns:** `migrations/0102-0105`, `_journal.json`, `shared/schema.ts`, `shared/sales-line-math.ts`, `server/constants.ts`, `defaultChartOfAccounts.ts`, `config/env.ts`, `middleware/{csrf,rateLimit,security}.ts`, `server/routes.ts`, `storage.ts` (line ordering only), `package.json`, §7 S1 tests.
- Routes, new: `sales-orders`, `customer-advances`, `custom-fields`, `price-lists`, `payment-gateway`, `public-quotes`. Changed: `invoices`, `quotes`, `recurring-invoices`, `chasing`, `contacts`, `statements`, `billing`, `portal.public`.
- Services, new: `customer-advance`, `sales-order`, `quote-acceptance`, `custom-fields`, `price-list`, `late-fee`, `sales-lines`, `payment-gateway/*`, `pdf-sales-order`. Extracted (extract, do not rewrite; phase 4/6 suites green before any new caller): `invoice-issue` (invoices.routes.ts:1003-1040), `credit-note-issue` (1599-2215). Changed: `revenue-allocation`, `credit-note-remainder`, `invoice-posting`, `invoice-void`, `invoice-numbering` (SO, DN, ADV), `scheduler`, `stripe`, `inventory-costing` (export only), `document-lock` (namespaces), `journal-entry-protection`, `customer-statement`, `pdf-invoice`, `pdf-quote`, `pdf-delivery-note`, `pdf-statement`, `einvoice`, `einvoice-validation`.

**S2 owns:** `client/**`, `tests/unit/navigation-config.test.ts` and `tests/unit/sales-ui.test.ts`. S2 never touches `server/`, `shared/` or `migrations/`.

**S1 order** (test first, then `npm run check` and the suite, then a contract note to S2): (1) 0102 + engine + remainder, D1-7; (2) credit-note extraction + advances, D1-4/5/6; (3) 0103 custom fields, price lists, late fee, recurring, D1-8/9/10/16; (4) 0104 quotes and SO, D1-1/2/3/15; (5) 0105 gateway, D1-11..14.

**S2 order:** adjustments → public quote → SO → advances → settings → Pay now; before an endpoint lands, code against §5 shapes (`client/src/lib/sales-api.ts`) with DEV-only fixtures. Nothing stubbed ships.

## 9. Dependencies

| From | Need | Fallback |
|---|---|---|
| D2 (0106) | `contact_type` to filter customer pickers | Show all contacts until then |
| D2 | Use S1's exported `ensureSystemAccount` for 1080 | Same one-word export |
| D3 | Payout match (Dr 1020 / Cr 1025) needs 1025, `gateway_payments` | Match the 1025 GL balance |
| D4 | Exclude `advance` invoices from sales, use `line_kind`, deposits report reads `customer_advances` (not the platform doc's `customer_deposits`) | — |
| D5 | v1 exposes `discount_amount`, `shipping_amount`, `line_kind`; export covers 0102–0105; deletion anonymises signers after retention | — |
| Owner | Stripe test keys, Connect test client id and webhook secret | "Not configured"; fake-adapter tests |

## 10. Review plan (live, on S1's port and database)

1. **Money:** hand-recompute journals; fuzz 200 line sets (totals add up, balanced, VAT 201 = Σ lines); remainder credit zeroes every account.
2. **VAT:** advance in month M, final in M+1 → box 1 in each; zero-rated advance → box 4; deposit and late fee excluded; discounted e-invoice validates.
3. **Tenant isolation:** B's ids on A's routes refused; contact X's portal token cannot pay Y's invoice.
4. **Concurrency:** 10× parallel accept, convert, apply, SO invoicing, webhook replays (same and different event ids for one PaymentIntent) → one effect; issue racing apply.
5. **Forgery:** signed event from another `acct_`, unknown session, amount mismatch, swapped `metadata.invoiceId` → no posting; fake flag in production → boot fails.
6. **Locks and mass assignment:** nothing posts into a locked or VAT-filed month; `invoiceType`/`status`/`lateFeeForInvoiceId` in a body are ignored.
7. **UI:** Arabic PDFs, no unconfigured Pay now, 375 px.

## Summary for the CTO

1. Signed derived lines (discount, shipping, advance, late fee) let every VAT engine net adjustments unchanged; only revenue allocation and credit-note remainder change, test-first.
2. An advance is an advance tax invoice (line → 2055) through existing issue/payment paths: VAT at receipt, deducted on the final invoice.
3. Invariant test: 2055 = advances subledger; overpayments stay in 2050 (deviation from the VP).
4. Sales orders derive invoiced/delivered quantities; ATP shows shortfall, nothing reserved.
5. Online payment settles only via `recordInvoicePayment` into 1025, fee as a separate `gateway_fee` journal; idempotency in three layers (`stripe_events`, gateway-row states, unique gateway reference).
6. The 600-line credit-note route is extracted into a service for advance and Stripe refunds.
7. VP corrections: subtotal 950 not 850; locked period 403 not 409; advance shown as a statement memo; no chasing job exists, so late fees get a new daily job; reverse charge cut.
8. Cuts: foreign-currency advances, partial credit on advance invoices, in-app refunds, disputes, drawn signatures.
9. **Owner decision:** Stripe Connect, so each company is paid into its own Stripe account. Taking tenants' customer money into Muhasib's subscription account is not acceptable (Stripe terms, CBUAE).
10. **Owner/accountant items:** Stripe test keys plus Connect client id and webhook secret; gateway-fee VAT treatment; late fee outside VAT scope by default; an advance invoice issued before payment creates its tax point at issue.
