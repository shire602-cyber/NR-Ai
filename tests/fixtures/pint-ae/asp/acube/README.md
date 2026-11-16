# A-Cube contract fixtures — DOC-DERIVED, NOT RECORDED

These files were written by hand on 2026-11-16 from the public A-Cube documentation
(docs.acubeapi.com, UAE section and the OpenAPI reference pages). No credentials existed and the
A-Cube API hosts were not reachable from the build machine, so **nothing here was captured from
a live A-Cube environment**.

| File                  | What it holds                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acube-sandbox.json`  | login, submit invoice / credit note (201), 422 validation error, 404 / 503, status (queued, delivered, delivery_error), TDD (204 pending, 200 reported), lists, legal entity (reserved, active, inactive) |
| `acube-webhooks.json` | document.received, document.delivered, delivery_error and legal_entity.synchronized (LINK, DELINK) payloads, plus one request signed with a throwaway Ed25519 test key                                    |

Used by `tests/unit/einvoice-acube-adapter.test.ts`, `tests/unit/einvoice-acube-signature.test.ts`
and `tests/db/einvoice-acube.test.ts`.

## Re-record before go-live

Against `https://ae-sandbox.api.acubeapi.com` with a sandbox account, replace each interaction
with the real exchange (redact the password and token) and check in particular:

1. Submit path: the API reference says `POST /invoices/outgoing`, the prose page says
   `POST /invoices` (`ACUBE_INVOICE_SUBMIT_PATH` switches it).
2. The real 422 body (`violations[].propertyPath/message/code/hint` per the OpenAPI schema).
3. The status words actually returned (lifecycle page: `sending_error` / `delivery_error`; OpenAPI
   enum: `sending_failed` / `delivery_failed`, plus `processed`, `accepted`, `rejected`,
   `withdrawn`, `action_required`).
4. TDD semantics: whether `GET /invoices/{id}/tdd` returning 200 means "reported to the FTA" or
   only "built", and what MLS documents look like when the FTA rejects the tax data.
5. Webhook event names (`document.*` in the prose, `invoice.outbound` / `invoice.inbound` /
   `credit_note.*` in the event-destination enum), the payload of a delivery failure, and whether
   retries are re-signed with a new `created` timestamp.
6. The signature public-key format (`public_key` PEM or raw base64) and a real signed delivery to
   replace `acube-webhooks.json#signed`.
7. Whether a document re-posted with the same UBL UUID is refused (duplicate) or accepted twice.
