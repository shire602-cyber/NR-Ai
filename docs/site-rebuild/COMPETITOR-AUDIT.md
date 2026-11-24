# Muhasib marketing site - competitor audit (24 Nov 2026)

Scope: live homepages fetched 24 Nov 2026 11:52-12:05 Dubai time (UTC+4). Staging baseline: https://nr-ai-staging.up.railway.app/ (EN) and /ar.
Screenshots of the current staging homepage: shots/staging-before-en.png, shots/staging-before-ar.png.

## 1. Current staging homepage (baseline)

Sections, top to bottom:
1. Header: mega-nav (Product, Solutions, Services, Free tools, Resources, Pricing), Sign in, Arabic toggle, Request a demo, Start free trial.
2. Hero: "Accounting and VAT for UAE businesses" + one sentence; static dashboard screenshot labelled "Product screenshot with sample data"; price line "From AED 59/month, 14-day free Enterprise trial, no card".
3. "See how it works": 4 tabs (Scan a receipt, Reconcile a bank CSV, Review VAT 201, Client portal) with one small screenshot each.
4. "Get ready for UAE e-invoicing": two sentences, "Setup is required", provider-name text chips (to be removed: provider names must not appear publicly).
5. "Built for the way you work": 2 cards (SMEs, accounting firms).
6. "From the first invoice to month-end": 6 feature tiles, one line each.
7. "Bring your books with you": migration chips (Excel, Wafeq, Mazeed, Zoho Books).
8. Pricing: 3 plans in AED.
9. FAQ (6 items).
10. Dark CTA band "See what your books look like in one place."
11. Footer.

What works: honest copy, AED pricing up front, no card trial, sample workspace link, free tools exist (VAT calculator, CT estimator, e-invoicing readiness checker, sample tax invoice), Arabic route exists, fast self-hosted fonts.

