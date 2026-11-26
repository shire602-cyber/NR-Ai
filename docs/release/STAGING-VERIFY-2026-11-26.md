# Staging verification evidence (PR #169 accounting fixes)

- Staging: https://nr-ai-staging.up.railway.app
- /api/version: `{"status":"ok","version":"1.0.0","commit":"448dcac1fba9217ed1cf2c9f5e89d9eed6ad5d06","environment":"production","uptime":247.854706648}`
- Run started (UTC): 2026-11-26T13:41:00.608Z  finished: 2026-11-26T13:41:15.004Z
- Demo account: muhasib-demo-6e0a9f6a@example.com
- Company: Demo Trading LLC (15943f48-7ab9-4a57-af69-552d24a4d8cb), base currency AED
- Dubai business date at run: 2026-11-26; UTC date: 2026-11-26

## F01: Document-level rounding: 2 x AED 0.10 @ 5%

Result: PARTIAL (some rows blocked/N/A) (2 rows, 0 failed)

| Item | Expected | Observed | Result |
|---|---|---|---|
| draft API response | vat 0.02, total 0.22 | {"subtotal":0.2,"vatAmount":0.02,"total":0.22} | PASS |
| BLOCKED: cannot issue VAT invoice | issued + posted | company has no TRN, so a 5% invoice cannot be issued (SUPPLIER_TRN_REQUIRED); adding a TRN would change company settings, not done | N/A |

Records created: invoice ca18d4a0-764c-446e-aad0-653d0dc3d8ff (INV-2026-00010)

- ABORTED: issue ca18d4a0-764c-446e-aad0-653d0dc3d8ff 422 {"message":"Your company has no Tax Registration Number (TRN), so it cannot charge VAT. Set the VAT on each line to 0% (out of scope), or add your 15-digit TRN in Company settings before issuing a tax invoice with VAT.","code":"SUPPLIER_TRN_REQUIRED","details":{"settingsPath":"/company-profile","fields":{"trnVatNumber":["Company TRN is required"]}},"requestId":"894b0315-f377-4bc9-a939-02d39bbfb1b0"}

## F07: FX credit notes and payments (USD @ 3.6725)

Result: PARTIAL (some rows blocked/N/A) (2 rows, 0 failed)

