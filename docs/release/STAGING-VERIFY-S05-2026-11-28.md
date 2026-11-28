# S05 staging verification, 2026-11-28

Target: https://nr-ai-staging.up.railway.app, test-branch commit `70b223cc` (contains PR #204 CSV formula-injection guard and PR #228 binary-upload refusal).
Tenant: demo company "Demo Second LLC" (staging demo account; no credentials recorded here). Test records are prefixed `S05-verify` / account codes `S05V1..S05V5`.
Method: scripted HTTP calls (login, `/api/csrf-token`, cookie session). Raw status codes and CSV lines below.

## Result summary

| Check | Result |
| --- | --- |
| 1a. Binary refusal on `POST .../bank-statements/import` (PDF csvContent, PDF base64, PNG base64) | PASS (400 `STATEMENT_CSV_REQUIRED`, nothing imported) |
| 1b. Binary refusal on `POST .../bank-statements/preview` (PDF csvContent, PDF base64, PNG base64) | PASS (400 `STATEMENT_CSV_REQUIRED`) |
| 1c. Binary refusal on `POST .../bank-statements/import-preview` (lightweight legacy preview) | **FAIL**: returns 200 with `transactionCount: 0`, no 400 |
| 1d. Normal small CSV still previews | PASS (200, 2 rows parsed) |
| 2. CSV formula guard, two emitters (chart-of-accounts export, trial-balance CSV) | PASS |

Overall: not fully verified because of 1c. The register row was not changed.

## 1. Binary refusal

Bank account used: one created for this test (`S05-verify bank`, the demo company had none). Before and after the binary attempts: `GET .../bank-statements/imports` returned 0 batches, `GET .../bank-statements/unreconciled` returned 0 rows (unchanged).

| Request | Payload | Status | Body code |
| --- | --- | --- | --- |
| `POST /bank-statements/import` | `csvContent` = `%PDF-1.4\n1 0 obj ...` | 400 | `STATEMENT_CSV_REQUIRED` ("Choose a bank CSV export.") |
| `POST /bank-statements/import` | `fileBase64` of a PDF (with NUL bytes) | 400 | `STATEMENT_CSV_REQUIRED` |
| `POST /bank-statements/import` | `fileBase64` of PNG magic bytes | 400 | `STATEMENT_CSV_REQUIRED` |
| `POST /bank-statements/preview` | `csvContent` PDF | 400 | `STATEMENT_CSV_REQUIRED` |
| `POST /bank-statements/preview` | `fileBase64` PDF | 400 | `STATEMENT_CSV_REQUIRED` |
| `POST /bank-statements/preview` | `fileBase64` PNG | 400 | `STATEMENT_CSV_REQUIRED` |
| `POST /bank-statements/import-preview` | `csvContent` = `%PDF-1.4\n...` | **200** | none; body `{"transactionCount":0,"skippedRows":0,"format":"generic","preview":[]}` |
| `POST /bank-statements/import-preview` | `csvContent` starting with PNG magic bytes | **200** | same empty result |

Finding (1c): `import-preview` (route `bankCsvImportPreviewSchema` + `parseBankCsv` in `server/routes/bank-statements.routes.ts`) does not run the binary sniff that the other two routes use. It persists nothing and reports 0 transactions, so there is no data risk, but it does not return the documented 400 and the UI cannot tell the user the file is not a CSV from this endpoint. Suggested fix: run the same `looksBinary` check (or route `import-preview` through `parseStatementCsv`) and add a test.

Normal CSV (`Date,Description,Debit,Credit` with two `S05-verify` rows):
- `POST /bank-statements/import-preview` -> 200, `transactionCount: 2`, format `generic`.
- `POST /bank-statements/preview` -> 200 (full preview object). Imports and unreconciled counts stayed at 0 afterwards (preview only, nothing imported, so no undo needed).

## 2. CSV formula guard

Accounts created via `POST /api/companies/:companyId/accounts` (all 201), then fetched in two server CSV emitters.

Emitter A: `GET /api/companies/:id/imports/chart-of-accounts/export` (200, `text/csv; charset=utf-8`):

```
Code,Name,Name (Arabic),Type,Sub Type,Description
S05V1,"'=HYPERLINK(""http://example.com"",""S05-verify"")",,Expense,,
S05V2,'+S05-verify plus,,Expense,,
S05V3,'@S05-verify at,,Expense,,
S05V4,"-1,234.00",,Expense,,
S05V5,'-S05-verify minus,,Expense,,
```

Emitter B: `GET /api/companies/:id/reports/trial-balance?format=csv` (200, via `server/reporting/http.ts`):

```
S05V1,"'=HYPERLINK(""http://example.com"",""S05-verify"")",expense,0,0,0,0
S05V2,'+S05-verify plus,expense,0,0,0,0
S05V3,'@S05-verify at,expense,0,0,0,0
S05V4,"-1,234.00",expense,0,0,0,0
S05V5,'-S05-verify minus,expense,0,0,0,0
```

Formula-leading text (`=`, `+`, `@`, `-`) is prefixed with a single quote; the numeric text `-1,234.00` is not prefixed. Real numeric cells in the same trial-balance export (for example `1040,Accounts Receivable,asset,777.77,0,777.77,0`) are unprefixed. The demo data has no negative numeric cell, so negative numerics were checked through the numeric-text account name above.

## Cleanup

`DELETE /api/accounts/:id` for the five `S05V*` accounts: all 200. The `S05-verify bank` account and its linked GL account `1021` remain (no delete route for bank accounts; it has no transactions).

## Fix for finding 1c

Branch `claude/s05-staging-verify`: the `/bank-statements/import-preview` handler now runs `looksBinary` (on the UTF-8 bytes, and on the Latin-1 bytes when every character fits one byte, so PNG/JPEG magic arriving as a JS string is caught) and throws `DomainError("STATEMENT_CSV_REQUIRED", 400)`, the same shape as `/import`. Test: `tests/db/au6-bank-import.test.ts` (PDF and PNG-magic text give 400 `STATEMENT_CSV_REQUIRED`; a normal 2-row CSV gives 200 with `transactionCount` 2). Awaiting re-verify on staging after deploy; 1c stays FAIL on `70b223cc` until then.

## Re-verify of 1c on `5ccd96f8` (PR #235 deployed), 2026-11-28

`/api/version` reported commit `5ccd96f862b971b299437ccee01ee79d5068d0b6`. Same demo tenant and bank account.

| Request to `POST /bank-statements/import-preview` | Result |
|---|---|
| `csvContent` starting `%PDF-1.4` | 400 `STATEMENT_CSV_REQUIRED` "Choose a bank CSV export." |
| `csvContent` with PNG magic (`\u0089PNG\r\n\x1a\n…`) | 400 `STATEMENT_CSV_REQUIRED` |
| 2-row CSV (`Date,Description,Amount`) | 200, `transactionCount` 2, credit 100 / debit 25.50 |
| 1-row CSV with Arabic description | 200, `transactionCount` 1, description intact |

`GET /bank-statements/imports` afterwards: 0 batches. **1c: PASS.** All S05 checks now pass on staging.
