# Firm bulk operations API (`/api/firm/bulk/*`)

All endpoints need a signed-in firm staff member (`requireFirmAccess`: NR staff, a platform
admin, or a member of an approved accounting firm). Every request is scoped to the caller's
firm: a client of another firm is never a valid target. Viewers are read-only.

## Shared request contract (R15-07)

```jsonc
{
  "companyIds": ["<client uuid>", "..."], // optional on read endpoints, 1..500 items
  "period": "2026-Q3", // optional: "YYYY-MM", "YYYY-Qn" or "Qn YYYY"
}
```

- `companyIds` omitted: every client the caller may access (firm_owner: all clients of the
  firm; other roles: assigned clients). Endpoints that create documents require it.
- `period` omitted: the current calendar quarter. Responses report the normalised label
  (`"Q3 2026"` or `"2026-07"`).
- Unknown body keys are rejected (`strictBody`).

### Errors (same shape on every bulk endpoint)

| Status | `code`                   | When                                                                                                       |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | Bad shape: empty or non-uuid `companyIds`, unknown `period` format, unknown key. `fields` names the field. |
| 400    | `BULK_VALIDATION_ERROR`  | A required list is empty after scoping, or the CSV header is missing a column.                             |
| 403    | `BULK_COMPANY_FORBIDDEN` | One or more `companyIds` are outside the caller's scope. `details.rejectedCompanyIds`.                     |
| 403    | `FIRM_PERMISSION_DENIED` | The caller's firm role lacks the permission (see `shared/access.ts`).                                      |
| 403    | `FIRM_READ_ONLY`         | Viewer role on a write endpoint.                                                                           |

## Endpoints

| Method | Path                                | Body                                                                          | Permission           |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------- | -------------------- |
| POST   | `/api/firm/bulk/vat-queue`          | contract                                                                      | read                 |
| POST   | `/api/firm/bulk/period-close`       | contract (period now optional; previously required free text)                 | read                 |
| GET    | `/api/firm/bulk/bank-import-status` | —                                                                             | read                 |
| POST   | `/api/firm/bulk/invoices`           | contract + `serviceDescription`, `amount`, `vatRate?` (`companyIds` required) | `firm.clients.write` |
| POST   | `/api/firm/bulk/ocr`                | `{ items: [{ companyId, imageData, filename? }] }` (1..20)                    | `firm.clients.write` |
| POST   | `/api/firm/bulk/journal-import`     | `{ csv, dryRun? }`                                                            | `firm.bulk.run`      |
| POST   | `/api/firm/bulk/report-pack`        | contract                                                                      | read                 |

### Bulk journal import (R15-16)

One CSV for many clients. Header row (case-insensitive; aliases in brackets):

```
company [company_id, client], entry_ref [entry, reference, ref], date, account_code [account],
description [memo], debit, credit
```

- `company` is the client id or the exact client name (within your firm).
- Lines sharing `company` + `entry_ref` form one entry; they must share one date
  (`YYYY-MM-DD`), each line has exactly one of debit/credit (≤ 2 decimals), the entry has at
  least two lines and balances to the fils, and every account code exists in that client.
- Valid entries are posted through the ledger kernel (`postJournal`, source
  `firm_bulk_import`, idempotency key `firm-bulk:<firm>:<client>:<entry_ref>`), so re-sending
  the same file replays instead of double-posting. Invalid entries are skipped and reported.
- `dryRun: true` validates without posting.

Response (`200` when anything posted/replayed or on a dry run, else `422`):

```jsonc
{
  "summary": { "entries": 6, "posted": 2, "replayed": 0, "invalid": 4, "failed": 0 },
  "entries": [
    {
      "company": "Beta LLC",
      "entryRef": "JE-2",
      "status": "invalid",
      "rows": [6, 7],
      "errors": [{ "row": 6, "message": "Entry is not balanced: debits 100.00 vs credits 90.00" }],
    },
  ],
  "rowErrors": [{ "row": 12, "field": "date", "message": "Date must be YYYY-MM-DD" }],
}
```

Row numbers are spreadsheet rows (the header is row 1). Limits: 2 MB, 5,000 lines.

### Cross-client report pack (R15-16)

`POST /api/firm/bulk/report-pack` returns `application/zip` with one trial-balance workbook
per client for the period (from the reporting kernel) plus `index.csv`
(`client, company_id, file, balanced, total_debits, total_credits`).

## Command centre batch endpoints

`/api/firm/command-center/batch/*` take `{ companyIds: uuid[1..500] }` and need
`firm.bulk.run` (firm_owner). Requested ids outside the caller's scope are listed in
`rejectedCompanyIds`; if none are accessible the answer is `403`.
`batch/chase-documents` is NR-only (document chasing is an NR firm-management feature).
