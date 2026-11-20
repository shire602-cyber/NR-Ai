# Homepage Phase 1 verification

The production build was tested against a local PostgreSQL database with synthetic data. Desktop used Chromium at 1440 × 970. Phone used Chromium mobile emulation at 390 × 844 with 4× CPU slowdown, 60 ms latency and 1.6 Mbps downstream for the homepage LCP measurements.

| Locale | Desktop | Phone | Desktop menu | Phone drawer |
| --- | --- | --- | --- | --- |
| English | [Homepage](en-desktop.webp) | [Homepage](en-phone.webp) | [Product menu](en-desktop-navigation.webp) | [Product drawer](en-phone-navigation.webp) |
| Arabic | [Homepage](ar-desktop.webp) | [Homepage](ar-phone.webp) | [Product menu](ar-desktop-navigation.webp) | [Product drawer](ar-phone-navigation.webp) |

The browser checks opened the product and solution pages, exercised all four screenshot tabs, switched languages on the same route, checked calculator results and readiness scoring, and submitted the demo form without an email provider. Its fallback offered the support address. A separate local SMTP test accepted a valid callback request, rejected a missing CSRF token and invalid phone, and delivered one message for two submissions of the same request.

## Results

| Homepage LCP | Desktop | Phone |
| --- | ---: | ---: |
| English | 0.47 s | 1.75 s |
| Arabic | 0.29 s | 2.23 s |

Axe reported zero WCAG 2.1 A/AA violations in the tested states. The browser checks also verified 320 px reflow with a saved dark preference, keyboard navigation in both directions, focus after route changes, and the sign-in handoff in Arabic and English.

Type checking, the production build, the bundle budget, and the 13-route public launch crawl passed. The unit suite reported 3,192 passed and one skipped.

## Product claims checked against implementation

| Surface | Code checked |
| --- | --- |
| Bilingual invoices and templates | [Invoices](../../../client/src/pages/Invoices.tsx), [document routes](../../../server/routes/invoice-documents.routes.ts) |
| Double-entry accounting, bookkeeping and month-end | [Journal](../../../server/routes/journal.routes.ts), [month-end checklist](../../../server/routes/month-end.routes.ts) |
| VAT 201 preparation and review | [VAT 201 screen](../../../client/src/pages/VATFiling.tsx), [VAT routes](../../../server/routes/vat.routes.ts) |
| Financial reports | [Reports](../../../server/routes/reports.routes.ts) |
| Receipts, OCR and expense claims | [Receipt review](../../../client/src/pages/Receipts.tsx), [OCR](../../../server/routes/ocr.routes.ts), [expense claims](../../../server/routes/expense-claims.routes.ts) |
| Inventory | [Stock movements and valuation](../../../server/routes/inventory.routes.ts) |
| Bank CSV import and suggested matches | [Statement import and reconciliation](../../../server/routes/bank-statements.routes.ts) |
| Payroll and WPS SIF | [Payroll runs and file generation](../../../server/routes/payroll.routes.ts) |
| Client portal | [Invitations](../../../server/routes/portal-invitations.routes.ts), [portal access](../../../server/routes/client-portal.routes.ts) |
| UAE e-invoicing integrations | [Provider registry](../../../server/services/einvoice/providers/registry.ts), [A-Cube](../../../server/services/einvoice/providers/acube.ts), [Complyance](../../../server/services/einvoice/providers/complyance.ts) |
| Migration and AED pricing | [Import wizard routes](../../../server/routes/import.routes.ts), [migration guides](../../../client/src/pages/MigrationGuides.tsx), [shared plans and trial](../../../shared/plans.ts) |
