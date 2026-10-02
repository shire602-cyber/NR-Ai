---
title: Bank reconciliation
summary: Import a bank statement, match each line to your books and prove the balance.
category: banking
keywords: bank, reconcile, statement, match, receipt, overpayment, customer credit, USD, rules
related: cashflow-forecast, journal-entries, bill-pay
---

Reconciling shows that your books agree with the bank.

## Import a statement

Open [Bank reconciliation](/bank-reconciliation) and import the statement file from your bank. Lines you have already imported are recognised and not added twice. Each bank account is reconciled in its own currency, including **USD accounts**: the statement balance is compared with the ledger in that currency.

## Match the lines

For each bank line, Muhasib.ai suggests invoices, bills, receipts or entries with a similar amount, date and reference. Accept a suggestion, or create an entry for lines with no match, such as bank fees. [Auto reconcile](/auto-reconcile) scores every open line and lets you accept many matches together. Nothing is posted until you accept.

- **One receipt, several invoices.** Select a single bank line and tick every invoice it pays. The amount is split across them, oldest first by default, and each invoice is settled.
- **Overpayment.** If the customer paid more than the invoices you tick, the excess is kept as **customer credit** on their account, to apply to a later invoice or refund. It is never left as unexplained income.

## Teach it with rules

In [Reconciliation rules](/reconciliation-rules), describe a payment that repeats, such as rent or a utility bill: which accounts, what split and whether VAT applies. A rule only proposes; you preview and post.

## Finish

The reconciliation compares the statement balance with the ledger and lists what is still unmatched.

## Good to know

- Bank connections that need provider keys say **not configured** until set up. Manual import always works.
