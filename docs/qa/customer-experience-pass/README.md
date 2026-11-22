# Customer experience verification

The screenshots show the production client build against disposable Postgres data. Each screen was opened at 1440 × 900 and 390 × 844 in English and Arabic RTL.

The browser test checks page rendering, locale and direction, horizontal overflow, console errors and failed requests. It covers CSV preview and import, rejection of a PDF before preview, manual receipt entry with a stored image, and localized OCR review using a simulated response. A separate probe injects a receipt-list outage and verifies recovery through Retry.

The invoice email comes from the real local outbox. The test verifies the provider-free delivery status and opens the invoice link in a separate signed-out browser. The email screenshot shortens the printed share URL.

## Verification results

- The customer experience matrix passed 124 checks across the four locale and viewport combinations.
- Report screenshots wait for the catalogue, selected report, or financial statement to render.
- The Arabic text audit reported zero English lines on 14 Arabic workspace routes.
- The build, type and contract checks, changed-file lint, and 144 focused unit tests passed.
- All four bill-editor DOM tests passed on Node 22.23.5, the version used by CI. The browser checks cover the bill list, editor, payments and summary.

## Reproduce

Run the built app against a disposable local database. Set `BASE_URL` to the running app, `DATABASE_URL` to the disposable database, and `CHROMIUM_PATH` if using an existing Chromium installation.

```sh
SHOT_DIR=tests/e2e/.artifacts/customer-experience node tests/e2e/customer-experience-pass.mjs
```

Use `CUSTOMER_UX_LANGS=en` or `ar` and `CUSTOMER_UX_DEVICES=desktop` or `phone` to narrow the run.

## Screenshots

