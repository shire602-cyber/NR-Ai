# UAE e-invoicing through A-Cube (E1)

A-Cube (Platform ACube Technologies LLC) is on the Ministry of Finance register of accredited
e-invoicing service providers, accreditation no. **188961**
([register](https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/)).
It is Muhasib's Peppol corner 2: it receives our PINT AE UBL, validates it, delivers it to the
buyer's provider and reports the tax data to the FTA. API facts were read from docs.acubeapi.com
(UAE section) on 2026-11-16. **No live A-Cube call has been made yet**: everything below was built
against doc-derived fixtures and must be confirmed in the A-Cube sandbox (see the last section).

## Configuration

Select A-Cube in the company's settings and provision its encrypted login bundle. `ACUBE_ENV`
defaults to `sandbox`. Set `ACUBE_WEBHOOK_BASE_URL` for the callback URL shown in settings. The
company configuration check shows `not_configured` when the local credential bundle is missing.
[Company e-invoicing configuration](einvoicing-company-runtime.md)

## Adapter (`server/services/einvoice/providers/acube.ts`)

| Need                 | Implementation                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                 | `POST common.api.acubeapi.com/login {email,password,environment}` → JWT (24 h); cached, refreshed 1 h before `exp`; a 401 triggers one fresh login and one retry; credentials are never logged       |
| Submit               | Raw XML with `Content-Type: application/xml`. Invoices use `ACUBE_INVOICE_SUBMIT_PATH` (default `/invoices`). Credit note codes 81, 261 and 381 use `ACUBE_CREDIT_NOTE_SUBMIT_PATH` (default `/credit-notes`). The response `uuid` identifies the document for status and source lookups. |
| Errors               | 422 `violations[]` → rejection reasons (field = `propertyPath`, rule = `code`); 400/404 → rejected; 5xx/408/429/transport → retryable                                                                |
| Status               | `GET /{invoices\|credit-notes}/{id}` distinguishes Peppol handover, recipient receipt and the final Message Level Status (MLS) decision. |
| FTA reporting        | Required reports remain pending. `GET /{kind}/{id}/tdd` documents retrieval of the tax-data file. Confirmation requires a separate FTA acknowledgment. |
| Inbound              | Page through both incoming collections, then fetch `/{kind}/{id}/source` using the document's collection and preserve the original UTF-8 XML before importing a draft bill. |
| Legal entities       | `POST /legal-entities {tin}` reserves the TIN. The response `uuid` identifies the entity in `GET /legal-entities/{uuid}`.                                                                                |
| Webhook destinations | Page through `GET /event-destinations`. Create missing event targets with `POST /event-destinations`. Update authentication for a matching target with `PUT /event-destinations/{uuid}`. |
| Cancel               | none: `capabilities.cancel = false`; a sent invoice is corrected with a credit note                                                                                                                  |

## Two-track status

