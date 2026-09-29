# Release notes: Phase 4 (compliance)

Plain-language summary for the owner. Branch `launch/phase-4-5-compliance-arabic`.

## What changed

**VAT filing with evidence.** You still file on EmaraTax; Muhasib does not send anything to the FTA. Now, when you record
a return as filed you enter the FTA reference and the date, and can attach the FTA acknowledgement (PDF, PNG or JPEG;
more than one file is fine). Muhasib keeps a frozen copy of every figure at that moment, with a fingerprint (SHA-256), so
later changes to your books can never change what a filed return shows. If the books do change afterwards, the return
shows a warning with the difference per box. Owners and accountants can remove an evidence file with a reason; the file
itself is kept for the 5-year retention period and the removal is logged.

**Filing locks the period.** Recording a return as filed locks every month it covers, in one step with the filing.
Unlocking such a month needs the existing unlock permission (firm owner) plus a written reason, which is audit-logged.

**Paying the FTA.** Record payments against a filed return (in instalments if you like). Filing clears the output and
input VAT accounts into the FTA VAT Control account; each payment then moves that account against the bank. When the
return is fully paid, the three VAT accounts are back to zero. A refund works the other way round.

**Amendments (voluntary disclosure).** A filed return cannot be edited. "Amend" creates a new linked return from your
current books, shows the difference per box, and that difference gets its own filing record, evidence and payment.

