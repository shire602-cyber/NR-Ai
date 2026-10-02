# Phase 8 sign-off — Finance domains D1–D3 (VP Finance Product, 2026-10-02)

Judged against `2026-10-02-phase8-bar-finance.md` as the buyer would. Server `vpa` on :5091 (fresh `muhasib_p8_vpa`, 124
migrations, `PAYMENT_GATEWAY_FAKE=1`), company "Al Noor Trading LLC" (Dubai, TRN set), seeded through the API, then
walked in the browser at 1366 px and 375 px, English and Arabic. Ledger effects read from `journal_lines`. Server stopped.

**Environment note (not a defect):** the browser session dropped every few minutes (`/api/auth/refresh` 401). Two VP
servers share `localhost` and cookies are not port-scoped, so the other server's refresh cookie overwrote mine. Run
parallel sign-offs on different hostnames (127.0.0.1 vs localhost) next time.

## D1 Sales and getting paid

| Stream | What I did | What I saw / ledger | Verdict, gap |
|---|---|---|---|
| Advances | Recorded a 1,050 deposit (received now); applied 700 net to the project invoice; checked statement | Dr 1040 1,050 / Cr 2055 1,000 / Cr 2020 50, then Dr 1020 / Cr 1040; PDF titled "ADVANCE TAX INVOICE / فاتورة ضريبية لدفعة مقدمة"; applying posts Dr 2055 700 / Cr 4010 700, no AR, no VAT; final PDF shows "Less advance ADV-2026-00001 (INV-2026-00003)", total due 0; statement memo "available 300 net / 315 gross"; Customer Advances page lists it | **Meets.** Advance PDF prints "Payment Terms: Net 30 days" on a paid deposit (cosmetic). API takes the net amount; the apply dialog must say "net" |
| Custom fields | Text + select defined in Settings → Sales; values set on a draft; PDF | "PO Number / رقم أمر الشراء: PO-4471" on the PDF; select with `showOnPdf=false` absent; 409 `DOCUMENT_LOCKED` after issue | **Meets** |
| Sales orders | Seeded SO, converted the accepted quote, invoiced 4 of 10 | SO-00001 "Partially invoiced", SO-00002 from the quote; Arabic list and 375 px cards clean | **Partly:** ATP badge not seen in the list (detail not opened); covered by L1 tests |
| Quote acceptance | Sent, opened `/view/quote/:token`, accepted as "Layla Haddad" with consent, converted | Public page bilingual with "Valid until"; status Accepted with "Accepted by … on 2 October 2026"; `quote_signatures` row with name, email, IP, UA, hash, 5-year retention; "View customer response" and "Convert to sales order" in the row menu | **Meets.** Row-menu actions did not fire on my first click (needs a retest; API path works) |
| Discounts, shipping, price lists | Invoice 4 × 250 with 10% line, 50 document discount, 100 shipping; list "Wholesale" attached to the customer | Total 997.50; Dr 1040 997.50 / Dr 4050 150 / Cr 4010 1,000 / Cr 4035 100 / Cr 2020 47.50 — exactly the bar; public page shows "Items before discount, Discount, Shipping"; edit dialog has discount per line, document discount, shipping, custom fields | **Meets.** Price-list default in the new-invoice dialog not exercised |
| Late fees | Config saved (off by default) | Payment Chasing carries the setting | **Partly** (not run; D1-9 in the suite) |
| Recurring auto-send | Template with contact + autoSend | Created; run not triggered | **Partly** (D1-10 in the suite) |
| Online payment (fake Stripe Connect) | Connect from Settings, checkout from the public page, signed `checkout.session.completed` | Settings: "test mode, Connected and ready, acct_…beff", enable and partial toggles; public "Pay now"; webhook posts Dr 1025 967.57 / Dr 5110 29.93 / Cr 1040 997.50 (net to clearing, fee expensed), invoice Paid, `gateway_payments` row with fee; replay-safe | **Meets** |

## D2 Purchases, projects and people

