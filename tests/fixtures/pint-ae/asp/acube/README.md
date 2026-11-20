# A-Cube contract fixtures — DOC-DERIVED, NOT RECORDED

These exchanges are simulated offline from A-Cube's public UAE documentation. On 2026-11-20, the
published OpenAPI confirmed `POST /invoices` and `POST /credit-notes`, with `uuid` on invoice,
credit-note and legal-entity resources. The webhook examples identify resources with
`invoiceUuid`, `creditNoteUuid` or `legalEntityUuid` and identify each notification with `eventId`.
[UAE OpenAPI](https://docs.acubeapi.com/openapi/gov-ae-api.json) · [Quick Start](https://docs.acubeapi.com/documentation/gov-ae/quick-start) · [Credit notes](https://docs.acubeapi.com/documentation/gov-ae/documents/credit-notes) · [Webhook types](https://docs.acubeapi.com/documentation/gov-ae/webhooks/types)

| File                  | What it holds                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acube-sandbox.json`  | login, submit invoice / credit note (201), 422 validation error, 404 / 503, status (queued, delivered, delivery_error), TDD (204 pending, 200 reported), lists, legal entity (reserved, active, inactive) |
| `acube-webhooks.json` | Native inbound and outbound invoice and credit-note webhooks, plus legal-entity LINK and DELINK. The separate, historical signed sample exercises the legacy `document.received` shape. |

Used by `tests/unit/einvoice-acube-adapter.test.ts`, `tests/unit/einvoice-acube-signature.test.ts`
and `tests/db/einvoice-acube.test.ts`.

## Re-record before go-live

Against `https://ae-sandbox.api.acubeapi.com` with a sandbox account, replace each interaction
with the real exchange (redact the password and token) and check in particular:

1. Submission and status for PINT AE invoices and credit notes on the published endpoints.
2. The real 422 body (`violations[].propertyPath/message/code/hint` per the OpenAPI schema).
3. The status words actually returned (lifecycle page: `sending_error` / `delivery_error`; OpenAPI
   enum: `sending_failed` / `delivery_failed`, plus `processed`, `accepted`, `rejected`,
   `withdrawn`, `action_required`).
4. TDD semantics: whether `GET /invoices/{id}/tdd` returning 200 means "reported to the FTA" or
   only "built", and what MLS documents look like when the FTA rejects the tax data.
5. The payload of a delivery failure and whether retries are re-signed with a new `created`
   timestamp.
6. The signature public-key format (`public_key` PEM or raw base64) and a real signed delivery to
   replace `acube-webhooks.json#signed`.
7. Whether a document re-posted with the same UBL UUID is refused (duplicate) or accepted twice.
