# Accountant Log - 2026-06-21

## Synthetic Company

| Field |Value |
| --- |--- |
| id |f91d4a67-98bc-4c7a-b3a2-71aaf42cba87 |
| name |Report Audit Owner's Company (mqnnxaom) |

## Created Records

| Record type |Count |
| --- |--- |
| journalEntries |2 |
| exchangeRates |1 |
| costCenters |2 |
| invoices |7 |
| invoicePayments |2 |
| receipts |5 |
| postedReceipts |3 |
| bills |3 |
| billPayments |2 |
| products |2 |
| inventoryMovements |4 |
| employees |2 |
| payrollRuns |2 |
| fixedAssets |2 |
| budgetPlans |1 |
| budgetLines |3 |
| expenseClaims |2 |
| bankAccounts |1 |
| bankStatementImports |1 |
| quotes |1 |
| purchaseOrders |1 |
| corporateTaxReturns |1 |

## Fixture Probes

| Probe |Result |Detail |
| --- |--- |--- |
| P&L has revenue and expenses |Pass |{"totalRevenue":105688,"totalExpenses":107884.17} |
| Balance sheet has asset and equity/liability rows |Pass |{"totalAssets":501996.33,"totalLiabilities":159192.5,"totalEquity":342803.83} |
| Aging report has A/R and A/P rows |Pass |{"receivables":5,"payables":2} |
| Trial balance returns account activity |Pass |{"rows":49} |
| Balance summaries include customers or vendors |Pass |{"keys":["generatedAt","customers","vendors"]} |
| Sales by product/service has rows |Pass |{"rows":9} |
| Period comparison exposes metrics |Pass |{"metrics":5} |
| FX gains/losses has foreign-currency exposure |Pass |{"receivables":1,"payables":0,"netUnrealizedGainLoss":-37.202543142597506} |
| Cost-center profitability has allocated income and expenses |Pass |{"allocatedLineCount":4,"totalIncome":23000,"totalExpenses":7100} |
