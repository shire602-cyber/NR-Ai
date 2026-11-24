# Marketing site rebuild - changes, open decisions and deferred items

Branch `claude/site-rebuild-wow` (base `e43e155d`). Nothing is pushed and no PR is open.
Spec: [REBUILD-BRIEF.md](REBUILD-BRIEF.md). Screenshots of the result: `shots/after-*.png`,
`shots/fold-*.png`, `shots/sec-*.png`.

## 1. What was built

All code is under `client/src/components/marketing/phase/`; all new copy is in
`client/src/locales/{en,ar}/marketing.json` under `marketing.hx*` keys (about 500 per language).

Foundation (`phase/home/`)

- `home.css`: tokens (`--mz-*`), dark / light / sand bands, EN and AR type scales, chips, cards,
  badges, motion utilities and a reduced-motion block.
- `text.ts`: `useMarketingText(locale)` and `useMarketingRich` read the locale files for the
  locale forced by the URL. `motion.ts`: `useInView`, `usePrefersReducedMotion`, `useCountUp`.
- `flags.ts` and `ProofPlaceholder.tsx` (see section 2).
- The homepage moved out of `PhaseSite.tsx` into `home/Home.tsx`, one file per section.
- Provider names removed from every public marketing, pricing, FAQ and product string (EN and AR).
  In-app settings screens were not touched.

Homepage sections, in order

| Section | File | Notes |
| --- | --- | --- |
| Announcement bar | `AnnouncementBar.tsx` | Dismissible (session), links to the e-invoicing guide |
| Hero | `Hero.tsx`, `HeroStage.tsx`, `hero/model.ts` | Live composition: shell, invoice typing, EN/AR flip, status pipeline, receipt scan, VAT count-up. 12 s loop, pauses offscreen and on hidden tab, static final frame under reduced motion. Lazy chunk is 2.4 kB gzip |
| Trust chips | `TrustChips.tsx` | Six factual chips, no logos |
| Deadline finder | `DeadlineFinder.tsx`, `deadlines.ts` | Three segments, timeline, countdown in Asia/Dubai calendar days, "deadline passed" state, penalty callout with FTA/MoF links, three steps, readiness CTA |
| Product tour | `ProductTour.tsx`, `tour/*` | Five tabs (invoice, receipt, bank CSV, VAT 201, accountant view), client-side only, lazy, auto-advance until first interaction |
| Savings calculator | `SavingsCalculator.tsx`, `savings.ts`, `competitor-prices.ts` | Sliders, "How we calculate" disclosure, list prices with source and `lastChecked` |
| Comparison table | `ComparisonTable.tsx`, `comparison.ts` | Muhasib, Wafeq, Zoho Books UAE; unknown cells show a dash; footnote with sources |
| Feature showcase | `Showcase.tsx`, `showcase/*` | Seven alternating rows with product-style visuals |
| Accounting firms | `FirmsBand.tsx` | Client switcher, portal, review queue, proof slot |
| Trust and security | `TrustSecurity.tsx` | Facts checked in code: role-based access, audit trail, two-factor sign-in, login lockout, HTTPS, data export |
| Migration | `Migration.tsx` | Excel, Wafeq, Zoho Books, Mazeed cards and three steps |
| Pricing | `PricingSection.tsx`, `MonthlyPlans.tsx` | "E-invoicing included" badge on every card, Professional highlighted |
| FAQ | `Faq.tsx` | 11 questions |
| Final CTA, footer | `FinalCta.tsx`, `SiteFooter.tsx` | Footer has tools, compare, e-invoicing guide, language toggle, support email |

Other pages (`phase/pages/`)

- `EinvoicingHub.tsx`: the UAE e-invoicing hub (deadline finder, how it works, scope, key dates,
  embedded readiness checker, FAQ, CTA).
- `PricingPage.tsx`: cards, plan feature matrix (from `shared/plans.ts`), comparison table, FAQ.
- `ComparePage.tsx`: "Muhasib vs X" strip, focused table and migration CTA on `/compare/wafeq` and
  `/compare/zoho`.
- `ToolsIndex.tsx`: tool cards with previews computed by the real calculators.
- `SolutionPage.tsx`: firms and small-business pages reuse the firms band and migration block.
- Route aliases in `route-content.ts`: `/e-invoicing`, `/compare/zoho-books`, `/free-tools`,
  `/accounting-firms`, `/small-business`, plus the bare redirects `/compare` and `/compare/wafeq`. Each serves the target page with the target's canonical
  and hreflang, and is left out of the sitemap.
- The language toggle keeps the page and the scroll position.

Tests added: `tests/unit/marketing-copy-guard`, `-home-foundation`, `-hero`, `-deadlines`, `-tour`,
`-savings`, `-comparison`, `-showcase`, `-pricing-faq`, `-pages`, `-polish`. The copy guard fails on
ZATCA, Saudi, KSA, bank feed, live bank, connect your bank, bank sync, direct filing, A-Cube,
ACube, Complyance and their Arabic forms, in both marketing locale files and every file under
`client/src/components/marketing/`.

## 2. Decisions the owner needs to confirm

Flags in `phase/home/flags.ts` (each has a `TODO(owner)` comment):

