# FTA Audit File (FAF) export

`GET /api/companies/:companyId/reports/faf?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=json]`
(service: `server/services/faf-export.service.ts`, test: `tests/db/faf-export.test.ts`).

**Generated for upload/inspection — not transmitted to FTA.** Muhasib.ai does not submit the
file anywhere. The response carries `X-FAF-Notice` and the JSON form carries the same `label`.

> **Verify against the current FTA specification (EXTERNAL).** The markers and field names
> below were written from the 2017/2018 FTA FAF User Guide. A re-check against the current
> edition was attempted in the S5 sweep (2026-11) but tax.gov.ae was not reachable from the
> build environment, so the layout is unverified against the latest edition. The JSON form
> carries this as `specNotice` (`FAF_SPEC_NOTICE`). Re-check and adjust before relying on the
> file for an audit request.

## Source

Field names and section order follow the FTA's _Tax Audit File (FAF) — User Guide_ published
for the UAE VAT Tax Accounting Software accreditation (FTA, 2017/2018 editions: Company
Information, Purchase Listing, Supply Listing and General Ledger sections, each with a
footer of totals and a transaction count). The FTA may revise the guide; check the current
edition on tax.gov.ae before relying on the layout for an audit request. Anything the guide
asks for that the ledger does not hold (permit numbers, tax agency/agent names, foreign
currency per line) is written as an empty field or the AED value, never invented.

## Layout

Comma-separated text (RFC 4180 quoting), CRLF line endings, amounts in AED with two decimals.
Each section is delimited by marker lines:

| Section             | Markers                         | Header row                                                                                                                                                                        | Footer row                                                  |
| ------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Company information | `CompInfoStart` / `CompInfoEnd` | CompanyName, TaxablePersonNameEn, TRN, TaxAgencyName, TaxAgentName, PeriodStart, PeriodEnd, FAFCreationDate, ProductVersion, FAFVersion                                           | —                                                           |
| Purchase listing    | `PurcDataStart` / `PurcDataEnd` | SupplierName, SupplierTRN, InvoiceDate, InvoiceNo, PermitNo, TransactionID, LineNo, ProductDescription, PurchaseValueAED, VATValueAED, TaxCode, FCYCode, PurchaseFCY, VATFCY      | PurchaseTotalAED, VATTotalAED, TransactionCountTotal        |
| Supply listing      | `SuppDataStart` / `SuppDataEnd` | CustomerName, CustomerTRN, InvoiceDate, InvoiceNo, PermitNo, TransactionID, LineNo, ProductDescription, SupplyValueAED, VATValueAED, TaxCode, Country, FCYCode, SupplyFCY, VATFCY | SupplyTotalAED, VATTotalAED, TransactionCountTotal          |
| General ledger      | `GLDataStart` / `GLDataEnd`     | TransactionDate, AccountID, AccountName, TransactionDescription, Name, TransactionID, SourceDocumentID, SourceType, Debit, Credit, Balance                                        | TotalDebit, TotalCredit, TransactionCountTotal, GLTCurrency |

`FAFVersion` is `FAFv1.0.0`; `ProductVersion` is `Muhasib.ai`.

## Where each record comes from

- **Supply listing** — VAT-engine (`server/tax/vat-engine.ts` `computeVat201`) contributions
  with source `invoice`, `credit_note`, `debit_note` or `fixed_asset_disposal`: one record per
  document (LineNo 1), value = Box 1/2/4/5 amounts, VAT = Box 1/2 VAT, tax code from the
  stored supply classification (`SR` standard, `ZR` zero-rated, `EX` exempt, `RC` domestic
  reverse charge). Customer TRN is the document's counterparty TRN.
- **Purchase listing** — VAT-engine contributions with source `bill`, `receipt` or
  `vendor_debit_note`: value = Box 9 (or Box 3/6 for reverse charge/imports), VAT = the
  recoverable input VAT (Box 9 + Box 10), tax code `SR`, `RC`, `IM` or `ZR`. Purchases with no
  recoverable VAT do not enter the return and are not listed.
- **General ledger** — every posted journal line in the period from
  `generalLedger` in `server/reporting/statements.ts` (closing entries excluded), ordered by date then entry
  number; Balance is the running account balance.

## Reconciliation (JSON `reconciliation`)

- `vat201OutputVatFils` (Box 1 + Box 2 VAT on the return) = listed supply VAT + output VAT from
  return-only adjustments and reverse-charge/import self-accounting.
- `vat201RecoverableVatFils` (Box 9 + Box 10) = listed purchase VAT + recoverable adjustments.
- `supplyVatDifferenceFils` / `purchaseVatDifferenceFils` should be 0; a non-zero value means a
  contribution type the listing does not classify.
- GL footer debit = credit, and for a period containing all activity it equals the trial
  balance gross debits.

## Known limits

Per-line detail (one record per invoice line), permit numbers for customs imports, foreign
currency amounts per line, and the Arabic taxable-person name are not yet emitted.