| Item | Expected | Observed | Result |
|---|---|---|---|
| set tenant rate USD->AED 3.6725 | 200/201 | 200 {"id":"e41f67a8-5351-4d95-bb4e-10eca13bf7b3","companyId":"15943f48-7ab9-4a57-af69-552d24a4d8cb","scope":"company","fromCurrency":"USD","toCurrency":"AED","baseCurrency":"USD","targetCurrency":"AED","r | PASS |
| BLOCKED: cannot issue VAT invoice | issued + posted | company has no TRN, so a 5% invoice cannot be issued (SUPPLIER_TRN_REQUIRED); adding a TRN would change company settings, not done | N/A |

Records created: exchange-rate e41f67a8-5351-4d95-bb4e-10eca13bf7b3; invoice A 34dc58d9-7351-4489-90d6-b99d9e4c31d3 (INV-2026-00012)

- ABORTED: issue 34dc58d9-7351-4489-90d6-b99d9e4c31d3 422 {"message":"Your company has no Tax Registration Number (TRN), so it cannot charge VAT. Set the VAT on each line to 0% (out of scope), or add your 15-digit TRN in Company settings before issuing a tax invoice with VAT.","code":"SUPPLIER_TRN_REQUIRED","details":{"settingsPath":"/company-profile","fields":{"trnVatNumber":["Company TRN is required"]}},"requestId":"b392be5f-5ecb-4cf1-862b-159100b6125f"}

## F07b: FX credit notes (zero-rated USD 1,000 invoice only; runs without a company TRN)

Result: PASS (14 rows, 0 failed)

| Item | Expected | Observed | Result |
|---|---|---|---|
| set tenant rate USD->AED 3.6725 | 200/201 | 200 | PASS |
| orig 1040 (1000 x 3.6725) | 3672.5 | 3672.5 | PASS |
| orig 4060 zero-rated revenue | -3672.5 | -3672.5 | PASS |
| partial CN USD 400 status | 201 | 201 | PASS |
| partial CN 1040 (400 x 3.6725) | -1469 | -1469 | PASS |
| partial CN 4060 reversed (zero-rated, not 4020) | 1469 | 1469 | PASS |
| partial CN exchangeRate (exact) | 3.6725 | 3.6725 | PASS |
| partial CN header baseCurrencyAmount == posted A/R | -1469 | -1469 | PASS |
| final CN status | 201 | 201 | PASS |
| final CN 1040 (remaining 2203.50) | -2203.5 | -2203.5 | PASS |
| final CN 4060 | 2203.5 | 2203.5 | PASS |
| final CN header baseCurrencyAmount == posted A/R | -2203.5 | -2203.5 | PASS |
| invoice net after both credits, 1040 | 0 | 0 | PASS |
| invoice net after both credits, 4060 | 0 | 0 | PASS |

Records created: invoice 00f08100-553f-4f74-97c8-01d1a4eeaf50 (INV-2026-00011); journal 6321224f-e674-4999-8cfd-f69d23a4b19b; credit note partial 02bb17bb-b193-4f8a-a733-ac83e1c9de45; journal 6066ecff-d20b-4b38-a2ad-f67ea3f50be2; credit note final c225f9ed-21e7-4bc4-b679-96c079280d83; journal 4ba5cfe5-f368-4370-929c-f72a16ea6910


## F07p: FX payments: gain on 4090, overpayment to customer credit 2055

Result: PASS (10 rows, 0 failed)

| Item | Expected | Observed | Result |
|---|---|---|---|
| payment at 3.68 status | 201 | 201 | PASS |
| pay@3.68 1020 bank debit | 3680 | 3680 | PASS |
| pay@3.68 1040 A/R credit | -3672.5 | -3672.5 | PASS |
| pay@3.68 4090 FX gain | -7.5 | -7.5 | PASS |
| overpayment USD 1,100 @3.68 status | 201 | 201 | PASS |
| overpay 1020 | 4048 | 4048 | PASS |
| overpay 1040 | -3672.5 | -3672.5 | PASS |
| overpay 2055 customer credit liability | -368 | -368 | PASS |
| overpay 4090 FX gain | -7.5 | -7.5 | PASS |
| customer credit created, remaining USD 100 | remaining 100 | {"id":"6b06bba8-f167-4632-9ff9-0359da8796b1","remaining":100} | PASS |

Records created: invoice B 6f9502a3-5d33-4f5f-a7e1-2ef6b9319f73 (INV-2026-00013); payment b792f2c6-175a-4bce-b805-aeec0f103a40; journal c3e40e29-59e0-4d81-abc6-e14d3fb3a539; invoice C 3df582a3-8228-4c99-b513-89a361e8b8c3 (INV-2026-00014); payment 3e896a30-0f52-4ed2-b007-960ce539fa7b; journal 81c7139d-3029-45f5-8404-1b43f9831f95; customer-credit 6b06bba8-f167-4632-9ff9-0359da8796b1


## F06: Period lock and UAE (Asia/Dubai) business date

Result: PASS (7 rows, 0 failed)

| Item | Expected | Observed | Result |
|---|---|---|---|
| lock Feb 2026 (month scope, hard) | 200 | 200 {"id":"5ac6ee68-de51-43f2-9bae-3b94d256b5ea","companyId":"15943f48-7ab9-4a57-af69-552d24a4d8cb","periodEnd":"2026-02-28","status":"locked","closedBy":"2d46adb6-12ce-4460-9a5a-729ed9ec04ac","closedAt":"2026-11-26 13:41:10.097801","closingEntryId":null | PASS |
| journal dated 2026-02-15 (locked) refused | 4xx | 403 {"message":"Cannot post to locked period (02/2026). Unlock the period first.","code":"PERIOD_LOCKED","details":{"lockedThrough":"2026-02-28","lockType":"hard","lockScope":"month"},"requestId":"1b92c087-8995-45d2-8168-4438c39e9eb0"} | PASS |
| journal dated today (2026-11-26) accepted | 200/201 | 200 {"id":"2f445a2c-cd78-4173-94c3-f786378cfbae","entryNumber":"JE-20261126-019","status":"posted","approvalStatus":null,"replayed":false,"message":"Journal entry posted successfully"} | PASS |
| stored journal date | 2026-11-26 | 2026-11-26 | PASS |
| credit note without date accepted | 201 | 201 | PASS |
| undated credit note date = Dubai today | 2026-11-26 | 2026-11-26 | PASS |
| undated credit note journal date = Dubai today | 2026-11-26 | 2026-11-26 | PASS |

Records created: period lock 5ac6ee68-de51-43f2-9bae-3b94d256b5ea; journal 2f445a2c-cd78-4173-94c3-f786378cfbae; invoice 1d740f5f-f523-48c0-900a-d060940cb0dc (INV-2026-00015); credit note 587ee2af-90a7-4534-a346-b6c64d294472; journal fa12d713-f281-4387-9f84-bbd1d68406eb

- run clock: UTC date 2026-11-26, Dubai date 2026-11-26 (dates coincide now, so the UTC-vs-Dubai default cannot be discriminated at this hour)
- cleanup unlock Feb 2026: 200 {"id":"5ac6ee68-de51-43f2-9bae-3b94d256b5ea","companyId":"15943f48-7ab9-4a57-af69-552d24a4d8cb","periodEnd":"2026-02-28","status":"open","closedBy":"2d46adb6-12ce-4460-9a5a-729ed9ec04ac","closedAt":"2

## F02: Superseded VAT return not double counted

Result: NOT VERIFIABLE (1 rows, 0 failed)

| Item | Expected | Observed | Result |
|---|---|---|---|
| supersession double-count check | AED 9,000 counted once | not verifiable on staging (needs real submission boundary) | N/A |

Records created: none

- GET vat-returns: 200, 0 existing rows
- NOT VERIFIABLE ON STAGING: an 'effective' version only exists once a return is submitted/filed (status submitted/filed, superseding via amended status). Those transitions go through the FTA submission boundary (filing lifecycle), which must not be exercised here. POST vat-returns/generate only produces a draft, and drafts/pending amendments are by design ignored by the effective-version selection, so creating drafts cannot demonstrate supersession. Covered by tests/unit/vat-effective-returns.test.ts only.

## S05/O04: Bank statement import-preview: BOM, skipped rows, no writes

Result: PASS (5 rows, 0 failed)

| Item | Expected | Observed | Result |
|---|---|---|---|
| A (BOM, Debit/Credit/Balance) status | 200 | 200 | PASS |
| A transactionCount | 1 | 1 | PASS |
| A skippedRows reported (blank + zero amount rows) | >=1 | 1 | PASS |
| bank transactions count unchanged | 0 | 0 | PASS |
| import batches unchanged | 0 | 0 | PASS |

Records created: none

- A response: {"transactionCount":1,"skippedRows":1,"format":"generic","parseErrors":["Row 3: Missing amount"],"preview":[{"date":"2026-11-01","description":"Preview valid deposit","debit":0,"credit":100}]}
- B (single Amount column, blank amount) response: 200 {"transactionCount":1,"skippedRows":0,"format":"generic","parseErrors":["Row 3: Missing amount"],"preview":[{"date":"2026-11-01","description":"Preview valid deposit","debit":0,"credit":100}]}

## Rerun with fixture TRN

- Run (UTC): 2026-11-26T13:42:24.242Z; staging commit 448dcac1fba9217ed1cf2c9f5e89d9eed6ad5d06; company 15943f48-7ab9-4a57-af69-552d24a4d8cb; TRN set to fixture 100000000000003 via PATCH /api/companies/:id (approved by coordinator)

| Item | Expected | Observed | Result |
|---|---|---|---|
| set company TRN to fixture value | 200 | 200  | PASS |
| F01 draft create | 200 | 200 | PASS |
| F01 API vat/total | 0.02 / 0.22 | {"vat":0.02,"total":0.22} | PASS |
| F01 issue | 200 | 200  | PASS |
| F01 journal 1040 (A/R gross) | 0.22 | 0.22 | PASS |
| F01 journal 2020 (VAT output) | -0.02 | -0.02 | PASS |
| F01 journal revenue total | -0.2 | -0.2 | PASS |
| F07 draft create | 200 | 200 | PASS |
| F07 issue | 200 | 200  | PASS |
| orig 1040 | 3801.04 | 3801.04 | PASS |
| orig 4020 std revenue | -2570.75 | -2570.75 | PASS |
| orig 4060 zero-rated | -1101.75 | -1101.75 | PASS |
| orig 2020 VAT | -128.54 | -128.54 | PASS |
| partial CN status | 201 | 201  | PASS |
| partial CN 1040 | -1349.65 | -1349.65 | PASS |
| partial CN 4020 | 1285.38 | 1285.38 | PASS |
| partial CN 2020 | 64.27 | 64.27 | PASS |
| partial CN exchangeRate exact | 3.6725 | 3.6725 | PASS |
| partial CN header baseCurrencyAmount = posted A/R | -1349.65 | -1349.65 | PASS |
| remaining CN status | 201 | 201  | PASS |
| final CN 1040 | -2451.39 | -2451.39 | PASS |
| final CN 4020 | 1285.37 | 1285.37 | PASS |
| final CN 4060 | 1101.75 | 1101.75 | PASS |
| final CN 2020 | 64.27 | 64.27 | PASS |
| final CN exchangeRate exact | 3.6725 | 3.6725 | PASS |
| final CN header baseCurrencyAmount = posted A/R | -2451.39 | -2451.39 | PASS |
| invoice net after both credits 1040 | 0 | 0 | PASS |
| invoice net after both credits 4020 | 0 | 0 | PASS |
| invoice net after both credits 4060 | 0 | 0 | PASS |
| invoice net after both credits 2020 | 0 | 0 | PASS |

Records created: F01 invoice 47b35d02-7383-46d0-beb2-6966664b570f (INV-2026-00016); F01 journal 222f6515-5414-4dc5-87c6-833083bb12a9; F07 invoice ec46e27b-0309-49ab-859d-d8d615e207bb (INV-2026-00017); F07 journal 2cd2c0a0-86ef-424b-8241-f6ca8ca07918; F07 CN partial 3c1127fb-7d4c-4b2a-af60-b5acf16a2419; F07 journal 65fc295b-528b-4d45-af40-1f0d68258c9a; F07 CN final 2309260c-7b58-4f17-a612-8ca9ee64e06b; F07 journal fe31206b-c766-4713-9cae-45a89eeae6ef

- TRN before: (none)
- F01 journal lines: 1040 D0.22 C0; 4020 D0 C0.2; 2020 D0 C0.02
- F07 orig legs: {"1040":3801.04,"2020":-128.54,"4020":-2570.75,"4060":-1101.75}

## Public site sweep (council, browser pane, 2026-11-26 ~13:45 UTC)

All 88 sitemap URLs (`/en/*` and `/ar/*`) rendered in the SPA and scanned for: ZATCA, Saudi (EN/AR), A-Cube, Complyance, OFX, QIF, MT940, "PDF statement", AED 49/149/299. **0 hits.**
`/en/pricing`: AED 59 / 119 / 229; "Try Enterprise free for 14 days with no card"; "When your trial ends, your workspace becomes read-only until you activate a paid plan"; "e-invoicing included on every plan"; "bank CSV import". `/en/product/bank-reconciliation`: "Upload a CSV exported from your bank".
Headers on `/en` (commit 448dcac1): HSTS 1 year + includeSubDomains, nonce CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (unchanged from S06 capture). Framing of the public pages from the same origin is refused (`frame-ancestors 'none'` enforced).

## Notes

- S05 wording: a blank-amount row is reported in `parseErrors` ("Row N: Missing amount"); explicit zero-value rows count in `skippedRows`. Both are visible to the caller, which is the S05 fix; the register wording is corrected accordingly.
- F06 does not discriminate UTC from Dubai at 13:41 UTC (same calendar date). A run between 20:00 and 24:00 UTC is needed to prove the undated default uses the Dubai date on staging.
- F02 needs a submitted/filed return, which crosses the FTA submission boundary; not verifiable on staging.
- Demo tenant data left on staging: invoices INV-2026-00001..~00027, credit notes, payments, customer credits, one USD→AED 3.6725 rate, fixture TRN 100000000000003 on the demo company; Feb 2026 lock removed after the F06 check.