| Flag | Default | Confirm |
| --- | --- | --- |
| `SHOW_PROOF_PLACEHOLDERS` | on in dev, off in production builds | Replace the three placeholder slots (customer quote, firm quote, customer stories) with real proof |
| `SHOW_DATA_RESIDENCY` | off | Turn on only when production data is hosted in the UAE |
| `SHOW_WHATSAPP` | off | Needs a number. `AGENTS.md` says WhatsApp must not appear in public UI, so decide whether this footer link should exist at all |
| `FREE_MIGRATION_HELP` | off | Turn on only if "We help you move - free" is a real offer |
| `PROVIDER_FEES_CONFIRMED_ZERO` | off | Whether the accredited provider charges separate fees. Until confirmed the site says only "No separate e-invoicing subscription from us" |

Other items to confirm:

1. **Savings assumptions** (`savings.ts`, `TODO(owner)`): 4 minutes saved per invoice, 3 minutes per
   receipt or bill, capped at 60% of the hours entered. These are our own illustrative assumptions,
   labelled as such on the page.
2. **Comparison cells taken from the brief, not re-verified on vendor pages**: "VAT 201 prepared for
   EmaraTax: Yes" for Wafeq and Zoho, and Wafeq's e-invoicing cell "Included in your plan (vendor's
   wording)". The runner saw e-invoicing listed on Wafeq's pricing page, but not that exact phrase.
3. **Comparison cells shown as a dash** because the vendor pricing pages did not confirm them:
   bilingual invoices, WPS payroll file and multi-client workspace, for both Wafeq and Zoho.
4. **Competitor prices** (`competitor-prices.ts`, checked 24 Nov 2026): Wafeq 69/57, 99/80, 249/200
   and Zoho 0, 60, 90, 120, 280 matched the vendor pages. Zoho also lists an Ultimate plan at
   AED 660 and Wafeq an Enterprise plan on request; neither is shown. Xero has no AED list price, so
   it shows a dash.
5. **Canonical URL of the e-invoicing hub** stays `/uae-e-invoicing` (already live and pinned by
   tests). `/e-invoicing` is an alias. Say if you want it the other way round.
6. **"Can I cancel any time?"** cites the Terms of Service. No self-serve cancel setting was found in
   the client, so the answer does not mention one.
7. **Arabic copy**: written and reviewed by the model. A native reader should read the homepage and
   the hub once before launch.
8. **Test guards adjusted**: `no-free-plan-copy` exempts the one key that states Zoho's free plan as
   a competitor fact; three banking-wording scans skip `docs/site-rebuild/`, because the brief quotes
   the banned phrases in order to forbid them.

## 3. Gate results (Windows, 24 Nov 2026)

| Gate | Result |
| --- | --- |
| `npm run check` | Pass |
| `npm run lint` | Pass |
| `npx cross-env NODE_ENV=production vite build` | Pass |
| `npm run check:no-zatca-bundle` | Pass (475 files, 0 hits) |
| `npm test` | **Not fully green on this machine**, see below |
| `node scripts/check-bundle-budget.mjs` | **Fails**, see below |

`npm test` (360 files, 3,849 tests): after reruns, 12 files still fail when run alone:
`e3-register-language-switch`, `einvoice-provider-discard`, `pdf-documents`, `pdf-draft-watermark`,
`pdf-fonts`, `pdf-invoice`, `pdf-ledger`, `repo-banking-copy`, `report-discovery`,
`report-render-statements`, `schema-storage-split`, `step4-plan-states` (one timezone test).
The failure output points at Windows effects (backslash paths, CRLF line endings, PDF text
extraction, timezone) in files this branch does not change. That was **not proven** on the base
commit: creating a comparison checkout was blocked in this session. Ten more files timed out under
load and pass alone. The full suite was not rerun end to end after the last fix. Please run
`npm test` in CI or on Linux before merging.

Bundle budget: total 9.12 MB against a baseline of 8.71 MB. The `marketing` locale chunk grew from
135 kB to 215 kB raw (+59%), because the new copy is in the `marketing` namespace, which the sign-in
and pricing pages also load. The baseline was not updated. Either refresh it after merge
(`node scripts/check-bundle-budget.mjs --update`) or move the `hx*` keys to their own namespace
loaded only on `/en` and `/ar`.

## 4. Deferred or not done

- Lighthouse and LCP/CLS targets (brief section 5) were not measured. Overflow was checked in a
  browser at 360, 768, 1280 and 1440 px on `/en` and `/ar` with no horizontal overflow and no
  console errors.
- `npm run e2e:arabic-runtime` and `npm run test:db` were not run.
- No PR was opened and no "before" screenshots were retaken; "after" screenshots are in `shots/`.
- FAQ structured data was not added (the site has no JSON-LD helper).
- Legacy inline `[en, ar]` copy remains in the header, the editorial pages and the page titles in
  `route-content.ts` (the server imports that file for meta and the server-rendered h1). Labels
  inside the mock product visuals are `{en, ar}` pairs in local sample files. All new page copy is
  in the locale files.
- The e-invoice status pipeline and invoice maths exist separately in the hero, the tour and the
  showcase; they were not merged.
- The legacy plan cards show "د.إ" in Arabic while the new copy uses "درهم".
- The mobile hero stage has a small blank gap between the expense card and the VAT card.
- Seven files under `phase/` show as modified in `git status` from line-ending noise only; they
  have no content changes and were left uncommitted.
