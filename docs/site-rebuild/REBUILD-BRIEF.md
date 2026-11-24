# Muhasib marketing site - rebuild brief (wow-factor edition)

Read COMPETITOR-AUDIT.md first. Goal: a homepage and core marketing pages that beat Wafeq, Zoho Books, Xero and QuickBooks UAE on first impression, clarity of value and trust, and make a UAE SME owner or accountant want to switch today. Benchmarks for polish: Digits, Ramp, Brex, Pilot.

Code lives in client/src/components/marketing/ (phase/PhaseSite.tsx, phase/content.ts, phase/route-content.ts, phase/routes.ts, phase/phase.css, phase/vat-calculator.ts, ProductPreview.tsx, Sections.tsx, PlanCard.tsx, plans.ts, sample.ts) and locales client/src/locales/{en,ar}/marketing.json. Reuse what exists; refactor rather than add a parallel site.

## 0. Hard rules (non-negotiable)

- Prices: Starter AED 59, Professional AED 119, Enterprise AED 229 per month. 14-day free Enterprise trial, no card.
- E-invoicing on every plan. Providers: A-Cube or Complyance, selectable per company, no default, show both equally.
- Bank import: "Upload a CSV exported from your bank". Never say live bank feeds, bank sync, or "connect your bank".
- No ZATCA, no Saudi Arabia, no KSA references anywhere.
- No invented customer logos, testimonials, ratings, user counts, savings statistics or accreditation numbers. Where proof is needed use a clearly marked placeholder component (visible "Placeholder - real customer quote coming" in dev; hidden behind a flag `SHOW_PROOF_PLACEHOLDERS` in production builds) so marketing can drop real proof in later.
- Do not claim Muhasib is itself an Accredited Service Provider. Say "e-invoices are exchanged through your chosen accredited service provider (A-Cube or Complyance)".
- Do not claim UAE data residency yet (put the line behind a config flag, default off).
- VAT 201: "prepare and review in Muhasib, then submit in EmaraTax". No "direct filing".
- Every visible string goes through the EN and AR locale files. No hard-coded English.
- No ASCII art, emoji or stock photos of people. Visuals = real product UI (rendered React components with sample data from sample.ts, labelled "Sample data").

## 1. Brand feel

