# CFO Benchmark Audit Report - 2026-06-21

## Executive Verdict

Muhasib.ai has enough benchmark evidence to rank gaps, but any score below 5 means the product should not claim full parity for that area.

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
| P1 |Rate-limit pressure |/reports hit API 429 during benchmark crawl. |{"blank":true,"failureText":null,"pageErrors":[],"apiFailures":["GET 429 https://nr-ai-production.up.railway.app/api/companies","GET 429 https://nr-ai-production.up.railway.app/api/auth/me"]} |Tune audit pacing or production read-rate limits; confirm normal manual usage is unaffected. |
