# Najma Al Raeda — Website

Premium-minimal marketing site for **Najma Al Raeda**, a Dubai accounting, tax & advisory firm (est. 2017).

## Pages
- `index.html` — Home (hero, services overview, why-us, stats, CTA)
- `services.html` — Services overview, each links to a deep page
- `service-*.html` — 6 deep service pages (bookkeeping, vat-tax, audit, cfo, company-formation, payroll) with what's-included, process, FAQ
- `industries.html` — Sector grid linking to landing pages
- `industry-*.html` — 6 sector landing pages (real-estate, retail, ecommerce, fnb, construction, professional-services)
- `insights.html` — Insights hub + `insight-*.html` (4 UAE-tax articles)
- `tools.html` — Free interactive VAT & Corporate Tax calculator
- `about.html` — Story, values, timeline, leadership
- `contact.html` — Contact details + enquiry form (front-end demo)

## Assets
- `assets/styles.css` — shared stylesheet (design tokens, responsive)
- `assets/script.js` — header scroll, mobile nav, scroll reveal, animated counters, form
- `assets/logo.svg` — star/compass mark

## Design
Warm off-white paper, near-black ink, refined bronze/gold accent. Cormorant Garamond display + Inter body. Fully responsive.

## Run
Serve the static site from its directory.
```
cd sites/najma-al-raeda-website && python3 -m http.server 8080
```

English uses the existing `.html` URLs. Each Arabic page lives under `/ar/` as a static
document with right-to-left layout. The language switch opens the equivalent page and
saves the choice. On the first visit to an English URL, the site uses the browser’s
preferred supported language. Run `npm run e2e:firm-site` from the repository root while
the preview server is running to check both languages and the language switch.

## Notes

### Done — real data in place
- Contact details (sitewide): phone `+971 4 336 0773`, email `hello@nraccounts.com`, address Al Futtaim Tower, Baniyas Square, Dubai, hours Mon–Fri 9:00–17:00.
- WhatsApp button → `+971 50 704 2270`.
- Credentials strip: ACCA · CPA · ICAEW ACA · UAECA · FTA Tax Agency · Free-Zone Approved.
- Team section: anonymous role cards (no names/photos), as requested.

### Still to replace before launch
- **Form ID** — add a Formspree (or similar) ID to `data-endpoint` in both `contact.html` and `ar/contact/index.html`. Until then, the form opens a draft in the visitor's email app.
- **FTA tax-agent number** — the footer says "Registered FTA Tax Agency"; add the actual TAAN if you want it shown.
- **Insights articles** — accurate general guidance, but have a tax professional review against the latest FTA rules before publishing.

The tax calculator gives indicative estimates only (UAE VAT 5%; Corporate Tax 0% to AED 375k / 9% above; Small Business Relief ≤ AED 3m revenue).

The tax calculator gives indicative estimates only (UAE VAT 5%; Corporate Tax 0% to AED 375k / 9% above; Small Business Relief ≤ AED 3m revenue).

## Activating the contact form
The contact form is fully wired and works in two modes:

1. **Right now / no setup** — if no form service is configured, submitting opens the visitor's email app with the message pre-addressed to `hello@nraccounts.com`. The form validates name + email and blocks spam bots first.
2. **With a form service** — create a form that delivers to `hello@nraccounts.com` and replace `REPLACE_WITH_FORM_ID` in the `data-endpoint` in both contact documents. The form then submits in the background and shows a confirmation. [Formspree](https://formspree.io)

(Any equivalent form service — Web3Forms, Getform, Basin — works; just point `data-endpoint` at its POST URL.)