Confident, calm, premium, Gulf-modern. Deep emerald (#0B6A4A) + near-black ink + warm sand accent + one bright signal colour (mint or gold) used only for "live" states. Alternate dark and light sections for rhythm (at least 3 dark bands on the homepage). Large type (hero 64-88px desktop), tight letter spacing, generous whitespace. Subtle grain/gradient mesh in dark bands. Geist for Latin, Noto Sans Arabic (or IBM Plex Sans Arabic if already available) with Arabic display sizes tuned separately (Arabic needs ~1.1x line-height and no negative tracking).

## 2. Homepage, section by section

### 2.1 Announcement bar (thin, dismissible)
"UAE e-invoicing: businesses under AED 50m must appoint an accredited provider by 31 March 2027. Muhasib includes e-invoicing on every plan." -> link to /e-invoicing.

### 2.2 Hero (the wow moment)
- Headline (EN, pick final in copy pass; keep short): "Your books. Your VAT. Your e-invoices. Done." Alt: "UAE accounting that does the work for you." Sub: "Bilingual tax invoices, AI receipt capture, VAT 201 ready for EmaraTax and e-invoicing on every plan - from AED 59 a month."
- CTAs: primary "Start free 14-day trial" (micro-copy under it: "Full Enterprise plan. No card."), secondary "Watch a 60-second tour" (opens the interactive demo, 2.4) and tertiary text link "Explore the sample workspace".
- Visual: a LIVE animated product composition built from real React components, not a flat PNG:
  1. Dashboard shell fades in (sidebar items stagger in like Digits).
  2. An invoice card types itself in (customer, line items, VAT 5% auto-calculated, EN/AR bilingual toggle flips the invoice to Arabic for 2 seconds).
  3. A status pill animates: Draft -> Validated (PINT AE) -> Sent via A-Cube/Complyance -> Delivered. Use the bright signal colour.
  4. A receipt photo slides in, gets "scanned" (sweeping line), and becomes a categorised expense with VAT recoverable.
  5. The VAT 201 tile counts up to the payable figure.
  Loop every ~12s. Respect prefers-reduced-motion (show static final frame). Pause when offscreen (IntersectionObserver). CSS/transform animation or lightweight Framer Motion only if already a dependency; no Lottie/three.js.
- Under the hero: a trust strip of factual chips (no logos): "Prices in AED", "English + Arabic invoices", "VAT 201 ready for EmaraTax", "PINT AE e-invoicing", "WPS payroll file", "No card to try".

### 2.3 E-invoicing deadline section (dark band) - "Is your business ready for 2027?"
- Interactive deadline finder: segmented control "Annual revenue: AED 50m or more / Under AED 50m / Government entity". Shows a horizontal animated timeline with the two dates (appoint ASP, go live) and a live countdown in days to the next deadline (computed from today, Asia/Dubai).
  - >= 50m: appoint by 30 Oct 2026 (show "deadline passed - act now" state if past), live 1 Jan 2027.
  - < 50m: appoint by 31 Mar 2027, live 1 Jul 2027.
  - Government: appoint by 31 Mar 2027, live 1 Oct 2027.
- Penalty callout: "Late implementation: AED 5,000 per month (FTA)". Source footnote linking tax.gov.ae / mof.gov.ae.
- Three steps with icons: "Choose A-Cube or Complyance in Settings" -> "Connect your TRN" -> "Every invoice you issue is validated and exchanged as PINT AE". Copy: "Included on every plan. No separate e-invoicing subscription from us." (Provider fees, if any, must not be claimed as zero unless confirmed - leave a TODO marker in code for the owner to confirm.)
- CTA: "Check your readiness in 2 minutes" -> existing readiness checker.

### 2.4 Interactive product tour - "See it work" (light band)
Replace the 4 static tabs with a clickable mini-app (no login, sample data, client-side only):
- Tab 1 "Create an invoice": user edits quantity/price; VAT and total update live; toggle EN / AR / bilingual layout; "Issue" button animates the e-invoice status pipeline.
- Tab 2 "Scan a receipt": click "Scan" on a sample receipt -> animated extraction into fields -> suggested account + VAT.
- Tab 3 "Reconcile a bank CSV": drop the sample CSV (pre-loaded) -> rows match to invoices one by one with check marks.
- Tab 4 "VAT 201": boxes fill from the transactions above; "Export for EmaraTax" state.
- Tab 5 "Accountant view": switch between 3 client companies.
Auto-advances when idle; keyboard accessible; works RTL.

### 2.5 Savings calculator (sand band) - "What does switching save you?"
Inputs (sliders): invoices per month, receipts/bills per month, hours per month on bookkeeping, hourly cost (AED), current software (Wafeq Premium / Zoho Books / Xero / Spreadsheet / Other).
Outputs: estimated hours saved per month (use a transparent, conservative assumption table shown in a "How we calculate" disclosure, e.g. minutes saved per receipt scanned and per bank line matched; mark as estimates), AED value of time, software cost comparison per year using PUBLIC list prices only (Wafeq Premium AED 249/month or 200 billed yearly; Zoho Books UAE plans AED 60/90/120/280 billed annually; state "as listed on vendor sites, 24 Nov 2026, excl. VAT" and keep prices in one config file `competitor-prices.ts` with a lastChecked date). Also show "E-invoicing late penalty avoided: AED 5,000/month" as context, not as savings.
Big animated count-up result + CTA "Start saving - 14 days free".

### 2.6 Why Muhasib vs Wafeq and Zoho (light) - comparison table
Columns: Muhasib | Wafeq | Zoho Books UAE. Rows (only facts verifiable from public pages; keep in config with source URL + date; render a footnote):
- Entry price per month (AED): 59 | 69 (57 yearly) | free plan / 60+ billed annually
- Top SMB plan per month: 229 | 249 (200 yearly) | 280 (Elite, annual)
- Full-plan free trial with no card: Yes, 14 days Enterprise | verify | verify
- E-invoicing included on every plan: Yes | "included in your plan" | via Zoho as ASP
- Choice of e-invoicing provider: A-Cube or Complyance | Wafeq only | Zoho only
- Bilingual EN/AR tax invoices: Yes | verify | verify
- VAT 201 prepared for EmaraTax: Yes | Yes | Yes (direct filing)
- WPS payroll file: Yes | verify | verify
- Accountant multi-client workspace + client portal: Yes | verify | verify
Rule: any "verify" cell must be researched by the builder from the vendor's public site; if not confirmable, show "-" not "No". Never disparage. Headline above: "Everything you need. Nothing you pay extra for." Link to existing /compare pages.

### 2.7 Feature showcase (alternating rows, dark/light, each with a real UI visual)
1. AI receipt capture (animated scan).
2. Bilingual invoicing (EN/AR side by side, same invoice).
3. VAT 201 workbook (boxes filling).
4. Bank reconciliation from CSV (matching animation).
5. Payroll + WPS SIF.
6. Reports (P&L, balance sheet, cash flow, ageing) with a chart that draws in.
7. Inventory and cash sales with their own number series.
Each row: 1 headline benefit, 2 lines, 3 bullet facts, "Explore" link.

### 2.8 For accounting firms (dark band)
Multi-client switcher visual, client portal, review queue. CTA "Partner with us" -> contact. Placeholder slot for a future firm quote.

### 2.9 Trust and security (light)
Facts only: role-based access, audit trail, 2FA if implemented (check code), login lockout, encrypted connections, data export any time, data residency line behind flag. Link /trust. Placeholder slot "Customer stories coming soon" (flagged).

### 2.10 Migration (sand)
"Switch in an afternoon": Excel, Wafeq, Zoho Books, Mazeed CSV import cards with a 3-step visual. "We help you move - free" ONLY if the owner confirms (TODO flag; default copy: "Step-by-step migration guides").

### 2.11 Pricing (light)
3 cards, AED, monthly. Badge on every card: "E-invoicing included". Middle card highlighted. Under it: "Every new account starts on Enterprise free for 14 days. No card." Small "Compare with Wafeq and Zoho" link to 2.6.

### 2.12 FAQ (expanded to ~10, with e-invoicing deadlines, CSV import, providers, Arabic, accountant access, cancel any time, trial end = read-only).

### 2.13 Final CTA (dark, big)
"Be e-invoicing ready before your deadline." Primary trial CTA + "Book a demo".

### 2.14 Footer: add free tools, compare pages, e-invoicing guide, Arabic toggle, support email, WhatsApp placeholder (flag, off).

## 3. Other pages
- /pricing: same cards + full feature matrix + comparison table + FAQ.
- /e-invoicing (UAE e-invoicing hub): deadline finder, how it works (PINT AE, Peppol, ASP), A-Cube vs Complyance choice, penalty, readiness checker embed, FAQ. This is the SEO landing page; strong H1 and meta.
- /compare/wafeq and /compare/zoho-books: hero "Muhasib vs X", table, migration CTA. Fact-checked only.
- /free-tools: VAT calculator, CT estimator, readiness checker surfaced as cards with live mini-previews.
- /accounting-firms and /small-business solution pages: reuse showcase components.
- /ar mirror of all above with proper RTL.

## 4. Bilingual polish
- Arabic copy written natively (Gulf business Arabic, MSA), not word-for-word. Arabic numerals policy: keep Western digits for money (AED amounts) consistent with UAE invoices.
- Full RTL: mirrored layouts, animations direction-aware, icons that imply direction flipped, timeline right-to-left.
- Language toggle keeps the same page and scroll position. hreflang en-AE / ar-AE, separate meta titles and descriptions per locale.
- Test long Arabic strings for overflow at 360px, 768px, 1280px, 1440px.

## 5. Performance and quality bar
- Lighthouse mobile: Performance >= 90, Accessibility >= 95, SEO >= 95, Best practices >= 95 on / and /ar.
- LCP < 2.0s on 4G emulation; CLS < 0.05; hero JS for animation lazy and < 40 KB gz extra; no new heavy deps (no three.js, Lottie, GSAP unless already present).
- Images: SVG/inline React UI, AVIF/WebP for any raster, explicit sizes.
- prefers-reduced-motion respected everywhere; all interactive pieces keyboard and screen-reader usable; colour contrast AA.
- Tests: update/add unit tests for calculators (VAT, savings, deadline countdown) and a copy-guard test that fails on "ZATCA", "Saudi", "KSA", "bank feed", "live bank", "connect your bank" in EN/AR marketing locales; existing CI must stay green.

## 6. Delivery
- One PR into claude/eloquent-maxwell-kjxxjc. Before/after screenshots EN + AR (desktop 1440 and mobile 390) attached in PR description.
- A short CHANGES.md in the PR description listing every TODO/flag needing the owner's confirmation (provider fees, migration help, data residency, real proof).
