/**
 * The page every report catalog entry opens (client/src/lib/reportCatalog.ts: an entry with an
 * `href` opens that page, one with a `tab` opens /reports?tab=<tab>&report=<id>&persona=<first
 * persona>). The broken-path sweep visits each of them, in both languages, because a catalog
 * page that is clean says nothing about the report behind its "Open" button (Step 1 / F13).
 *
 * tests/unit/report-urls-sweep.test.ts keeps this list in step with the catalog.
 */
export const REPORT_URLS = [
  "/reports?tab=pl&report=profit-loss&persona=owner",
  "/reports?tab=bs&report=balance-sheet&persona=owner",
  "/reports?tab=vat&report=vat-summary&persona=owner",
  "/financial-statements?tab=cash-flow",
  "/reports?tab=sales&report=ar-aging&persona=owner",
  "/reports?tab=balances&report=ap-aging&persona=owner",
  "/reports?tab=trial&report=trial-balance&persona=accountant",
  "/vat-filing",
  "/advanced-reports?tab=comparison",
  "/exchange-rates",
  "/reports?tab=ledger&report=general-ledger&persona=accountant",
  "/reports?tab=ledger&report=account-transactions&persona=accountant",
  "/reports?tab=tax&report=corporate-tax-estimate&persona=owner",
  "/reports?tab=balances&report=customer-balances&persona=owner",
  "/reports?tab=balances&report=vendor-balances&persona=owner",
  "/reports?tab=sales&report=invoice-status&persona=owner",
  "/reports?tab=planning&report=budget-actual&persona=owner",
  "/reports?tab=planning&report=cash-flow-forecast&persona=owner",
  "/reports?tab=sales&report=revenue-customer&persona=owner",
  "/reports?tab=sales&report=sales-product-service&persona=owner",
  "/reports?tab=expenses&report=expenses-vendor&persona=owner",
  "/reports?tab=expenses&report=expenses-category&persona=owner",
  "/cost-centers",
  "/reports?tab=balances&report=inventory-valuation&persona=owner",
  "/reports?tab=balances&report=inventory-movement&persona=owner",
  "/reports?tab=balances&report=fixed-asset-register&persona=owner",
  "/reports?tab=balances&report=depreciation-schedule&persona=freelancer",
  "/reports?tab=payroll&report=payroll-summary&persona=owner",
  "/reports?tab=payroll&report=wps-sif-summary&persona=owner",
  "/reports?tab=expenses&report=expense-claims&persona=owner",
  "/reports?tab=close&report=month-end-close-status&persona=accountant",
  "/reports?tab=close&report=audit-trail&persona=accountant",
  "/reports?tab=close&report=consolidated-statements&persona=accountant",
  "/bank-accounts",
];
