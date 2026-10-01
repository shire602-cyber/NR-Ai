# Phase 6 — Parity that sells (2026-10-01)

Branch `launch/phase-6-parity`, stacked on `launch/phase-4-5-compliance-arabic`. One PR.
Cost first: cheapest correct route, no paid services, batch your work, consult before spending.

## Inventory (what existed before Phase 6)

| Area | State |
|---|---|
| Vendor bills | Real: `vendor_bills`, `bill_line_items`, `bill_payments` (raw SQL, migration 0010); approval posts Dr expense/asset + Dr 1050 / Cr 2010; payment posts Dr 2010 / Cr bank (`server/services/bill-posting.service.ts`). VAT return box 9 reads `vendor_bills` directly (`vat-autopilot.service.ts` ~line 780). |
| Vendor credit notes | Missing. |
| Proforma / delivery note | Missing. Quotes → invoice conversion is real (`quotes.routes.ts:219`). |
| Payroll | Real runs, approval journal (5020/2030, 5025/2032, 5028/2036, 2034), WPS SIF export. No payslip PDF. |
| Inventory | Stock tracking only (`products.currentStock`, `inventory_movements` with `unit_cost`). Invoice lines have no `product_id`. No COGS posting, no costing method. 1070 Inventory exists in the default chart; no COGS account. |
| Customer refunds | Only credit notes. No cash refund to a customer. |
| Customer statement | Missing (portal has a P&L/BS summary only). |
| Report export | XLSX via `POST /api/export/excel` + `client/src/lib/export.ts`. No CSV. `AdvancedReports.tsx` uses jsPDF (no Arabic). |
| Report dates | Aging (`/api/reports/:companyId/aging`) and balance summaries ignore dates. |

## Workstreams (disjoint files; migrations reserved per stream)

| Stream | Model | Migration | New files | Existing files touched |
|---|---|---|---|---|
| A. Vendor credit notes | Sonnet | 0098 | `server/services/vendor-credit.service.ts`, `server/routes/vendor-credits.routes.ts`, `client/src/pages/VendorCredits.tsx` + `.i18n.ts`, tests | `vat-autopilot.service.ts` (box 9 subtracts credits), `bill-posting.service.ts` (apply to bill), nav-config, App.tsx routes, `server/routes/index` registration |
| B. Inventory costing + COGS | Sonnet, Opus review | 0099 | `server/services/inventory-costing.service.ts`, tests | `shared/schema.ts` (`invoice_lines.product_id`, `products.average_cost`, `products.track_inventory`, company setting), `server/defaultChartOfAccounts.ts` (5200 COGS), invoice issue/void/credit-note hooks, `Invoices.tsx` product picker, `Inventory.tsx` |
| C. PDFs: payslip, customer statement, proforma, delivery note | Sonnet | none | `pdf-payslip.service.ts`, `pdf-statement.service.ts`, `customer-statement.service.ts`, `server/routes/statements.routes.ts`, tests | `pdf-quote.service.ts` (proforma title), `pdf-invoice.service.ts` (delivery-note variant), `payroll.routes.ts` (payslip route), `Payroll.tsx`, `CustomerContacts.tsx`, `Quotes.tsx`, `Invoices.tsx` (buttons only) |
| D. Aging as-of, CSV export, customer refunds | Sonnet, Opus review (refund) | 0100 | `server/services/customer-refund.service.ts`, `server/routes/customer-refunds.routes.ts`, `client/src/lib/export-csv.ts`, tests | `reports.routes.ts` (aging `asOf`), `Reports.tsx` (as-of picker + CSV menu item), `CreditNotes.tsx` (refund dialog) |

Rules: Edit, never Write, an existing file (other streams edit the same files). Each stream runs its own
server on its own port and database (A 5061/muhasib_p6a, B 5062/muhasib_p6b, C 5063/muhasib_p6c,
D 5064/muhasib_p6d). TDD. No new dependencies. All strings through the page `*.i18n.ts` table with
Arabic. Money posting only via the existing journal services; every journal balanced; period lock and
VAT filing lock respected (`assertPeriodNotLocked`, posting-lock).

## Definition of done

1. `npm run check`, `npx vitest run`, integration suites, crawl, build all pass locally.
2. Opus adversarial review of streams B and D posting logic, plus A's VAT effect; fixes applied.
3. Release notes `docs/RELEASE_NOTES_PHASE6.md`.
