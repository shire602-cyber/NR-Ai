# Release notes: Phase 1 (trustworthy books)

For the business owner. Read "Required action after deploy" before releasing.

## What changes for users

- Credit notes now reduce what a customer owes. An invoice that is fully credited gets the status
  "Credited" (Arabic: مُسوّاة بإشعار دائن). It cannot be paid again, is not chased, and is not in the
  receivables lists, the ageing report or the dashboards. If the credit note is voided the invoice
  goes back to Sent, Partial or Paid.
- A payment above what is still outstanding (total minus payments minus credit notes) is refused
  unless it is explicitly recorded as a customer advance. "Mark as paid" records only the real
  remainder. When nothing is outstanding the request is refused with the message "nothing
  outstanding". This applies to bank matching and auto-reconcile too.
- A credited invoice cannot be changed by hand. It reopens only when its credit note is voided.
  Draft, void and cancelled invoices show 0 outstanding.
- Payment reminders and chasing skip invoices with nothing outstanding, and drafts.
- Unrealised FX revaluation now posts. It uses only issued invoices and approved vendor bills, at the
  amount still outstanding. Running it twice for the same date is refused. Each entry is reversed
  automatically the next day, so month-ends do not stack. It needs the FX gain (4090) and loss (5140) accounts.
- Recurring invoices in a foreign currency now use the exchange rate of the day. If there is no
  rate the invoice is skipped, you get a notification, and it is retried on the next run.
- Recurring invoices: since 30 April 2026 the daily run DEACTIVATED every recurring template that was
  due, without generating its invoice. This release fixes the run. It does NOT re-activate those
  templates and does NOT create the missed invoices. See "Required action after deploy", step 4.
  The run now skips a template that fails and carries on with the others; a failure never
  deactivates a template.
- The FX gains/losses report accepts `?asOf=YYYY-MM-DD`. For a past date, an invoice or bill paid
  after that date still counts as open on it.
- The Exchange Rates page warns when you have invoices or quotes in a currency that has no rate.

## Migrations (run before starting the new version)

1. `0089_unit_price_precision.sql`: unit prices keep their full precision.
2. `0090_invoice_line_revenue_account.sql`: an invoice line can name its own revenue account.
3. `0091_exchange_rates_company_scope.sql`: exchange rates belong to a company (or are official system rates).

## Required action after deploy

Exchange rates entered before this release are ignored, because their direction and owner were unreliable.

1. Each company: open Exchange Rates and enter today's rate for every foreign currency in use
   ("1 USD = 3.6725 AED"). Until then new foreign-currency invoices and quotes are refused
   and recurring foreign-currency invoices are skipped.
2. Platform admin: re-import the official rates (`POST /api/exchange-rates/fta/bulk`).
3. Find documents already booked at an implausible rate (read-only, changes nothing):
   `DATABASE_URL=... node scripts/find-suspect-fx-documents.mjs` (add `--json` for machine output).
   It lists foreign-currency invoices, credit notes and bills with a rate outside the normal range,
   or exactly 1. Review each with your accountant; posted documents are not rewritten.
4. Recurring templates switched off by the old bug (read-only, changes nothing):
   `DATABASE_URL=... node scripts/find-disabled-recurring-templates.mjs` (add `--json` for machine output).
   It lists, per company, each inactive template that has not ended, the due dates it missed since
   its next run date, and the value not billed per currency. It cannot tell a template you paused
   on purpose from one the bug switched off (the table keeps no update time), so `likelyBugDisabled`
   is only a hint. For each affected template: re-activate the right ones from the Recurring Invoices
   page, then create the missed invoices yourself, deliberately. Check with each customer first
   whether they were billed another way.

## Other behaviour changes

- The VAT return for a period that has not finished is a preview only and cannot be filed.
- A filed VAT return is locked.
- Voiding an invoice that has credit notes is refused; void the credit notes first.
- A journal entry dated before the start of the current financial year asks for confirmation before it is posted.
- `BCRYPT_COST` must be 12 or higher (the default is 12). Lower values stop the server starting.

## Known limitations

- When an invoice that was already paid is later credited, the customer is owed a refund. The amount
  sits in receivables as a negative balance and no report lists it yet.
