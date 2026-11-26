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

## Signed-in UI checks

Run (UTC): 2026-11-26T14:00:26.037Z; staging https://nr-ai-staging.up.railway.app; demo account muhasib-demo-6e0a9f6a@example.com; Playwright (playwright-core 1.60.0) with local Chromium; forced failures via page.route (HTTP 500) on the named API reads; screenshots in C:/Users/arahm/AppData/Local/Temp/claude/41222dea18bab93d/e1151078-7588-42ff-ad47-a3c39dc0ed39/scratchpad/ui-shots.

| Check | Item | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|---|
| F03 | P&L en: failed read shows retryable error | testid report-pl-load-error visible, retry button present | visible; retry buttons: 1 | PASS | f03-p-l-en-failed.png |
| F03 | P&L en: failed read does not show AED 0.00 | no AED 0.00 figures in main | no zero figures | PASS | f03-p-l-en-failed.png |
| F03 | P&L en: after retry real figures show | error gone, figures rendered | error gone; main text sample: INSIGHTS Reports Financial statements, tax reports and comparisons from your books Export Books balanced Debits equal credits as of 26 Nov 2026 No period locked yet Back to reports Financial Statement | PASS | f03-p-l-en-after-retry.png |
| F03 | Balance sheet en: failed read shows retryable error | testid report-bs-load-error visible, retry button present | visible; retry buttons: 1 | PASS | f03-balance-sheet-en-failed.png |
| F03 | Balance sheet en: failed read does not show AED 0.00 | no AED 0.00 figures in main | no zero figures | PASS | f03-balance-sheet-en-failed.png |
| F03 | Balance sheet en: after retry real figures show | error gone, figures rendered | error gone; main text sample: INSIGHTS Reports Financial statements, tax reports and comparisons from your books Export Books balanced Debits equal credits as of 26 Nov 2026 No period locked yet Back to reports Financial Statement | PASS | f03-balance-sheet-en-after-retry.png |
| F03 | VAT en: failed read shows retryable error | testid report-vat-load-error visible, retry button present | visible; retry buttons: 1 | PASS | f03-vat-en-failed.png |
| F03 | VAT en: failed read does not show AED 0.00 | no AED 0.00 figures in main | no zero figures | PASS | f03-vat-en-failed.png |
| F03 | VAT en: after retry real figures show | error gone, figures rendered | error gone; main text sample: INSIGHTS Reports Financial statements, tax reports and comparisons from your books Export Books balanced Debits equal credits as of 26 Nov 2026 No period locked yet Back to reports Accountant & Taxes  | PASS | f03-vat-en-after-retry.png |
| F03 | P&L ar: failed read shows retryable error | testid report-pl-load-error visible, retry button present | visible; retry buttons: 1 | PASS | f03-p-l-ar-failed.png |
| F03 | P&L ar: failed read does not show AED 0.00 | no AED 0.00 figures in main | no zero figures | PASS | f03-p-l-ar-failed.png |
| F03 | P&L ar: English text nodes in error state | none | PDF (العربية) / PDF (الإنجليزية) / ملف Excel | N/A | f03-p-l-ar-failed.png |
| F03 | P&L ar: after retry real figures show | error gone, figures rendered | error gone; main text sample: الرؤى التقارير القوائم المالية والتقارير الضريبية والمقارنات من دفاترك تصدير الدفاتر متوازنة المدين يساوي الدائن حتى 26 نوفمبر 2026 لم تُقفل أي فترة بعد العودة إلى التقارير البيانات المالية الأرباح وا | PASS | f03-p-l-ar-after-retry.png |
| F03 | P&L ar: English text nodes in loaded main content | none | PDF (العربية) / PDF (الإنجليزية) / ملف Excel | N/A | f03-p-l-ar-after-retry.png |
| F03 | Balance sheet ar: failed read shows retryable error | testid report-bs-load-error visible, retry button present | visible; retry buttons: 1 | PASS | f03-balance-sheet-ar-failed.png |
| F03 | Balance sheet ar: failed read does not show AED 0.00 | no AED 0.00 figures in main | no zero figures | PASS | f03-balance-sheet-ar-failed.png |
| F03 | Balance sheet ar: English text nodes in error state | none | PDF (العربية) / PDF (الإنجليزية) / ملف Excel | N/A | f03-balance-sheet-ar-failed.png |
| F03 | Balance sheet ar: after retry real figures show | error gone, figures rendered | error gone; main text sample: الرؤى التقارير القوائم المالية والتقارير الضريبية والمقارنات من دفاترك تصدير الدفاتر متوازنة المدين يساوي الدائن حتى 26 نوفمبر 2026 لم تُقفل أي فترة بعد العودة إلى التقارير البيانات المالية الميزانية  | PASS | f03-balance-sheet-ar-after-retry.png |
| F03 | Balance sheet ar: English text nodes in loaded main content | none | PDF (العربية) / PDF (الإنجليزية) / ملف Excel | N/A | f03-balance-sheet-ar-after-retry.png |
| F03 | VAT ar: failed read shows retryable error | testid report-vat-load-error visible, retry button present | visible; retry buttons: 1 | PASS | f03-vat-ar-failed.png |
| F03 | VAT ar: failed read does not show AED 0.00 | no AED 0.00 figures in main | no zero figures | PASS | f03-vat-ar-failed.png |
| F03 | VAT ar: English text nodes in error state | none | none | PASS | f03-vat-ar-failed.png |
| F03 | VAT ar: after retry real figures show | error gone, figures rendered | error gone; main text sample: الرؤى التقارير القوائم المالية والتقارير الضريبية والمقارنات من دفاترك تصدير الدفاتر متوازنة المدين يساوي الدائن حتى 26 نوفمبر 2026 لم تُقفل أي فترة بعد العودة إلى التقارير المحاسب والضرائب ملخص ضريبة | PASS | f03-vat-ar-after-retry.png |
| F03 | VAT ar: English text nodes in loaded main content | none | none | PASS | f03-vat-ar-after-retry.png |
| F03 | company switch never shows prior company's totals | n/a | NOT RUN: the demo account has one company, so there is nothing to switch to | N/A |  |
| F04 | en: failed checklist read shows error (testid checklist-error) | error + retry visible | visible | PASS | f04-month-end-en-checklist-failed.png |
| F04 | en: no fabricated 0/7, All Clear, Select a period | none of them | none present | PASS | f04-month-end-en-checklist-failed.png |
| F04 | en: after retry the checklist renders | error gone, checklist/empty state shown | error gone; ACCOUNTING Month-end close Review, validate, and lock your monthly accounting period Period: October 2026 Refresh Close checklist 11/11 items complete for Oct 2 | PASS | f04-month-end-en-checklist-after-retry.png |
| F04 | en: failed history read shows its own error (history-error) | visible | visible | PASS | f04-month-end-en-history-failed.png |
| F04 | en: failed history does not say 'No period closings recorded' / history-empty | absent | absent | PASS | f04-month-end-en-history-failed.png |
| F04 | en: after retry history renders | error gone | gone; empty=false | PASS | f04-month-end-en-history-after-retry.png |
| F04 | ar: failed checklist read shows error (testid checklist-error) | error + retry visible | visible | PASS | f04-month-end-ar-checklist-failed.png |
| F04 | ar: no fabricated 0/7, All Clear, Select a period | none of them | none present | PASS | f04-month-end-ar-checklist-failed.png |
| F04 | ar: English text nodes in checklist-error state | none | muhasib-demo-6e0a9f6a@example.com | N/A | f04-month-end-ar-checklist-failed.png |
| F04 | ar: after retry the checklist renders | error gone, checklist/empty state shown | error gone; المحاسبة الإقفال الشهري راجع فترتك المحاسبية الشهرية وتحقق منها وأقفلها الفترة: أكتوبر 2026 تحديث قائمة تحقق الإقفال اكتمل 11/11 من البنود لفترة أكتوبر 2026 كل  | PASS | f04-month-end-ar-checklist-after-retry.png |
| F04 | ar: English text nodes in loaded month-end content | none | muhasib-demo-6e0a9f6a@example.com | N/A | f04-month-end-ar-checklist-after-retry.png |
| F04 | ar: failed history read shows its own error (history-error) | visible | visible | PASS | f04-month-end-ar-history-failed.png |
| F04 | ar: failed history does not say 'No period closings recorded' / history-empty | absent | absent | PASS | f04-month-end-ar-history-failed.png |
| F04 | ar: after retry history renders | error gone | gone; empty=false | PASS | f04-month-end-ar-history-after-retry.png |
| F05 | en: failed forecast shows forecast error | cashflow-forecast-error visible | visible | PASS | f05-cashflow-en-forecast-failed.png |
| F05 | en: failed forecast hides projections card | forecast-projections absent | absent | PASS | f05-cashflow-en-forecast-failed.png |
| F05 | en: after retry projections render | forecast-projections visible | visible | PASS | f05-cashflow-en-forecast-after-retry.png |
| F05 | en: failed history shows history error | cashflow-history-error visible | visible | PASS | f05-cashflow-en-history-failed.png |
| F05 | en: failed history does not show the empty message | cashflow-history-empty absent | absent | PASS | f05-cashflow-en-history-failed.png |
| F05 | en: after retry history renders (table or empty message) | error gone | gone; empty message=false | PASS | f05-cashflow-en-history-after-retry.png |
| F05 | ar: failed forecast shows forecast error | cashflow-forecast-error visible | visible | PASS | f05-cashflow-ar-forecast-failed.png |
| F05 | ar: failed forecast hides projections card | forecast-projections absent | absent | PASS | f05-cashflow-ar-forecast-failed.png |
| F05 | ar: English text nodes in forecast-error state | none | none | PASS | f05-cashflow-ar-forecast-failed.png |
| F05 | ar: after retry projections render | forecast-projections visible | visible | PASS | f05-cashflow-ar-forecast-after-retry.png |
| F05 | ar: English text nodes in loaded cash-flow content | none | none | PASS | f05-cashflow-ar-forecast-after-retry.png |
| F05 | ar: failed history shows history error | cashflow-history-error visible | visible | PASS | f05-cashflow-ar-history-failed.png |
| F05 | ar: failed history does not show the empty message | cashflow-history-empty absent | absent | PASS | f05-cashflow-ar-history-failed.png |
| F05 | ar: after retry history renders (table or empty message) | error gone | gone; empty message=false | PASS | f05-cashflow-ar-history-after-retry.png |

