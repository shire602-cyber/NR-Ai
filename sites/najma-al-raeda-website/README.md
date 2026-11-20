# Najma Al Raeda — Website

Premium-minimal marketing site for **Najma Al Raeda**, a Dubai accounting, tax & advisory firm (est. 2017 · 700+ clients · 500+ active).

## Pages
- `index.html` — Home (hero, services overview, why-us, stats, testimonials, CTA)
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
Open `index.html` in any browser, or serve locally:
```
cd website && python3 -m http.server 8080
```

## Notes

### Done — real data in place
- Contact details (sitewide): phone `+971 4 336 0773`, email `hello@nraccounts.com`, address Al Futtaim Tower, Baniyas Square, Dubai, hours Mon–Fri 9:00–17:00.
- WhatsApp button → `+971 50 704 2270`.
- Credentials strip: ACCA · CPA · ICAEW ACA · UAECA · FTA Tax Agency · Free-Zone Approved.
- Team section: anonymous role cards (no names/photos), as requested.

### Still to replace before launch
- **Form ID** — add a Formspree (or similar) ID to `data-endpoint` in `contact.html` (see "Activating the contact form" below). Until then the form falls back to opening the visitor's email app.
- **Testimonials** — the two quotes on the home page are still sample names; swap for real client quotes (ideally with a Google rating).
- **FTA tax-agent number** — the footer says "Registered FTA Tax Agency"; add the actual TAAN if you want it shown.
- **Insights articles** — accurate general guidance, but have a tax professional review against the latest FTA rules before publishing.

The tax calculator gives indicative estimates only (UAE VAT 5%; Corporate Tax 0% to AED 375k / 9% above; Small Business Relief ≤ AED 3m revenue).

The tax calculator gives indicative estimates only (UAE VAT 5%; Corporate Tax 0% to AED 375k / 9% above; Small Business Relief ≤ AED 3m revenue).

## Activating the contact form
The contact form is fully wired and works in two modes:

1. **Right now / no setup** — if no form service is configured, submitting opens the visitor's email app with the message pre-addressed to `hello@nraccounts.com`. The form validates name + email and blocks spam bots first.
2. **Recommended (silent background send)** — create a free form at [formspree.io](https://formspree.io) that delivers to `hello@nraccounts.com`, copy its form ID, and in `contact.html` replace `REPLACE_WITH_FORM_ID` in the form's `data-endpoint` (e.g. `https://formspree.io/f/abcdwxyz`). The form will then submit in the background and show the success message without leaving the page. No other change needed.

(Any equivalent form service — Web3Forms, Getform, Basin — works; just point `data-endpoint` at its POST URL.)
