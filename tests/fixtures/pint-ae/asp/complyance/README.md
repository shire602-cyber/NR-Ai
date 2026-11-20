# Complyance contract fixtures — DOC-DERIVED, NOT RECORDED

These files were written by hand on 2026-11-17 from the public Complyance developer documentation
(docs.complyance.io: Authentication, Unify submit-and-retrieve / documents / errors, Purchases,
Connect companies / errors, Webhooks, UAE country pages). No Complyance credentials existed, so
**nothing here was captured from a live Complyance environment**. Each interaction names the
documentation page it was taken from (`source`).

| File                       | What it holds                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `complyance-sandbox.json`  | Unify submit (200), 422 validation, 422 GETS-HEAD-010 duplicate, 412 mapping not ready, 401, 429; document status (submitted, processing, delivery_success, delivery_failed non-terminal, final_valid, final_invalid by FTA / by buyer ASP, rejected, 404); purchases list and get; Connect create (201, ASP_LINKAGE_NOT_FOUND) and list |
| `complyance-webhooks.json` | purchase.invoice.stored, purchase.invoice.validation_failed, invoice.passed and company.added.successfully deliveries, plus one delivery signed (HMAC-SHA256, lowercase hex) with a throwaway test secret                                                                                                                                |

Used by `tests/unit/einvoice-complyance-adapter.test.ts`,
`tests/unit/einvoice-complyance-signature.test.ts` and `tests/db/einvoice-complyance.test.ts`.

## Re-record before go-live

In the Complyance sandbox (`https://prod.gets.complyance.io`, a key from Developer portal → API
keys → Mock API keys, `"environment": "sandbox"`), replace each interaction with the real exchange
(redact the API key and the webhook secret) and check in particular:

1. The GETS payload we derive from our PINT AE UBL (`complyance-gets.ts`) passes with
   `purpose: "validate"` for every document type we send (standard, zero-rated export, exempt,
   out of scope, reverse charge, foreign currency, credit note). Exemption reason codes our
   generator writes (`VATEX-AE-*`) have no GETS value; confirm what Complyance expects.
2. The real 422 bodies, including the exact GETS-HEAD-010 message (it names the stored status).
3. Status words and `errors[].source` values on `final_invalid` (we split the FTA side from the
   buyer-ASP side on `source: "government"`), and whether `delivery_failed` ever becomes terminal
   for the UAE.
4. Whether a purchase GET returns the original XML in `data.xml` (plain or base64) and whether
   the purchase webhook carries `attribution.companyId` for Connect companies.
5. The payloads of `invoice.passed`, `invoice.failed` and the onboarding events (`company.*`,
   `peppol.id.*`), which the docs do not document field by field.
6. The `X-Webhook-Timestamp` format (ISO 8601 or unix time) and a real signed delivery to replace
   `complyance-webhooks.json#signed`.
7. Connect: the `search` filter of `GET /v3/connect/companies` (which fields it matches), and the
   `readyForInvoicing` / `mappingReadiness` values right after onboarding in an ISV workspace.