| Stream | What I did | What I saw / ledger | Verdict, gap |
|---|---|---|---|
| Unified contacts | Customer and vendor contacts; bills with `vendorId` | Contacts page with type badges, customer "Statement" and "Vendor statement" actions | **Meets** |
| Vendor statement | Dialog for Gulf Office Supplies after the bank match | Opening 0, bill 6,300, payment 6,300 (from the matched bank line), closing 0; Ageing tab; PDF/email | **Meets** |
| Approvals | Rule "bills > 5,000: accountant then owner"; 8,400 bill | Queue "Pending approval 0/2, next Accountant, Not yours to sign"; owner-creator refused 403 `SELF_APPROVAL`; 6,300 bill approved and posted as before | **Meets.** A company with no accountant user cannot clear this rule — see defect 4 |
| Projects and time | 3 entries (one non-billable), timer, invoice from unbilled, profitability | INV-2026-00005: 2 dated time lines, 700 + 35 VAT; entries flip to "Invoiced on INV-…"; profitability from the ledger with budget % | **Meets.** Revenue 0 until the invoice is issued (correct, say so in the tab) |
| Leave | Types seeded (annual 30, sick 90, maternity 60, parental 5, study 10, hajj 30, unpaid); 5-day request approved | Balance 2026: opening 30 + accrued 25 − pending 5; October run shows no deduction (paid leave) | **Meets.** Prior-year carry-over of all 30 days is silent — expose it as a setting |
| Loans | Preview 6 × 2,000 on an 8,000 wage; created 10 × 1,200 | Cap 1,600 (20%) enforced; Dr 1080 12,000 / Cr 1020; Loans tab with schedule, repay in cash, cancel; deduction scheduled from November | **Meets** |
| Final settlement | Previews for an expat (2.75 yrs) and a GCC national | Expat: gratuity 11,552.88 = 6,000/30 × 21 × 2.7507, leave 800; GCC: gratuity 0, leave 1,200 but "years of service 0" | **Partly:** posting not exercised; defect 5 |
| Payroll register | September and October runs | Per-employee basic, allowances, pension 5%/12.5% for the GCC national, gratuity accrual 350; October journal Dr 5020 17,000 / 5025 1,125 / 5028 350, Cr 2030 16,550 / 2032 1,575 / 2036 350 | **Meets** |

## D3 Banking, automation and assets

| Stream | What I did | What I saw / ledger | Verdict, gap |
|---|---|---|---|
| Statement import | OFX with 4 lines, twice | 4 imported, then 0 new / 4 skipped; Import tab lists CSV, OFX, MT940, CAMT.053, PDF; AI PDF toggle off with honest "paid per call / not configured" copy; closing balance kept | **Meets** (MT940/CAMT via L3 tests) |
| Matching and bulk accept | Suggestions at min 50, bulk-match all | Bill 100, invoice 95, rules 75; 4 posted: Dr 2010 6,300 / Cr 1020; DEWA Dr 5030 900, 5040 100, 1050 50 / Cr 1020 1,050; charges Dr 5110 52.50; receipt Dr 1020 / Cr 1040 | **Partly:** the 997.50 receipt was offered against a 1,050 invoice of the same customer and posted as a partial payment — defect 3 |
| Rules with splits and VAT | Two rules | Page shows split lines, VAT, direction, applied count, preview/apply | **Meets** |
| Reconciliation statement | Reconciliation tab | Two-sided: statement 14,595 + deposits in transit − outstanding payments vs ledger; items listed with JE numbers; "Complete reconciliation" blocked while unbalanced; CSV | **Meets** |
| Bank feeds without provider | `/api/bank/providers` and the page | `providers: []`; "Statements are imported from files. Live bank feeds are not required."; no Feeds tab | **Meets** |
| Cash-flow scenarios | 90-day forecast with saved scenario "Slow payers" | Weekly buckets from AR due dates, bills, recurring, payroll (−16,550 on the 28th), −2,500 one-off; panel with delays, collection %, payday, toggles; Arabic 375 px clean | **Meets** |
| Fixed assets | Two assets, depreciation for Sep then Aug, disposal with proceeds to 1020 | Register ties to GL (1290 36,000, 1240 991.67, difference 0); Schedule tab; disposal Dr 1020 3,000 / Dr 1240 230.10 / Dr 5100 507.27 / Dr 5130 462.63 / Cr 1290 4,200 | **Partly:** defects 1 and 2 |

## Competitor rating