| Screen                     | English desktop                                          | English phone                                          | Arabic desktop                                           | Arabic phone                                           |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------ |
| Signup                     | [View](screenshots/en-desktop-signup.webp)               | [View](screenshots/en-phone-signup.webp)               | [View](screenshots/ar-desktop-signup.webp)               | [View](screenshots/ar-phone-signup.webp)               |
| Company setup              | [View](screenshots/en-desktop-onboarding.webp)           | [View](screenshots/en-phone-onboarding.webp)           | [View](screenshots/ar-desktop-onboarding.webp)           | [View](screenshots/ar-phone-onboarding.webp)           |
| Dashboard                  | [View](screenshots/en-desktop-dashboard.webp)            | [View](screenshots/en-phone-dashboard.webp)            | [View](screenshots/ar-desktop-dashboard.webp)            | [View](screenshots/ar-phone-dashboard.webp)            |
| Sales invoices             | [View](screenshots/en-desktop-invoices.webp)             | [View](screenshots/en-phone-invoices.webp)             | [View](screenshots/ar-desktop-invoices.webp)             | [View](screenshots/ar-phone-invoices.webp)             |
| Invoice editor             | [View](screenshots/en-desktop-invoice-editor.webp)       | [View](screenshots/en-phone-invoice-editor.webp)       | [View](screenshots/ar-desktop-invoice-editor.webp)       | [View](screenshots/ar-phone-invoice-editor.webp)       |
| Cash sale                  | [View](screenshots/en-desktop-cash-sale.webp)            | [View](screenshots/en-phone-cash-sale.webp)            | [View](screenshots/ar-desktop-cash-sale.webp)            | [View](screenshots/ar-phone-cash-sale.webp)            |
| Bills                      | [View](screenshots/en-desktop-bills.webp)                | [View](screenshots/en-phone-bills.webp)                | [View](screenshots/ar-desktop-bills.webp)                | [View](screenshots/ar-phone-bills.webp)                |
| Bill payments              | [View](screenshots/en-desktop-bill-payments.webp)        | [View](screenshots/en-phone-bill-payments.webp)        | [View](screenshots/ar-desktop-bill-payments.webp)        | [View](screenshots/ar-phone-bill-payments.webp)        |
| Bill summary               | [View](screenshots/en-desktop-bill-summary.webp)         | [View](screenshots/en-phone-bill-summary.webp)         | [View](screenshots/ar-desktop-bill-summary.webp)         | [View](screenshots/ar-phone-bill-summary.webp)         |
| Bill capture               | [View](screenshots/en-desktop-bill-capture.webp)         | [View](screenshots/en-phone-bill-capture.webp)         | [View](screenshots/ar-desktop-bill-capture.webp)         | [View](screenshots/ar-phone-bill-capture.webp)         |
| Expense claims             | [View](screenshots/en-desktop-expense-claims.webp)       | [View](screenshots/en-phone-expense-claims.webp)       | [View](screenshots/ar-desktop-expense-claims.webp)       | [View](screenshots/ar-phone-expense-claims.webp)       |
| Receipts                   | [View](screenshots/en-desktop-receipts.webp)             | [View](screenshots/en-phone-receipts.webp)             | [View](screenshots/ar-desktop-receipts.webp)             | [View](screenshots/ar-phone-receipts.webp)             |
| Manual receipt with image  | [View](screenshots/en-desktop-receipt-manual.webp)       | [View](screenshots/en-phone-receipt-manual.webp)       | [View](screenshots/ar-desktop-receipt-manual.webp)       | [View](screenshots/ar-phone-receipt-manual.webp)       |
| OCR review                 | [View](screenshots/en-desktop-receipt-ocr-review.webp)   | [View](screenshots/en-phone-receipt-ocr-review.webp)   | [View](screenshots/ar-desktop-receipt-ocr-review.webp)   | [View](screenshots/ar-phone-receipt-ocr-review.webp)   |
| Bank accounts              | [View](screenshots/en-desktop-bank-accounts.webp)        | [View](screenshots/en-phone-bank-accounts.webp)        | [View](screenshots/ar-desktop-bank-accounts.webp)        | [View](screenshots/ar-phone-bank-accounts.webp)        |
| Bank CSV preview           | [View](screenshots/en-desktop-bank-csv-preview.webp)     | [View](screenshots/en-phone-bank-csv-preview.webp)     | [View](screenshots/ar-desktop-bank-csv-preview.webp)     | [View](screenshots/ar-phone-bank-csv-preview.webp)     |
| Reconciliation suggestions | [View](screenshots/en-desktop-bank.webp)                 | [View](screenshots/en-phone-bank.webp)                 | [View](screenshots/ar-desktop-bank.webp)                 | [View](screenshots/ar-phone-bank.webp)                 |
| VAT 201                    | [View](screenshots/en-desktop-vat-201.webp)              | [View](screenshots/en-phone-vat-201.webp)              | [View](screenshots/ar-desktop-vat-201.webp)              | [View](screenshots/ar-phone-vat-201.webp)              |
| Reports                    | [View](screenshots/en-desktop-reports.webp)              | [View](screenshots/en-phone-reports.webp)              | [View](screenshots/ar-desktop-reports.webp)              | [View](screenshots/ar-phone-reports.webp)              |
| Receivables aging          | [View](screenshots/en-desktop-receivables-aging.webp)    | [View](screenshots/en-phone-receivables-aging.webp)    | [View](screenshots/ar-desktop-receivables-aging.webp)    | [View](screenshots/ar-phone-receivables-aging.webp)    |
| Financial statements       | [View](screenshots/en-desktop-financial-statements.webp) | [View](screenshots/en-phone-financial-statements.webp) | [View](screenshots/ar-desktop-financial-statements.webp) | [View](screenshots/ar-phone-financial-statements.webp) |
| Company settings           | [View](screenshots/en-desktop-settings.webp)             | [View](screenshots/en-phone-settings.webp)             | [View](screenshots/ar-desktop-settings.webp)             | [View](screenshots/ar-phone-settings.webp)             |
| Document numbering         | [View](screenshots/en-desktop-settings-numbering.webp)   | [View](screenshots/en-phone-settings-numbering.webp)   | [View](screenshots/ar-desktop-settings-numbering.webp)   | [View](screenshots/ar-phone-settings-numbering.webp)   |
| Security settings          | [View](screenshots/en-desktop-settings-security.webp)    | [View](screenshots/en-phone-settings-security.webp)    | [View](screenshots/ar-desktop-settings-security.webp)    | [View](screenshots/ar-phone-settings-security.webp)    |
| Client portal overview     | [View](screenshots/en-desktop-portal-dashboard.webp)     | [View](screenshots/en-phone-portal-dashboard.webp)     | [View](screenshots/ar-desktop-portal-dashboard.webp)     | [View](screenshots/ar-phone-portal-dashboard.webp)     |
| Client portal invoices     | [View](screenshots/en-desktop-portal-invoices.webp)      | [View](screenshots/en-phone-portal-invoices.webp)      | [View](screenshots/ar-desktop-portal-invoices.webp)      | [View](screenshots/ar-phone-portal-invoices.webp)      |
| Client portal documents    | [View](screenshots/en-desktop-portal-documents.webp)     | [View](screenshots/en-phone-portal-documents.webp)     | [View](screenshots/ar-desktop-portal-documents.webp)     | [View](screenshots/ar-phone-portal-documents.webp)     |
| Client portal statements   | [View](screenshots/en-desktop-portal-statements.webp)    | [View](screenshots/en-phone-portal-statements.webp)    | [View](screenshots/ar-desktop-portal-statements.webp)    | [View](screenshots/ar-phone-portal-statements.webp)    |
| Client portal messages     | [View](screenshots/en-desktop-portal-messages.webp)      | [View](screenshots/en-phone-portal-messages.webp)      | [View](screenshots/ar-desktop-portal-messages.webp)      | [View](screenshots/ar-phone-portal-messages.webp)      |
| Client portal account      | [View](screenshots/en-desktop-portal-account.webp)       | [View](screenshots/en-phone-portal-account.webp)       | [View](screenshots/ar-desktop-portal-account.webp)       | [View](screenshots/ar-phone-portal-account.webp)       |
| Invoice email              | [View](screenshots/en-desktop-invoice-email.webp)        | [View](screenshots/en-phone-invoice-email.webp)        | [View](screenshots/ar-desktop-invoice-email.webp)        | [View](screenshots/ar-phone-invoice-email.webp)        |
