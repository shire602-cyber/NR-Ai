---
title: Inventory and costing
summary: Keep products and services, and track stock at average cost that ties to your ledger.
category: accounting
keywords: inventory, stock, costing, average cost, GRNI, 2015, opening stock, movements, SKU, COGS
related: purchase-orders, bill-pay, invoices
---

[Inventory](/inventory) is your list of items. Invoices and bills pick lines from it.

## Switch costing on

Open [Company settings](/settings/company) and turn on **Post inventory to ledger (COGS)**. Until then stock quantities are tracked but nothing is posted to the inventory account (1070) or cost of goods sold.

## Items and services

Each item has a name, optional SKU, selling price, purchase cost and VAT rate. Mark an item as a service when there is no stock to track.

## How stock moves

- **Buying.** A bill or purchase order line with a **product** adds quantity. A purchase received before its bill sits in goods received not invoiced (**2015**) until the bill arrives and clears it.
- **Selling.** An invoice removes quantity and posts cost of goods sold at the current average cost, next to the revenue.
- **Returns and write-offs.** Reduce stock with an adjustment. It is valued at average cost.
- Movements always use the **average cost**, not the static cost price on the item.

## Opening stock

Enter the **quantity and the unit cost** of what you hold when you start. This sets the quantity and posts the value once. Do not also post the value by journal.

## Dates

Every movement has a **date**. Back-dated movements land in the right period, so a valuation at month end matches the ledger. Locked periods cannot receive movements.

## Good to know

- You cannot sell more than you hold. Correct the on-hand figure with a stock adjustment first.
- Import products from another system with [Import data](/help/import-data).