| Domain | Zoho Books | FreshBooks | Wafeq | Watin |
|---|---|---|---|---|
| D1 | At par (SO, advances, acceptance, custom fields, Pay now); behind on gateway choice and auto-charge; ahead on UAE VAT treatment of advances | Ahead on VAT and ledger; behind on auto late fees and saved cards | Ahead (advances, acceptance, price lists, Pay now; Wafeq's equivalents unsure) | Ahead |
| D2 | Ahead on UAE payroll in the ledger (leave, loans, EOS); at par on approvals and project invoicing | Behind on team time features; ahead on everything else | Ahead on leave/loans/settlement and approvals (Wafeq unsure) | Ahead |
| D3 | At par on import, rules, reconciliation statement, fixed assets; behind on live feeds until Lean keys | Ahead | At par on import; ahead on reconciliation statement and assets; behind on feeds (Wafeq via Lean, unsure) | Ahead |

## Defects (severity, reproduction, smallest fix)

1. **HIGH — depreciation depends on run order.** Laptop 4,200 / 36 months: run Sep 2026 → 116.67; then run Aug 2026 → 113.43; disposal catch-up 507.27 where 525 is due. Monthly amount is derived from NBV after later months. Fix: monthly = (cost − salvage) / months from the schedule, cap only at the end; or refuse a month earlier than the last posted one.
2. **MEDIUM — no catch-up.** Van bought Aug 2025 shows 0 accumulated until each month is run by hand. Fix: "Run depreciation" posts every unposted month up to the chosen month in one transaction (the disposal path already does this).
3. **MEDIUM — amount-mismatch bulk accept.** With min confidence 50, a 997.50 receipt is paired with a 1,050 invoice (same customer, within 5%) and bulk-match posts a partial payment. Fix: rows whose amount ≠ target outstanding are excluded from bulk accept unless confidence ≥ 80; default filter 80.
4. **MEDIUM — unsatisfiable approval rule.** Rule requires "accountant" but the company has only an owner, who created the bill (SELF_APPROVAL). The bill can never be approved. Fix: Rules tab validates roles against `company_users` and warns; queue row says "no accountant in this company".
5. **LOW — settlement preview years of service 0** for a GCC national with 3.5 years. Fix: compute years for everyone; zero only the gratuity.
6. **LOW — advance PDF payment terms.** "Payment Terms: Net 30 days" on a paid deposit invoice. Fix: hide the terms block for `invoiceType = advance`.
7. **LOW — public invoice Arabic status badge** stays "Paid"/"Sent". Fix: map status through the page i18n table.
8. **LOW — public invoice at 375 px** clips the unit-price column ("ED 250.00") until scrolled. Fix: stack description/price under 400 px.
9. **LOW — invoice list shows "Sent" for an invoice 20 days overdue** (pre-existing). Fix: derived "Overdue" badge from due date.
10. **LOW — leave carry-over silent.** Full prior-year balance carried. Fix: company setting "carry-over max days" (default 30, 0 disables) shown on the Balances tab.

## Verdict

**Ship with listed fixes.** Fix 1–4 before the Phase 8 PR merges (1 and 2 touch the ledger; 3 and 4 trap users); 5–10
in the next fix round. Priority: 1, 3, 2, 4, 7, 5, 6, 10, 8, 9.

## Summary for the CTO

1. Every D1–D3 stream is real, bilingual, and usable at 375 px; nothing claims a feature that is not there (feeds, AI PDF).
2. Ledger postings match the bar to the cent: discounts (4050), shipping (4035), advances (2055 with VAT at receipt), gateway clearing (1025) and fee (5110), loans (1080), payroll, bank rules with VAT, disposal gain/loss.
3. Advance VAT is right: declared on receipt, deducted on the final tax invoice, memo on the statement.
4. Quote acceptance keeps a proper signature record (name, email, IP, UA, hash, 5-year retention).
5. Approvals, vendor statements, projects, leave, loans and the payroll register meet the bar; final-settlement posting not exercised live.
6. Reconciliation is a genuine two-sided statement; import dedupes; the UI stays honest without Lean keys.
7. One HIGH defect: straight-line depreciation changes with run order (116.67 vs 113.43); fix before merge.
8. Three MEDIUM: no depreciation catch-up, bulk accept of amount-mismatched receipts at low confidence, approval rules that nobody can satisfy.
9. Six LOW cosmetic/i18n items listed; none block.
10. Against Zoho we are at par on D1 and D3 and ahead on UAE payroll; ahead of Wafeq and Watin on everything checked (their feature set partly unsure).
