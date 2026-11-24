# Arabic RTL browser verification

The browser matrix checks the configured SME route inventory, report catalog views, seeded detail
and edit routes, the signed-in client portal, onboarding, and public links used by the portal.
It opens the app in Arabic at 1440 × 900 desktop and 390 × 844 touch viewports with the
Asia/Dubai timezone. The fixtures are disposable Arabic accounting records and a customer who
signs in through an actual portal invitation.

The matrix opens the entry screens, representative deep links, and public portal links as
documents. The remaining authenticated views use the app router in the signed-in browser.

The test records browser console errors, uncaught page errors, missing pages, HTTP and API
failures, and API requests left unsettled. It also checks Arabic language and document
direction, the loaded Noto Sans Arabic face, page-level horizontal overflow, visible
untranslated copy, and the direction of selected invoice, TRN and email fields. The seeded
portal invoice checks the AED label, Arabic Gregorian month, and the existing Latin digit
policy.

## Result

The local production-mode build passed 284 checks across 142 routes and states at each size.
The total includes a focused repeat of five legacy redirects at both sizes after their
assertions were updated to match the canonical destination. All 22 document navigations
returned HTTP 200. The matrix recorded zero console errors, uncaught page errors, 404s, failed
or unsettled API requests, and page-level overflow. The document versions and invoice calendar
changes also passed targeted checks at both viewport sizes after the bundle was built.

## Run

Use a locally built app backed by a disposable database, with external providers disabled.
The test creates fixture records using the app API.

```sh
BASE_URL=http://127.0.0.1:5000 \
  CHROMIUM_PATH=/path/to/chromium \
  RTL_SHOT_DIR=tests/e2e/.artifacts/arabic-rtl-screenshots \
  node tests/e2e/arabic-rtl-polish.mjs
```

The detailed per-route result is written to
`tests/e2e/.artifacts/arabic-rtl-polish-last-run.json` and any failing check exits with a nonzero
status. Use `RTL_REUSE=true` for another run against the same local app and fixture, or
`RTL_ROUTES=/invoices,/client-portal/account` to focus a run. `RTL_ALL_SCREENSHOTS=true` adds a
capture for every successfully rendered view.

## Screenshots

| Screen             | Desktop                                               | Phone                                             |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------- |
| SME dashboard      | [Desktop](screenshots/desktop-dashboard.webp)         | [Phone](screenshots/phone-dashboard.webp)         |
| SME invoice table  | [Desktop](screenshots/desktop-invoices.webp)          | [Phone](screenshots/phone-invoices.webp)          |
| SME invoice editor | [Desktop](screenshots/desktop-invoice-edit.webp)      | [Phone](screenshots/phone-invoice-edit.webp)      |
| SME contacts       | [Desktop](screenshots/desktop-contacts.webp)          | [Phone](screenshots/phone-contacts.webp)          |
| Company settings   | [Desktop](screenshots/desktop-company-settings.webp)  | [Phone](screenshots/phone-company-settings.webp)  |
| Portal dashboard   | [Desktop](screenshots/desktop-portal-dashboard.webp)  | [Phone](screenshots/phone-portal-dashboard.webp)  |
| Portal invoices    | [Desktop](screenshots/desktop-portal-invoices.webp)   | [Phone](screenshots/phone-portal-invoices.webp)   |
| Portal documents   | [Desktop](screenshots/desktop-portal-documents.webp)  | [Phone](screenshots/phone-portal-documents.webp)  |
| Portal statements  | [Desktop](screenshots/desktop-portal-statements.webp) | [Phone](screenshots/phone-portal-statements.webp) |
| Portal messages    | [Desktop](screenshots/desktop-portal-messages.webp)   | [Phone](screenshots/phone-portal-messages.webp)   |
| Portal account     | [Desktop](screenshots/desktop-portal-account.webp)    | [Phone](screenshots/phone-portal-account.webp)    |
| Portal invitation  | [Desktop](screenshots/desktop-portal-join.webp)       | [Phone](screenshots/phone-portal-join.webp)       |
