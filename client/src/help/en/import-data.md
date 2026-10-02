---
title: Import data from another system
summary: Bring contacts, items, accounts and opening balances from Zoho Books, QuickBooks, Xero or a spreadsheet.
category: getting-started
keywords: import, migration, zoho, quickbooks, xero, csv, excel, wizard, contacts, items
related: opening-balances, chart-of-accounts, contacts
---

The import wizard moves your data in six steps. Nothing is saved until you have seen a dry run.

## What you can import

Contacts, items and services, the chart of accounts, an opening trial balance, open invoices and open bills. Import the chart of accounts before the trial balance.

## Steps

1. Open [Import data](/import) and choose where your file comes from. Zoho Books, QuickBooks and Xero columns are recognised automatically.
2. Choose what to import.
3. Upload a CSV or Excel file, up to 5 MB, with the column names in the first row.
4. Match each field to a column. Required fields are marked.
5. Check the dry run. It lists every row that would be created, skipped as a duplicate or rejected, with the reason.
6. Import. Run each file once.

## Dates and numbers

Choose the date format that matches your file. If the dates are day-first (31/12/2026) or month-first (12/31/2026) the wizard tells you which it detected. Pick the number format too: 1,234.50 or 1.234,50.

## Duplicates

Contacts match by tax number, or by name and email. Items match by SKU, or by name. Accounts match by code. Duplicates are skipped, never overwritten.

## Opening position

Open invoices, open bills and the trial balance are combined on the **Opening position** tab. See [Opening balances](/help/opening-balances).
