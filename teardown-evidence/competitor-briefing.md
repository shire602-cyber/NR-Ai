# UAE Accounting Software — Condensed Compliance & Competitive Briefing
**As of 7 August 2026.** Unconfirmed items flagged **UNVERIFIED**. Numbered sources at the end.

---

## 1. TWO ACCREDITATION REGIMES (vendors conflate them constantly)

| | **FTA Tax Accounting Software Register (TASR)** | **MoF eInvoicing Accredited Service Provider (ASP)** |
|---|---|---|
| Regulator | Federal Tax Authority | **Ministry of Finance** (FTA is only the C5 data recipient) |
| Legal basis | Administrative guide, Oct 2017, no decree [1][3] | **Ministerial Decision 64/2025**, amended by **Ministerial Resolution 56/2026** [4][5] |
| Nature | **Voluntary**, vendor self-declaration | **Compulsory gatekeeper** — MD 64/2025 Art. 3(1) |
| Standard | FTA Audit File (FAF, CSV) + VAT return file | **Peppol / PINT AE**, 5-corner DCTCE |
| Entry | Declaration + **AED 10,000** | OpenPeppol cert, **≥2 yrs** operating history, UAE incorporation, AED 50k capital, ISO 27001/22301, UAE data residency, insurance |
| Validity | 1 year | 2 years |
| Status | 42 listed, **only ~11 unexpired** [2] | **42 pre-approved** at 06/08/2026 [6] |

**TASR confers no ASP status and vice versa.** No MoF decision references the FTA register. Treat "FTA-approved ASP" claims as false unless the name is on the MoF list — **Daftra makes exactly this claim** [24].

Businesses' duty is FDL 28/2022 Art. 4 (keep records) — **no accredited-software requirement**; TASR's only benefit is "Auto Fill VAT Return." **UNVERIFIED:** no FTA sentence says TASR is optional; inferred from absence of obligation. Entries that matter [2]: Xero (Mar 2027), Daftra/IZAM (May 2027), **Zoho Books (Nov 2026)**, TallyPrime 6.2 (Nov 2026), **Wafeq v26 (Aug 2026 — expiring now)**, Odoo 17 (lapsed Jun 2025).

### E-invoicing mandate — dates
DCTCE/Peppol 5-corner, format **PINT AE**, ~50 mandatory fields; PDFs/scans/emails are **not** e-invoices [7]. Instruments: **MD 243/2025**; **MD 244/2025** amended by **Ministerial Resolution 66/2026** [8][9].

| Cohort | Appoint ASP by | Go-live |
|---|---|---|
| Pilot / voluntary | — | **1 Jul 2026** (open now) |
| Revenue **≥ AED 50m** | **30 Oct 2026** (extended from 31 Jul 2026) | **1 Jan 2027** |
| Revenue **< AED 50m** | **31 Mar 2027** | **1 Jul 2027** |
| Government entities | 31 Mar 2027 | **1 Oct 2027** |

B2C out of scope pending further decision. **Penalties (Cabinet Decision 106/2025):** AED 5,000/month for no ASP; AED 100 per untransmitted invoice (cap 5,000/mo); AED 1,000/day for not notifying a system failure [10].

**Caveat:** MoF publishes only the Art. 15 *pre-approved* list; **no Art. 16 final register was found — UNVERIFIED**. The 2-year history rule blocks fast entry, but MR 56/2026 Art. 5(bis) lets that experience sit with an outsourced third party — white-labelling through a small UAE ASP is the only near-term route.