**Corporate tax** gets the same filing record, evidence, amendment and payment flow. Filing posts the tax as an expense and
a payable, dated the last day of the tax year it belongs to (so it lands in that year's profit and loss, whenever you file).
The accounts "Corporate Tax Expense" (5150) and "Corporate Tax Payable" (2060) are in the standard chart and are created
automatically for older companies that lack them. You can create, compute and file a return for a year that is already
locked or closed: if the year was closed, the tax expense is also closed to retained earnings in the same step.

**FTA Audit File (FAF).** New download on the VAT Filing page (tab "FTA Audit File"): company details, purchase listing,
supply listing and general ledger for a period (up to one financial year), streamed as a CSV.

**Opening balances.** New page (`/opening-balances`, also an optional onboarding step): enter account balances as of the
day before your first transaction, import them from CSV, and optionally add open customer invoices and vendor bills.
One entry is posted; any difference goes to "Opening Balance Equity". Open invoices/bills must equal receivables/payables
and post no revenue or VAT. It can be reversed and re-entered until the period is locked, a VAT return is filed for it, or
payments exist against the opening documents.

**Year-end close.** New section on the Month-End Close page: closes income and expenses to retained earnings with one entry
on the last day of the financial year and locks its twelve months. A firm owner can reopen it with a reason, unless a later
year has filed returns or is closed. Profit and loss reports leave the closing entry out, so a closed year still reports its profit.

**E-invoice XML.** Credit notes are now a proper credit-note document; fuller seller/buyer details, payment means and terms;
clearer, bilingual "fix this" errors before an invoice can be generated. No provider was added.

## Filing corrections (review round)

- **The VAT accounts clear to exactly zero at filing.** The journal is driven by what the ledger holds for the period. The FTA
  control account gets the net on the return; input VAT the return does not recover (partial exemption) is expensed once on the
  new "Irrecoverable VAT Expense" account (5160); rounding up to AED 1.00 goes to a rounding line there. A bigger gap between
  books and return is refused (422 `VAT_LEDGER_MISMATCH`) with both figures: investigate it, it is not written off.
- **Filing recomputes the return from the books.** If the draft is out of date it is replaced by the recomputed figures and the
  response lists what changed. If someone edited boxes by hand, filing stops (409 `VAT_RETURN_STALE`) and asks: file the
  stored figures or the recomputed ones (the Record filing dialog shows both, in English and Arabic).
- **Month lock and posting cannot interleave.** Filing, year-end close and manual locks wait for postings already in flight;
  a posting that starts afterwards is refused as "locked period".
- **Invoice numbering cannot get stuck.** A number already taken (opening-balance or imported invoice, credit note, quote) is
  skipped inside the same transaction, and opening invoices in the sequence's format move the counter past them.
- **Returns filed before filing records existed** get a frozen snapshot on first read (flagged legacy, no journal posted; drift
  and amendment work as usual). A filing record can no longer be deleted, except with its company.

## Voids, VAT journals and hand edits (second review round)

- **A void is reported in the period of the void.** An invoice issued in August and cancelled in September was a real supply in
  August: August still shows it (so it matches the ledger and can be filed); September shows a negative line, like a credit note
  (a voided credit note comes back positive). One rule for the VAT 201, autopilot, firm workpaper and FAF; the corporate tax pull
  follows the ledger's days. Drafts voided before posting never count. Filed returns still show their snapshot.
- **Manual journals to the VAT accounts appear as adjustments** (output: your emirate's box 1; input: box 9), with journal number
  and description, flowing into boxes 12-14, so return and ledger agree with no hand edit. They need a description when posted.
- **Journals typed in are always source "manual";** system fields come from the server, never from the request.
- **A hand edit needs a written reason** (10+ characters, saved with who and when); filing on hand-edited figures is refused (422
  `MANUAL_EDIT_REASON_REQUIRED`) without it. **A return can never declare less tax than the ledger supports:** lowering output VAT
  below the ledger, or raising recoverable input VAT above it, is refused (422 `VAT_UNDER_DECLARED`); credit notes, voids and VAT
  journals are already in the ledger, so they are fine. Declaring MORE tax is allowed with a reason and goes to the new account
  "VAT Adjustments" (5165), apart from irrecoverable VAT (5160).
- **Opening invoice numbers:** the preview warns when an imported number leaves a gap in the sequence; posting logs the jump.
- **Read-only scripts** (they change nothing): `scripts/find-suspect-journal-sources.mjs` lists system-source journals with no
  matching record (possible forgeries from before this fix); `scripts/find-suspect-fx-documents.mjs` lists odd FX rates.

## Database migration

`0096_vat_return_adjustments`: one nullable column (the journals behind a return's adjustments). Safe to re-run.

`0095_filing_review_fixes`: a column for hand-edited VAT boxes and a trigger that refuses deleting filing records. Safe to re-run.

`0094_tax_filing_evidence_opening_year_end`: new tables (filings, evidence, payments, opening balances, year-end closes), amendment
columns on both return tables, an "opening balance" flag on invoices and vendor bills. Safe to re-run. The stored snapshot of a
filing is protected by a database trigger against edits.

## Behaviour changes to know about

- New companies get four more accounts (2060, 5150, 5160, 5165). Bills and receipts still post all input VAT to 1050; the irrecoverable
  part moves to 5160 when the return is filed.
- Marking a VAT or corporate tax return "filed" by editing its status no longer works: use Record filing (reference and date are required).
  The old submit-with-reference call now also needs a filing date.
- A filed VAT return locks its months. Posting into them is refused until a firm owner unlocks them with a reason.
- Filed returns always read as their frozen snapshot, in lists and in detail.
- Opening-balance invoices and bills cannot be edited, voided or credited; they are excluded from VAT returns.

## Verify before relying on it

- **FAF column layout.** The FTA's published FAF specification could not be consulted. Block markers, column names and order,
  tax codes and the version string live in one file (`server/services/faf-format.ts`) and must be checked against the official
  specification (ideally with the FTA's FAF validator) before a real audit.
- **Peppol endpoint scheme.** `0235` (UAE TRN) is the scheme commonly cited but is unconfirmed; the emirate codes in the e-invoice
  are unconfirmed too. Confirm both with the chosen e-invoicing provider before go-live.
- The QR code on invoices is a Saudi-style format; the UAE has not been confirmed to require it.
- Not added to the reports catalog: adding one entry breaks the catalog's frozen count and coverage tests. The FAF is reachable
  from the VAT Filing page instead.
