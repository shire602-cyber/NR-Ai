# Migration import (Xero, QuickBooks Online, Zoho Books, Wafeq)

UI: **Import data** (`/import`). API: `/api/companies/{id}/imports` (`ledger.post` permission).
Implementation: `server/services/migration-import/` (column mappers in `mappers.ts`, fixtures for
each layout in `tests/fixtures/import/`).

Every file goes through three steps: **preview** (parse + map headers, normalise money to fils and
dates per source system), **validate** (against the current books), **commit** (re-validated, then
written). Re-importing customers, vendors, items or accounts skips rows that already exist.

| Kind                | Writes                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- |
| `chart_of_accounts` | new accounts (existing codes are kept as they are); round-trips with the CSV export |
| `trial_balance`     | ONE balanced `entry_kind = 'opening'` journal on the cut-over date (server/ledger)  |
| `customers`         | customer contacts (TRNs that are not 15 digits are dropped with a warning)          |
| `vendors`           | vendor master rows                                                                  |
| `items`             | products / services (no opening stock — record it with an inventory adjustment)     |
| `open_invoices`     | issued invoices for the outstanding amount + per-document opening entry Dr A/R      |
| `open_bills`        | approved bills for the outstanding amount + per-document opening entry Cr A/P       |

## Opening A/R and A/P without double counting

Choose the trial balance mode:

- `balance` — A/R and A/P control balances are posted from the trial balance. Open documents
  cannot be imported afterwards (validation error `CONTROL_IN_OPENING_BALANCE`).
- `documents` — the A/R and A/P lines move to 3040 Opening Balance Equity and the open invoices /
  bills post them per document (Dr A/R / Cr 3040, Dr 3040 / Cr A/P). Validation requires the open
  documents to total the trial balance's control balances (`CONTROL_TOTAL_MISMATCH`), so after both
  imports A/R and A/P tie to the control accounts and 3040 nets to the trial balance's equity.

Only one opening trial balance can be imported per company. Foreign-currency open documents must be
converted at the cut-over rate before import.

`GET /api/companies/{id}/imports/chart-of-accounts/export` exports the chart in the same layout the
importer reads; `GET /api/companies/{id}/imports/templates/{kind}` returns a blank template.

## Direct connections

OAuth connector skeletons for Xero, QuickBooks Online, Zoho Books, Foodics and Salla live in
`server/services/connectors/oauth.ts`. They report `requires_external` until an app is registered
with each provider (client id, secret and redirect URI configured); the CSV import is the supported
path until then.
