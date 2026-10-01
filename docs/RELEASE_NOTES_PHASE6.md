# Release notes: Phases 6 and 7 (parity features, public pages)

Plain-language summary for the owner. Branch `launch/phase-6-parity`. Migrations 0098-0101.

## What changed

**Vendor credit notes.** A supplier credit (their credit note, your debit note) is now a document of its own under
Purchases. Approving it posts the reverse of the bill: accounts payable goes down, the expense or asset account and the
input VAT are reduced. You can apply it to the open bill (the bill's amount due drops, and it shows as paid when the
credit covers it) or leave it as a credit balance with the supplier. If the credit and the bill carry different
exchange rates, applying it posts the realised exchange difference (to the FX gain or loss account) so Accounts
Payable lands on exactly zero when the bill is fully settled. The VAT 201 box 9 and the FTA audit file both
subtract approved credits dated in the period. A credit on a reverse-charge bill reverses the reverse-charge entries
too. Credits are numbered VCN-0001 upwards per company. A bill with an applied credit cannot be deleted.

**Inventory costing and cost of goods sold.** Off by default; switch on under Company settings ("Post inventory to
ledger"). Products marked "track inventory" carry a weighted average cost, updated by every purchase movement. Invoice
lines can now pick a product. Issuing an invoice for a tracked product moves the stock out and posts cost of goods sold
(new account 5200) against Inventory (1070) at average cost, dated like the revenue entry. If stock is short, the invoice
is refused before anything is posted. Voiding the invoice puts the stock and the cost back. A credit note restocks only
when you ask it to. These journals are system-owned and cannot be edited or reversed by hand.

With the setting on, Inventory (1070) always equals the sum of the products' stock x average cost, to the cent. Every
stock movement posts the exact value it moves:

- a **purchase** movement posts Dr Inventory 1070 / Cr **Goods Received Not Invoiced (2015)**. When the supplier's
  bill arrives, code its line to account 2015 (not to an expense) so 2015 clears to zero and the purchase is not
  counted twice. The movement dialog says so;
- an **adjustment** in posts Dr 1070 / Cr **Inventory Adjustments (5210)** (at its unit cost, or the average), an
  adjustment out Dr 5210 / Cr 1070 at the average;
- a manual **sale** posts Dr 5200 / Cr 1070 at the average, a manual **return** Dr 1070 / Cr 5200 at the average;
- value goes in at cost and out at the average, and the last unit out takes the whole remaining value, so rounding
  never leaves a residue (3 units bought at 3.333333 and sold one at a time cost exactly 10.00 in total).

Switching "Post inventory to ledger" on, or turning "track inventory" on for a product that already holds stock,
posts the opening stock: Dr Inventory / Cr Opening Balance Equity for stock x average cost (dated that day; a
period lock refuses it). Stock that moved while the setting was off is brought in line the same way the next time
it is switched on. A tracked product that has stock but no known cost (average cost 0) cannot be invoiced: issuing is
refused with `PRODUCT_COST_UNKNOWN` until a purchase with a unit cost, or an adjustment with a cost, is recorded.
A product that has stock movements cannot be deleted (409 `PRODUCT_HAS_MOVEMENTS`): deactivate it instead.

**Bills are locked once approved.** A bill can be edited only while pending or draft and with no payment or applied
credit (409 `BILL_NOT_EDITABLE` otherwise); to correct an approved bill, void it or record a supplier credit note.

**Customer refunds.** When a customer has a credit note balance you owe back in cash, record a refund from the credit
note's menu: it posts accounts receivable against the bank account, reduces what is still refundable, and can be
cancelled (a reversing entry). The money can only leave a cash or bank account, never Accounts Receivable or
Inventory. A credit note carries its customer contact from the invoice, so the refund shows on the customer's statement. You cannot refund more than the credit the receivable ledger actually holds, so a credit
note on an unpaid invoice has nothing to refund.

**Customer statements.** From Customer Contacts, pick a date range and download a statement PDF or email it: opening
balance, every invoice, credit note, payment and refund with a running balance, closing balance, and an ageing table.
Amounts are in AED with the document currency shown per line.

**Payslips.** Each employee on a calculated or approved payroll run has a bilingual payslip PDF (basic, allowances,
deductions, pension, net pay, masked IBAN, employer contributions).

**Proforma invoices and delivery notes.** A quote can be printed as a proforma invoice (marked "not a tax invoice");
an invoice can be printed as a delivery note (quantities, no prices, signature block).

**Ageing as of a date.** Receivables and payables ageing accept an "as of" date and read the books at the end of that
day: documents dated by then, payments and credits by their own dates (a vendor credit applied to a bill counts from
the later of the credit's date and the bill's date, not from the day someone clicked "apply"). Approved vendor credits
that are not yet applied show as negative amounts in the Current bucket, so the payables ageing total equals Accounts
Payable in the ledger. Leaving it blank gives today, as before.

**CSV export.** Every report that exports to Excel also exports to CSV (UTF-8 with BOM so Arabic opens correctly in
Excel; cells that could run as formulas are neutralised).

**Public pages told the truth.** The landing and pricing pages now describe only what the product does on this branch:
no accreditation or residency claims, no invented statistics, no competitor table, no features that were hidden in
Phase 3. The pricing matrix matches the server's plan gates, and prices are defined once (`shared/plan-prices.ts`) and
read by both the public page and the billing API. Two dead landing pages were deleted.

## For you to decide

- Prices stay Free / 49 / 149 / 299 per month (39 / 119 / 239 billed yearly). Wafeq charges 69 / 99 / 249. If you
  change them, change `shared/plan-prices.ts` and the matching Stripe price objects.
- Invoice and receipt caps on the Free and Starter plans are shown on the pricing page and enforced only when
  `BILLING_ENFORCEMENT=true` is set, like the other plan gates.

## Known limitations

- Vendor credits are not yet reflected in the client portal or the dashboard payables figure.
- Recurring-invoice templates carry no product, so they never consume stock.
- Value-based costing assumes whole units; fractional invoice quantities of a tracked product are refused.
- Payments and refunds on a customer statement are valued at the invoice's and credit note's booking rate; realised
  FX stays in the ledger.
- Payslip wording and the Arabic on the new screens have not had a native-speaker review.

## After deploy

Nothing to re-enter. Companies that want inventory costing switch it on and set "track inventory" on the products
concerned; the opening average cost is seeded from each product's cost price and the stock on hand is journalled to
Inventory when the setting is switched on. A company that already keeps a manual balance in account 1070 should
clear it (or expect it to be added to) before switching on, because the opening journal books the full stock value.