Why it feels empty (the owner's complaint is fair):
- Hero is a generic category label, not a promise. No emotion, no "why switch", no outcome (time saved, penalty avoided).
- One static screenshot; zero motion, zero interactivity on the homepage. The free tools are buried in the nav.
- E-invoicing - the single biggest buying trigger in the UAE right now - gets two sentences and the word "Setup is required", which reads as a weakness. No deadlines, no penalty, no countdown.
- No comparison with Wafeq / Zoho anywhere on the homepage, even though the price advantage is real.
- No trust layer: no security/data-residency facts, no FTA/EmaraTax workflow visual, no proof placeholders, no founder/team, no support promise.
- Feature tiles are one-liners with no visuals; everything is the same pale green card. Low contrast between sections, so the page reads as one long flat list.
- Pricing has no "what you would pay elsewhere" anchor and no e-invoicing-included badge.
- Arabic page is a translation of the same flat layout, no Arabic-first typography moment.

## 2. Competitor homepages

| Site | Hero | Proof | Visuals / motion | E-invoicing | Pricing on home | Arabic | Interactive |
|---|---|---|---|---|---|---|---|
| Wafeq (wafeq.com/en-ae) | "Ready for UAE e-invoicing." Deadline banner by revenue band above the hero | 4.8 avg rating; MoF accreditation #129932; Peppol certified | Product UI, timeline graphic | Hero-level. Accredited ASP, live in govt pilot, "included in your plan", AED 5,000/month penalty, 4-step deadline timeline | Separate page: Starter 69/57, Plus 99/80, Premium 249/200 AED, Enterprise on request | Full AR site | Deadline-by-revenue selector |
| Zoho Books UAE | "AI-ready accounting software for growing businesses", VAT and CT ready | Named UAE customer testimonials (Dubai firms) | Rich animated collage of live UI cards (invoice, stock, bank, P&L, projects, audit trail) cycling | "UAE eInvoicing ready - choose Zoho as your ASP, PEPPOL, PINT-AE" | On homepage: Free, 60, 90, 120, 280 AED + monthly/yearly toggle | Yes | Pricing toggle |
| Xero UAE | "The all-in-one to get your business done." | 5.1M customers, 250k accountants | Big lifestyle + UI imagery, AI assistant (JAX) demo | "eInvoicing at no extra cost on Starter/Standard/Premium", FTA-accredited VAT software, Arabic+English VAT reports, FTA Audit File | On homepage with 90% off intro offer (USD) | Reports in Arabic | Industry tabs |
| QuickBooks UAE | "Business done right" | 4.5 / 8,500+ Capterra reviews | Product tour carousel by module | "Coming soon"; via Fonoa (accredited ASP #149104) disclosed in footnote | Plans + cancel terms | Limited (AI outputs English only) | Module tabs |
| Qoyod (KSA) | "The trusted way to get compliant e-invoicing" | Big numbers (35K+ companies, 100K users, 2M invoices/month), 1,300 Google reviews 4.8, named video testimonials | Live invoice status card ("Sending - Cleared"), 2-min explainer video | Hero-level, readiness check CTA | FAQ mentions 14-day trial no card | Arabic-first | Readiness checker, 24/7 WhatsApp support block |
| Daftra | "The Ultimate ERP System" | 45K+ businesses, case-study cards with outcome lines ("daily close in 5 min instead of 2 h") | Module grid, industry finder | ZATCA-focused | Trial badges: 14 days, no card, no setup | Yes | Industry finder |
| Odoo Accounting | "Accounting made effortless" | 28M users, KPMG quote | Speed claims with micro-animations ("5 seconds from login to vendor bill", "<90 ms"), AI OCR 98% | Peppol EDI | Elsewhere | Yes | Animated demos |
| TallyPrime MENA | "Run your business like a pro" | 2.7M businesses, 4 decades | Stock imagery | "#1 VAT and e-invoicing software" claim | No | Yes | Free trial |

Design benchmarks:
| Site | What makes it "wow" |
|---|---|
| Digits | Hero shows a real, navigable product shell (sidebar items animate in); dense wall of named testimonials; "Agentic General Ledger" product naming; very confident one-line promise. |
| Ramp | Huge, punchy promise ("Time is money. Save both."); live counter / ticker numbers; interactive "see recommendations for your business" form (enter website, pick pain points); 20+ short quote cards; "Systems that never spoke" storytelling video. |
| Brex | Cinematic hero image + product UI overlay, metric band (hours saved, % automated) with disclosure footnote; segmented by company stage. |
| Pilot | Pain-first hero ("If you're buried in bookkeeping, who's leading the company?"); questions founders actually ask; human advisors with faces; problem -> what we built -> quote case studies. |

## 3. Gaps vs competitors (ranked by impact)

1. No emotional, outcome-led hero (Ramp, Pilot, Digits all lead with a promise; we lead with a category).
2. No motion or live product feel in the hero (Zoho, Digits, Qoyod show the product working).
3. E-invoicing is underplayed. Wafeq, Xero and Qoyod make it the headline with deadlines, penalty and "included". We actually include it on every plan - and say "Setup is required" instead.
4. No interactive tool on the homepage (Wafeq deadline selector, Ramp recommender, Qoyod readiness). We already have a VAT calculator and readiness checker - they are hidden.
5. No comparison/price anchor. Wafeq Premium is AED 249/month (200 yearly) vs our top plan AED 229 with e-invoicing included; Zoho's e-invoicing requires choosing Zoho as ASP; Xero is USD-priced. We never say this.
6. No trust/compliance band: EmaraTax-ready VAT 201 flow, FTA tax-invoice fields, data security, UAE data residency (planned production DB in UAE - only claim once live), bilingual invoices.
7. No social proof at all - and we must not invent it. Need honest placeholders + founder story + "early access" framing.
8. Flat visual rhythm: every section same light-green card. Competitors alternate dark/light, large numbers, big visuals.
9. Arabic is a mirror, not a showcase. Bilingual EN/AR invoices are a genuine differentiator vs Xero/QuickBooks (QB AI is English-only) - show a side-by-side bilingual invoice.
10. No mobile/WhatsApp/support promise (Qoyod: 24/7, WhatsApp). We have support@ only.
11. Accountant/firm story is two lines; Xero and Zoho have whole sections for accountants.
12. No AI story beyond "OCR". Every competitor now leads with AI (JAX, Intuit Intelligence, Wafeq AI, Zoho AI). Receipt scanning should be shown as an animated "receipt -> posted entry" moment.

## 4. Facts verified for the rebuild

- UAE e-invoicing (MoF Ministerial Decision 244/2025, amended by MD 66/2026; FTA notice 25 Oct 2026):
  - Pilot and voluntary adoption from 1 July 2026.
  - Revenue >= AED 50m: appoint ASP by 30 Oct 2026, go live 1 Jan 2027.
  - Revenue < AED 50m: appoint ASP by 31 Mar 2027, go live 1 Jul 2027.
  - Government entities: appoint by 31 Mar 2027, go live 1 Oct 2027.
  - Penalty: AED 5,000 per month (or part) of delay, including failing to appoint an ASP.
  - B2C-only businesses currently out of scope.
- Format: PINT AE over Peppol, via an Accredited Service Provider (ASP).
- Muhasib facts (do not change): AED 59 / 119 / 229 per month; 14-day Enterprise trial, no card; e-invoicing on every plan via an accredited provider (provider names are internal only - NEVER shown on public marketing/pricing pages; in-app settings may keep the choice); bank import is CSV upload only (no live bank feeds); no ZATCA / Saudi references; VAT 201 prepared in Muhasib and submitted in EmaraTax; WPS SIF file for payroll.
- Do NOT claim: Muhasib is itself an ASP; any accreditation number; customer counts; ratings; customer logos; testimonials; UAE data residency (until production is live there); live bank feeds.