`einvoice_documents` (migration 0116) carries `delivery_status` (draft, validated, queued, sending,
delivered, delivery_failed, rejected) and `reporting_status` (not_required, pending, reported,
report_failed) with their timestamps, `report_by`, `provider_status`, `last_error_code` and the
full history in `einvoice_document_events`. A-Cube reports `processed` at Peppol handover and
`delivered` when the recipient's provider confirms receipt. Both stages remain in flight. The
recipient's MLS yields `accepted` or `rejected` and can arrive before the receipt notification.
[A-Cube invoice lifecycle](https://docs.acubeapi.com/documentation/gov-ae/documents/lifecycle)

- Reporting is required for B2B/B2G invoices (buyer TRN present) unless the company scope is
  `none`; B2C invoices are `not_required`.
- **Report-by date** = invoice date + `EINVOICE_REPORT_WINDOW_DAYS` (default 14). ASSUMPTION: the
  14-day window must be confirmed against the FTA's published procedure before it is relied on.
- A-Cube retries its `sending_failed` and `delivery_failed` attempts. The app keeps polling the
  existing document. An uncertain submission is reconciled using the original source XML.

## Onboarding and gating

`einvoice_legal_entities` holds one row per company/provider/environment: reserved TIN, A-Cube
legal entity id, status (reserved, pending, active, inactive), capabilities, Peppol address
(`0235:<TIN>`), approver (me / someone else + email), last action and sync times. Flow: reserve
→ the taxpayer selects "PLATFORM ACUBE TECHNOLOGIES L.L.C" in EmaraTax (UAE PASS) and confirms on
A-Cube's page within five minutes → `legal_entity.synchronized` (LINK) → active. DELINK → inactive.
Sending answers 409 `EINVOICE_LEGAL_ENTITY_NOT_ACTIVE` or `EINVOICE_LEGAL_ENTITY_DELINKED`.

## Supplier endpoint scheme (decision)

A-Cube's "Formats" sample shows the supplier `EndpointID schemeID="9922"` (`OPTBCNTRLP1005`) and the
buyer `0235`. Its Quick Start, which is what a sandbox legal entity sends, uses `0235` + the
10-digit TIN for both parties, and its responses identify parties as `0235:<TIN>`. A-Cube links a
legal entity by TIN, so it can only route a document whose supplier endpoint is `0235:<that TIN>`.
**Decision:** keep `0235` + TIN as the default, keep the scheme configurable per company
(`companies.peppol_scheme`), and refuse to transmit through A-Cube when the configured endpoint is
not the linked TIN (422 `EINVOICE_SUPPLIER_ENDPOINT_MISMATCH`). Tested in
`tests/unit/einvoice-acube-endpoint-scheme.test.ts` and `tests/db/einvoice-acube.test.ts`.

## Webhooks and idempotency

`POST /api/webhooks/einvoice/acube/:environment/:companyId` accepts the raw, signed request:

1. Optional company webhook token in the `ACUBE_WEBHOOK_TOKEN_HEADER` header.
2. RFC 9421 HTTP Message Signature, Ed25519, keyid `acube`, covering `@method @authority
@target-uri date content-digest`; `content-digest` is checked against the raw body; the public key
   comes from `common.api.acubeapi.com/signature-public-key` (cached 6 h, re-fetched once on a bad
   signature) or `ACUBE_SIGNATURE_PUBLIC_KEY`; `created` must be within 12 h (A-Cube retries ~10 h);
3. The event is stored in `einvoice_provider_events`, deduplicated per company and environment, and
   answered 200 at once. The `einvoice.providerEvents` job
   (every minute, lease + backoff, dead after 10 attempts) processes it, re-reading the resource
   from A-Cube rather than trusting the payload.

Registering destinations with `POST /api/companies/:companyId/einvoicing/acube/webhooks` uses the
credentials for that company and environment. The registrations belong to the A-Cube credential
account. Use a company-dedicated account because the A-Cube API does not provide a taxpayer filter
for destinations. The settings page shows the URL computed from the configured public HTTPS origin.
[A-Cube UAE OpenAPI](https://docs.acubeapi.com/openapi/gov-ae-api.json)

The worker claims the durable queue with a five-minute lease and sends the stored, validated XML.
After a lost response, it searches numbered pages of the outgoing collection and compares the
complete original UTF-8 source, including any BOM or trailing whitespace. Unresolved deliveries
require reconciliation after the retry budget expires. The `einvoice.acubePoll` job refreshes
in-flight documents and enqueues incoming ones every ten minutes.
[A-Cube document pagination](https://docs.acubeapi.com/documentation/gov-ae/documents/search-for-documents)

## Mandate timeline shown in product

From `server/services/einvoice/scope.ts` (Ministerial Decision No. 244 of 2025): revenue of AED 50
million or more — appoint an ASP by 31 Jul 2026, go-live 1 Jan 2027; below AED 50 million —
appoint by 31 Mar 2027, go-live 1 Jul 2027; government entities — appoint by 31 Mar 2027, go-live
1 Oct 2027. A competitor's site (Wafeq, 2026-11-16) shows 30 Oct 2026 as the appointment date for
the large band; this may reflect a later amendment and must be checked on mof.gov.ae before the
copy is changed. The UI labels the dates with their source and points to mof.gov.ae.

## To verify against the live A-Cube sandbox

1. Confirm that `POST /invoices` and `POST /credit-notes` select the legal entity from the supplier
   EndpointID and accept our PINT AE fixtures. [A-Cube UAE OpenAPI](https://docs.acubeapi.com/openapi/gov-ae-api.json)
2. Real 422 body and status words; whether a re-post with the same UUID is refused.
3. The separate FTA acknowledgment and rejection events for the reporting track.
4. Webhook event names actually delivered (`document.*` vs `invoice.outbound` etc.), the
   delivery-error payload, retry re-signing, the public-key format, and `@target-uri` behind our
   proxy (set `ACUBE_WEBHOOK_BASE_URL`).
5. Legal-entity status casing (`RESERVED` vs `Active`), reservation expiry, and the sandbox
   "Simulate onboarding" flow end to end.
6. Re-record `tests/fixtures/pint-ae/asp/acube/*.json` from those exchanges.