## Signed-in UI checks (2)

Run (UTC): 2026-11-26T14:06:38.132Z; company A Demo Trading LLC 15943f48-7ab9-4a57-af69-552d24a4d8cb; company B Demo Second LLC eb6e1f5e-d536-447c-b0a0-90c4ef7b6718 (created via POST /api/companies, one AED 777.77 zero-rated invoice INV-2026-00001 issued); forced failures via page.route; screenshots in C:/Users/arahm/AppData/Local/Temp/claude/41222dea18bab93d/e1151078-7588-42ff-ad47-a3c39dc0ed39/scratchpad/ui-shots.

| Check | Item | Expected | Observed | Result | Screenshot |
|---|---|---|---|---|---|
| F03 switch | company A P&L loads with its own figures | revenue figure shown | 14,750.20 | PASS | f03-switch-a-loaded.png |
| F03 switch | A->B while B loads (delayed 3s) and after B fails: A totals never shown | A figure 14,750.20 absent in 16 samples | never shown | PASS | f03-switch-a-to-b-failed.png |
| F03 switch | A->B failure shows B error state, not zeros | report-pl-load-error visible, no AED 0.00 | visible; zero shown=false | PASS | f03-switch-a-to-b-failed.png |
| F03 switch | after retry B shows its own figures | revenue 777.77 | 777.77 | PASS | f03-switch-b-after-retry.png |
| F03 switch | B->A while A loads (delayed) and after A fails: B totals never shown | 777.77 absent in 16 samples | never shown | PASS | f03-switch-b-to-a-failed.png |
| F03 switch | B->A failure shows A error state, not zeros | report-pl-load-error visible | visible; zero shown=false | PASS | f03-switch-b-to-a-failed.png |
| F03 switch | after retry A shows its own figures again | revenue 14,750.20 | 14,750.20 | PASS | f03-switch-a-after-retry.png |
| F05 sched | en: failed list read shows scoped retryable error | scheduled-items-load-error visible | visible | PASS | f05-sched-en-list-failed.png |
| F05 sched | en: forecast and history stay visible | projections visible, no forecast/history error | projections=true forecastErr=0 historyErr=0 | PASS | f05-sched-en-list-failed.png |
| F05 sched | en: after retry the item is listed | remove button for item visible | visible | PASS | f05-sched-en-list-after-retry.png |
| F05 sched | en: failed DELETE keeps the item, retry available | item present, button enabled again | present=true enabled=true | PASS | f05-sched-en-delete-failed.png |
| F05 sched | en: Remove not double-firing | 1 DELETE request for two clicks | DELETE requests=1; disabled while pending=true | PASS | f05-sched-en-delete-failed.png |
| F05 sched | en: successful DELETE removes the item | item gone | gone | PASS | f05-sched-en-delete-succeeded.png |
| F05 sched | en: item stays gone after a refetch (reload) | item absent | absent | PASS | f05-sched-en-after-refetch.png |
| F05 sched | en: server no longer lists the item | absent in API | absent | PASS | f05-sched-en-after-refetch.png |
| F05 sched | ar: failed list read shows scoped retryable error | scheduled-items-load-error visible | visible | PASS | f05-sched-ar-list-failed.png |
| F05 sched | ar: forecast and history stay visible | projections visible, no forecast/history error | projections=true forecastErr=0 historyErr=0 | PASS | f05-sched-ar-list-failed.png |
| F05 sched | ar: after retry the item is listed | remove button for item visible | visible | PASS | f05-sched-ar-list-after-retry.png |
| F05 sched | ar: failed DELETE keeps the item, retry available | item present, button enabled again | present=true enabled=true | PASS | f05-sched-ar-delete-failed.png |
| F05 sched | ar: Remove not double-firing | 1 DELETE request for two clicks | DELETE requests=1; disabled while pending=true | PASS | f05-sched-ar-delete-failed.png |
| F05 sched | ar: successful DELETE removes the item | item gone | gone | PASS | f05-sched-ar-delete-succeeded.png |
| F05 sched | ar: item stays gone after a refetch (reload) | item absent | absent | PASS | f05-sched-ar-after-refetch.png |
| F05 sched | ar: server no longer lists the item | absent in API | absent | PASS | f05-sched-ar-after-refetch.png |
| F05 sched | cleanup: no UI-verify scheduled items left | 0 | 0 | PASS |  |