**Only two mainstream accounting/ERP vendors are among the 42: SAP (#30) and Tally (#35).** Absent: Zoho, Xero, Odoo, QuickBooks, Sage, Focus Softnet, Wafeq, mazeed, FreshBooks, ERPNext, Daftra, Microsoft, Alaan. Avalara is *applying* [25].

**Emirate split is mandated twice:** Requirements Document Appendix 7 maps VAT boxes per emirate, and VAT Executive Regulation **Art. 72(2)** requires records proving the emirate of the fixed establishment [3]. **"Sequential invoice numbering" is NOT a TASR criterion.** Retention: **7 yrs for Corporate Tax** (FDL 47/2022 Art. 56), up to 11 under audit; e-invoice data stored **within the State** (MD 243/2025 Art. 11).

---

## 2. COMPARISON MATRIX

| | **Wafeq** | **mazeed** | **QuickBooks Online** | **Zoho Books** | **FreshBooks** |
|---|---|---|---|---|---|
| **MoF ASP** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **OpenPeppol** | ✅ AP+SMP (conformance **UNVERIFIED**) [11] | ❌ (claims BIS 3.0) | ❌ | ✅ AP+SMP, UAE entity [17] | ❌ |
| **FTA TASR** | ✅ **expires Aug 2026** | ❌ | ❌ | ✅ till Nov 2026 | ❌ |
| **Corporate Tax** | Taxable income only; *"not the tax amount itself"* [12]; filing via Tax Star (ASP #38) | Liability tracking + return generation; **humans file** [21] | ❌ none, no CT page at all [14] | ✅ module, **Professional+**; 0%/AED375k + 9%; "Mark as Filed" only [18] | ❌ sales tax only |
| **Small Business Relief** | ❌ | Content only, product **UNVERIFIED** | ❌ | ❌ **UNVERIFIED** | ❌ |
| **VAT 201** | Generic VAT report | VAT Summary | Summary only, verbs hedged [15] | ✅ full VAT 201 | ❌ **UK/HMRC only** |
| **Emirate Box 1a–1g** | ❌ **definitively absent** — "emirate" in 1 of 1,013 help articles; no emirate field on contacts or branches | ✅ likely — picker shows "Dubai Standard Rate 5%", "RCM 5%"; **alt-text evidence only** [21] | ❌ **UNVERIFIED**, no evidence; only Locations/Classes + manual totalling | ✅ **yes, 1a–1g**; emirate via "Place of Supply" on contact [19] | ❌ impossible, no emirate in data model |
| **EmaraTax filing** | ❌ manual re-keying | ❌ Advisors file | ❌ "EmaraTax" on no /ae/ page | ✅ **connect, fetch, verify, lock, submit + Voluntary Disclosures**; Standard tier [19] | ❌ (HMRC MTD only) |
| **Price** | AED 69/99/249 mo (690/960/2,400 yr), **unlimited users all tiers** [13] | **Free / 99 / 170** AED mo; Advance = **unlimited users** [22] | **AED price UNVERIFIED**. US: $38/$75/$115/$275 for 1/3/5/25 users [16] | AED 0/**69**/**129**/159/349/799 per org/mo (annual 60/90/120/280/660) [20] | $23/$43/$70 (5/50/∞ clients); +$11/user; **no AED storefront** |
| **Arabic + RTL** | Strong: Arabic by default at registration, `rtl:` CSS, 508-article Arabic KB. Gap: bilingual side-by-side invoices undocumented | Full parallel Arabic site, Arabic UI + invoice templates | **Hard NO** — *"the Arabic Language feature is unavailable in QBO"*; Capterra.ae's "Arabic" claim is wrong | Arabic UI yes, **but not CoA, email templates or tax rates**; RTL only in Custom Module Templates, **Premium-gated**; bilingual invoices Jan 2026 | **Confirmed NO** — 16 languages, all LTR |
| **UAE bank feeds** | **Wio only** (+ outbound payments). **No aggregator**. ⚠️ Lean is a *customer*, not the aggregator | **CSV import only** | **ADCB, DIB, ENBD, FAB, RAKBANK** — best coverage of any incumbent. Aggregator **UNVERIFIED**; ENBD 2FA errors | **Yodlee + Token**; **Wio** direct; Mashreq NEOBiz **UNVERIFIED**; **no published bank list**; T+1, 90-day backfill | Plaid (CA/EU) + Yodlee "everywhere else". **UAE never named — UNVERIFIED** |
| **WPS SIF payroll** | ❌ Excel/CSV only | ❌ partners Bayzat | ❌ payroll is US/CA/UK/AU only | ✅ **Zoho Payroll, Standard AED 45/35** — auto SIF, bank-specific formats (SIB, CBD, ADCB, HSBC, Al Ansari), gratuity/EOSB, DIFC DEWS | ❌ Gusto, US only |
| **Inventory** | Premium; costing **UNVERIFIED** | Advance; 1–2 warehouses | Plus+; no multi-warehouse | Professional; multi-warehouse = **Elite** | ❌ absent |
| **Fixed assets** | Straight-line only, **not linked to the bill** | ❌ likely absent | Advanced only; **disposal not auto-posted** | ✅ SL + DB auto-posting, **Premium+** | ❌ none |
| **Budgeting** | ❌ absent | ❌ CFO advisory | ✅ P&L + BS | ✅ Premium+ | ❌ none |
| **Multi-currency** | ✅ + FX revaluation | ✅ Advance, CBUAE rates | Essentials+; home currency **locked** | Professional+ | Per-client only; **no MC ledger** |
| **Traction** | ~$10.5m raised; claims 18,000+ customers but **90% of volume is Saudi**; 94 partner firms | 4,000+ businesses self-reported; **no disclosed funding**; Dubai SME / Sharjah / Hub71 / Meydan / e& channels | Intuit **no longer discloses subscriber counts**; international revenue +10% vs core +22%. **UAE traction UNVERIFIED** | **>1m paying customers**; **UAE +77% CAGR customers, 45% revenue CAGR**; AED 100m committed; **UAE data centres Jan 2026** | 30m+ *"have used"* (lifetime). **UAE traction: none** |

---

## 3. VERDICT ON MAZEED

**Real and identified.** **mazeed.com**, formerly **McLedger** (mcledger.co redirects; Android bundle ID still `com.mcledger.app`). Founded **2018, Dubai**; CEO Khalid Radi. Cloud accounting SaaS (**mazeed ONE**) **plus** an outsourced accounting/tax/CFO service (**mazeed OPS / Advisors**) in the same app — a software+service hybrid, not pure SaaS.

**Ruled out:** not an Alaan product, not Zoho-adjacent (it is a competitor), not a Saudi ZATCA specialist. Avoid the near-miss App Store app "Mazeed - مزيد" (id 1597799560); the accounting app is "Mazeed Accounting" (id 1499626950). `mazeed.ae` does not resolve.

**Not an ASP and not TASR-listed**; its e-invoicing page claims only Peppol BIS 3.0 support. **Its mandate content is stale** — still "Phase 1 — Q2 2026" against the real 30 Oct 2026 / 1 Jan 2027 dates, a credibility problem for a compliance vendor. Strengths: emirate-level VAT rates and RCM appear modelled (**strong but not conclusive — alt-text evidence**), genuine Arabic, **AED 170/mo unlimited users**, unmatched government/free-zone distribution.

---

## 4. WEAKNESSES, TERSE

**Wafeq** — (1) Not an ASP; TASR expires this month. (2) No emirate Box 1 and no field to build one from. (3) Custom tax rates **"cannot be included in VAT reports at all"** → RCM/Designated Zone unworkaroundable; whether system codes ship is **UNVERIFIED, the highest-value in-product test**. (4) No WPS/gratuity, no budgeting; fixed assets not linked to bills. (5) ~5 genuine reviews (4 Capterra, Nov 2022, all "Vendor Referred – Incentive Offered"; **G2: 0**) against an 18,000-customer claim; one 1/10 review alleges bank feeds were moved to a 5×-priced tier mid-subscription. (6) Backlog stalled since Apr 2024; Android unshipped; API lacks webhooks and fixed-asset/budget endpoints.

**mazeed** — (1) Not an ASP with the mandate closing. (2) Stale compliance content. (3) No live bank feeds. (4) No payroll/WPS, no fixed assets; budgeting is human advisory. (5) Warehouse caps (1/2) push inventory businesses to Enterprise; thin project accounting. (6) Permanent 80%-off banner signals weak pricing power; no disclosed funding.

**QuickBooks Online** — (1) Intuit stated on record **18 Dec 2025 and again 10 Apr 2026** that UAE e-invoicing/Peppol/ASP is unsupported with no roadmap. (2) No Arabic, no RTL, no CT module. (3) Localisation demonstrably stale: the UAE VAT page is **recycled Malaysian GST content**; the FAQ says "three plans" (there are four), "Windows XP," "Internet Explorer"; testimonials are Singapore/Malaysia/Hong Kong, **zero UAE**. (4) Generic ROW SKU, entity Intuit Limited (UK), **support routed to Singapore**; monthly billing only, **no pro-rata refunds**. (5) Capterra 4.3/8,500: cost 55% negative of 832 mentions, glitches 70% of 614, slow performance 72% of 376. (6) CoA capped at **250 accounts** through Plus.

**Zoho Books** — (1) Not an ASP; accredited ClearTax confirms Zoho **"does not natively generate PINT AE XML or transmit through Peppol"** and "sits at Corner 1" [17]. (2) **No Arabic chart of accounts**; full-app RTL never announced; Arabic reports likely absent. (3) Bank feeds weakest flank — no published bank list, T+1, 90-day cap; a 14+ page thread "Zoho Book - Poor reliability" on silent feed failures. (4) CT module shallow — no Art. 20 adjustments, QFZP, interest limitation, TP or loss carry-forward; SBR unsupported. (5) Emirate attribution is contact-driven only; **no per-invoice Place-of-Supply override or branch attribution documented (UNVERIFIED)** — a correctness risk for multi-emirate retail. (6) **Hard invoice-volume caps** force upgrades (~2.6× price rise in 5 yrs); **no multi-entity consolidation**; a Jul 2026 Financial Controller review reports **"VAT amounts and codes don't show up on transaction reports."**

**FreshBooks** — (1) Nothing anywhere on UAE e-invoicing, PINT AE or the FTA; no `/en-ae` locale. (2) No VAT 201 — the VAT Return report is UK-only. (3) **Taxes Paid does not net against Taxes Payable** outside the UK report — net VAT is not computed. (4) Does not label invoices "Tax Invoice" for the UAE (only AU, BH, NZ, SG, ZA). (5) No Arabic, no RTL, USD-only; **AED as a transaction currency UNVERIFIED**. (6) No inventory, fixed assets, budgeting or corporate tax; bank sync is the #1 complaint; billable-client caps (5/50).

---

## 5. OTHER UAE PLAYERS THAT MATTER

**Tally / TallyPrime — strongest position in the market.** Accredited ASP (#35), "fully accredited" 27 Jul 2026 (*Art. 16 register UNVERIFIED*) [23]. OpenPeppol certified with **native PINT AE XML**; VAT 201 and FAF shipped; **emirate field in party ledger masters**; direct EmaraTax API filing; full Arabic + bilingual invoices. **The moat is commercial: ASP capability is bundled with active TSS and Tally absorbs the cost — "unlimited companies, unlimited users, unlimited e-invoices"** while rivals pay per document. Silver perpetual ~AED 2,340; 5-yr TCO ≈ AED 4,200. 65,000+ UAE businesses (self-reported). **Whether it files a CT return is UNVERIFIED.**

**Xero — present but unshipped.** TASR till Mar 2027. Own words: ASP *"Almost!"*; VAT reporting *"It will in the near future"*; Arabic *"Xero software will be in English."* USD $7/$29/$50/$75, **multi-currency Premium-only**. Feeds: Wio + Alaan direct; broader coverage runs through a **"Wafeq Feeds"** connector — a direct competitor. Strategy is "3x3" (US/UK/AU). **Late and unproven, not absent.**

**Odoo** — good localisation (`l10n_ae`, FTA tax codes incl. RCM and Import VAT, CBUAE FX sync, GCC bilingual invoices); VAT 201 exports for **manual** submission only. **Emirate Box 1 absent from Odoo 19 docs — UNVERIFIED gap.** CT report is a scaffold. **Not an ASP; its Peppol AP is Europe-only, no PINT AE** — partner claims of native PINT-AE generation contradict Odoo SA's own docs.

**Alaan** — **$48m Series A (Aug 2025, Peak XV), $55m total**; 3,000+ businesses. AI receipt/TRN/VAT extraction, **but not a general ledger** — no AR, trial balance or statements; it writes into Xero, Zoho, QBO, **Wafeq**, ERPNext, Odoo. Free / AED 499. Now issues its own business account via ruya, **sidestepping the bank-feed problem**.

**Finanshels** — services firm on a software cost curve: *"AI drafts. A human signs."* FTA-registered tax agency; plugs into QBO/Xero/Zoho. 7,000+ UAE businesses self-reported. **Funding UNVERIFIED.**

**Wio Business** — a bank, functionally competitive: 120,000+ business clients (*soft source*); AED 99/249 per month; built-in invoicing and payment links; its own banking API with **Zoho Books, Fiskl, Wafeq and Xero** as partners. **Wio is the single most important integration partner in this market.** **Mashreq NeoBiz** is the highest-leverage GTM slot for Zoho Books.

**Also:** SAP (ASP #30, enterprise) · Focus Softnet (largest Dubai-HQ ERP, **not an ASP**, TASR expired Apr 2024) · Daftra/IZAM (Arabic-first, TASR to May 2027, **disputed false ASP claim**) · Microsoft D365 BC (partner Techventures is ASP #39) · ERPNext/Frappe (Corner 1 only) · Bayzat (owns the UAE payroll/WPS layer — partner, not competitor) · **Rewaa** (Saudi, $45m Series B — likeliest future entrant, **UNVERIFIED**). **Ignore:** Sage (TASR expired 2020), Zybra (Indian GST), Elate/Emerald/Peniel/QuickDice/Naqood (SEO reseller shops).

**Bank-feed sleeper issue.** CBUAE Open Finance (**Circular 7 of 2023**, in force 10 Jul 2025 via Circular 3/2025; **FDL 6/2025** made it licensed) **bans screen-scraping**, routes everything through one central API Hub run by **Nebras**, and **meters it with licensing plus usage fees** — bank data is a COGS line, not free as under PSD2. **DIFC and ADGM excluded.** Live mid-2026: CBD (retail only), Mashreq, ADIB, DIB; TPPs Lean, Pay10, NymCard, Spare — **no live AIS-for-accounting use case**. **Plaid has zero UAE coverage.** Whether business accounts are in the live phase is **UNVERIFIED — the most important open question**. Only **7 of 267 UAE banks** are reachable via any aggregator.

---

## SOURCES

1. https://tax.gov.ae/en/tax.support/tax.accounting.software.vendors.aspx
2. https://tax.gov.ae/en/tax.support/tax.accounting.software.vendors/accredited.tax.accounting.software.vendors.aspx
3. https://tax.gov.ae/DataFolder/Files/Pdf/requirement-document-for-tax-accounting-software.pdf
4. https://mof.gov.ae/wp-content/uploads/2025/03/Ministerial_Decision_Eligibility_and_Accreditation_procedure_for_SPs_EN.pdf
5. https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-56-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-64-of-2025-En-20260510.pdf
6. https://mof.gov.ae/en/about-us/initiatives/einvoicing/pre-approved-einvoicing-service-providers/
7. https://mof.gov.ae/en/about-us/initiatives/einvoicing/
8. https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-No.-244-of-2025-on-the-Implementation-of-the-Electronic-Invoicing-System.pdf
9. https://mof.gov.ae/wp-content/uploads/2026/05/Ministerial-Resolution-No.-66-of-2026-Amending-Certain-Provisions-of-Ministerial-Resolution-No.-244-of-2025-Regarding-the-Implementation-of-the-Electronic-Invoicing-System-En-20260514.pdf
10. https://mof.gov.ae/wp-content/uploads/2025/12/Cabinet-Decision-Violations-and-Penalties-eInvoicing-final-version-en-8.12.25.pdf
11. https://peppol.org/members/full-members-list/
12. https://help.wafeq.com/hc/en-ae/articles/19934722200860-Corporate-Tax-in-Wafeq-A-Practical-Guide
13. https://www.wafeq.com/en-ae
14. https://quickbooks.intuit.com/ae/sitemap/
15. https://quickbooks.intuit.com/ae/vat-tracking/
16. https://www.capterra.com/p/190778/QuickBooks-Online/pricing/
17. https://www.cleartax.com/ae/uae-e-invoicing-zoho-integration
18. https://www.zoho.com/ae/books/help/corporate-tax/
19. https://www.zoho.com/ae/books/help/vat-uae/vat-return-filing.html
20. https://www.zoho.com/ae/books/pricing/
21. https://mazeed.com/tax/
22. https://mazeed.com/pricing/
23. https://www.zawya.com/en/press-release/tally-solutions-becomes-a-fully-accredited-service-provider-by-the-uae-ministry-of-finance-410443
24. https://www.daftra.com/en/e-Invoice-software-uae/
25. https://www.avalara.com/blog/en/europe/2026/03/uae-e-invoicing-mandate-2026-readiness-asp-pint-ae.html

**Method note:** Reddit, Trustpilot and G2 were blocked to the original fetcher; review claims lean on Capterra, GetApp and SoftwareFinder.
