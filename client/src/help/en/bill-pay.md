---
title: Bills and vendor payments
summary: Record what you owe vendors, including reverse-charge purchases, approve it and pay it.
category: purchases
keywords: bill, vendor, payable, reverse charge, input VAT, approve, pay, products, stock, GRNI
related: vendor-credits, purchase-orders, approvals, inventory
---

A bill is an invoice you receive from a vendor. Approving it posts the expense and the input VAT you can reclaim.

## Enter a bill

1. Open [Bills](/bill-pay) and choose **New bill**.
2. Choose the vendor, the bill number and date, and add the lines with their VAT.
3. Save. The bill waits as pending, and posts nothing until approved.

## Reverse charge

For a purchase from outside the UAE, or another supply where you account for the VAT, switch on **Reverse charge** in the bill dialog. The supplier charges no VAT; Muhasib.ai declares the VAT as output tax and the same amount as input tax, so boxes 3 and 10 of the return are filled and the net effect is nil. Do not enter 5% or 0% as a workaround: both give a wrong return.

## Products and stock

Add a **product** to a bill line and approving the bill books the quantity into stock. Stock bought on a purchase order or an uninvoiced receipt waits in the goods received not invoiced account (2015) until the bill clears it. See [Inventory](/help/inventory).

## Approve

Approve the bill to post it. If approval rules apply to your company, the bill waits for the people named in the rule. See [Approvals](/help/approvals).

## Pay

Record a payment with the date, the amount and the bank account. Partial payments are supported.

## Good to know

- Foreign-currency bills use the exchange rate for the bill date.
- To correct an approved bill, record a [vendor credit](/help/vendor-credits).
- Some input VAT cannot be reclaimed, such as entertainment. See [VAT returns](/help/vat-filing).