## API checks (3)

Run (UTC): 2026-11-26T14:09:36.247Z; staging commit 9e5fa7264c41d1c4e4d6b64527eae6e519e3e1a8; company A 15943f48-7ab9-4a57-af69-552d24a4d8cb.

| Check | Item | Expected | Observed | Result | Record ids |
|---|---|---|---|---|---|
| F06-utc | lock Jan 2026 (hard, month scope); Feb open | 200 | 200  | PASS | period lock c8fffefa-0349-48c9-ad26-569bcc784938 |
| F06-utc | journal date 2026-01-31T20:30:00.000Z (1 Feb 00:30 Dubai) accepted | 200/201 | 200  | PASS | journal 5dccf35a-5e7a-4f5d-bd2f-e0925d764ffa |
| F06-utc | stored date of the 20:30Z instant | 2026-02-01 | 2026-02-01 | PASS | journal 5dccf35a-5e7a-4f5d-bd2f-e0925d764ffa |
| F06-utc | journal date 2026-01-31T19:59:00.000Z (31 Jan 23:59 Dubai) refused PERIOD_LOCKED | 4xx PERIOD_LOCKED | 403 PERIOD_LOCKED | PASS |  |
| F06-utc | reverse the posted journal | 200/201 | 200  | PASS |  |
| F06-utc | stored date of the reversal entry = today (Dubai) | 2026-11-26 | 2026-02-01 | FAIL | reversal journal a9304655-5403-466a-89d4-9c9f2f1c3a4c |
| S02-setup | create / update / issue invoice | 200 / 200 / 200 | 200 / 200 / 200 | PASS | invoice de2ea3e3-f9ec-4556-a6ec-b67705b45aed (INV-2026-00018) |
| S02-setup | create / update / post journal | 2xx x3 | 200 / 200 / 200  | PASS | journal 780d51fa-4b1d-4ad9-accc-b7ddad0dcafe |
| S01 | DELETE issued invoice refused | 4xx with reason, record kept | 409 RETENTION_NOT_EXPIRED "Record cannot be deleted before 2031-11-26 (UAE FTA 5-year retention)."; GET after=200 | PASS | invoice de2ea3e3-f9ec-4556-a6ec-b67705b45aed |
| S01 | DELETE posted journal refused | 4xx with reason, record kept | 409 ENTRY_POSTED "Posted entries cannot be deleted. Reverse or void the entry instead."; still listed=true | PASS | journal 780d51fa-4b1d-4ad9-accc-b7ddad0dcafe |
| S01-setup | create non-system account 9991 | 200/201 | 201  | PASS | account b1f12b92-b3ff-4ef3-94b8-92fb8fd1809f |
| S01 | DELETE account with transactions refused | 4xx ACCOUNT_HAS_TRANSACTIONS, account kept | 400 ACCOUNT_HAS_TRANSACTIONS; still present=true; (journal 200) | PASS | account b1f12b92-b3ff-4ef3-94b8-92fb8fd1809f; journal 87d0779e-fe62-49b7-a11f-26347c57e6be |
| S02-S03 | GET audit-log | 200 | 200 63 events | PASS |  |
| S02-S03 | invoice: audit entries exist with user + timestamp | >=2 entries (create/update/issue-post), user + at set | 3 entries: invoice.status_change@2026-11-26T14:09:25 by muhasib-demo-6e0a9f6a@example.com before=yes after=yes / invoice.update@2026-11-26T14:09:25 by muhasib-demo-6e0a9f6a@example.com before=yes after=yes / invoice.create@2026-11-26T14:09:24 by muhasib-demo-6e0a9f6a@example.com before=no after=yes | PASS | invoice de2ea3e3-f9ec-4556-a6ec-b67705b45aed |
| S02-S03 | invoice: update entry carries before and after | before and after present | invoice.update@2026-11-26T14:09:25 by muhasib-demo-6e0a9f6a@example.com before=yes after=yes | PASS | invoice de2ea3e3-f9ec-4556-a6ec-b67705b45aed |
| S02-S03 | journal: audit entries exist with user + timestamp | >=2 entries (create/update/issue-post), user + at set | 3 entries: journal.post@2026-11-26T14:09:26 by muhasib-demo-6e0a9f6a@example.com before=yes after=yes / journal.update@2026-11-26T14:09:26 by muhasib-demo-6e0a9f6a@example.com before=yes after=yes / journal.create_draft@2026-11-26T14:09:26 by muhasib-demo-6e0a9f6a@example.com before=no after=yes | PASS | journal 780d51fa-4b1d-4ad9-accc-b7ddad0dcafe |
| S02-S03 | journal: update entry carries before and after | before and after present | journal.update@2026-11-26T14:09:26 by muhasib-demo-6e0a9f6a@example.com before=yes after=yes | PASS | journal 780d51fa-4b1d-4ad9-accc-b7ddad0dcafe |
| O07 | set WPS employer settings to fixture values (13-digit establishment 1000000000123, routing 600310101) | 200 | 200  | PASS |  |
| O07 | create sample employee | 201 | 400 {"message":"Validation error","code":"VALIDATION_ERROR","fields":{"contractType":["Invalid enum value. Expected 'full_time' / 'part_time' / 'temporary' / 'flexible' / 'remote' / 'job_sharing', received 'unlimited'"]},"errors":{"contractType":["Invalid enum val | FAIL |  |
| O07 | create payroll run Jun 2026 | 201 (or 409 existing) | 201  | PASS | payroll run 531a7367-8cd8-41bc-9cc1-0fe5c9df3ae2 |
| O07 | calculate run | 200 | 422 {"message":"No active employees found for this company","code":"NO_ACTIVE_EMPLOYEES","requestId":"2c014c00-4bf1-4df8-905a-5707bd534b97"} | FAIL |  |
| O07 | SIF pre-validation ready | ready true | 409 {"message":"Calculate the payroll run before generating the SIF","code":"PAYROLL_RUN_NOT_CALCULATED","details":{"status":"draft"},"requestId":"5f1c8059-1e6f-4908-9356-2c12bbfcd1c7"} | FAIL |  |
| O07 | generate SIF | 204 | 409 | FAIL |  |
| O07 | download SIF; CRLF separators | CRLF, no bare LF | status 409; CRLF=false; bare LF=false; records=1 | FAIL |  |
| O07 | SCR line length (brief expects 165) | 165 | no SCR | FAIL |  |
| O07 | EDR line length (brief expects 229) | 229 | no EDR | FAIL |  |

- unlock Jan 2026: 200 open
- audit-log/verify: 200 {"chainKey":"15943f48-7ab9-4a57-af69-552d24a4d8cb","ok":true,"checked":63,"legacyRows":0,"headSeq":63,"headHash":"5108e3aae3114aa15aab4c68966dbedc98e49ebd9dbe451fe384a9baa43951e9","firstBroken":null,"pendingRows":0,"verifiedAt":"2026-11-26T14:09:33.065Z"}
- SIF structure (identifiers are fixture/fictional): EDR=undefined  SCR=undefined; EDR fields=undefined, SCR fields=undefined

## API checks (3) - rerun of O07 plus reversal-date probe

Run (UTC): 2026-11-26T14:09:57.049Z; staging commit 9e5fa7264c41d1c4e4d6b64527eae6e519e3e1a8; company A 15943f48-7ab9-4a57-af69-552d24a4d8cb.

| Check | Item | Expected | Observed | Result | Record ids |
|---|---|---|---|---|---|
| F06-utc | reverse with explicit date=today (Dubai): stored reversal date | 2026-11-26 | 2026-11-26 | PASS | journal bb8f00e7-9957-49e6-9d3e-f9029a1a0e08; reversal 844ea1a6-7aaa-4fb0-a58a-ed82d7c4976d |
| O07 | set WPS employer settings to fixture values (13-digit establishment 1000000000123, routing 600310101) | 200 | 200  | PASS |  |
| O07 | create sample employee | 201 | 201  | PASS | employee 4f8820b6-4d30-47a7-81d8-fb7fb597afd3 |
| O07 | create payroll run Jun 2026 | 201 (or 409 existing) | 409 {"message":"A payroll run already exists for this period","code":"PAYROLL_RUN_EXISTS","requestId":"6dd5ccbe-ae64-4c01-b0ef-6f4cd8b73404"} | PASS | payroll run 531a7367-8cd8-41bc-9cc1-0fe5c9df3ae2 |
| O07 | calculate run | 200 | 200  | PASS |  |
| O07 | SIF pre-validation ready | ready true | 200 {"ready":true,"issues":[]} | PASS |  |
| O07 | generate SIF | 204 | 204 | PASS |  |
| O07 | download SIF; CRLF separators | CRLF, no bare LF | status 200; CRLF=true; bare LF=false; records=2 | PASS |  |
| O07 | SCR line length (brief expects 165) | 165 | 71 | FAIL |  |
| O07 | EDR line length (brief expects 229) | 229 | 92 | FAIL |  |

- SIF structure (identifiers are fixture/fictional): EDR=EDR,10012345678901,600310101,AE070331234567890123456,2026-06-01,2026-06-30,30,6250.00,0.00,0  SCR=SCR,1000000000123,600310101,2026-11-26,1409,062026,1,6250.00,AED,062026; EDR fields=10, SCR fields=10

## O03 staging timing

Run (UTC): 2026-11-26T14:13:46.807Z; staging commit 9e5fa7264c41d1c4e4d6b64527eae6e519e3e1a8; company 15943f48-7ab9-4a57-af69-552d24a4d8cb; client = this PC to Railway staging over the public internet (wall-clock includes network + TLS).

Dataset seeded: 50 approved AED bills, vendor "Perf Vendor", bill numbers PF-MWXMU0YJ-000..049, vat 0 (bill ids 14cb1977-9fc5-46e0-b424-53f8ec31d17c .. 2bb26131-571f-4446-86c4-7af7273eb8ff). Aging totals before seeding: [0,0,0,0].

| Measure | Expected | Observed | Result |
|---|---|---|---|
| Bucket totals current / 1-30 / 31-60 / 90+ (delta vs before) | 5000 / 15000 / 22500 / 20000 | 5000 / 15000 / 22500 / 20000 (absolute 5000 / 15000 / 22500 / 20000) | PASS |
| Bucket counts (cur/1-30/31-60/90+) | 10 / 15 / 15 / 10 | 10 / 15 / 15 / 10 | info |
| bills/aging wall-clock p50 (n=20, after 2 warm-ups) | n/a | 247.2 ms | info |
| bills/aging wall-clock p95 | n/a | 313.2 ms (max 536.7) | info |
| /health/live wall-clock p50 (n=20, interleaved) | baseline | 210.7 ms | info |
| /health/live wall-clock p95 | baseline | 236.0 ms | info |
| approximate server cost = p95(aging) - p95(health/live) | Postgres budget 101 ms (test) | 77.2 ms | within 101 ms |
| p50 difference | n/a | 36.5 ms | info |
| Server-Timing / X-Response-Time header | n/a | not present on the response | info |

Samples aging (ms): 536.7, 251.3, 239.7, 256.1, 240.0, 237.6, 240.0, 240.8, 233.4, 237.1, 231.9, 245.5, 313.2, 304.4, 295.4, 265.7, 274.4, 247.2, 248.6, 237.5
Samples health/live (ms): 201.8, 210.7, 201.6, 218.9, 218.5, 200.4, 208.0, 236.0, 206.6, 214.8, 199.7, 1393.6, 226.5, 234.6, 206.5, 209.1, 201.5, 210.7, 211.0, 205.8

## F02 effective returns

Run (UTC): 2026-11-26T14:15:30.021Z; staging commit 9e5fa7264c41d1c4e4d6b64527eae6e519e3e1a8; company 15943f48-7ab9-4a57-af69-552d24a4d8cb; period 2026-01-01..2026-03-31; manual references TEST-REF-0001/0002 (no FTA transmission, no settlement).

| Item | Expected | Observed | Result |
|---|---|---|---|
| seed: issue AED 10,000 + 5% invoice dated 2026-02-10 | 200 / 200 | 200 / 200  | PASS |
| 1. generate return Q1 2026 | 201 | 201 box1/box14= payable 500; status draft | PASS |
| 1. submit original with TEST-REF-0001 | 200, status submitted/filed, transmittedByMuhasib=false | 200 status=filed transmitted=false channel=manual-emaratax  | PASS |
| 2. issue credit note AED 1,000 + 5% dated 2026-02-20 (Q1) | 201 | 409 {"message":"The VAT return for 2026-01-01 to 2026-03-31 has been filed, so this VAT period is closed. Date the document on or after 2026-04-01: a net tax difference of up to AED 10,000 is corrected in that period's return (Executive Regulation Art. 70). Above AED 10,000, open a voluntary disclosure (amend the filed return) f | FAIL |

Records: invoice 9f19cbec-f94c-457a-9794-713d59261cae (INV-2026-00019); vat return original 8b9238d8-77ea-4528-9119-a829479486d9

- Q1 2026 returns before the run: 0
- period-lock before: {"lockThroughDate":null,"fiscalYearStartMonth":1,"currentFiscalYearStart":"2026-01-01","locks":[],"fiscalYears":[]}
- original draft boxes: {"box1aAbuDhabiAmount":0,"box1aAbuDhabiVat":0,"box1aAbuDhabiAdj":0,"box1bDubaiAmount":10000,"box1bDubaiVat":500,"box1bDubaiAdj":0,"box1cSharjahAmount":0,"box1cSharjahVat":0,"box1cSharjahAdj":0,"box1dAjmanAmount":0,"box1dAjmanVat":0,"box1dAjmanAdj":0,"box1eUmmAlQuwainAmount":0,"box1eUmmAlQuwainVat":0,"box1eUmmAlQuwainAdj":0,"box1fRasAlKhaimahAmount":0,"box1fRasAlKhaimahVat":0,"box1fRasAlKhaimahAdj":0,"box1gFujairahAmount":0,"box1gFujairahVat":0,"box1gFujairahAdj":0,"box8TotalAmount":10000,"box8TotalVat":500,"box8TotalAdj":0,"box10ReverseChargeAmount":0,"box10ReverseChargeVat":0,"box11TotalAmount":0,"box11TotalVat":0,"box11TotalAdj":0,"box12TotalDueTax":500,"box13RecoverableTax":0,"box14PayableTax":500,"box1SalesStandard":10000,"box8TotalInputTax":0}
- period-lock after submitting original: {"lockThroughDate":null,"fiscalYearStartMonth":1,"currentFiscalYearStart":"2026-01-01","locks":[],"fiscalYears":[]}
- credit note body: {"message":"The VAT return for 2026-01-01 to 2026-03-31 has been filed, so this VAT period is closed. Date the document on or after 2026-04-01: a net tax difference of up to AED 10,000 is corrected in that period's return (Executive Regulation Art. 70). Above AED 10,000, open a voluntary disclosure (amend the filed return) first; the period re-open

## F02 effective returns

Run (UTC): 2026-11-26T14:16:15.429Z; staging commit 9e5fa7264c41d1c4e4d6b64527eae6e519e3e1a8; company 15943f48-7ab9-4a57-af69-552d24a4d8cb; period 2026-01-01..2026-03-31; manual references TEST-REF-0001/0002 (no FTA transmission, no settlement).

First attempt (staging-f02.mjs): issued AED 10,000 + 5% invoice dated 2026-02-10 (INV, VAT 500), generated and submitted the return as TEST-REF-0001 (status filed, transmittedByMuhasib=false, channel manual-emaratax); the credit note dated 2026-02-20 was then refused 409 (filed VAT period closed; see rows below). The rerun amends first, as the refusal message prescribes.

| Item | Expected | Observed | Result |
|---|---|---|---|
| resume: original Q1 return filed in the earlier run (TEST-REF-0001) | status filed, ref TEST-REF-0001 | 8b9238d8-77ea-4528-9119-a829479486d9 filed TEST-REF-0001 payable 500 | PASS |
| 2. amend filed original (reason 'staging F02 check') | 201, draft referencing original (amendsReturnId) | 409 status=undefined amendsReturnId=undefined payable=undefined {"message":"A record with this value already exists","code":"DUPLICATE_VALUE","requestId":"90e6578b-3af0-4791-af4b-6d0229f36b47"} | FAIL |
| run | no error | Cannot read properties of undefined (reading 'slice') | FAIL |

Records: vat return original 8b9238d8-77ea-4528-9119-a829479486d9; invoice 9f19cbec-f94c-457a-9794-713d59261cae (INV-2026-00019); vat return amendment undefined


## Public site sweep (council, browser pane, 2026-11-26 ~13:45 UTC)

All 88 sitemap URLs (`/en/*` and `/ar/*`) rendered in the SPA and scanned for: ZATCA, Saudi (EN/AR), A-Cube, Complyance, OFX, QIF, MT940, "PDF statement", AED 49/149/299. **0 hits.**
`/en/pricing`: AED 59 / 119 / 229; "Try Enterprise free for 14 days with no card"; "When your trial ends, your workspace becomes read-only until you activate a paid plan"; "e-invoicing included on every plan"; "bank CSV import". `/en/product/bank-reconciliation`: "Upload a CSV exported from your bank".
Headers on `/en` (commit 448dcac1): HSTS 1 year + includeSubDomains, nonce CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (unchanged from S06 capture). Framing of the public pages from the same origin is refused (`frame-ancestors 'none'` enforced).

## Notes

- S05 wording: a blank-amount row is reported in `parseErrors` ("Row N: Missing amount"); explicit zero-value rows count in `skippedRows`. Both are visible to the caller, which is the S05 fix; the register wording is corrected accordingly.
- Screenshots (43 PNG, demo tenant) are kept outside the repo in the session scratchpad `ui-shots/`.
- F06 does not discriminate UTC from Dubai at 13:41 UTC (same calendar date). A run between 20:00 and 24:00 UTC is needed to prove the undated default uses the Dubai date on staging.
- F02: submit never transmits (records a manual EmaraTax reference), so it is testable on staging; see "F02 effective returns" above for the result.
- Demo tenant data left on staging: invoices INV-2026-00001..~00027, credit notes, payments, customer credits, one USD→AED 3.6725 rate, fixture TRN 100000000000003 on the demo company; Feb 2026 lock removed after the F06 check.
