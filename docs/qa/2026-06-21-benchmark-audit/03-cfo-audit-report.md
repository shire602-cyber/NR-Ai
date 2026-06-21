# CFO Benchmark Audit Report - 2026-06-21

## Executive Verdict

Production read-only evidence is useful for deployment confidence, but the full accountant-grade benchmark is not complete until the local synthetic fixture probes pass.

## QuickBooks-Parity Matrix

| Capability |Rating |Evidence |
| --- |--- |--- |
| Memorized/saved reports |Review |Report catalog and saved-view behavior require manual verification. |
| Class/location/project tracking |Review |Cost center P&L exists; multi-dimensional drilldown depth must be scored from screenshots. |
| Customer/vendor centers |Review |Balances and contacts routes are crawled; single-pane depth must be reviewed. |
| Bank feeds and rules |Review |Manual import/reconciliation is tested; live provider credentials are outside this audit. |
| Multi-currency revaluation |Review |Fixture probes FX exposure; historical revaluation depth needs reviewer scoring. |
| UAE tax reporting |Review |VAT/CT fixture and route evidence are captured when local DB is available. |
| Report drilldown/export |Review |Report shell grid marks missing controls explicitly. |
| Audit trail and permissions |Review |Route crawl plus fixture probes are evidence; role matrix needs dedicated scoring. |

## Top 10 Gap Queue

| Priority |Area |Finding |Evidence |Required fix |
| --- |--- |--- |--- |--- |
| P1 |Synthetic accounting coverage |No synthetic accounting fixture probes ran, so accountant-grade correctness remains unscored. |Production run was intentionally read-only; route/report rendering evidence is valid, but trial balance, VAT/CT tie-outs, and subledger probes require a local synthetic run. |Run `bash scripts/qa/bootstrap-e2e.sh`, then `BASE_URL=http://localhost:5000 npm run e2e:benchmark-audit` and review the generated probes. |
| P1 |Report shell |A/R Aging is missing benchmark shell controls. |back=false, export=true, period=true |Bring report into shared shell or add equivalent back/export/period controls. |
| P1 |Report shell |A/P Aging is missing benchmark shell controls. |back=false, export=false, period=true |Bring report into shared shell or add equivalent back/export/period controls. |
